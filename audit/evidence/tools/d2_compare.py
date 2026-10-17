"""Stage D2 (R-2a), part 2: catalog-level comparison of the locally reconstructed PRE-UPGRADE database against the Stage B Production baseline.

Both sides use the SAME catalog queries (QUERIES from stage_b_capture.py): the Production side is the read-only Stage B capture (hash-verified
against its manifest), the local side is queried from the scratch database on 127.0.0.1:54329. Local PostgreSQL only; nothing is written to any
hosted system. Output: raw per-object differences (JSON) in the protected d2-scratch folder.
Usage: python -I d2_compare.py capture|diff
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\d2-scratch"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
DB = "bpc_replay_d2_preupgrade"
REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
CATS = ["tables", "columns", "constraints", "indexes", "triggers", "functions", "policies", "grants_relations", "grants_columns", "grants_functions", "grants_schemas",
        "default_acls", "publications", "extensions", "roles", "event_triggers", "views", "types", "storage_buckets"]

spec = importlib.util.spec_from_file_location("cap", os.path.join(REPO, "audit", "evidence", "tools", "stage_b_capture.py"))
cap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cap)


def local_query(sql):
    assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", DB)
    r = subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-At", "-v", "ON_ERROR_STOP=1", "-d", DB, "-c", sql], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise SystemExit("local query failed: " + r.stderr[:400])
    return json.loads(r.stdout.strip())


def capture():
    os.makedirs(OUT, exist_ok=True)
    for c in CATS:
        data = local_query(cap.QUERIES[c])
        json.dump(data, open(os.path.join(OUT, f"local_catalog_{c}.json"), "w", encoding="utf-8"))
    print("captured", len(CATS), "local catalogs")


def load(env, c):
    p = os.path.join(PROT if env == "prod" else OUT, f"{'prod_catalog' if env == 'prod' else 'local_catalog'}_{c}.json")
    return json.load(open(p, encoding="utf-8"))


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


KEYS = {
    "tables": lambda r: (r["schema"], r["name"]),
    "columns": lambda r: (r["schema"], r["tbl"], r["name"]),
    "constraints": lambda r: (r["schema"], r["tbl"], r["name"]),
    "indexes": lambda r: (r["schema"], r["tbl"], r["name"]),
    "triggers": lambda r: (r["schema"], r["tbl"], r["name"]),
    "functions": lambda r: (r["schema"], r["name"], r["args"]),
    "policies": lambda r: (r["schema"], r["tbl"], r["name"]),
    "views": lambda r: (r["schema"], r["name"]),
    "types": lambda r: (r["schema"], r["name"]),
    "publications": lambda r: (r["name"],),
    "extensions": lambda r: (r["name"],),
    "storage_buckets": lambda r: (r["id"],),
    "event_triggers": lambda r: (r["name"],),
    "roles": lambda r: (r["name"],),
}
SETS = {  # compared as sets of whole rows
    "grants_relations": lambda r: (r["schema"], r["name"], r["relkind"], r["grantee"], r["privilege_type"], r["is_grantable"]),
    "grants_columns": lambda r: (r["schema"], r["tbl"], r["col"], r["grantee"], r["privilege_type"]),
    "grants_functions": lambda r: (r["schema"], r["name"], r["args"], r["grantee"], r["privilege_type"]),
    "grants_schemas": lambda r: (r["schema"], r["owner"], r["grantee"], r["privilege_type"]),
    "default_acls": lambda r: (r["role"], r["schema"], r["objtype"], r["acl"]),
}
FIELDS = {
    "tables": ["relkind", "rls", "rls_forced", "owner", "replica_identity", "relpersistence", "reloptions"],
    "columns": ["type", "not_null", "default_expr", "identity", "generated"],
    "constraints": ["type", "def", "validated"],
    "indexes": ["def"],
    "triggers": ["def", "enabled"],
    "functions": ["result", "owner", "lang", "secdef", "volatility", "config", "kind", "src_md5", "src_norm_md5", "src_nocomment_md5"],
    "policies": ["permissive", "roles", "cmd", "qual", "with_check"],
    "views": ["owner", "def_md5"],
    "types": ["kind"],
    "publications": ["all_tables", "pubinsert", "pubupdate", "pubdelete", "pubtruncate", "tables"],
    "extensions": ["version", "schema"],
    "storage_buckets": ["name", "public", "file_size_limit", "allowed_mime_types"],
    "event_triggers": ["event", "owner", "enabled", "func"],
    "roles": ["rolsuper", "rolinherit", "rolcreaterole", "rolcreatedb", "rolcanlogin", "rolreplication", "rolbypassrls", "rolconnlimit", "member_of"],
}
IN_SCOPE_SCHEMAS = {"public", "storage", "auth"}


def in_scope(c, key):
    if c in ("publications", "extensions", "storage_buckets", "event_triggers", "roles"):
        return True
    return key[0] in IN_SCOPE_SCHEMAS if isinstance(key[0], str) and c not in ("default_acls",) else True


def diff():
    out = {}
    for c in CATS:
        p, l = load("prod", c), load("local", c)
        rows = []
        if c in SETS:
            f = SETS[c]
            ps, ls = {f(r) for r in p}, {f(r) for r in l}
            sc = lambda k: k[0] in IN_SCOPE_SCHEMAS if c != "default_acls" else True
            for k in sorted(ps - ls, key=str):
                if sc(k):
                    rows.append({"kind": "only_production", "key": list(k)})
            for k in sorted(ls - ps, key=str):
                if sc(k):
                    rows.append({"kind": "only_local", "key": list(k)})
            out[c] = {"production_rows": len([k for k in ps if sc(k)]), "local_rows": len([k for k in ls if sc(k)]), "diffs": rows}
            continue
        kf = KEYS[c]
        pm = {kf(r): r for r in p if in_scope(c, kf(r))}
        lm = {kf(r): r for r in l if in_scope(c, kf(r))}
        for k in sorted(pm.keys() - lm.keys(), key=str):
            rows.append({"kind": "only_production", "key": list(k)})
        for k in sorted(lm.keys() - pm.keys(), key=str):
            rows.append({"kind": "only_local", "key": list(k)})
        for k in sorted(pm.keys() & lm.keys(), key=str):
            for fld in FIELDS[c]:
                a, b = pm[k].get(fld), lm[k].get(fld)
                if (norm(a) if isinstance(a, str) else a) != (norm(b) if isinstance(b, str) else b):
                    rows.append({"kind": "different", "key": list(k), "field": fld, "production": a if not isinstance(a, str) or len(a) < 400 else a[:400] + "...", "local": b if not isinstance(b, str) or len(b) < 400 else b[:400] + "..."})
        out[c] = {"production_rows": len(pm), "local_rows": len(lm), "diffs": rows}
    json.dump(out, open(os.path.join(OUT, "d2-raw-diff.json"), "w", encoding="utf-8"), indent=1, default=str)
    for c, d in out.items():
        kinds = {}
        for r in d["diffs"]:
            kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        print(f"{c:18} prod={d['production_rows']:5} local={d['local_rows']:5} diffs={len(d['diffs']):5} {kinds}")


{"capture": capture, "diff": diff}[sys.argv[1]]()
