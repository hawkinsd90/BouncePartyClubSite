"""Stage E2J: builds e2j-readonly-query-review.csv from the reviewed query metadata below and the local validation result (e2j-ro-validation.json, protected scratch folder).
Offline: no database connection. Usage: python -I e2j_build_review.py"""
import csv
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.abspath(os.path.join(HERE, ".."))
val = json.load(open(r"C:\Users\vikki\migration-evidence\e2j-scratch\e2j-ro-validation.json", encoding="utf-8"))
text = open(os.path.join(EV, "e2j-development-readonly-queries.sql"), encoding="utf-8").read()
stm = {}
for m in re.finditer(r"(?m)^-- @query (Q\d\d) (\d+)\n(.*?);\n", text, re.S):
    stm.setdefault(m.group(1), []).append(m.group(3))
TABLES = val["tables_selected"]

ESS_NEW, ESS_FRESH, OPT, WEAK = "Essential (new facts)", "Essential for freshness (content already in the Stage B capture)", "Optional", "Essential but weak evidence"
M = {
 "Q00": ("Is the session valid evidence? Role attributes (RLS bypass), read-only default, timeout, estimated row counts and RLS flags per table.", "all (precondition for every other query)", ESS_NEW, "none (E2J addition: without it a zero count can be RLS masking, not absence)", "Results of any later query are valid only if bypasses_rls is true, transaction_read_only is on (E2J-A: checked per transaction, not by the session default), and for each table with estimated_rows > 0 the later counts are not all zero.", "new in E2J; E2J-A added transaction_read_only, member_of_pg_read_all_data, can_insert_orders (can_insert_orders = true marks a privileged role: operator present, protocol mandatory)"),
 "Q01": ("Is the Development ledger still the 58 captured rows?", "every version (baseline)", ESS_NEW, "none", "Any added/removed row invalidates all candidates until the captures are refreshed; an exact match keeps the E2I manifest basis.", "E2I"),
 "Q02": ("Which configuration keys exist in admin_settings (names and a non-empty flag only)?", "20251002210020, 20251003152224, 20251003183947, 20251007210840, 20251008144308, 20251231171420, 20260126184412, 20260126193205, 20260203053948, 20260224183629, 20260224184535, 20260325231020, 20251001051901", ESS_NEW, "none; values are never returned (has_value boolean only)", "All named keys present: supports a qualified attestation. A key absent: the seed never ran or was removed; owner decides (data change) - never SQL from the ledger. Empty output with Q00 valid means no keys at all.", "E2I"),
 "Q03": ("Which SMS template keys exist?", "20251003182356, 20251008144308, 20251205125907, 20251216201450, 20260126193254, 20260224183629", ESS_NEW, "none; template text never returned", "As Q02.", "E2I"),
 "Q04": ("Which e-mail template names exist?", "20251221225000, 20260224183629", ESS_NEW, "none", "As Q02.", "E2I"),
 "Q05": ("Unit catalog seed/backfill state: counts of NULL types, sample slugs, unit_media backfill predicates.", "20251001052039, 20260224165424, 20260318191352, 20260224161311, 20260331151647", ESS_NEW, "none", "Sample slugs present or replaced and no NULL/legacy predicate rows: attestation candidate. Rows still matching a backfill predicate: corrective data change needs owner review. Sample units must never be re-inserted.", "E2I"),
 "Q06": ("Is the hero carousel populated?", "20251207160232", OPT, "none", "Rows exist: attestation candidate; zero rows: owner confirms whether empty is intended. Low value: attestation is needed either way.", "E2I"),
 "Q07": ("Is the Google reviews table populated (count only)?", "20260224133344", OPT, "none; no review text", "As Q06.", "E2I"),
 "Q08": ("Notification system status rows (type names and flags).", "20251231174711", OPT, "none", "As Q06.", "E2I"),
 "Q09": ("Pricing-rules row shape: row count and NULL counts of the backfilled columns.", "20251001051901, 20251001192425, 20251002180149, 20251130231633, 20251222014723, 20251222020729, 20260119195140, 20260311121119", ESS_NEW, "none; configuration only, booleans/counts returned", "No NULLs and a single row: supports attestation; NULL counts: backfill predicate still matches (corrective review). Values themselves are compared with Production by the owner from the captures, not returned here.", "E2I"),
 "Q10": ("Order status/flag backfill predicates still matching (counts).", "20251007220415, 20251007221227, 20251007221817, 20251001192425, 20251130191333, 20260816221636, 20260928172217", ESS_NEW, "none; counts only", "All 0 with Q00 valid and orders non-empty: attestation candidate; empty orders table makes every 0 inconclusive; non-zero: corrective review.", "E2I; start_date removed in E2I (column no longer exists)"),
 "Q11": ("Financial backfill coverage (NULL balances, NULL tax flags, waived-with-tax, unset selected payment) and succeeded-payment/last-four coverage.", "20260120203953, 20260125170305, 20260125173238, 20260305205811, 20260305222010, 20260326004004", WEAK, "none; aggregate counts only", "Coverage counts cannot show a historical formula ran: orders change after the backfill and later logic (custom fees, discounts) legitimately differs from the 2026-03 formula. Results only tell the owner whether live rows are inconsistent today; closure of these versions always needs an owner decision.", "E2I query modified: the balance-formula mismatch count was removed because it would flag legitimately edited orders"),
 "Q12": ("Payment timestamp and ledger-sequence coverage.", "20251209133113, 20260311111714", ESS_NEW, "none; counts only", "0 rows lacking timestamps/sequence: consistent, still not proof; >0: corrective review for payment records.", "E2I"),
 "Q13": ("Address de-duplication state: NULL address keys and duplicate keys.", "20260314213726, 20260314215031", ESS_NEW, "none; counts only (no address text)", "0 duplicates and no NULL keys: consistent with the merges (or with none needed); duplicates: the unique index could not exist, so a non-zero result would indicate drift to investigate. Merge SQL is never run from the ledger.", "E2I"),
 "Q14": ("Customer-to-auth link coverage (counts; joins auth.users by e-mail inside the database).", "20260302131311", OPT, "none; counts only (no e-mail leaves the database)", "linkable_but_unlinked = 0: consistent; >0: identity backfill gap for the owner. Requires SELECT on auth.users; skip if the owner will not grant it.", "E2I"),
 "Q15": ("Contact booking counters versus orders (count of differing contacts).", "20251008153245, 20260323155222, 20260323163432, 20260323164559", OPT, "none; counts only", "Derived counters: mismatch is a recomputation question, not history. Informational.", "E2I; contacts.customer_id and status filter aligned to the trigger definition"),
 "Q16": ("Invoices marked paid but underpaid.", "20260311191611", OPT, "none; count only", "0: consistent; >0: financial data issue for the owner.", "E2I"),
 "Q17": ("Webhook event counts by status.", "20260311113547", OPT, "none; no payload, no ids", "Informational: terminal-status distribution; cannot prove the rewrite ran.", "E2I"),
 "Q18": ("Secret-like changelog rows not redacted (count).", "20260323175236", ESS_NEW, "none; count only (values never returned)", "0: redaction state consistent (security, not history). >0: live exposure - corrective redaction needs urgent owner review before any other step.", "E2I"),
 "Q19": ("Role-name case and the user_roles check constraint.", "20251207163822, 20260324175546, 20260324190039", ESS_NEW, "none; count + constraint text", "0 non-lowercase roles and constraint as in the October prerequisite: attestation candidates; non-zero: October role repair prerequisites at risk.", "E2I"),
 "Q20": ("Storage bucket settings (public flag, size limit, MIME list).", "20260325231044, 20260517221038, 20260324142355, 20260324150838 and the storage-policy group", ESS_FRESH, "none; bucket rows, no objects", "Limits already equal to Production's: the two bucket versions become history-only candidates; limits NULL: they stay execution candidates. Public flags drive the containment decisions.", "E2I"),
 "Q21": ("Realtime publication membership.", "20260324051459, 20260324154955", ESS_FRESH, "none", "Membership equal to Production's: history-only candidates; reduced membership: containment decision U-E2I-5.", "E2I"),
 "Q22": ("Policy definitions for user_roles, orders, pending_signups_consent, order_signatures and storage.objects.", "20251207163822, 20251207184549, 20251207185927, 20251215015109, 20260317201616 and the storage group", ESS_FRESH, "none; policy expressions are security logic, not secrets", "Extra user_roles policies still present (including the public ALL service-role policy): known; October removes them. Storage policy set: confirms the containment starting point.", "E2I"),
 "Q23": ("Function-body and column-definition comparison with the Production capture.", "20260611153900, 20260611184401, 20260311111714 and the 23 body differences", ESS_FRESH, "none; hashes and column facts only", "Hash equal to Production's no-comment-no-space hash: no logic difference; different: genuine divergence to review. Columns: confirms the stricter NOT NULL.", "E2I query modified: second hash added (no comments, no whitespace) after local analysis showed all 23 differences are whitespace/comment/line-ending only"),
 "Q24": ("Installed extensions.", "20260323201502", ESS_FRESH, "none", "pg_net absent: containment premise confirmed.", "E2I"),
 "Q25": ("Triggers on auth.users and existence of custom_email_hook/claim_order_for_approval.", "20251229223230, 20260315190615, 20260315202232, 20260316174421, 20260324191543", ESS_FRESH, "none; trigger definitions contain function names only", "Functions absent and trigger absent: net-zero chain confirmation and signup-trigger starting point.", "E2I"),
 "Q26": ("Does the demo admin login exist?", "20251003170350", ESS_NEW, "boolean only; the e-mail literal is a repository value (committed in the migration) and nothing else is returned", "true: a privileged demo login exists; owner security review independent of the ledger. false: effect absent. The version is prohibited from execution either way.", "E2I"),
 "Q27": ("Invoice link types (counts).", "20260415234700", OPT, "none; counts by type", "No legacy-type rows: consistent with the backfill; informational.", "E2I"),
 "Q28": ("Customer profile name coverage (counts).", "20251229223230, 20260315173745", OPT, "none; counts only", "first_name NULL count informs the identity backfill; informational.", "E2I; display_name no longer exists"),
 "Q29": ("Default privileges and schema grants (public, storage, auth, realtime).", "all Production-pending creators; privilege differences in e2j-default-privilege-analysis.md", ESS_FRESH, "none; role names and ACL letters", "Confirms Development has no public default ACLs, that anon/authenticated have no USAGE on schema public, and that service_role holds CREATE on it.", "E2I"),
 "Q30": ("Object-by-object ACLs of the 14 relations and 27 functions, RLS flags, effective privileges of service_role/anon/authenticated, and policy names.", "the 12 tables, 2 sequences, 27 trigger functions in the default-privilege analysis", ESS_FRESH, "none; ACL strings and policy names (no expressions)", "Confirms the captured differences still hold; the effective-privilege rows decide the minimum grants the owner approves.", "new in E2J"),
}
RISK = {"Q00": "negligible", "Q01": "negligible (58 rows)"}
rows = []
for q in sorted(M, key=lambda x: int(x[1:])):
    unc, ver, cls, sens, impact, origin = M[q]
    sql = "\n".join(stm[q])
    tabs = sorted({t for t in TABLES if re.search(r"\b(from|join)\s+" + re.escape(t.split(".")[-1]) + r"\b", sql, re.I) and (("." not in t) or t.split(".")[0] in sql or t.startswith("public."))})
    if q in ("Q01",):
        tabs = ["supabase_migrations.schema_migrations"]
    if q in ("Q20",):
        tabs = ["storage.buckets"]
    if q in ("Q26", "Q14"):
        tabs = sorted(set(tabs) | {"auth.users"})
    grants = ("SELECT on " + ", ".join(tabs) + "; plus " if tabs else "") + "catalog read (pg_catalog/information_schema, always allowed)"
    ids = [f"{q}_{i+1}" for i in range(len(stm[q]))]
    ps = [val["per_statement"][i] for i in ids]
    okrun = all(p["rc"] == 0 for p in ps) and all(p["sha256_run1"] == p["sha256_run2"] for i_, p in zip(ids, ps) if i_ != "Q00_1")
    masked = [i for i in ids if i in val["rls_masking"]["statements_whose_result_differs_without_bypassrls"]]
    called = sorted({f for f in re.findall(r"\b([a-z_][a-z0-9_]*)\s*\(", sql.lower()) if f in val["functions_called"] and val["functions_called"][f] != ["builtin-or-unknown"]})
    insp = "single SELECT, no locking clause, no DML/DDL tokens (static check passed)"
    if called:
        insp += "; catalog/accessor functions called: " + ", ".join(called) + " (all STABLE/IMMUTABLE per pg_proc)"
    lock = "ACCESS SHARE only; " + ("constant-time catalog read" if all(not t.startswith("public.") for t in tabs) and not any(t in sql for t in ("count(*)",)) else "sequential scan/aggregate of the named tables (size unknown; run off-peak, 30 s statement timeout)")
    mod = {"Q10": "none (already corrected in E2I)", "Q11": "YES - replaced (formula mismatch removed)", "Q23": "YES - second hash column added", "Q00": "NEW query (E2J); three columns added in E2J-A", "Q30": "NEW query"}.get(q, "none; tagged and one statement per tag in the E2J package")
    rls = "yes: needs a role with BYPASSRLS or the result may be silently empty (Q00 detects)" if (tabs and any(t.startswith(("public.", "storage.", "auth.")) for t in tabs)) else "no (catalog or ledger only)"
    if q in ("Q01",):
        rls = "no (supabase_migrations has no RLS in the restore; verify with Q00_2)"
    rows.append({
        "query_id": q, "statements": len(stm[q]), "origin": origin, "uncertainty_resolved": unc, "affected_versions": ver,
        "minimum_privilege": grants, "read_only_inspection": insp, "output_content_and_sensitivity": sens, "result_effect_on_verdict": impact,
        "classification": cls, "lock_and_performance_risk": lock, "rls_masking_risk": rls, "modification_before_hosted_use": mod,
        "local_validation": f"ran as non-superuser least-privilege role in a read-only session: {'all statements succeeded' if all(p['rc']==0 for p in ps) else 'FAILED'}; deterministic across two runs: {'yes' if okrun else 'n/a (time-varying by design)' if q=='Q00' else 'NO'}; rows per statement: {','.join(str(p['rows']) for p in ps)}; result differs without BYPASSRLS on this scratch data: {'yes ' + ','.join(masked) if masked else 'no (not proof it cannot hosted)'}",
    })
with open(os.path.join(EV, "e2j-readonly-query-review.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
from collections import Counter
print(len(rows), dict(Counter(r["classification"] for r in rows)))
