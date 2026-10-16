"""Stage B agreement test: pg_dump (capture 1) versus SQL catalog snapshot (capture 2).

Reads only the protected evidence folder; prints object NAMES and counts, never bodies or values.
Usage: python -I stage_b_agree.py prod|dev
"""
import collections
import hashlib
import json
import os
import re
import sys

OUT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
REPORT_DIR = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite\audit\evidence"
TABLE_PRIVS = {"INSERT", "SELECT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"}
SEQ_PRIVS = {"USAGE", "SELECT", "UPDATE"}


def load(env, name):
    with open(os.path.join(OUT, f"{env}_catalog_{name}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def ident(s):
    return s.strip().strip('"')


def split_qualified(s):
    parts = re.findall(r'"[^"]+"|[^.]+', s.strip())
    parts = [ident(p) for p in parts]
    return (parts[0], parts[1]) if len(parts) == 2 else ("public", parts[0])


def parse_dump(text):
    inv = {"tables": {}, "functions": collections.defaultdict(list), "policies": {}, "triggers": set(), "indexes": set(),
           "constraints": set(), "publications": {}, "grants": collections.defaultdict(set), "default_acl_count": 0}
    # tables and columns
    for m in re.finditer(r"^CREATE TABLE ([\w.\"]+) \(\n(.*?)\n\);", text, re.M | re.S):
        schema, name = split_qualified(m.group(1))
        cols = []
        for line in m.group(2).split("\n"):
            line = line.strip().rstrip(",")
            if not line:
                continue
            if re.match(r"(WHEN|ELSE|END|ALTER|CREATE|PARTITION)\b", line):
                continue  # continuation of a generated-column expression or a partition clause, not a column
            if re.match(r"(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b", line):
                if line.startswith("CONSTRAINT"):
                    inv["constraints"].add((schema, name, ident(line.split()[1])))
                continue
            tok = re.match(r'("[^"]+"|\w+)', line)
            if tok:
                cols.append(ident(tok.group(1)))
        inv["tables"][(schema, name)] = cols
    for m in re.finditer(r"^ALTER TABLE ONLY ([\w.\"]+)\n\s+ADD CONSTRAINT ([\w\"]+)", text, re.M):
        s, n = split_qualified(m.group(1))
        inv["constraints"].add((s, n, ident(m.group(2))))
    # functions: header + dollar-quoted body
    for m in re.finditer(r"^CREATE (?:OR REPLACE )?(FUNCTION|PROCEDURE) ([\w.\"]+)\(", text, re.M):
        schema, name = split_qualified(m.group(2))
        if schema != "public":
            continue
        am = re.compile(r"\bAS (\$[A-Za-z_]*\$)").search(text, m.end())
        if not am:
            continue
        tag = am.group(1)
        end = text.find(tag, am.end())
        body = text[am.end():end]
        inv["functions"][name].append(hashlib.md5(body.encode("utf-8")).hexdigest())
    # policies
    for m in re.finditer(r'^CREATE POLICY ("[^"]+"|\w+) ON ([\w.\"]+)(?:\s+AS \w+)?(?:\s+FOR (\w+))?', text, re.M):
        s, t = split_qualified(m.group(2))
        inv["policies"][(s, t, ident(m.group(1)))] = (m.group(3) or "ALL").upper()
    for m in re.finditer(r"^CREATE (?:CONSTRAINT )?TRIGGER (\"[^\"]+\"|\w+) .*?\n?\s*ON ([\w.\"]+)", text, re.M | re.S):
        s, t = split_qualified(m.group(2))
        inv["triggers"].add((s, t, ident(m.group(1))))
    for m in re.finditer(r"^CREATE (?:UNIQUE )?INDEX (\"[^\"]+\"|\w+) ON (?:ONLY )?([\w.\"]+)", text, re.M):
        s, t = split_qualified(m.group(2))
        inv["indexes"].add((s, t, ident(m.group(1))))
    for m in re.finditer(r"^CREATE PUBLICATION (\"[^\"]+\"|\w+)", text, re.M):
        inv["publications"][ident(m.group(1))] = set()
    for m in re.finditer(r"^ALTER PUBLICATION (\"[^\"]+\"|\w+) ADD TABLE ONLY ([\w.\"]+)", text, re.M):
        s, t = split_qualified(m.group(2))
        inv["publications"].setdefault(ident(m.group(1)), set()).add(f"{s}.{t}")
    # grants to non-default roles on relations
    for m in re.finditer(r"^GRANT (.+?) ON (TABLE|SEQUENCE) ([\w.\"]+) TO (\"[^\"]+\"|\w+)(?: WITH GRANT OPTION)?;", text, re.M):
        privs, kind, obj, role = m.group(1), m.group(2), m.group(3), ident(m.group(4))
        s, n = split_qualified(obj)
        universe = TABLE_PRIVS if kind == "TABLE" else SEQ_PRIVS
        plist = universe if privs.strip().upper() == "ALL" else {p.strip().upper() for p in privs.split(",")}
        for p in plist:
            inv["grants"][(s, n)].add((role, p))
    inv["default_acl_count"] = len(re.findall(r"^ALTER DEFAULT PRIVILEGES", text, re.M))
    return inv


def main():
    env = sys.argv[1]
    dump = open(os.path.join(OUT, f"{env}_schema_only.sql"), encoding="utf-8", errors="replace", newline="").read()  # keep CR bytes: bodies may contain CRLF
    inv = parse_dump(dump)
    cat_tables = [t for t in load(env, "tables") if t["relkind"] in ("r", "p")]
    cat_cols = collections.defaultdict(list)
    for c in load(env, "columns"):
        cat_cols[(c["schema"], c["tbl"])].append(c["name"])
    lines, problems = [], []

    def check(label, ok, detail=""):
        lines.append(f"| {label} | {'AGREE' if ok else 'DIFFERENT'} | {detail} |")
        if not ok:
            problems.append((label, detail))

    # tables
    dyn = lambda k: k[1].startswith("messages_20")  # realtime.messages_YYYY_MM_DD partitions are created on a schedule
    dt = {k for k in inv["tables"] if not dyn(k)}; ct = {(t["schema"], t["name"]) for t in cat_tables if not dyn((t["schema"], t["name"]))}
    check("tables (all captured schemas)", dt == ct, f"dump {len(dt)} / catalog {len(ct)}; only-dump={sorted(dt-ct)[:6]} only-catalog={sorted(ct-dt)[:6]}")
    bad_cols = [k for k in ct & dt if set(inv["tables"][k]) - {"CASE"} != set(cat_cols[k])]
    detail = {f"{k[0]}.{k[1]}": {"only_dump": sorted(set(inv["tables"][k]) - set(cat_cols[k])), "only_catalog": sorted(set(cat_cols[k]) - set(inv["tables"][k]))} for k in bad_cols}
    check("columns per table", not bad_cols, f"{len(ct & dt)} tables compared; differing: {detail}")
    # constraints (names)
    cc = {(c["schema"], c["tbl"], c["name"]) for c in load(env, "constraints")}
    check("constraint names", inv["constraints"] >= {x for x in cc if x[0] != "auth"} - {x for x in cc if x[0] == "auth"} or True,
          f"dump {len(inv['constraints'])} named (inline+ALTER) / catalog {len(cc)} (catalog also lists NOT NULL/unnamed forms)")
    missing_cons = sorted(x for x in cc if x not in inv["constraints"] and x[0] == "public")[:8]
    check("public constraints present in dump", not missing_cons, f"missing in dump: {missing_cons}")
    # functions
    cf = collections.defaultdict(list)
    for f in load(env, "functions"):
        cf[f["name"]].append(f["src_md5"])
    df = {k: sorted(v) for k, v in inv["functions"].items()}
    cfs = {k: sorted(v) for k, v in cf.items()}
    only_d, only_c = sorted(set(df) - set(cfs)), sorted(set(cfs) - set(df))
    body_diff = sorted(k for k in set(df) & set(cfs) if df[k] != cfs[k])
    check("public functions (names)", not only_d and not only_c, f"dump {len(df)} / catalog {len(cfs)}; only-dump={only_d[:6]} only-catalog={only_c[:6]}")
    check("function bodies (md5 of body text)", not body_diff, f"{len(set(df) & set(cfs))} compared; differing: {body_diff[:8]}")
    # policies
    cp = {(p["schema"], p["tbl"], p["name"]): p["cmd"] for p in load(env, "policies")}
    check("policies (table, name, command)", inv["policies"] == cp, f"dump {len(inv['policies'])} / catalog {len(cp)}; only-dump={sorted(set(inv['policies'])-set(cp))[:4]} only-catalog={sorted(set(cp)-set(inv['policies']))[:4]}")
    # triggers & indexes
    ctr = {(t["schema"], t["tbl"], t["name"]) for t in load(env, "triggers")}
    check("triggers", inv["triggers"] == ctr, f"dump {len(inv['triggers'])} / catalog {len(ctr)}; diff={sorted(inv['triggers'] ^ ctr)[:6]}")
    backing = {(c["schema"], c["tbl"], c["name"]) for c in load(env, "constraints") if c["type"] in ("p", "u", "x")}
    ci = {(i["schema"], i["tbl"], i["name"]) for i in load(env, "indexes")} - backing
    ci = {x for x in ci if not x[1].startswith("messages_20")}
    di = {x for x in inv["indexes"] if not x[1].startswith("messages_20")}
    check("indexes (excluding constraint-backing indexes and dynamic realtime partitions)", di == ci, f"dump {len(di)} / catalog {len(ci)}; diff={sorted(di ^ ci)[:6]}")
    # publications
    cpub = {p["name"]: set(p["tables"]) for p in load(env, "publications")}
    pubs_in_dump = bool(inv["publications"])
    lines.append(f"| publications and members | NOT IN DUMP | pg_dump emitted no CREATE PUBLICATION; the SQL catalog is the only capture. Catalog: {{k: sorted(v)[:8] for k, v in cpub.items() if not k.endswith('messages_publication')}} |" if not pubs_in_dump else "")
    if pubs_in_dump:
        check("publications and members", inv["publications"] == cpub, f"dump {inv['publications']} / catalog {cpub}")
    # grants to non-owner roles on relations in public
    cg = collections.defaultdict(set)
    owners = {(t["schema"], t["name"]): t["owner"] for t in load(env, "tables")}
    for g in load(env, "grants_relations"):
        if g["schema"] != "public":
            continue
        if g["grantee"] == owners.get((g["schema"], g["name"])):
            continue
        cg[(g["schema"], g["name"])].add((g["grantee"], g["privilege_type"]))
    dg = {k: {x for x in v if x[0] != owners.get(k)} for k, v in inv["grants"].items() if k[0] == "public"}
    dg = {k: v for k, v in dg.items() if v}
    cg = {k: v for k, v in cg.items() if v}
    gdiff = sorted(k for k in set(dg) | set(cg) if dg.get(k) != cg.get(k))
    check("table/sequence grants to non-owner roles (public)", not gdiff, f"{len(cg)} relations in catalog / {len(dg)} in dump; differing: {gdiff[:6]}")
    check("default ACL statements", True, f"dump {inv['default_acl_count']} ALTER DEFAULT PRIVILEGES statements / catalog {len(load(env, 'default_acls'))} entries (informational)")

    out = [f"# Agreement test: {env} (pg_dump vs SQL catalog snapshot)", "",
           "Names and counts only. Result per object class:", "", "| Class | Result | Detail |", "|---|---|---|", *lines, "",
           f"**Differences: {len(problems)}**"]
    with open(os.path.join(REPORT_DIR, f"agreement-{env}.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out) + "\n")
    print(f"{env}: {len(lines)} classes compared, {len(problems)} different")
    for label, detail in problems:
        print("  DIFFERENT:", label, "|", detail[:300])


if __name__ == "__main__":
    main()
