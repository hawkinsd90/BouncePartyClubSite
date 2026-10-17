"""Stage D3, step 1: restore the Production schema-only dump into a disposable local scratch database and scaffold the platform pieces the
dump does not contain. The original Production export is NOT edited: it is replayed byte-for-byte (SHA-256 verified before and after).
Allow-listed adaptations (all recorded in the report):
  A1 platform roles are created as NOLOGIN stubs with the captured attributes (never superuser; no password; no login) and captured memberships;
  A2 schema `extensions` plus the extensions Production has that plain PostgreSQL ships (pgcrypto, uuid-ossp, pg_stat_statements);
     pg_net and supabase_vault are NOT available and are not faked;
  A3 publications supabase_realtime and supabase_realtime_messages_publication (the dump has no publications) rebuilt from the captured membership;
  A4 storage.buckets rows (configuration, not customer data) seeded from the captured bucket list (the dump is schema-only);
  A5 supabase_migrations.schema_migrations rows seeded from the captured history (version + name only; statements carry a provenance marker).
Local PostgreSQL only (127.0.0.1:54329), database name bpc_replay_*, ownership marker comment. Usage: python -I d3_restore.py
"""
import hashlib
import json
import os
import re
import subprocess

PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\d3-scratch"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
DB = "bpc_replay_d3_snapshot"
MARKER = "bpc-migration-replay-scratch:v1"
DUMP = os.path.join(PROT, "prod_schema_only.sql")
assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", DB) and "prod" not in DB.replace("snapshot", "")


def psql(db, args, text=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGCLIENTENCODING="UTF8")
    return subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-d", db, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, input=text)


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def q(sql, db=DB):
    r = psql(db, ["-At", "-v", "ON_ERROR_STOP=1", "-c", sql])
    assert r.returncode == 0, r.stderr[:400]
    return r.stdout.strip()


def jl(name):
    return json.load(open(os.path.join(PROT, name), encoding="utf-8"))


