# Strategy A package: 13 individual attestations, the marker proposal and two compatibility migrations (Step 4A.7, local, unapproved)

**Status.** The owner approved Strategy A **in principle** (markers with individual attestations) and asked for the two fresh-database compatibility migrations to be prepared and tested **locally**. Not approved: the marker contents, any of the 13 attestations, any hosted ledger write, and any hosted execution of the compatibility migrations. No owner signature, date or authorization id exists in this package, and none is pre-filled. Nothing here touches a hosted system, the sealed 28-file package, the executor, the Step 2 manifests or the deny list.

## 0. The limitation that decides what a marker means
> **Supabase's migration tooling treats the presence of a row with a version as "applied", whatever the row's text says.** The CLI (`db push`, `migration list`) and, by inference, the GitHub integration compare **versions only**. After the marker rows exist, all 13 files are "applied" to the tooling even though each row says `NOT EXECUTED`. The wording protects people and audits; it does not protect the database. Observed: before the synthetic fill-in the CLI listed all 13 as pending; after it, none (`marker-proposal-oracle-results.json`, M2). **A database built from the files has no ledger and still executes all 13 files** (Step 4A.6, `fresh-database-oracle-results.json`).
Consequence: a marker must never be read as proof of execution, and removing a marker for a dangerous version re-exposes that file to the next standard push.

