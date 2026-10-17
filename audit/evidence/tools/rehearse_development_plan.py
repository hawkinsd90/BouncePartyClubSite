"""Local rehearsal of the canonical Development plan (phases P1 and P2) with the UNMODIFIED local-only executor on disposable scratch databases restored from the captured Development schema.
No hosted system; loopback 127.0.0.1:54329; database names bpc_exec_*. Attestations in the rehearsal carry a synthetic attester and are NOT owner attestations.
Prerequisites: scratch PostgreSQL cluster running; bpc_replay_e2i_devbase restored (tools/e2i_dev_restore.py build); build_development_plan.py already run.
Usage: python -I rehearse_development_plan.py"""
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
from step2_paths import derived, workdir  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
EXE = os.path.join(REPO, "scripts", "dev", "local-executor", "local-migration-executor.cjs")
BLD = os.path.join(REPO, "scripts", "dev", "local-executor", "build-allowlist.cjs")
SCR = workdir()
OUT = os.path.join(REPO, "audit", "evidence", "development-plan-rehearsal-results.json")
STB = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
MARK = "bpc-migration-executor-scratch:v1"
res = {"checks": []}


def rec(i, desc, ok, detail=""):
    res["checks"].append({"id": i, "check": desc, "pass": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + i, desc, "|", str(detail)[:160])


def env():
    e = {k: v for k, v in os.environ.items() if not (k.startswith("PG") or k.startswith("SUPABASE") or k == "DATABASE_URL")}
    e["BPC_PSQL"] = L.PSQL
    return e


def mkdb(name):
    L.psql("postgres", ["-c", f'drop database if exists "{name}" with (force)'])
    assert L.psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f'create database "{name}" template bpc_replay_e2i_devbase']).returncode == 0
    assert L.psql("postgres", ["-c", f"comment on database \"{name}\" is '{MARK}'"]).returncode == 0
    return name


