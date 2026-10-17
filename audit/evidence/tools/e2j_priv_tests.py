"""Stage E2J: local default-privilege experiments on DISPOSABLE scratch clones (bpc_replay_e2j_*). Nothing hosted; no repository grant or migration is changed.
T1  What a new table/sequence/function receives in four states: Development as captured, Development after the October block, Production as captured (D4 template), Production release-final.
T2  Effective privileges of the 12 tables and 2 sequences for service_role/anon/authenticated in Development-after-October versus Production release-final.
T3  A service_role session reading what create-booking reads: denied in Development-after-October, allowed in release-final.
T4  Trigger functions: a role without EXECUTE on the trigger function can still fire it through INSERT.
T5  Sequences: USAGE alone is enough for nextval; UPDATE allows setval (Production's anon/authenticated/service_role hold it).
T6  Proposed minimum-privilege target applied to a scratch clone: effects, and the unchanged anon/authenticated surface.
Usage: python -I e2j_priv_tests.py"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402

SCR = r"C:\Users\vikki\migration-evidence\e2j-scratch"
o = json.load(open(r"C:\Users\vikki\migration-evidence\e2j-privobj.json"))
TABLES = [r["name"] for r in o["rels"] if r["kind"] == "r"]
SEQS = [r["name"] for r in o["rels"] if r["kind"] == "S"]
SRC = {"dev_captured": "bpc_replay_e2i_devbase", "dev_after_october": "bpc_replay_e2i_aligned", "prod_captured": "bpc_replay_d4_template", "prod_release_final": "bpc_replay_e2i_relfinal"}
res = {}


def clone(tag):
    name = "bpc_replay_e2j_" + {"dev_captured": "dc", "dev_after_october": "da", "prod_captured": "pc", "prod_release_final": "pf"}[tag]
    L.clone(SRC[tag], name)
    return name


def run(db, sql, role=None, stop=False):
    pre = f"set role {role};\n" if role else ""
    return L.psql(db, ["-v", f"ON_ERROR_STOP={1 if stop else 0}", "-At"], text=pre + sql)


# ---- T0 schema-level privileges on public (captured and after October) ----
t0 = {}
for tag, src in SRC.items():
    t0[tag] = {r: {p: L.q(src, f"select has_schema_privilege('{r}','public','{p}')") == "t" for p in ("USAGE", "CREATE")} for r in ("anon", "authenticated", "service_role")}
    t0[tag]["nspacl"] = L.q(src, "select coalesce(nspacl::text,'(null)') from pg_namespace where nspname='public'")
res["T0_schema_public_privileges"] = t0

# ---- T1 defaults for new objects (created as postgres, the hosted migration owner) ----
t1 = {}
for tag in SRC:
    db = clone(tag)
    r = run(db, """create table public.zz_e2j_t(a int);
