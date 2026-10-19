# Independent review of the 13 unresolved historical migrations (Step 4A.4)

**Status of the Step 4A.3 proposal ("record all 13 as NOT EXECUTED"): NOT APPROVED.** This document reviews it independently. No ledger row was written, no migration file was changed, moved or removed, and nothing hosted was contacted. Evidence: the migration files, the committed Step 2 evidence under `audit/evidence/` (`e2k-final-development-disposition.csv`, `e2i-development-version-verdicts.csv`, `e2k-attestation-decisions.md`, `prod-history-277.csv`), and a local experiment with the real Supabase CLI v2.104.0 against a disposable PostgreSQL (`exclusion-alternatives-oracle.json`, produced by `scripts/dev/hosted-executor/exclusion-alternatives-oracle.py`).

## 1. Three states that must not be mixed
| State | Meaning | How it may be recorded |
|---|---|---|
| **S1** SQL demonstrably executed historically | proof exists that this file ran on Development | an "executed" row is honest only with that proof |
| **S2** Equivalent effects demonstrably exist, execution history uncertain | the schema or data looks as the file would leave it, but a later change or a different path could explain it | only an owner-signed **attestation** saying exactly that, never "executed" |
| **S3** SQL deliberately must not execute | running it now would change or damage current state | must never be pending for a tool that executes pending files |
None of the 13 is S1 for Development (the Development ledger has no row for any of them). Nothing in this review upgrades any file to S1.

## 2. What the standard CLI does today with these files (observed)
Any file with no ledger row is pending and will be executed in version order (`cli-oracle-results.json` step B: 332 files, including all 13). So each file below is a live risk until it is either recorded or made invisible to the tool.

