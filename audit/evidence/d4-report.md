# Stage D4 report: synthetic-data compatibility and financial-integrity rehearsal

Branch `Dev`, HEAD `63672cd221b4cc11fb436fd7ad65444d29746960` (four checkpoint commits intact). Local PostgreSQL 18.4 only (`127.0.0.1:54329`); every scenario started from a **fresh clone of the restored pre-upgrade Production schema** (`bpc_replay_d4_template`, built with the verified D3 restoration procedure and its documented platform limits), never from the upgraded D3 database. All data is synthetic and test-tagged (`d4`-prefixed ids, `@example.test` emails, `pi_d4_`/`re_d4_`/`cs_d4_` provider ids), reproducible from `tools/d4_seed.py`. No hosted system was contacted. Protected raw results and logs: `C:\Users\vikki\migration-evidence\d4-scratch\`.

## Verdict: D4 PASSED WITH QUALIFICATIONS
94 of 94 scenario checks pass (`d4-scenario-matrix.csv`). The qualifications are coverage limits, not failures: 12 data-dependent statements are only partially verified and the 122 DML statements inside function bodies (payment-operation, refund-allocation, booking and staff-save RPCs) were not executed; nothing was run against real Production data.

## 1. Preflight
Branch `Dev`, HEAD `63672cd`; 386 migration files, Case 43 absent; recovered-migration hash tests 63/63, replay-safety 144/144, pending-set 54/54; the D3 upgrade set is the same 67 versions with every file hash unchanged (manifest SHA-256 `6bc153ae...`); Production manifest 24/24 files verified; scratch-database name, loopback and ownership-marker guards enforced by `d4_lib.py` (names `bpc_replay_*`, marker comment, `prod` refused). An uncommitted `.gitignore` line from another workstream is untouched.

## 2. Synthetic dataset (D4-A1) and scenarios
Starting-schema counts: 6 `auth.users`; 9 `user_roles` rows (master; `ADMIN`; padded `' Crew '`; 2 customers; a duplicate pair `admin` 2026-01-02 + `ADMIN` 2026-01-05; 2 orphans without an auth user); 4 customers, 4 addresses, 4 contacts, 2 units; **12 orders** (draft, pending review, awaiting approval, confirmed with deposit paid, paid in full with tip, check payment, cancelled with full refund, partial refund, discounts and custom fees, tax and fee waivers, same-day pickup + weekday delivery + generator fees, failed-then-retried payment); 12 order items; **14 payments** (card, cash, check; deposit, balance; succeeded, pending, failed; negative refund copies; null provider ids); **4 legacy refunds** (succeeded full, succeeded partial, pending, failed, one without a provider id); **7 invoice/portal links** (including an expired portal link, several invoice links and two shortlinks for one order); 2 invoices; 2 discounts; 1 custom fee; 1 pricing_rules row; the 8 captured storage buckets.

| Scenario | Purpose | Checks | Result |
|---|---|---|---|
| D4-A1 (+A1x) | valid dataset, full upgrade, financial and business invariants, enforcement tests | 47 | all pass |
| D4-B1 | role `owner` | 7 | fails at the intended guard, rolls back |
| D4-B2 | empty `auth.users` with roles | 7 | fails at the guard, rolls back |
| D4-B3 | duplicate original PaymentIntent | 6 | fails at the unique index, rolls back |
| D4-B4 | duplicate active portal link | 5 | fails at the unique index, rolls back |
| D4-B5 | order item with no unit/product/bundle | 5 | fails at the CHECK, rolls back |
| D4-V-1 / D4-V-2 | NOT VALID constraints on valid and invalid history | 5 / 9 | all pass |
| D4-C | re-application of each of the 67 files, rolled back | 3 | all pass |

## 3. Upgrade attempts
**Full 67-migration upgrades attempted: 4, passed: 4** (D4-A1, D4-V-1, D4-V-2 with invalid history, D4-C set-up; each 67 applied, 0 failed). **Intentionally failing runs: 5** (B1-B5); each stopped at its intended migration. One earlier development smoke run of the fixture is not counted as evidence.

## 4. Expected failures (reported as failures, with rollback verification)
| Run | Failing version | Exact error | Not run | Rollback and bookkeeping verified |
|---|---|---|---|---|
| B1 | `20261016120000` | `user_roles contains a role outside master / admin / crew / customer; review those rows before applying this migration` | 11 | role rows unchanged, no CHECK/FK, old `assign_role_by_email`, earlier `order-evidence` bucket present, failed version not in ledger, all earlier versions recorded |
| B2 | `20261016120000` | `auth.users is empty; refusing to treat every user_roles row as an orphan` | 11 | same |
| B3 | `20261019120000` | `could not create unique index "payments_original_payment_intent_unique"` | 6 | payments unchanged, no `operation_key` column, none of the four unique indexes, earlier role CHECK present |
| B4 | `20261009120000` | `could not create unique index "invoice_links_one_active_portal_per_order"` | 20 | invoice_links unchanged, no `revoked_at`, no portal index |
| B5 | `20260716151458` | `check constraint "order_items_single_reference" of relation "order_items" is violated by some row` | 63 | order_items unchanged, no `product_id`, no inventory tables |

**Unexpected failures: none.** No migration defect was found, so no correction is proposed.

## 5. Financial integrity (`d4-financial-integrity.json`)
Every pre-existing column of every row of 13 business tables was compared exactly (integer cents; no floating point) before and after the upgrade: **0 changed values, 0 rows added or removed**. Per order: subtotal, discounts/custom fees context, travel, surface, generator, same-day pickup, weekday-delivery, tax, deposit due/paid, balance due/paid, tip, refunded cents, tax/fee waivers, status and workflow state are identical for all 12 orders. The 14 payments (amounts, statuses, provider ids, refund linkage), the 4 refunds, 7 links, 2 invoices and the pricing_rules row are unchanged. Intended transformations: none on existing financial rows; new columns (`ledger_version`, allocation columns, payment operation/component columns, `revoked_at`) are NULL on existing rows (no backfill, as designed). `order_net_financials` returns the exact integer-cent results expected from the seeds (e.g. partial-refund order: gross 53,000, succeeded refunds 5,000, pending reservation 2,500, retained 48,000); legacy rows report `exact_net_available: false`, which is the documented legacy classification.

## 6. Roles, orders, payments, refunds, invoices and Storage
- **Roles:** 6 rows remain, all in the vocabulary; `ADMIN`/padded values normalise; the duplicate pair collapses to the earliest row; both orphans removed; only the master user holds `master`; canonical CHECK and a valid cascade FK exist; `MASTER` is rejected afterwards; the authorization cases (admin cannot assign master/admin or change another admin; crew refused; master assignment normalises case) hold; signup creates one customer role, customer and profile with no logged error, and a second signup for an existing email links it without duplicating the customer.
- **Payments:** valid history is accepted by all new indexes; a duplicate original PaymentIntent, duplicate Checkout Session, conflicting operation key and a second open operation per order are rejected; a refund copy may reuse its original PaymentIntent; component amounts must sum to the payment (CHECK).
- **Refunds:** legacy rows keep NULL ledger version and allocation; new rows default to ledger version 2; a valid 3,000-cent allocation is accepted, 3,001 vs 3,000 rejected; zero-amount refunds, a refund operation without its keys and duplicate provider refund ids (ledger v2) are rejected; a legacy row may still reuse a legacy provider id.
- **Invoice and portal links:** all 7 existing links survive unchanged; a second active portal link per order is rejected, accepted after revoking the first; non-portal links are unrestricted; revocation is sticky; an event-date change moves the active portal link to event end + 61 days and leaves the already-expired link alone.
- **Storage rows:** 10 distinct buckets; `lot-pictures`, `order-pictures`, `signatures`, `signed-waivers` and `physical-waivers` private, `carousel-media` preserved public, `order-evidence` private and `event-essentials-media` created once. Bucket rows are not evidence that signed URLs or the Storage API work.

## 7. Deferred constraints (`d4-constraint-validation.md`)
After upgrade the four constraints are NOT VALID and `order_refunds_allocation_shape` is validated. `VALIDATE` succeeds on valid history, **fails on invalid history leaving the constraint, rows and transaction state intact**, new invalid rows are rejected even while NOT VALID, an existing invalid row cannot be updated (even its name) but can be deleted, and after correction all four validate. Recommendation: validate `operation_shape` now or later (legacy rows cannot violate it); validate the other three later, only after a read-only Production count shows zero offending rows. Validation was not added to the release sequence.

## 8. Data-dependent statement coverage (`d4-data-change-coverage.csv`, 70 rows)
Every data-changing or data-validating statement listed by the D3 inventory plus every added/defaulted/retyped column is mapped: **57 proven, 12 partially verified, 1 unverified**. Partially verified: seed inserts and product backfill in `20260716151549`, `20260716173638`, `20260716231809` (valid path and re-application checked; conflicts with unknown existing Production rows and the backfill guard's failure path are not reachable from the schema-only snapshot) and a column default in `20260718000744` on an unseeded table. Unverified: the 122 DML statements inside function bodies, which run when the functions are called; D4 executed the signup function, `assign_role_by_email` and `order_net_financials` but not the payment-operation, refund-reservation, booking or staff-save RPCs. Not-reachable-by-existing-data guards are labelled as such.

## 9. Idempotency and one-time operations (`d4-reapplication-matrix.csv`)
Each of the 67 files re-applied to an upgraded database inside a rolled-back transaction: **45 re-apply with no catalog or counted-data change** (including the role repair `20261016120000`), **21 re-apply and change the catalog** (they `CREATE OR REPLACE` definitions that later migrations superseded, so out-of-order re-application would regress functions and policies; e.g. `20261012120000`, `20261014120000`, `20261019120000`, `20261021120000`), and **1 is one-time** (`20260716151458` fails with `relation "inventory_products" already exists`). The whole chain was not re-run on one database; history must never be replayed to "fix" state.

## 10. Remaining limitations and findings for the release plan
- Schema-only baseline: whether real Production rows would violate any guard is unknown. Before any hosted step, run read-only counts for: roles outside the vocabulary and orphan/duplicate role rows; duplicate positive `payments.stripe_payment_intent_id`; orders with more than one active `portal` link; `order_items` without exactly one reference; negative custom fees, discounts outside 0-100 and refunds with amount <= 0. (Not run in D4.)
- The 122 function-body DML statements need function-level financial tests (payment operations, refund allocation/reservation, booking, staff saves).
- Seeding used `session_replication_role = replica`, so pre-upgrade triggers did not run while loading the starting dataset; post-upgrade enforcement tests ran with triggers enabled.
- Unchanged open items: release inclusion of `20260722172048` (Dev-only header) is unresolved and the migration stayed in the 67-version set for comparability; `supabase_admin` default privileges, Storage API/signed-URL behaviour, Realtime, `pg_net` and request-time RLS remain unverified; no Step 3 remediation was attempted.

## 11. Answers
Did D4 pass: **passed with qualifications**. A migration correction: **not needed** (no defect found). A D5 fresh rerun of D4: **not necessary** for these results; the read-only Production count queries and function-level financial tests above are the remaining prerequisites.

## 12. Files
Created in `audit/evidence/`: `d4-report.md`, `d4-scenario-matrix.csv`, `d4-data-change-coverage.csv`, `d4-financial-integrity.json`, `d4-constraint-validation.md`, `d4-reapplication-matrix.csv`, `tools/d4_lib.py`, `tools/d4_seed.py`, `tools/d4_run.py`, `tools/d4_build.py`. Modified: `audit/step2-migration-audit.md` (section AF). No migration, replay-tool or earlier report was changed.

Production and Development were not contacted or modified. No Supabase CLI, Docker, WSL, deployment, staging or commit.
