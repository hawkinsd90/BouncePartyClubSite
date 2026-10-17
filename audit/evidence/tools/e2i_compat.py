"""Stage E2I: classify the catalog differences between (1) the restored DEVELOPMENT schema and the restored PRODUCTION baseline, and (2) Development after a scratch run of the October block and the Production
release result (58-version path). Offline: reads the d3_catalog diff files produced from disposable local scratch databases, the Stage B Production history and the repository SQL. Writes e2i-compat-current.json
in the protected scratch folder (outside Git) and prints a summary. No hosted system.
Usage: python -I e2i_compat.py"""
import ast
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2a_sql as SQL  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MIG = os.path.join(REPO, "supabase", "migrations")
P = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence"
prod_hist = {r["version"] for r in json.load(open(P + r"\prod_catalog_history.json", encoding="utf-8"))}
dev_hist = {r["version"] for r in json.load(open(P + r"\dev_catalog_history.json", encoding="utf-8"))}

# objects created by repository files that Production has NOT recorded (the Production-pending set after the E2F withdrawals)
created = defaultdict(set)
for fn in sorted(os.listdir(MIG)):
    v = fn[:14]
    if v in prod_hist or not fn.endswith(".sql"):
        continue
    text = open(os.path.join(MIG, fn), encoding="utf-8", newline="").read().replace("\r\n", "\n")
    for st in SQL.strip_and_split(text):
        kind, target = SQL.tag(st)
        if kind == "CREATE TABLE":
            created["table"].add(target)
        elif kind == "CREATE FUNCTION":
            created["function"].add(target.split(".")[-1])
        elif kind == "CREATE POLICY":
            created["policy"].add(target)
        elif kind == "CREATE TRIGGER":
            created["trigger"].add(target)
        elif kind == "CREATE INDEX":
            created["index"].add(target)
        for t_, c_ in re.findall(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?\"?(\w+)\"?\s+ADD COLUMN (?:IF NOT EXISTS )?\"?(\w+)\"?", st, re.I):
            created["column"].add(f"{t_}.{c_}")
        for c_ in re.findall(r"ADD COLUMN (?:IF NOT EXISTS )?\"?(\w+)\"?", st, re.I):
            if kind.startswith("ALTER TABLE"):
                created["column"].add(f"{target}.{c_}")
        for n_ in re.findall(r"ADD CONSTRAINT \"?(\w+)\"?", st, re.I):
            created["constraint"].add(n_)
        for n_ in re.findall(r"CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)", st, re.I):
            created["index"].add(n_)
        for tgt in re.findall(r"CREATE POLICY \"([^\"]+)\" ON (?:public\.)?(\w+)", st, re.I):
            created["policy"].add(f"{tgt[1]}.{tgt[0]}")


def key(r):
    k = r["key"]
    return ast.literal_eval(k) if isinstance(k, str) else list(k)


def classify(cat, diffs, dev_tag, prod_tag):
    out = []
    for r in diffs:
        k = key(r)
        kind = r["kind"]
        side = "dev-only" if kind.startswith("only_") and dev_tag in kind else "prod-only" if kind.startswith("only_") else "different"
        why = "unexplained"
        if cat == "tables" and side == "dev-only":
            why = "created by a Production-pending migration" if k[1] in created["table"] else "unexplained"
        elif cat == "columns":
            if side == "dev-only":
                why = "created by a Production-pending migration" if f"{k[1]}.{k[2]}" in created["column"] or k[1] in created["table"] else "unexplained"
        elif cat in ("constraints",):
            if side == "dev-only":
                why = "created by a Production-pending migration" if (k[2] in created["constraint"] or k[1] in created["table"] or k[2].endswith("_not_null")) else "unexplained"
        elif cat == "indexes":
            if side == "dev-only":
                why = "created by a Production-pending migration" if (k[2] in created["index"] or k[1] in created["table"]) else ("platform (auth.users index)" if k[0] == "auth" else "unexplained")
        elif cat == "triggers":
            if side == "dev-only":
                why = "created by a Production-pending migration" if (f"{k[1]}.{k[2]}" in created["trigger"] or k[1] in created["table"]) else "unexplained"
        elif cat == "functions":
            if side == "dev-only":
                why = "created by a Production-pending migration" if k[1] in created["function"] else "unexplained"
        elif cat == "policies":
            if side == "dev-only":
                why = "created by a Production-pending migration" if (f"{k[1]}.{k[2]}" in created["policy"] or k[1] in created["table"]) else "unexplained"
        if why == "unexplained":
            if cat == "policies" and side == "prod-only" and k[0] == "storage":
                why = "containment: storage.objects policy absent in Development"
            elif cat == "triggers" and side == "prod-only" and k[:3] == ["auth", "users", "on_auth_user_created"]:
                why = "containment / E2A: signup trigger absent in Development"
            elif cat == "functions" and side == "prod-only" and k[1] == "update_pricing_rules":
                why = "E2A: update_pricing_rules absent in Development (20260611184401)"
            elif cat in ("default_acls", "grants_schemas", "roles"):
                why = "platform / project-level default privileges"
            elif cat == "grants_relations" and "MAINTAIN" in str(k):
                why = "PostgreSQL privilege-representation (MAINTAIN) difference of the two dumps"
            elif cat == "publications":
                why = "Realtime publication membership differs (documented in E1: Realtime tables absent on Development) / partition names"
            elif cat == "storage_buckets":
                why = "bucket settings differ (containment or project configuration)"
        out.append({"category": cat, "side": side, "key": k, "field": r.get("field"), "why": why})
    return out


def summarize(path, dev_tag, prod_tag):
    d = json.load(open(path, encoding="utf-8"))
    res = []
    for cat, v in d.items():
        res += classify(cat, v["diffs"], dev_tag, prod_tag)
    return res


cur = summarize(os.path.join(OUT, "e2i-diff-current.json"), "e2idevbase", "e2iprodbase")
summary = {"current": {"total": len(cur), "by_why": Counter(r["why"] for r in cur), "by_category": Counter((r["category"], r["side"]) for r in cur)}}
summary["current"]["by_why"] = dict(summary["current"]["by_why"])
summary["current"]["by_category"] = {f"{k[0]}|{k[1]}": v for k, v in Counter((r["category"], r["side"]) for r in cur).items()}
summary["current"]["unexplained"] = [r for r in cur if r["why"] == "unexplained"]
json.dump({"rows": cur, "summary": summary}, open(os.path.join(OUT, "e2i-compat-current.json"), "w", encoding="utf-8"), indent=1, default=str)
print("CURRENT Dev vs Prod:", summary["current"]["total"])
for k, v in sorted(summary["current"]["by_why"].items(), key=lambda x: -x[1]):
    print(f"  {v:4d}  {k}")
print("unexplained by category:", dict(Counter((r["category"], r["side"]) for r in summary["current"]["unexplained"])))
for r in summary["current"]["unexplained"]:
    if r["category"] not in ("grants_relations", "grants_functions"):
        print("   ", r["category"], r["side"], r["key"][:4], r["field"])
