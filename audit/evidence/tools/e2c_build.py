"""Stage E2C: builds e2c-67-vs-58-crosswalk.csv and e2c-proposed-execution-manifest.csv from the E2B-1 crosswalk and the E2C local test results.
Offline: reads repository evidence files and the protected scratch results (C:\\Users\\vikki\\migration-evidence\\e2c-scratch). No database, no hosted system.
The manifest is a PROPOSAL for review; it contains no SQL to run and approves nothing. Usage: python -I e2c_build.py"""
import csv
import json
import os

EV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SCR = r"C:\Users\vikki\migration-evidence\e2c-scratch"
LATEST = "20260928172217"


def rd(name):
    with open(os.path.join(EV, name), encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def js(name):
    return json.load(open(os.path.join(SCR, name), encoding="utf-8"))


cw = rd("e2b1-production-execution-crosswalk.csv")
late = js("e2c-late.json")
expo = js("e2c-exposure.json")
steps = js("e2c-steps.json")
assert len(cw) == 67
OMIT = {
    "20260715221828": dict(group="no-effect pair (create)", effects="CREATE POLICY \"Anon can insert portal shortlinks\" ON public.invoice_links FOR INSERT TO anon, authenticated WITH CHECK (link_type = 'portal_shortlink' AND deposit_cents = 0)",
        prod="Production has no such policy (catalog)", sup="dropped by 20260716104333 (the next omitted version)", data="none",
        inter="Between this version and 20260716104333 an anonymous client can insert portal_shortlink rows for any order: local test ACCEPTED between the pair, REJECTED before and after (e2c-exposure.json)",
        partial="Release stopped between the pair leaves the open policy until resumed", p58="Never exists", late="Applied alone after the 58: creates the policy and leaves it (policies differ); with its partner net-zero",
        book="yes: record before any process can run pending versions", inv="no change if recorded history-only (386 rows with the 40 baseline rows, 384 after D-3/D-4); otherwise stays pending"),
    "20260716104333": dict(group="no-effect pair (drop)", effects="DROP POLICY IF EXISTS \"Anon can insert portal shortlinks\" ON public.invoice_links", prod="Policy absent in Production, so the statement is a no-op there", sup="n/a (it is the superseder of 20260715221828)", data="none",
        inter="None by itself", partial="None by itself", p58="n/a", late="Applied alone after the 58: no change", book="yes (paired with 20260715221828; record the pair together)", inv="as above"),
    "20261010110000": dict(group="no-op October", effects="ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_approved_at timestamptz", prod="Column already exists (recorded 20251126190624)", sup="n/a", data="none",
        inter="None", partial="None", p58="n/a", late="Applied after the 58: no change", book="yes", inv="October count becomes 22 executed + 1 history-only"),
    "20260716151530": dict(group="fully replaced", effects="CREATE OR REPLACE FUNCTION check_product_availability(jsonb,date,date,uuid) (earlier variant) + REVOKE FROM PUBLIC + GRANT EXECUTE to anon, authenticated, service_role", prod="Function absent in Production", sup="20260716152447 (same signature, same grants, renamed variables)", data="none",
        inter="Function exists in the earlier variant between 20260716151549 and 20260716152447; in the 58 path it does not exist until 20260716152447 (probe: functions differ after 20260716151549 only)",
        partial="Release stopped after this point has an earlier function variant callable by anon", p58="Function absent until its replacement", late="Applied after the 58: regresses check_product_availability to the earlier variant (functions differ)",
        book="yes and it must never be run late", inv="as above"),
    "20260716152823": dict(group="fully replaced", effects="8 GRANTs: SELECT on inventory_products, product_bundles, product_bundle_components, product_pricing to anon, authenticated; INSERT, UPDATE, DELETE on the same four to authenticated", prod="Tables absent in Production (created by 20260716151458)", sup="20260717012112 (SELECT) and 20260717110808 (write grants, five tables)", data="none",
        inter="No catalog change at this step in the rehearsal because the platform default ACLs already grant these privileges to new tables; the omission relies on those default ACLs being present when 20260716151458 creates the tables",
        partial="No difference found", p58="No difference found", late="No change", book="yes", inv="as above"),
    "20260716173644": dict(group="fully replaced", effects="DROP/CREATE public.get_public_business_settings() adding two whitelisted keys (event_essentials_page_enabled, min_event_essentials_order_cents) + REVOKE FROM PUBLIC + GRANT EXECUTE to anon, authenticated", prod="Production's function lacks both keys", sup="20260820165646 (adds how_did_you_hear_enabled)", data="none",
        inter="From this version to 20260820165646 the 67 path exposes two extra keys; the 58 path keeps Production's current definition. 24 shared stop points differ in this function only",
        partial="A release interrupted anywhere in that window leaves Production's RPC without the two keys (58 path) or with them (67 path)", p58="No new keys until 20260820165646", late="Applied after the 58: regresses the RPC to an older whitelist (drops how_did_you_hear_enabled)", book="yes and it must never be run late", inv="as above"),
    "20260717111737": dict(group="fully replaced", effects="CREATE OR REPLACE FUNCTION public.reorder_product_categories(uuid[]) (partial fix of an ambiguous column) + REVOKE ALL + GRANT EXECUTE to authenticated", prod="Function absent in Production", sup="20260717111803 (completes the fix)", data="none",
        inter="The 67 path has a known partly-defective function version between the two adjacent versions", partial="Release stopped between them leaves a defective function", p58="Never installs the defective version", late="Applied after the 58: regresses reorder_product_categories", book="yes and it must never be run late", inv="as above"),
    "20260717113131": dict(group="fully replaced", effects="CREATE OR REPLACE FUNCTION public.save_product_bundle(...16 args) (quantity and missing-product validation) + REVOKE ALL + GRANT EXECUTE to authenticated", prod="Function absent in Production", sup="20260717115647 (adds the integer-overflow guard)", data="none",
        inter="The 67 path has a version lacking the overflow guard between the pair", partial="Release stopped between them leaves a function that can leak a raw integer-out-of-range error", p58="Never installs it", late="Applied after the 58: regresses save_product_bundle", book="yes and it must never be run late", inv="as above"),
    "20260814114825": dict(group="fully replaced", effects="Guarded DO block: if public.contact_inquiries exists, ADD COLUMN IF NOT EXISTS ten text columns and GRANT INSERT, SELECT, UPDATE to service_role", prod="Table absent in Production at its position (created by 20260814120000)", sup="20260814120100 (same columns and grant after the table exists)", data="none (a DO block with DDL only)",
        inter="No-op at its current position; with 20260814120000 moved before it (D-5) it adds the columns itself and 20260814120100 becomes the no-op (aliasfx test)", partial="No difference found", p58="Same", late="No change", book="yes", inv="as above"),
}
assert set(OMIT) == {"20260715221828", "20260716104333", "20261010110000", "20260716151530", "20260716152823", "20260716173644", "20260717111737", "20260717113131", "20260814114825"}
for v in OMIT:
    assert v in late and v in [r["version"] for r in cw]

H1 = ["version", "filename", "in_67", "in_58", "omission_group", "e2b1_proposed_action", "exact_sql_effects", "effect_exists_in_production", "superseded_by", "data_statements", "intermediate_state_finding",
      "interrupted_release_67_path", "interrupted_release_58_path", "late_application_after_58", "late_application_regresses_final_state", "needs_history_bookkeeping_if_omitted", "effect_on_final_history_inventory", "e2c_assessment"]
rows = []
for r in cw:
    v = r["version"]
    o = OMIT.get(v)
    if o:
        regress = late[v]["regresses_final_state"]
        assess = "omission candidate: final state, data digests and shared-step fingerprints equal except the documented intermediate differences" + ("; MUST be recorded history-only and never run late" if regress else "; harmless if run late, still needs a history record")
        rows.append([v, r["filename"], "yes", "no", o["group"], r["proposed_action"], o["effects"], o["prod"], o["sup"], o["data"], o["inter"], o["partial"], o["p58"], o["late"], "yes" if regress else "no", o["book"], o["inv"], assess])
    else:
        rows.append([v, r["filename"], "yes", "yes", "none", r["proposed_action"], "executed in both sequences", r["effect_absent_from_production"][:120], "", r["data_dependent_or_unprovable"][:120], "", "", "", "", "", "no (recorded by the approved application method as executed)", "executed row", "unchanged between the sequences"])
with open(os.path.join(EV, "e2c-67-vs-58-crosswalk.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(H1)
    w.writerows(rows)

H2 = ["order", "version", "filename", "proposed_action", "status", "reason", "specific_evidence", "history_reconciliation_needed", "history_record_kind_if_needed", "older_than_latest_recorded", "depends_on_selected_versions", "ordering_note", "confidence", "unresolved_preconditions"]
man = []
for i, r in enumerate(cw, 1):
    v = r["version"]
    o = OMIT.get(v)
    older = "yes" if v < LATEST else "no"
    pre = ["application method for the 39 older versions" if older == "yes" else "", "preflight counts reviewed" if r["data_dependent_or_unprovable"] != "none" else "", "fresh read-only capture inside 24 h"]
    ordering = ""
    if v == "20260814120000":
        ordering = "If D-5 is implemented this file takes version 20260814002658 and runs before 20260814113146 (alias_order sequences, e2c-steps.json: identical final state)"
    if v == "20260722172048":
        ordering = "Apply before the booking Edge Function that sends a NULL surface goes live"
    if o:
        late_r = late[v]["regresses_final_state"]
        act, st = "do-not-execute (conditional candidate)", "proposed; depends on D-1 final approval of the 58-version set"
        reason = f"{o['group']}: effects absent from or irrelevant to the final state because {o['sup']}; omission verified catalog- and data-digest-equal"
        ev = "e2c-67-vs-58-crosswalk.csv; e2c-omission-and-resumption-tests.md; e2b1 rehearsals"
        rec = "yes"
        kind = "history-only (D-6): 'not executed; effect " + ("not needed" if v in ("20260715221828", "20260716104333", "20261010110000") else "superseded by " + o["sup"].split(" ")[0]) + "'; basis cited per version"
        conf = "medium-high"
        if late_r:
            pre.append("must never be left pending where a process could run it late")
    else:
        act, st = "execute", ("proposed; D-2 approved the inclusion" if v == "20260722172048" else "proposed (baseline of the 58 candidate); not approved for hosted execution")
        reason = "effect or data statement absent from Production" if r["effect_absent_from_production"].startswith("yes") else "see E2B-1 crosswalk"
        ev = "e2b1-production-execution-crosswalk.csv; D3/D4 rehearsal; " + ("E1 U-5 experiment" if v == "20260722172048" else "e2a-proposed-actions.csv")
        rec = "no separate reconciliation: recorded as executed by the approved application method"
        kind = "executed"
        conf = r["confidence"].split(" ")[0]
    man.append([i, v, r["filename"], act, st, reason, ev, rec if not o else "yes", kind, older, r["depends_on_selected_versions"], ordering, conf, "; ".join(p for p in pre if p)])
with open(os.path.join(EV, "e2c-proposed-execution-manifest.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(H2)
    w.writerows(man)
ex = sum(1 for m in man if m[3] == "execute")
print("execute", ex, "do-not-execute", len(man) - ex, "older", sum(1 for m in man if m[9] == "yes"))
