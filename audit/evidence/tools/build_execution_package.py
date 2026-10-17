"""Builds audit/development-execution-manifest.csv (259 pre-October operations, one row each, with batches, source hash, rule, expected change, verification, recovery) and the batch SQL scripts
(template functions below; scripts are generated on demand, never committed with secrets). Offline; no database connection.
The scripts are PROPOSALS for a separately approved, separately designed hosted procedure; this module is not an executor and has no connection code.
Usage: python -I build_execution_package.py"""
import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
EV = os.path.abspath(os.path.join(HERE, ".."))
AUDIT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(AUDIT, ".."))
MIG = os.path.join(REPO, "supabase", "migrations")
SCR = r"C:\Users\vikki\migration-evidence\step2-final-scratch"
HIST, ATT, XSQL = "Evidence-backed history-only reconciliation candidate", "Qualified owner-attestation candidate", "Actual SQL execution required"
BASE = 58
PREFIX = "-- BPC-DEV-RECONCILIATION"
lit = lambda s: "'" + str(s).replace("'", "''") + "'"
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()
man = {r["version"]: r for r in csv.DictReader(open(os.path.join(AUDIT, "development-migration-manifest.csv"), encoding="utf-8"))}
rules = json.load(open(os.path.join(AUDIT, "development-verification-rules.json"), encoding="utf-8"))
plan = json.load(open(os.path.join(SCR, "dev-plan-graph.json"), encoding="utf-8"))["plan"]


def file_lf(fn):
    return open(os.path.join(MIG, fn), "rb").read().replace(b"\r\n", b"\n").decode("utf-8")


def name_of(fn):
    return re.sub(r"\.sql(\.sql)?$", "", fn[15:])


def expr_of(rule_sql):
    return rule_sql[len("SELECT "):-len(" AS rule_ok")]


# ------------------------------------------------------------------ groups, classes, waves
G = {
    "G1 admin settings": ["20251002210020", "20251003152224", "20251003183947", "20251007210840", "20251231171420", "20260126184412", "20260126193205", "20260203053948", "20260224184535", "20260325231020"],
    "G2 templates": ["20251008144308", "20251205125907", "20251216201450", "20260126193254", "20251221225000", "20260224183629", "20251003182356"],
    "G3 pricing configuration": ["20251001051901", "20251001192425", "20251002180149", "20251130231633", "20251222014723", "20251222020729", "20260119195140", "20260311121119"],
    "G4 order flags": ["20251007220415", "20251007221227", "20251007221817", "20251130191333", "20260816221636", "20260928172217"],
    "G5 catalog and content": ["20251001052039", "20251207160232", "20251231174711", "20260224133344", "20260224161311", "20260224165424", "20260318191352", "20260331151647", "20260415234700"],
    "G6 roles": ["20260324175546", "20260324190039"],
    "G7 payments, finance, identity": ["20251209133113", "20260120203953", "20260125170305", "20260125173238", "20260305222010", "20260326004004", "20260302131311", "20260311191611", "20260314213726", "20260314215031", "20260315173745",
                                       "20260323175236", "20260311113547", "20260305205811"],
    "G8 contact statistics": ["20260323164559"],
    "G9 demo admin": ["20251003170350"],
}
GOF = {v: g for g, vs in G.items() for v in vs}
wave = {}
for v in plan:
    wave[v] = 1 + max([wave.get(p, -1) for p in rules[v]["predecessors"] if p in wave] + [-1]) if rules[v]["predecessors"] else 0
SECURITY_RX = re.compile(r"pg_policies|aclexplode|relrowsecurity")


def klass(v):
    c = man[v]["proposed_disposition"]
    st = rules[v]["status"]
    if c == XSQL:
        return "X"
    if st == "BLOCKED":
        return "Z"
    if c == ATT:
        return "W" if st == "WEAK" else "Q"
    return "S" if SECURITY_RX.search(rules[v]["sql"]) else "H"


KO = {"canary": 0, "H": 1, "S": 2, "Q": 3, "X": 4, "W": 5, "Z": 6}
# canary: lowest-risk wave-0 plain history-only op: only table/column checks, one or two atoms, earliest version
cands = [v for v in plan if klass(v) == "H" and wave[v] == 0 and not rules[v]["predecessors"] and rules[v]["atoms"] <= 2 and "information_schema.columns" in rules[v]["sql"] and "pg_" not in rules[v]["sql"].replace("information_schema", "")]
CANARY = sorted(cands)[0]
items = []
for v in plan:
    k = klass(v)
    items.append({"v": v, "klass": "canary" if v == CANARY else k, "wave": wave[v], "group": GOF.get(v, "-")})
