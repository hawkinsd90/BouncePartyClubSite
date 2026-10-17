"""Stage E2B-1: reconcile the 67-version Production upgrade set (D3/D4) with the E2A classification. READ-ONLY offline analysis of repository files, the Stage B
Production capture and the existing evidence CSV/JSON; no database is contacted. Produces the per-version facts used by the crosswalk and the dependency graph.
Usage: python -I e2b1_analyze.py   (writes e2b1-analysis.json to the protected e2b1-scratch folder and prints a summary)"""
import collections
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2a_analyze as A  # noqa: E402

EV = A.EV
OUT = r"C:\Users\vikki\migration-evidence\e2b1-scratch"
os.makedirs(OUT, exist_ok=True)
man = json.load(open(os.path.join(EV, "d3-selected-manifest.json"), encoding="utf-8"))["upgrade"]
SET = [r["version"] for r in man]
SETS = set(SET)
d3 = {r["version"]: r for r in json.load(open(os.path.join(EV, "d3-execution-report.json"), encoding="utf-8"))["results"]}
e2a = {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "e2a-proposed-actions.csv"), encoding="utf-8")) if r["environment"] == "Production"}
pv, chain = A.load_repo()
env = A.Env("prod")
res = A.evaluate(pv, chain, env)
creator_in_set = {}
for (kind, key), els in chain.items():
    if kind == "table":
        c = min((e for e in els if not e[2].get("dropped") and e[0] in SETS), key=lambda e: (e[0], e[1]), default=None)
        if c:
            creator_in_set[key] = c[0]
fn_creator = {}
for (kind, key), els in chain.items():
    if kind == "function":
        c = min((e for e in els if not e[2].get("dropped") and e[0] in SETS), key=lambda e: (e[0], e[1]), default=None)
        if c:
            fn_creator[key] = c[0]
prod_has_table = {t for (s, t) in env.tables if s == "public"}


def refs(items):
    """tables and functions referenced by a version's statements"""
    tabs, fns = set(), set()
    for kind, key, pl, st in items:
        if kind in ("col", "constraint", "trigger", "policy", "rls", "inline"):
            tabs.add(key.rsplit(".", 1)[0].split(":")[0] if kind == "col" else key.split(".")[0].split(":")[0])
        if kind == "index":
            tabs.add(pl.get("table", ""))
        if kind == "trigger" and pl.get("fn"):
            fns.add(pl["fn"])
        if kind == "grant":
            ob = key.split(":")[1]
            if key.startswith("FUNCTION"):
                fns.add(ob.split("(")[0].split(".")[-1])
            else:
                tabs.add(ob.split(".")[-1])
    return {t for t in tabs if t}, fns


facts, edges = {}, []
for v in SET:
    items = pv[v]["items"]
    detail = res.get(v, [])
    st = collections.Counter(x["status"] for x in detail)
    tabs, fns = refs(items)
    # replaced-by within the set: every material element of v that has a LATER element on the same object in the set
    repl_by = collections.defaultdict(set)
    material = 0
    replaced = 0
    owns_final = []
    for kind, key, pl, stmt in items:
        if kind in ("data", "dynamic", "comment", "grantwide", "bucketvis"):
            continue
        material += 1
        els = sorted([e for e in chain[(kind, key)] if e[0] in SETS], key=lambda e: (e[0], e[1]))
        later = [e for e in els if (e[0], e[1]) > (v, 10 ** 6) or e[0] > v]
        if later:
            replaced += 1
            repl_by[later[0][0]].add(f"{kind}:{key}")
        else:
            owns_final.append(f"{kind}:{key}")
    # a later element in the same file also counts as replacement only across versions; same-file chains are internal
    for w, objs in sorted(repl_by.items()):
        edges.append([v, w, "intermediate-effect-replaced-by", len(objs), "; ".join(sorted(objs))[:200]])
    for t in sorted(tabs):
        c = creator_in_set.get(t)
        if c and c != v:
            edges.append([v, c, "requires-table-created-by" if c < v else "touches-table-created-LATER-by", 1, t])
    for f in sorted(fns):
        c = fn_creator.get(f)
        if c and c != v:
            edges.append([v, c, "requires-function-created-by" if c < v else "touches-function-created-LATER-by", 1, f])
    data = [x for x in detail if x["status"] == "UNPROVABLE"]
    facts[v] = {"material": material, "replaced_within_set": replaced, "owns_final": owns_final, "statuses": dict(st), "data": [f"{x['kind']}: {x['key']}" for x in data],
                "absent": [f"{x['kind']}:{x['key']}" for x in detail if x["status"] in ("ABSENT", "UNMATCHED")], "tables_missing_in_prod": sorted(t for t in tabs if t not in prod_has_table and creator_in_set.get(t)),
                "fully_replaced": bool(material) and replaced == material and not data}
json.dump({"facts": facts, "edges": edges}, open(os.path.join(OUT, "e2b1-analysis.json"), "w", encoding="utf-8"), indent=1)
print("versions:", len(SET), "| edges:", len(edges), collections.Counter(e[2] for e in edges))
print("fully-replaced (all material statements replaced later in the set, no data):", [v for v in SET if facts[v]["fully_replaced"]])
need = [v for v in SET if (facts[v]["absent"] or facts[v]["data"])]
print("versions with an absent/unmatched effect or a data statement:", len(need), "| without:", [v for v in SET if v not in need])
print("E2A class x absent-effect:", collections.Counter((e2a[v]["e2a_class"], bool(facts[v]["absent"]), bool(facts[v]["data"])) for v in SET))
print("touches-LATER:", [e for e in edges if "LATER" in e[2]][:6])
