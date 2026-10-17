"""Stage E2I: restore the protected Stage B Development schema-only dump into a DISPOSABLE LOCAL scratch database (bpc_replay_e2i_devbase) using the same allow-listed scaffolding as the Production restore
(D3/D4): unmodified dump, extensions, publications, Storage bucket rows and the captured history rows. Local PostgreSQL only (127.0.0.1:54329); nothing hosted; no real data (the dump is schema-only).
Also provides run_files(): apply repository migration files to a scratch database one transaction per file (analysis helper; this is NOT the executor and does not use its allowlist).
Usage: python -I e2i_dev_restore.py build"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402

BASE = "bpc_replay_e2i_devbase"


def build():
    man = json.load(open(os.path.join(L.PROT, "dev_manifest.json"), encoding="utf-8"))
    dump = os.path.join(L.PROT, "dev_schema_only.sql")
    assert L.sha(dump) == man["files"]["dev_schema_only.sql"]["sha256"], "Development dump hash mismatch"
    L.create_db(BASE)
    L.psql(BASE, ["-c", "create schema if not exists extensions"])
    for e in json.load(open(os.path.join(L.PROT, "dev_catalog_extensions.json"), encoding="utf-8")):
        if e["name"] in ("pgcrypto", "uuid-ossp", "pg_stat_statements"):
            assert L.psql(BASE, ["-v", "ON_ERROR_STOP=1", "-c", f'create extension "{e["name"]}" with schema "{e["schema"]}"']).returncode == 0
    r = L.psql(BASE, ["-v", "ON_ERROR_STOP=0", "-f", dump])
    errs = [ln for ln in r.stderr.split("\n") if "ERROR:" in ln]
    unexpected = [e for e in errs if 'schema "public" already exists' not in e]
    for p in json.load(open(os.path.join(L.PROT, "dev_catalog_publications.json"), encoding="utf-8")):
        L.psql(BASE, ["-v", "ON_ERROR_STOP=1", "-c", f'create publication "{p["name"]}"'])
        for t in p["tables"]:
            L.psql(BASE, ["-v", "ON_ERROR_STOP=1", "-c", f'alter publication "{p["name"]}" add table {t}'])
    for b in json.load(open(os.path.join(L.PROT, "dev_catalog_storage_buckets.json"), encoding="utf-8")):
        mt = "NULL" if b["allowed_mime_types"] is None else "ARRAY[" + ",".join("'" + m + "'" for m in b["allowed_mime_types"]) + "]::text[]"
        fs = "NULL" if b["file_size_limit"] is None else str(b["file_size_limit"])
        L.psql(BASE, ["-v", "ON_ERROR_STOP=1", "-c", f"insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('{b['id']}','{b['name']}',{str(b['public']).lower()},{fs},{mt})"])
    hist = json.load(open(os.path.join(L.PROT, "dev_catalog_history.json"), encoding="utf-8"))
    vals = ",".join("('%s','%s',ARRAY['-- E2I CAPTURED DEVELOPMENT HISTORY ROW'])" % (h["version"], h["name"].replace("'", "''")) for h in hist)
    assert L.psql(BASE, ["-v", "ON_ERROR_STOP=1"], text=f"insert into supabase_migrations.schema_migrations (version, name, statements) values {vals};").returncode == 0
    n = L.q(BASE, "select count(*) from supabase_migrations.schema_migrations")
    print("restored", BASE, "history rows", n, "unexpected restore errors:", len(unexpected))
    for e in unexpected[:8]:
        print("  ", e[:200])


def run_files(db, files, record=True):
    """Apply repository files (names under supabase/migrations) in the given order, one transaction per file, stop at the first failure. Returns (applied, failure)."""
    applied = []
    for fn in files:
        p = L.psql(db, ["-v", "ON_ERROR_STOP=1", "-1", "-f", os.path.join(L.MIG, fn)])
        if p.returncode != 0:
            return applied, {"file": fn, "error": L.err1(p.stderr), "context": " | ".join(x.strip() for x in p.stderr.split("\n") if x.startswith(("CONTEXT", "DETAIL")))[:300]}
        applied.append(fn)
    return applied, None


if __name__ == "__main__":
    build()
