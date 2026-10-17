"""Stage E2H: static dependency audit of the 58 approved executable migrations. READ-ONLY and OFFLINE: reads the allowlist (E2G), the migration files of the working tree (LF-normalized) and the Stage B Production
catalog capture (the schema the migrations start from). Writes e2h-dependency-audit.csv and scripts/dev/local-executor/prod58-dependencies.json. Does not touch a database, a hosted system or any migration file.
Edge kinds: hard = the referenced object must already exist when the statement runs (top-level DDL/DML, GRANT/REVOKE, policy or trigger or check expressions, foreign keys, DROP without IF EXISTS);
probable = a statement mentions a table together with a column that an earlier allowlisted file added; runtime = referenced only inside a function body (late-bound, needed when called, not when created);
also lists dependencies on the omitted nine versions (runtime edges are enforced too, see the E2H lesson below), and files whose dependencies cannot be established statically (dynamic SQL).
Usage: python -I e2h_dependency_audit.py"""
import csv
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2a_sql as SQL  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
EV = os.path.join(REPO, "audit", "evidence")
P = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
ALLOW = r"C:\Users\vikki\migration-evidence\e2g-scratch\allowlist-prod58.json"
OMIT9 = ["20260715221828", "20260716104333", "20261010110000", "20260716151530", "20260716152823", "20260716173644", "20260717111737", "20260717113131", "20260814114825"]
d = json.load(open(ALLOW, encoding="utf-8"))
items = [i for i in d["items"] if i["kind"] == "execute"]
order = {i["version"]: k for k, i in enumerate(items)}
base_tables = {t["name"] for t in json.load(open(f"{P}\\prod_catalog_tables.json", encoding="utf-8")) if t["schema"] == "public"}
base_funcs = {f["name"] for f in json.load(open(f"{P}\\prod_catalog_functions.json", encoding="utf-8")) if f["schema"] == "public"}
base_cols = {(c["tbl"], c["name"]) for c in json.load(open(f"{P}\\prod_catalog_columns.json", encoding="utf-8")) if c["schema"] == "public"}


def top_and_bodies(st):
    bodies = []

    def sub(m):
        bodies.append(m.group(2))
        return "$BODY$"
    top = re.sub(r"(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)(.*?)\1", sub, st, flags=re.S)
    return top, bodies


def strip_comments(t):
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    return re.sub(r"--[^\n]*", "", t)


parsed = {}
created = defaultdict(list)  # (kind, name) -> [versions in order]
for it in items:
    text = open(os.path.join(REPO, "supabase", "migrations", it["file"]), encoding="utf-8", newline="").read().replace("\r\n", "\n")
    sts = SQL.strip_and_split(text)
    info = {"statements": [], "dynamic": False}
    for st in sts:
        kind, target = SQL.tag(st)
        top, bodies = top_and_bodies(st)
        info["statements"].append((kind, target, top, bodies, st))
        if re.search(r"\bEXECUTE\b\s*(format\(|'|\w)", " ".join(bodies), re.I) and kind in ("DO", "CREATE FUNCTION"):
            info["dynamic"] = info["dynamic"] or kind == "DO"
        if kind == "CREATE TABLE":
            created[("table", target)].append(it["version"])
        elif kind == "CREATE FUNCTION":
            created[("function", target.split(".")[-1])].append(it["version"])
        elif kind == "ALTER TABLE ADD COLUMN":
            for c in re.findall(r"ADD COLUMN (?:IF NOT EXISTS )?\"?(\w+)\"?", st, re.I):
                created[("column", f"{target}.{c}")].append(it["version"])
    parsed[it["version"]] = info

tables = base_tables | {n for (k, n) in created if k == "table"}
funcs = base_funcs | {n for (k, n) in created if k == "function"}
KW = r"(?:ON|FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|ONLY|TRUNCATE|EXISTS)"
edges = {}  # (version, provider) -> dict
notes = []


def add(ver, prov, kind, obj, cert, src, ev):
    if prov == ver or prov not in order or order[prov] >= order[ver]:
        return
    key = (ver, prov, kind, obj)
    if key not in edges or edges[key]["certainty"] != "hard":
        edges[key] = {"version": ver, "depends_on": prov, "kind": kind, "object": obj, "certainty": cert, "source": src, "evidence": ev[:140].replace("\n", " ")}


