"""Stage E2A: statement-level proof analysis of unrecorded repository migrations against the immutable Stage B catalog captures.
READ-ONLY: reads repository files and the protected Stage B JSON captures only. No database (hosted or local) is contacted. Nothing is inserted anywhere.

Method (heuristic definition matching, stated honestly):
 1. Every migration file is split into statements and every material statement becomes a chain ELEMENT on an object key (table, column attribute, constraint, index,
    policy, trigger, function, RLS flag, grant, bucket, extension) ordered by (version, position).
 2. For each environment the captured catalog state of each object is matched against the elements of its chain. The LAST element whose definition matches the
    captured state is the one the catalog reflects. Elements of earlier versions are SUPERSEDED by it (citing its version); the element itself is PRESENT; an element
    AFTER the last matching one is NOT REFLECTED (ABSENT); an existing object matching no element is UNMATCHED (drift or a limit of the heuristic).
 3. Definition matching: functions by the Stage B body digests (comment- and whitespace-insensitive); columns by normalized type, NOT NULL and default; indexes, constraints, policies
    and triggers by normalized token sets (parentheses, casts and ordering removed). A token-set match is a heuristic, not a byte comparison, and is labelled as such.
 4. Data statements (INSERT/UPDATE/DELETE), DO blocks and comments cannot be proven from a schema-only capture and stay UNPROVABLE; a read-only query is generated for each.
A version is a history-only (schema-equivalence) candidate only if every material schema statement is PRESENT or SUPERSEDED and it has no unprovable data/dynamic statement.
This is NOT proof that the original SQL ran; it proves the captured target state equals what the chain says. Usage: python -I e2a_analyze.py"""
import collections
import csv
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2a_sql as Q  # noqa: E402

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
MIG = os.path.join(REPO, "supabase", "migrations")
EV = os.path.join(REPO, "audit", "evidence")
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\e2a-scratch"
os.makedirs(OUT, exist_ok=True)
OCT0 = "20261007000000"
FIRST_PROD = "20251126190540"


def jl(env, c):
    return json.load(open(os.path.join(PROT, f"{env}_catalog_{c}.json"), encoding="utf-8"))


# ---------------------------------------------------------------------------------------------------------------------------------------------
NOISE = {"text", "integer", "uuid", "timestamp", "with", "time", "zone", "public", "bigint", "boolean", "character", "varying", "numeric", "array", "any", "in", "as", "date", "jsonb", "json", "smallint", "double", "precision", "real", "bpchar", "name", "oid", "regclass", "interval"}


def t63(name):
    """PostgreSQL truncates identifiers to 63 bytes; migrations with longer names create the truncated object"""
    raw = name.encode("utf-8")
    return raw[:63].decode("utf-8", "ignore") if len(raw) > 63 else name


def toks(expr):
    e = (expr or "").lower()
    e = re.sub(r"::\s*[a-z_ ]+(?:\([0-9, ]*\))?(?:\[\])?", " ", e)
    e = e.replace("public.", "")
    return frozenset(t for t in re.findall(r"[a-z_][a-z0-9_]*|\d+|'[^']*'", e) if t not in NOISE)


def balanced(s, start):
    """text inside the parentheses that open at s[start]"""
    depth, i = 0, start
    q = None
    while i < len(s):
        c = s[i]
        if q:
            if c == q:
                q = None
        elif c in "'\"":
            q = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return s[start + 1:i], i
        i += 1
    return s[start + 1:], len(s)


def split_top(s, sep=","):
    parts, cur, depth, q, i = [], [], 0, None, 0
    while i < len(s):
        c = s[i]
        if q:
            cur.append(c)
            if c == q:
                q = None
        elif c in "'\"":
            q = c
            cur.append(c)
        elif c == "(":
            depth += 1
            cur.append(c)
        elif c == ")":
            depth -= 1
            cur.append(c)
        elif c == sep and depth == 0:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    if "".join(cur).strip():
        parts.append("".join(cur).strip())
    return parts


SYN = {"timestamptz": "timestamp with time zone", "timestamp": "timestamp without time zone", "int": "integer", "int4": "integer", "int8": "bigint", "int2": "smallint", "bool": "boolean",
       "decimal": "numeric", "float8": "double precision", "float4": "real", "varchar": "character varying", "time": "time without time zone", "timetz": "time with time zone", "serial": "integer",
       "bigserial": "bigint", "smallserial": "smallint", "char": "character", "bpchar": "character"}


