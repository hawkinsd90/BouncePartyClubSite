# E2B-2 owner decision package

**Nothing here is a decision, an approval or an instruction to execute.** Every recommendation is mine and needs your explicit answer. Decision identifiers and titles are those of `e2b1-owner-decision-options.md` (D-1 to D-7); I did not renumber them. Evidence is from the Stage B captures (Production 2026-10-16 18:54:59 UTC, Development 18:55:20 UTC), the repository, and local scratch rehearsals; no hosted system was contacted in E2B-2. The 67-version D3/D4 set stays the rehearsal baseline; no decision below changes it unless you choose a shortened option.

## 1. Authoritative per-version treatment (67 versions)
Source: `e2b1-production-execution-crosswalk.csv`, re-verified in E2B-2 by `tools/e2b2_build.py` (67 unique versions in version order, each present in `e2a-proposed-actions.csv` and `e1-reconciliation-readiness.csv`; manifest counts 67 upgrade / 109 pending; 39 versions older than `20260928172217`). Verified breakdown: **57 execute + 6 execute (omission-tested) + 3 history-only candidates + 1 owner decision = 67.** The table lists each version separately; "proposed" is a proposal, not an approval, and "history-only" means a record without execution, never "already executed".

| # | Version | File (after timestamp) | E2A | Proposed treatment | Absent from Production | Data/dynamic | Confidence |
|---|---|---|---|---|---|---|---|
| 1 | `20260715214053` | add_customer_view_updated_at | X | execute | yes | none | high |
| 2 | `20260715221828` | add_anon_insert_portal_shortlink_policy | H | history-only candidate (D-1/D-6) | no | none | high |
| 3 | `20260716104333` | remove_anon_portal_shortlink_insert | H | history-only candidate (D-1/D-6) | no | none | high |
| 4 | `20260716151458` | add_tables_chairs_inventory_schema | X | execute | yes | none | high |
| 5 | `20260716151530` | add_check_product_availability_rpc | P | execute (omission-tested, section 1.2) | yes | none | medium |
| 6 | `20260716151549` | seed_tables_chairs_data | P | execute | no | data: INSERT admin_settings... | medium |
| 7 | `20260716152447` | fix_check_product_availability_cte_ambiguity | P | execute | yes | none | high |
| 8 | `20260716152823` | grant_table_privileges_tc_tables | X | execute (omission-tested, section 1.2) | yes | none | medium |
| 9 | `20260716173638` | seed_event_essentials_settings | P | execute | no | data: INSERT admin_settings | medium |
| 10 | `20260716173644` | extend_public_business_settings_for_event_essentials | P | execute (omission-tested, section 1.2) | yes | none | medium |
| 11 | `20260716231809` | add_product_categories_and_pricing | P | execute | yes | data: INSERT product_categor... | medium |
| 12 | `20260716231832` | fix_check_product_availability_visibility | X | execute | yes | none | high |
| 13 | `20260717012112` | fix_product_categories_role_grants | X | execute | yes | none | high |
| 14 | `20260717110808` | fix_event_essentials_triggers_and_grants | P | execute | yes | none | high |
| 15 | `20260717110829` | create_event_essentials_media_bucket | P | execute | yes | none | high |
| 16 | `20260717111014` | add_event_essentials_transactional_rpcs | P | execute | yes | none | high |
| 17 | `20260717111737` | fix_reorder_categories_ambiguous_column | P | execute (omission-tested, section 1.2) | yes | none | medium |
| 18 | `20260717111803` | fix_reorder_categories_ambiguous_v2 | P | execute | yes | none | high |
| 19 | `20260717113131` | fix_save_product_bundle_quantity_and_missing_product | P | execute (omission-tested, section 1.2) | yes | none | medium |
| 20 | `20260717115647` | fix_save_product_bundle_integer_overflow | P | execute | yes | none | high |
| 21 | `20260718000744` | stage_b_pricing_eligibility_schema | P | execute | yes | none | high |
| 22 | `20260718000923` | stage_b_v2_rpcs | X | execute | yes | none | high |
| 23 | `20260721164853` | add_event_essentials_order_support | X | execute | yes | none | high |
| 24 | `20260722102129` | add_ee_only_deposit_settings | X | execute | yes | data: UPDATE pricing_rules | medium |
| 25 | `20260722172048` | allow_null_surface_for_ee_only_orders | X | owner decision (D-2) | yes | none | high |
| 26 | `20260722211023` | create_portal_short_link_rpc | X | execute | yes | none | high |
| 27 | `20260722212750` | create_order_portal_links | P | execute | yes | none | high |
| 28 | `20260722215732` | correct_order_portal_links_security | P | execute | yes | none | high |
| 29 | `20260722230121` | harden_create_order_short_link | P | execute | yes | none | high |
| 30 | `20260723174017` | restore_lot_pictures_storage_policies | P | execute | yes | none | high |
| 31 | `20260723210301` | fix_notification_channel_and_portal_link_policies | X | execute | yes | none | high |
| 32 | `20260723210953` | fix_short_link_search_path_and_notification_message_type | X | execute | yes | none | high |
| 33 | `20260814113146` | grant_contact_inquiries_service_role | P | execute | no | dynamic: DO | medium |
| 34 | `20260814114825` | upgrade_contact_inquiries_for_invoices | X | execute (omission-tested, section 1.2) | yes | none | medium |
| 35 | `20260814120000` | create_contact_inquiries | P | execute | yes | none | high |
| 36 | `20260814120100` | ensure_contact_inquiries_invoice_fields | X | execute | yes | none | high |
| 37 | `20260820165646` | add_how_did_you_hear_enabled_setting | P | execute | yes | none | high |
| 38 | `20260925151621` | add_setup_fee_cents_to_orders | X | execute | yes | none | high |
| 39 | `20260925171210` | add_event_essentials_setup_minimum_cents | X | execute | yes | none | high |
| 40 | `20260929145842` | add_public_menu_groups | P | execute | yes | none | high |
| 41 | `20260929151836` | correct_menu_groups_security_and_atomicity | P | execute | yes | none | high |
| 42 | `20260929152006` | fix_menu_groups_atomic_associations | X | execute | yes | none | high |
| 43 | `20260929161218` | grant_menu_groups_authenticated_access | X | execute | yes | none | high |
| 44 | `20260929161925` | fix_menu_groups_lowercase_role_policies | P | execute | yes | none | high |
| 45 | `20261007120000` | harden_payment_rpc_authorization | X | execute | yes | dynamic: DO | medium |
| 46 | `20261008120000` | restrict_role_and_admin_rpc_exposure | X | execute | yes | dynamic: DO | medium |
| 47 | `20261009120000` | secure_customer_portal_links | X | execute | yes | none | high |
| 48 | `20261010110000` | add_customer_approval_timestamp | X | history-only candidate (D-1/D-6) | no | none | high |
| 49 | `20261010120000` | secure_public_booking_creation | X | execute | yes | none | high |
| 50 | `20261011120000` | order_event_address_line2 | X | execute | yes | none | high |
| 51 | `20261012120000` | core_database_access_lockdown | X | execute | yes | dynamic: DO... | medium |
| 52 | `20261013120000` | restrict_remaining_public_database_access | X | execute | yes | dynamic: DO... | medium |
| 53 | `20261014120000` | protect_waiver_media_and_restrict_storage_access | X | execute | yes | dynamic: DO... | medium |
| 54 | `20261015120000` | protect_customer_order_photos | X | execute | yes | dynamic: DO... | medium |
| 55 | `20261015123000` | create_private_order_evidence_storage | X | execute | yes | dynamic: DO | medium |
| 56 | `20261016120000` | repair_role_assignment_and_signup_provisioning | X | execute | yes | dynamic: DO... | medium |
| 57 | `20261017120000` | add_booking_confirmation_claim | X | execute | yes | none | high |
| 58 | `20261018120000` | restrict_future_database_privileges | X | execute | no | dynamic: DO | medium |
| 59 | `20261018120100` | secure_site_event_ingestion | X | execute | yes | dynamic: DO | medium |
| 60 | `20261018120200` | restrict_role_lookup_and_profile_ownership | X | execute | yes | dynamic: DO | medium |
| 61 | `20261019120000` | add_payment_operations_and_single_financial_application | X | execute | yes | none | high |
| 62 | `20261020120000` | deposit_catch_up_and_offline_payment_parity | X | execute | yes | none | high |
| 63 | `20261021120000` | server_authoritative_order_pricing_saves | X | execute | yes | none | high |
| 64 | `20261022120000` | refund_safety_and_financial_write_authority | X | execute | yes | none | high |
| 65 | `20261023120000` | refund_allocation_schema | X | execute | yes | none | high |
| 66 | `20261024120000` | refund_allocation_reservation | X | execute | yes | none | high |
| 67 | `20261025120000` | refund_overview_for_admin | X | execute | yes | none | high |

