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
Owner reads this table and states, per version, which of S2-attest, S3-never-execute or A8-execute applies (or "need evidence"). Nothing is recorded until then.
