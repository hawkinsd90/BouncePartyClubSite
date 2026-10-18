"""Canonical PRODUCTION migration-recovery manifest builder. Offline; no database connection, no hosted access.
Sources (committed or protected-local): prod-history-277.csv, prod-pending-110.csv, e2c-proposed-execution-manifest.csv (the rehearsed 58 + 9), e2a-prod-baseline-proof.csv, e2a-statements-all.csv (Production rows),
scripts/dev/local-executor/prod58-dependencies.json, the withdrawn index, and (for per-item verification rules) the validated atoms produced by rehearse_production_plan.py.
Phases:  candidates  -> writes the candidate pre/post atoms for the 58 executable items (scratch)
         manifest    -> writes audit/production-migration-manifest.csv and audit/production-verification-rules.json
Usage: python -I build_production_plan.py candidates|manifest"""
import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rule_atoms import atom  # noqa: E402
from step2_paths import derived, workdir  # noqa: E402

EV = os.path.abspath(os.path.join(HERE, ".."))
AUDIT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(AUDIT, ".."))
MIG = os.path.join(REPO, "supabase", "migrations")
SCR = workdir()  # intermediate files only; nothing here is an input
E2A = derived("e2a-statements-all.csv")
rd = lambda p: list(csv.DictReader(open(os.path.join(EV, p), encoding="utf-8")))
plan = {r["version"]: r for r in rd("e2c-proposed-execution-manifest.csv")}
hist = {r["version"]: r for r in rd("prod-history-277.csv")}
pend = {r["version"]: r for r in rd("prod-pending-110.csv")}
base_proof = {r["version"]: r for r in rd("e2a-prod-baseline-proof.csv")}
deps_extra = json.load(open(os.path.join(REPO, "scripts", "dev", "local-executor", "prod58-dependencies.json"), encoding="utf-8")).get("requires", {})
withdrawn = json.load(open(os.path.join(EV, "withdrawn-migrations", "withdrawn-index.json"), encoding="utf-8"))["withdrawn"]
e2a_prod = defaultdict(list)
for r in csv.DictReader(open(E2A, encoding="utf-8")):
    if r["environment"] == "Production":
        e2a_prod[r["version"]].append(r)
e2a_proof_prod = {r["version"]: r for r in rd("e2a-prod-baseline-proof.csv")}
active = {f[:14]: f for f in os.listdir(MIG) if f.endswith(".sql")}
EXEC = [v for v, r in plan.items() if r["proposed_action"] == "execute"]
OMIT = [v for v, r in plan.items() if r["proposed_action"] != "execute"]
assert len(EXEC) == 58 and len(OMIT) == 9 and len(hist) == 277


def candidates():
    out = {}
    for v in EXEC:
        lst = []
        for r in e2a_prod.get(v, []):
            if r["status"] != "ABSENT" or r["kind"] in ("inline-constraint", "comment", "data", "dynamic", "bucketvis"):
                continue
            d = r["detail"]
            if d.startswith("catalog reflects the older element") or d.startswith("existence by type"):
                continue
            a = atom(r["kind"], r["object"])
            if not a:
                continue
            if r["kind"] == "grant" and "REVOKE not reflected" in d:
                lst.append({"atom": a, "pre": True, "post": False, "obj": f"{r['kind']}:{r['object']}"})
            else:
                lst.append({"atom": a, "pre": False, "post": True, "obj": f"{r['kind']}:{r['object']}"})
        out[v] = lst
    json.dump(out, open(os.path.join(SCR, "prod-candidates.json"), "w", encoding="utf-8", newline="\n"))
    print("candidate atoms", sum(len(x) for x in out.values()), "items with atoms", sum(1 for x in out.values() if x))


