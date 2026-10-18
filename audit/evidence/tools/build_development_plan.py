"""Canonical Development migration manifest builder (Step 2 final).
Inputs (all committed or protected-local, offline): e2k-final-development-disposition.csv, e2a-dev-proof.csv (superseded_by), e2i-development-version-verdicts.csv, the 58 live ledger versions
(protected folder), and the decisions recorded below for the eight versions resolved in the final run.
Outputs: audit/development-migration-manifest.csv (canonical, committed) and, in the protected scratch folder, the items JSON used by the local rehearsal.
Offline; no database connection. Usage: python -I build_development_plan.py"""
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from step2_paths import derived, workdir  # noqa: E402
EV = os.path.abspath(os.path.join(HERE, ".."))
AUDIT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(AUDIT, ".."))
MIG = os.path.join(REPO, "supabase", "migrations")
SCR = workdir()  # intermediate files only
EXCL = "Excluded from plan (proposed; owner confirmation pending)"
S3B = "Step 3B corrective SQL (new; executes after the October block)"
REC, HIST, ATT, XSQL, WITH, WD, UNR = ("Already recorded", "Evidence-backed history-only reconciliation candidate", "Qualified owner-attestation candidate", "Actual SQL execution required",
                                      "Withheld for the October deployment gate", "Withdrawn", "Unresolved")
rd = lambda p: list(csv.DictReader(open(os.path.join(EV, p), encoding="utf-8")))
disp = {r["version"]: r for r in rd("e2k-final-development-disposition.csv")}
proof = {r["version"]: r for r in rd("e2a-dev-proof.csv") if r["environment"].lower().startswith("dev")}
live = set(open(derived("dev-ledger-versions.txt")).read().split())
withdrawn_dir = {f[:14]: f for f in os.listdir(os.path.join(EV, "withdrawn-migrations")) if f.endswith(".sql")}
active = {f[:14]: f for f in os.listdir(MIG) if f.endswith(".sql")}

# ---- decisions on the eight versions that were unresolved at E2K (evidence: step2-completion.md section 1) ----
FINAL = {
    "20251008153245": (HIST, "Superseded by 20260323164559: the live function update_contact_booking_stats has a comment-and-whitespace-free body hash identical to that file's function; its recompute backfill supersedes this one. Record history-only after 20260323164559 is handled."),
    "20260323155222": (HIST, "As 20251008153245; the loyalty columns it adds exist (completed_bookings_count is read by the live Q31); superseded by 20260323164559."),
    "20260323163432": (HIST, "As 20251008153245; superseded by 20260323164559."),
    "20260323164559": (ATT, "Function body identical to the live function (hash 7c713728...); the all-contacts recompute is unproven and must NOT be re-run: 25 of 95 contacts' total_bookings differ from a recomputation today (completed counts all agree), which the trigger corrects on the next order status change. Derived, non-financial counters."),
    "20260305205811": (ATT, "Q32: all 22 orders with deposit due but no selected payment were created after 2026-03-06 (14 draft, 4 completed, 3 cancelled, 1 in progress), so none belongs to the population the backfill touches. Re-running it would overwrite the selection on those 22 orders and is prohibited."),
    "20251003182356": (ATT, "Five of six seeded templates exist; the seeded 'test_message' row (testing only, no reference anywhere) is absent. No attestation exists. The owner would have to confirm that the removal was deliberate before any attestation is signed; if not confirmed the version stays pending. Re-running is unnecessary (ON CONFLICT DO NOTHING would only re-create the test row) and the row is not to be recreated without an application requirement."),
    "20251003170350": (ATT, "Effect present: the demo admin login exists, has signed in before, not in the last 90 days, holds the 'master' role. Execution is PROHIBITED (it would try to create the account again). Recording it as attested protects against a blind re-apply. The dormant master account with a committed demo password is a Step 3 security finding."),
    "20260611184401": (EXCL, "update_pricing_rules does not exist; no database function mentions it (Q33 = 0) and the repository has no caller. Proposed: permanently exclude its execution (deny-listed in every allowlist); the version stays pending in the ledger unless the owner separately chooses a justified not-applicable attestation. NOT yet owner-confirmed."),
}


def cat_of(v):
    return FINAL[v][0] if v in FINAL else disp[v]["final_category"]


def basis_of(v):
    return FINAL[v][1] if v in FINAL else disp[v]["evidence_basis"]


