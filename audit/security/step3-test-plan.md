# Step 3 test plan

Legend: **A** fully automated locally (needs scratch PostgreSQL, no hosted access); **S** static/source; **D** requires hosted Development in Step 4; **M** manual owner-run.

## 1. Environment gate
- Start scratch PostgreSQL (127.0.0.1:54329); replay Production-shaped schema and Dev-shaped schema; `CORE_DB_REQUIRE=1`, `ROLE_DB_REQUIRE=1` so skipped layers fail. Command family: `node scripts/dev/run-tests.cjs security`.
- Accept Step 3 only when every executed layer ran (none SKIPPED).

## 2. Database security (A)
| Area | Check | Issues |
|---|---|---|
| Anonymous | no privileges on private tables; allow-list of anon-executable functions; anon-writable policies list | 001-003, 010 |
| Customer isolation | authenticated customer sees only `get_my_orders()`, own customer/address rows; cannot update `customer_profiles.contact_id` | 008, 009 |
| Role boundaries | master/admin/crew/customer matrices on every private table | 006, 007, 035, 036 |
| RLS | no `%service role%` policy without service_role; `orders` has no public/anon policy | 001, 002 |
| Function EXECUTE / SECURITY DEFINER | classification suite; search_path pinned | 010-012, 037 |
| Role assignment | admin cannot grant master (case variants); signup yields one customer role | 007 |
| Sequences and defaults | anon cannot USAGE/UPDATE; default ACL assertions | 014, 015 |
| Dev grants | service_role reads 8 tables | 016 |
| Storage | bucket visibility and policy matrices (anon list/insert/delete denied) | 018-020 |
| Secrets | `admin_settings` unreachable by anon/customer | 039 |

## 3. Application security (A/S)
Edge Function matrix (anonymous, anon key, customer own order, customer other order, crew, admin, master, service role) for: charge-deposit, stripe-refund, customer-balance-payment, customer-cancel-order, order-lifecycle, record-cash/check-payment, staff-order-save, send-invoice, create-admin-user, task-evidence, fix-payment-method, sync-google-calendar, get-payment-method, get-session-metadata. Webhooks: Stripe signature valid/invalid/replay (existing idempotency tests), Twilio signature valid/invalid (new). Portal: token valid/expired/revoked/other-order, rate-limit and enumeration. Error and log handling: no secrets, tokens or PII in responses or logs (S scan). Frontend: no service-role key in bundle (scan of build output). Config consistency test (S).

## 4. Business regression (A where harness exists, otherwise D/M)
Residential and commercial bookings (A harness; D live), bounce house and Event Essentials orders (D), admin invoice create/edit (A + D), deposit charging, saved cards, refunds (A harness; D with Stripe test mode), portal updates, waiver signing, delivery/pickup evidence (D), crew access (A policy matrix; D UI), SMS notifications (D, sandbox recipients only).

## 5. What cannot be proven locally
Stripe, Twilio, Resend, Google, Supabase Auth, real Storage signed URLs, hosted Edge Function behaviour (including whether hosted HTML responses are rewritten), `pg_net` triggers. These are Step 4 and later.

## 6. Acceptance criteria for Step 3
1. All security suites pass with no skipped layer on both replays. 2. Allow-lists reproduce exactly. 3. The two stale assertions corrected, not weakened. 4. New migrations pass idempotency (apply twice) and both replays. 5. Edge Function matrix green with zero provider calls on denied paths. 6. Mutation check on new gates. 7. Manifests regenerated and manifest tests pass. 8. Register statuses updated with evidence links.

## Step 3B: how the plan above is now run (local)

```bash
node scripts/dev/security-scratch.cjs build     # repository-chain scratch databases (needs the local PostgreSQL on 127.0.0.1:54329)
node scripts/dev/security-scratch.cjs shapes    # Production-shaped and Development-shaped databases (needs the protected Stage B captures)
node scripts/dev/security-scratch.cjs test      # every *.test.ts with the right database for each; a missing database fails (CORE_DB_REQUIRE=1), it is not skipped
```

New suites: `securityPosture` (94 executed checks per database shape), `edgeFunctionHardening` (72), `step3bMigrationPlan` (81), `defaultPrivilegeMigration` (18), `anonPrivilegeSweep` (43), `bookingConfirmationGuard` (64), `safeInternalPath` (23), `productionBackendGuard` (12), `demoCredentialExposure` (6). Section 6 criteria 1 to 8 are met locally; criterion 5 (Edge matrix) is met for the functions Step 3B changed and by the existing suites for the rest. Hosted checks stay Step 4.
