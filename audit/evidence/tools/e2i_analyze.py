"""Stage E2I: offline per-version analysis for the Development reconciliation proposal. Reads only repository SQL, committed E2A/E2E evidence tables and the protected Stage B catalog captures (read-only files);
writes e2i-development-version-verdicts.csv and e2i-development-manifest.csv. No database connection of any kind. Candidates are proposals, never approvals.
Usage: python -I e2i_analyze.py"""
import csv
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2a_sql as SQL  # noqa: E402

EV = os.path.abspath(os.path.join(HERE, ".."))
MIG = os.path.abspath(os.path.join(HERE, "..", "..", "..", "supabase", "migrations"))
P = r"C:\Users\vikki\migration-evidence\stage-b-20261016"


def cat(env, c):
    return json.load(open(f"{P}\\{env}_catalog_{c}.json", encoding="utf-8"))


dev_hist = {r["version"] for r in cat("dev", "history")}
prod_hist = {r["version"] for r in cat("prod", "history")}
proof = {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "e2a-dev-proof.csv"), encoding="utf-8")) if r["environment"].lower().startswith("dev")}
e2e = list(csv.DictReader(open(os.path.join(EV, "e2e-development-manifest.csv"), encoding="utf-8")))
e2e_by = {r["version"]: r for r in e2e}
OCT_FROM = "20261007000000"
evidence_set = [r["version"] for r in e2e if (r["proposed_category"].startswith(("Requires", "Withheld")) or "net-zero" in r["subcategory"]) and r["version"] < OCT_FROM]
assert len(evidence_set) == 94, len(evidence_set)

# catalog checks used to upgrade E2A "unmatched" / "absent" results (identical objects in both captures)
bill_dev = [c for c in cat("dev", "constraints") if c.get("tbl") == "billing_addresses"]
bill_prod = [c for c in cat("prod", "constraints") if c.get("tbl") == "billing_addresses"]
bill_same = sorted(json.dumps(c, sort_keys=True) for c in bill_dev) == sorted(json.dumps(c, sort_keys=True) for c in bill_prod)

NET_ZERO = ["20260315190615", "20260315202232", "20260316174421", "20260324191543"]
H_EXTRA = {
    "20260324193222": "Functions present; superseded by 20260326052438. Development carries extra PUBLIC EXECUTE grants on assign_role_by_email/get_all_role_users that Production lacks; they are a privilege difference, not a history question, and the October lockdown removes them (no grant difference remains in the post-October diff).",
    "20251215015109": "The policy exists in both captures with identical roles, command and check expression; E2A reported it unmatched only because of expression text normalisation.",
    "20260305004845": "Only DROP POLICY IF EXISTS on lot-picture policies, all superseded by 20260323175228; nothing is created.",
    "20260316234814": "One DO block that drops custom_email_hook if present; the function is absent in both captures.",
    "20260317201616": "pending_signups_consent table and its four policies are identical in both captures (E2A unmatched = expression text only).",
    "20260318193312": "addresses_address_key_unique is present and identical in both captures; the statement is a guarded index swap.",
}
if bill_same:
    H_EXTRA["20260501173826"] = "billing_addresses constraints are identical in both captures (E2A inline-CHECK name match only failed)."