items.sort(key=lambda i: (i["wave"] if i["klass"] != "canary" else -1, KO[i["klass"]], i["group"], i["v"]))
batches, cur, curkey = [], [], None
SIZE = {"canary": 1, "H": 12, "S": 12, "Q": 8, "X": 1, "W": 6, "Z": 6}
for it in items:
    key = (it["klass"], it["wave"] if it["klass"] in ("H", "S") else 0, it["group"] if it["klass"] in ("Q", "W", "Z") else "")
    if cur and (key != curkey or len(cur) >= SIZE[it["klass"]]):
        batches.append(cur)
        cur = []
    curkey = key
    cur.append(it)
if cur:
    batches.append(cur)
bid = {}
for i, b in enumerate(batches, 1):
    for it in b:
        it["batch"] = f"B{i:02d}"
        bid[it["v"]] = f"B{i:02d}"
BORDER = [i for b in batches for i in b]
# dependency safety: predecessors in the plan must be in an earlier batch, or earlier in the same batch
pos = {it["v"]: n for n, it in enumerate(BORDER)}
bad = [(it["v"], p) for it in BORDER for p in rules[it["v"]]["predecessors"] if p in pos and pos[p] >= pos[it["v"]]]
assert not bad, bad


# ------------------------------------------------------------------ script templates (proposals; used by the local tests only)
def marker(it, kind):
    v = it["v"]
    r = rules[v]
    base = f"{PREFIX} {kind}; batch={it['batch']}; version={v}; rule_sha256={sha(r['sql'])}"
    if kind == "history-only NOT EXECUTED":
        return base + f"; basis={re.sub(chr(10), ' ', r['note'])[:120]}"
    if kind == "attestation NOT EXECUTED":
        return base + "; attested_by={{ATTESTED_BY}}; attested_at={{ATTESTED_AT}}; scope={{SCOPE}}; not_proven={{NOT_PROVEN}}; evidence_sha256={{EVIDENCE_SHA256}}"
    return base + f"; sha256_lf={sha(file_lf(man[v]['filename_or_archived_source']).encode())}"


def op_block(it, n, with_rule=True):
    v = it["v"]
    fn = man[v]["filename_or_archived_source"]
    r = rules[v]
    kind = "attestation NOT EXECUTED" if man[v]["proposed_disposition"] == ATT else "history-only NOT EXECUTED"
    lines = [f"  -- op {n}: {v} ({kind.split()[0]})",
             f"  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = {lit(v)}) THEN RAISE EXCEPTION 'version already recorded: {v}'; END IF;"]
    if r["predecessors"]:
        arr = ",".join(lit(p) for p in r["predecessors"])
        lines.append(f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}])) <> {len(r['predecessors'])} THEN RAISE EXCEPTION 'predecessor not recorded for {v}'; END IF;")
    if with_rule:
        lines.append(f"  IF NOT COALESCE(({expr_of(r['sql'])}), false) THEN RAISE EXCEPTION 'verification rule failed for {v}'; END IF;")
    lines.append(f"  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ({lit(v)}, {lit(name_of(fn))}, ARRAY[{lit(marker(it, kind))}]);")
    return lines


