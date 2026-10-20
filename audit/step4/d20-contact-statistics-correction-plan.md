# D20: stale contact spending totals: verified cause and a minimal correction plan (2026-10-20)

Status: **SUPERSEDED by `d20-durable-correction-plan.md` (one package: trigger removal, coverage and repair). Part 1 below must NOT be run alone.** PLAN FOR SEPARATE AUTHORIZATION. NOTHING WAS CHANGED. No contact, order, payment, invoice or deposit was modified; the historical migration was not rerun. The correction touches only the statistics columns of `public.contacts`.

## 1. What was verified (read-only)
- Contacts: 95; 92 have orders (matched by e-mail through `customers`); 3 do not (one of them shows 4 bookings and 0 spent, and cannot be checked from orders; left alone).
- **Every one of the 92 stored totals equals the output of the legacy formula** (status confirmed/approved/completed only; subtotal, travel, surface, same-day pickup, generator and tax; no custom fees, no discounts, no setup fee, no weekday-delivery fee; `in_progress` orders ignored). That is the proof that the **legacy writer, not the D20 function, produced today's numbers.**
- **Root cause:** two triggers on `orders` both write the contact statistics. `trigger_update_contact_stats` (AFTER INSERT OR UPDATE OF status) runs the D20 function `update_contact_booking_stats`. `update_contact_stats_trigger` (AFTER UPDATE of any column, created by migration 010) runs the old function `update_contact_stats`. After-triggers run in name order, so on every order update the old function runs **second and overwrites** the D20 result: bookings become the count of **all** orders (including drafts and cancelled), and spending ignores `in_progress` orders (42 orders today), custom fees and discounts. No migration ever drops the old trigger. A scratch-database test reproduced it (section 6).
- Size of the problem under the application's own definition of an order total (`orderMoney.composeOrderTotal`): stored total 1,004,616 cents versus 1,963,043 for the 92 contacts; difference 958,427 cents in the stale rows.
  | Field | Stale contacts |
  |---|---|
  | `total_spent_cents` (application formula) | 41 (40 under the historical D20 formula; the 41st differs because the D20 formula omits the setup and weekday-delivery fees) |
  | `total_bookings` | 24 (stored = all orders, including drafts and cancelled) |
  | completed count, first and last completed date, repeat flag | 0 |
  | **Contacts needing any change** | **57** |
- Triggers only fire when an order is inserted or updated, so staleness also appears when a contact is created after its order; the legacy trigger overrides every update.

## 2. What "correct" means here
The authoritative total of an order is the application's definition (the same one the order screens and invoices use): subtotal + travel + surface + generator + setup + custom fees + same-day pickup + weekday delivery - discounts + stored tax; a discount is `amount_cents` when above zero, otherwise a percentage of the equipment subtotal, never more than what it discounts. Counted orders are those not in `draft`, `void` or `cancelled`. This is a statistic of **order totals**, not of money received; payments are not read for it.

## 3. Part 1 (data repair, recommended now): `d20-contact-statistics-correction.sql`
- One transaction, an advisory lock and a guard: it stops without change unless the target is exactly the authorized 57 contacts.
- It computes the correct values in a temporary table, updates only those contacts' `total_bookings`, `total_spent_cents`, `completed_bookings_count`, first/last completed dates and repeat flag, and verifies that none of them still differs.
- Side effect: the existing `update_contacts_updated_at` trigger sets `contacts.updated_at` on the 57 rows. Nothing else changes.
- Tested on a throwaway local PostgreSQL 18 database with synthetic orders (custom fee with a negative value ignored, percentage discount, fixed discount, setup fee, weekday-delivery fee, draft excluded): the results matched hand calculation (101,500 and 47,500 cents), the guard stopped a second run, orders were untouched, and the `UPDATE` statement was also plan-checked against Development with `EXPLAIN` (no execution).

## 4. Part 2 (root cause; recommended, needs its own decision because it is a schema change)
Without it **Part 1 will be undone for a contact the next time one of its orders is updated.** Remove the legacy trigger and function:
```sql
DROP TRIGGER IF EXISTS update_contact_stats_trigger ON public.orders;
DROP FUNCTION IF EXISTS public.update_contact_stats();
```
This changes the schema (one trigger and one function fewer), so it must be authorized and recorded as a deliberate step with the schema fingerprint baseline updated (`trg` 37 to 36 and `fn` 82 to 81), best placed with the later schema stage (S5/S7) rather than as an ad-hoc change. Optionally widen the D20 trigger so it also fires when money columns change (today it fires on insert and status changes only). Neither is part of Part 1. Rollback of Part 2: recreate the function and trigger from migration 010 (kept in the repository).

## 5. Validation and rollback for Part 1
1. **Before** (read-only, by Claude, saved outside Git as `C:\Users\vikki\BPC-Operator-Log\d20-before-capture.json`): for the 57 target contacts, `id`, `total_bookings`, `total_spent_cents`, `completed_bookings_count`, first/last completed dates, `is_repeat_customer`, `updated_at`; plus counts of orders, payments and invoices and the sums of order and payment amounts.
2. **Apply** one `execute_sql` call with the script (single transaction).
3. **After** (read-only): the target query returns 0 rows; the 92 contacts' totals equal the application-formula result; orders, payments, invoices and their sums are identical to the capture; schema fingerprint equal (canonical search path); ledger unchanged (223 rows `e8f53b1e…`); business baseline unchanged; operator-log entry.
4. **Rollback** (only on your instruction): restore the 57 rows from the capture, `UPDATE public.contacts c SET total_bookings = r.total_bookings, total_spent_cents = r.total_spent_cents, completed_bookings_count = r.completed_bookings_count, first_completed_booking_date = r.first_completed_booking_date, last_completed_booking_date = r.last_completed_booking_date, is_repeat_customer = r.is_repeat_customer FROM jsonb_to_recordset('<capture json>') AS r(id uuid, total_bookings int, total_spent_cents int, completed_bookings_count int, first_completed_booking_date date, last_completed_booking_date date, is_repeat_customer boolean) WHERE c.id = r.id;` guarded by a count of 57. A rollback restores the stale values and the old `updated_at` is not restored (the trigger sets it); no order data is involved either way.

## 6. Scratch-database reproduction (local, synthetic)
After the repair a contact showed 1 booking and 101,500 cents; adding the legacy trigger and updating one of its orders changed it to 2 bookings and 0 cents (the in-progress order was ignored and the draft counted). Dropping the legacy trigger kept the repaired values after the same update. The scratch database `bpc_d20_scratch` was dropped afterwards.

## 7. Proposed authorization statement (under 300 characters)
> D20 PART 1: apply d20-contact-statistics-correction.sql to Development (57 contacts, statistics columns of contacts only, one transaction, stops if the count differs). Capture first, verify after. No order, payment, invoice or schema change. Nothing else.
