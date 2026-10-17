"""Stage D4 shared library: local scratch databases, restored pre-upgrade Production template, the exact D3 67-migration runner and synthetic seeding helpers.
Local PostgreSQL only (127.0.0.1:54329; database names bpc_replay_*; ownership marker). No hosted system, no real data: every value is synthetic and tagged d4.
"""
import hashlib
import json
import os
import re
import subprocess

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
MIG = os.path.join(REPO, "supabase", "migrations")
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
D3 = r"C:\Users\vikki\migration-evidence\d3-scratch"
OUT = r"C:\Users\vikki\migration-evidence\d4-scratch"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
MARKER = "bpc-migration-replay-scratch:v1"
TEMPLATE = "bpc_replay_d4_template"
os.makedirs(OUT, exist_ok=True)


def psql(db, args=(), text=None):
    assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", db) or db == "postgres", db
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGCLIENTENCODING="UTF8")
    return subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-d", db, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, input=text)


def q(db, sql):
    r = psql(db, ["-At", "-v", "ON_ERROR_STOP=1", "-c", sql])
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:500])
    return r.stdout.strip()


def sql(db, text, stop=True):
    r = psql(db, ["-v", f"ON_ERROR_STOP={1 if stop else 0}"], text=text)
    return r


def err1(stderr):
    m = re.search(r"ERROR:\s+(.*)", stderr or "")
    return m.group(1).strip()[:300] if m else ""


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def uid(n, kind="00"):
    return f"d4{kind}0000-0000-4000-8000-{n:012d}"


# ---------------------------------------------------------------------------------------------------------------------------------------------
def create_db(name, template=None):
    assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", name) and "prod" not in name.replace("preupgrade", "")
    assert psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f'drop database if exists "{name}" with (force)']).returncode == 0
    t = f' template "{template}"' if template else ""
    r = psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f'create database "{name}"{t}'])
    assert r.returncode == 0, r.stderr
    psql("postgres", ["-c", f"comment on database \"{name}\" is '{MARKER}'"])
    psql("postgres", ["-c", f'alter database "{name}" set search_path = public, extensions'])


def build_template():
    """Restore the verified pre-upgrade Production schema (same procedure as D3: unmodified dump + allow-listed scaffolding)."""
    man = json.load(open(os.path.join(PROT, "prod_manifest.json"), encoding="utf-8"))
    dump = os.path.join(PROT, "prod_schema_only.sql")
    assert sha(dump) == man["files"]["prod_schema_only.sql"]["sha256"]
    create_db(TEMPLATE)
    # roles already exist from D3 (cluster-wide); extensions as in D3
    psql(TEMPLATE, ["-c", "create schema if not exists extensions"])
    for e in json.load(open(os.path.join(PROT, "prod_catalog_extensions.json"), encoding="utf-8")):
        if e["name"] in ("pgcrypto", "uuid-ossp", "pg_stat_statements"):
            assert psql(TEMPLATE, ["-v", "ON_ERROR_STOP=1", "-c", f'create extension "{e["name"]}" with schema "{e["schema"]}"']).returncode == 0
    r = psql(TEMPLATE, ["-v", "ON_ERROR_STOP=0", "-f", dump])
    errs = [ln for ln in r.stderr.split("\n") if "ERROR:" in ln]
    assert errs == [ln for ln in errs if 'schema "public" already exists' in ln], errs
    for p in json.load(open(os.path.join(PROT, "prod_catalog_publications.json"), encoding="utf-8")):
        psql(TEMPLATE, ["-v", "ON_ERROR_STOP=1", "-c", f'create publication "{p["name"]}"'])
        for t in p["tables"]:
            assert psql(TEMPLATE, ["-v", "ON_ERROR_STOP=1", "-c", f'alter publication "{p["name"]}" add table {t}']).returncode == 0
    for b in json.load(open(os.path.join(PROT, "prod_catalog_storage_buckets.json"), encoding="utf-8")):
        mt = "NULL" if b["allowed_mime_types"] is None else "ARRAY[" + ",".join("'" + m + "'" for m in b["allowed_mime_types"]) + "]::text[]"
        fs = "NULL" if b["file_size_limit"] is None else str(b["file_size_limit"])
        assert psql(TEMPLATE, ["-v", "ON_ERROR_STOP=1", "-c", f"insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('{b['id']}','{b['name']}',{str(b['public']).lower()},{fs},{mt})"]).returncode == 0
    hist = json.load(open(os.path.join(PROT, "prod_catalog_history.json"), encoding="utf-8"))
    vals = ",".join("('%s','%s',ARRAY['-- D4 CAPTURED HISTORY ROW'])" % (h["version"], h["name"].replace("'", "''")) for h in hist)
    assert psql(TEMPLATE, ["-v", "ON_ERROR_STOP=1"], text=f"insert into supabase_migrations.schema_migrations (version, name, statements) values {vals};").returncode == 0
    # simulated reconciliation rows, as in D3 (ledger only)
    man3 = json.load(open(os.path.join(D3, "d3-upgrade-manifest.json"), encoding="utf-8"))
    vals = ",".join("('%s','%s',ARRAY['-- D4 SIMULATED RECONCILIATION (local scratch only)'])" % (x["version"], x["file"][15:-4].replace("'", "''")) for x in man3["reconciliation_only_versions"])
    assert psql(TEMPLATE, ["-v", "ON_ERROR_STOP=1"], text=f"insert into supabase_migrations.schema_migrations (version, name, statements) values {vals};").returncode == 0