STORAGE_W = {  # storage.objects policies absent in Development (containment); superseded by the October storage migrations that drop ALL storage.objects policies and recreate a fixed set
    "20251008190000", "20251129190013", "20251129190039", "20251202171808", "20251230184228", "20251231161729", "20260324012349", "20260324180043",
}
OTHER_W = {
    "20251229223230": ("signup trigger absent in Development (containment); recreated by 20261016120000; also a customer_profiles name backfill (data)", "Q25,Q28"),
    "20260323201502": ("pg_net extension absent and the calendar-sync trigger path calls Edge Functions (stubbed in Development)", "Q24,Q23"),
    "20260324142355": ("signatures bucket public in this version; Development private; made private by 20261014120000", "Q20"),
    "20260324150838": ("order-pictures bucket public in this version; made private by 20261015120000", "Q20"),
    "20260324051459": ("Realtime publication membership: Development publishes fewer tables (documented containment)", "Q21"),
    "20260324154955": ("Realtime publication membership: order_pictures absent from the Development publication (documented containment)", "Q21"),
}
X_SET = {
    "20260325231044": ("carousel-media file_size_limit is NULL in Development, 524288000 in Production; bucket-settings UPDATE by name, idempotent", "Q20"),
    "20260517221038": ("public-assets file_size_limit and allowed_mime_types are NULL in Development, set in Production; bucket-settings UPDATE by name, idempotent", "Q20"),
}
UNRES = {  # financial / identity / security data transformations, or definition differences that cannot be settled from a schema capture
    "20251003170350": ("creates a demo admin user in auth.users (DO block); executing it in any environment would create a privileged login", "Q26"),
    "20251008153245": ("recomputes contacts.total_bookings from orders (business counters)", "Q15"),
    "20251207163822": ("role hierarchy: constraint, policies and an admin-role assignment DO block; user_roles_role_check differs in Development", "Q22,Q19"),
    "20251207184549": ("user_roles policy chain; Development still holds the policy 'Users can read own role' and a public ALL service-role policy that Production lacks", "Q22"),
    "20251207185927": ("drops the circular user_roles policy; Development retains 'Users can read own role'", "Q22"),
    "20251209133113": ("backfills payments.paid_at/failed_at from created_at (payment timestamps)", "Q12"),
    "20260120203953": ("backfills orders.tax_waived (financial)", "Q11"),
    "20260125170305": ("reverses part of the tax_waived backfill (financial)", "Q11"),
    "20260125173238": ("recomputes orders.balance_due_cents (financial)", "Q11"),
    "20260302131311": ("links customers.user_id by email to auth.users (identity)", "Q14"),
    "20260305205811": ("backfills orders.customer_selected_payment_* (financial); the column statements are no-op guarded in Development", "Q11"),
    "20260305222010": ("recomputes orders.balance_due_cents excluding tips (financial)", "Q11"),
    "20260311111714": ("receipts/ledger upgrade; one statement unmatched by E2A", "Q12,Q23"),
    "20260311113547": ("rewrites stripe_webhook_events rows to a terminal status and adds dedup constraints (payment-provider event records)", "Q17"),
    "20260311191611": ("sets invoices.status to partial where paid_amount is below total (financial)", "Q16"),
    "20260314213726": ("computes addresses.address_key and merges duplicate addresses (destructive data transformation)", "Q13"),
    "20260314215031": ("recomputes address_key and merges duplicates again, preferring coordinates (destructive data transformation)", "Q13"),
    "20260315173745": ("DO block that backfills customer profile names from auth users (identity)", "Q28"),
    "20260323155222": ("contacts loyalty columns and a recompute DO block (business counters; superseded by 20260323164559's recompute)", "Q15"),
    "20260323163432": ("loyalty recompute DO block (business counters)", "Q15"),
    "20260323164559": ("loyalty recompute including custom fees and discounts (business counters)", "Q15"),
    "20260323175236": ("security redaction of secrets already written to admin_settings_changelog; unredacted values would be a live exposure, so presence must be checked, not assumed", "Q18"),
    "20260326004004": ("backfills orders.payment_method_last_four/brand from payments (financial)", "Q11"),
    "20260611153900": ("adds same_day_weekday_delivery_fee_* columns; columns exist in Development as NOT NULL, Production nullable (Development stricter than Production)", "Q23"),
    "20260611184401": ("creates update_pricing_rules, which exists only in Production and has no caller; 20261007120000 revokes/grants it only if present", "Q23"),
}
DATA_Q = [  # (regex on data statement text, Q ids)
    (r"admin_settings_changelog", "Q18"), (r"\badmin_settings\b", "Q02"), (r"sms_message_templates", "Q03"), (r"email_templates", "Q04"),
    (r"\bunits\b|unit_media", "Q05"), (r"hero_carousel", "Q06"), (r"google_reviews", "Q07"), (r"notification_system_status", "Q08"),
    (r"pricing_rules", "Q09"), (r"\borders\b", "Q10"), (r"\bpayments\b", "Q12"), (r"addresses", "Q13"), (r"customers", "Q14"), (r"contacts", "Q15"),
    (r"invoices", "Q16"), (r"stripe_webhook_events", "Q17"), (r"user_roles", "Q19"), (r"storage\.buckets", "Q20"), (r"invoice_links", "Q27"),
    (r"customer_profiles", "Q28"),
]
GROUP_RISK = {
    "net-zero": "Executing creates custom_email_hook/claim_order_for_approval with auth-admin or authenticated EXECUTE that a later version drops: an obsolete privileged function in the interim. Never execute.",
    "storage": "Executing recreates storage.objects policies (some public-read or anon-write) that the October storage migrations drop; a window of broader storage exposure. Never execute before the October gate.",
    "seed": "Executing re-inserts seed/sample rows, which may duplicate or resurrect rows the business later edited or removed.",
    "backfill": "Executing re-applies a historical UPDATE with its original predicate and may overwrite values edited since.",
    "financial": "Executing re-applies a historical financial/identity transformation against live records; incorrect or repeated application changes balances, tax flags or links. Never mark completed without proof.",
    "containment": "Executing would reintroduce an object removed from Development on purpose (extension, trigger, public bucket, publication table).",
    "none": "No SQL would run (history-only); the risk is a false ledger claim if the supporting evidence is stale.",
    "bucket": "Updates only storage.buckets settings by name; low risk, but it changes limits used by running uploads.",
    "unresolved": "Depends on the unresolved question; do not execute or record until the evidence in the named queries is in hand.",
}