## 1. The ledger representation (proposal)
Table `supabase_migrations.schema_migrations(version text primary key, statements text[], name text)`.
| Column | Executed (Step 2 executor, existing) | Marker proposed here |
|---|---|---|
| `version` | the 14-digit version | the 14-digit version of the historical file, exactly |
| `name` | the CLI form: file name without `<version>_` and `.sql` | the same form, so the row traces to the file |
| `statements` | `{marker, exact SQL}` | `{marker}` only: a **single element, no SQL**, so a row can never be mistaken for an executed one |
| marker text | `-- BPC-DEV-RECONCILIATION executed ...` | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run=... state=<class> version=<v> attested_by=... attested_at=... scope=... not_proven=...` |
Two classes only: `effects-present-execution-unproven` and `deliberately-not-executed`. Neither contains the word "executed" without `NOT`. The prefix follows the Step 2 hosted procedure's attestation form; no executor change is needed (the Step 2 attestation item type already carries `attested_by`, `attested_at`, `scope` and `not_proven`).

## 2. The SQL proposal: `audit/step4/strategy-a-marker-proposal.sql` (never run on a hosted system; corrected in the Step 4A.7 review)
Not under `supabase/migrations`, so no tool treats it as a migration.
**Transport (tested).** The file is plain PostgreSQL and exactly **one statement**, a `DO` block, which is atomic by itself and takes its own advisory lock (`PERFORM pg_advisory_xact_lock`). It contains **no psql meta-command** (a client-side command beginning with a backslash, such as `\set`, which other channels reject), **no `BEGIN`/`COMMIT`** and no client variable, so it runs unaltered through `psql -f file`, `psql -f -` on stdin (how the Step 4 executor feeds its scripts) or an SQL API call that sends the text as one query. The owner's placeholder values are inserted **before** sending; the filled text is what the authorization hashes. Required invocation: `psql -X -v ON_ERROR_STOP=1 -1 -f <filled file>`. `-v ON_ERROR_STOP=1` and `-1` are client options, not file content: they make the exit status non-zero on failure and wrap the statement in a transaction. Safety does not depend on them: without any flag psql exits 0 after an error, but the failed block has written nothing (all four invocations tested). Any exception aborts the whole block.
1. **Fails closed on placeholders:** `{{RUN_ID}}`, `{{ATTESTED_BY}}`, `{{ATTESTED_AT}}`, `{{AUTHORIZATION_ID}}`, `{{DENYLIST_EXCEPTION_APPROVAL_ID}}`, `{{EXPECTED_BASE_COUNT}}` and `{{BASE_LEDGER_SHA256}}` are unfilled; as committed it raises `PROPOSAL ONLY` and writes nothing.
2. **Target identity, verifiable and not by database name alone.** A Supabase database cannot tell SQL which project it belongs to: a read-only query of the Development project found **no setting that exposes the project reference**. The project is therefore bound **outside** the SQL, by the hosted authorization document that names project `srxunxiytojjsuhcmzjg` and the connection. Inside the database the block checks Development-only facts: the database is named `postgres`; the remote-only alias row `20260814002658` is present (Production does not have it); none of the 13 versions has a row (Production already records 10 of them); and the exact ledger row count and SHA-256 of the whole sorted ledger equal the values the owner approved. Tested: a Production-shaped ledger is refused.
3. **Order is enforced, not implied.** The 28 sealed-package versions, the alias row `20260814002658` and the alias-reconciliation row `20260814120000` (O2) must already be in the ledger or the block raises. The approved base count and hash are taken **after** those rows exist. Compatibility versions come **after** this block.
4. **Allowlist:** exactly the 13 versions; no other version can be written (the rows written must equal the allowlist set; a repeated or extra version raises); it must not intersect the deny set (withdrawn Cases 41-43 and the never-executed demo-admin migration `20251003170350`).
5. **No duplicates:** none of the 13 versions may already have a row.
6. **Exact form per row:** the marker must start with the NOT EXECUTED attestation prefix, contain its own version and no placeholder. `statements` is one element, never SQL, so nothing is represented as having run.
7. **Deny-list exceptions need a separate approval id.** `20251001052039`, `20260125173238`, `20260305222010` and `20260611184401` carry `deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}}`; the block raises unless that field is present and filled on exactly those four and absent on the other nine. The deny list itself is not changed.
8. **Postconditions:** ledger size = base + 13; exactly 13 single-element marker rows; no denied version recorded. The base rows are untouched (tested).
**Not covered, still required and unchanged:** the alias requirements O1 (a comment-only migration file for the remote-only version `20260814002658`) and O2 (a history-only row for `20260814120000`); they are prerequisites of this block.
**Rollback or correction:** inside a transaction, delete one version's row; never edit a row. Deleting makes the file pending again. For the dangerous versions that exposes it to a standard push, so correct only while Deploy to production is OFF.
**Honest limits:** the SQL cannot prove the hosted project reference (the authorization document does), it cannot prove that a human read the evidence, and a filled-in copy is only as good as the owner's approved values.

## 3. The 13 attestations (each individually approvable; every signature field is unfilled)
Counts: 7 `effects-present-execution-unproven` (#1, 5, 6, 7, 8, 9, 11) and 6 `deliberately-not-executed` (#2, 3, 4, 10, 12, 13). The owner may approve, change or reject each one separately; approving one implies nothing about another.

### Attestation 1 of 13: `20251001051901`

| Field | Content |
|---|---|
| 1. Filename and version | `20251001051901_001_create_core_schema.sql` / `20251001051901` (ledger name would be `001_create_core_schema`) |
| 2. Original SQL purpose | Creates the core schema (tables, indexes, RLS) and inserts the single default pricing_rules row. |
| 3. Current Development evidence | pricing_rules has 1 row, no NULL core fields, primary key only, updated 2025-10-16; core tables exist (Step 2 schema captures: 179 object matches of 45 statements, 4 superseded, 1 unmatched). Ledger has the earlier baseline row 20251001051900 but none for this version. |
| 4. Execution risk | The INSERT into pricing_rules has no conflict guard and the table has only a primary key: a re-run adds a second pricing row. |
| 5. Is actual execution appropriate? | No. The schema already exists and the row would duplicate. |
| 6. Equivalent effects exist now? | Yes (schema); the pricing row exists but could come from this INSERT or a later seed. |
| 7. Historical execution confidence | LOW-MEDIUM: effects match, no ledger row, no alias, Development data is a Production copy. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `effects-present-execution-unproven` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20251001051901 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001051901_001_create_core_schema.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it is REQUIRED (creates the core schema) and inserts one pricing row (sandbag fee 3000). |
| 12. Production compatibility | NOT recorded on Production (baseline file). Production needs its own decision when its integration is reconciled. Production recorded this version: no. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would insert a second pricing row. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | e2k-final-development-disposition.csv; e2i-development-version-verdicts.csv; thirteen-migration-review.md rows 1 and section 8 Q4 |

### Attestation 2 of 13: `20251001052039`

| Field | Content |
|---|---|
| 1. Filename and version | `20251001052039_002_seed_sample_units.sql` / `20251001052039` (ledger name would be `002_seed_sample_units`) |
| 2. Original SQL purpose | Inserts 8 sample inflatable units and their sample media. |
| 3. Current Development evidence | None of the seed slugs checked exist (Step 2 Q05: 3 slugs; Step 4A.5 Q13: 2 slugs); 16 other units exist. |
| 4. Execution risk | Executing now inserts sample units and stock-photo media into the live catalogue. |
| 5. Is actual execution appropriate? | No. The catalogue was replaced or the seed never ran; either way the sample units must not appear. |
| 6. Equivalent effects exist now? | No (the seed rows are absent). |
| 7. Historical execution confidence | NONE: no evidence it ever ran. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `deliberately-not-executed` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20251001052039 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001052039_002_seed_sample_units.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). **Deny-list exception:** a SEPARATE approval id `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` is also required for this version, because it is on the Step 2 deny list. The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it inserts the 8 sample units (they are present in every fresh build today). |
| 12. Production compatibility | NOT recorded on Production (baseline file). On the deny list (blocked_no_safe_rule): recording needs a new Step 2 decision. Production recorded this version: no. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would insert the sample units. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | e2k-attestation-decisions.md (20251001052039); thirteen-migration-review.md rows 2 and section 8 Q13 |

### Attestation 3 of 13: `20251001192425`

| Field | Content |
|---|---|
| 1. Filename and version | `20251001192425_004_add_new_order_fields.sql` / `20251001192425` (ledger name would be `004_add_new_order_fields`) |
| 2. Original SQL purpose | Adds orders.start_date/end_date, backfills them, sets NOT NULL, adds an index, and sets the sandbag fee to 3000. |
| 3. Current Development evidence | orders has no start_date/end_date (dropped by repository file 20251216210332, which has no Development ledger row); sandbag fee is 3500, not 3000. |
| 4. Execution risk | Executing now re-adds the dropped columns and resets a live price from 3500 to 3000. |
| 5. Is actual execution appropriate? | No. |
| 6. Equivalent effects exist now? | Partly (other statements present, 5 superseded); the column and fee effects are gone or changed. |
| 7. Historical execution confidence | NONE for this file's own effects. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `deliberately-not-executed` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20251001192425 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001192425_004_add_new_order_fields.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it adds start_date and sets the fee to 3000; 20251216210332 later drops the column. |
| 12. Production compatibility | NOT recorded on Production (baseline file). Production needs its own decision. Production recorded this version: no. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would recreate the dropped column and reset the fee. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | thirteen-migration-review.md row 3, section 8 Q1/Q2/Q4 |

### Attestation 4 of 13: `20260125173238`

| Field | Content |
|---|---|
| 1. Filename and version | `20260125173238_fix_incorrect_balance_due_calculations.sql` / `20260125173238` (ledger name would be `fix_incorrect_balance_due_calculations`) |
| 2. Original SQL purpose | Recomputes balance_due_cents on every order (formula includes the tip). |
| 3. Current Development evidence | 55 of 171 orders match this formula; 57 match the 20260305222010 formula; 21 orders carry a tip; no NULL balances. |
| 4. Execution risk | Executing now rewrites the balance of most orders, which are money fields. |
| 5. Is actual execution appropriate? | No. |
| 6. Equivalent effects exist now? | Not provable (a data recomputation cannot be re-proved on orders edited since). |
| 7. Historical execution confidence | NONE. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `deliberately-not-executed` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260125173238 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260125173238_fix_incorrect_balance_due_calculations.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). **Deny-list exception:** a SEPARATE approval id `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` is also required for this version, because it is on the Step 2 deny list. The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it updates zero rows (no orders). |
| 12. Production compatibility | Recorded as executed on Production (history). Development's marker does not change Production. On the deny list (blocked_no_safe_rule): recording needs a new Step 2 decision. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would recompute order balances. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | e2k-attestation-decisions.md; thirteen-migration-review.md row 4, section 8 Q11 |

### Attestation 5 of 13: `20260126193205`

| Field | Content |
|---|---|
| 1. Filename and version | `20260126193205_fix_home_address_default_to_woodward_st.sql` / `20260126193205` (ledger name would be `fix_home_address_default_to_woodward_st`) |
| 2. Original SQL purpose | Updates the default home address and coordinates in admin_settings, only where the old default is still set. |
| 3. Current Development evidence | All three keys already equal the migration's values; updated_at 2026-01-26 19:32:06 (one second after the version time). The three UPDATEs are guarded by the old default value. |
| 4. Execution risk | Executing now changes nothing (guards do not match; the longitude update sets a value to itself). |
| 5. Is actual execution appropriate? | Not needed: redundant. A genuine execution would be harmless, but recording it as executed would be unproven. |
| 6. Equivalent effects exist now? | Yes. |
| 7. Historical execution confidence | MEDIUM: timestamp coincidence, but Development data is a Production copy. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `effects-present-execution-unproven` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260126193205 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260126193205_fix_home_address_default_to_woodward_st.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database the guarded UPDATEs match the seeded defaults or nothing; harmless. |
| 12. Production compatibility | Recorded as executed on Production. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending; a standard push would run harmless guarded UPDATEs. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | thirteen-migration-review.md row 5, section 8 Q5; e2k-attestation-decisions.md |

### Attestation 6 of 13: `20260224133344`

| Field | Content |
|---|---|
| 1. Filename and version | `20260224133344_create_google_reviews_system.sql` / `20260224133344` (ledger name would be `create_google_reviews_system`) |
| 2. Original SQL purpose | Creates google_reviews (RLS, index) and inserts one sample review with ON CONFLICT DO NOTHING. |
| 3. Current Development evidence | Table exists with a primary key and rating check only; its single row equals the migration's sample review (text and name) and was created 2026-04-08. |
| 4. Execution risk | Executing now inserts a duplicate sample review: the conflict clause can never fire because there is no unique key. |
| 5. Is actual execution appropriate? | No. |
| 6. Equivalent effects exist now? | Yes. |
| 7. Historical execution confidence | LOW-MEDIUM: the row's creation time is later than the migration, consistent with a data refresh. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `effects-present-execution-unproven` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224133344 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224133344_create_google_reviews_system.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it creates the table and inserts the sample review (present in every fresh build today). |
| 12. Production compatibility | Recorded as executed on Production. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would insert a duplicate review. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | thirteen-migration-review.md row 6, section 8 Q12 |

### Attestation 7 of 13: `20260224161311`

| Field | Content |
|---|---|
| 1. Filename and version | `20260224161311_add_featured_image_to_unit_media.sql` / `20260224161311` (ledger name would be `add_featured_image_to_unit_media`) |
| 2. Original SQL purpose | Adds unit_media.is_featured and marks the lowest-sort image of every (unit, mode) group as featured. |
| 3. Current Development evidence | 35 media rows, 12 featured; 4 groups have none, 1 featured row is not the lowest sort, 7 featured rows were created after the migration. |
| 4. Execution risk | Executing now would set is_featured on the lowest-sort row of every group, changing curated flags. |
| 5. Is actual execution appropriate? | No. |
| 6. Equivalent effects exist now? | Yes for the column; the flags are partly changed by later edits. |
| 7. Historical execution confidence | LOW: flags show later edits. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `effects-present-execution-unproven` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224161311 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224161311_add_featured_image_to_unit_media.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it adds the column and features the sample units' first images. |
| 12. Production compatibility | Recorded as executed on Production. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would reset featured flags. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | thirteen-migration-review.md row 7, section 8 Q7 |

### Attestation 8 of 13: `20260224183629`

| Field | Content |
|---|---|
| 1. Filename and version | `20260224183629_add_google_review_to_pickup_messages.sql` / `20260224183629` (ledger name would be `add_google_review_to_pickup_messages`) |
| 2. Original SQL purpose | Upserts the google_review_url setting, updates the pickup SMS template, and upserts the pickup_complete e-mail template. |
| 3. Current Development evidence | SMS template text is byte-identical to the migration (md5 equal); e-mail template differs by 2 whitespace characters; the setting row and both templates carry one identical timestamp (2026-02-24 18:36:30.522332). |
| 4. Execution risk | Executing now would rewrite both templates (nearly identical text) and reset updated_at. |
| 5. Is actual execution appropriate? | Not needed: redundant. |
| 6. Equivalent effects exist now? | Yes. |
| 7. Historical execution confidence | MEDIUM-HIGH: one-transaction timestamp across three rows, but Development data is a Production copy. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `effects-present-execution-unproven` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224183629 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224183629_add_google_review_to_pickup_messages.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it seeds the setting and the templates. |
| 12. Production compatibility | Recorded as executed on Production. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending; a standard push would overwrite two templates with near-identical text. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | thirteen-migration-review.md row 8, section 8 Q6 |

### Attestation 9 of 13: `20260224184535`

| Field | Content |
|---|---|
| 1. Filename and version | `20260224184535_update_google_review_url.sql` / `20260224184535` (ledger name would be `update_google_review_url`) |
| 2. Original SQL purpose | Sets the google_review_url setting to the business's review link. |
| 3. Current Development evidence | The setting already equals the migration's value; the row's updated_at equals its created_at because this UPDATE does not set it. |
| 4. Execution risk | Executing now changes nothing. |
| 5. Is actual execution appropriate? | Not needed: redundant. |
| 6. Equivalent effects exist now? | Yes. |
| 7. Historical execution confidence | LOW-MEDIUM: value match only. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `effects-present-execution-unproven` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224184535 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224184535_update_google_review_url.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it sets the URL. |
| 12. Production compatibility | Recorded as executed on Production. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending; a standard push would run a harmless same-value UPDATE. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | thirteen-migration-review.md row 9, section 8 Q5 |

### Attestation 10 of 13: `20260305222010`

| Field | Content |
|---|---|
| 1. Filename and version | `20260305222010_fix_balance_exclude_tip.sql` / `20260305222010` (ledger name would be `fix_balance_exclude_tip`) |
| 2. Original SQL purpose | Recomputes balance_due_cents on every order, excluding the tip. |
| 3. Current Development evidence | 57 of 171 orders match this formula; 55 match the 20260125173238 formula; 21 orders carry a tip. |
| 4. Execution risk | Executing now rewrites the balance of most orders, which are money fields. |
| 5. Is actual execution appropriate? | No. |
| 6. Equivalent effects exist now? | Not provable. |
| 7. Historical execution confidence | NONE. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `deliberately-not-executed` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260305222010 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260305222010_fix_balance_exclude_tip.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). **Deny-list exception:** a SEPARATE approval id `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` is also required for this version, because it is on the Step 2 deny list. The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it updates zero rows. |
| 12. Production compatibility | Recorded as executed on Production. On the deny list (blocked_no_safe_rule): recording needs a new Step 2 decision. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would recompute order balances. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | e2k-attestation-decisions.md; thirteen-migration-review.md row 10, section 8 Q11 |

### Attestation 11 of 13: `20260311113547`

| Field | Content |
|---|---|
| 1. Filename and version | `20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql` / `20260311113547` (ledger name would be `fix_webhook_idempotency_and_receipt_deduplication`) |
| 2. Original SQL purpose | Adds webhook status tracking (guarded column, constraint, trigger) and an UPDATE of stripe_webhook_events rows. |
| 3. Current Development evidence | webhook_events_status_check and update_webhook_events_updated_at exist; stripe_webhook_events is empty so the UPDATE touches no rows. |
| 4. Execution risk | Executing now is guarded and touches no rows. |
| 5. Is actual execution appropriate? | Not needed: redundant. |
| 6. Equivalent effects exist now? | Yes. |
| 7. Historical execution confidence | MEDIUM: schema effects identical in both captures; the data effect is vacuous. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `effects-present-execution-unproven` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260311113547 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it adds the tracking objects. |
| 12. Production compatibility | Recorded as executed on Production. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending; a standard push would run guarded statements. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | e2k-final-development-disposition.csv; thirteen-migration-review.md row 11, section 8 Q12 |

### Attestation 12 of 13: `20260315173745`

| Field | Content |
|---|---|
| 1. Filename and version | `20260315173745_fix_trigger_customer_profile_columns.sql` / `20260315173745` (ledger name would be `fix_trigger_customer_profile_columns`) |
| 2. Original SQL purpose | Replaces the sign-up trigger function auto_assign_customer_role() and backfills customers for orphaned auth users. |
| 3. Current Development evidence | The live function is a different, later definition (search_path=public, not the file's public, auth); no trigger is attached on any auth table; 0 users lack a customer. |
| 4. Execution risk | Executing now replaces the live function with an older body and runs a backfill; run after the October files it would overwrite their hardened result. |
| 5. Is actual execution appropriate? | No. The October file 20261016120000 (sealed package) supplies the trigger and provisioning. |
| 6. Equivalent effects exist now? | Partly (the later function exists; the trigger is absent). |
| 7. Historical execution confidence | NONE for the file as written. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `deliberately-not-executed` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260315173745 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260315173745_fix_trigger_customer_profile_columns.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it creates the March function body, which the October file later replaces. |
| 12. Production compatibility | Recorded as executed on Production. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would replace the live function. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | thirteen-migration-review.md row 12, section 8 Q8/Q9 |

### Attestation 13 of 13: `20260611184401`

| Field | Content |
|---|---|
| 1. Filename and version | `20260611184401_create_update_pricing_rules_rpc.sql` / `20260611184401` (ledger name would be `create_update_pricing_rules_rpc`) |
| 2. Original SQL purpose | Creates the SECURITY DEFINER function update_pricing_rules(...), which writes pricing_rules. |
| 3. Current Development evidence | The function does not exist on Development; 0 functions, views, rules or policies mention it; no application or Edge Function code calls it. |
| 4. Execution risk | Executing now adds a privileged pricing-write function that nothing uses. |
| 5. Is actual execution appropriate? | No (owner decision U-E2I-4: Production-only function with no caller). |
| 6. Equivalent effects exist now? | No (absent). |
| 7. Historical execution confidence | NONE. Never S1: nothing here shows that this file ran on Development. |
| 8. Proposed marker class | `deliberately-not-executed` |
| 8. Proposed ledger marker wording (statements[1]) | `-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260611184401 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260611184401_create_update_pricing_rules_rpc.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist` |
| 9. Execution not certified | This record does **not** certify that the original SQL executed, and it must not be read as "applied". It records a decision about this version only. |
| 10. Required owner attestation | One signature for this version only: name `{{ATTESTED_BY}}`, date `{{ATTESTED_AT}}`, authorization id `{{AUTHORIZATION_ID}}` (all unfilled). **Deny-list exception:** a SEPARATE approval id `{{DENYLIST_EXCEPTION_APPROVAL_ID}}` is also required for this version, because it is on the Step 2 deny list. The owner confirms the marker class above and the not-proven statement. |
| 11. Fresh-database consequences | On a fresh database it creates the function (anon cannot execute it after the October migrations). |
| 12. Production compatibility | Recorded as executed on Production. Excluded on the deny list (excluded_pending_owner): recording needs a new Step 2 decision. Production recorded this version: yes. |
| 13. Rollback or correction | Delete the marker row: the version becomes pending and a standard push would create the function. To correct a wrong class, delete the row and write a new one under a new signature; never edit a row in place. |
| 14. Evidence references | e2k-report.md (U-E2I-4); thirteen-migration-review.md row 13, section 8 Q10 |

## 4. The two compatibility migrations (local proposals; not authorized for any hosted database)
Registry and pinned hashes: `audit/step4/compat-migrations.json`. Evidence: `compat-migrations-oracle-results.json` (real CLI v2.104.0, disposable local PostgreSQL 18, real SQL; produced by `scripts/dev/hosted-executor/compat-migrations-oracle.py`).

### 4.1 A: `20260324175545_compat_replace_legacy_user_roles_check.sql`
- **Why:** the first fresh-build failure is `20260324175546` (lower-casing roles violates the legacy upper-case-only `user_roles_role_check` created at `20251207163822`, which Production and Development lost by hand).
- **Analysis (replace, normalize or drop?):** dropping blindly is unsafe because an older-versioned file applied later (with `--include-all`) could remove the canonical lower-case constraint that the October file `20261016120000` installs. So the file acts **only** when the constraint named `user_roles_role_check` exists **and** accepts exactly the upper-case vocabulary and no lower-case name; it then replaces it with a same-named constraint accepting the same four roles in upper or lower case (a superset, so existing rows validate). This is the **minimum** compatibility requirement: the next file lower-cases existing rows, so lower-case must be accepted, and the existing upper-case rows must stay valid. A drop-only fix (the hand adjustment) would leave **no** constraint at all until October, which is wider. The October migration already drops every role CHECK before installing the canonical lower-case one, so the replacement lives for one step on a fresh build.
- **Role-security review (tested, C12):** the constraint only restricts the vocabulary; who may write `user_roles` is decided by row-level security and grants, which A does not touch. At the state just before `20260324175546`, `anon`, an authenticated user with no role row and an authenticated customer **cannot insert any role row, in any casing, before or after A** (every attempt is denied, none accepted). Role values outside the four (`superuser`, `Admin ` with a trailing space) stay rejected for every actor. The only behavioral difference is for a privileged actor: the policy "Admin can insert crew roles" requires the lower-case value `crew`, which the legacy constraint blocked; that policy's lower-case insert is accepted by the constraint in both existing shapes (Development has none, Production has the lower-case one), and on a fresh build the difference exists only between A and October during a replay with no users. No new role value, no privilege grant, no change to any policy.
- **Existing databases:** the Development shape has no such constraint and the Production shape has the lower-case one; both are unchanged (schema hash) by A.
- **Preconditions / postconditions:** in the file header.
- **Local results:** without it a fresh build stops at `20260324175546`; with it all 390 files apply and the final schema hash equals the hand-adjusted replay's, whose final constraint is October's lower-case one; rerun is a no-op; a missing constraint stays missing; the canonical constraint is untouched.
- **Remaining hosted verification:** before any hosted record, read-only confirm that Development has no `user_roles_role_check` and Production has the lower-case one.
### 4.2 B: `20260615175815_compat_orders_realtime_before_duplicate_add.sql` (corrected)
- **Why:** `20260324051459` already adds `orders` to `supabase_realtime`; `20260615175816` adds it again without a guard and PostgreSQL has no `IF NOT EXISTS` for `ADD TABLE`.
- **The risk found in review.** The first version trusted the migration ledger alone. Test C11 showed that a schema at its head paired with a ledger that lacks the later versions made it remove `orders` from the publication, and nothing would restore it. Given this project's history of ledger drift (58 rows against 389 files; versions with no row; rows with no file), a ledger-only guard is not acceptable. Root cause: the file's only evidence of "fresh build" was a table whose reliability is exactly what is in doubt.
- **Correction.** The file now acts only when **three independent tests** all say "fresh, in order"; any single "existing database" answer, or any unexpected error, makes it do nothing and print a notice: (1) the ledger is absent or has no version >= `20260615175816`; (2) none of four tables created by four different later migrations exists (`inventory_products`, `order_portal_links`, `package_inflatable_eligibility`, `public_menu_groups`), which holds on the real Development database; (3) `public.orders` exists, does not use FORCE ROW LEVEL SECURITY and has no rows (the real Development database holds 171 orders). The ledger therefore cannot, by itself, cause a removal.
- **Can it be absolutely fail-closed? Not provably, and the document says so.** The one state that passes all three tests while being past `20260615175816` is a database that is exactly at that point, has no orders, has no later tables and has no ledger: it is indistinguishable from a fresh build, holds no customer data, and exists only as a disposable replay (tested and recorded as the documented residual). No additive migration can do better, because the effect of `20260615175816` and of `20260324051459` is the same publication membership. The alternative that removes even that residual is not to ship B at all and keep the two out-of-band adjustments in the replay tool; that was rejected for now because it leaves fresh builds unrepeatable, but it remains the zero-risk fallback if the owner prefers it.
- **Local results (real SQL):** in order, B removes `orders`, replica identity stays `f` (FULL), other members are unchanged, `20260615175816` then succeeds and the final membership equals the full build's; rerun is a no-op. B does nothing on: the former C11 case (Production shape, ledger lacking later versions), a Production shape with no ledger schema at all, a Development shape with an emptied ledger, an in-order build with one order row, FORCE RLS on `orders`, each single later table alone, an absent publication, and when run by a role that cannot alter the publication (the error is caught and reported). Development-shaped and Production-shaped databases are unchanged (schema hash).
- **Hosted publication behavior:** tested on plain PostgreSQL 18 with a locally created `supabase_realtime`; hosted Supabase's publication management is not reproduced and stays unverified until a read-only hosted check of membership and ownership.
- **Still true:** existing databases should **record** B without executing it (section 4.5).

### 4.3 Version and ordering analysis
| Check | Result |
|---|---|
| Versions unused | `20260324175545` and `20260615175815` appear once each (duplicate-version scan of the 391 files: none) |
| Chronology | A lies after `20251207163822` (creates the constraint) and one second before `20260324175546` (needs it gone); B lies after `20260324051459` (first add) and one second before `20260615175816` |
| Conflict with the sealed package | none: the package holds 28 October/Step 3B versions; the compatibility versions are not in it, the Step 2 execution manifest, the manifests or the deny list (tested) |
| Executor eligibility | not eligible: the executor runs only the sealed package's items; `build` draws from the Development manifest, which has no row for them |
| Standard tooling | both are **older than the ledger heads**. Observed: `db push` without `--include-all` refuses ("Found local migration files to be inserted before the last migration on remote database"); with `--include-all` exactly these two are pending once everything else has a row |
| Tests that pinned the file set | the Step 2/3 manifest tests and the pending-set test now exclude exactly these two named, hash-pinned files; Development pending becomes 334 and Production pending 114 (each +2) |
| Production's separate ledger | **Production's integration (Deploy ON, branching ON) reads the same files from `main`.** Once these files reach `main`, Production sees two pending versions older than its head and its automatic deployment will refuse until they are recorded there. Do **not** merge them to `main` before a separate, approved Production decision records them. Production is unchanged by this package |

### 4.4 Ordering relative to the other work (Development)
1. Controls and backup (D-02, Bolt, Deploy OFF), Git, authorizations.
2. Step 2 bookkeeping and bucket updates (S2, S3), including the attestation row for `20260324175546`.
3. Guarded functions, canary, the 23 October files and the 5 Step 3B files via the **unchanged** sealed package.
4. Deferred bookkeeping (S8); containment release (S11); testing after S12.
5. **Alias reconciliation first** (O1 file and the O2 row for `20260814120000`), **then** the 13 markers (section 2), whose approved base count and hash are taken after the alias rows exist; the marker block refuses to run before the sealed package and the alias rows.
6. The two compatibility versions are **recorded without executing** (section 4.5), with the 13 markers' hosted procedure or in a separate authorized step; B's SQL is never run on a hosted database. The ordinary push is not needed for them.
7. Deploy to production ON only after the canary; new migrations stamped later than `20261026120400`.
Final expected Development ledger: 392 versions (389 files + alias file + 2 compatibility files), 392 rows, CLI "up to date".

### 4.5 Recommended treatment of A and B on existing databases (finalization)
**Recommendation: keep A and B in `supabase/migrations`, and on Development and Production RECORD WITHOUT EXECUTING both versions. B's SQL is never run on a hosted database.**
Two alternatives were weighed:
| | Keep B in the directory and record it without executing | Keep the adjustment only in local replay tooling (B not in the directory) |
|---|---|---|
| Hosted databases | no SQL of B runs; one ledger row per database; the standard tooling then sees nothing pending | nothing to record, nothing pending |
| Fresh builds that are NOT the local replay tool (`supabase start`, `supabase db reset`, CI, and the preview branches that Production's Automatic branching creates) | work: all 390 files apply | **keep failing** at `20260615175816` (and A's failure at `20260324175546` would remain unless A is also dropped), so ordinary local development and previews stay broken |
| Normal operation going forward | yes | no: every contributor and every preview needs the out-of-band adjustment |
| Extra machinery | two ledger rows | none, but a permanent exception outside the standard tooling |
The first is the least risky way to support normal operation: the hosted procedure depends on **no** publication change, and the guards in B are a second line of defence, not the first. The second would be preferred only if fresh builds outside the replay tool are not wanted.

**Exact treatment (for the owner to approve separately; nothing is run):**
- **Development** and **Production** (Production only through its own approved reconciliation, and before these files reach `main`): after the 13 markers (Development) or in Production's own bookkeeping, insert two rows. Marker text (the run id is filled by the hosted procedure; nothing else is variable):
  `-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED run={{RUN_ID}} basis=compat migration for fresh-database replay only; its guards make it a no-op on this database; recorded so that standard tooling does not treat it as pending; its SQL was not run here`
  `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20260324175545','compat_replace_legacy_user_roles_check',ARRAY[<marker>]), ('20260615175815','compat_orders_realtime_before_duplicate_add',ARRAY[<marker>]);`
  Preconditions: neither version has a row; the standard tooling's dry run lists these two and nothing else.
