"""Stage E2A: verdicts, dependency graph and outputs. READ-ONLY analysis (repository files + immutable Stage B captures). See e2a_analyze.py for the method.
Verdict classes (the six requested): H history-only (schema-equivalence) candidate | X future SQL execution required | W intentionally withdrawn |
I version identity decision required | P requires additional proof | B blocked by unresolved dependency.
Usage: python -I e2a_run.py"""
import collections
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2a_analyze as A  # noqa: E402
import e2a_sql as Q  # noqa: E402

EV, OUT, PROT = A.EV, A.OUT, A.PROT
ALIAS = {"prod": {"20260305203528", "20260407203226"}, "dev": {"20260305203528", "20260407203226", "20260814120000"}}
U5 = "20260722172048"
OCT = lambda v: v >= A.OCT0
man = json.load(open(os.path.join(EV, "stage-b-manifest.json"), encoding="utf-8"))
FP = {e: man["fingerprints"][e]["catalog_fingerprint_sha256"][:12] for e in ("prod", "dev")}
HIST = {e: {x["version"] for x in json.load(open(os.path.join(PROT, f"{e}_catalog_history.json"), encoding="utf-8"))} for e in ("prod", "dev")}
e1 = {(r["environment"], r["version"]): r for r in csv.DictReader(open(os.path.join(EV, "e1-reconciliation-readiness.csv"), encoding="utf-8"))}
pv, chain = A.load_repo()
# creator of each table (earliest CREATE TABLE element)
creator = {}
for (kind, key), els in chain.items():
    if kind == "table":
        c = min((e for e in els if not e[2].get("dropped")), key=lambda e: (e[0], e[1]), default=None)
        if c:
            creator[key] = c[0]


def tables_referenced(items):
    t = set()
    for kind, key, pl, st in items:
        if kind in ("col", "constraint", "trigger", "policy", "rls", "inline"):
            t.add(key.split(".")[0].split(":")[0] if kind != "col" else key.rsplit(".", 1)[0])
        elif kind == "index":
            t.add(pl.get("table", ""))
    return {x for x in t if x}


def readonly_queries(items):
    qs = []
    for kind, key, pl, st in items:
        if kind != "data":
            continue
        op, tbl = key.split(" ", 1)
        if op == "INSERT":
            m = re.search(r"INSERT INTO [\w\.\"]+\s*\(([^)]*)\)\s*VALUES\s*(.*)$", st, re.I | re.S)
            if m:
                col = m.group(1).split(",")[0].strip().strip('"')
                keys = re.findall(r"\(\s*('(?:[^']|'')*')", m.group(2))
                if keys:
                    qs.append(f"SELECT count(*) FROM {tbl} WHERE {col} IN ({', '.join(keys[:6])});  -- expect {len(set(keys[:6]))}")
                    continue
            qs.append(f"SELECT count(*) FROM {tbl};  -- manual: identify the seeded rows from the statement")
        elif op in ("UPDATE", "DELETE"):
            m = re.search(r"\bWHERE\b(.*)$", st, re.I | re.S)
            cond = " ".join(m.group(1).split())[:140] if m else "true"
            qs.append(f"SELECT count(*) FROM {tbl} WHERE {cond};  -- {'expect 0 if applied' if op == 'DELETE' else 'rows still matching the update predicate; interpretation is manual'}")
    return qs