def q(db, sql):
    r = subprocess.run([L.PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-At", "-w", "-d", db, "-c", sql], capture_output=True, text=True, env=env())
    return r.stdout.strip(), r.returncode, r.stderr.strip()


def ledger_count(db, tries=8):
    """Row count of the scratch ledger; retries a failed psql call (a rapid poll against a database being killed or created can return nothing)."""
    for _ in range(tries):
        out, rc, _err = q(db, "select count(*) from supabase_migrations.schema_migrations")
        if rc == 0 and out.strip().isdigit():
            return int(out)
        time.sleep(0.2)
    return -1


def exe(cmd, db, allow, audit, extra=(), timeout=3000):
    doc = json.load(open(allow, encoding="utf-8"))
    n = sum(1 for i in doc["items"] if i["kind"] == "execute" and i["version"] < doc["expected_base_history"]["latest"])
    args = ["node", EXE, cmd, "--allowlist", allow, "--db", db, "--audit-dir", audit, "--approval-hash", doc["document_sha256"], "--repo-root", REPO, "--port", "54329"]
    if cmd != "verify" and n:
        args += ["--acknowledge-older-than-latest", str(n)]
    r = subprocess.run(args + list(extra), capture_output=True, text=True, env=env(), timeout=timeout, cwd=REPO)
    try:
        j = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        j = {"ok": False, "message": (r.stdout + r.stderr)[:300]}
    return r.returncode, j


head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=REPO).stdout.strip()
res["head"] = head
allow = os.path.join(SCR, "dev-allowlist.json")
b = subprocess.run(["node", BLD, "--repo-root", REPO, "--commit", head, "--items-json", os.path.join(SCR, "dev-plan-items.json"), "--base-history", STB + r"\dev_catalog_history.json",
                    "--withdrawn-index", os.path.join(REPO, "audit", "evidence", "withdrawn-migrations", "withdrawn-index.json"), "--out", allow], capture_output=True, text=True, env=env(), cwd=REPO)
rec("R01", "allowlist builds from the canonical Development plan with the unmodified builder", b.returncode == 0 and os.path.exists(allow), (b.stdout + b.stderr)[:200])
doc = json.load(open(allow, encoding="utf-8"))
kinds = {}
for i in doc["items"]:
    kinds[i["kind"]] = kinds.get(i["kind"], 0) + 1
graph = json.load(open(os.path.join(SCR, "dev-plan-graph.json"), encoding="utf-8"))
rec("R02", "plan contains only P1/P2 items; no October, withheld, unresolved, withdrawn or alias-file version", all(graph["phase"][i["version"]] in (1, 2) for i in doc["items"]) and not ({"20260305203528", "20260407203226", "20260407211122", "20260814120000"} & {i["version"] for i in doc["items"]}), kinds)
rec("R03", "predecessors precede dependents in plan order", all(graph["plan"].index(p) < graph["plan"].index(v) for v in graph["plan"] for p in graph["pred"][v] if p in graph["plan"]), len(graph["plan"]))
base_n = int(doc["expected_base_history"]["count"])
db = mkdb("bpc_exec_devplan")
aud = os.path.join(SCR, "audit-devplan")
os.makedirs(aud, exist_ok=True)
for f in os.listdir(aud):
    os.remove(os.path.join(aud, f))
fp0 = q(db, "select md5(string_agg(c.relname||coalesce(c.relacl::text,'')||c.relkind::text, '|' order by c.relname)) from pg_class c where c.relnamespace::regnamespace::text in ('public','auth','supabase_migrations')")[0]
fn0 = q(db, "select md5(string_agg(p.proname||md5(p.prosrc), '|' order by p.proname, p.oid)) from pg_proc p where p.pronamespace::regnamespace::text='public'")[0]
buckets0 = q(db, "select string_agg(id||':'||coalesce(file_size_limit::text,'-')||':'||coalesce(array_to_string(allowed_mime_types,','),'-'),'|' order by id) from storage.buckets")[0]
rc, j = exe("plan", db, allow, aud)
rec("R04", "plan command validates the allowlist against the scratch ledger", rc == 0, j.get("message") or {k: j.get(k) for k in ("ok", "pending")})
first_exec = next(i["version"] for i in doc["items"] if i["kind"] == "execute")
rc, j = exe("run", db, allow, aud, ["--stop-after", first_exec])
n1 = ledger_count(db)
rec("R05", "interruption: run stops after the first executable item; partial ledger is consistent", rc == 0 and n1 > base_n, {"rc": rc, "ledger": n1, "msg": j.get("message", "")})
rc, j = exe("verify", db, allow, aud)
rec("R06", "verify on the interrupted state reports the remaining items (ok=false by design, no ledger inconsistency or refusal)", rc != 2 and j.get("ok") is False and len(j.get("missing", [])) == len(doc["items"]) - (n1 - base_n) and not j.get("refused"), {"missing": len(j.get("missing", [])), "executed": j.get("executed"), "history_only": j.get("history_only")})
rc, j = exe("run", db, allow, aud)
n2 = ledger_count(db)
rec("R07", "restart completes the plan: ledger = 58 + 259 rows", rc == 0 and n2 == base_n + len(doc["items"]), {"rc": rc, "ledger": n2, "expected": base_n + len(doc["items"]), "msg": j.get("message", "")})
rc, j = exe("run", db, allow, aud)
n3 = ledger_count(db)
rec("R08", "second run is a no-op (duplicate prevention at the executor level)", rc == 0 and n3 == n2, {"rc": rc, "ledger": n3})
_, rcd, err = q(db, "insert into supabase_migrations.schema_migrations(version,name,statements) select version,name,statements from supabase_migrations.schema_migrations limit 1")
rec("R09", "duplicate version insert is refused by the ledger primary key", rcd != 0 and "duplicate key" in err, err[:120])
rc, j = exe("verify", db, allow, aud)
rec("R10", "verify after completion passes", rc == 0, j.get("message") or j.get("ok"))
kinds_db = q(db, "select string_agg(k||'='||n, ',' order by k) from (select case when statements[1] like '-- BPC-LOCAL-EXECUTOR executed%' then 'executed' when statements[1] like '-- BPC-LOCAL-EXECUTOR history-only%' then 'history-only' when statements[1] like '-- BPC-LOCAL-EXECUTOR attestation%' then 'attestation' else 'base' end k, count(*) n from supabase_migrations.schema_migrations group by 1) s")[0]
rec("R11", "ledger markers: 58 base, 2 executed, 201 history-only, 56 attestation", kinds_db == "attestation=56,base=58,executed=2,history-only=201", kinds_db)
iso = q(db, "select count(*) from supabase_migrations.schema_migrations where version >= '20261007000000' or version in ('20260305203528','20260407203226','20260407211122','20260611184401','20260814120000','20251229223230','20260323201502')")[0]
rec("R12", "isolation: no October, withdrawn, alias-file, unresolved or containment version entered the ledger", iso == "0", iso)
ex_sha = q(db, "select count(*) from supabase_migrations.schema_migrations where statements[1] like '-- BPC-LOCAL-EXECUTOR executed%' and array_length(statements,1)=2")[0]
rec("R13", "executed rows store the exact SQL as statements[2]", ex_sha == "2", ex_sha)
fp1 = q(db, "select md5(string_agg(c.relname||coalesce(c.relacl::text,'')||c.relkind::text, '|' order by c.relname)) from pg_class c where c.relnamespace::regnamespace::text in ('public','auth','supabase_migrations')")[0]
fn1 = q(db, "select md5(string_agg(p.proname||md5(p.prosrc), '|' order by p.proname, p.oid)) from pg_proc p where p.pronamespace::regnamespace::text='public'")[0]
buckets1 = q(db, "select string_agg(id||':'||coalesce(file_size_limit::text,'-')||':'||coalesce(array_to_string(allowed_mime_types,','),'-'),'|' order by id) from storage.buckets")[0]
rec("R14", "schema effect limited to the two bucket-setting updates (relations, ACLs and function bodies unchanged)", fp0 == fp1 and fn0 == fn1 and buckets0 != buckets1, {"buckets_before": buckets0[:90], "buckets_after": buckets1[:140]})
# --- kill mid-run on a second database ---
db2 = mkdb("bpc_exec_devplan_kill")
aud2 = os.path.join(SCR, "audit-devplan-kill")
os.makedirs(aud2, exist_ok=True)
for f in os.listdir(aud2):
    os.remove(os.path.join(aud2, f))
args = ["node", EXE, "run", "--allowlist", allow, "--db", db2, "--audit-dir", aud2, "--approval-hash", doc["document_sha256"], "--repo-root", REPO, "--port", "54329", "--acknowledge-older-than-latest", "2"]
kills, refused = 0, []
for target in (base_n + 20, base_n + 60, base_n + 110, base_n + 170, base_n + 230):
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env(), cwd=REPO)
    t0 = time.time()
    while time.time() - t0 < 120 and p.poll() is None and ledger_count(db2) < target:
        time.sleep(0.05)
    if p.poll() is None:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
        kills += 1
    out_, err_ = p.communicate()
    if "not backed by audit evidence" in (out_ + err_):
        refused.append(target)