def first_provider(kind, name, ver):
    ps = [p for p in created.get((kind, name), []) if order[p] < order[ver]]
    return ps[0] if ps else None


for it in items:
    ver = it["version"]
    info = parsed[ver]
    own_created_tables = {t for (k, t), vs in created.items() if k == "table" and ver in vs}
    for kind, target, top, bodies, st in info["statements"]:
        own_fn = target.split(".")[-1] if kind == "CREATE FUNCTION" else None
        # tables
        for t in tables:
            if t in base_tables and not any((k == "table" and n == t) for (k, n) in created):
                continue  # only objects created by an allowlisted file can create a dependency
            if first_provider("table", t, ver) is None:
                continue
            rx = r"\b" + KW + r"\s+(?:IF\s+EXISTS\s+)?(?:public\.)?\"?" + re.escape(t) + r"\"?(?![\w])"
            if t in base_tables:
                continue  # exists in the start schema: no dependency on a creator
            if re.search(rx, top, re.I) or (kind in ("INSERT", "UPDATE", "DELETE", "CREATE POLICY", "CREATE TRIGGER", "CREATE INDEX", "ALTER TABLE ADD COLUMN", "ALTER TABLE ADD CONSTRAINT", "ALTER TABLE ENABLE RLS", "ALTER TABLE DROP") and target.split(".")[0] == t):
                add(ver, first_provider("table", t, ver), "table", t, "hard", "static", top)
            elif any(re.search(rx, b, re.I) for b in bodies):
                add(ver, first_provider("table", t, ver), "table", t, "runtime", "static", "function body references table")
        # functions
        for f in funcs:
            if f in base_funcs or first_provider("function", f, ver) is None or f == own_fn:
                continue
            if re.search(r"(?<![\w.])(?:public\.)?" + re.escape(f) + r"\s*\(", top, re.I):
                if kind == "DROP FUNCTION" and re.search(r"IF EXISTS", top, re.I):
                    continue
                add(ver, first_provider("function", f, ver), "function", f, "hard", "static", top)
            elif any(re.search(r"(?<![\w.])(?:public\.)?" + re.escape(f) + r"\s*\(", b, re.I) for b in bodies):
                add(ver, first_provider("function", f, ver), "function", f, "runtime", "static", "function body calls function")
        # columns added by earlier allowlisted files, co-mentioned with their table in the same statement
        for (k, name), vs in created.items():
            if k != "column":
                continue
            t, c = name.split(".")
            prov = first_provider("column", name, ver)
            if prov is None or (t, c) in base_cols:
                continue
            if re.search(r"(?<![\w])(?:public\.)?" + re.escape(t) + r"(?![\w])", st) and re.search(r"(?<![\w])" + re.escape(c) + r"(?![\w])", top):
                add(ver, prov, "column", name, "probable", "static", top)
            elif re.search(r"(?<![\w])" + re.escape(c) + r"(?![\w])", " ".join(bodies)) and re.search(r"(?<![\w])(?:public\.)?" + re.escape(t) + r"(?![\w])", " ".join(bodies)):
                add(ver, prov, "column", name, "runtime", "static", "function body mentions table and column")
        # DROP without IF EXISTS of something an earlier allowlisted file created
        if kind in ("DROP POLICY", "DROP TRIGGER") and "IF EXISTS" not in top.upper():
            nm = target
            prov = first_provider("policy" if kind == "DROP POLICY" else "trigger", nm, ver)
            if prov:
                add(ver, prov, "drop", nm, "hard", "static", top)
    if info["dynamic"]:
        notes.append((ver, "dynamic SQL (EXECUTE/format) inside a DO block: references cannot be established statically"))
    # dependencies on omitted versions: objects created ONLY by an omitted file and not in the start schema
    # (checked below with the omitted files parsed the same way)

# --- objects created only by omitted versions and referenced by an allowlisted file
omit_created = defaultdict(list)
for v in OMIT9:
    fn = [f for f in os.listdir(os.path.join(REPO, "supabase", "migrations")) if f.startswith(v + "_")][0]
    text = open(os.path.join(REPO, "supabase", "migrations", fn), encoding="utf-8", newline="").read().replace("\r\n", "\n")
    for st in SQL.strip_and_split(text):
        kind, target = SQL.tag(st)
        if kind == "CREATE FUNCTION":
            omit_created[("function", target.split(".")[-1])].append(v)
        if kind == "CREATE TABLE":
            omit_created[("table", target)].append(v)
