"""Stage B per-version classification.

Inputs : supabase/migrations/*.sql (read only) + the protected catalog snapshots / history exports (read only).
Outputs: audit/evidence/*.csv and drift-register data (names, versions, verdicts only; no secrets, no table data).

Method (static, deterministic): every migration is tokenised (comments, strings and function bodies masked), its schema events
(table/column/constraint/index/policy/function/trigger/publication/bucket) are extracted in version order, and each event is tested
against the catalog snapshot of an environment. A missing object is "superseded" only when a LATER file drops/renames it.
Dynamic SQL (EXECUTE format(...)) cannot be evaluated and is flagged, never guessed.
"""
import collections
import csv
import hashlib
import json
import os
import re
import sys

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
MIG = os.path.join(REPO, "supabase", "migrations")
EVID = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUTDIR = os.path.join(REPO, "audit", "evidence")
NAME = r'(?:"[^"]+"|[A-Za-z_][\w$]*)'
QNAME = rf'(?:{NAME}\.)?{NAME}'
WS = re.compile(r"[ \t\n\r\v\f]+")


def norm_ident(tok):
    tok = tok.strip()
    return tok[1:-1] if tok.startswith('"') else tok.lower()


def split_q(q):
    parts = re.findall(rf"{NAME}", q)
    parts = [norm_ident(p) for p in parts]
    return (parts[-2] if len(parts) > 1 else "public", parts[-1])


# ---------------------------------------------------------------------------------------------------------------------
# tokeniser: comments removed, strings blanked, function bodies captured, DO bodies inlined and flagged
# ---------------------------------------------------------------------------------------------------------------------
def mask(text):
    out, bodies, dyn = [], [], False
    cond = []  # (start, end) ranges in `out` coordinates that are inside DO blocks
    i, n = 0, len(text)
    buf_len = lambda: sum(len(x) for x in out)
    stmt_prefix = ""

    def push(s):
        nonlocal stmt_prefix
        out.append(s)
        stmt_prefix = (stmt_prefix + s)
        if ";" in s:
            stmt_prefix = stmt_prefix.rsplit(";", 1)[1]

    while i < n:
        c = text[i]
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            push(" ")
        elif text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'" and text[j + 1:j + 2] == "'":
                    j += 2
                elif text[j] == "'":
                    break
                else:
                    j += 1
            push("'S'")
            i = j + 1
        elif c == '"':
            j = text.find('"', i + 1)
            push(text[i:j + 1])
            i = j + 1
        elif c == "$":
            m = re.match(r"\$([A-Za-z_][\w]*)?\$", text[i:])
            if m:
                tag = m.group(0)
                j = text.find(tag, i + len(tag))
                inner = text[i + len(tag):j]
                head = stmt_prefix.strip().upper()
                if head.startswith("DO"):
                    start = buf_len()
                    sub, _, subdyn, _ = mask(inner)
                    dyn = dyn or subdyn or bool(re.search(r"\bEXECUTE\b", sub, re.I))
                    push(" " + sub + " ")
                    cond.append((start, buf_len()))
                else:
                    bodies.append(inner)
                    push(f" $BODY{len(bodies) - 1}$ ")
                i = j + len(tag)
            else:
                push(c)
                i += 1
        else:
            push(c)
            i += 1
    return "".join(out), bodies, dyn, cond


def depth0_split(s):
    parts, d, cur = [], 0, []
    for ch in s:
        if ch == "(":
            d += 1
        elif ch == ")":
            d -= 1
        if ch == "," and d == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return [p.strip() for p in parts if p.strip()]


def body_md5(body):
    return hashlib.md5(re.sub(r"[ \t\n\r\v\f]+", "", body).encode("utf-8")).hexdigest()


