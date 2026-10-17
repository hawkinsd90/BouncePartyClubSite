"""Local tests of the verification rules and the batch/reversal script templates on disposable scratch databases (loopback 127.0.0.1:54329, bpc_replay_* names, synthetic data only).
Scripts run as a NON-SUPERUSER role that owns the scratch ledger table (emulating the hosted postgres role); PostgreSQL 18 locally, PostgreSQL 17 hosted: hosted compatibility is NOT proven by this test.
Usage: python -I test_execution_scripts.py atoms|all"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import build_execution_package as P  # noqa: E402

SCR = r"C:\Users\vikki\migration-evidence\step2-final-scratch"
OUT = os.path.join(P.AUDIT, "evidence", "development-execution-test-results.json")
res = {"checks": []}


def rec(i, desc, ok, detail=""):
    res["checks"].append({"id": i, "check": desc, "pass": bool(ok), "detail": str(detail)[:260]})
    print(("PASS " if ok else "FAIL ") + i, desc, "|", str(detail)[:140])


def run_sql(db, sql, user="postgres", single=True):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    args = [L.PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", user, "-X", "-q", "-w", "-d", db, "-v", "ON_ERROR_STOP=1", "-At"]
    if single:
        args.append("-1")
    return subprocess.run(args, input=sql, capture_output=True, text=True, env=env, encoding="utf-8")


def val(db, sql, user="postgres"):
    r = run_sql(db, sql, user, single=False)
    return r.stdout.strip(), r.returncode, r.stderr.strip()


mode = sys.argv[1] if len(sys.argv) > 1 else "all"
# ------------------------------------------------------------ atoms on the captured Development schema
atoms = json.load(open(os.path.join(SCR, "atoms.json"), encoding="utf-8"))
uniq = sorted({a for v in atoms.values() for a in v})
sql = "\n".join(f"select {i}, ({a});" for i, a in enumerate(uniq))
r = run_sql("bpc_replay_e2i_devbase", sql, single=False)
got = {}
for line in r.stdout.splitlines():
    i, b = line.split("|")
    got[uniq[int(i)]] = (b == "t")
VF = os.path.join(SCR, "atom-validation.json")
prev = json.load(open(VF, encoding="utf-8")) if os.path.exists(VF) else {}
prev.update(got)  # cumulative: atoms pruned from a rule in an earlier pass keep their recorded result
json.dump(prev, open(VF, "w", encoding="utf-8"))
rec("T01", "every catalog atom evaluates (no SQL error) on the captured Development schema", r.returncode == 0 and len(got) == len(uniq), f"{len(uniq)} atoms; {sum(not b for b in got.values())} false; stderr {r.stderr[:80]}")
if mode == "atoms":
    print("false atoms:", sum(not b for b in got.values()))
    sys.exit(0)

# ------------------------------------------------------------ rules on the Dev schema (must be TRUE for catalog-only history-only rules) and on the Production pre-upgrade restore (negative control)
H = [v for v in P.plan if P.klass(v) in ("H", "S", "canary") or v == P.CANARY]
bad_syntax, false_h, true_h = [], [], 0
for v in P.plan:
    rl = P.rules[v]
    if not rl["sql"]:
        continue
    out, rc, err = val("bpc_replay_e2i_devbase", rl["sql"] + ";")
    if rc != 0:
        bad_syntax.append((v, err[:80]))
    elif v in H:
        if out == "t":
            true_h += 1
        else:
            false_h.append(v)
rec("T02", "all rules execute without SQL error on the Development schema", not bad_syntax, bad_syntax[:3])
rec("T03", "every plain/security history-only rule is TRUE on the captured Development schema", not false_h, f"true {true_h}, false {false_h[:5]}")
neg = sum(1 for v in H if val("bpc_replay_d4_template", P.rules[v]["sql"] + ";")[0] != "t")
rec("T04", "negative control: history-only rules are FALSE for versions whose objects the Production pre-upgrade schema lacks", neg > 0, f"{neg} of {len(H)} false on the Production pre-upgrade restore")

# ------------------------------------------------------------ script tests as a non-superuser ledger owner
db = "bpc_replay_e2l_scripts"
L.psql("postgres", ["-c", f"drop database if exists {db} with (force)"])
L.clone("bpc_replay_e2i_devbase", db)
L.psql("postgres", ["-c", "drop role if exists e2l_pg"])
assert L.psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", "create role e2l_pg login nosuperuser nocreatedb nocreaterole bypassrls"]).returncode == 0
L.psql("postgres", ["-c", "grant pg_read_all_data to e2l_pg"])
for g in ["alter table supabase_migrations.schema_migrations owner to e2l_pg", "grant usage on schema supabase_migrations, storage to e2l_pg", "grant update, select on storage.buckets to e2l_pg",
          "grant select on auth.users to e2l_pg"]:
    assert L.psql(db, ["-v", "ON_ERROR_STOP=1", "-c", g]).returncode == 0, g
u = "e2l_pg"
attr = val(db, "select rolsuper::text||','||rolbypassrls::text from pg_roles where rolname='e2l_pg'")[0]
rec("T05", "test role is a non-superuser with BYPASSRLS that owns the ledger table", attr == "false,true" and val(db, "select pg_get_userbyid(relowner) from pg_class where oid='supabase_migrations.schema_migrations'::regclass")[0] == "e2l_pg", attr)


def fill(s, start, att=None):
    s = s.replace("{{BATCH_START_COUNT}}", str(start)).replace("{{APPROVAL_SHA256}}", "0" * 64)
    for k, vv in {"ATTESTED_BY": "REHEARSAL-SYNTHETIC", "ATTESTED_AT": "2026-10-17", "SCOPE": "mechanics", "NOT_PROVEN": "historical execution", "EVIDENCE_SHA256": "0" * 64}.items():
        s = s.replace("{{" + k + "}}", vv)
    return s


count = lambda: int(val(db, "select count(*) from supabase_migrations.schema_migrations")[0])
b_can = P.bid[P.CANARY]
n0 = count()
r = run_sql(db, fill(P.batch_script(b_can), n0), u)
rec("T06", "canary batch script runs as the non-superuser owner: +1 history-only row, marker recognised", r.returncode == 0 and count() == n0 + 1 and val(db, f"select statements[1] like '{P.PREFIX} history-only NOT EXECUTED%' from supabase_migrations.schema_migrations where version='{P.CANARY}'")[0] == "t", r.stderr[:120])
r = run_sql(db, fill(P.batch_script(b_can), n0 + 1), u)
rec("T07", "re-running the same batch is refused (duplicate version) and changes nothing", r.returncode != 0 and "already recorded" in r.stderr and count() == n0 + 1, r.stderr[:100])
r = run_sql(db, fill(P.batch_script(P.bid[[v for v in P.plan if P.klass(v) == "H"][1]]), 9999), u)
rec("T08", "a wrong pre-batch ledger count is refused", r.returncode != 0 and "differs from the pre-batch export" in r.stderr, r.stderr[:100])
rv = run_sql(db, fill(P.reversal_script(b_can), n0), u)
rec("T09", "reversal removes exactly the batch's rows and restores the count", rv.returncode == 0 and count() == n0, rv.stderr[:100])
rv = run_sql(db, fill(P.reversal_script(b_can), n0), u)
rec("T10", "reversal of rows that are not present is refused", rv.returncode != 0 and "not exactly as expected" in rv.stderr, rv.stderr[:100])
# run every plain/security history-only batch in order
ok_all, ran, synthetic = True, 0, []
for b in sorted({i["batch"] for i in P.BORDER}):
    ops = [i for i in P.BORDER if i["batch"] == b]
    kl = ops[0]["klass"]
    if kl not in ("canary", "H", "S") and "20260323164559" not in [o["v"] for o in ops]:
        continue
    for o in ops:  # predecessors that are attestation items (data rules cannot be satisfied on empty scratch data) are represented by synthetic attestation rows
        for pv in P.rules[o["v"]]["predecessors"]:
            if val(db, f"select count(*) from supabase_migrations.schema_migrations where version='{pv}'")[0] == "0" and P.klass(pv) in ("Q", "W") and pv != "20260323164559":
                assert run_sql(db, f"insert into supabase_migrations.schema_migrations(version,name,statements) values ('{pv}','synthetic',ARRAY['{P.PREFIX} attestation NOT EXECUTED; SYNTHETIC TEST ROW']);", u).returncode == 0
                synthetic.append(pv)
    start = count()
    r = run_sql(db, fill(P.batch_script(b), start), u)
    if r.returncode != 0 or count() != start + len(ops):
        ok_all = False
        print("  batch failed", b, r.stderr[:160])
        break
    ran += 1
rec("T11", "all canary/plain/security history-only batches run in order (predecessor checks pass; Q predecessors other than the satisfiable one are synthetic rows)", ok_all, f"{ran} batches; ledger {count()}; synthetic predecessor rows {len(synthetic)}")
# partial failure rolls the whole batch back
bq = [b for b in sorted({i['batch'] for i in P.BORDER}) if [i for i in P.BORDER if i['batch'] == b][0]['klass'] == 'Q']
start = count()
r = run_sql(db, fill(P.batch_script(bq[0]), start), u)
rec("T12", "an attestation batch whose data rules are false on the empty scratch data fails as a whole and records nothing", r.returncode != 0 and "verification rule failed" in r.stderr and count() == start, r.stderr[:120])
# contact-statistics attestation (function identity rule is true on the captured schema) succeeds after seeding nothing
rec("T13", "attestation batch with a satisfiable rule (function identity) recorded a row with the attestation marker and its placeholders filled", val(db, "select statements[1] like '%attestation NOT EXECUTED%attested_by=REHEARSAL-SYNTHETIC%' from supabase_migrations.schema_migrations where version='20260323164559'")[0] == "t", r.stderr[:120])
# a dependent history-only batch after its attested predecessor
dep = [v for v in P.plan if '20260323164559' in P.rules[v]['predecessors']]
rec("T14", "history-only items that depend on the attested version were ordered after it and already ran or are ready", all(P.pos[v] > P.pos['20260323164559'] for v in dep), dep)
# X batch
xb = [b for b in sorted({i['batch'] for i in P.BORDER}) if [i for i in P.BORDER if i['batch'] == b][0]['klass'] == 'X']
before = val(db, "select coalesce(file_size_limit::text,'-') from storage.buckets where id='carousel-media'")[0]
start = count()
r = run_sql(db, fill(P.batch_script(xb[0]), start), u)
after = val(db, "select coalesce(file_size_limit::text,'-') from storage.buckets where id='carousel-media'")[0]
ex = val(db, "select statements[1] like '%executed%' and statements[2] like '%UPDATE storage.buckets%' from supabase_migrations.schema_migrations where version='20260325231044'")[0]
rec("T15", "SQL batch: the file runs verbatim in one transaction with its executed row (exact SQL in statements[2])", r.returncode == 0 and before == "-" and after == "524288000" and ex == "t", f"{before}->{after} {r.stderr[:80]}")
r = run_sql(db, fill(P.batch_script(xb[0]), count()), u)
rec("T16", "the SQL batch cannot run twice (rule 'limit still NULL' and duplicate guard)", r.returncode != 0, r.stderr[:100])
rv = run_sql(db, fill(P.reversal_script(xb[0]), start), u)
back = val(db, "select coalesce(file_size_limit::text,'-') from storage.buckets where id='carousel-media'")[0]
rec("T17", "SQL batch reversal restores the bucket value and removes the ledger row", rv.returncode == 0 and back == "-" and count() == start, rv.stderr[:100])
# whole-batch rollback when one rule becomes false
hb = [b for b in sorted({i['batch'] for i in P.BORDER}) if [i for i in P.BORDER if i['batch'] == b][0]['klass'] == 'H'][0]
L.psql("postgres", ["-c", f"drop database if exists {db}_b with (force)"])
L.clone("bpc_replay_e2i_devbase", db + "_b")
L.psql(db + "_b", ["-c", "alter table supabase_migrations.schema_migrations owner to e2l_pg; grant usage on schema supabase_migrations to e2l_pg"])
ops = [i for i in P.BORDER if i["batch"] == hb]
tgt = P.rules[ops[-1]["v"]]["sql"]
# make the LAST op's rule false by dropping one object it checks (a column or table found by regex)
m = re.search(r"table_name='(\w+)' AND column_name='(\w+)'", tgt.replace("= ", "=").replace(" =", "="))
tgt_obj = None
if m:
    tgt_obj = f"alter table {m.group(1)} drop column {m.group(2)} cascade"
else:
    m = re.search(r"to_regclass\('public\.(\w+)'\) IS NOT NULL", tgt)
    tgt_obj = f"drop table {m.group(1)} cascade" if m else None
if tgt_obj:
    L.psql(db + "_b", ["-c", tgt_obj])
    s0 = int(val(db + "_b", "select count(*) from supabase_migrations.schema_migrations")[0])
    r = run_sql(db + "_b", fill(P.batch_script(hb), s0), u)
    s1 = int(val(db + "_b", "select count(*) from supabase_migrations.schema_migrations")[0])
    rec("T18", "one false rule in the last operation rolls back the whole batch (no partial ledger rows)", r.returncode != 0 and "verification rule failed" in r.stderr and s1 == s0, r.stderr[:100])
else:
    rec("T18", "one false rule rolls back the whole batch", False, "could not build a mutation for " + hb)
# static scan: scripts contain only the allowed statement shapes
bad = []
for b in sorted({i['batch'] for i in P.BORDER}):
    s = P.batch_script(b)
    body = re.sub(r"'(?:[^']|'')*'", "''", s)
    if re.search(r"\b(DROP|ALTER|GRANT|REVOKE|TRUNCATE|CREATE)\b", body, re.I) and b not in xb:
        bad.append(b)
rec("T19", "no batch script (other than the SQL batches) contains DDL, GRANT, REVOKE or TRUNCATE", not bad, bad[:3])
res["limitations"] = ["PostgreSQL 18 locally versus 17 hosted; scratch ledger owned by a local role, hosted ledger owned by postgres", "the multi-statement call semantics of the hosted integration (one transaction per call) were observed read-only in E2J-B but a write is not rehearsed there",
                      "data rules for attestations are false on empty scratch tables by design; their truth is established only on hosted Development immediately before a batch"]
res["summary"] = {"pass": sum(c["pass"] for c in res["checks"]), "fail": sum(not c["pass"] for c in res["checks"])}
json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1)
for d in (db, db + "_b"):
    L.psql("postgres", ["-c", f"drop database if exists {d} with (force)"])
L.psql("postgres", ["-c", "drop role if exists e2l_pg"])
print(res["summary"])
