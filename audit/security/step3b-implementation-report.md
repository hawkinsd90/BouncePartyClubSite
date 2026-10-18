# Step 3B implementation report (local; nothing committed, pushed or deployed)

Date 2026-10-17. Branch `Dev`, HEAD `54b71e9`, working tree uncommitted. No hosted database, Edge Function, Netlify site, Git remote or secret was changed. One read-only catalog SELECT ran against Production in Step 3A; Step 3B contacted no hosted system.

Status labels follow the owner's list. "Fixed locally" is **not** deployed: every item still needs the Step 4 rollout, and Production stays exposed until its own release.

## 1. How it was tested (and what was skipped)

A fresh scratch PostgreSQL (127.0.0.1:54329, in the session scratchpad) holds throw-away databases built by `scripts/dev/security-scratch.cjs` and `audit/evidence/tools/step3b_shapes.py`:

| Database shape | Built from | Used for |
|---|---|---|
| repository chain, several cut points | `scripts/dev/migration-replay.cjs` strict replay | existing suites that apply their own migration text; final posture |
| Production-shaped | restored Production schema snapshot (277-row ledger) + the 67 upgrade files, then + the 5 Step 3B files | release-final behaviour on the real Production grants, defaults and policies |
| Development-shaped | restored Development schema snapshot (58-row ledger, containment on) + the 2 bucket files + the 23 October files, then the containment end state, then + the 5 Step 3B files | Development grants (`service_role` denied), containment |

The final review run executed **132 of 132 runs (every test file once, plus the database suites re-run on the Production-shaped, Development-shaped and pre-Step-3B databases), 0 failed, 0 skipped layers** (`CORE_DB_REQUIRE`, `ROLE_DB_REQUIRE`, `HARD_DB_REQUIRE` set, so a missing database fails instead of skipping). The Production- and Development-shaped databases need the protected Stage B captures that live outside Git; on a machine without them `step3bMigrationPlan` reports those shapes as SKIPPED (or fails with `STEP3B_SHAPES_REQUIRE=1`).

## 2. Baseline before each remediation (securityPosture, same 93 checks on every shape)

| Shape | Before Step 3B | After |
|---|---|---|
| repository chain (stub with hosted-style grants) | 14 failed | 93 passed |
| Production-shaped (real snapshot + October) | 14 failed | 93 passed |
| Development-shaped (real snapshot + October, containment lifted) | 11 failed | 93 passed |

The failures before are the findings: anon table privileges on `admin_settings` and 22 other tables; anon INSERT/SELECT/UPDATE/DELETE on the signup-consent table; anon **setval** returning success on both sequences (Production-shaped and repository chain); a signed-in customer able to setval the ledger sequence; one unpinned SECURITY DEFINER function; no crew `task_status` INSERT and no receipt UPDATE policy; staff able to rewrite the booking-confirmation claim. On the Development shape `service_role` could read 0 of the 8 catalog tables before and 8 after (`step3bMigrationPlan`).

Other baseline findings (test debt, no authorization expectation relaxed): the `coreDatabaseAccess` and `databaseFunctionAccessClassification` assertions were stale against the recovered migrations (SEC-042, SEC-043); `databaseHardening` seeded a `display_name` column that the recovered `20251229223230` drops (616 failures that were fixture debt); the classification fixture re-created `billing_addresses` and `get_booking_sources_analytics`, now created by recovered files; scratch databases carried seed rows (the demo account) that exact-count scenarios do not expect; `paymentOperations` pinned "newest migration".

## 3. Previously committed fixes, now verified by executing them

