# D20 durable contact-statistics correction: one package, its placement, tests and authorization (2026-10-20)

Status: **PREPARED FOR A SEPARATE, BOUNDED OWNER AUTHORIZATION. NOTHING WAS CHANGED IN DEVELOPMENT.** This package replaces the earlier two-part proposal (`d20-contact-statistics-correction-plan.md`, `d20-contact-statistics-correction.sql`), which must not be run alone: repairing the contacts while the obsolete trigger exists is undone by the next order update. No order, payment, invoice, deposit or amount is touched. Production was not contacted.

## 1. What was inspected
| Object | Finding |
|---|---|
| `orders` trigger `trigger_update_contact_stats` (AFTER INSERT OR UPDATE OF status) → `update_contact_booking_stats()` | the intended mechanism; fires only on insert or status change; does not fire on delete, amount, fee, discount, customer or date changes; its formula omits the setup fee and weekday-delivery fee and treats a percentage discount without the application's "fixed amount wins, capped" rule |
| `orders` trigger `update_contact_stats_trigger` (AFTER UPDATE, any column) → `update_contact_stats()` | the obsolete writer: runs after the first (name order) and overwrites its result with the old formula (counts all orders; ignores in-progress, custom fees, discounts). All 92 stored totals equal its output |
| `order_custom_fees`, `order_discounts` | no statistics trigger; changing them changes an order's total |
| `contacts` | one trigger (`update_contacts_updated_at`, BEFORE UPDATE); a contact created after its orders (`upsert_contact_from_checkout`, sign-up trigger `auto_assign_customer_role`) starts with zeros or the legacy count |
| application write paths | the website only **reads** the statistics (`ContactsList.tsx`, `queries/orders.ts`); the database functions above are the only writers; `upsert_contact_from_checkout` inserts contacts without statistics; `auto_assign_customer_role` inserts a legacy booking count |
| Production-to-Development refresh tool | it switches triggers off **by name from a reviewed list and stops on an unlisted trigger** (`scripts/SyncDevDataFromProd/lib/config.mjs`) |

## 2. The package: one mechanism, complete coverage
File: [d20-durable-contact-statistics-correction.sql](d20-durable-contact-statistics-correction.sql). One transaction, an advisory lock, preconditions asserted first (reviewed function bodies by md5, the two triggers, none of the new objects present), then:
1. **`refresh_contact_booking_stats(email)`** (new): the only place that computes a contact's statistics, by the application's own order-total definition (setup fee, weekday-delivery fee, whole non-negative custom fees, fixed discount wins over percentage, discounts capped at what they discount, stored tax); orders in draft, void or cancelled are not counted. It writes only when something differs, so `updated_at` is not churned.
2. **`update_contact_booking_stats()`** (existing name and trigger kept): now a thin wrapper that refreshes the new and, after a customer change, the old e-mail.
3. **Coverage** (`trigger_update_contact_stats` widened to INSERT, DELETE and UPDATE OF status, customer_id, event_date, subtotal, travel, surface, generator, setup, same-day pickup, weekday-delivery and tax; new `trigger_update_contact_stats_order_fees` and `..._order_discounts` for insert, update and delete; new `trigger_update_contact_stats_new_contact` for a contact created later).
4. **Removal** of `update_contact_stats_trigger` and `update_contact_stats()`.
5. **Repair** of the contacts whose statistics differ, judged by an independent implementation of the same definition inside the script (the helper is checked, not trusted); guard: exactly **57** contacts.
6. **Final catalog assertion**: four statistics triggers, no obsolete writer.
All four functions are SECURITY DEFINER with `search_path = public` and are not executable by `anon`, `authenticated`, `service_role` or PUBLIC (owner-only, so the function ACL in the fingerprint is the same whatever the default privileges are at that time; trigger functions do not need EXECUTE to fire). Not covered, by design: a change of `customers.email` (it re-keys the contact, a separate event not present in the data).

## 3. Exact expected contact changes (Development, 2026-10-20)
57 contacts change: 33 only `total_spent_cents`, 16 only `total_bookings`, 8 both. `total_spent_cents` changes for 41 contacts (40 up, 1 down; 38 from 0; the 41 sum 74,000 before and 1,032,427 after, net **+958,427**, largest single increase 57,000); `total_bookings` changes for 24 contacts, all down (49 before, 12 after; drafts and cancelled orders were being counted). Completed counts, first/last completed dates and repeat flags: **no change**. The sum of all 95 contacts' totals goes from 1,004,616 to 1,963,043. `updated_at` is bumped on those 57 rows only. The other 38 contacts are not rewritten.

