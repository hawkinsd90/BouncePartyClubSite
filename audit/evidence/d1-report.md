# Stage D1 report: R-1 clean migration rebuild rehearsal

Branch `Dev`, HEAD `831ea9496438fd3188c954106e88f6e9d500329b`. Environment: throwaway local PostgreSQL 18.4 on `127.0.0.1:54329` (plain PostgreSQL with the replay tool's Supabase stubs). **Not Supabase.** Protected artifacts: `C:\Users\vikki\migration-evidence\d1-scratch\` (replay reports, `r1b-schema-assertions.json`, `anon-select-grants.txt`). Assertion script: `audit/evidence/tools/d1_schema_assertions.py`.

## Preflight (all confirmed)
- 386 migration files, no non-`.sql` entries. Ordered file-name list SHA-256 `8ed051c68b0eb5e2ff46a7145758a9c11ea1d35198962edca0c325f19e640d6c`; content manifest (SHA-256 of `<file sha256>  <name>` lines, C-locale order) `5d5e8b5cb7211092826524499ea98262dd61e9e423a9ca31f740f6994788e55d`.
- Case 43 `20260407211122` absent. Recovered 15: `recoveredMigrationFiles` 63 passed (hash-verified).
- C2: drop-CHECK block (line 56) < normalising UPDATE (72) < ADD CHECK (81). C4: the three October files' full hashes equal the C4 "after" hashes.
- C5: the pending-set calculator gives 386 / Production 277 recorded, 109 pending / Development 58 recorded, 329 pending, 0 findings; the two `.sql.sql` files remain visible warnings (not renamed).
- Safeguards: scratch names `bpc_replay_d1_r1a`, `bpc_replay_d1_r1b` (prefix, marker comment, loopback, `BPC_REPLAY_CONFIRM_LOCAL=yes`); `migrationReplaySafety` 144 passed; `migrationPendingSet` 54 passed.

## Commands (no credentials; `PGPSQL` points at the local PG18 `psql.exe`)
```
BPC_REPLAY_CONFIRM_LOCAL=yes node scripts/dev/migration-replay.cjs --db bpc_replay_d1_r1a --mode strict --stub-skips --report <d1-scratch>/r1a-unadjusted-strict.txt
BPC_REPLAY_CONFIRM_LOCAL=yes node scripts/dev/migration-replay.cjs --db bpc_replay_d1_r1b --mode strict --stub-skips --adjust s1,s2 --report <d1-scratch>/r1b-adjusted-strict.txt
python -I audit/evidence/tools/d1_schema_assertions.py bpc_replay_d1_r1b <d1-scratch>/r1b-schema-assertions.json
```

## R-1A: unadjusted strict (independent database). Expected failure reproduced.
- `STRICT REPLAY FAILED at 20260324175546`: line 33 `UPDATE user_roles SET role = LOWER(role) WHERE role != LOWER(role);`, `ERROR: new row for relation "user_roles" violates check constraint "user_roles_role_check"`.
- 233 files committed; the 234th (the failing one) ran in one transaction and **rolled back completely**: roles are still `CUSTOMER`/`MASTER`, the `user_roles` trigger is still enabled, and the file's `get_user_role` replacement is not present. 1 stub-limited file skipped. The final CHECK is still the legacy uppercase one. Exit code 1. This is a documented historical defect, **not** a success.

## R-1B: adjusted strict (S1 and S2 only), independent database
- `ADJUSTED REPLAY COMPLETED with 1 stub-limited file SKIPPED`: **385 files executed with zero SQL errors, 1 skipped (`20260323201502`, needs `pg_net`)**; 386 total. Exit 0.
- S1 ran after `20251207163822` (constraint present before = 1, after = 0). S2 ran before `20260615175816` (present before = 1, after = 0) and was verified afterwards (`orders` listed once). No other adjustment.
- The result shows only that the chain replays with S1 and S2. It is **not** evidence that the unmodified chain passes, and not evidence for hosted Supabase. A strict transaction cannot detect an error swallowed by an `EXCEPTION WHEN OTHERS` handler inside a migration.

## Independent final-schema assertions on R-1B (catalog queries, not the exit code): 37 PASS, 0 FAIL, 7 STUB (unverifiable)
- Role CHECK is the single canonical lowercase `master/admin/crew/customer`; FK `user_roles_user_id_fkey` -> `auth.users(id)` ON DELETE CASCADE, validated; `UNIQUE (user_id, role)` kept.
- `orders` is in `supabase_realtime` exactly once (members: `order_lot_pictures, order_pictures, order_signatures, orders, payments, task_status`).
- `auth.users` has exactly one trigger, `on_auth_user_created` -> `auto_assign_customer_role` (AFTER INSERT, row, enabled); the function is SECURITY DEFINER, `search_path=public`, service_role-only EXECUTE; `assign_role_by_email` is not executable by anon.
- `order_changelog` has only `Admin and master read/append order changelog` (authenticated); no Case 43 policy and no anon policy; RLS on.
- Each of the 23 October migrations has at least one verified effect (list in the JSON): e.g. `invoice_links.revoked_at` and its triggers (revocation trigger on `invoice_links`, expiry-sync trigger on `orders`), `orders.customer_approved_at`, RLS on all owned tables, private `order-evidence` bucket row, `site_events` locked down, payment-operation functions and four unique indexes, refund ledger default 2, `order_refunds_allocation_shape` validated, refund overview functions.
- Inventory: 68 public tables (all with RLS), 843 columns, 582 constraints, 250 indexes, 35 triggers, 116 functions, 179 public policies, 10 storage policies; the default ACL for `postgres` in `public` grants only `service_role`.
- My first assertion for `20261009120000` expected both triggers on `invoice_links`; the migration deliberately puts the expiry-sync trigger on `orders`. That was an assertion error, corrected. It is not a migration defect.

## Unverifiable with the local stub (reported, not assumed)
`pg_net` and `20260323201502` (skipped; its trigger is absent); real Supabase Auth runtime (JWT, GoTrue triggers); Storage service enforcement (stubbed `storage.*`, bucket rows only for buckets a migration inserts); Realtime delivery; platform roles and ownership and `pg_cron`; request-time RLS under PostgREST. This is also not a comparison with the Production or Development schema (that is D2).

## Observation for D2 (not a D1 failure)
37 public tables carry an `anon` SELECT privilege in the rebuilt schema: 13 have an anon SELECT policy, **24 have none** (the grant is inert under RLS but wider than minimal): `address_lot_pictures, admin_settings, admin_settings_changelog, auth_trigger_logs, blackout_addresses, blackout_contacts, blackout_dates, contact_inquiries, daily_mileage_logs, email_templates, google_calendar_sync, google_calendar_sync_queue, invoices, order_notes, order_workflow_events, pending_signups_consent, public_menu_group_categories, public_menu_groups, rate_limits, saved_discount_templates, saved_fee_templates, sms_conversations, user_consent_log, user_permissions_changelog`. Part of this comes from the stub's default privileges; compare with the Production schema in D2 before deciding whether it is a migration gap.

## Differences from the earlier C1/C2/C3 results
None. R-1A fails at the same version with the same error (234 replayed); R-1B completes with 385 replayed and 1 skipped, as in C3 (386 before Case 43 was withdrawn).

## Blockers and sufficiency for D2
No blocker found. The evidence is sufficient to proceed to Production-baseline comparison (D2) as a clean-rebuild baseline, with the stub limits above. Note for later: `migrationPendingSet.test.ts` asserts fixed counts (386 / 109 / 329) and its evidence layer should become snapshot-relative or fixture-based once reconciliation changes the numbers; I did not refactor it in D1.

Production and Development were not contacted or modified. No Docker, WSL, Supabase CLI, deployment, staging or commit.