def main():
    os.makedirs(OUT, exist_ok=True)
    rep = {"dump": DUMP, "dump_sha256_before": sha(DUMP), "adaptations": {}}
    man = jl("prod_manifest.json")
    assert rep["dump_sha256_before"] == man["files"]["prod_schema_only.sql"]["sha256"], "dump does not match its manifest"
    # database creation with the same guard rules as the replay tool (naming, loopback, marker)
    ex = psql("postgres", ["-At", "-c", f"select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname='{DB}'"]).stdout.strip()
    row = psql("postgres", ["-At", "-c", f"select count(*) from pg_database where datname='{DB}'"]).stdout.strip()
    assert row == "0" or ex == MARKER, "database exists and was not created by this tooling"
    for sql in (f'drop database if exists "{DB}" with (force)', f'create database "{DB}"', f"comment on database \"{DB}\" is '{MARKER}'", f'alter database "{DB}" set search_path = public, extensions'):
        assert psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", sql]).returncode == 0, sql
    # A1 roles
    roles = jl("prod_catalog_roles.json")
    created, normalized = [], []
    existing = set(psql("postgres", ["-At", "-c", "select rolname from pg_roles"]).stdout.split())
    for r in roles:
        n = r["name"]
        if n in ("postgres", "cli_login_postgres"):
            continue
        attrs = ["NOLOGIN", "NOSUPERUSER"] + [("CREATEROLE" if r["rolcreaterole"] else "NOCREATEROLE"), ("CREATEDB" if r["rolcreatedb"] else "NOCREATEDB"), ("REPLICATION" if r["rolreplication"] else "NOREPLICATION"), ("BYPASSRLS" if r["rolbypassrls"] else "NOBYPASSRLS"), ("INHERIT" if r["rolinherit"] else "NOINHERIT")]
        if n in existing:  # roles are cluster-wide; a role left by an earlier scratch run or by the replay tool's stub is normalised to the captured attributes
            assert psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f'alter role "{n}" {" ".join(attrs)}']).returncode == 0, n
            normalized.append(n)
        else:
            assert psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f'create role "{n}" {" ".join(attrs)}']).returncode == 0, n
            created.append(n)
    for r in roles:
        for b in (r["member_of"] or []):
            if r["name"] not in ("postgres", "cli_login_postgres") and not b.startswith("pg_") and b != "postgres":
                psql("postgres", ["-c", f'grant "{b}" to "{r["name"]}"'])
    rep["adaptations"]["A1_roles_created_nologin"] = created
    rep["adaptations"]["A1_roles_already_present_attributes_normalised_nologin"] = normalized
    rep["adaptations"]["A1_roles_not_created"] = {"postgres": "local superuser used instead", "cli_login_postgres": "temporary hosted login role; not needed and not recreated"}
    # A2 extensions
    q("create schema if not exists extensions")
    ext_ok, ext_missing = [], []
    for e in jl("prod_catalog_extensions.json"):
        if e["name"] == "plpgsql":
            continue
        avail = psql("postgres", ["-At", "-c", f"select count(*) from pg_available_extensions where name='{e['name']}'"]).stdout.strip() == "1"
        if avail:
            assert psql(DB, ["-v", "ON_ERROR_STOP=1", "-c", f'create extension "{e["name"]}" with schema "{e["schema"]}"']).returncode == 0
            ext_ok.append(f"{e['name']} (prod {e['version']})")
        else:
            ext_missing.append(f"{e['name']} {e['version']} (schema {e['schema']})")
    rep["adaptations"]["A2_extensions_created"] = ext_ok
    rep["adaptations"]["A2_extensions_unavailable_not_faked"] = ext_missing
    # the original dump, unmodified
    r = psql(DB, ["-v", "ON_ERROR_STOP=0", "-f", DUMP])
    errs = [ln for ln in r.stderr.split("\n") if "ERROR:" in ln]
    rep["restore_errors"] = [re.sub(r"^psql:.*?:(\d+): ", r"line \1: ", e)[:260] for e in errs]
    open(os.path.join(OUT, "restore-stderr.txt"), "w", encoding="utf-8").write(r.stderr)
    rep["dump_sha256_after"] = sha(DUMP)
    assert rep["dump_sha256_after"] == rep["dump_sha256_before"]
    # A3 publications
    for p in jl("prod_catalog_publications.json"):
        psql(DB, ["-v", "ON_ERROR_STOP=1", "-c", f'create publication "{p["name"]}"'])
        for t in p["tables"]:
            x = psql(DB, ["-c", f"alter publication \"{p['name']}\" add table {t}"])
            if x.returncode != 0 or "ERROR" in x.stderr:
                rep.setdefault("publication_errors", []).append(f"{p['name']} {t}: {x.stderr.strip()[:160]}")
    # A4 buckets (configuration only)
    for b in jl("prod_catalog_storage_buckets.json"):
        mt = "NULL" if b["allowed_mime_types"] is None else "ARRAY[" + ",".join("'" + m + "'" for m in b["allowed_mime_types"]) + "]::text[]"
        fs = "NULL" if b["file_size_limit"] is None else str(b["file_size_limit"])
        x = psql(DB, ["-v", "ON_ERROR_STOP=1", "-c", f"insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('{b['id']}','{b['name']}',{str(b['public']).lower()},{fs},{mt})"])
        if x.returncode != 0:
            rep.setdefault("bucket_errors", []).append(b["id"] + ": " + x.stderr.strip()[:160])
    # A5 captured history rows (names only; no statements)
    hist = jl("prod_catalog_history.json")
    vals = ",".join("('%s','%s',ARRAY['-- D3 CAPTURED HISTORY ROW: version and name copied from the Stage B Production capture; statements not available'])" % (h["version"], h["name"].replace("'", "''")) for h in hist)
    x = psql(DB, ["-v", "ON_ERROR_STOP=1"], text=f"insert into supabase_migrations.schema_migrations (version, name, statements) values {vals};")
    rep["history_seed_error"] = x.stderr.strip()[:300] if x.returncode else None
    rep["history_rows_seeded"] = int(q("select count(*) from supabase_migrations.schema_migrations"))
    json.dump(rep, open(os.path.join(OUT, "d3-restore-report.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps({k: (v if k not in ("restore_errors",) else f"{len(v)} errors") for k, v in rep.items()}, indent=1)[:3500])
    for e in rep["restore_errors"][:40]:
        print("  ", e)


main()
