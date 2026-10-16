"""Stage C4: full-file SHA-256 and a comment-excluded, SQL-aware fingerprint of executable SQL.

The scanner understands PostgreSQL lexical rules, so text is never mistaken for a comment when it sits inside:
  * '...' string literals (with '' escapes; E'...' with backslash escapes),
  * "..." quoted identifiers,
  * $tag$ ... $tag$ dollar-quoted bodies (kept verbatim, including any comments inside them, because they are part of the executable text).
Outside literals: `-- ...` line comments and (nested) `/* ... */` block comments are removed (replaced by one space) and whitespace
runs are collapsed to one space. Line endings are normalised to LF first. Usage: python -I c4_sql_fingerprint.py <file>...  (prints JSON)
"""
import hashlib
import json
import re
import sys


def executable_sql(text):
    s = text.replace("\r\n", "\n")
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c == "-" and s.startswith("--", i):
            j = s.find("\n", i)
            i = n if j < 0 else j
            out.append(" ")
        elif c == "/" and s.startswith("/*", i):
            depth, i = 1, i + 2
            while i < n and depth:
                if s.startswith("/*", i):
                    depth, i = depth + 1, i + 2
                elif s.startswith("*/", i):
                    depth, i = depth - 1, i + 2
                else:
                    i += 1
            if depth:
                raise ValueError("unterminated block comment")
            out.append(" ")
        elif c == "'":
            esc = i > 0 and s[i - 1] in "eE" and (i < 2 or not (s[i - 2].isalnum() or s[i - 2] == "_"))
            j = i + 1
            while True:
                if j >= n:
                    raise ValueError("unterminated string literal")
                if esc and s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "'":
                    if j + 1 < n and s[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            out.append(s[i:j + 1])
            i = j + 1
        elif c == '"':
            j = i + 1
            while True:
                if j >= n:
                    raise ValueError("unterminated quoted identifier")
                if s[j] == '"':
                    if j + 1 < n and s[j + 1] == '"':
                        j += 2
                        continue
                    break
                j += 1
            out.append(s[i:j + 1])
            i = j + 1
        elif c == "$":
            m = re.match(r"\$([A-Za-z_\u0080-￿][A-Za-z_0-9\u0080-￿]*)?\$", s[i:])
            prev_ident = i > 0 and (s[i - 1].isalnum() or s[i - 1] == "_")
            if m and not prev_ident:
                tag = m.group(0)
                j = s.find(tag, i + len(tag))
                if j < 0:
                    raise ValueError("unterminated dollar-quoted body " + tag)
                out.append(s[i:j + len(tag)])
                i = j + len(tag)
            else:
                out.append(c)
                i += 1
        elif c.isspace():
            while i < n and s[i].isspace():
                i += 1
            out.append(" ")
        else:
            out.append(c)
            i += 1
    return _squeeze("".join(out))


def _squeeze(t):
    # collapse runs of single spaces left by comment removal / whitespace, but never inside a literal (re-scanned with the same rules)
    res, i, n = [], 0, len(t)
    while i < n:
        c = t[i]
        if c in "'\"" or c == "$":
            # re-scan a literal region exactly as executable_sql delimited it
            if c == "'":
                j = i + 1
                esc = i > 0 and t[i - 1] in "eE"
                while j < n:
                    if esc and t[j] == "\\":
                        j += 2
                        continue
                    if t[j] == "'":
                        if j + 1 < n and t[j + 1] == "'":
                            j += 2
                            continue
                        break
                    j += 1
                res.append(t[i:j + 1])
                i = j + 1
                continue
            if c == '"':
                j = i + 1
                while j < n:
                    if t[j] == '"':
                        if j + 1 < n and t[j + 1] == '"':
                            j += 2
                            continue
                        break
                    j += 1
                res.append(t[i:j + 1])
                i = j + 1
                continue
            m = re.match(r"\$([A-Za-z_\u0080-￿][A-Za-z_0-9\u0080-￿]*)?\$", t[i:])
            if m and not (i > 0 and (t[i - 1].isalnum() or t[i - 1] == "_")):
                tag = m.group(0)
                j = t.find(tag, i + len(tag))
                res.append(t[i:j + len(tag)])
                i = j + len(tag)
                continue
        if c == " ":
            if res and res[-1].endswith(" "):
                i += 1
                continue
        res.append(c)
        i += 1
    return "".join(res).strip()


def fingerprint(path):
    raw = open(path, "rb").read()
    sql = executable_sql(raw.decode("utf-8"))
    return {"file": path, "full_sha256": hashlib.sha256(raw).hexdigest(), "executable_sql_sha256": hashlib.sha256(sql.encode("utf-8")).hexdigest(), "executable_sql_chars": len(sql)}


if __name__ == "__main__":
    print(json.dumps([fingerprint(p) for p in sys.argv[1:]], indent=1))
