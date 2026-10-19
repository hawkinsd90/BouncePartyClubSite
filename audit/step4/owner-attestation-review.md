# Owner attestation review: the 13 historical migrations (Step 4A.8)

**Status: PRESENTED FOR INDIVIDUAL OWNER REVIEW. NOTHING IS APPROVED, SIGNED OR RECORDED.** Strategy A (markers with individual attestations) is approved in principle only. No ledger row exists for any of these 13 versions, and no marker has been, or may yet be, inserted. This document fills in no signature, date, authorization id or deny-list exception id; every such field is an unfilled placeholder.

**Read this first.**
- Approving a marker is a decision to **bypass** a file in the migration ledger. It does **not** certify that the original SQL ever executed, and the marker text says so. No marker contains the word "executed" without "NOT".
- The Supabase tooling treats any row with a version as "applied" whatever its text says; a database built from the files (no ledger) still executes all 13 files (Step 4A.6, `fresh-database-oracle-results.json`).
- Each version is separately approvable. Approving one implies nothing about another. The four Step 2 deny-list versions can be recorded **only** with an additional, separate exception approval identifier; without it the marker SQL refuses to run.
- The marker wording below is copied from `audit/step4/strategy-a-marker-proposal.sql`, the source of truth, not retyped; a test checks that every marker here equals the one in the SQL and in `strategy-a-attestation-package.md`.
- Execution of the marker SQL is **not authorized**. The intended future invocation, after you have approved and the placeholders have been filled by the authorized hosted procedure, is: `psql -X -v ON_ERROR_STOP=1 -1 -f <approved-filled-file>`. No filled file has been generated.

## Summary table

| # | Version | Original filename | Proposed class | Equivalent effects now? | Historical execution proven? | Running it now would be | Deny-list exception id also required? |
|---|---|---|---|---|---|---|---|
| 1 | `20251001051901` | `20251001051901_001_create_core_schema.sql` | `effects-present-execution-unproven` | Yes | **No** (never demonstrated) | HARMFUL | No |
| 2 | `20251001052039` | `20251001052039_002_seed_sample_units.sql` | `deliberately-not-executed` | No | **No** (never demonstrated) | HARMFUL | **Yes** (blocked_no_safe_rule) |
| 3 | `20251001192425` | `20251001192425_004_add_new_order_fields.sql` | `deliberately-not-executed` | Partly | **No** (never demonstrated) | HARMFUL | No |
| 4 | `20260125173238` | `20260125173238_fix_incorrect_balance_due_calculations.sql` | `deliberately-not-executed` | No | **No** (never demonstrated) | HARMFUL | **Yes** (blocked_no_safe_rule) |
| 5 | `20260126193205` | `20260126193205_fix_home_address_default_to_woodward_st.sql` | `effects-present-execution-unproven` | Yes | **No** (never demonstrated) | REDUNDANT | No |
| 6 | `20260224133344` | `20260224133344_create_google_reviews_system.sql` | `effects-present-execution-unproven` | Yes | **No** (never demonstrated) | HARMFUL (minor) | No |
| 7 | `20260224161311` | `20260224161311_add_featured_image_to_unit_media.sql` | `effects-present-execution-unproven` | Yes | **No** (never demonstrated) | HARMFUL (minor) | No |
| 8 | `20260224183629` | `20260224183629_add_google_review_to_pickup_messages.sql` | `effects-present-execution-unproven` | Yes | **No** (never demonstrated) | REDUNDANT | No |
| 9 | `20260224184535` | `20260224184535_update_google_review_url.sql` | `effects-present-execution-unproven` | Yes | **No** (never demonstrated) | REDUNDANT | No |
| 10 | `20260305222010` | `20260305222010_fix_balance_exclude_tip.sql` | `deliberately-not-executed` | No | **No** (never demonstrated) | HARMFUL | **Yes** (blocked_no_safe_rule) |
| 11 | `20260311113547` | `20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql` | `effects-present-execution-unproven` | Yes | **No** (never demonstrated) | REDUNDANT | No |
| 12 | `20260315173745` | `20260315173745_fix_trigger_customer_profile_columns.sql` | `deliberately-not-executed` | Partly | **No** (never demonstrated) | HARMFUL | No |
| 13 | `20260611184401` | `20260611184401_create_update_pricing_rules_rpc.sql` | `deliberately-not-executed` | No | **No** (never demonstrated) | HARMFUL | **Yes** (excluded_pending_owner) |

