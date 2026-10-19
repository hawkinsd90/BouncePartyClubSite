"""Standard-tooling oracle (Step 4A.3): what does the real Supabase CLI (`supabase db push --dry-run --include-all`) think of our migration files and ledger?

LOCAL SCRATCH POSTGRESQL ONLY. The CLI is pointed at a disposable local database named bpc_sim_* on 127.0.0.1; a dry run never writes, and this script writes ledger rows only
into that scratch database. Nothing hosted is contacted and no credential is used. The `supabase/` directory is copied into a throwaway project folder, so the repository is never touched.

It answers, with the real tool instead of an opinion: (1) why the Supabase GitHub integration fails today, (2) what a standard push would execute if the history were
reconciled exactly as approved in Step 2 (including files that must never run), (3) which files remain pending, (4) whether ordinary future migrations then work.

Usage: python -I scripts/dev/hosted-executor/cli-oracle.py --template bpc_replay_e2i_devbase --db bpc_sim_cli --work C:\\path\\to\\throwaway --out audit/step4/cli-oracle-results.json
"""
import argparse, collections, csv, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PSQL = os.environ.get("BPC_PSQL", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")
ap = argparse.ArgumentParser()
ap.add_argument("--template", required=True); ap.add_argument("--db", required=True); ap.add_argument("--work", required=True); ap.add_argument("--out", required=True)
a = ap.parse_args()
if not re.match(r"^bpc_sim_[a-z0-9_]{1,30}$", a.db) or not re.match(r"^bpc_replay_[a-z0-9_]+$", a.template):
    sys.exit("refused: database must be bpc_sim_*, template bpc_replay_* (local scratch only)")
env = {**os.environ, "PGSSLMODE": "disable"}
for k in list(env):
    if k.upper().startswith(("SUPABASE_", "DATABASE_URL")) or k.upper() in ("PGPASSWORD", "PGHOST"): env.pop(k)
URL = f"postgresql://postgres@127.0.0.1:54329/{a.db}?sslmode=disable"


def psql(sql, db=None):
    r = subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", db or a.db, "-c", sql], capture_output=True, text=True, encoding="utf-8")
    if r.returncode: sys.exit(r.stderr)
    return r.stdout.strip()


def cli(*args):
    r = subprocess.run(["supabase", *args, "--db-url", URL], cwd=a.work, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    return r.stdout + r.stderr


def dry(include_all=True):
    out = cli("db", "push", "--dry-run", *(["--include-all"] if include_all else []))
    return out, re.findall(chr(0x2022) + r"\s*(\d{14})_", out)


# ---- classify every repository migration file from the committed Step 2 plan
mig_repo = os.path.join(REPO, "supabase", "migrations")
files = {re.match(r"(\d+)_", f).group(1): f for f in sorted(os.listdir(mig_repo)) if re.match(r"^\d+_.+\.sql$", f)}
ledger0 = [l.strip() for l in open(os.path.join(REPO, "audit", "evidence", "derived", "dev-ledger-versions.txt"), encoding="utf-8") if l.strip()]
man = {r["version"]: r for r in csv.DictReader(open(os.path.join(REPO, "audit", "development-migration-manifest.csv"), encoding="utf-8", newline=""))}
ex = {r["version"]: r for r in csv.DictReader(open(os.path.join(REPO, "audit", "development-execution-manifest.csv"), encoding="utf-8", newline=""))}
deny = json.load(open(os.path.join(REPO, "audit", "development-execution-deny.json"), encoding="utf-8"))
blocked, excl = set(deny["blocked_no_safe_rule"]["versions"]), set(deny["excluded_pending_owner"]["versions"])
ALIAS_VERSION, ALIAS_FILE = "20260814002658", "20260814120000"
cat = {}
for v in files:
    d = man[v]["proposed_disposition"]; bc = ex[v]["batch_class"] if v in ex else ""
    if v in ledger0: c = "recorded"
    elif v == ALIAS_FILE: c = "alias-covered"
    elif v in blocked: c = "blocked"
    elif v in excl: c = "excluded"
    elif bc.startswith("attestation (WEAK"): c = "weak-attestation"
    elif bc.startswith("SQL"): c = "bucket-sql"
    elif bc.startswith("attestation") or d.startswith("Qualified"): c = "attestation"
    elif bc.startswith("history-only") or d.startswith("Evidence-backed"): c = "history-only"
    elif v >= "20261007120000": c = "executor-28"
    elif d.startswith("Withheld"): c = "withheld-17"
    else: sys.exit("unclassified " + v + " " + d)
    cat[v] = c
counts = collections.Counter(cat.values())

# ---- throwaway project
shutil.rmtree(a.work, ignore_errors=True)
os.makedirs(os.path.join(a.work, "supabase"))
shutil.copytree(mig_repo, os.path.join(a.work, "supabase", "migrations"))
shutil.copy(os.path.join(REPO, "supabase", "config.toml"), os.path.join(a.work, "supabase", "config.toml"))
subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-At", "-d", "postgres", "-c", f"drop database if exists {a.db} with (force)", "-c", f'create database {a.db} template {a.template}'], check=True, capture_output=True)
if int(psql("select count(*) from supabase_migrations.schema_migrations")) != 58:
    sys.exit("template must carry the 58-row Development ledger")


def record(vs, kind):
    rows = []
    for v in vs:
        name = re.sub(r"\.sql(\.sql)?$", "", files[v][15:]).replace("'", "''")
        rows.append("('%s','%s',ARRAY['-- BPC-SIM %s; version=%s'])" % (v, name, kind, v))
    if rows: psql("insert into supabase_migrations.schema_migrations (version,name,statements) values " + ",".join(rows))


by = lambda *k: sorted(v for v, c in cat.items() if c in k)
steps = []
def step(label, out, pending, **extra):
    first = next((l.strip() for l in out.splitlines() if l.strip() and not l.startswith(("DRY RUN", "Connecting", "A new version", "We recommend"))), "")
    steps.append({"step": label, "first_message": first[:140], "pending_count": len(pending), "pending_never_run": sorted(v for v in pending if cat.get(v) in ("blocked", "excluded", "weak-attestation")), **extra})
    print("==", label, "->", first[:80], "| pending:", len(pending))

out, p = dry(); step("A. today: 58-row ledger vs the repository files", out, p, remote_only_versions=re.findall(r"repair --status reverted (\d{14})", out))
alias_path = os.path.join(a.work, "supabase", "migrations", f"{ALIAS_VERSION}_ledger_alias_of_{ALIAS_FILE}_create_contact_inquiries.sql")
open(alias_path, "w", encoding="utf-8").write("-- Ledger alias: this version is already recorded on Development for 20260814120000_create_contact_inquiries.sql.\n-- Intentionally contains no SQL.\n")
files[ALIAS_VERSION] = os.path.basename(alias_path)
out, p = dry(); step("B. + a comment-only alias file for the remote-only version: a standard push would now run every unrecorded file", out, p, would_rerun_alias_covered_file=ALIAS_FILE in p)
record([ALIAS_FILE], "history-only NOT EXECUTED (recorded as alias %s)" % ALIAS_VERSION)
record(by("history-only"), "history-only NOT EXECUTED"); record(by("attestation"), "attestation NOT EXECUTED"); record(by("bucket-sql"), "executed")
out, p = dry(); step("C. + Step 2 bookkeeping rows (history-only, owner-signed attestations, 2 bucket updates, alias-covered file)", out, p)
record(by("executor-28"), "executed")
out, p = dry(); step("D. + the 28 executor files", out, p)
record(by("withheld-17"), "history-only NOT EXECUTED")
out, p = dry(); step("E. + the 17 withheld versions recorded after October", out, p, remaining_equals_unrecordable_set=sorted(p) == by("blocked", "excluded", "weak-attestation"))
record(by("blocked", "excluded", "weak-attestation"), "attestation NOT EXECUTED")
out, p = dry(); step("F. + attestations for the remaining 13 (SIMULATION of a decision that has NOT been made)", out, p)
open(os.path.join(a.work, "supabase", "migrations", "20261101120000_future_test_migration.sql"), "w", encoding="utf-8").write("select 1;\n")
out, p = dry(); step("G. a new future migration file", out, p, only_future_file=p == ["20261101120000"])
# ---- real (non-dry-run) pushes into the SCRATCH database: the ordinary path, observed end to end
def applied(out): return re.findall(r"Applying migration (\d{14})_", out)
def row(v): return psql("select version || '|' || name || '|' || coalesce(array_length(statements,1)::text,'0') from supabase_migrations.schema_migrations where version = '%s'" % v)
before = int(psql("select count(*) from supabase_migrations.schema_migrations"))
out = cli("db", "push", "--include-all", "--yes")
real1 = {"step": "I. REAL push (scratch database): the future file", "applied": applied(out), "ledger_delta": int(psql("select count(*) from supabase_migrations.schema_migrations")) - before, "ledger_row": row("20261101120000"), "message": next((l.strip() for l in out.splitlines() if "Finished" in l), "")}
steps.append(real1); print("== I ->", real1["applied"], real1["ledger_delta"], real1["ledger_row"])
out, p2 = dry(); step("I2. dry run after the real push", out, p2)
base = os.path.join(a.work, "supabase", "migrations")
open(os.path.join(base, "20261103120000_future_second.sql"), "w", encoding="utf-8").write("select 3;"+chr(10))
open(os.path.join(base, "20261102120000_future_first.sql"), "w", encoding="utf-8").write("select 2;"+chr(10))
out = cli("db", "push", "--include-all", "--yes")
real2 = {"step": "J. REAL push: two new files created in reverse order", "applied": applied(out)}
steps.append(real2); print("== J ->", real2["applied"])
# a failing migration: nothing of it is recorded and later files are not applied
open(os.path.join(base, "20261104120000_future_bad.sql"), "w", encoding="utf-8").write("select * from table_that_does_not_exist;"+chr(10))
open(os.path.join(base, "20261105120000_future_after_bad.sql"), "w", encoding="utf-8").write("select 5;"+chr(10))
n0 = int(psql("select count(*) from supabase_migrations.schema_migrations"))
out = cli("db", "push", "--include-all", "--yes")
real3 = {"step": "K. REAL push with a failing file followed by a good one", "applied_before_failure": applied(out), "ledger_delta": int(psql("select count(*) from supabase_migrations.schema_migrations")) - n0, "bad_recorded": psql("select count(*) from supabase_migrations.schema_migrations where version in ('20261104120000','20261105120000')"), "error_shown": "does not exist" in out}
steps.append(real3); print("== K ->", real3)
os.remove(os.path.join(base, "20261104120000_future_bad.sql")); os.remove(os.path.join(base, "20261105120000_future_after_bad.sql"))
psql("delete from supabase_migrations.schema_migrations where version = '20260305222010'")
out2, _ = dry(include_all=False)
steps.append({"step": "H. one older unrecorded file without --include-all", "first_message": " | ".join(l.strip() for l in out2.splitlines() if "Found local migration" in l or "Rerun" in l)[:200], "pending_count": None, "pending_never_run": []})
print("== H ->", steps[-1]["first_message"][:100])
res = {"generated_by": "scripts/dev/hosted-executor/cli-oracle.py", "local_only": True, "cli_version": (subprocess.run(["supabase", "--version"], capture_output=True, text=True).stdout.strip()),
       "repository_files": len(files) - 1, "category_counts": dict(counts), "unrecordable_under_current_approvals": by("blocked", "excluded", "weak-attestation"), "steps": steps}
json.dump(res, open(a.out, "w", encoding="utf-8", newline="\n"), indent=1)
shutil.rmtree(a.work, ignore_errors=True)
print("wrote", a.out)