### 1.1 The three history-only candidates
| Version | Executable effect | Evidence supporting no execution | Risk of marking it reconciled |
|---|---|---|---|
| `20260715221828` | `CREATE POLICY "Anon can insert portal shortlinks" ON public.invoice_links FOR INSERT TO anon, authenticated WITH CHECK (link_type = 'portal_shortlink' AND deposit_cents = 0)` | Production has no such policy (catalog: superseded); its removal is the next version; D3/D4 and the E2B-1 rehearsal show the final catalog is identical with or without the pair | **Executing it alone would open an anonymous INSERT policy on a payment-link table.** It must never be executed without `20260716104333`, and the two must be treated together |
| `20260716104333` | `DROP POLICY IF EXISTS "Anon can insert portal shortlinks" ON public.invoice_links` | Production does not have the policy (present: policy absent is the intended end state); guarded by IF EXISTS | The row says nothing about whether the policy ever existed in Production; a record could be read as "applied". Needs the D-6 marker |
| `20261010110000` | `ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_approved_at timestamptz` | Production already has the column from recorded `20251126190624`; the statement is guarded and changes nothing; its own comment says it only ensures the column exists | Production's column definition was matched by name and type in the catalog, not byte-for-byte against this file; if the live definition were different the no-op would hide it (E2A found it present). Also it is an October file, which is otherwise "pending by design", so a record changes the "23 October pending" count |

