"""Stage E2J-A: LOCAL comparison of role strategies for the read-only Development capture, on a disposable scratch copy of the captured Development schema (bpc_replay_e2ja, synthetic data).
Local PostgreSQL only (127.0.0.1:54329, database names bpc_replay_*). Never connects anywhere else.
Profiles (modelled on the role attributes in the Stage B Development roles capture; scratch roles only):
  MIN   least privilege: BYPASSRLS + SELECT on the 23 relations (the E2J temporary-role proposal)
  ROP   platform read-only profile: LOGIN, BYPASSRLS, member of pg_read_all_data and pg_monitor, nothing else (cf. supabase_read_only_user)
  PRIV  administrative profile: BYPASSRLS, CREATEROLE, CREATEDB, member of pg_read_all_data, with write privileges (cf. postgres)
  PLAIN pg_read_all_data WITHOUT BYPASSRLS (shows RLS still applies)
Protocol under test: one statement per connection, `psql -X -q -1 --csv -c "SET TRANSACTION READ ONLY" -c "SET LOCAL ..." -c "<statement>"`, no startup options.
Usage: python -I e2ja_validate.py"""
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402
import e2i_dev_restore as R  # noqa: E402

EV = os.path.abspath(os.path.join(HERE, ".."))
SCR = r"C:\Users\vikki\migration-evidence\e2j-scratch"
DB = "bpc_replay_e2ja"
ROLES = {"MIN": "e2ja_min", "ROP": "e2ja_rop", "PRIV": "e2ja_priv", "PLAIN": "e2ja_plain"}
text = open(os.path.join(EV, "e2j-development-readonly-queries.sql"), encoding="utf-8").read()
stmts = [(m.group(1), int(m.group(2)), m.group(3).strip()) for m in re.finditer(r"(?m)^-- @query (Q\d\d) (\d+)\n(.*?);\n", text, re.S)]
assert len(stmts) == 42
val = json.load(open(os.path.join(SCR, "e2j-ro-validation.json"), encoding="utf-8"))
TABLES = val["tables_selected"]
res = {"query_file_sha256": hashlib.sha256(open(os.path.join(EV, "e2j-development-readonly-queries.sql"), "rb").read()).hexdigest()}

L.psql("postgres", ["-c", f"drop database if exists {DB} with (force)"])
L.clone(R.BASE, DB)
for part in (S.users_and_roles(), S.commerce()):
    assert L.psql(DB, ["-v", "ON_ERROR_STOP=1"], text=part).returncode == 0
for r in ROLES.values():
    L.psql("postgres", ["-c", f"drop role if exists {r}"])
mk = {
    "MIN": "login nosuperuser nocreatedb nocreaterole noinherit bypassrls",
    "ROP": "login nosuperuser nocreatedb nocreaterole inherit bypassrls",
    "PRIV": "login nosuperuser createdb createrole inherit bypassrls",
    "PLAIN": "login nosuperuser nocreatedb nocreaterole inherit nobypassrls",
}
for k, r in ROLES.items():
    assert L.psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f"create role {r} {mk[k]}"]).returncode == 0
L.psql("postgres", ["-c", f"grant pg_read_all_data, pg_monitor to {ROLES['ROP']}"])
L.psql("postgres", ["-c", f"grant pg_read_all_data to {ROLES['PRIV']}, {ROLES['PLAIN']}"])
sc = "public, auth, storage, supabase_migrations"
for g in [f"grant usage on schema {s} to {ROLES['MIN']}" for s in sc.split(", ")] + [f"grant select on {t} to {ROLES['MIN']}" for t in TABLES]:
    assert L.psql(DB, ["-v", "ON_ERROR_STOP=1", "-c", g]).returncode == 0, g
for s in sc.split(", "):  # the administrative profile can write (as the hosted postgres role can)
    L.psql(DB, ["-c", f"grant usage on schema {s} to {ROLES['PRIV']}; grant all on all tables in schema {s} to {ROLES['PRIV']}"])


def run(role, db, sql_list, env_extra=None, one_txn=True):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGCLIENTENCODING"] = "UTF8"
    env.update(env_extra or {})
    args = [L.PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", role, "-X", "-q", "-w", "-d", db, "--csv", "-v", "ON_ERROR_STOP=1"]
    if one_txn:
        args.append("-1")
    for s in sql_list:
        args += ["-c", s]
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)


PRE = ["SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '30s'", "SET LOCAL lock_timeout = '3s'", "SET LOCAL idle_in_transaction_session_timeout = '60s'"]


def fingerprint():
    cat = L.q(DB, """select md5(string_agg(x, '|' order by x)) from (
        select 'c:'||oid::text||coalesce(relacl::text,'')||relkind::text||relrowsecurity::text as x from pg_class where relnamespace::regnamespace::text !~ '^(pg_catalog|information_schema|pg_toast|pg_temp|pg_toast_temp)'
        union all select 'p:'||oid::text||md5(prosrc)||coalesce(proacl::text,'') from pg_proc where pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        union all select 'pol:'||oid::text||polname from pg_policy
        union all select 'n:'||nspname||coalesce(nspacl::text,'') from pg_namespace where nspname !~ '^pg_(temp|toast_temp)'
        union all select 'd:'||coalesce(defaclacl::text,'') from pg_default_acl) s""")
    rows = {}
    for sch, tb in [l.split("|") for l in L.q(DB, "select schemaname||'|'||tablename from pg_tables where schemaname in ('public','auth','storage','supabase_migrations') order by 1").split("\n") if l]:
        rows[f"{sch}.{tb}"] = L.q(DB, f"select count(*)||':'||md5(coalesce(string_agg(t::text, '' order by t::text),'')) from {sch}.\"{tb}\" t")
    return {"catalog": cat, "data": hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest(), "tables": len(rows)}