| Issues | Commit(s) | Executed evidence |
|---|---|---|
| SEC-001, 002, 003 | 6a9e63b, ad69b5d | `coreDatabaseAccess` 707; posture on all shapes: no `orders` policy for public/anon, 0 open "service role" policies, only the signup-consent table anon-writable. Production-shaped baseline showed the open `orders` policy and full anon privileges; after October the surface is gone |
| SEC-006 to 009 | 7c63edf, 91da72a, 22377fe | `roleAssignment` 489, `databaseHardening` 637, posture (role grants, own-role lookup, contact_id) |
| SEC-010 | 2887507 to 22377fe | no residual: anon-executable functions equal the 5-function allow-list on all three shapes (Production-shaped 68 before October to the 5-name allow-list, 6 functions counting an overload) |
| SEC-011 to 013 | 7c63edf, ad69b5d, 2887507 | `adminAccessHardening` 83, `databaseFunctionAccessClassification` 350, `paymentRpcHandlerAuthorization` 246 |
| SEC-018, 019 | dfffd8f, 36121ae | `privateMediaAccess` 316, `customerPhotoAccess` 399, `waiverAuthorization` 157, `orderEvidenceAccess` 448; buckets private on all shapes |
| SEC-022 | 84cdc3e | `fixPaymentMethodAuthorization` 30 |
| SEC-030 | 4cc55b3 | `notificationRelayAuthorization` 399, `outboundGuard` 105 |
| SEC-033 | b75cd30, b1b001e | `customerPortalAccess` 434, `portalLinks` 217 |
| SEC-034 | b14fbd9 .. 00b900d | `paymentOperations` 868, `refundSafety` 433, `refundAllocation` 260, `paymentCharging` 429, `staffOrderSave` 278; posture: staff cannot write `payments` or order subtotals |

Correction to the Step 2 handoff: `e2k-security-handoff.md` says no October file drops "Service role full access to orders". `20261012120000` section 2 drops every policy on `orders`; the executed tests prove it.

## 4. New corrective migrations (forward-only, idempotent, applied twice without error)

| File | Issues | Effect |
|---|---|---|
| `20261026120000_restrict_sequence_and_anon_table_privileges.sql` | SEC-014, 039, 037 | anon loses every sequence privilege; authenticated loses `setval`; anon table privileges removed where no anon/public policy exists (signup-consent keeps INSERT only); the one unpinned SECURITY DEFINER function gets a search_path |
| `20261026120100_grant_service_role_catalog_read.sql` | SEC-016 | `GRANT SELECT` on exactly the 8 Event Essentials catalog tables to `service_role`; tables that do not exist are skipped |
| `20261026120200_restore_crew_task_and_receipt_access.sql` | SEC-036 | Crew `task_status` INSERT policy; Admin `transaction_receipts` UPDATE policy |
| `20261026120300_guard_booking_confirmation_columns.sql` | SEC-047 (SEC-035 part) | BEFORE trigger rejects browser-role writes to the three confirmation columns of `orders` |
| `20261026120400_restrict_supabase_admin_default_privileges.sql` | SEC-015 | removes anon/authenticated from `supabase_admin` default privileges in `public`; a role without the right gets a NOTICE and the migration still succeeds |

Not a migration: `audit/security/step4-development-containment-end-state.sql` (SEC-017). Containment was **not** touched; the script is tested on the Development-shaped database and runs last in Step 4.

## 5. Edge Functions changed (source only; none deployed)

| Function | Change |
|---|---|
| `twilio-webhook`, `twilio-status-callback` (+ new `_shared/twilio-signature.ts`) | `X-Twilio-Signature` HMAC-SHA1 check before any write; fails closed when the token is missing; status callback `verify_jwt` false |
| `get-session-metadata`, `get-payment-method`, `create-order-short-link` | retired to HTTP 410 after confirming no caller in `src`, `supabase/functions`, `supabase/migrations`, `scripts` or docs code |
| `sync-google-calendar` | service role or Admin/Master only |
| `send-error-notification`, `_shared/rate-limit.ts` | HTML-escaped, length-capped, server timestamp, per-address and global limits, no provider error echoed |
| `checkout-bridge` | postMessage target limited to the Stripe return-origin allow-list; script data cannot close the script |
| `supabase/config.toml` | every function has an explicit `verify_jwt`; `get-session-metadata` true; `twilio-status-callback` false |

## 6. Application and tooling changes