Totals: 7 `effects-present-execution-unproven`, 6 `deliberately-not-executed`; 9 harmful and 4 redundant to run now; 4 need a deny-list exception id.

## The 13 attestation blocks

### 1 of 13: `20251001051901`

1. **Exact migration version:** `20251001051901`
2. **Original filename:** `20251001051901_001_create_core_schema.sql` / `20251001051901` (ledger name would be `001_create_core_schema`)
3. **Original SQL purpose:** Creates the core schema (tables, indexes, RLS) and inserts the single default pricing_rules row.
4. **Current Development evidence (read-only, Step 4A.5):** pricing_rules has 1 row, no NULL core fields, primary key only, updated 2025-10-16; core tables exist (Step 2 schema captures: 179 object matches of 45 statements, 4 superseded, 1 unmatched). Ledger has the earlier baseline row 20251001051900 but none for this version.
5. **Equivalent effects exist now?** Yes (schema); the pricing row exists but could come from this INSERT or a later seed.
6. **Is historical execution proven?** **No.** LOW-MEDIUM: effects match, no ledger row, no alias, Development data is a Production copy. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL**: an unguarded INSERT into pricing_rules (primary key only) would add a second pricing row.
8. **Exact proposed marker classification:** `effects-present-execution-unproven`
9. **Exact proposed marker text** (ledger `name` = `001_create_core_schema`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20251001051901 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001051901_001_create_core_schema.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** The core schema and the single pricing row exist, but nothing shows this file ran on Development, and it must not run (it would add a second pricing row). A marker that says "effects present, execution unproven" is the accurate record: it neither claims execution nor denies the effects.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. NOT recorded on Production (baseline file). Production needs its own decision when its integration is reconciled. Production recorded this version: no. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 2 of 13: `20251001052039`

1. **Exact migration version:** `20251001052039`
2. **Original filename:** `20251001052039_002_seed_sample_units.sql` / `20251001052039` (ledger name would be `002_seed_sample_units`)
3. **Original SQL purpose:** Inserts 8 sample inflatable units and their sample media.
4. **Current Development evidence (read-only, Step 4A.5):** None of the seed slugs checked exist (Step 2 Q05: 3 slugs; Step 4A.5 Q13: 2 slugs); 16 other units exist.
5. **Equivalent effects exist now?** No (the seed rows are absent).
6. **Is historical execution proven?** **No.** NONE: no evidence it ever ran. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL**: it would insert 8 sample inflatable units and stock-photo media into the live catalogue.
8. **Exact proposed marker classification:** `deliberately-not-executed`
9. **Exact proposed marker text** (ledger `name` = `002_seed_sample_units`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20251001052039 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001052039_002_seed_sample_units.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist
```
10. **Step 2 deny-list exception required?** **YES** (`blocked_no_safe_rule`). Recording this marker needs a separate exception approval identifier in `{{DENYLIST_EXCEPTION_APPROVAL_ID}}`, supplied in addition to approving the marker. The deny list itself is not changed.
11. **Reason for the recommendation:** The seed units are absent, so either the catalogue was replaced or the seed never ran. Running it would put sample units into the live catalogue. The accurate record is that the file is deliberately bypassed; this is a Step 2 deny-list version, so it also needs its own exception approval.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. NOT recorded on Production (baseline file). On the deny list (blocked_no_safe_rule): recording needs a new Step 2 decision. Production recorded this version: no. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled) ; deny-list exception id: `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` (unfilled)

### 3 of 13: `20251001192425`

1. **Exact migration version:** `20251001192425`
2. **Original filename:** `20251001192425_004_add_new_order_fields.sql` / `20251001192425` (ledger name would be `004_add_new_order_fields`)
3. **Original SQL purpose:** Adds orders.start_date/end_date, backfills them, sets NOT NULL, adds an index, and sets the sandbag fee to 3000.
4. **Current Development evidence (read-only, Step 4A.5):** orders has no start_date/end_date (dropped by repository file 20251216210332, which has no Development ledger row); sandbag fee is 3500, not 3000.
5. **Equivalent effects exist now?** Partly (other statements present, 5 superseded); the column and fee effects are gone or changed.
6. **Is historical execution proven?** **No.** NONE for this file's own effects. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL**: it would re-add the dropped orders.start_date/end_date columns and reset the sandbag fee from 3500 to 3000.
8. **Exact proposed marker classification:** `deliberately-not-executed`
9. **Exact proposed marker text** (ledger `name` = `004_add_new_order_fields`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20251001192425 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001192425_004_add_new_order_fields.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** Its column and fee effects have been superseded: orders.start_date was dropped by a later file that has no Development ledger row, and the fee is now 3500. Running it would undo that. Deliberately bypassed is the only accurate record.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. NOT recorded on Production (baseline file). Production needs its own decision. Production recorded this version: no. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 4 of 13: `20260125173238`

1. **Exact migration version:** `20260125173238`
2. **Original filename:** `20260125173238_fix_incorrect_balance_due_calculations.sql` / `20260125173238` (ledger name would be `fix_incorrect_balance_due_calculations`)
3. **Original SQL purpose:** Recomputes balance_due_cents on every order (formula includes the tip).
4. **Current Development evidence (read-only, Step 4A.5):** 55 of 171 orders match this formula; 57 match the 20260305222010 formula; 21 orders carry a tip; no NULL balances.
5. **Equivalent effects exist now?** Not provable (a data recomputation cannot be re-proved on orders edited since).
6. **Is historical execution proven?** **No.** NONE. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL**: it would rewrite balance_due_cents on most of the 171 orders (only 55 currently match its formula).
8. **Exact proposed marker classification:** `deliberately-not-executed`
9. **Exact proposed marker text** (ledger `name` = `fix_incorrect_balance_due_calculations`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260125173238 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260125173238_fix_incorrect_balance_due_calculations.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist
```
10. **Step 2 deny-list exception required?** **YES** (`blocked_no_safe_rule`). Recording this marker needs a separate exception approval identifier in `{{DENYLIST_EXCEPTION_APPROVAL_ID}}`, supplied in addition to approving the marker. The deny list itself is not changed.
11. **Reason for the recommendation:** A data recomputation cannot be proved on orders edited since, and a run would rewrite most balances; the later file 20260305222010 recomputes them differently. Deliberately bypassed; Step 2 deny-list version.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production (history). Development's marker does not change Production. On the deny list (blocked_no_safe_rule): recording needs a new Step 2 decision. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled) ; deny-list exception id: `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` (unfilled)

### 5 of 13: `20260126193205`

1. **Exact migration version:** `20260126193205`
2. **Original filename:** `20260126193205_fix_home_address_default_to_woodward_st.sql` / `20260126193205` (ledger name would be `fix_home_address_default_to_woodward_st`)
3. **Original SQL purpose:** Updates the default home address and coordinates in admin_settings, only where the old default is still set.
4. **Current Development evidence (read-only, Step 4A.5):** All three keys already equal the migration's values; updated_at 2026-01-26 19:32:06 (one second after the version time). The three UPDATEs are guarded by the old default value.
5. **Equivalent effects exist now?** Yes.
6. **Is historical execution proven?** **No.** MEDIUM: timestamp coincidence, but Development data is a Production copy. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **REDUNDANT**: its three UPDATEs are guarded by the old default values; all three keys already equal the migration's values, so a run changes nothing.
8. **Exact proposed marker classification:** `effects-present-execution-unproven`
9. **Exact proposed marker text** (ledger `name` = `fix_home_address_default_to_woodward_st`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260126193205 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260126193205_fix_home_address_default_to_woodward_st.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** All three address values already equal the migration's, and the file is guarded, so it is harmless to run. But the ledger cannot show that it ran (Development data is a Production copy), so the accurate record is "effects present, execution unproven".
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 6 of 13: `20260224133344`

1. **Exact migration version:** `20260224133344`
2. **Original filename:** `20260224133344_create_google_reviews_system.sql` / `20260224133344` (ledger name would be `create_google_reviews_system`)
3. **Original SQL purpose:** Creates google_reviews (RLS, index) and inserts one sample review with ON CONFLICT DO NOTHING.
4. **Current Development evidence (read-only, Step 4A.5):** Table exists with a primary key and rating check only; its single row equals the migration's sample review (text and name) and was created 2026-04-08.
5. **Equivalent effects exist now?** Yes.
6. **Is historical execution proven?** **No.** LOW-MEDIUM: the row's creation time is later than the migration, consistent with a data refresh. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL (minor)**: it would insert a duplicate of the sample review (no unique key exists for ON CONFLICT to use).
8. **Exact proposed marker classification:** `effects-present-execution-unproven`
9. **Exact proposed marker text** (ledger `name` = `create_google_reviews_system`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224133344 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224133344_create_google_reviews_system.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** The table and the sample review exist; the review's creation time is later than the migration, consistent with a data refresh. Running it would duplicate the review. Effects present, execution unproven.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 7 of 13: `20260224161311`

1. **Exact migration version:** `20260224161311`
2. **Original filename:** `20260224161311_add_featured_image_to_unit_media.sql` / `20260224161311` (ledger name would be `add_featured_image_to_unit_media`)
3. **Original SQL purpose:** Adds unit_media.is_featured and marks the lowest-sort image of every (unit, mode) group as featured.
4. **Current Development evidence (read-only, Step 4A.5):** 35 media rows, 12 featured; 4 groups have none, 1 featured row is not the lowest sort, 7 featured rows were created after the migration.
5. **Equivalent effects exist now?** Yes for the column; the flags are partly changed by later edits.
6. **Is historical execution proven?** **No.** LOW: flags show later edits. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL (minor)**: it would set is_featured on the lowest-sort image of every unit group, changing curated flags (4 groups have none, 1 featured row is not the lowest).
8. **Exact proposed marker classification:** `effects-present-execution-unproven`
9. **Exact proposed marker text** (ledger `name` = `add_featured_image_to_unit_media`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224161311 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224161311_add_featured_image_to_unit_media.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** The column exists and 12 of 35 media rows are featured, with later edits visible. Running it would reset curated flags. Effects present, execution unproven.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 8 of 13: `20260224183629`

1. **Exact migration version:** `20260224183629`
2. **Original filename:** `20260224183629_add_google_review_to_pickup_messages.sql` / `20260224183629` (ledger name would be `add_google_review_to_pickup_messages`)
3. **Original SQL purpose:** Upserts the google_review_url setting, updates the pickup SMS template, and upserts the pickup_complete e-mail template.
4. **Current Development evidence (read-only, Step 4A.5):** SMS template text is byte-identical to the migration (md5 equal); e-mail template differs by 2 whitespace characters; the setting row and both templates carry one identical timestamp (2026-02-24 18:36:30.522332).
5. **Equivalent effects exist now?** Yes.
6. **Is historical execution proven?** **No.** MEDIUM-HIGH: one-transaction timestamp across three rows, but Development data is a Production copy. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **REDUNDANT**: the SMS template text is byte-identical and the e-mail template differs by 2 whitespace characters, so a run rewrites near-identical text and resets updated_at.
8. **Exact proposed marker classification:** `effects-present-execution-unproven`
9. **Exact proposed marker text** (ledger `name` = `add_google_review_to_pickup_messages`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224183629 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224183629_add_google_review_to_pickup_messages.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** The SMS template is identical to the migration's text and the e-mail differs only by 2 whitespace characters; three rows share one timestamp. Strong circumstantial evidence, but Development data is a Production copy, so execution here is unproven.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 9 of 13: `20260224184535`

1. **Exact migration version:** `20260224184535`
2. **Original filename:** `20260224184535_update_google_review_url.sql` / `20260224184535` (ledger name would be `update_google_review_url`)
3. **Original SQL purpose:** Sets the google_review_url setting to the business's review link.
4. **Current Development evidence (read-only, Step 4A.5):** The setting already equals the migration's value; the row's updated_at equals its created_at because this UPDATE does not set it.
5. **Equivalent effects exist now?** Yes.
6. **Is historical execution proven?** **No.** LOW-MEDIUM: value match only. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **REDUNDANT**: the setting already equals the migration's value, so a run sets the same value.
8. **Exact proposed marker classification:** `effects-present-execution-unproven`
9. **Exact proposed marker text** (ledger `name` = `update_google_review_url`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224184535 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224184535_update_google_review_url.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** The setting already holds the migration's value. A run would change nothing, but a record of execution would be unproven. Effects present, execution unproven.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 10 of 13: `20260305222010`

1. **Exact migration version:** `20260305222010`
2. **Original filename:** `20260305222010_fix_balance_exclude_tip.sql` / `20260305222010` (ledger name would be `fix_balance_exclude_tip`)
3. **Original SQL purpose:** Recomputes balance_due_cents on every order, excluding the tip.
4. **Current Development evidence (read-only, Step 4A.5):** 57 of 171 orders match this formula; 55 match the 20260125173238 formula; 21 orders carry a tip.
5. **Equivalent effects exist now?** Not provable.
6. **Is historical execution proven?** **No.** NONE. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL**: it would rewrite balance_due_cents on most of the 171 orders (only 57 currently match its formula).
8. **Exact proposed marker classification:** `deliberately-not-executed`
9. **Exact proposed marker text** (ledger `name` = `fix_balance_exclude_tip`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260305222010 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260305222010_fix_balance_exclude_tip.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist
```
10. **Step 2 deny-list exception required?** **YES** (`blocked_no_safe_rule`). Recording this marker needs a separate exception approval identifier in `{{DENYLIST_EXCEPTION_APPROVAL_ID}}`, supplied in addition to approving the marker. The deny list itself is not changed.
11. **Reason for the recommendation:** Same hazard as 20260125173238 with the opposite tip rule: a run would rewrite most balances. Deliberately bypassed; Step 2 deny-list version.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. On the deny list (blocked_no_safe_rule): recording needs a new Step 2 decision. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled) ; deny-list exception id: `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` (unfilled)

### 11 of 13: `20260311113547`

1. **Exact migration version:** `20260311113547`
2. **Original filename:** `20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql` / `20260311113547` (ledger name would be `fix_webhook_idempotency_and_receipt_deduplication`)
3. **Original SQL purpose:** Adds webhook status tracking (guarded column, constraint, trigger) and an UPDATE of stripe_webhook_events rows.
4. **Current Development evidence (read-only, Step 4A.5):** webhook_events_status_check and update_webhook_events_updated_at exist; stripe_webhook_events is empty so the UPDATE touches no rows.
5. **Equivalent effects exist now?** Yes.
6. **Is historical execution proven?** **No.** MEDIUM: schema effects identical in both captures; the data effect is vacuous. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **REDUNDANT**: its objects exist and are guarded, and its UPDATE touches no rows because stripe_webhook_events is empty.
8. **Exact proposed marker classification:** `effects-present-execution-unproven`
9. **Exact proposed marker text** (ledger `name` = `fix_webhook_idempotency_and_receipt_deduplication`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260311113547 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** The status constraint and trigger exist and the data statement is vacuous (empty table). Low risk, but execution here is unproven. Effects present, execution unproven.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 12 of 13: `20260315173745`

1. **Exact migration version:** `20260315173745`
2. **Original filename:** `20260315173745_fix_trigger_customer_profile_columns.sql` / `20260315173745` (ledger name would be `fix_trigger_customer_profile_columns`)
3. **Original SQL purpose:** Replaces the sign-up trigger function auto_assign_customer_role() and backfills customers for orphaned auth users.
4. **Current Development evidence (read-only, Step 4A.5):** The live function is a different, later definition (search_path=public, not the file's public, auth); no trigger is attached on any auth table; 0 users lack a customer.
5. **Equivalent effects exist now?** Partly (the later function exists; the trigger is absent).
6. **Is historical execution proven?** **No.** NONE for the file as written. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL**: it would replace the live sign-up function with an older body and run a backfill, and after the October files it would overwrite their hardened result.
8. **Exact proposed marker classification:** `deliberately-not-executed`
9. **Exact proposed marker text** (ledger `name` = `fix_trigger_customer_profile_columns`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260315173745 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260315173745_fix_trigger_customer_profile_columns.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist
```
10. **Step 2 deny-list exception required?** **No.** This version is not on the deny list, and its marker must NOT carry a deny-list exception id.
11. **Reason for the recommendation:** The live sign-up function is a different, later definition and the trigger is absent; the October file 20261016120000 (sealed package) supplies the trigger and provisioning. Running this older file would overwrite the later work. Deliberately bypassed.
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled)

### 13 of 13: `20260611184401`

1. **Exact migration version:** `20260611184401`
2. **Original filename:** `20260611184401_create_update_pricing_rules_rpc.sql` / `20260611184401` (ledger name would be `create_update_pricing_rules_rpc`)
3. **Original SQL purpose:** Creates the SECURITY DEFINER function update_pricing_rules(...), which writes pricing_rules.
4. **Current Development evidence (read-only, Step 4A.5):** The function does not exist on Development; 0 functions, views, rules or policies mention it; no application or Edge Function code calls it.
5. **Equivalent effects exist now?** No (absent).
6. **Is historical execution proven?** **No.** NONE. Nothing shows that this file ran on Development (Development has no ledger row for it, and its data is a copy of Production data); this record does not claim it did.
7. **Would running it now be harmful or redundant?** **HARMFUL**: it would add a privileged SECURITY DEFINER pricing-write function that nothing calls.
8. **Exact proposed marker classification:** `deliberately-not-executed`
9. **Exact proposed marker text** (ledger `name` = `create_update_pricing_rules_rpc`; `statements` = a single element, no SQL; copied verbatim, placeholders left unfilled):

```
-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260611184401 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260611184401_create_update_pricing_rules_rpc.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist
```
10. **Step 2 deny-list exception required?** **YES** (`excluded_pending_owner`). Recording this marker needs a separate exception approval identifier in `{{DENYLIST_EXCEPTION_APPROVAL_ID}}`, supplied in addition to approving the marker. The deny list itself is not changed.
11. **Reason for the recommendation:** The function does not exist on Development and nothing references it; it was a Production-only function with no caller (owner decision U-E2I-4). Deliberately bypassed; Step 2 deny-list version (excluded_pending_owner).
12. **Development and Production implications:** On Development, the marker would be a ledger row only; no SQL runs, and the version stops being pending for the standard tooling. Recorded as executed on Production. Excluded on the deny list (excluded_pending_owner): recording needs a new Step 2 decision. Production recorded this version: yes. Nothing is changed on either database by this document.
13. **Owner decision:** Decision options (mark exactly one; nothing is pre-selected):
  - **[ ] APPROVE as proposed** (the class in item 8 and the marker text in item 9, unchanged).
  - **[ ] APPROVE WITH A DIFFERENT CLASS** (state which and why; the marker is regenerated and re-reviewed before anything is recorded).
  - **[ ] DEFER**: more evidence needed (name it). The version stays unrecorded and pending; Deploy to production must stay OFF for Development.
  - **[ ] REJECT the bypass**: the file stays pending and ordinary automatic deployment cannot resume until another representation is chosen.
    Owner identifier / date / authorization id: `{{ATTESTED_BY}}` / `{{ATTESTED_AT}}` / `{{AUTHORIZATION_ID}}` (unfilled) ; deny-list exception id: `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` (unfilled)

## After you decide
Return one decision per version. Only versions you approve are included in a filled marker file; a smaller approved set means a regenerated, re-reviewed, re-tested SQL file (the allowlist is exactly the set you approved). Nothing is recorded until a separate hosted authorization.
**Related and also unauthorized:** recording the two compatibility versions `20260324175545` and `20260615175815` without executing (`strategy-a-attestation-package.md` section 4.5).
