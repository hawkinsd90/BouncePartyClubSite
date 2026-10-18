"""Step 3B: build Production-shaped and Development-shaped LOCAL scratch databases for the security posture test.
Local PostgreSQL only (127.0.0.1:54329); database names bpc_replay_*; no hosted system is contacted; no real data (the Stage B dumps are schema-only; one synthetic auth user is
inserted because 20261016120000 refuses to run on an empty auth.users).
Prerequisites (protected, outside Git): the Stage B captures in the migration-evidence folder (see step2_paths.py / d3_restore.py PROT) and the two restored bases:
    python -I d3_restore.py            -> bpc_replay_d3_snapshot  (Production schema, 277-row ledger)
    python -I e2i_dev_restore.py build -> bpc_replay_e2i_devbase  (Development schema, 58-row ledger)
Usage: python -I step3b_shapes.py prod|dev
  prod  bpc_replay_prodpre   = Production snapshot + the 67 upgrade files (before Step 3B)       bpc_replay_prodshape = + the Step 3B files
  dev   bpc_replay_devpre4   = Development snapshot + the 2 bucket-limit files + the 23 October files + the containment end-state script (before Step 3B)
        bpc_replay_devshape  = the same + the Step 3B files
Each file runs unchanged in its own transaction in version order; the first failure stops the build."""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MIG = os.path.join(REPO, "supabase", "migrations")
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
S3B_FROM = "20261026000000"
OCT_FROM = "20261007000000"
SEED = ("ALTER TABLE auth.users DISABLE TRIGGER USER; INSERT INTO auth.users (id, email) VALUES ('d4d4d4d4-0000-4000-8000-000000000001', 'synthetic-seed@example.test') "
        "ON CONFLICT DO NOTHING; ALTER TABLE auth.users ENABLE TRIGGER USER;")


def psql(db, args, text=None):
    assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", db) or db == "postgres", db
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGCLIENTENCODING="UTF8")
    return subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-d", db, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, input=text)


def clone(src, dst):
    assert psql("postgres", ["-At", "-c", f'drop database if exists "{dst}" with (force)']).returncode == 0
    r = psql("postgres", ["-At", "-c", f'create database "{dst}" template "{src}"'])
    assert r.returncode == 0, r.stderr
    r = psql(dst, ["-v", "ON_ERROR_STOP=1"], text=SEED)
    assert r.returncode == 0, r.stderr
    seed_pricing_rule(dst)


def seed_pricing_rule(db):
    """The Stage B dumps are schema-only, so pricing_rules is empty and the public-quote scenarios would read no row. Copy the repository chain's
    single synthetic seed row (bpc_replay_full) when that scratch database exists; otherwise leave the table empty."""
    pg_dump = os.path.join(os.path.dirname(PSQL), "pg_dump.exe")
    r = subprocess.run([pg_dump, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", "bpc_replay_full", "--data-only", "--column-inserts", "-t", "public.pricing_rules"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode == 0 and "INSERT INTO" in r.stdout:
        psql(db, ["-v", "ON_ERROR_STOP=1"], text="SET session_replication_role = replica; " + r.stdout)


files = {f[:14]: f for f in sorted(os.listdir(MIG)) if re.match(r"^\d{14}_.+\.sql", f)}


def apply(db, version):
    r = psql(db, ["-v", "ON_ERROR_STOP=1", "--single-transaction"], text=open(os.path.join(MIG, files[version]), encoding="utf-8").read())
    if r.returncode != 0:
        raise SystemExit(f"FAILED {version} {files[version]}: {[l for l in r.stderr.splitlines() if 'ERROR' in l][:2]}")


def prod():
    prod_hist = {x["version"] for x in json.load(open(os.path.join(PROT, "prod_catalog_history.json"), encoding="utf-8"))}
    pending = sorted(set(files) - prod_hist)
    first = min(prod_hist)
    baseline = [v for v in pending if v < first]
    aliases = json.load(open(os.path.join(REPO, "audit", "evidence", "version-aliases.json"), encoding="utf-8"))
    alias_local = [a["local_version"] for a in aliases["aliases"] if a["env"] == "prod"]
    upgrade = [v for v in pending if v not in baseline and v not in alias_local]
    base = [v for v in upgrade if v < S3B_FROM]
    step3b = [v for v in upgrade if v >= S3B_FROM]
    assert len(base) == 67, len(base)
    clone("bpc_replay_d3_snapshot", "bpc_replay_prodpre")
    for v in base:
        apply("bpc_replay_prodpre", v)
    clone("bpc_replay_prodpre", "bpc_replay_prodshape")
    for v in step3b:
        apply("bpc_replay_prodshape", v)
    print(f"bpc_replay_prodpre ({len(base)} files) and bpc_replay_prodshape (+{len(step3b)} Step 3B files) built")


def dev():
    sql2 = ["20260325231044", "20260517221038"]
    october = sorted(v for v in files if OCT_FROM <= v < S3B_FROM)
    step3b = sorted(v for v in files if v >= S3B_FROM)
    assert len(october) == 23, len(october)
    end_state = open(os.path.join(REPO, "audit", "security", "step4-development-containment-end-state.sql"), encoding="utf-8").read()
    clone("bpc_replay_e2i_devbase", "bpc_replay_devpre4")
    for v in sql2 + october:
        apply("bpc_replay_devpre4", v)
    r = psql("bpc_replay_devpre4", ["-v", "ON_ERROR_STOP=1"], text=end_state)
    assert r.returncode == 0, r.stderr
    clone("bpc_replay_devpre4", "bpc_replay_devshape")
    for v in step3b:
        apply("bpc_replay_devshape", v)
    print(f"bpc_replay_devpre4 ({len(sql2) + len(october)} files + end-state script) and bpc_replay_devshape (+{len(step3b)} Step 3B files) built")


if __name__ == "__main__":
    {"prod": prod, "dev": dev}[sys.argv[1]]()