## 3. The 13 versions
*Step 4A.4 reading from the Step 2 evidence. Where sections 9 and 10 (Step 4A.5, hosted read-only evidence) differ, they supersede this table.*
Production column: whether Production's ledger (277 rows) records the version (`prod-history-277.csv`); all 10 recorded there are executed history **on Production only**, which says nothing about Development.
| # | Version / file | Intended SQL | State | What a standard push would do now | Existing effects on Development | Evidence available | Evidence missing | Risk if executed | Prod row |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `20251001051901_001_create_core_schema.sql` (412 lines) | creates the core schema and inserts the one `pricing_rules` row | **S2** | re-run: mostly `IF NOT EXISTS`, plus an INSERT into `pricing_rules` | schema effects present (45 statements: 179 object matches, 4 superseded, 1 unmatched); the `pricing_rules` row exists with no NULLs | schema captures at two dates | proof the INSERT itself ran (only the resulting row is seen); a seed row could also come from a later migration | duplicate or conflicting pricing row; low if guarded, unverified | no |
| 2 | `20251001052039_002_seed_sample_units.sql` | inserts 8 sample units and their media | **S3** (execution history unknown) | inserts sample units into a live catalogue | none: 0 of 3 seed slugs exist; 16 other units exist | Q05 | whether it ever ran and the sample units were later deleted, or never ran | pollutes the real catalogue with sample units and Pexels images | no |
| 3 | `20251001192425_004_add_new_order_fields.sql` | adds `orders.start_date`/`end_date`, backfills, sets NOT NULL, adds an index, sets the sandbag fee to 3000 | **S2/S3 mixed** | re-adds `start_date` (`ADD COLUMN IF NOT EXISTS`), which no longer exists, then NOT NULL and the index; resets `surface_sandbag_fee_cents` to 3000 | partly: 4 statements present, 5 superseded; the column the backfill targets is gone; sandbag fee currently set | Q09, Q10 | which later migration dropped `start_date`; current intended fee | **recreates a dropped column and overwrites a live pricing value** | no |
| 4 | `20260125173238_fix_incorrect_balance_due_calculations.sql` | recomputes `balance_due_cents` on every order (including tip) | **S3** | recomputes every order's balance | formula cannot be re-proved; 0 NULL balances | Q11 | whether it ran; whether orders were edited afterwards | silently changes money fields of every order; later superseded by #10 | yes |
| 5 | `20260126193205_fix_home_address_default_to_woodward_st.sql` | sets the home address and coordinates in `admin_settings` | **S2** (cannot be distinguished from later edits) | overwrites the current address settings | keys not matched in the capture | none direct | current intended values | overwrites owner-edited settings | yes |
| 6 | `20260224133344_create_google_reviews_system.sql` | creates `google_reviews` with RLS and inserts a sample review (`ON CONFLICT DO NOTHING`) | **S2** | objects exist (`IF NOT EXISTS`); the INSERT may add a duplicate sample row | 23 objects present; 1 review row | Q07 | whether that row is the migration's sample | low (mostly guarded) | yes |
| 7 | `20260224161311_add_featured_image_to_unit_media.sql` | adds `is_featured`, marks a first image per unit featured | **S2** | UPDATE can reset featured flags | column present; 12 of 35 media rows featured | Q05 | whether the 12 are the migration's choice or later edits | overwrites curated featured images | yes |
| 8 | `20260224183629_add_google_review_to_pickup_messages.sql` | upserts a setting, a template and updates SMS template text (`ON CONFLICT DO UPDATE`) | **S2** | overwrites current template and setting text | 2 named keys/templates present | Q-series on templates | whether current text is the migration's | overwrites customer-facing message text | yes |
| 9 | `20260224184535_update_google_review_url.sql` | sets one setting to a fixed Google review URL | **S2** | overwrites the current URL | key not matched in the capture | none direct | current intended URL | overwrites a live setting | yes |
| 10 | `20260305222010_fix_balance_exclude_tip.sql` | recomputes `balance_due_cents` on every order, excluding tip | **S3** | recomputes every order's balance | formula cannot be re-proved; 0 NULL balances | Q11 | as #4 | silently changes money fields of every order | yes |
| 11 | `20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql` | guarded constraint/trigger creation and an UPDATE of `stripe_webhook_events` | **S2** | constraint and trigger already exist (guarded); the UPDATE touches no rows because the table is empty | constraint `webhook_events_status_check` and trigger present and identical in both captures; table empty (Q17) | Q17 | none material | low | yes |
| 12 | `20260315173745_fix_trigger_customer_profile_columns.sql` (303 lines) | replaces trigger functions (customer-profile columns on sign-up) and backfills profiles | **S2/S3 mixed** | `CREATE OR REPLACE FUNCTION` would replace the current function bodies with an older version; depends on a later migration `20260324230943` not recorded on Development | 2 present, 1 superseded; 0 NULL first names in 6 profiles | Q28 | which version of the functions is live and intended | **regresses security-relevant sign-up trigger logic** | yes |
| 13 | `20260611184401_create_update_pricing_rules_rpc.sql` | creates a `SECURITY DEFINER` RPC `update_pricing_rules` | **S3** (excluded, owner decision U-E2I-4) | would create a Production-only function that nothing calls | function absent on Development (Q23) | Q23 | whether any database-internal caller exists (optional Q33) | a privileged function that writes pricing, executable by default privileges; October migration `20261007120000` otherwise revokes/guards it only if present | yes |
(Counts in row 1 are quoted from the Step 2 verdict file as written.)

**Important about the Step 2 labels:** the committed evidence lists #4 and #10 as "attest individually after the owner confirms the content is intended", but also marks them unresolved because a data recomputation can never be proved from a schema capture. The "blocked" label in the 4A.3 count refers to the Step 2 approval state, not to the three files above being the only dangerous ones: by the criteria in this section, rows 2, 3, 4, 10, 12 and 13 are the ones whose execution would damage current state.