def ntype(t):
    t = re.sub(r"\s+", " ", (t or "").lower().strip())
    arr = t.endswith("[]")
    t = t[:-2].strip() if arr else t
    m = re.match(r"([a-z ]+?)\s*(\(.*\))?$", t)
    base, mod = (m.group(1).strip(), (m.group(2) or "").replace(" ", "")) if m else (t, "")
    base = SYN.get(base, base)
    if base == "timestamp without time zone" and "with time zone" in t:
        base = "timestamp with time zone"
    return base + mod + ("[]" if arr else "")


COLKW = r"\b(NOT NULL|NULL|DEFAULT|PRIMARY KEY|REFERENCES|CHECK|UNIQUE|GENERATED|CONSTRAINT|COLLATE)\b"


def parse_column(item):
    m = re.match(r'\s*("?)([A-Za-z_][\w]*)\1\s+(.*)$', item, re.S)
    if not m:
        return None
    name, rest = m.group(2).lower(), m.group(3)
    k = re.search(COLKW, rest, re.I)
    tstr = rest[:k.start()] if k else rest
    tail = rest[k.start():] if k else ""
    notnull = bool(re.search(r"\bNOT NULL\b", tail, re.I) or re.search(r"\bPRIMARY KEY\b", tail, re.I))
    d = re.search(r"\bDEFAULT\b\s*(.*?)(?=\s+(?:NOT NULL|NULL|PRIMARY KEY|REFERENCES|CHECK|UNIQUE|CONSTRAINT|GENERATED|COLLATE)\b|$)", tail, re.I | re.S)
    default = d.group(1).strip() if d else None
    if default is not None and default.strip().lower() == "null":
        default = None
    serial = bool(re.match(r"\s*(big|small)?serial", tstr, re.I))
    if serial:
        default = "nextval"
    return {"name": name, "type": ntype(tstr), "notnull": notnull or serial, "default": default, "inline": [x for x in ("PRIMARY KEY", "UNIQUE", "REFERENCES", "CHECK") if re.search(r"\b" + x, tail, re.I)]}