def batch_script(batch_id):
    ops = [i for i in BORDER if i["batch"] == batch_id]
    v0 = ops[0]["v"]
    xs = [i for i in ops if man[i["v"]]["proposed_disposition"] == XSQL]
    L = [f"{PREFIX} script for batch {batch_id}: {len(ops)} operation(s); generated from development-execution-manifest.csv; approval {{{{APPROVAL_SHA256}}}}",
         "SET LOCAL lock_timeout = '3s';", "SET LOCAL statement_timeout = '60s';", "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));"]
    if xs:
        it = xs[0]
        v = it["v"]
        fn = man[v]["filename_or_archived_source"]
        sql = file_lf(fn)
        assert "$bpcsql$" not in sql
        L += ["DO $bpc$", "BEGIN", f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {{{{BATCH_START_COUNT}}}} THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;"]
        L += op_block(it, 1)[:-1]  # without the insert: the insert follows the SQL
        L += ["END $bpc$;", f"-- exact file {fn} (sha256_lf {sha(sql.encode())}) follows verbatim", sql.rstrip("\n") + ";",
              f"INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ({lit(v)}, {lit(name_of(fn))}, ARRAY[{lit(marker(it, 'executed'))}, ${'bpcsql'}${sql}${'bpcsql'}$]);"]
        return "\n".join(L) + "\n"
    L += ["DO $bpc$", "BEGIN", f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {{{{BATCH_START_COUNT}}}} THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;"]
    for n, it in enumerate(ops, 1):
        L += op_block(it, n)
    L += [f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {{{{BATCH_START_COUNT}}}} + {len(ops)} THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;", "END $bpc$;"]
    return "\n".join(L) + "\n"


def reversal_script(batch_id):
    ops = [i for i in BORDER if i["batch"] == batch_id]
    arr = ",".join(lit(i["v"]) for i in ops)
    L = [f"{PREFIX} REVERSAL for batch {batch_id} (owner-approved use only)", "SET LOCAL lock_timeout = '3s';", "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));", "DO $bpc$", "BEGIN",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}]) AND statements[1] LIKE {lit(PREFIX + '%batch=' + batch_id + ';%')}) <> {len(ops)} THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;",
         f"  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}]) AND statements[1] LIKE {lit(PREFIX + '%batch=' + batch_id + ';%')};"]
    for i in ops:
        if man[i["v"]]["proposed_disposition"] == XSQL:
            bn = "carousel-media" if i["v"] == "20260325231044" else "public-assets"
            L.append(f"  UPDATE storage.buckets SET file_size_limit = NULL{', allowed_mime_types = NULL' if bn == 'public-assets' else ''} WHERE id = {lit(bn)}; -- restores the values recorded by the pre-batch read (both NULL at capture)")
    L += [f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {{{{BATCH_START_COUNT}}}} THEN RAISE EXCEPTION 'ledger count after reversal differs from the pre-batch export'; END IF;", "END $bpc$;"]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    rows = []
    n = 0
    for it in BORDER:
        n += 1
        v = it["v"]
        m = man[v]
        r = rules[v]
        c = m["proposed_disposition"]
        fn = m["filename_or_archived_source"]
        typ = "sql-execute" if c == XSQL else "attestation" if c == ATT else "history-only"
        exp = ("storage.buckets limits updated" + (" (file_size_limit 524288000)" if v == "20260325231044" else " (file_size_limit and allowed_mime_types per the file)") + " + 1 executed ledger row (exact SQL in statements[2])") if c == XSQL \
            else "ledger +1 row, marker 'attestation NOT EXECUTED'; no schema or data change" if c == ATT else "ledger +1 row, marker 'history-only NOT EXECUTED'; no schema or data change"
        post = (f"SELECT version, left(statements[1], 80) FROM supabase_migrations.schema_migrations WHERE version = '{v}'; ledger count = batch start + position; rule re-evaluates true" +
                ("; storage.buckets row equals the file's values; statements[2] hash = sha256_lf" if c == XSQL else ""))
        rec = ("the batch script is one transaction: any failed assertion rolls everything back and records nothing; after a mistaken commit use REVERSAL " + it["batch"] + " (DELETE limited to this batch's versions AND marker; compare with the pre-batch ledger export)" +
               ("; also restore storage.buckets to the values read before the batch" if c == XSQL else ""))
        att = "yes: signed per version (attested_by, attested_at, scope, not_proven, evidence hash); weak/blocked rule limits must be accepted in the scope" if c == ATT else "no (bookkeeping; owner approves the batch)" if c == HIST else "owner approves the exact SQL"
        step3 = m["step3_dependency"] if m["step3_dependency"] != "no" else ("run before any Step 3 change that removes/alters the checked objects" if SECURITY_RX.search(r["sql"]) else "no")
        rows.append({"batch": it["batch"], "execution_seq": n, "plan_order": m["plan_order"], "version": v, "operation_type": typ, "source_file": fn, "sha256_lf": sha(file_lf(fn).encode()),
                     "predecessor_versions": ";".join(r["predecessors"]), "rule_status": r["status"], "rule_kind": r["kind"], "rule_sha256": sha(r["sql"]) if r["sql"] else "",
                     "current_state_verification": r["note"][:300], "attestation_required": att, "expected_change": exp, "post_operation_verification": post, "failure_and_recovery": rec,
                     "step3_dependency": step3, "batch_class": {"canary": "CANARY", "H": "history-only (plain)", "S": "history-only (security-touching objects)", "Q": "attestation (rule defined)", "X": "SQL (Storage decision)", "W": "attestation (WEAK rule: not approvable as is)", "Z": "BLOCKED (no safe rule)"}[it["klass"]],
                     "approval_status": "not approved"})
    with open(os.path.join(AUDIT, "development-execution-manifest.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    # per-batch script hashes (templates with placeholders)
    sh = {b: {"script_sha256": sha(batch_script(b)), "reversal_sha256": sha(reversal_script(b))} for b in sorted({i["batch"] for i in BORDER})}
    json.dump({"canary": CANARY, "batches": {b: [i["v"] for i in BORDER if i["batch"] == b] for b in sh}, "hashes": sh}, open(os.path.join(AUDIT, "development-execution-batches.json"), "w", encoding="utf-8"), indent=1)
    print("ops", len(rows), "batches", len(sh), "canary", CANARY, dict(Counter(r["batch_class"] for r in rows)))
    print("sizes", Counter(len([i for i in BORDER if i["batch"] == b]) for b in sh))