### 1.2 The six omission-tested versions: catalog equivalence is not the same as data or intermediate-state equivalence
`20260716151530`, `20260716152823`, `20260716173644`, `20260717111737`, `20260717113131`, `20260814114825`. Every one has effects absent from Production, but every effect is replaced by a later selected version (listed in the crosswalk column `intermediate_effects_replaced_by`).
- **Catalog equivalence (shown):** omitting each alone, or all six with the three history-only versions (58 versions), gave zero differences across the 19 catalog categories against the full 67-version result.
- **Data equivalence (limited):** none of the six contains a data statement (crosswalk `data_dependent_or_unprovable` = none), and the synthetic row digests were identical. This says nothing about real Production rows because no omitted file touches rows; it is a statement about these six files only.
- **Intermediate-state equivalence (not shown):** when the six run, they create states that later versions replace, for example `20260716152823` grants table privileges to `anon` and `authenticated` on product tables until `20260717012112` / `20260717110808` supersede them, and `20260814114825` touches `contact_inquiries` before `20260814120000` creates it (guarded, so it does nothing in Production). Omission removes those transient states; execution recreates them. Both end the same, but a run interrupted midway would stop in different states, and the rehearsal did not test interruption.
- **Dependency edges:** the analyzer lists later versions that follow `20260716151530` and `20260716173644`, yet the sequences without them applied; the edges are ordering relations, not requirements.
This is why the baseline still executes them: the sequence is the one fully rehearsed (D3, 4 D4 datasets, 5 failure fixtures), and omission buys minutes.

## 2. Decisions D-1 to D-7

### D-1. Should the Production upgrade execution set stay at 67 versions?
- **Question:** Do you approve the 67-version set as the proposed execution basis, or a shortened one?
- **Affected versions:** all 67; specifically the three history-only candidates and the six omission-tested versions (nine in total).
- **Evidence:** section 1; `e2b1-report.md` section 5 (64, 58 and per-version omissions all apply and match the full catalog and synthetic data digests).
- **Choices and consequences:** **A. Keep 67** (all 67 executed as rehearsed, the three history-only candidates included as harmless executions; `20260722172048` remains subject to D-2): the rehearsed sequence, no new risk, three no-op steps remain. Note the crosswalk's "history-only" proposal for those three is an option within D-1/D-6, not part of option A. **B. 64** (record the three, execute 64): shorter by three; requires D-6 records and a changed manifest; D4 failure and data scenarios were run on 67. **C. 58** (record nine): saves little, loses the audit trail, needs nine records.
- **Recommendation:** A, because the rehearsal evidence is strongest for it and the saving is small.
- **Prerequisite evidence:** the 24 read-only Production preflight checks (not yet run) regardless of choice.
- **Production / Development:** Production: A changes nothing; B and C shrink the executed set. Development: not affected (Development already holds the effects of all 67 except the October group; its path is D-7).
- **Changes the 67-version baseline?** A: no. B and C: yes, they would create a second rehearsal baseline.
- **More local testing?** A: none. B and C: rerun the D4 data scenarios and the five failure fixtures on the shortened sequence.