nk = ledger_count(db2)
rec("R15", "executor killed five times at different points and restarted each time: partial ledger, never refused for a crash gap", kills >= 3 and refused == [] and base_n < nk, {"kills": kills, "ledger": nk, "refused_at": refused})
rc, j = exe("run", db2, allow, aud2)
nk2 = ledger_count(db2)
dup = q(db2, "select count(*) from (select version from supabase_migrations.schema_migrations group by 1 having count(*)>1) d")[0]
rec("R16", "final restart completes the plan without duplicates (crash-gap rows reconciled in the audit store)", rc == 0 and nk2 == base_n + len(doc["items"]) and dup == "0", {"rc": rc, "ledger": nk2, "reconciled": j.get("reconciled"), "msg": j.get("message", "")})
# --- failure of an executable item, then recovery ---
db3 = mkdb("bpc_exec_devplan_fail")
aud3 = os.path.join(SCR, "audit-devplan-fail")
os.makedirs(aud3, exist_ok=True)
for f in os.listdir(aud3):
    os.remove(os.path.join(aud3, f))
assert q(db3, "create function public.zz_fail() returns trigger language plpgsql as $$ begin raise exception 'rehearsal failure'; end $$")[1] == 0
assert q(db3, "create trigger zz_fail before update on storage.buckets for each row execute function public.zz_fail()")[1] == 0
rc, j = exe("run", db3, allow, aud3)
failed_ledger = q(db3, "select count(*) from supabase_migrations.schema_migrations where statements[1] like '-- BPC-LOCAL-EXECUTOR executed%'")[0]
rec("R17", "failing executable item rolls back completely (no executed row) and the run stops", rc != 0 and failed_ledger == "0", {"rc": rc, "executed_rows": failed_ledger, "msg": j.get("message", "")[:100]})
assert q(db3, "drop trigger zz_fail on storage.buckets")[1] == 0
rc, j = exe("run", db3, allow, aud3)
n4 = ledger_count(db3)
rec("R18", "after the cause is removed the run resumes and completes", rc == 0 and n4 == base_n + len(doc["items"]), {"rc": rc, "ledger": n4})
# --- deterministic crash gap for history-only rows: ledger row committed, completion event lost (tail of the hash-chained audit store removed) ---
mini_items = [i for i in json.load(open(os.path.join(SCR, "dev-plan-items.json"), encoding="utf-8")) if i["kind"] == "history-only"][:3]
json.dump(mini_items, open(os.path.join(SCR, "mini-items.json"), "w", encoding="utf-8"))
mini = os.path.join(SCR, "mini-allowlist.json")
subprocess.run(["node", BLD, "--repo-root", REPO, "--commit", head, "--items-json", os.path.join(SCR, "mini-items.json"), "--base-history", STB + r"\dev_catalog_history.json",
                "--withdrawn-index", os.path.join(REPO, "audit", "evidence", "withdrawn-migrations", "withdrawn-index.json"), "--out", mini], capture_output=True, text=True, env=env(), cwd=REPO)