create sequence public.zz_e2j_s;
create function public.zz_e2j_f() returns int language sql as $$ select 1 $$;
select 'T:'||coalesce(relacl::text,'(null)') from pg_class where relname='zz_e2j_t' and relnamespace='public'::regnamespace;
select 'S:'||coalesce(relacl::text,'(null)') from pg_class where relname='zz_e2j_s' and relnamespace='public'::regnamespace;
select 'F:'||coalesce(proacl::text,'(null)') from pg_proc where proname='zz_e2j_f' and pronamespace='public'::regnamespace;
select 'DEFAULTS:'||coalesce(string_agg(pg_get_userbyid(defaclrole)||'/'||defaclobjtype||'='||defaclacl::text,' ; ' order by 1),'(none)') from pg_default_acl where defaclnamespace='public'::regnamespace;""")
    lines = [x for x in r.stdout.split("\n") if x]
    t1[tag] = {x.split(":", 1)[0]: x.split(":", 1)[1] for x in lines}
    L.psql("postgres", ["-c", f'drop database if exists "{db}" with (force)'])
res["T1_new_object_defaults"] = t1

# ---- T2/T3/T4/T5/T6 on clones of dev_after_october and prod_release_final ----
dbs = {tag: clone(tag) for tag in ("dev_after_october", "prod_release_final")}
t2 = {}
for tag, db in dbs.items():
    rows = {}
    for t in TABLES + SEQS:
        kind = "table" if t in TABLES else "sequence"
        privs = {}
        for role in ("service_role", "anon", "authenticated"):
            sel = [p for p in (("SELECT", "USAGE", "UPDATE") if kind == "sequence" else ("SELECT", "INSERT", "UPDATE", "DELETE")) if L.q(db, f"select has_{kind}_privilege('{role}','public.{t}','{p}')") == "t"]
            privs[role] = ",".join(sel) or "-"
        rows[t] = privs
    t2[tag] = rows
res["T2_effective_privileges"] = t2

t3 = {}
for tag, db in dbs.items():
    r = run(db, "select count(*) from public.product_pricing;", role="service_role")
    t3[tag] = {"stdout": r.stdout.strip(), "stderr": r.stderr.strip()[:120]}
res["T3_service_role_reads_product_pricing"] = t3

# T4 trigger function without EXECUTE
d = dbs["dev_after_october"]
run(d, """create table public.zz_t4(a int);
create function public.zz_t4_f() returns trigger language plpgsql as $$ begin new.a := new.a + 1; return new; end $$;
revoke execute on function public.zz_t4_f() from public;
create trigger zz_t4_trg before insert on public.zz_t4 for each row execute function public.zz_t4_f();
create role e2j_t4 nologin; grant usage on schema public to e2j_t4; grant insert, select on public.zz_t4 to e2j_t4;""")
r = run(d, "insert into public.zz_t4 values (1) returning a;", role="e2j_t4")
res["T4_trigger_fires_without_execute"] = {"acl_of_function": L.q(d, "select coalesce(proacl::text,'(null)') from pg_proc where proname='zz_t4_f'"), "insert_result": r.stdout.strip(), "stderr": r.stderr.strip()[:120]}

# T5 sequences
t5 = {}
for tag, db in dbs.items():
    run(db, "grant usage on schema public to anon;")  # isolates the sequence privilege from the schema-level denial shown in T0
    a = run(db, "select nextval('public.receipt_number_seq')>0;", role="anon")
    b = run(db, "select setval('public.receipt_number_seq', 1000000);", role="anon")
    t5[tag] = {"anon_nextval": a.stdout.strip() or a.stderr.strip()[:90], "anon_setval": b.stdout.strip() or b.stderr.strip()[:90]}
res["T5_sequence_privileges"] = t5

# T6 proposed minimum-privilege target, applied to the dev-after-october scratch clone only
READ_BY_BOOKING = ["inventory_products", "product_pricing", "product_categories", "product_bundles", "product_bundle_components", "package_inflatable_components", "package_inflatable_eligibility", "product_bundle_excluded_categories"]
before = {t: t2["dev_after_october"][t] for t in TABLES}
sql = "\n".join(f"grant select on public.{t} to service_role;" for t in READ_BY_BOOKING)
r = run(d, sql, stop=True)
after = {}
for t in TABLES:
    after[t] = {role: ",".join(p for p in ("SELECT", "INSERT", "UPDATE", "DELETE") if L.q(d, f"select has_table_privilege('{role}','public.{t}','{p}')") == "t") or "-" for role in ("service_role", "anon", "authenticated")}
res["T6_target_applied_locally"] = {"statements": sql.split("\n"), "rc": r.returncode, "anon_authenticated_unchanged": all(before[t]["anon"] == after[t]["anon"] and before[t]["authenticated"] == after[t]["authenticated"] for t in TABLES), "service_role_after": {t: after[t]["service_role"] for t in TABLES}}
r2 = run(d, "select count(*) from public.product_pricing;", role="service_role")
res["T6_target_applied_locally"]["service_role_read_after"] = r2.stdout.strip() or r2.stderr.strip()[:100]
run(d, "drop role if exists e2j_t4;")
for db in dbs.values():
    L.psql("postgres", ["-c", f'drop database if exists "{db}" with (force)'])
L.psql("postgres", ["-c", "drop role if exists e2j_t4"])
json.dump(res, open(os.path.join(SCR, "e2j-priv-tests.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps(res, indent=1)[:6000])
