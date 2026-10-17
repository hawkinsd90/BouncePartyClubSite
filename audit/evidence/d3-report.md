# Stage D3 report: R-2b, Production-snapshot upgrade rehearsal

Branch `Dev`, HEAD `63672cd221b4cc11fb436fd7ad65444d29746960` (the four checkpoint commits are intact). Environment: throwaway local PostgreSQL 18.4 (`127.0.0.1:54329`), database `bpc_replay_d3_snapshot`. The baseline is the hash-verified Stage B Production schema-only dump (PostgreSQL 17.6, captured `2026-10-16T18:54:59Z`, dump SHA-256 `d64fd3b464de0203...`, about 4 h old at start). **No hosted system was contacted in D3.** Protected artifacts (restore log, catalogs, raw diffs, row-level register): `C:\Users\vikki\migration-evidence\d3-scratch\`.

## Verdict: D3 PASSED WITH QUALIFICATIONS
All nine pass requirements are met; the qualifications are: schema-only snapshot (no data), plain PostgreSQL without Supabase services, and one synthetic precondition row. Four release findings (section 8) must be handled before any hosted work. This is not proof of Supabase runtime compatibility.

## 1. Preflight
Branch `Dev`, HEAD `63672cd`, four local commits present; 386 migration files, Case 43 absent; recovered-migration hash tests 63/63; replay-safety 144/144; pending-set 54/54; calculator against the captured histories: 386 repository versions, Production 277 recorded / 109 pending, Development 58 / 329. D2 selected-manifest SHA-256 (`82d8797b...`) unchanged. An uncommitted `.gitignore` line (ignoring the C4 `.pyc`) belongs to another workstream and was not touched. Baseline freshness 3 h 52 min; Production manifest 24/24 files re-hashed, 0 mismatches.

## 2. Restore (details in `d3-restore-integrity-report.md`)
Faithful: all application objects (tables, columns, indexes, triggers, 68 functions with bodies/owners/SECURITY DEFINER/search_path, 199 policies, grants, publication membership, buckets) are identical to the Production capture. Differences are only PostgreSQL 18 NOT NULL constraints, platform default ACLs/extensions/roles/event triggers (521 rows, all K1). The four K2 characteristics were preserved (no `user_roles` FK; `task_status.admin_notes`/`crew_notes`; bucket `carousel-media`). The dump was replayed unmodified; allow-listed scaffolding: platform roles as NOLOGIN stubs, `extensions` schema with pgcrypto/uuid-ossp/pg_stat_statements, rebuilt publications, seeded bucket configuration, captured history rows.

## 3. Upgrade set (exact, independently verified): 67 migrations
Technically pending in Production: 109. Minus 40 baseline versions (older than Production's first recorded version) and minus cases 41/42 (`20260305203528`, `20260407203226`; related versions already recorded) = **67 = 44 Development-line + 23 October**. Case 43 absent; all 277 recorded versions excluded; S1/S2 not used. Version-and-content manifest: `d3-selected-manifest.json`, SHA-256 `6bc153aea6d21f902fd8e4f23c3ccab337265b0e442163b2a6e80ddbdd2852e4` (versions-only SHA-256 `dcebf35714e8bc422f246b94c8cb992bfe389d4c5875254b11b196d0fe73b2c1`). **39 of the 67 versions are older than Production's latest recorded version `20260928172217`** (ordering finding, section 8).

History simulation (local scratch ledger only, never hosted): start 277 captured rows; +42 rows marked `SIMULATED RECONCILIATION` (40 baseline + cases 41/42, no SQL executed); +67 rows marked `D3 EXECUTED LOCALLY` with file hashes as each migration ran; final ledger 386 rows (277 / 42 / 67). The pending-set calculator on the final ledger gives 386 recorded, 0 pending (its two alias annotations then correctly report "not pending", so `version-aliases.json` applies only before reconciliation).

## 4. Execution: 67 of 67 applied, 0 failed, 0 skipped, 0 blocked
Each file ran as one transaction (`psql -1`, stop on error), in ascending version order. 57 notices, all "does not exist, skipping" / "already exists, skipping" (e.g. `20261010110000` and `20261016120000` skipped columns that Production already has, confirming the C4 header corrections). 8 migrations changed no catalog category (data seeds or net-zero chains): `20260716151549`, `20260716152823`, `20260716173638`, `20260717012112`, `20260814113146`, `20260814114825`, `20260929161218`, `20261010110000`. Invalid indexes after upgrade: 0. Per-migration status, hashes, notices and changed categories: `d3-execution-report.json`.

## 5. Final-schema comparison (upgraded D3 schema vs the D1 clean rebuild, public + storage)
403 differences, all classified: **K1 400, K2 3, K3 0, K4 0, K5 0** (`d3-discrepancy-register.csv`, groups F1-F8; every rule's precondition was checked, none failed).

| Group | Class | Rows | Meaning |
|---|---|---|---|
| F1 | K1 | 309 | real Supabase `storage` schema (restored from the dump) versus the D1 stub |
| F2 | K2 | 2 | `task_status.admin_notes` / `crew_notes` carried through from Production |
| F3 | K1 | 54 | function bodies differ only in whitespace (Production LF vs CRLF migration files); normalised and comment-stripped digests identical |
| F4 | K1 | 17 | schema grants of platform roles/owners |
| F5 | K1 | 6 | `postgres` default ACL in public: same privileges, owner entry listed explicitly |
| F6 | K1 | 12 | platform-owned default ACLs (see finding F-2) |
| F7 | K1 | 2 | `supabase_realtime_messages_publication`, `pg_stat_statements` |
| F8 | K2 | 1 | bucket `carousel-media` |

Zero differences in **policies (189 = 189), function EXECUTE grants (274 = 274), column grants, roles, views, types**. In the public schema the only difference is the two Production-only `task_status` columns. The upgraded schema also matches D1 on every constraint, index and trigger in public, including the restored `user_roles` foreign key, the canonical lowercase role CHECK and the `on_auth_user_created` trigger.

## 6. Independent assertions on the upgraded schema (37 PASS, 0 FAIL, 7 STUB)
`d3-final-schema-assertions.json` (script `d1_schema_assertions.py`, catalog queries only): canonical role CHECK `master/admin/crew/customer` and valid cascade FK; `orders` in `supabase_realtime` exactly once; one signup trigger to `auto_assign_customer_role` (SECURITY DEFINER, `search_path=public`, service_role-only EXECUTE); `assign_role_by_email` not executable by anon; `order_changelog` has only the two staff-only policies and no Case 43 or anonymous policy; each of the 23 October migrations has a verified effect (invoice-link revocation and unique index, booking setup and confirmation functions, server-authoritative pricing trigger and functions, payment-operation functions, four unique indexes and guard trigger, refund ledger default 2, allocation constraint validated, refund overview functions, private `order-evidence` bucket); preservation of the Production-only `task_status` columns and `carousel-media`. Bucket visibility after upgrade: `lot-pictures`, `order-pictures`, `signatures`, `signed-waivers`, `physical-waivers`, `order-evidence` private; `public-assets`, `unit-images`, `carousel-media`, `event-essentials-media` public. (The STUB lines in that file keep their D1 wording; in D3 the platform *schemas* are the real definitions, but their services and runtime behaviour are still not running.)

## 7. Unsupported or unverifiable behaviour
`pg_net` and `supabase_vault` (any trigger or function using `net.*`/`vault.*`, including the skipped-in-D1 Google calendar sync path); Supabase Auth, Storage API, Realtime delivery and PostgREST runtime; request-time RLS under real JWT roles; platform role login/superuser attributes; PostgreSQL 17 versus 18 behavioural differences beyond catalog output.

## 8. Findings for the release plan (reported, not fixed)
- **F-1 ordering:** 39 of the 67 upgrade versions are older than Production's latest recorded version (`20260928172217`). The Supabase CLI's documented behaviour is to refuse such pending versions unless `--include-all`, which is forbidden here; the hosted application path must be designed separately (not tested here).
- **F-2 default privileges:** after the upgrade, `supabase_admin`'s default ACL in `public` still grants anon, authenticated and service_role full privileges on tables, sequences and functions that `supabase_admin` creates (Production state, platform-provisioned); `20261018120000` narrows only the `postgres` defaults. `postgres` defaults in `storage` likewise remain permissive. Security review item for Step 3.
- **F-3 deferred validation:** four constraints stay `NOT VALID` after the upgrade (`order_custom_fees_amount_non_negative`, `order_discounts_amounts_valid`, `order_refunds_amount_positive`, `order_refunds_operation_shape`); Production has none (only the platform's `realtime.messages_payload_exclusive`). A later VALIDATE needs clean data (D4).
- **F-4 coordinated deployment:** `20261014120000` / `20261015120000` make `signed-waivers`, `signatures`, `lot-pictures` and `order-pictures` private; consumers must already use signed URLs (`get-waiver-status`, evidence/portal functions, `src/hooks/admin/useAdminPhotos.ts`, `src/components/pending-order/LotPicturesDisplay.tsx` reference them) and the replacement `customer-cancel-order` (service-role client, no caller header) must deploy with or before `20261012120000`. The fourteen Development stubs and containment were not touched; no new dependency changing the ordering was found.
- **F-5 release decision:** `20260722172048` (header: "Dev only - do not apply to production") is in the upgrade set; it drops NOT NULL on `orders.surface` and recreates `orders_surface_check`. It executed cleanly here as authorized, but whether it belongs in the Production release remains the open owner decision (U-5).

## 9. Data-dependent behaviour requiring D4
List with line numbers: `d3-data-dependent-behaviours.md`. Main items: role normalisation, duplicate-role deletion and orphan-role deletion in `20261016120000` (and its empty-`auth.users` and vocabulary guards, which the single synthetic user satisfied); UNIQUE indexes that fail on existing duplicates (`invoice_links_one_active_portal_per_order`; payment `checkout_session`, `operation_key`, `original_payment_intent` and one-open-operation indexes); `VALIDATE CONSTRAINT order_refunds_allocation_shape` and the four NOT VALID constraints; bucket updates and inserts (`20261014120000`, `20261015123000`, `20260717110829`); pricing and default changes (`20260716231809`, `20260722102129`, ledger default 2); seed inserts (`20260716151549`, `20260716173638`); 122 DML statements inside function bodies that run only when the functions are called. **Synthetic data used in D3: exactly one `auth.users` row (`d3-synthetic-master@example.test`) and one `user_roles` master row, inserted with triggers suppressed; no Production data was used and no absence of data errors is evidence that real rows will pass.**

## 10. Pass criteria
1. Baseline restored with no unexplained material difference: met. 2. Exact set verified (67): met. 3. Every selected migration executed without an unexpected SQL error: met (67/67). 4. Catalog assertions: met (37/37). 5. Every difference classified, zero K5: met. 6. Security and permission checks where locally testable: met, with findings F-1 to F-5. 7. Unsupported behaviour listed: met. 8. Data-dependent risks documented: met. 9. No hosted environment or migration history modified: met.

## 11. D4
D4 can begin safely: it should use this restored baseline, add synthetic role/orphan/duplicate, financial, refund and invoice-link data, and decide the findings above.

## 12. Files
Created in `audit/evidence/`: `d3-report.md`, `d3-restore-integrity-report.md`, `d3-selected-manifest.json`, `d3-execution-report.json`, `d3-final-schema-assertions.json`, `d3-discrepancy-register.csv`, `d3-data-dependent-behaviours.md`, `tools/d3_restore.py`, `tools/d3_upgrade.py`, `tools/d3_catalog.py`, `tools/d3_classify.py`, `tools/d3_data_scan.py`. Modified: `audit/step2-migration-audit.md` (section AE). D1 and D2 reports unchanged.

Production and Development were not contacted or modified. No Supabase CLI, Docker, WSL, deployment, staging or commit.

## Appendix: migrations executed

| # | Version | File | Group | Status | Catalog categories changed |
|---|---|---|---|---|---|
| 1 | `20260715214053` | add_customer_view_updated_at | development-line | applied | columns |
| 2 | `20260715221828` | add_anon_insert_portal_shortlink_policy | development-line | applied | policies |
| 3 | `20260716104333` | remove_anon_portal_shortlink_insert | development-line | applied | policies |
| 4 | `20260716151458` | add_tables_chairs_inventory_schema | development-line | applied | tables, columns, constraints, indexes, triggers, policies |
| 5 | `20260716151530` | add_check_product_availability_rpc | development-line | applied | functions |
| 6 | `20260716151549` | seed_tables_chairs_data | development-line | applied | none (data/no net catalog change) |
| 7 | `20260716152447` | fix_check_product_availability_cte_ambiguity | development-line | applied | functions |
| 8 | `20260716152823` | grant_table_privileges_tc_tables | development-line | applied | none (data/no net catalog change) |
| 9 | `20260716173638` | seed_event_essentials_settings | development-line | applied | none (data/no net catalog change) |
| 10 | `20260716173644` | extend_public_business_settings_for_event_essentials | development-line | applied | functions |
| 11 | `20260716231809` | add_product_categories_and_pricing | development-line | applied | tables, columns, constraints, indexes, triggers, policies |
| 12 | `20260716231832` | fix_check_product_availability_visibility | development-line | applied | functions |
| 13 | `20260717012112` | fix_product_categories_role_grants | development-line | applied | none (data/no net catalog change) |
| 14 | `20260717110808` | fix_event_essentials_triggers_and_grants | development-line | applied | triggers |
| 15 | `20260717110829` | create_event_essentials_media_bucket | development-line | applied | policies, storage_buckets |
| 16 | `20260717111014` | add_event_essentials_transactional_rpcs | development-line | applied | functions |
| 17 | `20260717111737` | fix_reorder_categories_ambiguous_column | development-line | applied | functions |
| 18 | `20260717111803` | fix_reorder_categories_ambiguous_v2 | development-line | applied | functions |
| 19 | `20260717113131` | fix_save_product_bundle_quantity_and_missing_product | development-line | applied | functions |
| 20 | `20260717115647` | fix_save_product_bundle_integer_overflow | development-line | applied | functions |
| 21 | `20260718000744` | stage_b_pricing_eligibility_schema | development-line | applied | tables, columns, constraints, indexes, policies |
| 22 | `20260718000923` | stage_b_v2_rpcs | development-line | applied | functions |
| 23 | `20260721164853` | add_event_essentials_order_support | development-line | applied | columns, constraints |
| 24 | `20260722102129` | add_ee_only_deposit_settings | development-line | applied | columns |
| 25 | `20260722172048` | allow_null_surface_for_ee_only_orders | development-line | applied | columns, constraints |
| 26 | `20260722211023` | create_portal_short_link_rpc | development-line | applied | functions |
| 27 | `20260722212750` | create_order_portal_links | development-line | applied | tables, columns, constraints, indexes, triggers, functions, policies |
| 28 | `20260722215732` | correct_order_portal_links_security | development-line | applied | tables, indexes, functions, policies |
| 29 | `20260722230121` | harden_create_order_short_link | development-line | applied | functions |
| 30 | `20260723174017` | restore_lot_pictures_storage_policies | development-line | applied | policies |
| 31 | `20260723210301` | fix_notification_channel_and_portal_link_policies | development-line | applied | columns, policies |
| 32 | `20260723210953` | fix_short_link_search_path_and_notification_message_type | development-line | applied | columns, functions |
| 33 | `20260814113146` | grant_contact_inquiries_service_role | development-line | applied | none (data/no net catalog change) |
| 34 | `20260814114825` | upgrade_contact_inquiries_for_invoices | development-line | applied | none (data/no net catalog change) |
| 35 | `20260814120000` | create_contact_inquiries | development-line | applied | tables, columns, constraints, indexes, policies |
| 36 | `20260814120100` | ensure_contact_inquiries_invoice_fields | development-line | applied | columns |
| 37 | `20260820165646` | add_how_did_you_hear_enabled_setting | development-line | applied | functions |
| 38 | `20260925151621` | add_setup_fee_cents_to_orders | development-line | applied | columns, constraints |
| 39 | `20260925171210` | add_event_essentials_setup_minimum_cents | development-line | applied | columns, constraints |
| 40 | `20260929145842` | add_public_menu_groups | development-line | applied | tables, columns, constraints, indexes, triggers, functions, policies |
| 41 | `20260929151836` | correct_menu_groups_security_and_atomicity | development-line | applied | functions, policies |
| 42 | `20260929152006` | fix_menu_groups_atomic_associations | development-line | applied | functions |
| 43 | `20260929161218` | grant_menu_groups_authenticated_access | development-line | applied | none (data/no net catalog change) |
| 44 | `20260929161925` | fix_menu_groups_lowercase_role_policies | development-line | applied | policies |
| 45 | `20261007120000` | harden_payment_rpc_authorization | october | applied | functions |
| 46 | `20261008120000` | restrict_role_and_admin_rpc_exposure | october | applied | tables, functions |
| 47 | `20261009120000` | secure_customer_portal_links | october | applied | columns, indexes, triggers, functions |
| 48 | `20261010110000` | add_customer_approval_timestamp | october | applied | none (data/no net catalog change) |
| 49 | `20261010120000` | secure_public_booking_creation | october | applied | tables, columns, constraints, indexes, functions |
| 50 | `20261011120000` | order_event_address_line2 | october | applied | columns, functions |
| 51 | `20261012120000` | core_database_access_lockdown | october | applied | tables, functions, policies |
| 52 | `20261013120000` | restrict_remaining_public_database_access | october | applied | tables, functions, policies |
| 53 | `20261014120000` | protect_waiver_media_and_restrict_storage_access | october | applied | policies, storage_buckets |
| 54 | `20261015120000` | protect_customer_order_photos | october | applied | policies, storage_buckets |
| 55 | `20261015123000` | create_private_order_evidence_storage | october | applied | policies, storage_buckets |
| 56 | `20261016120000` | repair_role_assignment_and_signup_provisioning | october | applied | constraints, functions |
| 57 | `20261017120000` | add_booking_confirmation_claim | october | applied | columns, functions |
| 58 | `20261018120000` | restrict_future_database_privileges | october | applied | default_acls |
| 59 | `20261018120100` | secure_site_event_ingestion | october | applied | tables, policies |
| 60 | `20261018120200` | restrict_role_lookup_and_profile_ownership | october | applied | tables, columns, functions |
| 61 | `20261019120000` | add_payment_operations_and_single_financial_application | october | applied | columns, constraints, indexes, triggers, functions |
| 62 | `20261020120000` | deposit_catch_up_and_offline_payment_parity | october | applied | constraints, functions |
| 63 | `20261021120000` | server_authoritative_order_pricing_saves | october | applied | tables, columns, constraints, triggers, functions, policies |
| 64 | `20261022120000` | refund_safety_and_financial_write_authority | october | applied | tables, columns, constraints, indexes, triggers, functions, policies |
| 65 | `20261023120000` | refund_allocation_schema | october | applied | columns, constraints, functions |
| 66 | `20261024120000` | refund_allocation_reservation | october | applied | functions |
| 67 | `20261025120000` | refund_overview_for_admin | october | applied | functions |
