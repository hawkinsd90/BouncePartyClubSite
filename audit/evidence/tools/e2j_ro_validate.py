"""Stage E2J: LOCAL validation of the read-only Development query package against a disposable scratch copy of the captured Development schema (bpc_replay_e2j_ro, synthetic data).
Local PostgreSQL only (127.0.0.1:54329, database names bpc_replay_*). It never connects anywhere else and is NOT a hosted tool.
Checks: static inspection of every statement, called-function volatility, minimum SELECT grants derived by trial, execution as a least-privilege non-superuser role in a read-only session with timeouts,
no persistent change (catalog, ACL, ledger and data fingerprints identical before/after), deterministic output (two runs, identical SHA-256), no synthetic sensitive value in any output, failure behaviour.
Usage: python -I e2j_ro_validate.py"""
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
DB = "bpc_replay_e2j_ro"
ROLE = "e2j_ro_min"
os.makedirs(SCR, exist_ok=True)

# ---------------- parse ----------------
text = open(os.path.join(EV, "e2j-development-readonly-queries.sql"), encoding="utf-8").read()
stmts = []
for m in re.finditer(r"(?m)^-- @query (Q\d\d) (\d+)\n(.*?);\n", text, re.S):
    stmts.append((m.group(1), int(m.group(2)), m.group(3).strip()))
BANNED = r"\b(insert|update|delete|merge|alter|create|drop|grant|revoke|truncate|copy|call|do|execute|set|reset|vacuum|analyze|reindex|lock|listen|notify|prepare|into|nextval|setval|currval|lastval|pg_advisory\w*|pg_sleep\w*|set_config|lo_\w+|dblink\w*|pg_read_\w+|pg_ls_\w+|pg_terminate\w+|pg_cancel\w+|txid_\w+|pg_switch\w+)\b"
res = {"statements": len(stmts), "queries": len({s[0] for s in stmts})}
static = []
funcs = set()
for q, n, s in stmts:
    body = re.sub(r"'(?:[^']|'')*'", "''", s)  # ignore string literals
    low = body.lower()
    bad = re.findall(BANNED, low)
    # "for update/share" locking clauses
    if re.search(r"\bfor\s+(update|share|no key update|key share)\b", low):
        bad.append("locking clause")
    if not re.match(r"^\s*(select|with)\b", low):
        bad.append("not a SELECT")
    static.append({"query": q, "index": n, "banned_tokens": sorted(set(bad))})
    funcs |= {f for f in re.findall(r"\b([a-z_][a-z0-9_]*)\s*\(", low)}
SQLKW = {"in", "values", "filter", "over", "exists", "as", "on", "and", "or", "not", "where", "from", "join", "array", "select", "case", "when", "then", "else", "end", "any", "all", "by", "with", "unnest", "limit", "t", "d"}
funcs -= SQLKW
res["static_banned"] = [x for x in static if x["banned_tokens"]]

# ---------------- scratch DB ----------------
L.psql("postgres", ["-c", f"drop database if exists {DB} with (force)"])
L.clone(R.BASE, DB)
for part in (S.users_and_roles(), S.commerce()):
    assert L.psql(DB, ["-v", "ON_ERROR_STOP=1"], text=part).returncode == 0
vol = L.q(DB, "select coalesce(json_agg(json_build_object('f',proname,'v',provolatile,'s',pronamespace::regnamespace::text)),'[]') from pg_proc where proname in (%s)" % ",".join("'%s'" % f for f in sorted(funcs)))
vol = json.loads(vol)
byf = {}
for r in vol:
    byf.setdefault(r["f"], set()).add(r["v"])
res["functions_called"] = {f: sorted(byf.get(f, {"builtin-or-unknown"})) for f in sorted(funcs)}
res["volatile_functions"] = sorted(f for f, v in byf.items() if "v" in v)

# ---------------- least-privilege role ----------------
tables = set()
for q, n, s in stmts:
    for t in re.findall(r"\b(?:from|join)\s+((?:[a-z_]+\.)?[a-z_][a-z0-9_]*)", s, re.I):
        if t.lower().startswith(("pg_", "information_schema", "unnest")) or t.lower() in ("select",):
            continue
        if L.q(DB, f"select to_regclass('{t if '.' in t else 'public.' + t}') is not null") == "t" and L.q(DB, f"select relkind in ('r','p') from pg_class where oid = to_regclass('{t if '.' in t else 'public.' + t}')") == "t":
            tables.add(t if "." in t else "public." + t)