## 4. Alternatives, tested with the real CLI (local scratch database, nothing hosted)
| # | Approach | Observed result | Notes |
|---|---|---|---|
| A1 | Record an honest `NOT EXECUTED` marker row (`statements = ['-- ... NOT EXECUTED ...']`) | CLI treats the version as applied; the file is no longer pending (E5) | Honest only if the marker is explicit and the owner signs. A fresh database built from the same files would still **execute** the file, so the ledger and a fresh build differ for exactly these files. Needs a signed attestation per file |
| A2 | `supabase migration repair --status applied <version>` | works, but the CLI writes the **file's own SQL as the recorded statement** (observed: `create table must_not_exist(id int)` recorded though the table does not exist) (E3) | **Rejected**: it asserts execution that did not happen and would deceive any later audit |
| A3 | `supabase migration repair --status reverted` | deletes the row (E4) | rewrites history; unrelated to these files (they have no Development row) |
| A4 | Move the file into a sub-directory of `supabase/migrations/` | **ignored by the CLI** (E1) | Removes it from fresh builds and from Production's reconciliation, which records 10 of the 13 as executed: Production would then show "remote versions not found". Protected-file removal; not done |
| A5 | Rename so it no longer matches `<timestamp>_name.sql` | ignored with a "Skipping migration …" notice (E2) | Same Production problem; changes protected files; not done |
| A6 | Replace file content with a no-op | not tested; **rejected** | rewrites historical SQL, forbidden, and breaks content hashes |
| A7 | Establish a trustworthy baseline: squash history up to a chosen version (`supabase migration squash`) after a verified schema dump | not run (needs Docker and a hosted dump; documented feature) | Resets the ledger to one baseline row. It rewrites applied history and is the largest change; consider only for the long term and only after Production is reconciled the same way |
| A8 | Owner decides per file: genuinely execute it | possible only for rows with a safe, idempotent, owner-intended effect (#6, #11 are the only plausible ones) | Executing is S1 only after it runs; each needs its own exact-version authorization and executor support, so it is a separate approval |

### How each alternative affects what you asked about
| Concern | A1 marker rows | A4/A5 hide the file | A7 squash |
|---|---|---|---|
| Development ledger | 13 explicit NOT EXECUTED rows | unchanged, but 3 rows remain unrecorded elsewhere | one baseline row, history lost |
| Existing migration history | additive | files disappear from the directory | rewritten |
| Fresh database creation | **still runs the 13 files** (differs from the ledger) | skips them | uses the baseline |
| Future migration generation | unaffected | unaffected | unaffected |
| GitHub integration | passes (version exists and is recorded) | passes | passes |
| Production reconciliation | consistent with its 10 executed rows | **breaks it** | needs the same baseline |
| Audit integrity | good if the marker and signature say "not executed" | poor: evidence removed | poor |

## 5. Recommendation
1. **Do not use A2, A5, A6.** A4 is the only tool-supported way to make the CLI ignore a file, but it breaks Production reconciliation, so do not use it for the files Production has executed.
2. **Split the 13 by state, not as one batch:**
   - **S2 low-risk (#1, #6, #11):** may later receive a signed attestation (A1) *after* the missing evidence in section 6 is in hand.
   - **S2/S3 mixed or overwrite-risk (#3, #5, #7, #8, #9, #12):** do not attest until the owner confirms current values and the later superseding migrations are identified; until then they remain pending and **must not be allowed to run** (see 6).
   - **S3 (#2, #4, #10, #13):** never execute. Representation: an explicit NOT EXECUTED marker row (A1) is acceptable only with a signed statement that the effect is *deliberately not applied*, plus the optional queries named in section 6 for #13.
3. **Requires an explicit owner attestation:** every file above except where the owner chooses A8. No blanket attestation; one signature per version, as Step 2 already requires.
4. **Can ordinary automatic migrations resume without misleading records?** Yes, but only if every one of the 13 has an honest row **or** is deliberately kept pending under control. A1 with explicit markers is not misleading; A2 is. Until all 13 are decided, the integration must stay controlled (Deploy to production OFF for Development), because a standard push would execute every file without a row.

## 6. Unresolved evidence (read-only queries, none run)
| Needed | For | Query type |
|---|---|---|
| Was `start_date` dropped, and by which version | #3 | catalog and Dev ledger check |
| Current values vs the migration's values | #3, #5, #8, #9 | `pricing_rules`, `admin_settings`, `email_templates` reads |
| Featured-flag provenance | #7 | read `unit_media` |
| Live definitions of the sign-up trigger functions vs the file | #12 | `pg_get_functiondef` |
| Database-internal callers of `update_pricing_rules` (optional Q33) | #13 | `pg_depend` / source search |
| Whether sample units or sample review rows were ever created | #2, #6 | read-only counts by slug |
| Owner signature per version | all | owner action |

## 7. Next step for this review
Superseded by sections 8 to 12 (Step 4A.5 evidence). Nothing is recorded until the owner decides.

---

# Step 4A.5: read-only Development evidence (2026-10-19)

## 8. What was queried (Development `srxunxiytojjsuhcmzjg`; SELECT and catalog reads only)
The MCP session itself is not read-only (`transaction_read_only = off`), so every statement was a single `SELECT`, written and checked by hand: no DDL or DML, no temporary tables, no transactions, no function calls other than `pg_get_functiondef`, `md5`, `length`, `position`, `has_function_privilege`. No SECURITY DEFINER function was invoked. No customer rows, payment data, credentials or message bodies were retrieved: results are counts, booleans, hashes, timestamps and metadata (the one text read is a generic e-mail template body that contains placeholders only).
| # | Purpose | Targets | Returned evidence | Limitation |
|---|---|---|---|---|
| Q1 | `start_date` presence | `information_schema.columns` | `start_date`/`end_date` exist only on `blackout_dates`; `orders` has `event_date` and `event_end_date` | a missing column does not prove which statement removed it |
| Q2 | `20251216210332` and `20260324230943` in the ledger | `supabase_migrations.schema_migrations` | **neither is recorded** (the first is the repository file that drops `orders.start_date`, `DROP COLUMN IF EXISTS`) | the ledger has only 58 rows |
| Q3 | Ledger around the 13 versions | ledger names and versions | the ledger holds **one** row between 2025-10-01 and 2026-04-01 (`20251001051900`); no alias rows for any of the 13 | none |
| Q4 | `pricing_rules` | row count, `surface_sandbag_fee_cents`, nulls, `updated_at`, constraints | 1 row, no NULL core fields, sandbag fee **3500**, `updated_at` 2025-10-16 07:20:17, only a primary key and one check constraint | no `created_at` column |
| Q5 | Admin settings (home address, coordinates, review URL) | `admin_settings` | classification only, values not printed: all three address keys equal the migration values; `google_review_url` equals the value set by `20260224184535`; address rows `updated_at` 2026-01-26 19:32:06.338; review-URL row `created_at = updated_at` 2026-02-24 18:36:30.522332 | Development data is a copy of Production data, so timestamps date the effect's origin, not a Development run |
| Q6 | Message templates | `sms_message_templates`, `email_templates` | SMS template text is **byte-identical** (md5 equal, 185 characters) to the text in `20260224183629`; e-mail template body is the same except **2 whitespace characters** (806 vs 808); both rows carry the identical timestamp `2026-02-24 18:36:30.522332`, which is the same instant as the review-URL row's creation | the e-mail difference could be a later edit or tool normalisation |
| Q7 | Featured media | `unit_media` | 35 rows, 12 featured, 16 (unit, mode) groups, 0 groups with more than one featured, **4 groups with none**, 11 featured rows are the lowest `sort`; 7 featured rows and 22 of 35 rows were created after the migration time; 4 units were created after it | `unit_media` has no update timestamp |
| Q8 | Sign-up function and triggers | `pg_proc`, `pg_trigger` | `auto_assign_customer_role` exists (SECURITY DEFINER, `search_path=public`, 8,080 characters, inserts `first_name`/`last_name`, no `display_name`), attached to **no trigger**; **no user trigger exists on any `auth` table**; `anon` and `authenticated` hold EXECUTE (Development's schema is contained, see the S11 gate) | the body was compared by markers, not diffed against a specific version |
| Q9 | Sign-up consequence | `auth.users`, `customers`, `customer_profiles` | 9 auth users, 0 without a customer, 6 profiles, 0 NULL first names | counts only |
| Q10 | `update_pricing_rules` references | `pg_proc` (name and source), views, rules, policies | function absent; **0** functions, views, rules or policies mention it. Repository search: only Step 2/3 documents, tests and the October guard migration mention it; no application or Edge Function code | an external caller (a script) is unprovable from the database |
| Q11 | Balance formulas | `orders` aggregates | 171 orders: **55** match the 20260125173238 formula (with tip), **57** match the 20260305222010 formula (without tip), 21 orders carry a tip, 0 NULL balances | counts only; the two formulas overlap on orders without a tip |
| Q12 | Google reviews, webhook objects | `google_reviews`, `stripe_webhook_events`, `pg_constraint`, `pg_trigger` | 1 review whose text and name equal the migration sample, created 2026-04-08 (after the migration date); the table has only a primary key and a rating check, so the sample INSERT's `ON CONFLICT DO NOTHING` can never conflict; webhook table empty; `webhook_events_status_check` and `update_webhook_events_updated_at` present | `created_at` may reflect the data refresh |
| Q13 | Seed units | `units` | 16 units, the seed slugs checked are absent (Step 2 Q05 covered all three) | none |

**Read-only confirmation:** no statement changed data, schema or settings; the ledger still has 58 rows. **Limits that cannot be removed by read-only inspection:** who executed a statement and when on Development; whether a value was produced by the migration or by an equal later edit; and the content of any function version that is no longer present.

## 9. Corrections to section 3 (new evidence changes earlier conclusions)
1. **#5 `20260126193205` is not an overwrite risk.** Its three UPDATEs are guarded (`WHERE value = <old default>`), and the longitude update sets a value to itself. All three keys already equal the migration's values, so a re-run changes nothing. The 4A.4 text "overwrites owner-edited settings" was wrong.
2. **#1 `20251001051901` is dangerous, not low risk.** Its `INSERT INTO pricing_rules` has no guard and the table has only a primary key; a re-run adds a second pricing row.
3. **#3 `20251001192425`:** `orders.start_date` was dropped by the repository file `20251216210332`, which has **no Development ledger row**, so Development already carries effects of migrations the ledger does not list. The sandbag fee is now 3500, so the file's `UPDATE ... = 3000` would change a live price.
4. **#4 and #10** are quantified: a re-run would rewrite the balance of most of 171 orders (only 55 or 57 currently match either formula).
5. **#12:** the live function is a later definition than the file (different `search_path`), and the sign-up **trigger is absent** on Development. The October file `20261016120000` (inside the sealed package) recreates `on_auth_user_created`; executing #12 after it would replace the hardened function.
6. **Ordering danger that applies to every pending file:** the CLI runs older pending files with `--include-all`, **after** the October files. Any of the 13 left pending could therefore overwrite October's results.

## 10. Revised decision matrix (S1 = execution demonstrated, S2 = equivalent effects exist, history uncertain, S3 = must not execute)
**No version qualifies as S1 for Development.** The Development ledger has no row for any of the 13, and Development data is a copy of Production data: timestamps that coincide with a migration date show that the effect existed in the source, not that Development ran the file. S2 is therefore the ceiling; nothing was upgraded.
| # | Version and file | Previous | New evidence | Revised | Execute now would be | Remain blocked | Further evidence | Recommended treatment | Owner authorization needed |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `20251001051901_001_create_core_schema.sql` | S2 | 1 pricing row, no NULLs; unguarded INSERT; primary key only | **S2, execution S3** | **dangerous** (second pricing row) | yes | none needed | signed attestation row stating NOT EXECUTED, effects exist, not proven | per-version signature |
| 2 | `20251001052039_002_seed_sample_units.sql` | S3 | seed slugs absent; 16 other units | **S3** | **dangerous** (sample units in the catalogue) | yes | none | never execute; marker row only with a signed "deliberately not applied" | per-version signature |
| 3 | `20251001192425_004_add_new_order_fields.sql` | S2/S3 | `start_date` dropped by an unrecorded file; fee 3500 vs 3000 | **S3** | **dangerous** (re-adds dropped column, reverts a price) | yes | none | never execute; marker row as above | per-version signature |
| 4 | `20260125173238_fix_incorrect_balance_due_calculations.sql` | S3 | 55 of 171 orders match this formula | **S3** | **dangerous** (rewrites most balances) | yes | none | never execute | per-version signature |
| 5 | `20260126193205_fix_home_address_default_to_woodward_st.sql` | S2 | all values already equal; guarded UPDATEs | **S2** | **redundant** (no rows change) | no, but it must still be recorded or it is pending | none | attestation (effects present), or genuine execution is harmless | per-version signature |
| 6 | `20260224133344_create_google_reviews_system.sql` | S2 | table exists; sample row present; no unique key | **S2, execution S3** | **dangerous-minor** (duplicate review row) | yes | none | attestation row | per-version signature |
| 7 | `20260224161311_add_featured_image_to_unit_media.sql` | S2 | 4 groups lack a featured image; 1 featured is not the lowest sort | **S2, execution S3** | **dangerous-minor** (changes curated flags) | yes | owner opinion on intended flags | attestation row | per-version signature |
| 8 | `20260224183629_add_google_review_to_pickup_messages.sql` | S2 | SMS identical, e-mail differs by 2 whitespace characters; one-instant timestamps | **S2** | **redundant** (nearly identical rewrite) | no | whether the 2 characters are a later edit | attestation row | per-version signature |
| 9 | `20260224184535_update_google_review_url.sql` | S2 | value already equals | **S2** | **redundant** (no change) | no | none | attestation row | per-version signature |
| 10 | `20260305222010_fix_balance_exclude_tip.sql` | S3 | 57 of 171 orders match | **S3** | **dangerous** | yes | none | never execute | per-version signature |
| 11 | `20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql` | S2 | constraint and trigger present; table empty | **S2** | **redundant** | no | none | attestation row | per-version signature |
| 12 | `20260315173745_fix_trigger_customer_profile_columns.sql` | S2/S3 | live function is a different later definition; trigger absent | **S3** | **dangerous** (replaces the later definition and runs a backfill) | yes | none | never execute; the October file supplies the trigger | per-version signature |
| 13 | `20260611184401_create_update_pricing_rules_rpc.sql` | S3 | function absent; no references in the database or application code | **S3** | **dangerous** (adds a privileged function nothing calls) | yes | optional external-caller check | never execute | owner decision U-E2I-4 plus signature |
Summary: 9 would be harmful to execute (#1, 2, 3, 4, 6, 7, 10, 12, 13); 4 would be redundant (#5, 8, 9, 11). "Redundant" is not "executed": recording any of them as executed would be false.

## 11. Normal automatic migrations versus the four ways to represent a file
| Option | What it asserts | Development | Production | Fresh databases | Future automation | Cost of being wrong |
|---|---|---|---|---|---|---|
| **A. Record an actually executed migration** | the SQL ran here | only honest after a real execution; for 9 of the 13 execution is harmful | the 10 versions Production has already executed need nothing | consistent | normal | falsifies the audit trail |
| **B. Record a synthetic NOT EXECUTED marker** | "this version is deliberately bypassed; the effect exists or must not exist" | CLI stops treating the file as pending | consistent with Production's real rows | **a fresh database still executes the file** (differs from the ledger) | normal | misleading only if the wording is vague; needs per-version signature |
| **C. Exclude the file from a future baseline** (squash after a verified schema dump) | history before the baseline is replaced by one state | ledger rewritten | needs the same baseline applied | consistent (one baseline) | normal after cut-over | rewrites applied history; large; loses per-file audit |
| **D. Keep a separate canonical history for fresh builds** (a second directory or branch of migration files) | fresh builds use cleaned files; existing databases keep the original ledger | unchanged | unchanged | consistent | two histories to keep in step; the integration reads one directory | high maintenance; easy to drift |
**No fully satisfactory option exists** for the 13 as one batch: B is the only one that keeps the original files, matches Production and satisfies the integration, but leaves fresh builds executing files the ledger says were bypassed. That divergence is acceptable only if the 13 files are harmless on an **empty** database, which is true for most of them (they update or insert on empty tables), and must be proven locally by a fresh replay (the local replay already runs all 389 files). C or D are the long-term cleanup, to be decided together with Production's reconciliation. Whichever is chosen, "the CLI says up to date" is a consequence, not the criterion.
**Explicit owner decision required:** accept B for the 13 (with per-version wording) knowing fresh builds still run the files; or defer ordinary automation and keep Deploy to production OFF for Development until C or D is designed.

## 12. Smallest set of owner decisions now supported by the evidence
1. For #2, #3, #4, #10, #12 and #13 (and #1, #6, #7 whose execution would also be harmful): confirm "never execute" and that a marker row worded NOT EXECUTED — deliberately bypassed, effect exists or not applicable, not proven is acceptable (option B).
2. For #5, #8, #9, #11 (redundant): choose between the same marker row and a genuine execution. Evidence favours the marker.
3. Accept or reject the fresh-build divergence of option B for these 13 files.
Execution of any migration is **not** being requested by this review.


---

# Step 4A.6: fresh-database compatibility and the historical-migration strategy (local only)

Evidence: `scripts/dev/migration-replay.cjs` (existing Step 2 tool, strict mode) and `scripts/dev/hosted-executor/fresh-database-oracle.py` with the real Supabase CLI v2.104.0 against disposable local PostgreSQL 18 databases; results in `audit/step4/fresh-database-oracle-results.json`. Synthetic data only: the data in a fresh database is whatever the migrations themselves insert. No hosted system was contacted. **Limitation:** a plain PostgreSQL has no `pg_net`, so `20260323201502` cannot run in the stub; it is left out of the CLI's throwaway copy only (real Supabase has `pg_net`). Nothing in the repository was edited to make a test pass.

## 13. Fresh-database replay: what happens when the history initializes a new database
| Run | Result |
|---|---|
| Strict replay, unadjusted (`migration-replay.cjs --mode strict`) | stops at `20260323201502` (`pg_net` not available in the stub) after 215 files |
| Same, stub-limited file skipped (`--stub-skips`) | **first real failure at `20260324175546_fix_get_user_role_case_sensitivity_v2.sql`**: `new row for relation "user_roles" violates check constraint "user_roles_role_check"` |
| Same, plus the two replay-only adjustments (`--adjust s1,s2`) | completes: 388 files replayed, 1 skipped |
| **Real CLI** `supabase db push` into a fresh stub database, repository files as they are (F1) | applies 233 files, records 232 ledger rows, **stops at `20260324175546`** with the same error; later files never run |
| Real CLI, plus two additive idempotent example files at intermediate versions (F3) | all 390 files apply, 390 ledger rows, `db push --dry-run` says "Remote database is up to date", and a new later file (`20261201120000`) then applies normally |

**The two causes** are drift on Production and Development that the files do not contain: (S1) the legacy upper-case-only `user_roles_role_check`, still present after `20251207163822`, was removed on the hosted databases by hand, so the file that lower-cases roles fails on a database built from the files; (S2) `orders` was added to the realtime publication by `20260324051459`, so `20260615175816` adds it a second time without a guard. **Neither involves the 13 versions.**

**The 13 on a fresh database:** all 13 replay without error (they only update or insert on empty tables). They leave synthetic historical content: 8 sample units (including the two seed slugs), one sample Google review, one pricing row with the original defaults (sandbag fee 3000), and the sign-up function. That content is not wanted in a deployable environment and is the only fresh-database hazard they add.

**Do NOT-EXECUTED markers solve this?** They solve the *existing-database* problem (Development's ledger would list the 13, so the CLI stops treating them as pending: oracle stage F). They do nothing for a *fresh* database, which has no ledger and runs every file. So after markers the fresh-database situation is exactly the table above: a failure at `20260324175546`, then 13 harmless-but-unwanted historical rows.

**Production's existing rows:** 10 of the 13 are recorded as executed on Production (`prod-history-277.csv`); #1 `20251001051901`, #2 `20251001052039` and #3 `20251001192425` are recorded nowhere on Production. Consequences: hiding a file from the CLI (move or rename, tested in Step 4A.4) breaks Production for those 10 ("remote versions not found"); only #1 to #3 could be hidden without that, and #1 (core schema) cannot be removed from a fresh build. Production will need its own decisions for #1 to #3 when its integration is reconciled.

## 14. The three viable strategies
| | A. Marker rows + version-specific attestations | B. Reviewed canonical baseline (consolidate history) | C. Supported exclusion of obsolete files with an audit record |
|---|---|---|---|
| Existing Development database | 13 additive ledger rows; schema untouched; the 28 SQL files still run via the executor | requires re-basing the ledger (hosted history rewrite) after a verified schema dump | the files stop being pending; a ledger row is not needed |
| Production history | none now; same decision later for #1-#3 (unrecorded there) | Production's 277 rows would have no files unless its history is rewritten the same way | **breaks it** for the 10 versions Production recorded |
| Fresh database creation | **unchanged**: still fails at `20260324175546` and still inserts the sample content | clean: one baseline plus later files | cleaner (fewer unwanted rows) but the S1/S2 failures remain and the core schema cannot be excluded |
| Automatic GitHub deployment | works once every file has a row | works after the cut-over | works only if no ledger row refers to a hidden file |
| Repository changes | none to history; markers are ledger rows | replace ~390 files with a baseline: very large, protected-file change | move/rename protected files |
| Rollback and audit | a marker is removed with `migration repair --status reverted`; the audit record is the signed attestation | the old history survives only in Git; the ledger loses per-file records | moved files keep Git history, but the ledger has no mention of them |
| Maintenance | lowest | high once, then low | medium; every future cleanup repeats it |

## 15. Recommendation: A for Bounce Party Club now, B as a later, separate project
**Adopt A (marker rows with version-specific attestations) for the Development ledger,** using the Step 4A.5 classification: the nine harmful versions are marked "deliberately not executed", the four redundant ones "effects present, not proven executed". No row says executed, and no row is written until you sign each version and approve the hosted step.

**How fresh-database safety is managed under A (this is unavoidable, not solved):**
1. A database created from the repository files is **non-authoritative**: for local and CI use only. Development and Production are never recreated from the files; recovery uses the approved backups (D-02).
2. Fresh builds currently stop at `20260324175546`. An optional, separate change fixes this without touching protected SQL: two **additive, idempotent** files at intermediate versions (the F3 example: `20251207163823` and `20260615175815`). On Development and Production they are no-ops. Because their versions are older than the ledger head they stay pending until the one-time `--include-all` step; after all markers are in place that step lists exactly those two files (observed in F3), so it can be applied safely and recorded as genuinely executed. This needs its own owner approval (not requested here) and must come **after** the 13 are decided, never before.
3. A fresh build that completes still contains the sample content from #2, #1 and #6; any environment built that way for real use must delete it by a reviewed, non-migration cleanup. This residual hazard is accepted until B.
4. A permanent guard: keep `migration-replay.cjs --mode strict` (with the stub exceptions listed above) as a test so a new fresh-build failure is noticed.

**B later:** after Development and Production have each been reconciled and run on ordinary migrations for a period, create a reviewed baseline (a verified schema-only dump from the reconciled database, one new baseline file, later files after it). That is the only complete fix for the fresh-database hazards; it requires an owner-approved historical baseline strategy and a Production plan, and is deliberately not started now.

**Why not C:** it is the only option the CLI supports for hiding files, but it breaks Production for ten of the thirteen and cannot exclude the core schema.

## 16. Can ordinary migrations run after recovery? (verified locally)
F3 shows that once every file has a row, a new migration stamped later than the ledger head applies on its own, in order, one transaction and one row each, and the integration's likely pre-check (the CLI's remote-versus-local check) passes. New files must carry versions later than `20261026120400` (the October package's last version). The integration itself is still unobserved (gate G-25).

## 17. The 13 versions: treatment under the recommendation (no ledger change made)
| # | Version | Class | Proposed treatment |
|---|---|---|---|
| 1 | `20251001051901` | S2, execution harmful | marker "effects present, not proven executed"; Production also needs a decision |
| 2 | `20251001052039` | S3 | marker "deliberately not executed"; Production also needs a decision |
| 3 | `20251001192425` | S3 | marker "deliberately not executed"; Production also needs a decision |
| 4 | `20260125173238` | S3 | marker "deliberately not executed" |
| 5 | `20260126193205` | S2, redundant | marker "effects present, not proven executed" |
| 6 | `20260224133344` | S2, execution harmful | marker "effects present, not proven executed" |
| 7 | `20260224161311` | S2, execution harmful | marker "effects present, not proven executed" |
| 8 | `20260224183629` | S2, redundant | marker "effects present, not proven executed" |
| 9 | `20260224184535` | S2, redundant | marker "effects present, not proven executed" |
| 10 | `20260305222010` | S3 | marker "deliberately not executed" |
| 11 | `20260311113547` | S2, redundant | marker "effects present, not proven executed" |
| 12 | `20260315173745` | S3 | marker "deliberately not executed"; the October file supplies the sign-up trigger |
| 13 | `20260611184401` | S3 | marker "deliberately not executed" (owner decision U-E2I-4) |
Every marker needs your signature per version. Do not request a 13-row attestation until you have accepted this strategy.

## 17b. Step 4A.7 (strategy A approved in principle)
The exact marker class, wording and fourteen-field record for each of the 13 versions, the marker SQL proposal and the two locally tested compatibility migrations are in `strategy-a-attestation-package.md`. The classes in section 17 are unchanged: 7 `effects-present-execution-unproven` and 6 `deliberately-not-executed`. Nothing is approved or recorded.

## 18. Owner decisions now supported
1. Accept strategy A (markers plus attestations) for Development, with the fresh-database management rules in section 15, and B as a later project.
2. Say whether the optional additive compatibility files (section 15, item 2) should be prepared for review.
3. Confirm that Production's #1 to #3 are a separate, later decision.