def body_md5_nc(body):
    """Same, after removing /* */ and -- comments (matches the server-side src_nocomment_md5)."""
    x = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    x = re.sub(r"--[^\n]*", "", x)
    return hashlib.md5(re.sub(r"[ \t\n\r\f\v]+", "", x).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------------------------------------------------
def parse_file(path, version):
    raw = open(path, encoding="utf-8", errors="replace", newline="").read()
    clean, bodies, dyn, cond = mask(raw)
    ev = []  # (kind, key tuple, conditional, extra)

    def is_cond(pos):
        return any(a <= pos < b for a, b in cond)

    # tables (+ columns, named constraints)
    for m in re.finditer(rf"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?({QNAME})\s*\(", clean, re.I):
        schema, tbl = split_q(m.group(2))
        gid = (version, m.start())
        ine = bool(m.group(1))
        depth, j = 1, m.end()
        while j < len(clean) and depth:
            depth += {"(": 1, ")": -1}.get(clean[j], 0)
            j += 1
        inner = clean[m.end():j - 1]
        c = is_cond(m.start())
        ev.append(("table_create", (tbl,), c, {"ine": ine, "gid": gid}))
        for el in depth0_split(inner):
            up = el.upper()
            cm = re.search(rf"\bCONSTRAINT\s+({NAME})", el, re.I)
            if cm:
                ev.append(("constraint_add", (tbl, norm_ident(cm.group(1))), c, {"gid": gid}))
            if re.match(r"(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|LIKE)\b", up):
                continue
            tok = re.match(NAME, el)
            if tok:
                ev.append(("column_add", (tbl, norm_ident(tok.group(0))), c, {"gid": gid}))
    for m in re.finditer(rf"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+)", clean, re.I):
        for q in re.findall(QNAME, re.sub(r"\bCASCADE\b|\bRESTRICT\b", "", m.group(1), flags=re.I)):
            ev.append(("table_drop", (split_q(q)[1],), is_cond(m.start()), None))
    # alter table
    for m in re.finditer(rf"\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?({QNAME})\s+([^;]*)", clean, re.I):
        tbl = split_q(m.group(1))[1]
        c = is_cond(m.start())
        for act in depth0_split(m.group(2)):
            a = re.match(rf"ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?({NAME})", act, re.I)
            if a:
                ev.append(("column_add", (tbl, norm_ident(a.group(1))), c, None)); continue
            a = re.match(rf"ADD\s+CONSTRAINT\s+({NAME})", act, re.I)
            if a:
                ev.append(("constraint_add", (tbl, norm_ident(a.group(1))), c, None)); continue
            if re.match(r"ADD\s+(PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b", act, re.I):
                continue
            a = re.match(rf"ADD\s+({NAME})\s+\w", act, re.I)
            if a and a.group(1).upper() not in ("CONSTRAINT", "COLUMN"):
                ev.append(("column_add", (tbl, norm_ident(a.group(1))), c, None)); continue
            a = re.match(rf"DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?({NAME})", act, re.I)
            if a:
                ev.append(("column_drop", (tbl, norm_ident(a.group(1))), c, None)); continue
            a = re.match(rf"DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?({NAME})", act, re.I)
            if a:
                ev.append(("constraint_drop", (tbl, norm_ident(a.group(1))), c, None)); continue
            a = re.match(rf"RENAME\s+COLUMN\s+({NAME})\s+TO\s+({NAME})", act, re.I)
            if a:
                ev.append(("column_drop", (tbl, norm_ident(a.group(1))), c, None))
                ev.append(("column_add", (tbl, norm_ident(a.group(2))), c, None)); continue
            a = re.match(rf"RENAME\s+TO\s+({NAME})", act, re.I)
            if a:
                ev.append(("table_drop", (tbl,), c, None))
                ev.append(("table_create", (norm_ident(a.group(1)),), c, None))
    # indexes
    for m in re.finditer(rf"\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?({NAME})\s+ON\s+(?:ONLY\s+)?({QNAME})", clean, re.I):
        ev.append(("index_create", (norm_ident(m.group(1)),), is_cond(m.start()), split_q(m.group(2))[1]))
    for m in re.finditer(rf"\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([^;]+)", clean, re.I):
        for q in re.findall(QNAME, re.sub(r"\bCASCADE\b|\bRESTRICT\b", "", m.group(1), flags=re.I)):
            ev.append(("index_drop", (split_q(q)[1],), is_cond(m.start()), None))
    # policies
    for m in re.finditer(rf"\bCREATE\s+POLICY\s+({NAME})\s+ON\s+({QNAME})", clean, re.I):
        ev.append(("policy_create", (split_q(m.group(2))[1], norm_ident(m.group(1))), is_cond(m.start()), None))
    for m in re.finditer(rf"\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?({NAME})\s+ON\s+({QNAME})", clean, re.I):
        ev.append(("policy_drop", (split_q(m.group(2))[1], norm_ident(m.group(1))), is_cond(m.start()), None))
    # functions
    for m in re.finditer(rf"\bCREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+({QNAME})\s*\(", clean, re.I):
        bm = re.search(r"\$BODY(\d+)\$", clean[m.end():])
        md5 = (body_md5(bodies[int(bm.group(1))]), body_md5_nc(bodies[int(bm.group(1))])) if bm else None
        ev.append(("function_create", (split_q(m.group(2))[1],), is_cond(m.start()), md5))
    for m in re.finditer(rf"\bDROP\s+(?:FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?({QNAME})", clean, re.I):
        ev.append(("function_drop", (split_q(m.group(1))[1],), is_cond(m.start()), None))
    # triggers
    for m in re.finditer(rf"\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+({NAME})[^;]*?\bON\s+({QNAME})", clean, re.I | re.S):
        ev.append(("trigger_create", (split_q(m.group(2))[1], norm_ident(m.group(1))), is_cond(m.start()), None))
    for m in re.finditer(rf"\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?({NAME})\s+ON\s+({QNAME})", clean, re.I):
        ev.append(("trigger_drop", (split_q(m.group(2))[1], norm_ident(m.group(1))), is_cond(m.start()), None))
    # publication membership
    for m in re.finditer(rf"\bALTER\s+PUBLICATION\s+({NAME})\s+(ADD|DROP)\s+TABLE\s+([^;]+)", clean, re.I):
        for q in re.findall(QNAME, re.sub(r"\bONLY\b", "", m.group(3), flags=re.I)):
            ev.append(("publication_add" if m.group(2).upper() == "ADD" else "publication_drop", (norm_ident(m.group(1)), split_q(q)[1]), is_cond(m.start()), None))
    # storage buckets (string literal content needs the raw text)
    for m in re.finditer(r"INSERT\s+INTO\s+storage\.buckets\s*\([^)]*\)\s*VALUES\s*\(\s*'([^']+)'", raw, re.I):
        ev.append(("bucket_insert", (m.group(1),), False, None))
    # extensions
    for m in re.finditer(rf"\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?({NAME})", clean, re.I):
        ev.append(("extension_create", (norm_ident(m.group(1)),), is_cond(m.start()), None))
    # statement counters outside function bodies
    stmts = [s.strip() for s in clean.split(";")]
    cnt = collections.Counter()
    for s in stmts:
        u = s.upper().lstrip()
        for key, rx in (("insert", r"INSERT\s+INTO"), ("update", r"UPDATE\s"), ("delete", r"DELETE\s+FROM"),
                        ("grant", r"GRANT\s"), ("revoke", r"REVOKE\s"), ("truncate", r"TRUNCATE\s")):
            if re.match(rx, u):
                cnt[key] += 1
    cnt["dynamic_sql"] = int(dyn or bool(re.search(r"\bEXECUTE\s+format\b", clean, re.I)))
    return ev, cnt, raw


# ---------------------------------------------------------------------------------------------------------------------
def load(env, name):
    with open(os.path.join(EVID, f"{env}_catalog_{name}.json"), encoding="utf-8") as fh:
        return json.load(fh)


class Snapshot:
    def __init__(self, env):
        self.env = env
        self.tables = {t["name"] for t in load(env, "tables") if t["schema"] == "public" and t["relkind"] in ("r", "p")}
        self.cols = {(c["tbl"], c["name"]) for c in load(env, "columns") if c["schema"] == "public"}
        self.cons = {(c["tbl"], c["name"]) for c in load(env, "constraints") if c["schema"] in ("public", "storage", "auth")}
        self.idx = {i["name"] for i in load(env, "indexes") if i["schema"] in ("public", "storage")}
        self.pol = {(p["tbl"], p["name"]) for p in load(env, "policies") if p["schema"] in ("public", "storage")}
        self.trg = {(t["tbl"], t["name"]) for t in load(env, "triggers") if t["schema"] in ("public", "storage", "auth")}
        self.fn = collections.defaultdict(set)
        self.fn_nc = collections.defaultdict(set)
        for f in load(env, "functions"):
            self.fn[f["name"]].add(f["src_norm_md5"])
            self.fn_nc[f["name"]].add(f["src_nocomment_md5"])
        self.pub = collections.defaultdict(set)
        for p in load(env, "publications"):
            self.pub[p["name"]] = {t.split(".")[1] for t in p["tables"]}
        self.buckets = {b["id"] for b in load(env, "storage_buckets")}
        self.ext = {e["name"] for e in load(env, "extensions")}
        self.hist = {h["version"]: h for h in load(env, "history")}


KIND_DROP = {"table_create": ["table_drop"], "column_add": ["column_drop", "table_drop"], "constraint_add": ["constraint_drop", "table_drop", "column_drop"],
             "index_create": ["index_drop", "table_drop"], "policy_create": ["policy_drop", "table_drop"], "trigger_create": ["trigger_drop", "table_drop"],
             "function_create": ["function_drop"], "publication_add": ["publication_drop", "table_drop"]}


def exists(snap, kind, key, extra):
    if kind == "table_create":
        return key[0] in snap.tables
    if kind == "column_add":
        return key in snap.cols
    if kind == "constraint_add":
        return key in snap.cons
    if kind == "index_create":
        return key[0] in snap.idx
    if kind == "policy_create":
        return key in snap.pol
    if kind == "trigger_create":
        return key in snap.trg
    if kind == "function_create":
        return key[0] in snap.fn
    if kind == "publication_add":
        return key[1] in snap.pub.get(key[0], set())
    if kind == "bucket_insert":
        return key[0] in snap.buckets
    if kind == "extension_create":
        return key[0] in snap.ext
    return True


REDEF_KINDS = {"constraint_add": "constraint_drop", "policy_create": "policy_drop", "trigger_create": "trigger_drop", "index_create": "index_drop"}


def superseders(events_by_ver, versions_sorted, v, kind, key):
    """First LATER version that drops/renames this object (or, for functions, redefines it); else None.
    For name-only kinds (constraint/policy/trigger/index) a later CREATE of the same name also counts: it redefines the object."""
    drops = KIND_DROP.get(kind, [])
    for w in versions_sorted:
        if w <= v:
            continue
        for (k2, key2, _c, _x) in events_by_ver[w]:
            if k2 not in drops and not (kind == "function_create" and k2 == "function_create") and not (kind in REDEF_KINDS and k2 == kind):
                continue
            if k2 == "table_drop":
                hit = key2[0] == key[0]
            else:
                hit = key2 == key
            if hit:
                return w
    return None


def classify(env, files, parsed, hist_versions, applied_set):
    snap = Snapshot(env)
    versions = sorted(parsed)
    # CREATE TABLE IF NOT EXISTS on a table that already exists is a no-op: its column/constraint events are not effects
    alive, skip, ev_by = set(), set(), {}
    for v in versions:
        for k, key, c, x in parsed[v][0]:
            if k == "table_create":
                if isinstance(x, dict) and x.get("ine") and key[0] in alive:
                    skip.add(x["gid"])
                alive.add(key[0])
            elif k == "table_drop":
                alive.discard(key[0])
        ev_by[v] = [e for e in parsed[v][0] if not (e[0] in ("column_add", "constraint_add") and isinstance(e[3], dict) and e[3].get("gid") in skip)]
    rows = {}
    for v in versions:
        st = collections.Counter()
        missing_items, super_items, chain_items, comment_only, unverified_items = [], [], [], [], []
        for k, key, c, extra in ev_by[v]:
            if k not in KIND_DROP and k not in ("bucket_insert", "extension_create"):
                continue
            label = f"{k}:{'.'.join(key)}"
            ok = exists(snap, k, key, None)
            if ok and k == "function_create" and isinstance(extra, tuple) and extra[0] not in snap.fn[key[0]]:
                if extra[1] in snap.fn_nc[key[0]]:
                    comment_only.append(key[0])  # identical apart from comments/whitespace: effect present
                else:
                    ok = False
                    label = f"function_body_differs:{key[0]}"
            w = superseders(ev_by, versions, v, k, key)
            if ok and k in REDEF_KINDS:
                if w and w in applied_set:
                    st["superseded"] += 1  # a later applied file redefines this name: the live definition belongs to it
                    super_items.append(f"{label}->{w}")
                    continue
                if any(e[0] == REDEF_KINDS[k] and e[1] == key for e in ev_by[v]):
                    st["unverified"] += 1  # same file drops and re-creates this name: name-level presence proves nothing about its definition
                    unverified_items.append(label)
                    continue
            if ok:
                st["present"] += 1
                continue
            if w and w in applied_set:
                st["superseded"] += 1
                super_items.append(f"{label}->{w}")
            elif w and v not in applied_set:
                st["chain"] += 1
                chain_items.append(f"{label}->{w}")
            else:
                st["missing"] += 1
                st["cond_missing"] += int(c)
                missing_items.append(label + ("*" if c else ""))
        total = st["present"] + st["superseded"] + st["chain"] + st["missing"] + st["unverified"]
        if total == 0:
            verdict = "NO_CATALOG_EFFECT"
        elif st["missing"]:
            verdict = "ABSENT" if st["present"] + st["superseded"] + st["chain"] + st["unverified"] == 0 else "PARTIAL"
        elif st["chain"]:
            verdict = "PENDING_CHAIN"
        elif st["unverified"]:
            verdict = "PRESENT_NAME_LEVEL"
        elif st["superseded"]:
            verdict = "SUPERSEDED"
        else:
            verdict = "PRESENT"
        rows[v] = dict(events=total, present=st["present"], superseded=st["superseded"], chain=st["chain"], missing=st["missing"],
                       unverified=st["unverified"], unverified_items=unverified_items,
                       cond_missing=st["cond_missing"], missing_items=missing_items, super_items=super_items, chain_items=chain_items,
                       body_drift=[], comment_only_functions=sorted(set(comment_only)), verdict=verdict)
    return snap, rows


def file_norms(raw):
    # the history store is decoded server-side (norm_c / norm_d); the file side is compared as written (CR removed)
    x = raw.replace("\r", "")
    a = re.sub(r"[ \t\n\r\f\v;]+", "", x)
    b = re.sub(r"[ \t\n\r\f\v;]+", "", re.sub(r"--[^\n]*", "", re.sub(r"/\*.*?\*/", "", x, flags=re.S)))
    return hashlib.md5(a.encode()).hexdigest(), hashlib.md5(b.encode()).hexdigest()


def main():
    files = sorted(f for f in os.listdir(MIG) if re.match(r"^\d{14}_.*\.sql", f))
    parsed, raws, names = {}, {}, {}
    for f in files:
        v = f[:14]
        ev, cnt, raw = parse_file(os.path.join(MIG, f), v)
        parsed[v] = (ev, cnt)
        raws[v] = raw
        names[v] = f
    prod, dev = Snapshot("prod"), Snapshot("dev")
    baseline = {v for v in parsed if v < "20251126190540"}
    twins12 = {"20260305203528", "20260407203226"}
    october = {v for v in parsed if v >= "20261007000000"}
    prod_applied = set(prod.hist) | baseline | twins12
    dev_applied = {v for v in parsed if v < "20261007000000"} - {"20260407211122"}
    out = {}
    for env, snap, applied in (("prod", prod, prod_applied), ("dev", dev, dev_applied)):
        s, rows = classify(env, files, parsed, set(snap.hist), applied)
        out[env] = rows
    # CSV: master (all versions, both envs)
    os.makedirs(OUTDIR, exist_ok=True)
    cols = ["version", "file", "in_prod_history", "prod_history_name", "prod_sql_vs_file", "prod_events", "prod_present", "prod_superseded", "prod_missing",
            "prod_verdict", "prod_missing_items", "prod_function_body_drift", "in_dev_history", "dev_history_name", "dev_sql_vs_file", "dev_events", "dev_present", "dev_superseded",
            "dev_missing", "dev_verdict", "dev_missing_items", "dev_function_body_drift", "data_stmts", "grant_revoke_stmts", "dynamic_sql", "is_baseline", "is_october"]
    master = []
    for v in sorted(parsed):
        ev, cnt = parsed[v]
        a, b = file_norms(raws[v])
        row = {"version": v, "file": names[v], "data_stmts": f"ins{cnt['insert']}/upd{cnt['update']}/del{cnt['delete']}/trunc{cnt['truncate']}",
               "grant_revoke_stmts": cnt["grant"] + cnt["revoke"], "dynamic_sql": cnt["dynamic_sql"], "is_baseline": int(v in baseline), "is_october": int(v in october)}
        for env, snap in (("prod", prod), ("dev", dev)):
            h = snap.hist.get(v)
            r = out[env][v]
            row[f"in_{env}_history"] = int(h is not None)
            row[f"{env}_history_name"] = h["name"] if h else ""
            if h:
                rel = "IDENTICAL" if h["norm_c_md5"] == a else ("COMMENT_ONLY_DIFF" if h["norm_d_md5"] == b else "DIFFERENT")
            else:
                rel = ""
            row[f"{env}_sql_vs_file"] = rel
            row[f"{env}_events"], row[f"{env}_present"], row[f"{env}_superseded"], row[f"{env}_missing"] = r["events"], r["present"], r["superseded"] + r["chain"], r["missing"]
            row[f"{env}_verdict"] = r["verdict"]
            row[f"{env}_missing_items"] = ";".join(r["missing_items"])[:400]
            row[f"{env}_function_body_drift"] = ";".join(r["body_drift"])
        master.append(row)
    with open(os.path.join(OUTDIR, "version-matrix-all-387.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(master)
    json.dump({"prod": out["prod"], "dev": out["dev"]}, open(os.path.join(EVID, "classification_raw.json"), "w", encoding="utf-8"), indent=0)
    print("files", len(files), "| prod history", len(prod.hist), "| dev history", len(dev.hist))
    for env in ("prod", "dev"):
        print(env, dict(collections.Counter(r["verdict"] for r in out[env].values())))


if __name__ == "__main__":
    main()