### D-2. `20260722172048_allow_null_surface_for_ee_only_orders` (U-5)
- **Question:** Is this migration included in Production's eventual upgrade?
- **Affected versions:** `20260722172048` only.
- **Evidence:** header: "Dev only - do not apply to production". Effects absent in Production (`orders.surface` NOT NULL, old CHECK). `bookingBuild.ts` line 271 sends `surface: null` when the booking has no inflatables; `create_booking_request` (`20261010120000`, `20261011120000`) inserts `v_order->>'surface'`; local test: NOT NULL violation without the migration, accepted with it. The other 66 apply without it. Staff saves map a missing surface to `'grass'` and do not depend on it.
- **Choices:** **include** (Event-Essentials-only bookings work); **exclude and change booking code** (application change outside Step 2, re-adds the placeholder); **replace with a new Production-reviewed migration** (new version, same effect, Development still needs a separate treatment of the old one); **defer** (the October booking code would ship while such bookings fail).
- **Recommendation: include.** The "Dev only" header was written before the booking path made NULL a normal value for Event-Essentials-only orders; the October release now requires it. Confirm the author's intent was rollout order, then correct the header in a separately authorized documentation change. Do not edit the SQL or metadata now.
- **Prerequisite:** confirm that Event-Essentials-only bookings are meant to be offered; read-only check that no Production consumer needs the old placeholder (queries in `e1-production-preflight-queries.sql`).
- **Production / Development:** Production: gains nullable `surface` and the new CHECK (brief ACCESS EXCLUSIVE lock on `orders`). Development: already has it; nothing to do.
- **Changes the baseline?** No for include; exclude or replace would change the 67.
- **More local testing?** None for include; replace needs a new rehearsal.

### D-3. Case 41 `20260305203528_add_customer_payment_amount`
- **Question:** How is this version resolved in the history?
- **Affected:** `20260305203528`; related recorded `20260305205811`.
- **Evidence:** identical ADD COLUMN statements; different backfill (always `'deposit'` versus `CASE 'full'/'deposit'`). Local test (13 synthetic orders with NULL selection): 13 `'deposit'` versus 12 `'deposit'` + 1 `'full'`; both rewrite every NULL row. Executing it can change real payment-selection data.
- **Choices:** **withdraw before application** (as Case 43; no history row; repository 1:1 with history; changes a file in `main`); **annotated reconciliation record** (marked "superseded draft, not executed, never run"; the file stays; a record of a SQL never run requires the D-6 convention); **leave unreconciled** (always pending, blocks a clean pending-set).
- **Recommendation: withdraw**, if Development never applied it. Never execute it merely to close history.
- **Prerequisite:** Development provenance (was `20260305203528` ever applied there?) and the Production NULL-selection count (read-only).
- **Production / Development:** Production: no execution either way. Development: if it was never applied, the same treatment; if it was, the Development row needs a separate annotation.
- **Baseline change?** None (not in the 67). **More testing?** None.

### D-4. Case 42 `20260407203226_add_refund_requested_to_orders`
- **Question:** Record it as reconciled or withdraw the duplicate?
- **Evidence:** executable SQL identical to recorded `20260408200431` (digest `23fa13ed…`); body guarded; execution is a no-op. Filename similarity alone was not used: the equivalence rests on the digest.
- **Choices:** **annotated record** ("identical to 20260408200431") keeps both files; **withdraw the duplicate** keeps the repository 1:1; **execute** (harmless but adds a no-op).
- **Recommendation: withdraw the duplicate**, unless you want to keep a file you consider historically meaningful, in which case an annotated record. Either is truthful.
- **Prerequisite:** optional read of the recorded `statements` text for both versions (`e2a-unresolved-evidence.md` D) to settle the `COMMENT ON COLUMN` wording.
- **Production / Development:** Production: no execution; Development: check whether it has a row for either version.
- **Baseline change?** No. **More testing?** None.