def build(env, label):
    e = A.Env(env)
    res = A.evaluate(pv, chain, e)
    rows = {}
    for v, info in pv.items():
        recorded = v in HIST[env]
        items = info["items"]
        st = collections.Counter(x["status"] for x in res.get(v, []))
        by = sorted({b for x in res.get(v, []) for b in x["by"].split(",") if b})
        absent = [f"{x['kind']}:{x['key']}" for x in res.get(v, []) if x["status"] in ("ABSENT", "UNMATCHED")]
        data = [x for x in res.get(v, []) if x["status"] == "UNPROVABLE"]
        rows[v] = {"v": v, "file": info["file"], "recorded": recorded, "n_stmt": info["statements"], "stats": st, "by": by, "absent": absent, "unprov": data, "items": items,
                   "tables": tables_referenced(items), "queries": readonly_queries(items), "detail": res.get(v, [])}
    # first pass verdict without dependency blocking
    for v, r in rows.items():
        st = r["stats"]
        material_ok = st["PRESENT"] + st["SUPERSEDED"]
        bad = st["ABSENT"] + st["UNMATCHED"]
        unp = st["UNPROVABLE"]
        if r["recorded"]:
            r["cls"], r["label"], r["basis"] = "-", "already recorded", "history row exists"
        elif v in ALIAS[env]:
            r["cls"], r["label"], r["basis"] = "I", "version identity decision required", "related recorded version / alias; see e2a-prod-alias-comparison.md and e1-owner-decisions.md"
        elif OCT(v):
            r["cls"], r["label"], r["basis"] = "X", "future SQL execution required (coordinated October release)", "23 October migrations stay pending by design"
        elif bad == 0 and unp == 0:
            r["cls"], r["label"], r["basis"] = "H", "history-only reconciliation candidate (schema-equivalence, not proof the SQL ran)", ("all material statements PRESENT/SUPERSEDED/NOOP" if material_ok or st["NOOP"] else "no material statement")
        elif bad == 0:
            r["cls"], r["label"], r["basis"] = "P", "requires additional proof (schema proven; data/dynamic statements unprovable)", f"{unp} data/dynamic statement(s) need read-only evidence"
        elif st["PRESENT"] == 0:
            r["cls"], r["label"], r["basis"] = "X", "future SQL execution required (effects absent)" + (" or owner decision if the absence is intentional" if env == "dev" else ""), f"{bad} material statement(s) absent/unmatched; none reflected by the captured catalog ({st['SUPERSEDED']} superseded)"
        else:
            r["cls"], r["label"], r["basis"] = "P", "requires additional proof (partially reflected)", f"{st['ABSENT']} absent, {st['UNMATCHED']} unmatched, {material_ok} present/superseded"
    # dependency closure: a candidate that references a table created by a pending version whose verdict is X or partial is blocked
    deps = []
    for v, r in rows.items():
        if r["recorded"]:
            continue
        edges = collections.defaultdict(set)
        for x in r["detail"]:
            if x["status"] == "SUPERSEDED" and x["by"]:
                for b in x["by"].split(","):
                    edges[(b, "superseded-by")].add(f"{x['kind']}:{x['key']}")
        for t in r["tables"]:
            c = creator.get(t)
            if c and c != v and c < v:
                edges[(c, "table-creator")].add(t)
        for (dep, kind), objs in sorted(edges.items()):
            dr = rows.get(dep)
            dstat = "recorded" if dr and dr["recorded"] else (dr["cls"] if dr else "?")
            table_missing = kind == "table-creator" and all(("public", t) not in e.tables for t in objs)
            if table_missing:
                closure = "BLOCKS (a referenced table is absent from the captured catalog)"
            elif dstat in ("recorded", "H", "-"):
                closure = "closed"
            else:
                closure = f"ordering: target verdict {dstat}; reconcile or execute it first"
            deps.append([label, v, dep, kind, len(objs), "; ".join(sorted(objs))[:200], dstat, closure])
            if table_missing and r["cls"] in ("H", "P") and not OCT(v):
                r.setdefault("blocked_by", set()).add(dep)
    for v, r in rows.items():
        if r.get("blocked_by") and r["cls"] == "H":
            r["cls"], r["label"], r["basis"] = "B", "blocked by unresolved dependency", "references a table/object created by version(s) " + ",".join(sorted(r["blocked_by"])) + " whose own verdict is unresolved"
    return rows, deps


def srow(label, r, env):
    st = r["stats"]
    e1r = e1.get((label, r["v"]), {})
    qs = r["queries"]
    return [label, r["v"], r["file"], r["n_stmt"], st["PRESENT"], st["SUPERSEDED"], st["NOOP"], st["ABSENT"], st["UNMATCHED"], st["UNPROVABLE"], st["NONMATERIAL"], ",".join(r["by"][:8]),
            "; ".join(r["absent"][:4]), r["cls"], r["label"], r["basis"], e1r.get("e1_category", ""), f"stage-b-20261016/{env}_catalog_*.json (fingerprint {FP[env]}); classification_raw.json[{env}][{r['v']}]; tools/e2a_analyze.py", " | ".join(qs[:6])]


