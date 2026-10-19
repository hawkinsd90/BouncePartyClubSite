"""Step 4A.6: can the repository's migration history initialize a NEW database with the real Supabase CLI, and what does a compatibility
layer or a ledger marker change?

Local scratch PostgreSQL only (127.0.0.1:54329). Databases are created by scripts/dev/migration-replay.cjs (names bpc_replay_*), the
Supabase CLI runs in a throwaway project folder that holds COPIES of the migration files, and no repository file is read for writing.
The only change made to the copied files is that the one stub-limited file (20260323201502, needs the pg_net extension that a plain
PostgreSQL cannot install; real Supabase has it) is left out, and, in scenario F3 only, two additive example files are added.
No hosted system and no credential is contacted or used. Synthetic data only (the migrations' own seed rows).

  python -I scripts/dev/hosted-executor/fresh-database-oracle.py --out audit/step4/fresh-database-oracle-results.json
"""
import argparse, json, os, re, shutil, subprocess, tempfile

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
a = ap.parse_args()

REPO = os.getcwd()
HOST = ["-h", "127.0.0.1", "-p", "54329", "-U", "postgres"]
ENV = {**os.environ, "PGSSLMODE": "disable", "PGPASSWORD": "postgres", "BPC_REPLAY_CONFIRM_LOCAL": "yes"}
STUB_LIMITED = "20260323201502"
OLD = os.path.join(REPO, "supabase", "migrations")

def psql(db, sql):
    r = subprocess.run(["psql", *HOST, "-d", db, "-Atc", sql], capture_output=True, text=True, encoding="utf-8", env=ENV)
    return (r.stdout + r.stderr).strip()

def make_stub(db):
    r = subprocess.run(["node", "scripts/dev/migration-replay.cjs", "--db", db, "--mode", "strict", "--upto", "20000101000000"],
                       capture_output=True, text=True, encoding="utf-8", env=ENV, cwd=REPO)
    ok = "files replayed: 0" in r.stdout
    if not ok:
        raise SystemExit("stub bootstrap failed: " + (r.stdout + r.stderr)[-400:])

def cli(work, db, *args):
    url = "postgresql://postgres:postgres@127.0.0.1:54329/" + db
    r = subprocess.run(["supabase", *args, "--db-url", url], cwd=work, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV)
    return r.stdout + r.stderr

def project(name, drop_stub_limited=True, extra=None):
    work = tempfile.mkdtemp(prefix=name + "_", dir=os.path.join(os.environ["LOCALAPPDATA"], "Temp"))
    mig = os.path.join(work, "supabase", "migrations")
    os.makedirs(mig)
    shutil.copy(os.path.join(REPO, "supabase", "config.toml"), os.path.join(work, "supabase", "config.toml"))
    for f in os.listdir(OLD):
        if not f.endswith(".sql"):
            continue
        if drop_stub_limited and f.startswith(STUB_LIMITED + "_"):
            continue
        shutil.copy(os.path.join(OLD, f), os.path.join(mig, f))
    for fn, body in (extra or {}).items():
        open(os.path.join(mig, fn), "w", encoding="utf-8").write(body + chr(10))
    return work, mig

def applied(out):
    return re.findall(r"Applying migration (\d{14})_", out)

def pending(out):
    return re.findall(r"^ . (\d{14})_", out, flags=re.M)

def drop(db):
    subprocess.run(["psql", *HOST, "-d", "postgres", "-Atc", "drop database if exists %s with (force)" % db], capture_output=True, env=ENV)

ADD_S1 = ("-- ADDITIVE COMPATIBILITY EXAMPLE (scenario F3 only; not in the repository). Idempotent: drops the legacy upper-case-only role check "
          "that Production and Development no longer have, so that a database built from the files does not stop at 20260324175546." + chr(10) +
          "alter table public.user_roles drop constraint if exists user_roles_role_check;")
ADD_S2 = ("-- ADDITIVE COMPATIBILITY EXAMPLE (scenario F3 only; not in the repository). Idempotent: removes orders from the realtime publication " + chr(10) +
          "-- only when it is already a member, because 20260615175816 adds it without a guard." + chr(10) +
          "do $$ begin if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then " +
          "alter publication supabase_realtime drop table public.orders; end if; end $$;")