- **Never run on a hosted database:** `supabase db push --include-all` must not be used to apply B while anything else is pending; with the two rows recorded it cannot select B at all.
- **Fresh databases and previews** execute A and B in order, as intended.

**Proof that the hosted procedure never depends on B removing publication membership (local, both shapes, `compat-migrations-oracle-results.json` C13 and C14):**
- *Record without executing:* before the rows the dry run (`--include-all`) lists exactly `20260324175545` and `20260615175815`; after them nothing is pending ("Remote database is up to date"); the schema hash and the publication membership of `orders` are unchanged; the rows are single-element `NOT EXECUTED` markers. Only an `INSERT` into the ledger ran.
- *Fallback, if someone does run the ordinary push:* with only these two files pending, `db push --include-all` applies exactly them, records two rows, and leaves `orders` published, the schema hash and the `user_roles` constraint unchanged, because the guards in B (and A) see an existing database.
The clear separation: recording needs no guard; the guard only matters if the recommended procedure is bypassed.

## 5. Remaining Development release gates (unchanged by this package)
D-02 execution and restore proof, G-20 (Bolt), D-03b (Deploy OFF), G-22 push scope, G-14/G-15/G-17/G-18/G-19, G-16 canary, G-04-G-06, D-JWT-1, G-21 (this package), and a separate owner decision for the compatibility migrations (G-21 text). Netlify stays ON; no isolated SMS/e-mail/frontend fix; no functional testing before the full coordinated deployment completes.

## 6. What the owner would be approving, and what not
Approve or reject: (a) each of the 13 attestations and its marker class; (b) the marker SQL shape (section 2); (c) the four deny-list exceptions (#2, #4, #10, #13); (d) compatibility migrations A and B as repository files, with the Production consequence in 4.3. This package approves nothing; execution of any of it needs separate hosted authorization.