HEAD = ["environment", "version", "file", "statements", "present", "superseded", "noop_guarded", "absent", "unmatched", "unprovable_data_or_dynamic", "nonmaterial", "superseded_by_versions",
        "absent_or_unmatched_objects", "e2a_class", "e2a_verdict", "basis", "e1_category", "evidence_references", "readonly_queries_needed"]

if __name__ == "__main__":
    allrows = {}
    deps_all = []
    for env, label in (("prod", "Production"), ("dev", "Development")):
        rows, deps = build(env, label)
        allrows[env] = rows
        deps_all += deps
    # Production baseline proof (40) + per-statement detail
    base = sorted(v for v in allrows["prod"] if v < A.FIRST_PROD and v not in HIST["prod"])
    assert len(base) == 40
    with open(os.path.join(EV, "e2a-prod-baseline-proof.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(HEAD)
        for v in base:
            w.writerow(srow("Production", allrows["prod"][v], "prod"))
    with open(os.path.join(EV, "e2a-prod-baseline-statements.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["version", "object_kind", "object", "status", "superseded_by", "detail"])
        for v in base:
            for x in allrows["prod"][v]["detail"]:
                if x["kind"] not in ("comment",):
                    w.writerow([v, x["kind"], x["key"][:120], x["status"], x["by"], x["detail"][:160]])
    dev_pend = sorted(v for v in allrows["dev"] if v < A.OCT0 and v not in HIST["dev"])
    assert len(dev_pend) == 306, len(dev_pend)
    with open(os.path.join(EV, "e2a-dev-proof.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(HEAD)
        for v in dev_pend:
            w.writerow(srow("Development", allrows["dev"][v], "dev"))
    with open(os.path.join(EV, "e2a-dependency-register.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["environment", "version", "depends_on_version", "edge_kind", "objects", "object_list", "dependency_status_in_environment", "closure"])
        w.writerows(deps_all)
    with open(os.path.join(EV, "e2a-proposed-actions.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(HEAD)
        for env, label in (("prod", "Production"), ("dev", "Development")):
            for v in sorted(allrows[env]):
                r = allrows[env][v]
                if not r["recorded"]:
                    w.writerow(srow(label, r, env))
            w.writerow([label, "20260407211122", "(withdrawn; not in the repository)", 0, 0, 0, 0, 0, 0, 0, 0, "", "", "W", "intentionally withdrawn before application; never mark applied", "Stage C3", "excluded", "case-43-impact-analysis.md; withdrawn-migrations/", ""])
    # summaries and E1 reconciliation
    summ = {}
    for env, label in (("prod", "Production"), ("dev", "Development")):
        pend = [r for r in allrows[env].values() if not r["recorded"]]
        c = collections.Counter(r["cls"] for r in pend)
        pre = collections.Counter(r["cls"] for r in pend if r["v"] < A.OCT0)
        x = collections.Counter((e1.get((label, r["v"]), {}).get("e1_category", "?")[:1], r["cls"]) for r in pend)
        summ[label] = {"pending": len(pend), "all_classes": dict(c), "pre_october_classes": dict(pre), "e1_category_by_e2a_class": {f"{k[0]}->{k[1]}": n for k, n in sorted(x.items())}}
    json.dump(summ, open(os.path.join(OUT, "e2a-summary.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(summ, indent=1))
    print("dependency edges:", len(deps_all), collections.Counter(d[7] for d in deps_all))
    # keep the full per-statement evidence in the protected folder
    with open(os.path.join(OUT, "e2a-statements-all.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["environment", "version", "kind", "object", "status", "by", "detail"])
        for env, label in (("prod", "Production"), ("dev", "Development")):
            for v, r in allrows[env].items():
                for x in r["detail"]:
                    w.writerow([label, v, x["kind"], x["key"][:140], x["status"], x["by"], x["detail"][:160]])