OCT_FROM = "20261007000000"
ALL = list(disp.keys())
assert len(ALL) == 388
# Step 3B corrective migrations (version 20261026000000 and later) are NEW SQL created after the Step 2 evidence was captured. They are
# not in the evidence tables, so they are appended here: SQL that executes in version order after the October block, one transaction
# per file, with no bookkeeping alternative. Their per-file prerequisites and read-only checks are in audit/security/.
S3B_FROM = "20261026000000"
S3B_VERSIONS = sorted(v for v in active if v >= S3B_FROM)
for _v in S3B_VERSIONS:
    disp[_v] = {"filename": active[_v], "final_category": S3B,
                "evidence_basis": "Step 3B corrective migration written after the Step 2 captures (audit/security/step3-remediation-plan.md); no hosted state to compare, the effect is verified by audit/security/step3b-verification-rules.json"}
ALL = ALL + S3B_VERSIONS
# ---- predecessors: superseding versions that are still pending ----
pred = {}
for v in ALL:
    sup = [s for s in (proof.get(v, {}).get("superseded_by_versions", "") or "").split(",") if s and s != v and s in disp]
    pred[v] = sorted(s for s in sup if s not in live)
# explicit chains
EXTRA_PRED = {"20260315190615": ["20260316162524"], "20260315202232": ["20260316162524"], "20260324191543": ["20260324191556"]}
for v, ps in EXTRA_PRED.items():
    pred[v] = sorted(set(pred[v]) | {p for p in ps if p in disp and p not in live})
# drop cycles: a predecessor edge is removed if the predecessor already depends on v
def reach(a, b, seen=None):
    seen = seen or set()
    for p in pred.get(a, []):
        if p == b or (p not in seen and not seen.add(p) and reach(p, b, seen)):
            return True
    return False
for v in ALL:
    pred[v] = [p for p in pred[v] if not reach(p, v)]
# Step 3B files run in version order after the LAST October file and after each other.
_chain = ["20261025120000"] + S3B_VERSIONS
for _a, _b in zip(_chain, _chain[1:]):
    pred[_b] = [_a]

# ---- phases ----
def base_phase(v):
    c = cat_of(v)
    if c == REC or c == WD:
        return 0
    if c == XSQL:
        return 2
    if c == S3B:
        return 5
    if v >= OCT_FROM and v in active:
        return 3
    if c == WITH:
        return 4
    if c in (UNR, EXCL):
        return 9
    return 1
phase = {v: base_phase(v) for v in ALL}
changed = True
while changed:
    changed = False
    for v in ALL:
        if cat_of(v) in (HIST, ATT) and phase[v] == 1:
            need = max([phase[p] for p in pred[v]] + [0])
            if need >= 3:
                phase[v], changed = 4, True
            elif need == 9:
                phase[v], changed = 9, True
PH = {0: "none", 1: "P1 pre-October bookkeeping", 2: "P2 pre-October SQL", 3: "P3 October block", 4: "P4 after October / gate", 5: "P5 Step 3B corrective SQL", 9: "decision pending"}

# ---- topological order for P1/P2 ----
def topo(vs):
    out, mark = [], {}
    def visit(v):
        if mark.get(v) == 2:
            return
        if mark.get(v) == 1:
            raise SystemExit(f"cycle at {v}")
        mark[v] = 1
        for p in pred[v]:
            if p in vs:
                visit(p)
        mark[v] = 2
        out.append(v)
    for v in sorted(vs):
        visit(v)
    return out
plan = topo({v for v in ALL if phase[v] in (1, 2)})
order = {v: i + 1 for i, v in enumerate(plan)}

STOP = {REC: "none; verify the row still exists (Q01) before any other action",
        HIST: "stop if fresh Q00/Q01 differ from the capture; if the version's catalog objects no longer match; if any predecessor is not yet recorded; never claim execution",
        ATT: "stop if the owner has not signed this version; if the observed state differs; never claim execution; never re-run the SQL",
        XSQL: "stop if Q20 shows the effect already present (then history-only); if the bucket row is missing; execute only the unchanged file in one transaction",
        WITH: "stop if its gate (Step 3 decisions, Edge Function deploy-first, rehearsal, recovery plan) is not closed; October files run only in version order",
        WD: "never recorded, never executed, never restored to the active directory",
        S3B: "stop unless every October file has run and been verified; execute only the unchanged file in one transaction, in version order; stop on the first failure; verify with audit/security/step3b-verification-rules.json",
        UNR: "no operation until the owner decision is recorded", EXCL: "never execute; deny-listed; if the owner later wants parity with Production that is a new, separately approved SQL decision"}