## 4. Exact expected schema-fingerprint difference
Categories changed: **fn** and **trg** only (nine others identical). Today's rows: remove the two functions and two triggers named in section 1, add four functions and four triggers. Predicted against today's Development (method validated: it reproduces today's baseline digests): **fn** `3a11af85b0f081a4f046a6caf9759e03`/82 becomes `32f59f0ec0d7363565e290c2d3065a3b`/84; **trg** `f729c8fe14404bc4272a79c1f181800a`/37 becomes `939498986d6ddad3dd105070bc326e0c`/39. At the real execution time the other rows will differ, so rerun [d20-durable-fingerprint-prediction.sql](d20-durable-fingerprint-prediction.sql) immediately before and compare its `predicted` line with the result after. Row-level detail and the function-body md5 values are in that file.

## 5. Tests (isolated synthetic data, local scratch PostgreSQL 18; Development was never involved)
The scratch database reproduces the deployed functions byte for byte (md5 `6725e093…` and `274c7441…` match Development) and both triggers. **55 checks passed, 0 failed:**
- **Failure and rollback:** a wrong target count stops the whole package with no change; a failure injected after all DDL and the repair rolls everything back (functions, triggers and contacts identical to the deployed state); a changed legacy function is refused; a second run after success is refused.
- **Result:** the contacts equal an independent expectation (in-progress counted; custom fee, percentage discount, setup and weekday fees; tax; dates; repeat flag); an already-correct contact is not rewritten; orders, payments, invoices, custom fees, discounts and customers are byte-identical; the new functions are not executable by `anon`, `authenticated` or `service_role`; all are SECURITY DEFINER with `search_path=public`.
- **Durability, 24 steps after the correction, each compared with the independent expectation:** status changes, subtotal/travel/tax/setup/weekday edits, custom fee insert/update/delete, discount insert/update/delete (fixed and percentage), event-date change, order moved to another customer and back (both contacts refresh), new order, order delete (cascade), a contact created after its orders, a contact with no orders; tip/notes updates and a no-change update do **not** touch the contact; payments and invoices are never modified.
- **Rollback script:** applied after the package on a second scratch database, it restores the deployed function bodies (md5), the exact trigger definitions, the effective function ACL, the 3 captured contact rows and removes the new objects; financial tables untouched.
Test driver and seeds are in the session scratchpad; the SQL files are the deliverable.

## 6. Rollback and verification procedure
1. **Before** (read-only, by Claude): capture the 57 target contacts (`id` and the six statistics fields, to `C:\Users\vikki\BPC-Operator-Log\d20-before-capture.json`, outside Git), the counts and sums of orders, payments, invoices, custom fees and discounts, the ledger count and SHA-256, the fingerprint (canonical search path) and the prediction query result.
2. **Apply** `d20-durable-contact-statistics-correction.sql` as one call (text normalized to LF).
3. **After** (read-only): catalog as designed (4 triggers, 4 functions); the 57 contacts equal the independent expectation and the target query returns 0 rows; financial sums identical to the capture; fingerprint equals the prediction (fn and trg changed, nine unchanged); ledger as expected; business baseline unchanged; operator-log entry.
4. **Rollback** (only on your instruction): `d20-durable-rollback.sql` with the capture inserted for `{{CAPTURE_JSON}}`. It re-creates the deployed objects, verifies their md5, and restores the 57 rows; `updated_at` is not restored. A ledger DELETE never undoes SQL.

## 7. Placement in S2 to S15 (decision and reasons)
**Recommended: S12b, after the sealed executor stages (S5 to S7) and S8 to S12, before S13 integration testing, as its own separately authorized Development operation.**
- **Hard dependency:** the sealed executor (`dev-migration-executor.cjs`) raises an exception for any step whose catalog fingerprint differs from the sealed `pre_fp_all`/`post_fp_all` chain (`start_state` of `dev-package-oct-s3b.sealed.json`, and a final `verify`). A change to functions and triggers before S7 makes every October step refuse to run, unless the package were re-sealed, which would repeat the rehearsal for no business gain. None of the October or Step 3B migrations touches these objects (checked: they never mention `update_contact_stats` or the contact statistics), so waiting costs nothing in the rollout.
- **Repair is not done early:** repairing contacts before the trigger change would be overwritten by the next order update, so the data repair is part of the same operation and waits with it.
- **Why before S13:** the integration tests then run on correct statistics.
- **Fallback, acceptable:** apply it at S15 as the first ordinary migration after standard deployment is restored (no drift, and the repository gets the file naturally). It delays correct analytics until then.
- **Repository and ledger follow-up (must be bound at S12b):** the same SQL is added as one migration file (a version later than `20261026120400`) in the reviewed S15 commit, and the hosted run records its ledger row as `executed` with that exact version, so that "ledger versions equal repository versions" holds; the ledger count guard is set from the then-current count. Adding the file changes the pinned inventory counts, so that commit regenerates those pins (the S15 plan already regenerates manifests and tests).
- **Companion code change (done locally, tested, not deployed):** `scripts/SyncDevDataFromProd/lib/config.mjs` now also lists the three new triggers as reviewed (a superset: a missing entry would make the Production refresh stop). After the package runs, the entry for the removed `orders.update_contact_stats_trigger` is deleted in the same follow-up commit.
- **Production:** it almost certainly has the same obsolete trigger (Development's data came from it); it was not examined and is not touched. A Production plan is separate and later.

## 8. Residual risks
A change of `customers.email` is not covered. The statistic still follows order totals, not money received. `updated_at` moves on the repaired contacts. The refresh helper runs for every qualifying order, fee or discount write, which is cheap at this data size.

## 9. Proposed authorization (for S12b; do not send it before then)
> D20 DURABLE: apply d20-durable-contact-statistics-correction.sql to Development once (one transaction, stops if any check differs): one statistics mechanism, 57 contacts repaired, obsolete trigger removed. Capture first, verify after. No order, payment, invoice or Production change. Nothing else.