def read_sql(fn):
    return open(os.path.join(MIG, fn), encoding="utf-8", newline="").read().replace("\r\n", "\n")


def data_heads(fn):
    out = []
    for st in SQL.strip_and_split(read_sql(fn)):
        k, _ = SQL.tag(st)
        if k.startswith(("INSERT", "UPDATE", "DELETE", "DO", "SELECT")) or k in ("", "OTHER"):
            out.append(re.sub(r"\s+", " ", st))
    return out


def qids_for(heads):
    ids = []
    for h in heads:
        for rx, q in DATA_Q:
            if re.search(rx, h, re.I) and q not in ids:
                ids.append(q)
    return ids


rows = []
for v in evidence_set:
    e = e2e_by[v]
    p = proof[v]
    fn = e["filename"]
    heads = data_heads(fn)
    dn = int(p["unprovable_data_or_dynamic"] or 0)
    sup = [s for s in (p["superseded_by_versions"] or "").split(",") if s and s != v]
    sup_rec = [f"{s}{'(Dev-recorded)' if s in dev_hist else '(not Dev-recorded)'}" for s in sup]
    effects = f"{p['statements']} statements: {p['present']} present, {p['superseded']} superseded, {p['noop_guarded']} no-op guarded, {p['absent']} absent, {p['unmatched']} unmatched, {dn} data/dynamic"
    if dn and heads:
        effects += "; data: " + " | ".join(h[:70] for h in heads[:2])
    qs = qids_for(heads) if dn else []
    obj = p["absent_or_unmatched_objects"]
    if v in NET_ZERO:
        verdict, grp, ver = "Evidence-backed history-only reconciliation candidate", "net-zero", "yes: object absent in both captures; created then dropped by the chain"
        why = "Net-zero chain: " + (e["note"] or e["evidence"])[:200]
        qs = []
        hist_ok = "yes"
    elif v in H_EXTRA:
        verdict, grp, ver = "Evidence-backed history-only reconciliation candidate", "none", "yes: catalog objects present and identical in both captures"
        why = H_EXTRA[v]
        hist_ok = "yes"
        qs = []
    elif v in STORAGE_W:
        verdict, grp, ver = "Withheld for the October deployment gate", "storage", "partial: non-storage objects verified present; storage.objects policies absent in Development (containment)"
        why = "Storage policies in this version are superseded by 20261014120000, 20261015120000 and 20261015123000 (they drop every storage.objects policy and recreate a fixed set); the rest of the version is present in both captures. History-only recording is justified only after those three have been applied."
        hist_ok = "conditional: after 20261015123000 has been applied"
        qs = ["Q22", "Q20"]
    elif v in OTHER_W:
        verdict, grp = "Withheld for the October deployment gate", "containment"
        ver = "partial: " + OTHER_W[v][0]
        why = OTHER_W[v][0]
        hist_ok = "conditional: owner decision on containment, then evidence"
        qs = OTHER_W[v][1].split(",")
    elif v in X_SET:
        verdict, grp = "Actual SQL execution required", "bucket"
        ver = "yes: bucket settings captured for both environments"
        why = X_SET[v][0] + ". Only candidate for execution among the pre-October versions."
        hist_ok = "no: the effect is absent"
        qs = X_SET[v][1].split(",")
    elif v in UNRES:
        verdict, grp = "Unresolved", ("financial" if any(k in UNRES[v][0] for k in ("financ", "balance", "tax", "payment", "identity", "address", "loyalty", "counters")) else "unresolved")
        ver = "no: data transformation or definition not provable from a schema capture"
        why = UNRES[v][0]
        hist_ok = "no"
        qs = UNRES[v][1].split(",")
    elif dn:
        verdict = "Qualified owner-attestation candidate"
        seedlike = any(h.upper().startswith("INSERT") for h in heads)
        grp = "seed" if seedlike else "backfill"
        ver = "partial: schema effects verified in the captures; the data effect is not provable from a schema capture"
        why = ("seed/configuration rows (presence checkable by key counts, never by values); " if seedlike else "non-financial backfill with a checkable predicate (count of rows still matching must be 0); ") + "an owner attestation is required because a matching state does not prove that this version produced it"
        hist_ok = "conditional: qualified attestation backed by the read-only counts"
    else:
        verdict, grp, ver = "Evidence-backed history-only reconciliation candidate", "none", "yes: all material statements present, superseded or no-op"
        why = "No data or dynamic statement; every statement present, superseded or no-op."
        hist_ok = "yes"
    if "20251001052039" == v:
        grp = "seed"
        why += " Seeds sample rental units; executing would insert sample inventory into a live catalog."
    if "20251001051901" == v:
        why += " wet_or_dry/surface NOT NULL differences from Production are closed by the October chain (re-diff in e2i-production-compatibility.md)."
    rows.append({
        "version": v, "filename": fn, "e2e_category": e["proposed_category"], "e2i_verdict": verdict,
        "sql_effects": effects, "verifiable_from_captures": ver, "objects_not_matched": obj,
        "superseded_by": ";".join(sup_rec), "history_only_justified": hist_ok, "justification": why,
        "obsolete_object_or_permission_risk_if_executed": GROUP_RISK[grp] + (" " + OTHER_W[v][0] if v in OTHER_W and False else ""),
        "read_only_queries": ";".join(sorted(set(qs), key=lambda x: int(x[1:]))), "e2a_class": p["e2a_class"], "risk_group": grp,
    })