STEP3 = {"20251003170350": "yes: dormant master account with committed password (hardening before any reopening)", "20260323175236": "no (safe state verified)"}
rows = []
for v in ALL:
    c = cat_of(v)
    d = disp[v]
    fn = d["filename"]
    src = fn if v in active or fn in os.listdir(MIG) else (("audit/evidence/withdrawn-migrations/" + fn) if v in withdrawn_dir else "ledger-only (no repository file)")
    if c == WD:
        src = "audit/evidence/withdrawn-migrations/" + fn
    if v == "20260814002658":
        src = "ledger-only alias of 20260814120000_create_contact_inquiries.sql"
    led = "recorded" if v in live else "not recorded"
    if v == "20260814120000":
        led = "not recorded under this version; recorded as 20260814002658 (alias)"
    name = re.sub(r"\.sql(\.sql)?$", "", fn[15:]) if fn else v
    if c == REC:
        op = "none"
    elif c == HIST:
        op = f"INSERT ledger row (version={v}, name='{name}', statements=[history-only marker with basis]) via the reviewed mechanism; no SQL runs"
    elif c == ATT:
        op = f"INSERT ledger row (version={v}, name='{name}', statements=[attestation marker: attested_by, attested_at, scope, not_proven]) only after the owner signs; no SQL runs"
    elif c == XSQL:
        op = f"Execute {fn} unchanged in one transaction together with its executed ledger row (exact LF SQL stored)"
    elif c == WITH:
        op = ("Execute " + fn + " as SQL in version order after its gates" if v >= OCT_FROM and v in active else "History-only row only after its superseding/gating versions have run and been re-verified")
    elif c == S3B:
        op = f"Execute {fn} unchanged in one transaction (Step 3B), in version order, after the October block; same file for Production and Development"
    elif c == WD:
        op = "none (withdrawn; excluded from every plan)"
    elif c == EXCL:
        op = "none proposed: excluded from every allowlist and listed in the execution deny list; stays pending in the ledger unless the owner separately chooses a justified not-applicable attestation"
    else:
        op = "owner decision first"
    step3 = ("this IS a Step 3B migration: see audit/security/step3-security-issue-register.csv" if c == S3B else None) or STEP3.get(v, "yes: October gate G2/G3/G4 and the Step 3 items" if (v >= OCT_FROM and v in active) else "yes: containment/storage decisions" if c == WITH else "no")
    rows.append({
        "version": v, "filename_or_archived_source": src, "development_ledger_status": led, "current_state_evidence": basis_of(v)[:420],
        "proposed_disposition": c, "plan_phase": PH[phase[v]], "plan_order": order.get(v, ""),
        "exact_required_operation": op, "required_predecessor_versions": ";".join(pred[v]), "step3_dependency": step3,
        "owner_attestation_needed": "yes (per version)" if c == ATT else "no" if c in (REC, HIST, WD) else "owner approval of the SQL" if c in (XSQL, S3B) else "gate decisions" if c == WITH else "owner confirmation of the exclusion" if c == EXCL else "decision",
        "sql_executes": "yes" if (c in (XSQL, S3B) or (c == WITH and v >= OCT_FROM and v in active)) else "no",
        "history_only_justified": "yes (supersession/catalog identity; not proof of execution)" if c == HIST else "conditional (after gate)" if c == WITH and not (v >= OCT_FROM and v in active) else "no",
        "stop_and_verification_conditions": STOP[c]})
with open(os.path.join(AUDIT, "development-migration-manifest.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
cnt = Counter(cat_of(v) for v in ALL)
print("rows", len(rows), dict(cnt))
print("phases", dict(Counter(PH[phase[v]] for v in ALL)))
print("P1/P2 plan items", len(plan), "H deferred to P4:", sum(1 for v in ALL if cat_of(v) == HIST and phase[v] == 4), "H with unresolved predecessor:", sum(1 for v in ALL if cat_of(v) == HIST and phase[v] == 9))

# ---- items for the local rehearsal (unmodified executor, scratch only) ----
items = []
for v in plan:
    c = cat_of(v)
    fn = disp[v]["filename"]
    if c == XSQL:
        items.append({"version": v, "file": fn, "kind": "execute", "requires": []})
    elif c == HIST:
        items.append({"version": v, "file": fn, "kind": "history-only", "basis": "REHEARSAL: " + basis_of(v)[:160]})
    elif c == ATT:
        items.append({"version": v, "file": fn, "kind": "attestation", "attested_by": "REHEARSAL-SYNTHETIC (no owner attestation exists)", "attested_at": "2026-10-17", "scope": "rehearsal of mechanics only", "not_proven": "historical execution"})
json.dump(items, open(os.path.join(SCR, "dev-plan-items.json"), "w", encoding="utf-8", newline="\n"), indent=1)
json.dump({"phase": {v: phase[v] for v in ALL}, "pred": pred, "plan": plan}, open(os.path.join(SCR, "dev-plan-graph.json"), "w", encoding="utf-8", newline="\n"))
print("rehearsal items", len(items), Counter(i["kind"] for i in items))