### D-5. Development alias `20260814002658` vs `20260814120000`
- **Question:** How is the recorded Development version tied to the repository file?
- **Evidence:** recorded name column holds `20260814120000_create_contact_inquiries.sql`; normalized digest `c2fd5486…` and comment-free digest `faa9f2b1…` equal the file's. DDL only (table, index, RLS, one drop/create of policies), no data effects. Recorded `stmt_count` 6 versus 5 by my splitter (splitter difference, digests equal). Precedent: commit `ce5637b` aligned 22 other recorded files. This is the only recorded mismatch remaining. Rename rehearsed: file moved before `20260814113146` still applies all 67 and matches the catalog and data digests.
- **Choices:** **rename the repository file** to the recorded version (changes the file's order of application: it would then run before `20260814113146` / `20260814114825`, which currently run before the table exists; Production has recorded neither); **alias record** on Development for `20260814120000` (history-only, marked); **leave both** (pending-set keeps showing the alias).
- **Recommendation: rename**, after your approval, as the precedent did. The safest history treatment until then: change nothing; Development already holds the effect and Production has recorded neither version.
- **Prerequisite:** none beyond approval; optionally read the recorded statements text.
- **Production / Development:** Production: the file executes at its new position; no data difference; the ordering defect `20260814120100` works around disappears. Development: its row becomes the file's identity.
- **Baseline change?** Rename changes the order within the 67 (rehearsed identical). **More testing?** None beyond a rerun of the order check if you want it recorded again.

### D-6. History records for versions that are not executed
- **Question:** Which versions are recorded without execution, and with what marker?
- **Affected:** the three history-only candidates; withdrawn or annotated cases (41, 42, 43 stays withdrawn); the 24 baseline versions of class H and the 16 of class P once proof is complete; Development equivalents.
- **Evidence:** schema equivalence is not execution proof. Baseline: 24 H (effects present or superseded) and 16 P: 15 carry 25 unprovable data statements (`20251001051901`, `20251001052039`, `20251001192425`, `20251002180149`, `20251002210020`, `20251003152224`, `20251003170350`, `20251003182356`, `20251003183947`, `20251007210840`, `20251007220415`, `20251007221227`, `20251007221817`, `20251008144308`, `20251008153245`) and one (`20251001051900`) has absent constraints explained by drift.
- **Choices:** **marked history-only record** per version only where proof is complete; **qualified owner attestation** for data effects that cannot be shown; **withdraw** for superseded drafts; **leave unreconciled**.
- **Recommendation:** marked records with an explicit statements-column marker ("history-only: not executed by Supabase; <basis>"), after the read-only queries for the 15 data versions; the attestation only for what no query can show. P versions must not be recorded as proven.
- **Prerequisite evidence:** `e2a-prod-baseline-proof.csv` queries; `e2a-unresolved-evidence.md` sections A and C.
- **Production / Development:** Production: 40 baseline records pending proof; Development: 306 pre-October files (209 H, 89 P, 5 X, 3 I), same rule.
- **Baseline change?** No. **More testing?** None locally; the bookkeeping method itself is untested.

### D-7. Timing, scope and release path
- **Question:** When is bookkeeping done, is Development reconciled at all before Step 4, and how are the 39 older versions applied?
- **Evidence:** 24 h evidence freshness; 39 of the 67 older than Production's latest recorded version; CLI refuses these without `--include-all` (forbidden); Development containment and 14 stubs must stay; `supabase_admin` default privileges (F-2) is Step 3.
- **Choices:** bookkeeping in the release window (recommended) or earlier; Development reconciled after Production (recommended) or before; per-version application path to be designed in Step 4.
- **Recommendation:** release window; Production first; no October migration on hosted Development until the coordinated release and the stubs are replaced.
- **Production / Development:** separate (section 3 of `e2b2-report.md`).
- **Baseline change?** No. **More testing?** The Step 4 application path needs its own local rehearsal.
