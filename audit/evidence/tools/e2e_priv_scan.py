"""Stage E2E: READ-ONLY static scan of migration SQL for statements that need more than ordinary ownership of public objects (platform-owned schemas, roles, publications, default privileges, extensions),
and a precedent count from the Production-recorded history. Reads repository files and the Stage B captured catalog (owners); no database, no hosted system.
Usage: python -I e2e_priv_scan.py"""
import csv
import json
import os
import re
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.join(HERE, "..")
MIG = os.path.join(HERE, "..", "..", "..", "supabase", "migrations")
P = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OMIT9 = {"20260715221828", "20260716104333", "20261010110000", "20260716151530", "20260716152823", "20260716173644", "20260717111737", "20260717113131", "20260814114825"}
PATTERNS = OrderedDict([
    ("storage schema objects (storage.objects policies, storage.buckets rows)", r"\bstorage\.(objects|buckets)\b|ON\s+storage\."),
    ("auth schema objects (triggers or reads on auth.users)", r"\bauth\.users\b|ON\s+auth\."),
    ("realtime publication", r"ALTER\s+PUBLICATION"),
    ("ALTER DEFAULT PRIVILEGES", r"ALTER\s+DEFAULT\s+PRIVILEGES"),
    ("platform roles named explicitly (supabase_*)", r"\bsupabase_[a-z_]+\b"),
    ("CREATE/ALTER EXTENSION", r"\b(CREATE|ALTER)\s+EXTENSION\b"),
    ("ownership change or role DDL", r"\bOWNER\s+TO\b|\bCREATE\s+ROLE\b|\bALTER\s+ROLE\b|\bSET\s+ROLE\s+[a-z_]"),
    ("SECURITY DEFINER function creation", r"SECURITY\s+DEFINER"),
    ("pg_net / net schema calls", r"\bnet\.http_|\bpg_net\b"),
    ("vault schema", r"\bvault\."),
])


def clean(t):
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    return re.sub(r"--[^\n]*", "", t)


def scan(versions):
    man = {r["version"]: r["file"] for r in json.load(open(os.path.join(EV, "d3-selected-manifest.json"), encoding="utf-8"))["upgrade"]}
    files = {f.split("_")[0]: f for f in os.listdir(MIG) if f.endswith(".sql")}
    out = OrderedDict((k, []) for k in PATTERNS)
    for v in versions:
        t = clean(open(os.path.join(MIG, files[v]), encoding="utf-8").read())
        for k, rx in PATTERNS.items():
            if re.search(rx, t, re.I):
                out[k].append(v)
    return out


v58 = [r["version"] for r in json.load(open(os.path.join(EV, "d3-selected-manifest.json"), encoding="utf-8"))["upgrade"] if r["version"] not in OMIT9]
prod_rec = [r["version"] for r in json.load(open(f"{P}\\prod_catalog_history.json", encoding="utf-8"))]
s58 = scan(v58)
sprod = scan(prod_rec)
owners = {}
for t in json.load(open(f"{P}\\prod_catalog_tables.json", encoding="utf-8")):
    if (t["schema"], t["name"]) in (("auth", "users"), ("storage", "objects"), ("storage", "buckets"), ("public", "orders"), ("public", "user_roles")):
        owners[f"{t['schema']}.{t['name']}"] = t["owner"]
fo = {}
for f in json.load(open(f"{P}\\prod_catalog_functions.json", encoding="utf-8")):
    fo[f["owner"]] = fo.get(f["owner"], 0) + 1
res = {"candidate_versions": len(v58), "production_recorded_versions": len(prod_rec),
       "candidate_58": {k: {"count": len(v), "versions": v} for k, v in s58.items()},
       "production_recorded_precedent": {k: len(v) for k, v in sprod.items()}, "table_owners_in_production_capture": owners, "public_function_owners_in_production_capture": fo}
json.dump(res, open(r"C:\Users\vikki\migration-evidence\e2e-scratch\e2e-priv-scan.json", "w", encoding="utf-8"), indent=1)
for k in PATTERNS:
    print(f"{len(s58[k]):3d} of 58 | {len(sprod[k]):3d} of {len(prod_rec)} Production-recorded | {k}")
print(owners)
print(fo)
