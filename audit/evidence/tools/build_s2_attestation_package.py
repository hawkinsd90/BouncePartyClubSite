"""Builds the consolidated S2 execution package (AUTH-10): 11 attestation batches + B31, B33, B40, from the validated owner decision record.
Offline; no database connection. Output: filled batch scripts, a package JSON with every hash, and a read-only SQL that predicts the ledger after each batch.
Usage: python -I build_s2_attestation_package.py <decision-record.txt> <approval-text-file> <out-dir>"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_execution_package as b  # noqa: E402

REPO = b.REPO
S4 = os.path.join(REPO, "audit", "step4")
ORDER = ["B13", "B14", "B15", "B16", "B17", "B18", "B19", "B20", "B21", "B22", "B31", "B33", "B37", "B40"]
START_COUNT, START_SHA = 223, "e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4"
sha = b.sha

record_path, approval_path, out_dir = sys.argv[1:4]
record_text = open(record_path, encoding="utf-8").read()
approval_text = open(approval_path, encoding="utf-8").read().rstrip("\n")
os.makedirs(out_dir, exist_ok=True)

# ---- validated decisions (the validator already passed; re-derive the facts the scripts need)
lines = record_text.replace("\r\n", "\n").split("\n")
attestor = next(l for l in lines if l.startswith("Attestor: "))[len("Attestor: "):].strip()
utc = next(l for l in lines if l.startswith("UTC: "))[len("UTC: "):].strip()
decisions = {}
for l in lines:
    m = re.match(r"^(D\d\d) (\d{14}) (B\d\d) (ATTEST|REJECT)$", l)
    if m:
        decisions[m.group(2)] = (m.group(1), m.group(3), m.group(4))
assert len(decisions) == 44 and all(d[2] == "ATTEST" for d in decisions.values())
evidence_sha = sha(open(record_path, "rb").read())
QW = json.load(open(os.path.join(S4, "s2-qualified-attestations.json"), encoding="utf-8"))
OVR = {k: v for k, v in json.load(open(os.path.join(S4, "s2-attestation-rule-overrides.json"), encoding="utf-8")).items() if not k.startswith("_")}

STD_SCOPE = "Development state matches the intended outcome of this migration as observed read-only on 2026-10-20 (decision package entry {id}). Recorded without executing the historical SQL."
STD_NOT = "Historical SQL execution of this migration is not proven. Later application edits may have changed the data since."
EXTRA = {
    "D10": ("Superseded by owner decision. The stored 3.00 dollars per mile rate is authoritative and the migration's 5.00 dollars is obsolete. The historical SQL must never be executed and pricing is not changed.", "That the migration's own pricing values were ever applied."),
    "D18": ("The five current SMS templates exist. The removed test_message template must not be recreated and edited templates are preserved.", STD_NOT),
    "D19": ("Both columns exist. The 22 orders created after the migration with NULL selections stay unchanged and no historical customer decision is invented.", STD_NOT),
    "D40": ("The tables, functions and admin policies exist. This does not certify the permissive INSERT and UPDATE policies or anon function access as secure. They are addressed by the planned October security migrations.", STD_NOT),
    "D44": ("The column and short links exist. The seven newer invoice links are not relabelled to reproduce the historical back-fill.", STD_NOT),
}
fill_vals = {}
for v, (did, batch, _) in decisions.items():
    if did in QW:
        sc, np_ = QW[did]["scope"], QW[did]["not_proven"]
    elif did in EXTRA:
        sc, np_ = EXTRA[did]
    else:
        sc, np_ = STD_SCOPE.format(id=did), STD_NOT
    for t in (sc, np_):
        assert ";" not in t and "{" not in t and "}" not in t, (did, t)
    fill_vals[v] = (sc, np_)

# ---- rule overrides (original rules stay for every other version)
for v, o in OVR.items():
    assert v in decisions and decisions[v][0] == o["id"], v
    b.rules[v] = dict(b.rules[v], sql=o["sql"])

approval_sha = sha(approval_text)
batches = []
cnt = START_COUNT
all_rows = []  # (ordinal, version, name, marker)
for ordn, bid in enumerate(ORDER, 1):
    ops = [i for i in b.BORDER if i["batch"] == bid]
    kinds = {b.man[i["v"]]["proposed_disposition"] for i in ops}
    assert len(kinds) == 1 and kinds <= {b.ATT, b.HIST}, (bid, kinds)
    is_att = kinds == {b.ATT}
    if is_att:
        assert all(i["v"] in decisions and decisions[i["v"]][1] == bid for i in ops), bid
    else:
        assert not any(i["v"] in decisions for i in ops), bid
    tpl = b.batch_script(bid)
    f = tpl.replace("{{APPROVAL_SHA256}}", approval_sha).replace("{{BATCH_START_COUNT}}", str(cnt))
    esc = lambda s: s.replace("'", "''")
    if is_att:
        # one marker per version; each op block carries its own placeholders, so substitute per marker occurrence in script order
        for i in ops:
            v = i["v"]
            sc, np_ = fill_vals[v]
            pat = re.compile(r"(version=" + v + r"; rule_sha256=[0-9a-f]{64}); attested_by=\{\{ATTESTED_BY\}\}; attested_at=\{\{ATTESTED_AT\}\}; scope=\{\{SCOPE\}\}; not_proven=\{\{NOT_PROVEN\}\}; evidence_sha256=\{\{EVIDENCE_SHA256\}\}")
            rep = lambda m: m.group(1) + "; attested_by=" + esc(attestor) + "; attested_at=" + utc + "; scope=" + esc(sc) + "; not_proven=" + esc(np_) + "; evidence_sha256=" + evidence_sha
            f, n = pat.subn(rep, f)
            assert n == 1, (v, n)
    assert "{{" not in f, bid
    fn = os.path.join(out_dir, bid + "_filled.sql")
    open(fn, "w", encoding="utf-8", newline="\n").write(f)
    # the exact statements[1] value of every inserted row (unescaped), from the script text itself
    for i in ops:
        v = i["v"]
        m = re.search(r"VALUES \('" + v + r"', '((?:[^']|'')*)', ARRAY\['((?:[^']|'')*)'\]\);", f)
        assert m, v
        all_rows.append((ordn, v, m.group(1).replace("''", "'"), m.group(2).replace("''", "'")))
    rev = b.reversal_script(bid).replace("{{BATCH_START_COUNT}}", str(cnt))
    open(os.path.join(out_dir, bid + "_reversal.sql"), "w", encoding="utf-8", newline="\n").write(rev)
    batches.append({"reversal_sha256": sha(rev), "batch": bid, "kind": "attestation" if is_att else "history-only", "versions": [i["v"] for i in ops], "ids": [decisions[i["v"]][0] for i in ops] if is_att else [],
                    "template_sha256": sha(tpl), "filled_sha256": sha(f), "start_count": cnt, "end_count": cnt + len(ops), "file": os.path.basename(fn)})
    cnt += len(ops)

# ---- read-only prediction query: existing ledger + the new rows, cumulative per batch
vals = ",\n".join("(%d,'%s','%s','%s')" % (o, v, n.replace("'", "''"), hashlib.md5(mk.encode("utf-8")).hexdigest()) for o, v, n, mk in all_rows)
predict = ("WITH new_rows(ord,version,name,h) AS (VALUES\n" + vals + "\n), k AS (SELECT generate_series(0," + str(len(ORDER)) + ") k),\n"
           "base AS (SELECT version, coalesce(name,'') name, md5(coalesce(array_to_string(statements,E'\\n'),'')) h FROM supabase_migrations.schema_migrations),\n"
           "u AS (SELECT k.k, version, name, h FROM k, base UNION ALL SELECT k.k, n.version, n.name, n.h FROM k JOIN new_rows n ON n.ord <= k.k)\n"
           "SELECT k, count(*) rows, encode(sha256(convert_to(string_agg(version||'|'||name||'|'||h, E'\\n' ORDER BY version),'UTF8')),'hex') sha FROM u GROUP BY k ORDER BY k;\n")
open(os.path.join(out_dir, "predict_ledger.sql"), "w", encoding="utf-8", newline="\n").write(predict)

pkg = {"authorization": "AUTH-10", "approval_text": approval_text, "approval_sha256": approval_sha, "attestor": attestor, "attested_at": utc, "evidence_sha256": evidence_sha,
       "decision_record_sha256": re.search(r"SHA-256 of the list below: ([0-9a-f]{64})", record_text).group(1),
       "start": {"count": START_COUNT, "sha256": START_SHA}, "order": ORDER, "batches": batches, "total_new_rows": len(all_rows),
       "rule_overrides": {v: {"id": o["id"], "sql_sha256": sha(o["sql"])} for v, o in OVR.items()}}
json.dump(pkg, open(os.path.join(out_dir, "package.json"), "w", encoding="utf-8", newline="\n"), indent=1)
print(json.dumps({"batches": [(x["batch"], len(x["versions"]), x["start_count"], x["end_count"], x["filled_sha256"][:12]) for x in batches], "rows": len(all_rows), "approval_sha256": approval_sha}, indent=None))