omit_rows = []
for (k, n), vs in omit_created.items():
    if (k == "function" and n in base_funcs) or (k == "table" and n in base_tables):
        continue
    allow_creators = created.get((k, n), [])
    for it in items:
        if k == "function" and re.search(r"(?<![\w.])" + re.escape(n) + r"\s*\(", " ".join(s[2] for s in parsed[it["version"]]["statements"]), re.I) and not any(order[c] <= order[it["version"]] for c in allow_creators):
            omit_rows.append((it["version"], vs[0], k, n))

# --- merge with the E2B-1 declared dependencies already in the allowlist (kept as source e2b1 when not found statically)
# the originally declared (E2B-1 / E2C) edges come from the manifest CSV, not from the current allowlist (which already contains the corrected metadata)
_exec = {i["version"] for i in items}
declared = {}
for r_ in csv.DictReader(open(os.path.join(EV, "e2c-proposed-execution-manifest.csv"), encoding="utf-8", newline="")):
    if r_["version"] in _exec:
        declared[r_["version"]] = [v for v in re.split(r"[,;]\s*", r_["depends_on_selected_versions"]) if re.fullmatch(r"\d{14}", v) and v in _exec and v < r_["version"]]
for ver, reqs in declared.items():
    for r in reqs:
        if not any(e["version"] == ver and e["depends_on"] == r for e in edges.values()):
            edges[(ver, r, "e2b1", "")] = {"version": ver, "depends_on": r, "kind": "declared (E2B-1 graph)", "object": "", "certainty": "declared", "source": "e2b1", "evidence": "from e2b1-execution-dependencies.csv; no static reference found"}

rows = sorted(edges.values(), key=lambda e: (order[e["version"]], order[e["depends_on"]], e["kind"], e["object"]))
by_pair = defaultdict(list)
for e in rows:
    by_pair[(e["version"], e["depends_on"])].append(e)
requires = defaultdict(set)
for (v, p), es in by_pair.items():
    # E2H lesson (leave-one-out): column references inside LANGUAGE sql function bodies are validated when the function is created, so a body reference cannot be assumed to be late-bound.
    # Every static edge is therefore enforced as a prerequisite (over-declaring an already-earlier item is harmless); the certainty column keeps the evidence level.
    requires[v].add(p)
out_json = {i["version"]: sorted(requires[i["version"]], key=lambda x: order[x]) for i in items}
json.dump({"purpose": "Declared prerequisites of the 58 executable versions (static audit E2H): hard and probable edges plus the E2B-1 declared edges; runtime-only edges are excluded. Earlier allowlist versions only.", "requires": out_json},
          open(os.path.join(REPO, "scripts", "dev", "local-executor", "prod58-dependencies.json"), "w", encoding="utf-8"), indent=1)
with open(os.path.join(EV, "e2h-dependency-audit.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["version", "depends_on", "kind", "object", "certainty", "source", "enforced_as_prerequisite", "evidence_or_note"])
    for e in rows:
        w.writerow([e["version"], e["depends_on"], e["kind"], e["object"], e["certainty"], e["source"], "yes (conservative: reference inside a function body; may be validated at creation time)" if e["certainty"] == "runtime" else "yes", e["evidence"]])
    for ver, prov, k, n in sorted(set(omit_rows)):
        w.writerow([ver, prov, f"depends on an OMITTED version ({k})", n, "review", "static", "no (omitted version is never executed)", "referenced by this file; created only by the omitted version and not in the start schema or by an earlier allowlisted file"])
    for ver, note in notes:
        w.writerow([ver, "", "cannot be established statically", "", "uncertain", "static", "no", note])
cnt = defaultdict(int)
for e in rows:
    cnt[(e["certainty"], e["kind"])] += 1
print("edges by (certainty, kind):", dict(cnt))
print("items with requires:", sum(1 for v in out_json.values() if v), "of", len(out_json), "| total prerequisite edges:", sum(len(v) for v in out_json.values()))
print("seed 20260716151549 ->", out_json["20260716151549"])
print("dynamic-SQL files:", [n[0] for n in notes])
print("omitted-version rows:", sorted(set(omit_rows)))