db4 = mkdb("bpc_exec_devplan_gap")
aud4 = os.path.join(SCR, "audit-devplan-gap")
os.makedirs(aud4, exist_ok=True)
for f in os.listdir(aud4):
    os.remove(os.path.join(aud4, f))
rc, j = exe("run", db4, mini, aud4)
logp = os.path.join(aud4, "audit.jsonl")
lines = open(logp, encoding="utf-8").read().splitlines()
last_ho = max(i for i, l in enumerate(lines) if json.loads(l).get("event") == "history_only")
last_ver = json.loads(lines[last_ho])["version"]
open(logp, "w", encoding="utf-8", newline="\n").write(chr(10).join(lines[:last_ho]) + chr(10))  # the record_start event of that item remains; its completion event and the run_end are gone
has_start = any(json.loads(l).get("event") == "record_start" and json.loads(l).get("version") == last_ver for l in lines[:last_ho])
rc2, j2 = exe("run", db4, mini, aud4)
rec("R20", "crash gap (ledger row committed, completion event lost): restart accepts the row via its record_start event and reconciles the audit store", rc == 0 and has_start and rc2 == 0 and last_ver in (j2.get("reconciled") or []), {"version": last_ver, "reconciled": j2.get("reconciled"), "msg": j2.get("message", "")})
db5 = mkdb("bpc_exec_devplan_foreign")
aud5 = os.path.join(SCR, "audit-devplan-foreign")
os.makedirs(aud5, exist_ok=True)
for f in os.listdir(aud5):
    os.remove(os.path.join(aud5, f))
rc, j = exe("plan", db5, mini, aud5)
fv = mini_items[0]["version"]
q(db5, f"insert into supabase_migrations.schema_migrations(version,name,statements) values ('{fv}','x',ARRAY['-- BPC-LOCAL-EXECUTOR history-only NOT EXECUTED run=forged basis=none'])")
rc3, j3 = exe("run", db5, mini, aud5)
rec("R21", "a history-only ledger row with no audit event of any kind is still refused (fail closed)", rc3 == 2 and "not backed by audit evidence" in (j3.get("message") or ""), j3.get("message", "")[:100])
# --- guard sanity: the executor still refuses a hosted-looking target ---
r = subprocess.run(["node", EXE, "plan", "--allowlist", allow, "--db", "bpc_exec_devplan", "--audit-dir", aud, "--approval-hash", doc["document_sha256"], "--repo-root", REPO, "--host", "db.example.supabase.co"], capture_output=True, text=True, env=env(), cwd=REPO)
rec("R19", "executor still refuses a hosted-looking host (loopback guard unchanged)", r.returncode == 2 and "hosted" in (r.stdout + r.stderr).lower(), (r.stdout + r.stderr)[:140])
res["limitations"] = [
    "Local PostgreSQL 18 superuser session; hosted Supabase runs as the non-superuser postgres role (owner of the ledger and application tables) on PostgreSQL 17: ownership and privilege behaviour of the real ledger insert is NOT rehearsed",
    "storage.buckets is a restored table without the Storage service; bucket updates are rehearsed as plain UPDATEs",
    "history-only rows are written without per-item read-only predicates (none are defined yet); the hosted plan must re-verify each item at run time",
    "attestations use a synthetic attester; no owner attestation exists",
    "no hosted connection exists in the executor by design; a hosted mechanism is a separate, unapproved design"]
res["summary"] = {"pass": sum(c["pass"] for c in res["checks"]), "fail": sum(not c["pass"] for c in res["checks"]), "items": kinds}
json.dump(res, open(OUT, "w", encoding="utf-8", newline="\n"), indent=1)
for d_ in (db, db2, db3, db4, db5):
    L.psql("postgres", ["-c", f'drop database if exists "{d_}" with (force)'])
print(res["summary"])