# ------------------------------------------------------------------ security / ordering prerequisites (from the audit gates R.2 and the E2H security-state study)
PREREQ = {
    "20261007120000": "Payment RPC callers confirmed as authorized/service-role clients; update_pricing_rules exists on Production and is restricted here",
    "20261008120000": "identify the Production function that calls get_admin_users (audit 3.12) before it becomes service-role only",
    "20261009120000": "customer-portal link consumers compatible",
    "20261010120000": "create-booking / complete-booking compatible versions deployed with this migration (audit 4.1)",
    "20261012120000": "customer-cancel-order deployed with or before; core lockdown of anon/crew table access: confirm callers (audit 4.1, e2b2 outline)",
    "20261013120000": "anon-executable function allow-list reconciled (audit 3.2); the three portal short-link functions are the only incremental callable exposure before this step",
    "20261014120000": "waiver functions deployed before; signed-URL consumers for private waiver buckets",
    "20261015120000": "customer-portal-* and task-evidence deployed before; signed-URL consumers for order/lot pictures",
    "20261015123000": "customer-portal-* and task-evidence deployed before",
    "20261016120000": "snapshot first: deletes 2 orphan user_roles rows, adds an FK and an auth.users trigger (audit 4.6)",
    "20261017120000": "booking-confirmation claim: compatible complete-booking/create-booking deployed",
    "20261018120000": "future default privileges for owner postgres only; Production's supabase_admin default ACLs remain (audit 3.3)",
    "20261018120100": "record-site-event deployed before",
    "20261018120200": "callers of role lookup/profile ownership confirmed",
    "20261019120000": "financial RPC callers (stripe-webhook, staff-order-save, stripe-refund) compatible versions deployed with the financial block",
    "20261020120000": "financial block: compatible Edge Functions", "20261021120000": "staff-order-save deployed with this migration (audit 4.1)",
    "20261022120000": "stripe-refund deployed with this migration (audit 4.1)", "20261023120000": "refund allocation block: stripe-refund compatible", "20261024120000": "stripe-refund deployed with this migration",
    "20261025120000": "refund overview: admin client compatible", "20260722172048": "owner decision D-2 before the October booking code is deployed (nullable surface for Event-Essentials-only orders)",
}
RECOVERY_EXEC = ("Each file runs in ONE transaction with its ledger row: a failure rolls back completely and nothing is recorded. A COMMITTED file has no ledger-only reversal; recovery is by a point-in-time restore/backup taken immediately before the run "
                 "(Step 4 prerequisite; availability for this project is unverified) or by a separately reviewed compensating migration. For anonymous-surface regressions the prepared targeted containment (e2h-security-recovery-plan.md) applies.")


