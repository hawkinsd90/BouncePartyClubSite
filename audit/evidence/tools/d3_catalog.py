"""Stage D3: catalog capture of a LOCAL scratch database and catalog diff between two catalog sets (Stage B Production capture = tag "prod").
Uses the same QUERIES as the Stage B capture. Local PostgreSQL only (127.0.0.1:54329, bpc_replay_* databases); the Production side is the
hash-verified Stage B files. Usage:
  python -I d3_catalog.py capture <db> <tag>
  python -I d3_catalog.py diff <tagA> <tagB> <outfile> [schemas,comma]
"""
import importlib.util
import json
import os
import re
import subprocess
import sys

PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\d3-scratch"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
CATS = ["tables", "columns", "constraints", "indexes", "triggers", "functions", "policies", "grants_relations", "grants_columns", "grants_functions", "grants_schemas",
        "default_acls", "publications", "extensions", "roles", "event_triggers", "views", "types", "storage_buckets"]
spec = importlib.util.spec_from_file_location("cap", os.path.join(REPO, "audit", "evidence", "tools", "stage_b_capture.py"))
cap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cap)


def local_query(db, sql):
    assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", db)
    r = subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-At", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise SystemExit("local query failed: " + r.stderr[:400])
    return json.loads(r.stdout.strip())


def path(tag, c):
    return os.path.join(PROT, f"prod_catalog_{c}.json") if tag == "prod" else os.path.join(OUT, f"{tag}_catalog_{c}.json")


def load(tag, c):
    return json.load(open(path(tag, c), encoding="utf-8"))


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


KEYS = {
    "tables": lambda r: (r["schema"], r["name"]), "columns": lambda r: (r["schema"], r["tbl"], r["name"]), "constraints": lambda r: (r["schema"], r["tbl"], r["name"]),
    "indexes": lambda r: (r["schema"], r["tbl"], r["name"]), "triggers": lambda r: (r["schema"], r["tbl"], r["name"]), "functions": lambda r: (r["schema"], r["name"], r["args"]),
    "policies": lambda r: (r["schema"], r["tbl"], r["name"]), "views": lambda r: (r["schema"], r["name"]), "types": lambda r: (r["schema"], r["name"]),
    "publications": lambda r: (r["name"],), "extensions": lambda r: (r["name"],), "storage_buckets": lambda r: (r["id"],), "event_triggers": lambda r: (r["name"],), "roles": lambda r: (r["name"],),
}
SETS = {
    "grants_relations": lambda r: (r["schema"], r["name"], r["relkind"], r["grantee"], r["privilege_type"], r["is_grantable"]),
    "grants_columns": lambda r: (r["schema"], r["tbl"], r["col"], r["grantee"], r["privilege_type"]),
    "grants_functions": lambda r: (r["schema"], r["name"], r["args"], r["grantee"], r["privilege_type"]),
    "grants_schemas": lambda r: (r["schema"], r["owner"], r["grantee"], r["privilege_type"]),
    "default_acls": lambda r: (r["role"], r["schema"], r["objtype"], r["acl"]),
}
FIELDS = {
    "tables": ["relkind", "rls", "rls_forced", "owner", "replica_identity", "relpersistence", "reloptions"], "columns": ["type", "not_null", "default_expr", "identity", "generated"],
    "constraints": ["type", "def", "validated"], "indexes": ["def"], "triggers": ["def", "enabled"],
    "functions": ["result", "owner", "lang", "secdef", "volatility", "config", "kind", "src_md5", "src_norm_md5", "src_nocomment_md5"],
    "policies": ["permissive", "roles", "cmd", "qual", "with_check"], "views": ["owner", "def_md5"], "types": ["kind"],
    "publications": ["all_tables", "pubinsert", "pubupdate", "pubdelete", "pubtruncate", "tables"], "extensions": ["version", "schema"],
    "storage_buckets": ["name", "public", "file_size_limit", "allowed_mime_types"], "event_triggers": ["event", "owner", "enabled", "func"],
    "roles": ["rolsuper", "rolinherit", "rolcreaterole", "rolcreatedb", "rolcanlogin", "rolreplication", "rolbypassrls", "rolconnlimit", "member_of"],
}


def capture(db, tag):
    os.makedirs(OUT, exist_ok=True)
    for c in CATS:
        json.dump(local_query(db, cap.QUERIES[c]), open(path(tag, c), "w", encoding="utf-8"))
    print("captured", len(CATS), "catalogs for", db, "as", tag)


def diff(a, b, outfile, schemas):
    sset = set(schemas.split(",")) if schemas else None

    def keep(c, k):
        if c in ("publications", "extensions", "storage_buckets", "event_triggers", "roles"):
            return True
        if c == "default_acls":
            return True
        return sset is None or k[0] in sset
    res = {}
    for c in CATS:
        pa, pb = load(a, c), load(b, c)
        rows = []
        if c in SETS:
            f = SETS[c]
            sa = {f(r) for r in pa if keep(c, f(r))}
            sb = {f(r) for r in pb if keep(c, f(r))}
            rows += [{"kind": "only_" + a, "key": list(k)} for k in sorted(sa - sb, key=str)] + [{"kind": "only_" + b, "key": list(k)} for k in sorted(sb - sa, key=str)]
            res[c] = {a: len(sa), b: len(sb), "diffs": rows}
            continue
        kf = KEYS[c]
        ma = {kf(r): r for r in pa if keep(c, kf(r))}
        mb = {kf(r): r for r in pb if keep(c, kf(r))}
        rows += [{"kind": "only_" + a, "key": list(k)} for k in sorted(ma.keys() - mb.keys(), key=str)] + [{"kind": "only_" + b, "key": list(k)} for k in sorted(mb.keys() - ma.keys(), key=str)]
        for k in sorted(ma.keys() & mb.keys(), key=str):
            for fld in FIELDS[c]:
                x, y = ma[k].get(fld), mb[k].get(fld)
                if (norm(x) if isinstance(x, str) else x) != (norm(y) if isinstance(y, str) else y):
                    rows.append({"kind": "different", "key": list(k), "field": fld, a: x, b: y})
        res[c] = {a: len(ma), b: len(mb), "diffs": rows}
    json.dump(res, open(outfile, "w", encoding="utf-8"), indent=1, default=str)
    for c, d in res.items():
        kinds = {}
        for r in d["diffs"]:
            kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        print(f"{c:18} {a}={d[a]:5} {b}={d[b]:5} diffs={len(d['diffs']):5} {kinds}")


if __name__ == "__main__":
    if sys.argv[1] == "capture":
        capture(sys.argv[2], sys.argv[3])
    else:
        diff(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5] if len(sys.argv) > 5 else "")