S1_FILE = "20251207163823_compat_drop_legacy_user_roles_check.sql"
S2_FILE = "20260615175815_compat_drop_orders_from_realtime_before_add.sql"

res = {"generated_by": "scripts/dev/hosted-executor/fresh-database-oracle.py", "local_only": True,
       "cli_version": subprocess.run(["supabase", "--version"], capture_output=True, text=True).stdout.strip(),
       "files_in_repository": len([f for f in os.listdir(OLD) if f.endswith(".sql")]), "scenarios": {}}

# F1: the repository as it is, real CLI, fresh database (pg_net file left out of the throwaway copy only)
db = "bpc_replay_fresh46a"; drop(db); make_stub(db)
work, mig = project("fresh46a")
out = cli(work, db, "db", "push")
ap1 = applied(out)
err = [l.strip() for l in out.splitlines() if "ERROR" in l or "At statement" in l][:3]
res["scenarios"]["F1_repository_as_is"] = {"applied_before_stop": len(ap1), "last_applied": ap1[-1] if ap1 else None,
    "ledger_rows": int(psql(db, "select count(*) from supabase_migrations.schema_migrations")), "error_lines": err,
    "failing_file": next(iter(re.findall(r"Applying migration (\d{14})_[^\n]*\n[^\n]*ERROR", out)), None)}
# the version that failed is the one after the last recorded
rows = psql(db, "select max(version) from supabase_migrations.schema_migrations")
res["scenarios"]["F1_repository_as_is"]["max_recorded_version"] = rows
nxt = sorted(f for f in os.listdir(mig) if f.endswith(".sql") and f[:14] > rows)[:1]
res["scenarios"]["F1_repository_as_is"]["first_unapplied_file"] = nxt[0] if nxt else None
shutil.rmtree(work, ignore_errors=True); drop(db)

# F3: additive compatibility files at intermediate versions, fresh database
db = "bpc_replay_fresh46b"; drop(db); make_stub(db)
work, mig = project("fresh46b", extra={S1_FILE: ADD_S1, S2_FILE: ADD_S2})
out = cli(work, db, "db", "push")
ap3 = applied(out)
total = len([f for f in os.listdir(mig) if f.endswith(".sql")])
r3 = {"files_pushed": total, "applied": len(ap3), "completed": "Finished supabase db push" in out,
      "ledger_rows": int(psql(db, "select count(*) from supabase_migrations.schema_migrations")),
      "dry_run_after": next((l.strip() for l in cli(work, db, "db", "push", "--dry-run").splitlines() if "up to date" in l), ""),
      "units_after_fresh_build": psql(db, "select count(*) from units"), "seed_units": psql(db, "select count(*) from units where slug in ('tropical-bounce-house','castle-combo')")}
# a normal future migration afterwards
open(os.path.join(mig, "20261201120000_future_synthetic.sql"), "w", encoding="utf-8").write("select 1;" + chr(10))
o2 = cli(work, db, "db", "push")
r3["future_file_applied"] = applied(o2)
# existing-database view: the two compatibility rows are missing from a ledger that is otherwise at the head
psql(db, "delete from supabase_migrations.schema_migrations where version in ('%s','%s')" % (S1_FILE[:14], S2_FILE[:14]))
o3 = cli(work, db, "db", "push", "--dry-run")
r3["existing_db_without_compat_rows_no_flag"] = [l.strip() for l in o3.splitlines() if "include-all" in l or "before the last" in l][:2]
o4 = cli(work, db, "db", "push", "--dry-run", "--include-all")
r3["existing_db_without_compat_rows_include_all_pending"] = sorted(set(re.findall(r"(\d{14})_compat", o4)))
res["scenarios"]["F3_additive_compat_files"] = r3
shutil.rmtree(work, ignore_errors=True); drop(db)

with open(a.out, "w", encoding="utf-8") as fh:
    json.dump(res, fh, indent=1)
print(json.dumps(res, indent=1))