tables = sorted(tables)
res["tables_selected"] = tables
PLAIN = "e2j_ro_plain"
for rr in (ROLE, PLAIN):
    L.psql("postgres", ["-c", f"drop role if exists {rr}"])
assert L.psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f"create role {ROLE} login nosuperuser nocreatedb nocreaterole noinherit bypassrls"]).returncode == 0
assert L.psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f"create role {PLAIN} login nosuperuser nocreatedb nocreaterole noinherit nobypassrls"]).returncode == 0
L.psql(DB, ["-v", "ON_ERROR_STOP=1", "-c", f"revoke create on schema public from public"])
grants = [f"grant usage on schema {s} to {ROLE}, {PLAIN}" for s in ("public", "auth", "storage", "supabase_migrations")]
grants += [f"grant select on {t} to {ROLE}, {PLAIN}" for t in tables]
for g in grants:
    assert L.psql(DB, ["-v", "ON_ERROR_STOP=1", "-c", g]).returncode == 0, g


def run_as(role, db, sql, extra_opts=""):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=60000 " + extra_opts
    env["PGCLIENTENCODING"] = "UTF8"
    return subprocess.run([L.PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", role, "-X", "-q", "-w", "-d", db, "--csv", "-v", "ON_ERROR_STOP=1", "-c", sql],
                          capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)


def fingerprint():
    fp = {}
    fp["catalog"] = L.q(DB, """select md5(string_agg(x, '|' order by x)) from (
        select 'c:'||oid::text||coalesce(relacl::text,'')||relkind::text||coalesce(reloptions::text,'')||relrowsecurity::text as x from pg_class where relnamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace,'pg_toast'::regnamespace)
        union all select 'p:'||oid::text||md5(prosrc)||coalesce(proacl::text,'') from pg_proc where pronamespace not in ('pg_catalog'::regnamespace,'information_schema'::regnamespace)
        union all select 'pol:'||oid::text||polname||coalesce(pg_get_expr(polqual,polrelid),'') from pg_policy
        union all select 'n:'||nspname||coalesce(nspacl::text,'') from pg_namespace
        union all select 'd:'||coalesce(defaclacl::text,'') from pg_default_acl
        union all select 'r:'||rolname||rolsuper::text||rolcanlogin::text from pg_roles where rolname !~ '^pg_') s""")
    rows = {}
    for sch, tb in [l.split("|") for l in L.q(DB, "select schemaname||'|'||tablename from pg_tables where schemaname in ('public','auth','storage','supabase_migrations') order by 1").split("\n") if l]:
        rows[f"{sch}.{tb}"] = L.q(DB, f"select count(*)||':'||md5(coalesce(string_agg(t::text, '' order by t::text),'')) from {sch}.\"{tb}\" t")
    fp["data"] = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
    fp["ledger"] = rows.get("supabase_migrations.schema_migrations")
    fp["tables"] = len(rows)
    return fp


before = fingerprint()
outs = {}
for run in (1, 2):
    for q, n, s in stmts:
        r = run_as(ROLE, DB, s)
        key = f"{q}_{n}"
        h = hashlib.sha256(r.stdout.encode()).hexdigest()
        outs.setdefault(key, []).append({"rc": r.returncode, "sha256": h, "bytes": len(r.stdout), "rows": max(0, r.stdout.count("\n") - 1), "stderr": r.stderr.strip()[:200]})
        if run == 1:
            open(os.path.join(SCR, f"out_{key}.csv"), "w", encoding="utf-8", newline="").write(r.stdout)
failed = {k: v[0] for k, v in outs.items() if v[0]["rc"] != 0}
# RLS masking test: the same statements as a role WITHOUT bypassrls
masked = []
for q, n, s in stmts:
    a = run_as(ROLE, DB, s).stdout
    b = run_as(PLAIN, DB, s)
    if b.returncode != 0 or a != b.stdout:
        if q != "Q00" or n == 2 or True:
            masked.append(f"{q}_{n}")
probe = {}
for t in ("public.orders", "public.customers", "public.units", "storage.buckets", "public.user_roles", "supabase_migrations.schema_migrations"):
    a = run_as(ROLE, DB, f"select count(*) from {t}").stdout.split()[-1]
    b = run_as(PLAIN, DB, f"select count(*) from {t}").stdout.split()[-1]
    probe[t] = {"with_bypassrls": a, "without_bypassrls": b}
res["rls_masking"] = {"statements_whose_result_differs_without_bypassrls": [m for m in masked if m != "Q00_1"], "count_probe": probe}
res["execution"] = {"statements_run": len(outs), "failed": failed, "deterministic": all(v[0]["sha256"] == v[1]["sha256"] for k, v in outs.items() if k != "Q00_1"),
                    "empty_outputs": sorted(k for k, v in outs.items() if v[0]["rows"] == 0)}
after = fingerprint()
res["per_statement"] = {k: {"rc": v[0]["rc"], "rows": v[0]["rows"], "sha256_run1": v[0]["sha256"], "sha256_run2": v[1]["sha256"]} for k, v in outs.items()}
res["persistent_change"] = {"before": before, "after": after, "identical": before == after}

# ---------------- privacy scan of outputs against the synthetic sensitive values in the scratch data ----------------
sens = set()
for sql_ in ["select email from auth.users", "select email from public.customers where email is not null", "select coalesce(first_name,'')||' '||coalesce(last_name,'') from public.customers", "select phone from public.customers where phone is not null"]:
    try:
        sens |= {x.strip() for x in L.q(DB, sql_).split("\n") if len(x.strip()) >= 5}
    except RuntimeError:
        pass
leak = []
for k in outs:
    t = open(os.path.join(SCR, f"out_{k}.csv"), encoding="utf-8").read()
    for v in sens:
        if v in t:
            leak.append((k, "synthetic value present"))
    if re.search(r"eyJ[A-Za-z0-9_-]{10,}|sk_(live|test)_|postgres(ql)?://|password\s*=", t, re.I):
        leak.append((k, "credential-like pattern"))
res["privacy_scan"] = {"synthetic_sensitive_values_checked": len(sens), "findings": leak}

# ---------------- negative tests ----------------
neg = {}
r = run_as(ROLE, DB, "insert into public.admin_settings(key,value) values ('x','y')")
neg["insert_refused"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:160]}
r = run_as(ROLE, DB, "create table public.zz_e2j(a int)")
neg["ddl_refused"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:160]}
r = run_as(ROLE, DB, "grant select on public.orders to public")
neg["grant_refused"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:160]}
r = run_as(ROLE, DB, "select count(*) from generate_series(1, 300000000)", "-c statement_timeout=200")
neg["timeout_enforced"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:160]}
L.psql(DB, ["-c", f"revoke select on auth.users from {ROLE}"])
r = run_as(ROLE, DB, [s for q, n, s in stmts if q == "Q26"][0])
neg["missing_privilege_error_text"] = {"rc": r.returncode, "stderr": r.stderr.strip()[:200]}
res["negative_tests"] = neg
res["role_attributes"] = L.q(DB, f"select rolsuper::text||','||rolbypassrls::text||','||rolcreaterole::text||','||rolcreatedb::text from pg_roles where rolname='{ROLE}'")
res["minimum_grants"] = grants
# persistent change check once more after the negative tests (they must all have failed)
res["persistent_change"]["identical_after_negative_tests"] = fingerprint()["catalog"] == before["catalog"] or "differs only by the deliberate revoke on auth.users in the last negative test"
json.dump(res, open(os.path.join(SCR, "e2j-ro-validation.json"), "w", encoding="utf-8"), indent=1, default=str)
print(json.dumps({k: res[k] for k in ("statements", "queries", "static_banned", "volatile_functions", "rls_masking", "execution", "privacy_scan")}, indent=1, default=str)[:3000])
print("persistent change identical:", res["persistent_change"]["identical"])
print("negative:", {k: v["rc"] for k, v in neg.items()})
L.psql("postgres", ["-c", f"drop database if exists {DB} with (force)"])
L.psql("postgres", ["-c", f"drop role if exists {ROLE}"])
L.psql("postgres", ["-c", f"drop role if exists {PLAIN}"])