`src/App.tsx` + `src/lib/core/safeInternalPath.ts` (open redirect through `?next=`, SEC-048); `MessageTemplatesTab.tsx` (sandboxed iframe preview, SEC-045); `src/contexts/BusinessContext.tsx` (a signed-out visitor's refused `admin_settings` read no longer aborts loading the public address); `vite.config.ts` + `scripts/dev/production-backend-guard.mjs` (dev and preview servers refuse the Production project, SEC-041; verified with the real Vite CLI, builds unaffected); `scripts/SyncDevDataFromProd/lib/config.mjs` (the new trigger is a reviewed trigger).

## 7. Step 2 compatibility

The committed generators reproduced all 388 Development and 387 Production rows byte for byte, then appended the five Step 3B rows (Development phase P5, Production group `step3b`, no `plan_order`, chained after `20261025120000`). Unchanged: the 259-operation execution manifest, the deny list, the 58-item executor allowlist input and `production-verification-rules.json`. Manifest tests and `migrationPendingSet` were updated for 393/392 rows and 112/332 pending versions. Read-only pre/post checks for the five files: `step3b-verification-rules.json`, run by `step3bMigrationPlan` on every shape. No applied migration was edited (checked against `HEAD`).

## 8. Mutation check of the new controls

Fourteen mutants (Twilio verification skipped or accepting any signature, calendar gate bypassed, wildcard origin, unescaped message, each of the two rate limiters removed, a retired endpoint un-retired, dev-server guard disabled, guard trigger disabled, sequence revoke removed, backslash check removed): 13 killed. A first run let the rate-limit mutant survive because the test denied both buckets at once; the test now denies each bucket alone and kills both mutants. The remaining survivor is an equivalent mutant: removing the explicit backslash check in `safeInternalPath` changes nothing because the URL parser already resolves such a path to a foreign origin, which the origin check rejects; the explicit check stays as a second line.

## 9. Business compatibility

| Workflow | Tested locally | Still needs hosted Development |
|---|---|---|
| Residential / commercial bookings | `publicBookingSecurity` 355, `bookingConfirmationClaim` 196, `orderEventAddress`, quote suites; claim functions still work for the service role | real `create-booking` run after the grant migration |
| Bounce house and Event Essentials orders | catalog read grants (8/8); pricing suites | Event Essentials browser journey |
| Checkout, deposits, card on file, admin charging | `paymentOperations` 868, `paymentCharging` 429; unauthorized callers rejected with zero provider calls | Stripe test-mode charge, saved card |
| Refunds | `refundSafety` 433, `refundAllocation` 260 | Stripe test-mode refund |
| Admin invoices | `staffOrderSave` 278; staff cannot write money tables | `staff-order-save` deployed |
| Customer portal, short links | `customerPortalAccess` 434, `portalLinks` 217 | emailed link, expiry on Development |
| Waiver signing, delivery/pickup photos | waiver, media, photo, evidence suites; buckets private | signed-URL reads in the browser |
| Crew tasks and receipts | posture: crew creates task rows; admin sets receipt flag; others refused | crew screens end to end |
| SMS and email | relay, outbound-guard and failure-recording suites; Twilio signature tests with mocked requests | real signed Twilio test message; sandbox recipients only |
| Signed-out visitor pages | availability and settings RPCs work for anon; BusinessProvider tolerates the refused read | public site on Development |

Risks that remain: applying the October migrations before their Edge Functions and frontend breaks parts of the apps (Step 2 dependency order stands); the confirmation-column guard blocks any browser-side write of those columns (none exists in `src`); the anonymous privilege sweep turns a signed-out read of a private table into an error instead of an empty result (checked all frontend readers: only `BusinessContext` was reachable by visitors, now tolerant).

## 10. New findings during Step 3B

- SEC-047 staff could rewrite the confirmation claim (fixed).
- SEC-048 open redirect via `/?next=/<backslash>host`; `npm audit` also lists `react-router-dom` (high), `ws` (high), `qs` (moderate) in production dependencies (owner updates the dependency).
- SEC-049 **`record-consent` source is empty in the repository** (emptied by commit `8d4701f`) although signup and the consent drain call it; not changed, needs a decision against the hosted function.
- `send-error-notification` calls a function named `resend` that does not exist, so crash emails are not sent today.
- Migration `20251207163822` promoted the demo account to `master`, and the same address is the "from" address of the email hooks.

## 11. Owner decisions and actions

`step3b-owner-actions.md` (credential response, SEC-004, SEC-015 hosted privilege, SEC-020 evidence migration approval, SEC-035 crew scope, SEC-038 login roles, dependency update, `record-consent`, `resend`, Twilio URLs) and `step3b-credential-check.sql`.

## 12. Review corrections (targeted review, same day)

1. **`20261026120400` is now fail closed.** It checks the postcondition (no `supabase_admin` or `postgres` default ACL in `public` names `anon`, `authenticated` or PUBLIC), tries the three `ALTER DEFAULT PRIVILEGES`, checks again and RAISES 42501 if it still does not hold, so the transaction rolls back and no history row is written. Local capability: the replays run as a superuser, so it succeeds on both; a non-superuser, non-member operator is refused when defaults are open (reproduced), a member succeeds, owner-role defaults it cannot fix are refused. The hosted operator's capability stays **unverified and is a Step 4 gate** (read-only pre-check, owner closes the defaults from the dashboard as `supabase_admin` if refused; no new role). Tests: `defaultPrivilegeMigration` (18), posture (refused when open, passes when closed).
2. **`20261026120000` reviewed for effective privileges.** Findings: no PUBLIC grants exist on relations or functions and `anon` has no role memberships on any shape; the migration revokes sequences from PUBLIC and now ends with a postcondition that raises if any effective anonymous privilege remains (PUBLIC or inherited). Bug found and fixed in that check (`has_sequence_privilege` was asked about non-sequences). Review also showed the signup-consent staging insert is refused for `anon` with or without this migration (its policy reads `auth.users`), and that `record_cash_payment` is a backend-only function, so the test expectations were corrected to the real design. `anonPrivilegeSweep` (43): public catalog, settings and navigation still work for visitors; ten private tables refused; receipts, ledger-sequence payments and receipt numbers work for admin and the backend and are refused for customers, crew and anon; PUBLIC and inherited grants stop the migration; double run safe. Run on the Production- and Development-shaped pre-states too.
3. **Confirmation guard (`20261026120300`) reviewed.** `bookingConfirmationGuard` (64, also on the Production- and Development-shaped databases): refusals under `anon` and every staff role including mixed-column and upsert writes; echoed unchanged values pass; the service role and the SECURITY DEFINER functions run claim, retry (busy), wrong-owner finalize/release, idempotent finalize and release, `already_sent`, stale takeover and invalid cases. Another-function scan: only six functions mention the columns, none executable by `anon`/`authenticated`; the only exposed definer that writes `orders` is the admin-gated archive (`archived_at` only); no updatable view. Browser roles cannot INSERT into `orders` since `20261021120000`, so the guard's insert branch is defence in depth (tested with a temporary grant). Nine mutants of the guard, all killed.
4. **Headers and ordering.** All five headers now say they belong to the coordinated Step 4 rollout, are applied only through the approved mechanism in version order after the October block, name the verification rules, and no longer say "apply manually" (asserted by `step3bMigrationPlan`). Order checked against both Step 2 manifests (Development phase P5 chain, Production group `step3b` after item 67). The Step 2 handoff listed "Step 3 database changes" before the October block; they cannot precede it (version order; `...0300` needs the columns from `...17` and `...21`), and the safety intent holds because containment removal stays last. Recorded in `step3-step4-deployment-dependencies.md`.
5. **Validation.** Before-and-after posture on the repository chain, Production-shaped and Development-shaped databases (14, 14 and 11 failures before; 0 after), `coreDatabaseAccess` (707) on all four real-snapshot databases before and after Step 3B (booking creation, customer, staff and receipt scenarios), all Edge suites with a new trap on every outbound HTTP call (denied requests make none; allowed Twilio and calendar paths make none), manifests, and migration rehearsals (Production-shaped: snapshot + 67 files + 5; Development-shaped: snapshot + 2 + 23 + end-state script + 5). The Stage B snapshots are schema-only, so one synthetic `pricing_rules` row is copied into those scratch copies for the public-quote scenarios.

## 13. Final test-integrity correction and acceptance run

**Runner.** `node scripts/dev/security-scratch.cjs accept` is the Step 3 acceptance command: always strict, no arguments (filters would shrink the denominator). It reads `audit/security/step3-acceptance-manifest.json` and fails with a nonzero exit if a required database is missing or empty (checked first), a `must_exist` file is absent, fewer than 119 test files are discovered, any run crashes, has no result line, fails an assertion or reports a SKIPPED layer, or any baseline run does not fail exactly as recorded. It reports required, executed, passed, failed, skipped, baseline accepted/rejected, missing databases, missing tests and assertions separately. `test [filter]` stays as a labelled DIAGNOSTIC mode whose green result says it is not an acceptance result. Baselines are compared with `audit/security/step3b-baseline-expected.json` (recorded from real runs): the same assertions, the same observed values, the same totals, no crash-like output, no extra failure, no skip.

**Negative controls (real command, isolated state, all restored).** Required database renamed away: exit 1, `missing databases: 1`, nothing run. Forced SKIPPED suite: exit 1 (a clean probe alone: exit 0). Missing required test file: exit 1. Shrunken denominator: exit 1. Unrelated crash used as a baseline: exit 1. Connection failure as a baseline: exit 1. A different security result (Development baseline substituted): exit 1. One recorded observed value altered: exit 1. The real expected-vulnerable baselines: exit 0 (14, 14 and 11 findings). Synthetic-output tests of every decision rule: `securityAcceptanceRunner` (32). Probe files and the renamed database were removed or restored.

**Final acceptance run: PASS.** 119 test files discovered; 133 required runs (119 files, 11 re-runs on the Production-, Development- and repository-chain databases, 3 baselines), 133 executed, 130 passed, 3 baselines accepted, 0 failed, 0 skipped, 0 missing databases, 0 missing tests; 143,174 assertions passed.

**Step 2 compatibility, added to `step3bMigrationPlan` (91):** versions unique and ordered; the three withdrawn originals absent and not reused; every row committed at HEAD in both recovery manifests is identical in every column (only the five Step 3B rows were added); deny list, execution manifest and batches, and both verification-rule files are unchanged from HEAD; no tracked migration differs from HEAD.

## 14. Final Step 3 acceptance review (2026-10-18)

- **Commit-stable Step 2 comparison.** `step3bMigrationPlan` compared the manifests with `HEAD`, which would stop holding once the Step 3 commits exist. It now compares with the accepted Step 2 checkpoint `0658fdd08ecdb4d3939e5625ec05eaf6b0dcdd12` (at which the manifests, execution package, deny list, rules, migrations, scripts and tests equal what later commits carried forward; they only pruned evidence). Verified before and after a simulated commit: the seven proposed commits were made in an isolated local clone (the real repository untouched) and the Step 2 and Step 3 suites pass there unchanged (96 checks).
- **SEC-049 fixed locally.** `record-consent/index.ts` had been committed empty since `8d4701f`; a Step 4 "deploy all functions" would have shipped a function that does nothing, silently stopping consent logging. It is restored byte for byte from `8d4701f^`; 23 new handler tests pin its authorization; a new guard fails if any function source is near-empty. Hosted comparison before deploy remains a gate.
- **Edge deployment register** added to the deployment dependencies (every changed function, its `verify_jwt` model, caller proof and hosted preflight gate); asserted by test.
- **Register** gains `acceptance_class`, `acceptance_note` and `hosted_verification` for all 50 findings; there is no finding in the class "requires additional local correction".
- **Owner choices** for SEC-005, 015, 020, 035, 048, 049 are in `step3b-owner-actions.md` section 3. None blocks local acceptance.
- **Reproducibility.** Both generators (and the execution-manifest builder) reproduce the committed manifests and rule files with no content change.
- **Strict acceptance** re-run after the changes: see the final report.
