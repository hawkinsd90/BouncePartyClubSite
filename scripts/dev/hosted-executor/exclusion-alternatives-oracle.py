"""Step 4A.4: which supported mechanisms keep the Supabase CLI from executing an unsafe migration file? Local scratch PostgreSQL only (127.0.0.1:54329, throwaway database bpc_sim_alt44, throwaway project folder). No hosted contact, no repository file is read or changed. Output: audit/step4/exclusion-alternatives-oracle.json (captured by redirecting stdout)."""
import os, subprocess, shutil, json, re, tempfile
env = {**os.environ, "PGSSLMODE": "disable", "PGPASSWORD": "postgres"}
HOST = ["-h", "127.0.0.1", "-p", "54329", "-U", "postgres"]
DB = "bpc_sim_alt44"
URL = "postgresql://postgres:postgres@127.0.0.1:54329/" + DB
def psql(sql, db=DB):
    r = subprocess.run(["psql", *HOST, "-d", db, "-Atc", sql], capture_output=True, text=True, encoding="utf-8", env=env)
    return r.stdout.strip() + r.stderr.strip()
def cli(work, *args):
    r = subprocess.run(["supabase", *args, "--db-url", URL], cwd=work, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    return r.stdout + r.stderr
psql("drop database if exists %s with (force)" % DB, "postgres")
psql("create database %s" % DB, "postgres")
work = tempfile.mkdtemp(prefix="alt44_", dir=os.path.join(os.environ["LOCALAPPDATA"], "Temp"))
mig = os.path.join(work, "supabase", "migrations")
os.makedirs(mig)
open(os.path.join(work, "supabase", "config.toml"), "w").write('project_id = "alt44"\n')
def w(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(s + chr(10))
w(os.path.join(mig, "20260101000000_base.sql"), "create table t1(id int);")
w(os.path.join(mig, "20260102000000_unsafe.sql"), "create table must_not_exist(id int);")
w(os.path.join(mig, "20260103000000_good.sql"), "create table t3(id int);")
out = {}
# E1: unsafe file in a subdirectory of migrations/
os.makedirs(os.path.join(mig, "archive"))
shutil.move(os.path.join(mig, "20260102000000_unsafe.sql"), os.path.join(mig, "archive", "20260102000000_unsafe.sql"))
o = cli(work, "db", "push", "--dry-run", "--include-all")
out["E1_subdirectory"] = {"pending": re.findall(r"(\d{14})_", o), "text": o.strip().splitlines()[-4:]}
# E2: file renamed so it does not match the pattern
shutil.move(os.path.join(mig, "archive", "20260102000000_unsafe.sql"), os.path.join(mig, "20260102000000_unsafe.sql.notmigration"))
o = cli(work, "db", "push", "--dry-run", "--include-all")
out["E2_renamed_extension"] = {"pending": re.findall(r"(\d{14})_", o), "raw": [l for l in o.splitlines() if "20260102" in l]}
# E3: migration repair --status applied on the unsafe version (file restored)
shutil.move(os.path.join(mig, "20260102000000_unsafe.sql.notmigration"), os.path.join(mig, "20260102000000_unsafe.sql"))
o = cli(work, "migration", "repair", "--status", "applied", "20260102000000")
out["E3_repair_applied"] = {"cli": o.strip().splitlines()[-2:], "row": psql("select version||'|'||coalesce(name,'<null>')||'|'||coalesce(array_length(statements,1)::text,'<null>') from supabase_migrations.schema_migrations where version='20260102000000'"), "table_exists": psql("select to_regclass('must_not_exist')"), "recorded_statement": psql("select statements[1] from supabase_migrations.schema_migrations where version='20260102000000'")}
o = cli(work, "db", "push", "--dry-run", "--include-all")
out["E3_after_repair_dry_run"] = {"pending": re.findall(r"(\d{14})_", o)}
# E4: repair --status reverted removes the row (rewrites history)
o = cli(work, "migration", "repair", "--status", "reverted", "20260102000000")
out["E4_repair_reverted"] = {"row_count": psql("select count(*) from supabase_migrations.schema_migrations where version='20260102000000'")}
# E5: honest marker row written directly (what the plan proposes)
psql("insert into supabase_migrations.schema_migrations(version,name,statements) values ('20260102000000','unsafe',ARRAY['-- NOT EXECUTED attestation marker'])")
o = cli(work, "db", "push", "--dry-run", "--include-all")
out["E5_marker_row"] = {"pending": re.findall(r"(\d{14})_", o), "text": o.strip().splitlines()[-2:]}
psql("drop database %s with (force)" % DB, "postgres")
shutil.rmtree(work, ignore_errors=True)
print(json.dumps(out, indent=1))