def clone(src, dst):
    create_db(dst, template=src)


def upgrade_manifest():
    return json.load(open(os.path.join(REPO, "audit", "evidence", "d3-selected-manifest.json"), encoding="utf-8"))["upgrade"]


def verify_upgrade_set():
    rows = upgrade_manifest()
    assert len(rows) == 67
    for r in rows:
        assert sha(os.path.join(MIG, r["file"])) == r["sha256"], r["file"]
    return rows


FPSQL = None


def fingerprint(db):
    global FPSQL
    if FPSQL is None:
        src = open(os.path.join(REPO, "audit", "evidence", "tools", "d3_upgrade.py"), encoding="utf-8").read()
        FPSQL = re.search(r'FP = """(.*?)"""', src, re.S).group(1)
    return json.loads(q(db, FPSQL))


def run_migrations(db, rows=None, stop_on_fail=True, record_history=True, until=None):
    """Run the exact D3 upgrade set (version order), one transaction per file. Returns per-migration results."""
    rows = rows or verify_upgrade_set()
    results = []
    for row in rows:
        if until and row["version"] > until:
            break
        p = psql(db, ["-v", "ON_ERROR_STOP=1", "-1", "-f", os.path.join(MIG, row["file"])])
        res = {"version": row["version"], "file": row["file"], "group": row["group"], "status": "applied" if p.returncode == 0 else "FAILED"}
        if p.returncode != 0:
            res["error"] = err1(p.stderr)
            res["error_line"] = (re.search(r":(\d+): ERROR", p.stderr) or [None, None])[1]
            res["context"] = " | ".join(ln.strip() for ln in p.stderr.split("\n") if ln.startswith(("CONTEXT", "DETAIL")))[:300]
            results.append(res)
            if stop_on_fail:
                break
            continue
        if record_history:
            q(db, "insert into supabase_migrations.schema_migrations (version,name,statements) values ('%s','%s',ARRAY['-- D4 EXECUTED LOCALLY; sha256 %s'])" % (row["version"], row["file"][15:-4].replace("'", "''"), row["sha256"]))
        results.append(res)
    return results


# ---------------------------------------------------------------------------------------------------------------------------------------------
def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return "ARRAY[" + ",".join(lit(x) for x in v) + "]"
    return "'" + str(v).replace("'", "''") + "'"


def ins(table, **kw):
    cols = ", ".join(f'"{k}"' for k in kw)
    vals = ", ".join(lit(v) for v in kw.values())
    return f"insert into {table} ({cols}) values ({vals});"