def elements(version, pos, st):
    """Yield chain elements (kind, key, payload) for one statement."""
    kind, target = Q.tag(st)
    u = st.strip()
    out = []
    if kind == "CREATE TABLE":
        ifne = bool(re.match(r"CREATE TABLE IF NOT EXISTS", u, re.I))
        out.append(("table", target, {"exists": True, "ifne": ifne}))
        i = u.find("(")
        if i >= 0:
            body, _ = balanced(u, i)
            for item in split_top(body):
                if re.match(r"(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|LIKE|EXCLUDE)\b", item, re.I):
                    m = re.match(r'CONSTRAINT\s+("?)(\w+)\1\s+(.*)', item, re.I | re.S)
                    if m:
                        out.append(("constraint", f"{target}.{m.group(2).lower()}", {"def": m.group(3)}))
                    continue
                c = parse_column(item)
                if c:
                    out.append(("col", f"{target}.{c['name']}", {"type": c["type"], "notnull": c["notnull"], "default": c["default"], "noop_if_table": target if ifne else None}))
                    for inl in c["inline"]:
                        out.append(("inline", f"{target}.{c['name']}:{inl}", {"noop_if_table": target if ifne else None}))
    elif kind.startswith("ALTER TABLE"):
        m = re.match(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?([\w\.\"]+) (.*)", u, re.I | re.S)
        if not m:
            return out
        t, rest = Q._name(m.group(1)), m.group(2)
        for item in split_top(rest):
            it = item.strip()
            mm = re.match(r"ADD COLUMN (IF NOT EXISTS )?(.*)", it, re.I | re.S)
            if mm:
                c = parse_column(mm.group(2))
                if c:
                    out.append(("col", f"{t}.{c['name']}", {"type": c["type"], "notnull": c["notnull"], "default": c["default"], "ifne": bool(mm.group(1))}))
                continue
            mm = re.match(r"ALTER COLUMN (\w+) (?:SET DATA )?TYPE (.*?)(?: USING .*)?$", it, re.I | re.S)
            if mm:
                out.append(("col", f"{t}.{mm.group(1).lower()}", {"type": ntype(mm.group(2))}))
                continue
            mm = re.match(r"ALTER COLUMN (\w+) SET NOT NULL", it, re.I)
            if mm:
                out.append(("col", f"{t}.{mm.group(1).lower()}", {"notnull": True}))
                continue
            mm = re.match(r"ALTER COLUMN (\w+) DROP NOT NULL", it, re.I)
            if mm:
                out.append(("col", f"{t}.{mm.group(1).lower()}", {"notnull": False}))
                continue
            mm = re.match(r"ALTER COLUMN (\w+) SET DEFAULT (.*)", it, re.I | re.S)
            if mm:
                out.append(("col", f"{t}.{mm.group(1).lower()}", {"default": mm.group(2)}))
                continue
            mm = re.match(r"ALTER COLUMN (\w+) DROP DEFAULT", it, re.I)
            if mm:
                out.append(("col", f"{t}.{mm.group(1).lower()}", {"default": None, "default_set": True}))
                continue
            mm = re.match(r"DROP COLUMN (?:IF EXISTS )?(\w+)", it, re.I)
            if mm:
                out.append(("col", f"{t}.{mm.group(1).lower()}", {"dropped": True}))
                continue
            mm = re.match(r"ADD CONSTRAINT (\"?)(\w+)\1 (.*)", it, re.I | re.S)
            if mm:
                out.append(("constraint", f"{t}.{t63(mm.group(2).lower())}", {"def": mm.group(3)}))
                continue
            mm = re.match(r"DROP CONSTRAINT (?:IF EXISTS )?(\"?)(\w+)\1", it, re.I)
            if mm:
                out.append(("constraint", f"{t}.{t63(mm.group(2).lower())}", {"dropped": True}))
                continue
            if re.match(r"ENABLE ROW LEVEL SECURITY", it, re.I):
                out.append(("rls", t, {"on": True}))
            elif re.match(r"DISABLE ROW LEVEL SECURITY", it, re.I):
                out.append(("rls", t, {"on": False}))
    elif kind == "CREATE INDEX":
        m = re.match(r"CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?(?:CONCURRENTLY )?(\w+) ON ([\w\.\"]+)(?: USING (\w+))? ?(\(.*)", u, re.I | re.S)
        if m:
            cols, j = balanced(m.group(5), 0)
            where = re.search(r"\bWHERE\b(.*)$", m.group(5)[j + 1:], re.I | re.S)
            out.append(("index", t63(m.group(2).lower()), {"unique": bool(m.group(1)), "table": Q._name(m.group(3)), "cols": toks(cols), "where": toks(where.group(1)) if where else frozenset(), "ifne": bool(re.match(r"CREATE (?:UNIQUE )?INDEX IF NOT EXISTS", u, re.I))}))
    elif kind == "CREATE POLICY":
        m = re.match(r'CREATE POLICY ("[^"]+"|\w+) ON ([\w\."]+)(.*)$', u, re.I | re.S)
        if m:
            rest = m.group(3)
            cmd = (re.search(r"\bFOR (ALL|SELECT|INSERT|UPDATE|DELETE)\b", rest, re.I) or [None, "ALL"])[1].upper()
            rm = re.search(r"\bTO\b (.*?)(?=\bUSING\b|\bWITH CHECK\b|$)", rest, re.I | re.S)
            roles = frozenset(x.strip().lower() for x in rm.group(1).split(",") if x.strip()) if rm else frozenset(["public"])
            ui = re.search(r"\bUSING\s*\(", rest, re.I)
            wi = re.search(r"\bWITH CHECK\s*\(", rest, re.I)
            using = balanced(rest, ui.end() - 1)[0] if ui else None
            wcheck = balanced(rest, wi.end() - 1)[0] if wi else None
            out.append(("policy", f"{Q._name(m.group(2))}.{t63(m.group(1).strip(chr(34)))}", {"cmd": cmd, "roles": roles, "using": toks(using) if using is not None else None, "check": toks(wcheck) if wcheck is not None else None}))
    elif kind == "DROP POLICY":
        tt, nn = target.rsplit(".", 1)
        out.append(("policy", f"{tt}.{t63(nn)}", {"dropped": True}))
    elif kind == "CREATE FUNCTION":
        body = None
        m = re.search(r"(\$[A-Za-z_]*\$)(.*)\1", u, re.S)
        if m:
            body = m.group(2)
        else:
            m2 = re.search(r"\bAS\s+'(.*)'\s*(?:LANGUAGE|$)", u, re.S | re.I)
            body = m2.group(1).replace("''", "'") if m2 else None
        out.append(("function", target.lower(), {"body": body}))
    elif kind == "DROP FUNCTION":
        m = re.match(r"DROP FUNCTION (?:IF EXISTS )?([\w\.\"]+)", u, re.I)
        if m:
            out.append(("function", Q._name(m.group(1)).lower(), {"dropped": True}))
    elif kind == "CREATE TRIGGER":
        m = re.match(r"CREATE (?:OR REPLACE )?TRIGGER (\w+)\s+(BEFORE|AFTER|INSTEAD OF)\s+(.*?)\s+ON\s+([\w\.\"]+)(.*)$", u, re.I | re.S)
        if m:
            ev = frozenset(re.findall(r"\b(INSERT|UPDATE|DELETE|TRUNCATE)\b", m.group(3).upper()))
            rest = m.group(5)
            fe = "STATEMENT" if re.search(r"FOR EACH STATEMENT", rest, re.I) else "ROW"
            fn = re.search(r"EXECUTE (?:FUNCTION|PROCEDURE) ([\w\.]+)", rest, re.I)
            out.append(("trigger", f"{Q._name(m.group(4))}.{t63(m.group(1).lower())}", {"timing": m.group(2).upper(), "events": ev, "each": fe, "fn": (fn.group(1).split(".")[-1].lower() if fn else None)}))
    elif kind == "DROP TRIGGER":
        tt, nn = target.lower().rsplit(".", 1)
        out.append(("trigger", f"{tt}.{t63(nn)}", {"dropped": True}))
    elif kind == "DROP INDEX":
        m = re.match(r"DROP INDEX (?:IF EXISTS )?(?:CONCURRENTLY )?([\w\.\"]+)", u, re.I)
        if m:
            out.append(("index", t63(Q._name(m.group(1)).lower()), {"dropped": True}))
    elif kind == "DROP TABLE":
        m = re.match(r"DROP TABLE (?:IF EXISTS )?([\w\.\"]+)", u, re.I)
        if m:
            out.append(("table", Q._name(m.group(1)), {"dropped": True}))
    elif kind == "CREATE EXTENSION":
        m = re.match(r"CREATE EXTENSION (?:IF NOT EXISTS )?\"?([\w-]+)\"?", u, re.I)
        if m:
            out.append(("extension", m.group(1).lower(), {"exists": True}))
    elif kind in ("GRANT", "REVOKE"):
        m = re.match(r"(GRANT|REVOKE) (.*?) ON (?:(TABLE|FUNCTION|SEQUENCE|ALL TABLES IN SCHEMA|ALL FUNCTIONS IN SCHEMA|ALL SEQUENCES IN SCHEMA|SCHEMA)\s+)?([\w\.\", ]+?)(?:\([^)]*\))? (?:TO|FROM) ([\w\", ]+)", u, re.I)
        if m:
            privs = [p.strip().upper() for p in m.group(2).split(",")]
            objkind = (m.group(3) or "TABLE").upper()
            objs = [Q._name(x) for x in m.group(4).split(",")]
            roles = [r.strip().strip('"').lower() for r in m.group(5).split(",")]
            if objkind.startswith("ALL ") or objkind == "SCHEMA" or "ALL" in privs and False:
                out.append(("grantwide", u[:100], {"grant": m.group(1).upper() == "GRANT"}))
            else:
                for ob in objs:
                    for r in roles:
                        for p in privs:
                            out.append(("grant", f"{objkind}:{ob.lower()}:{r}:{p}", {"grant": m.group(1).upper() == "GRANT"}))
        else:
            out.append(("grantwide", u[:100], {"grant": kind == "GRANT"}))
    elif kind == "INSERT" and target.lower() in ("storage.buckets",):
        m = re.search(r"VALUES\s*\(\s*'([^']+)'", u, re.I)
        out.append(("bucket", m.group(1) if m else "?", {"exists": True}))
    elif kind == "UPDATE" and target.lower() == "storage.buckets":
        m = re.search(r"\bpublic\s*=\s*(true|false)", u, re.I)
        ids = re.findall(r"'([\w-]+)'", u.split("WHERE", 1)[1]) if "WHERE" in u.upper() else []
        for b in ids:
            out.append(("bucketvis", b, {"public": (m.group(1).lower() == "true") if m else None}))
    elif kind in ("INSERT", "UPDATE", "DELETE"):
        out.append(("data", f"{kind} {target}", {"stmt": u[:300]}))
    elif kind == "DO":
        m = re.search(r"(\$[A-Za-z_]*\$)(.*)\1", u, re.S)
        body = m.group(2) if m else ""
        if re.search(r"\b(INSERT\s+INTO|UPDATE\s+[\w\.\"]+\s+SET|DELETE\s+FROM|EXECUTE\b)", body, re.I):
            out.append(("dynamic", "DO", {"stmt": u[:300]}))
        else:
            found = 0
            for piece in Q.strip_and_split(body):
                mm = re.search(r"(ALTER TABLE|CREATE (?:UNIQUE )?INDEX|CREATE POLICY|DROP POLICY|CREATE TRIGGER|DROP TRIGGER|COMMENT ON|CREATE TABLE)\b", piece, re.I)
                if mm:
                    for kd, ky, pl in elements(version, pos, piece[mm.start():]):
                        if not pl.get("dropped"):
                            pl["ifne"] = True
                        pl["guarded_do"] = True
                        out.append((kd, ky, pl))
                        found += 1
            if not found:
                out.append(("dynamic", "DO", {"stmt": u[:300]}))
    elif kind == "COMMENT":
        out.append(("comment", u[:80], {}))
    return out


# ---------------------------------------------------------------------------------------------------------------------------------------------
def load_repo():
    files = sorted(f for f in os.listdir(MIG) if re.match(r"^\d{14}_.+\.sql", f))
    chain = collections.defaultdict(list)  # (kind,key) -> [(version, pos, payload, stmt)]
    per_version = {}
    for f in files:
        v = f[:14]
        sts = Q.strip_and_split(open(os.path.join(MIG, f), encoding="utf-8", errors="replace").read())
        items = []
        for i, st in enumerate(sts):
            for kind, key, pl in elements(v, i, st):
                chain[(kind, key)].append((v, i, pl, st))
                items.append((kind, key, pl, st))
        per_version[v] = {"file": f, "statements": len(sts), "items": items}
    return per_version, chain


def src_digest(body):
    b = re.sub(r"/\*.*?\*/", "", body or "", flags=re.S)
    b = re.sub(r"--[^\n]*", "", b)
    return hashlib.md5(re.sub(r"[ \t\n\r\f\v]+", "", b).encode("utf-8")).hexdigest()


def src_digest_ws(body):
    return hashlib.md5(re.sub(r"[ \t\n\r\f\v]+", "", body or "").encode("utf-8")).hexdigest()


class Env:
    def __init__(self, env):
        self.env = env
        self.tables = {(r["schema"], r["name"]): r for r in jl(env, "tables")}
        self.cols = {(r["tbl"], r["name"]): r for r in jl(env, "columns") if r["schema"] == "public"}
        self.cons = {(r["tbl"], r["name"]): r for r in jl(env, "constraints") if r["schema"] == "public"}
        self.idx = {r["name"]: r for r in jl(env, "indexes") if r["schema"] == "public"}
        self.trg = {(r["tbl"], r["name"]): r for r in jl(env, "triggers") if r["schema"] == "public"}
        self.pol = {(r["tbl"], r["name"]): r for r in jl(env, "policies") if r["schema"] == "public"}
        self.pol_all = {(r["schema"], r["tbl"], r["name"]): r for r in jl(env, "policies")}
        self.fn = collections.defaultdict(list)
        for r in jl(env, "functions"):
            self.fn[r["name"].lower()].append(r)
        self.ext = {r["name"] for r in jl(env, "extensions")}
        self.bucket = {r["id"]: r for r in jl(env, "storage_buckets")}
        self.grants = collections.defaultdict(set)
        for r in jl(env, "grants_relations"):
            self.grants[(r["name"].lower(), r["grantee"].lower())].add(r["privilege_type"])
        self.fgrants = collections.defaultdict(set)
        for r in jl(env, "grants_functions"):
            self.fgrants[(r["name"].lower(), r["grantee"].lower())].add(r["privilege_type"])
        self.rls = {r["name"]: r["rls"] for r in jl(env, "tables") if r["schema"] == "public"}

    # current catalog state for a chain key -> ("absent",None) | ("exists", state)
    def state(self, kind, key):
        if kind == "table":
            return ("exists", None) if ("public", key) in self.tables or ("storage", key.replace("storage.", "")) in self.tables else ("absent", None)
        if kind == "col":
            t, c = key.rsplit(".", 1)
            r = self.cols.get((t, c))
            return ("exists", r) if r else ("absent", None)
        if kind == "constraint":
            t, c = key.rsplit(".", 1)
            r = self.cons.get((t, c))
            return ("exists", r) if r else ("absent", None)
        if kind == "index":
            r = self.idx.get(key)
            return ("exists", r) if r else ("absent", None)
        if kind == "trigger":
            t, n = key.rsplit(".", 1)
            r = self.trg.get((t, n))
            return ("exists", r) if r else ("absent", None)
        if kind == "policy":
            t, n = key.rsplit(".", 1)
            if t.startswith("storage."):
                r = self.pol_all.get(("storage", t.split(".", 1)[1], n))
            else:
                r = self.pol.get((t, n))
            return ("exists", r) if r else ("absent", None)
        if kind == "function":
            r = self.fn.get(key)
            return ("exists", r) if r else ("absent", None)
        if kind == "extension":
            return ("exists", None) if key in self.ext else ("absent", None)
        if kind == "bucket":
            r = self.bucket.get(key)
            return ("exists", r) if r else ("absent", None)
        if kind == "rls":
            return ("exists", {"on": bool(self.rls.get(key))}) if key in self.rls else ("absent", None)
        return ("unknown", None)

    def matches(self, kind, key, pl, state):
        """Does element payload pl match the captured state?"""
        stt, r = state
        if pl.get("dropped"):
            return stt == "absent"
        if stt == "absent":
            return False
        if kind in ("table", "extension", "grant"):
            return True
        if kind == "bucket":
            return True
        if kind == "rls":
            return r["on"] == pl["on"]
        if kind == "col":
            ok = True
            if "type" in pl:
                ok &= ntype(r["type"]) == pl["type"]
            if "notnull" in pl:
                ok &= bool(r["not_null"]) == bool(pl["notnull"]) or (pl["notnull"] is False and not r["not_null"])
            if "default" in pl or pl.get("default_set"):
                d = pl.get("default")
                ok &= (toks(d) == toks(r["default_expr"])) if d else (not r["default_expr"] or "nextval" in (r["default_expr"] or "") and False)
            return ok
        if kind == "constraint":
            return toks(pl["def"]) == toks(r["def"])
        if kind == "index":
            d = r["def"]
            i = d.find("(", d.upper().find(" USING "))
            inner, j = balanced(d, i)
            wm = re.search(r"\bWHERE\b(.*)$", d[j + 1:], re.S)
            cols = toks(inner)
            where = toks(wm.group(1)) if wm else frozenset()
            return ("UNIQUE" in d.upper().split("INDEX")[0]) == pl["unique"] and cols == pl["cols"] and where == pl["where"]
        if kind == "policy":
            roles = frozenset(x.strip().lower() for x in (r["roles"] or "public").split(",") if x.strip()) or frozenset(["public"])
            if r["cmd"].upper() != pl["cmd"] or roles != pl["roles"]:
                return False
            if pl["using"] is not None and toks(r["qual"]) != pl["using"]:
                return False
            if pl["check"] is not None and toks(r["with_check"]) != pl["check"]:
                return False
            if pl["using"] is None and r["qual"] and pl["cmd"] in ("SELECT", "DELETE"):
                return False
            return True
        if kind == "trigger":
            d = r["def"].upper()
            ev = frozenset(re.findall(r"\b(INSERT|UPDATE|DELETE|TRUNCATE)\b", d.split(" ON ")[0]))
            fn = re.search(r"EXECUTE (?:FUNCTION|PROCEDURE) ([\w\.]+)", r["def"], re.I)
            return pl["timing"] in d.split(" ON ")[0] and ev == pl["events"] and pl["each"] in d and (fn.group(1).split(".")[-1].lower() if fn else None) == pl["fn"]
        if kind == "function":
            if pl["body"] is None:
                return True
            a, b = src_digest(pl["body"]), src_digest_ws(pl["body"])
            return any(x["src_nocomment_md5"] == a or x["src_norm_md5"] == b for x in r)
        return False


def grant_state(env, key):
    objkind, ob, role, priv = key.split(":", 3)
    if objkind == "FUNCTION":
        nm = ob.split("(")[0].split(".")[-1]
        have = env.fgrants.get((nm, role), set()) | env.fgrants.get((nm, "public"), set())  # a PUBLIC grant covers every role
    else:
        nm = ob.split(".")[-1]
        have = env.grants.get((nm, role), set()) | env.grants.get((nm, "public"), set())
    if priv == "ALL":
        return have >= {"SELECT", "INSERT", "UPDATE", "DELETE"} if objkind != "FUNCTION" else "EXECUTE" in have
    if priv == "ALL PRIVILEGES":
        return have >= {"SELECT", "INSERT", "UPDATE", "DELETE"} if objkind != "FUNCTION" else "EXECUTE" in have
    return priv in have


def evaluate(per_version, chain, env):
    """status per (version, element index) for one environment. Returns {version: [ {kind,key,status,by,detail} ]}"""
    res = collections.defaultdict(list)
    for (kind, key), els in chain.items():
        els = sorted(els, key=lambda e: (e[0], e[1]))
        noop, keep = [], []
        for e in els:
            pl = e[2]
            guarded_tbl = pl.get("noop_if_table")
            earlier = False
            if guarded_tbl:
                earlier = any(x[0] < e[0] and not x[2].get("dropped") for x in chain.get(("table", guarded_tbl), []))
            elif pl.get("ifne"):
                earlier = any((x[0], x[1]) < (e[0], e[1]) and not x[2].get("dropped") for x in els)
            (noop if earlier else keep).append(e)
        for v, pos, pl, st in noop:
            res[v].append({"kind": kind, "key": key, "status": "NOOP", "by": "", "detail": "IF NOT EXISTS statement on an object an earlier migration already created: no effect by design"})
        els = keep
        if not els:
            continue
        if kind in ("data", "dynamic", "comment", "grantwide", "bucketvis"):
            for v, pos, pl, st in els:
                res[v].append({"kind": kind, "key": key, "status": "UNPROVABLE" if kind in ("data", "dynamic", "grantwide", "bucketvis") else "NONMATERIAL", "by": "", "detail": st[:160]})
            continue
        if kind == "inline":
            t, c = key.split(":")[0], key.split(":")[1]
            for v, pos, pl, st in els:
                ok = False
                tbl, col = t.rsplit(".", 1)
                ct = {"PRIMARY KEY": "p", "UNIQUE": "u", "REFERENCES": "f", "CHECK": "c"}[c]
                ok = any(x["tbl"] == tbl and x["type"] == ct and (ct == "c" or col in x["def"]) for x in env.cons.values())
                res[v].append({"kind": "inline-constraint", "key": key, "status": "PRESENT" if ok else ("ABSENT" if (tbl, col) in env.cols else "ABSENT"), "by": "", "detail": "existence by type/column (heuristic)"})
            continue
        if kind == "grant":
            have = grant_state(env, key)
            els = [(v, pos, {"dropped": not pl["grant"]}, st) for v, pos, pl, st in els]
            state = ("exists", None) if have else ("absent", None)
            matched_all = [e for e in els if env.matches("grant", key, e[2], state) and (e[2].get("dropped") == (state[0] == "absent"))]
            for e in els:
                v, pos, pl, st = e
                matched = matched_all if v >= OCT0 else [m for m in matched_all if m[0] < OCT0]
                mid = {id(x) for x in matched}
                later = next((x for x in matched if (x[0], x[1]) > (e[0], e[1])), None)
                if not matched:
                    status, by, det = "ABSENT", "", ("GRANT not reflected in the captured ACL" if not pl.get("dropped") else "REVOKE not reflected (privilege still held)")
                elif id(e) in mid:
                    status, by, det = "PRESENT", "", ("REVOKE reflected" if pl.get("dropped") else "GRANT reflected in the captured ACL")
                elif later is not None:
                    status, by, det = "SUPERSEDED", later[0], "a later GRANT/REVOKE on the same privilege is what the captured ACL reflects"
                else:
                    status, by, det = "ABSENT", "", f"captured ACL reflects the older GRANT/REVOKE from {matched[-1][0]}"
                res[v].append({"kind": "grant", "key": key, "status": status, "by": by, "detail": det})
            continue
        state = env.state(kind, key)
        if kind == "col":
            # attribute chains: type / notnull / default evaluated independently
            attrs = {"type": [], "notnull": [], "default": [], "dropped": []}
            for e in els:
                for a in ("type", "notnull"):
                    if a in e[2]:
                        attrs[a].append(e)
                if "default" in e[2] or e[2].get("default_set"):
                    attrs["default"].append(e)
                if e[2].get("dropped"):
                    attrs["dropped"].append(e)
            sts = {}
            if attrs["dropped"] and els[-1][2].get("dropped"):
                for idx, e in enumerate(els):
                    v, pos, pl, st = e
                    if e is els[-1]:
                        res[v].append({"kind": kind, "key": key, "status": "PRESENT" if state[0] == "absent" else "ABSENT", "by": "", "detail": "column drop " + ("reflected" if state[0] == "absent" else "NOT reflected")})
                    else:
                        res[v].append({"kind": kind, "key": key, "status": "SUPERSEDED", "by": els[-1][0], "detail": "column later dropped"})
                continue
            if state[0] == "absent":
                for e in els:
                    res[e[0]].append({"kind": kind, "key": key, "status": "ABSENT", "by": "", "detail": "column not in captured catalog"})
                continue
            for a in ("type", "notnull", "default"):
                chain_a = attrs[a]
                if not chain_a:
                    continue
                ma = [e for e in chain_a if env.matches("col", key, {k: e[2][k] for k in e[2] if k in (a, "default_set")} if a != "default" else {"default": e[2].get("default"), "default_set": True}, state)]
                ma_all = ma
                for e in chain_a:
                    ma = ma_all if e[0] >= OCT0 else [m for m in ma_all if m[0] < OCT0]
                    mset = {id(x) for x in ma}
                    later = next((x for x in ma if (x[0], x[1]) > (e[0], e[1])), None)
                    if not ma:
                        sts[(id(e), a)] = ("UNMATCHED", "", f"{a} differs from every definition in the chain")
                    elif id(e) in mset:
                        sts[(id(e), a)] = ("PRESENT", "", "")
                    elif later is not None:
                        sts[(id(e), a)] = ("SUPERSEDED", later[0], f"{a} later set by {later[0]}")
                    else:
                        sts[(id(e), a)] = ("ABSENT", "", f"{a}: catalog reflects the older definition from {ma[-1][0]}")
            for e in els:
                parts = [sts[(id(e), a)] for a in ("type", "notnull", "default") if (id(e), a) in sts]
                order = {"UNMATCHED": 3, "ABSENT": 2, "SUPERSEDED": 1, "PRESENT": 0}
                worst = max(parts, key=lambda p: order[p[0]]) if parts else ("PRESENT", "", "")
                by = sorted({p[1] for p in parts if p[1]})
                res[e[0]].append({"kind": kind, "key": key, "status": worst[0], "by": ",".join(by), "detail": "; ".join(p[2] for p in parts if p[2])[:160]})
            continue
        matched_all = [e for e in els if env.matches(kind, key, e[2], state)]
        for e in els:
            v, pos, pl, st = e
            # elements of the not-yet-applied October release cannot explain (supersede) an earlier migration's effect
            matched = matched_all if v >= OCT0 else [m for m in matched_all if m[0] < OCT0]
            mid = {id(x) for x in matched}
            later = next((x for x in matched if (x[0], x[1]) > (e[0], e[1])), None)
            if not matched:
                if state[0] == "exists":
                    status, by, det = "UNMATCHED", "", "object exists but matches no definition in the chain (drift or heuristic limit)"
                else:
                    status, by, det = "ABSENT", "", "object absent from the captured catalog and no migration drops it"
            elif id(e) in mid:
                status, by, det = "PRESENT", "", ("drop reflected" if pl.get("dropped") else "definition matches the captured object")
            elif later is not None:
                status, by, det = "SUPERSEDED", later[0], ("later " + ("drop" if later[2].get("dropped") else "definition") + f" in {later[0]} is what the catalog reflects")
            else:
                status, by, det = "ABSENT", "", f"catalog reflects the older element from {matched[-1][0]}"
            res[v].append({"kind": kind, "key": key, "status": status, "by": by, "detail": det})
    return res


if __name__ == "__main__":
    pv, chain = load_repo()
    print(len(pv), "files,", sum(len(v) for v in chain.values()), "chain elements,", len(chain), "objects")
