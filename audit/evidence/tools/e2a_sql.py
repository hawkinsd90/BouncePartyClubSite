"""Stage E2A helper: SQL-aware statement splitting and tagging for migration files (read-only analysis of repository files).
split_statements() removes -- and nested /* */ comments outside literals, keeps '...', "..." and $tag$...$tag$ intact, and splits at top-level semicolons.
tag() returns (kind, target) for a statement; it is deliberately conservative (unknown shapes are 'OTHER')."""
import re


def _collapse(st):
    """collapse whitespace outside $tag$...$tag$ bodies (bodies keep their newlines so that -- comments inside them stay line-bound)"""
    parts, i = [], 0
    for m in re.finditer(r"(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)(.*?)\1", st, re.S):
        parts.append(re.sub(r"\s+", " ", st[i:m.start()]))
        parts.append(m.group(0))
        i = m.end()
    parts.append(re.sub(r"\s+", " ", st[i:]))
    return "".join(parts)


def strip_and_split(text):
    s = text.replace("\r\n", "\n")
    out, cur, i, n = [], [], 0, len(s)
    while i < n:
        c = s[i]
        if s.startswith("--", i):
            j = s.find("\n", i)
            i = n if j < 0 else j
        elif s.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if s.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif s.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
            cur.append(" ")
        elif c == "'":
            j = i + 1
            esc = i > 0 and s[i - 1] in "eE"
            while j < n:
                if esc and s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "'":
                    if j + 1 < n and s[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            cur.append(s[i:j + 1])
            i = j + 1
        elif c == '"':
            j = s.find('"', i + 1)
            while j != -1 and j + 1 < n and s[j + 1] == '"':
                j = s.find('"', j + 2)
            cur.append(s[i:j + 1])
            i = j + 1
        elif c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z_0-9]*)?\$", s[i:])
            if m and not (i > 0 and (s[i - 1].isalnum() or s[i - 1] == "_")):
                tag = m.group(0)
                j = s.find(tag, i + len(tag))
                cur.append(s[i:j + len(tag)])
                i = j + len(tag)
            else:
                cur.append(c)
                i += 1
        elif c == ";":
            st = "".join(cur).strip()
            if st:
                out.append(_collapse(st))
            cur = []
            i += 1
        else:
            cur.append(c)
            i += 1
    st = "".join(cur).strip()
    if st:
        out.append(st)
    return out


def _name(x):
    x = x.strip().strip('"')
    return re.sub(r'^public\.', "", x).strip('"')


def tag(st):
    u = st.lstrip()
    up = u.upper()
    m = None
    if up.startswith("CREATE TABLE"):
        m = re.match(r"CREATE TABLE (?:IF NOT EXISTS )?([\w\.\"]+)", u, re.I)
        return "CREATE TABLE", _name(m.group(1)) if m else ""
    if up.startswith("ALTER TABLE"):
        m = re.match(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?([\w\.\"]+) (.*)", u, re.I)
        rest = m.group(2).upper() if m else ""
        sub = "ADD COLUMN" if "ADD COLUMN" in rest else "ADD CONSTRAINT" if "ADD CONSTRAINT" in rest else "ENABLE RLS" if "ENABLE ROW LEVEL SECURITY" in rest else "DROP" if rest.startswith("DROP") else "ALTER"
        return "ALTER TABLE " + sub, _name(m.group(1)) if m else ""
    if up.startswith("CREATE POLICY"):
        m = re.match(r'CREATE POLICY ("[^"]+"|\w+) ON ([\w\.\"]+)', u, re.I)
        return "CREATE POLICY", (_name(m.group(2)) + "." + m.group(1).strip('"')) if m else ""
    if up.startswith("DROP POLICY"):
        m = re.match(r'DROP POLICY (?:IF EXISTS )?("[^"]+"|\w+) ON ([\w\.\"]+)', u, re.I)
        return "DROP POLICY", (_name(m.group(2)) + "." + m.group(1).strip('"')) if m else ""
    if re.match(r"CREATE (?:OR REPLACE )?FUNCTION", up):
        m = re.match(r"CREATE (?:OR REPLACE )?FUNCTION ([\w\.\"]+)", u, re.I)
        return "CREATE FUNCTION", _name(m.group(1)) if m else ""
    if re.match(r"CREATE (?:OR REPLACE )?TRIGGER", up):
        m = re.match(r"CREATE (?:OR REPLACE )?TRIGGER (\w+) .*? ON ([\w\.\"]+)", u, re.I)
        return "CREATE TRIGGER", (_name(m.group(2)) + "." + m.group(1)) if m else ""
    if up.startswith("DROP TRIGGER"):
        m = re.match(r"DROP TRIGGER (?:IF EXISTS )?(\w+) ON ([\w\.\"]+)", u, re.I)
        return "DROP TRIGGER", (_name(m.group(2)) + "." + m.group(1)) if m else ""
    if re.match(r"CREATE (?:UNIQUE )?INDEX", up):
        m = re.match(r"CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(?:CONCURRENTLY )?(\w+) ON ([\w\.\"]+)", u, re.I)
        return "CREATE INDEX", _name(m.group(1)) if m else ""
    if up.startswith("DROP FUNCTION"):
        return "DROP FUNCTION", u[:80]
    if up.startswith("GRANT"):
        return "GRANT", u[:140]
    if up.startswith("REVOKE"):
        return "REVOKE", u[:140]
    if up.startswith("INSERT INTO"):
        m = re.match(r"INSERT INTO ([\w\.\"]+)", u, re.I)
        return "INSERT", _name(m.group(1)) if m else ""
    if up.startswith("UPDATE"):
        m = re.match(r"UPDATE ([\w\.\"]+)", u, re.I)
        return "UPDATE", _name(m.group(1)) if m else ""
    if up.startswith("DELETE FROM"):
        m = re.match(r"DELETE FROM ([\w\.\"]+)", u, re.I)
        return "DELETE", _name(m.group(1)) if m else ""
    if up.startswith("COMMENT ON"):
        return "COMMENT", u[:100]
    if up.startswith("DO"):
        return "DO", u[:100]
    if up.startswith("CREATE EXTENSION"):
        return "CREATE EXTENSION", u[:100]
    if up.startswith("CREATE TYPE") or up.startswith("ALTER TYPE"):
        return "TYPE", u[:100]
    if up.startswith("CREATE SEQUENCE") or up.startswith("CREATE VIEW") or up.startswith("CREATE OR REPLACE VIEW"):
        return "CREATE VIEW/SEQUENCE", u[:100]
    if up.startswith(("DROP TABLE", "DROP INDEX", "DROP CONSTRAINT", "DROP VIEW", "DROP TYPE", "ALTER FUNCTION", "ALTER POLICY", "ALTER DEFAULT", "ALTER SEQUENCE", "ALTER PUBLICATION", "CREATE PUBLICATION", "SELECT", "SET", "NOTIFY", "ANALYZE", "VACUUM")):
        return up.split(" ")[0] + " " + (up.split(" ")[1] if len(up.split(" ")) > 1 else ""), u[:100]
    return "OTHER", u[:100]