def manifest():
    val = json.load(open(derived("prod-validated.json"), encoding="utf-8"))
    cand = json.load(open(os.path.join(SCR, "prod-candidates.json"), encoding="utf-8"))
    rehearsal = json.load(open(os.path.join(EV, "production-plan-rehearsal-results.json"), encoding="utf-8")) if os.path.exists(os.path.join(EV, "production-plan-rehearsal-results.json")) else {}
    anon_inc = rehearsal.get("anon_increases", {})
    fin = rehearsal.get("financial_changes", {})
    rules = {}
    rows = []

    def row(v, src, led, grp, eff, disp, sql, hist_req, sup, order, preds, sec, cur, post, rec, unres):
        rows.append({"version": v, "filename_or_archived_source": src, "production_ledger_status": led, "group": grp, "intended_historical_effect": eff[:400], "proposed_disposition": disp,
                     "required_sql_execution": sql, "history_only_requirements": hist_req, "superseding_versions": sup, "plan_order": order, "required_predecessor_versions": preds,
                     "security_prerequisites": sec, "current_state_verification": cur, "post_operation_verification": post, "recovery_procedure": rec, "unresolved_differences": unres[:500], "owner_approval": "not approved"})

    for v, r in sorted(hist.items()):
        unres = ""
        if r["class"] == "RECORDED_EFFECT_MISSING":
            unres = f"recorded but its catalog effect is missing: {r['missing_items'] or r['notes']}"[:300]
        elif r["recorded_sql_vs_file"] != "IDENTICAL":
            unres = f"recorded SQL differs from the file ({r['recorded_sql_vs_file']})"
        row(v, r["file"], f"recorded (name: {r['history_name']})", "recorded", r["history_name"], "Already recorded", "no", "none", "", "", "", "none (never re-applied)",
            f"recorded row exists in the 2026-10-16 capture; catalog verdict {r['catalog_verdict']}", "unchanged by the plan: no allowlist or history-only item names a recorded version", "none", unres)
    for v in EXEC:
        r = plan[v]
        atoms = val.get(v, [])
        c = cand.get(v, [])
        valid_atoms = [a for a in atoms]
        pre_ok = [a["atom"] for a in c if a["atom"] in valid_atoms and a["pre"] is False]
        pre_held = [a["atom"] for a in c if a["atom"] in valid_atoms and a["pre"] is True]
        post_true = [a["atom"] for a in c if a["atom"] in valid_atoms and a["post"] is True]
        post_false = [a["atom"] for a in c if a["atom"] in valid_atoms and a["post"] is False]
        pre_sql = " AND ".join([f"NOT ({x})" for x in pre_ok] + [f"({x})" for x in pre_held])
        post_sql = " AND ".join([f"({x})" for x in post_true] + [f"NOT ({x})" for x in post_false])
        rules[v] = {"status": "DEFINED" if valid_atoms else "SEQUENCE-LEVEL ONLY", "pre_state_sql": ("SELECT " + pre_sql + " AS pre_ok") if pre_sql else "", "post_state_sql": ("SELECT " + post_sql + " AS post_ok") if post_sql else "", "atoms": len(valid_atoms),
                    "candidates": len(c)}
        sup = e2a_proof_prod.get(v, {}).get("superseded_by_versions", "")
        allp = set(p for p in ([p.strip() for p in (r["depends_on_selected_versions"] or "").replace(";", ",").split(",")] + deps_extra.get(v, [])) if p in EXEC and p != v)
        preds = sorted(p for p in allp if p < v)  # the executor requires prerequisites to be EARLIER items
        later = sorted(p for p in allp if p > v)
        sec = PREREQ.get(v, "none beyond the order of the sequence")
        if v in anon_inc:
            sec += f" | temporarily widens the anonymous surface in local rehearsal ({anon_inc[v]}); closed by later steps (e2h-security-recovery-plan.md)"
        if v in fin:
            sec += f" | changes financial columns of existing synthetic rows in rehearsal: {fin[v]} (data statement; see d4-data-change-coverage.csv)"
        cur = (f"{len(pre_ok) + len(pre_held)} validated pre-state atoms (see production-verification-rules.json); " if valid_atoms else "no object-level pre-state atom (function replacement or data statement); ") + "plus a fresh read-only capture inside 24 h and the 24 preflight queries (e1-production-preflight-queries.sql)"
        post = (f"{len(post_true) + len(post_false)} validated post-state atoms true immediately after the item; " if valid_atoms else "") + "after the full sequence the catalog must equal the rehearsed reference (E2G R05) and the D3 final assertions (37 checks)"
        row(v, r["filename"], "not recorded", "october" if v >= "20261007000000" else "dev-line", r["reason"] + " | " + r["specific_evidence"], "SQL execution (rehearsed locally; NOT approved for hosted execution)", "yes: original file, original version, one transaction with its ledger row",
            "none (recorded as executed by the approved application method)", sup, r["order"], ";".join(preds), sec, cur, post, RECOVERY_EXEC,
            ((r["unresolved_preconditions"] or "") + (f" | the E2C dependency column also names the LATER version(s) {','.join(later)}: informational only (the rehearsed order ran this file first and the executor accepts only earlier prerequisites)" if later else ""))[:500])
    for v in OMIT:
        r = plan[v]
        row(v, r["filename"], "not recorded", "october" if v >= "20261007000000" else "dev-line", r["reason"], "History-only reconciliation (omitted from the 58; SQL never executed)", "no",
            f"{r['history_record_kind_if_needed']}; record only after its superseder(s) have executed and the read-only predicate holds ({r['ordering_note'] or 'before the first execution'})", ";".join(sorted(set((r["depends_on_selected_versions"] or "").replace(";", ",").split(",")) - {""})),
            r["order"], "", "none", "predicate from the allowlist (build-allowlist.cjs HISTORY_ONLY_RULES) evaluated read-only immediately before the record", "ledger row with the history-only marker exists; no schema change", "delete exactly that ledger row (marker-limited)",
            (r["unresolved_preconditions"] or "")[:300])
    for v, r in sorted(pend.items()):
        if r["group"] != "baseline":
            continue
        bp = base_proof.get(v, {})
        cls = bp.get("e2a_class", "?")
        disp = "Baseline file: NEVER execute; history-only candidate after per-file proof" if cls == "H" else "Baseline file: NEVER execute; requires additional proof before any history-only record"
        row(v, r["file"], "not recorded", "baseline", f"baseline file ({r['class']}); effects reflected in the Production catalog or superseded", disp, "no (executing a baseline file re-creates closed policies, resurrects dropped columns and overwrites live pricing and functions: audit rule R4)",
            bp.get("e2a_verdict", r["recommended_resolution"])[:200], bp.get("superseded_by_versions", ""), "", "", "none (must never be applied; its absence from the ledger is not a defect)",
            bp.get("readonly_queries_needed", "") or "per-file read-only proof (e2a-prod-baseline-proof.csv)", "ledger row with the history-only marker; no schema change", "delete exactly that ledger row (marker-limited)",
            "; ".join(x for x in (bp.get("absent_or_unmatched_objects", ""), bp.get("basis", "")) if x)[:300])
    for w_ in withdrawn:
        v = w_["version"]
        fn = next((f for f in os.listdir(os.path.join(EV, "withdrawn-migrations")) if f.startswith(v)), "")
        row(v, "audit/evidence/withdrawn-migrations/" + fn, "not recorded (must never be)", "withdrawn", w_.get("note", w_.get("reason", ""))[:300], "Withdrawn", "no", "none", "", "", "", "none", "must not be present in the active migration directory (pending-set calculator and executor refuse it)",
            "n/a", "none", "")
    # ---- Step 3B appendix: corrective SQL written after the Step 2 captures (version 20261026000000 and later). It is NOT part of the
    # 67-item rehearsed plan, the 58-item executor allowlist or production-verification-rules.json; it runs after plan_order 67 in version order.
    S3B_EFFECT = {
        "20261026120000": "Revoke API-role privileges on sequences (anon all; authenticated setval); remove anon table privileges where no anon policy exists; pin one SECURITY DEFINER search_path (SEC-014, SEC-039, SEC-037)",
        "20261026120100": "GRANT SELECT on the eight Event Essentials catalog tables to service_role only (SEC-016)",
        "20261026120200": "Add the Crew task_status INSERT policy and the Admin transaction_receipts UPDATE policy (SEC-036)",
        "20261026120300": "Add a trigger that rejects browser-role writes to the booking-confirmation claim columns of orders (SEC-047)",
        "20261026120400": "Remove the anon/authenticated entries from the supabase_admin default privileges in schema public where the role may (SEC-015)",
    }
    s3b = sorted(v for v in active if v >= "20261026000000")
    assert s3b == sorted(S3B_EFFECT), s3b
    chain = ["20261025120000"] + s3b
    for a_, b_ in zip(chain, chain[1:]):
        row(b_, active[b_], "not recorded", "step3b", S3B_EFFECT[b_], "Step 3B corrective SQL (new; executes after plan_order 67; NOT approved for hosted execution)",
            "yes: original file, original version, one transaction with its ledger row, in version order after plan_order 67", "none (recorded as executed by the approved application method)", "", "", a_,
            "audit/security/step3b-verification-rules.json lists the read-only pre- and post-state check; compatible Edge Functions are deployed first where audit/security/step3-step4-deployment-dependencies.md says so",
            "audit/security/step3b-verification-rules.json: pre_state_sql is true before the file, post_state_sql after it", "audit/security/step3b-verification-rules.json: post_state_sql is true; the anon-executable allow-list, sequence and policy checks of securityPosture.test.ts hold",
            RECOVERY_EXEC, "")
    assert len(rows) == 277 + 58 + 9 + 40 + 3 + 5, len(rows)
    with open(os.path.join(AUDIT, "production-migration-manifest.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    json.dump(rules, open(os.path.join(AUDIT, "production-verification-rules.json"), "w", encoding="utf-8", newline="\n"), indent=1)
    print("rows", len(rows), dict(Counter(r["group"] for r in rows)), "rule status", dict(Counter(x["status"] for x in rules.values())))


if __name__ == "__main__":
    {"candidates": candidates, "manifest": manifest}[sys.argv[1]]()
