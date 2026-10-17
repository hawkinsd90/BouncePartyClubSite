"""Stage D3: static scan of the 67 upgrade migrations for statements whose behaviour depends on existing rows (input for Stage D4).
Reads migration files only. Statements inside CREATE FUNCTION bodies run when the function is called, not when the migration runs, so they are
only counted; DO blocks and top-level statements run at migration time and are listed with line numbers.
Usage: python -I d3_data_scan.py <out.md>"""
import json
import os
import re
import sys

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
man = json.load(open(r"C:\Users\vikki\migration-evidence\d3-scratch\d3-upgrade-manifest.json", encoding="utf-8"))
PATTERNS = [
    ("DELETE", r"\bDELETE\s+FROM\b"), ("UPDATE", r"\bUPDATE\s+[\w\.\"]+\s+SET\b"), ("INSERT", r"\bINSERT\s+INTO\b"), ("TRUNCATE", r"\bTRUNCATE\b"),
    ("UNIQUE index/constraint (fails on duplicate rows)", r"\bCREATE\s+UNIQUE\s+INDEX\b|\bADD\s+CONSTRAINT\s+\w+\s+UNIQUE\b"),
    ("CHECK constraint added (validated unless NOT VALID)", r"\bADD\s+CONSTRAINT\s+\w+\s+CHECK\b"), ("FOREIGN KEY added", r"\bFOREIGN\s+KEY\b"),
    ("VALIDATE CONSTRAINT", r"\bVALIDATE\s+CONSTRAINT\b"), ("SET NOT NULL", r"\bSET\s+NOT\s+NULL\b"), ("NOT VALID (validation deferred)", r"\bNOT\s+VALID\b"),
    ("column type change", r"\bALTER\s+COLUMN\s+\w+\s+(SET\s+DATA\s+)?TYPE\b"), ("RAISE EXCEPTION guard (DO block)", r"\bRAISE\s+EXCEPTION\b"),
    ("column default change", r"\bSET\s+DEFAULT\b"), ("storage.buckets change", r"storage\.buckets"),
]
RUNTIME = re.compile(r"\b(INSERT\s+INTO|UPDATE\s+[\w\.\"]+\s+SET|DELETE\s+FROM)\b", re.I)
out = ["# D3 data-dependent behaviours of the 67 upgrade migrations (input for Stage D4)", "",
       "Static scan of the migration files. A statement listed here changes, rejects or depends on existing rows when the migration runs; the D3 snapshot was schema-only, so none of it was exercised against real data. Line numbers refer to the file. Statements inside function bodies run later, when the function is called, and are only counted.", ""]
summary = {}
for r in man["upgrade"]:
    src = open(os.path.join(REPO, "supabase", "migrations", r["file"]), encoding="utf-8", errors="replace", newline="").read().replace("\r\n", "\n")
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), src, flags=re.S)
    found, runtime_dml = [], 0
    in_body, tag, kind, last = False, None, None, None
    for i, ln in enumerate(src.split("\n"), 1):
        code = ln.split("--")[0]
        if not in_body:
            if re.search(r"\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b", code, re.I):
                last = "FUNCTION"
            elif re.match(r"^\s*DO\b", code, re.I):
                last = "DO"
            m = re.search(r"(\$[A-Za-z_]*\$)", code)
            if m and code.count(m.group(1)) % 2 == 1:
                in_body, tag, kind = True, m.group(1), (last or "FUNCTION")
                continue
        else:
            if tag in code:
                in_body = False
                continue
            if kind == "FUNCTION":
                if RUNTIME.search(code):
                    runtime_dml += 1
                continue
        for label, rx in PATTERNS:
            if label.startswith("RAISE") and not (in_body and kind == "DO"):
                continue
            if re.search(rx, code, re.I):
                found.append((label, i, " ".join(code.split())[:110]))
    if runtime_dml:
        summary["DML inside function bodies (runtime only)"] = summary.get("DML inside function bodies (runtime only)", 0) + runtime_dml
    if found:
        out.append(f"## {r['version']} {r['file'][15:]}  ({r['group']}, data statements {r['data_stmts_ins_upd_del_trunc']})")
        seen = set()
        for label, i, s in found:
            if (label, i) in seen:
                continue
            seen.add((label, i))
            summary[label] = summary.get(label, 0) + 1
            out.append(f"- L{i} [{label}] `{s}`")
        out.append("")
out.insert(4, "Totals by kind: " + "; ".join(f"{k}: {v}" for k, v in sorted(summary.items())) + "\n")
open(sys.argv[1], "w", encoding="utf-8").write("\n".join(out) + "\n")
print(summary)