fields = ["version", "filename", "e2e_category", "e2i_verdict", "sql_effects", "verifiable_from_captures", "objects_not_matched", "superseded_by", "history_only_justified", "justification", "obsolete_object_or_permission_risk_if_executed", "read_only_queries", "e2a_class"]
with open(os.path.join(EV, "e2i-development-version-verdicts.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
byv = {r["version"]: r for r in rows}
print("94-version verdicts:", dict(Counter(r["e2i_verdict"] for r in rows)))

# ---------------- manifest (all 388 rows) ----------------
CAT_ALREADY, CAT_H, CAT_Q, CAT_X, CAT_W, CAT_WD, CAT_U = ("Already recorded", "Evidence-backed history-only reconciliation candidate", "Qualified owner-attestation candidate",
                                                         "Actual SQL execution required", "Withheld for the October deployment gate", "Withdrawn", "Unresolved")
man = []
for e in e2e:
    v = e["version"]
    ec = e["proposed_category"]
    if v in byv:
        r = byv[v]
        cat_ = r["e2i_verdict"]
        basis = r["justification"]
        deps = r["superseded_by"]
        proof_ref = "e2i-development-version-verdicts.csv; e2a-dev-proof.csv; " + ("e2i-development-readonly-evidence-plan.sql " + r["read_only_queries"] if r["read_only_queries"] else "stage-b catalog captures")
        risk = r["obsolete_object_or_permission_risk_if_executed"]
        if cat_ == CAT_W:
            timing = "after the October storage/containment prerequisites named in the basis have been applied and re-verified" if r["risk_group"] == "storage" else "only after the owner decision on containment and re-verification"
        elif cat_ == CAT_H:
            timing = "after fresh read-only re-verification, before the October block" if r["risk_group"] != "net-zero" else "after the dropping versions are recorded; before the October block; never executed"
        elif cat_ == CAT_Q:
            timing = "only after the read-only counts are in hand and the owner has signed a qualified attestation; before the October block"
        elif cat_ == CAT_X:
            timing = "execute before the October block, after owner approval; record by the executor (executed kind)"
        else:
            timing = "not scheduled: unresolved"
    elif v >= OCT_FROM:
        cat_ = CAT_W
        basis = "October block (23 migrations): behind the deployment gate; applied as real SQL only after the pre-October reconciliation, containment decisions and the security checks of e2h-security-recovery-plan.md"
        deps = e["gate_or_prerequisite"]
        proof_ref = "e2d/e2h evidence; Development restore applies all 23 (e2i-report.md)"
        risk = "Security hardening and role repair: a failure part-way leaves the intermediate exposures documented in e2h-security-recovery-plan.md; run only in a rehearsed order."
        timing = "executed in file order with the October gate; recorded as executed rows"
    elif ec.startswith("Already recorded"):
        cat_, basis, deps, proof_ref, risk, timing = CAT_ALREADY, e["evidence"], "", "stage-b dev_catalog_history.json", "None: recorded; do not alter", "no action"
    elif ec.startswith("Explicitly withdrawn"):
        cat_, basis, deps, proof_ref, risk, timing = CAT_WD, e["evidence"], "", "e2f-report.md; withdrawn-migrations/", "None: not in the active directory (Case 43 never applied)", "never recorded or executed"
    elif ec.startswith("History-only"):
        cat_, basis, deps = CAT_H, e["evidence"], e["gate_or_prerequisite"]
        proof_ref = "e2a-dev-proof.csv; e2e-development-manifest.csv"
        risk = GROUP_RISK["none"]
        timing = "after fresh read-only re-verification, before the October block"
    else:
        raise SystemExit(f"unclassified {v} {ec}")
    man.append({"version": v, "filename": e["filename"], "e2i_category": cat_, "development_state_now": e["development_state_now"], "basis_or_reason": basis,
                "dependencies_or_superseders": deps, "proof_references": proof_ref, "intended_recording_timing": timing, "security_risks": risk,
                "approved": "no (proposal only)", "e2e_category": ec})
with open(os.path.join(EV, "e2i-development-manifest.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(man[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(man)
print("manifest rows", len(man), dict(Counter(r["e2i_category"] for r in man)))
print("prior (E2E):", dict(Counter(r["proposed_category"] for r in e2e)))
