"""Could an older pending Production file overwrite a NEWER definition that Production already records? Offline text scan of the repository plus body hashes from two scratch databases
(the restored pre-upgrade Production schema and the rehearsed post-sequence schema). Loopback scratch only. Output: audit/evidence/production-overwrite-check.json"""
import csv
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402

REPO = L.REPO
MIG = os.path.join(REPO, "supabase", "migrations")
EV = os.path.join(REPO, "audit", "evidence")
plan = {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "e2c-proposed-execution-manifest.csv"), encoding="utf-8"))}
hist = {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "prod-history-277.csv"), encoding="utf-8"))}
EXEC = [v for v, r in plan.items() if r["proposed_action"] == "execute"]
LATEST = max(hist)
fnre = re.compile(r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?\"?(\w+)\"?\s*\(", re.I)


def funcs(fn):
    t = re.sub(r"--[^\n]*", "", open(os.path.join(MIG, fn), encoding="utf-8", errors="replace").read())
    return sorted(set(m.group(1).lower() for m in fnre.finditer(t)))


recorded_defs = {}
for v, r in hist.items():
    for f in funcs(r["file"]):
        recorded_defs.setdefault(f, []).append(v)
older = [v for v in EXEC if v < LATEST]
body = lambda db: {r.split("|")[0]: r.split("|")[1] for r in L.q(db, "select string_agg(proname||'|'||md5(string_agg(prosrc,'~' order by oid)), E'\n') from pg_proc where pronamespace='public'::regnamespace group by proname".replace("select string_agg(proname||'|'||md5(string_agg(prosrc,'~' order by oid)), E'\n') from pg_proc where pronamespace='public'::regnamespace group by proname", "select string_agg(x, E'\n') from (select proname||'|'||md5(string_agg(prosrc,'~' order by oid)) x from pg_proc where pronamespace='public'::regnamespace group by proname) s")).split("\n") if r}
pre = body("bpc_replay_d4_template")
post = body("bpc_replay_e2e_lf")
out = {"latest_recorded": LATEST, "older_executable_versions": len(older), "conflicts": []}
for v in older:
    for f in funcs(plan[v]["filename"]):
        newer_rec = [x for x in recorded_defs.get(f, []) if x > v]
        if newer_rec:
            out["conflicts"].append({"older_pending_version": v, "function": f, "newer_recorded_versions": newer_rec[-3:], "body_changed_by_sequence": pre.get(f) != post.get(f)})
out["changed_conflicts"] = [c for c in out["conflicts"] if c["body_changed_by_sequence"]]
json.dump(out, open(os.path.join(EV, "production-overwrite-check.json"), "w", encoding="utf-8"), indent=1)
print(len(older), "older executables;", len(out["conflicts"]), "function definitions also defined by a newer recorded migration;", len(out["changed_conflicts"]), "whose body the rehearsed sequence changes")
for c in out["changed_conflicts"][:12]:
    print(c)


# ---- non-function objects: policies, indexes, constraints, columns created by an older pending file and also named by a NEWER recorded migration
def objs(fn):
    t = re.sub(r"--[^\n]*", "", open(os.path.join(MIG, fn), encoding="utf-8", errors="replace").read())
    s = set()
    for m in re.finditer(r"(?:CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?\"([^\"]+)\"\s+ON\s+(?:public\.)?(\w+)", t, re.I):
        s.add(("policy", m.group(2).lower(), m.group(1)))
    for m in re.finditer(r"(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:public\.)?(\w+)", t, re.I):
        s.add(("index", "", m.group(1).lower()))
    for m in re.finditer(r"(?:ADD|DROP)\s+CONSTRAINT\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?\"?(\w+)\"?", t, re.I):
        s.add(("constraint", "", m.group(1).lower()))
    for m in re.finditer(r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)\s+(?:ADD|DROP|ALTER)\s+COLUMN\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?\"?(\w+)\"?", t, re.I):
        s.add(("column", m.group(1).lower(), m.group(2).lower()))
    return s


rec_objs = {}
for v, r in hist.items():
    for o in objs(r["file"]):
        rec_objs.setdefault(o, []).append(v)
other = []
for v in older:
    for o in sorted(objs(plan[v]["filename"])):
        newer = [x for x in rec_objs.get(o, []) if x > v]
        if newer:
            other.append({"older_pending_version": v, "object": list(o), "newer_recorded_versions": newer[-3:]})
out["other_object_conflicts"] = other
json.dump(out, open(os.path.join(EV, "production-overwrite-check.json"), "w", encoding="utf-8"), indent=1)
print(len(other), "policy/index/constraint/column objects named by an older pending file and by a newer recorded migration")
for c in other[:15]:
    print(c)