before = fingerprint()
out = {}
for k, role in ROLES.items():
    out[k] = {}
    for q, n, s in stmts:
        r = run(role, DB, PRE + [s])
        out[k][f"{q}_{n}"] = {"rc": r.returncode, "sha": hashlib.sha256(r.stdout.encode()).hexdigest(), "stdout": r.stdout, "stderr": r.stderr.strip()[:160]}
base = out["MIN"]
cmp = {}
for k in ("ROP", "PRIV", "PLAIN"):
    diff = [i for i in base if out[k][i]["sha"] != base[i]["sha"] or out[k][i]["rc"] != base[i]["rc"]]
    cmp[k] = {"failed": [i for i in out[k] if out[k][i]["rc"] != 0], "differs_from_MIN": diff}
res["profile_comparison"] = cmp
res["MIN_failed"] = [i for i in base if base[i]["rc"] != 0]
# Q00_1 per profile (role identity and safety flags), parsed from CSV
q00 = {}
for k in ROLES:
    lines = out[k]["Q00_1"]["stdout"].strip().split("\n")
    q00[k] = dict(zip(lines[0].split(","), lines[1].split(",")))
    q00[k].pop("captured_at_utc", None)
    q00[k].pop("database_name", None)
res["Q00_1_by_profile"] = q00
# does the output equal the previous E2J protocol's output (PGOPTIONS mode) for the minimum role?  (Q00_1 changed, so skip it)
prev_ok = True
prev_diff = []
for i in base:
    if i.startswith("Q00_1"):
        continue
    p = os.path.join(SCR, f"out_{i}.csv")
    if os.path.exists(p) and hashlib.sha256(open(p, encoding="utf-8", newline="").read().encode()).hexdigest() != base[i]["sha"]:
        prev_ok = False
        prev_diff.append(i)
res["protocol_output_equals_E2J_pgoptions_output"] = prev_ok
res["protocol_output_differs_from_E2J_in"] = prev_diff

# ---------------- negative tests under the protocol, administrative profile ----------------
neg = {}
priv = ROLES["PRIV"]
r = run(priv, DB, PRE + ["insert into public.admin_settings(key,value) values ('e2ja','x')"])
neg["insert_refused_with_write_grants"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:140]}
r = run(priv, DB, PRE + ["create table public.zz_e2ja(a int)"])
neg["ddl_refused"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:140]}
r = run(priv, DB, PRE + ["grant select on public.orders to public"])
neg["grant_refused"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:140]}
r = run(priv, DB, PRE + ["create role e2ja_x"])
neg["create_role_refused"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:140]}
r = run(priv, DB, PRE + ["SET LOCAL statement_timeout = '200ms'", "select count(*) from generate_series(1, 300000000)"])
neg["timeout_enforced"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:140]}
# a session default alone is NOT a boundary: the same role can switch it off and write (temp table; nothing persists)
r = run(priv, DB, ["SET default_transaction_read_only = off", "create temp table zz_t(a int)", "insert into zz_t values (1)", "select count(*) from zz_t"], env_extra={"PGOPTIONS": "-c default_transaction_read_only=on"}, one_txn=False)
neg["session_default_alone_is_overridable"] = {"rc": r.returncode, "stdout": r.stdout.strip()[:40]}
# the same attempt for the platform read-only profile: no write privilege exists at all, even with the session default off
r = run(ROLES["ROP"], DB, ["SET default_transaction_read_only = off", "insert into public.admin_settings(key,value) values ('e2ja','x')"], one_txn=False)
neg["read_only_profile_cannot_write_even_with_guard_off"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:140]}
r = run(ROLES["PLAIN"], DB, PRE + ["select count(*) from storage.buckets"])
neg["pg_read_all_data_without_bypassrls_masks_rows"] = {"rows_seen": r.stdout.split()[-1], "owner_level_rows": 9}
res["negative_tests"] = neg

after = fingerprint()
res["persistent_change"] = {"before": before, "after": after, "identical": before == after}

# ---------------- privacy scan of every output of every profile ----------------
sens = set()
for q_ in ["select email from auth.users", "select email from public.customers where email is not null", "select coalesce(first_name,'')||' '||coalesce(last_name,'') from public.customers", "select phone from public.customers where phone is not null"]:
    try:
        sens |= {x.strip() for x in L.q(DB, q_).split("\n") if len(x.strip()) >= 5}
    except RuntimeError:
        pass
leak = []
for k in out:
    for i, v in out[k].items():
        for sv in sens:
            if sv in v["stdout"]:
                leak.append((k, i))
        if re.search(r"eyJ[A-Za-z0-9_-]{10,}|sk_(live|test)_|postgres(ql)?://", v["stdout"], re.I):
            leak.append((k, i, "credential-like"))
res["privacy_scan"] = {"values_checked": len(sens), "findings": leak}
res["psql_client"] = subprocess.run([L.PSQL, "--version"], capture_output=True, text=True).stdout.strip()
for k in out:
    for i in out[k]:
        out[k][i].pop("stdout")
json.dump(res, open(os.path.join(SCR, "e2ja-validation.json"), "w", encoding="utf-8"), indent=1, default=str)
print(json.dumps({k: res[k] for k in ("query_file_sha256", "MIN_failed", "profile_comparison", "Q00_1_by_profile", "protocol_output_equals_E2J_pgoptions_output", "protocol_output_differs_from_E2J_in", "negative_tests", "persistent_change", "privacy_scan", "psql_client")}, indent=1, default=str))
L.psql("postgres", ["-c", f"drop database if exists {DB} with (force)"])
for r_ in list(ROLES.values()) + ["e2ja_x"]:
    L.psql("postgres", ["-c", f"drop role if exists {r_}"])
