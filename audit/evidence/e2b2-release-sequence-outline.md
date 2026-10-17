# E2B-2 proposed release-sequence outline (conceptual)

**This is a sequencing document, not permission to run any step.** Every step below needs its own explicit authorization, a fresh read-only capture inside the 24 h freshness window, and the owner decisions D-1 to D-7. Nothing here has been run against a hosted system. The 67-version set is the rehearsed baseline; counts below follow the E2B-1 crosswalk (57 execute, 6 execute omission-tested, 3 history-only candidates, 1 owner decision).

## Order of work
| Phase | Purpose | Gate to enter | Output |
|---|---|---|---|
| 0. Decisions | Owner answers D-1 to D-7 (`e2b2-owner-decision-package.md`) | This package | Signed decisions; a frozen version list |
| 1. Read-only Production preconditions | Fresh capture of catalog and history; run the 24 preflight checks (`e1-production-preflight-queries.sql`) and the per-statement baseline queries (`e2a-prod-baseline-proof.csv`); count queries for case 41 and the data-bearing versions; confirm Production is still at history `20260928172217` with 277 recorded versions | Phase 0; separate authorization for a hosted read-only session via direct `psql` with `default_transaction_read_only=on` (no Supabase CLI) | Dated evidence file; anything that differs from the 2026-10-16 captures invalidates the manifest |
| 2. Security and deployment prerequisites | Items that must be true before Production SQL changes behavior: containment of Development stays; `customer-cancel-order` deployed with or before `20261012120000`; private-bucket consumers (signed URLs) deployed before `20261014120000` / `20261015120000`; Step 3 items (F-2 `supabase_admin` default privileges, SEC-A master password rotation, temporary `cli_login_postgres` role) resolved or explicitly accepted | Step 3 and Step 4 approvals (outside Step 2) | Written acceptance or fix for each |
| 3. History-only reconciliation (where approved) | Mark approved versions in `supabase_migrations.schema_migrations` without executing them: baseline H versions with complete proof, withdrawn or annotated cases, the three history-only candidates if D-1 B or C is chosen. Never case 43; never a P version as proven | D-3 to D-6; evidence complete for each version | A frozen, reviewed record list with markers. Executable reconciliation SQL is not created in Step 2 |
| 4. SQL execution of approved pending migrations | Apply the approved set in version order, each with its original version; 39 are older than Production's latest recorded version (`20260928172217`) | Phases 1 to 3; D-1 and D-2 answers; an approved application method for the 39 | Per-version result; stop on first error |
| 5. Edge Function and frontend compatibility | Deploy functions and frontend that match the new schema (booking creation with NULL surface, refund and invoice-link paths, private-bucket signed URLs) | Phase 4 complete and verified; Development stubs are not copied to Production | Smoke results (no payment-provider calls in Step 2) |
| 6. Post-application verification and containment | Re-capture Production catalog and compare with the D3 final assertions (37 checks) and the catalog assertions per category; verify history equals the approved list; verify no unintended pending versions remain; keep a rollback/containment note | Phases 4 and 5 | Final reconciliation report |

Order inside phases 3 and 4: bookkeeping first would be unsafe if execution later fails, so the rehearsed order is execution of the approved SQL, then history-only records for versions that stay unexecuted, unless the owner prefers the opposite for a stated reason. The E1 recommendation to do bookkeeping in the release window stands; the order inside the window is a D-7 detail.

## The 39 versions older than Production's latest recorded version
- 39 of the 67 (every Development-line version up to `20260925171210`) sort before `20260928172217`. The Supabase CLI's documented behavior (not tested here) refuses pending versions older than the latest remote version unless `--include-all` is passed.
- **`--include-all` is forbidden** for Production: it also replays the 43 baseline/alias files, re-creating closed policies, resurrecting dropped `orders.start_date` / `orders.end_date`, and overwriting live pricing and functions (audit section B, rule R4).
- **A hosted migration push command that is not limited to the approved list is equally unsafe**, because its pending list is derived from the whole repository (110 files pending on Production at the E0 count, 109 after the Case 43 withdrawal).
- The application path is unresolved (finding F-1). Concepts to evaluate in Step 4, none authorized here: applying each approved file individually with its original version and a history row written by the same transaction; or a controlled one-time process that applies the approved list and verifies the resulting history equals the list. Whatever is chosen must preserve file versions (rule R3), be limited to the frozen list, be rehearsed locally on a Production-snapshot clone first, and be preceded by a dry-run comparison of the tool's pending list with the approved list.

## Safety prerequisites (summary)
1. Fresh, dated, read-only evidence; manifest hash recorded.
2. No Development October migrations while stubs and containment stand.
3. Case 41 never executed; case 43 withdrawn; case 42 per D-4.
4. `20260722172048` per D-2 before the October booking code is deployed.
5. The 16 versions with data or dynamic statements have their preflight counts reviewed by the owner.
6. NOT VALID constraints (four) keep their validation plan from D4 (`order_refunds_operation_shape` now or later; the other three only after zero-offender counts).
7. Rollback is forward-only: migrations are not reversible by the tooling; containment means taking the application path offline or restoring from the platform backup. Confirm a backup and its restore procedure before Phase 4 (not verified in Step 2).

## Not covered
Executable SQL, a hosted manifest, scheduling, and the Step 3 security remediation are outside this stage.
