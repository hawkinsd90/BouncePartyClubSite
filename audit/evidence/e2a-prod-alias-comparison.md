# E2A: Production cases 41 and 42, statement-level comparison

Method: each pair was split into statements (SQL-aware, comments removed) and compared one statement at a time; the executable-SQL digest uses the C4 fingerprint tool (comment-removed, whitespace-collapsed, string literals and `$$` bodies preserved). The SQL of the Production-recorded versions is represented by their repository files: Stage B proved each recorded `statements` digest equals its file (`recorded_sql_vs_file = IDENTICAL` for `20260305205811` and `20260408200431`), so a file-to-file comparison is a comparison with the recorded SQL. The stored text itself was not re-read (no hosted contact); the query to read it is in `e2a-unresolved-evidence.md` section D. Captured Production catalog: 2026-10-16 18:54:59 UTC.

## Case 41: `20260305203528` (add_customer_payment_amount) vs recorded `20260305205811` (add_customer_selected_payment_tracking)

| # | Statement in `20260305203528` | Statement in `20260305205811` | Same? |
|---|---|---|---|
| 1 | `ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_selected_payment_cents INTEGER, ADD COLUMN IF NOT EXISTS customer_selected_payment_type TEXT;` | identical | **identical** |
| 2 | `UPDATE orders SET customer_selected_payment_cents = deposit_due_cents, customer_selected_payment_type = 'deposit' WHERE customer_selected_payment_cents IS NULL;` | `UPDATE orders SET customer_selected_payment_cents = deposit_due_cents, customer_selected_payment_type = CASE WHEN deposit_due_cents >= (subtotal_cents + travel_fee_cents + surface_fee_cents + COALESCE(same_day_pickup_fee_cents, 0) + tax_cents) THEN 'full' ELSE 'deposit' END WHERE customer_selected_payment_cents IS NULL;` | **different**: the first always writes `'deposit'`; the second writes `'full'` when the deposit covers the pre-fee total |

- **Schema effects:** identical (two columns, `integer` and `text`). Both columns are present in the Production capture with those types (analyzer: all column statements `PRESENT`).
- **Data effect:** different (statement 2). Both are one-time backfills guarded only by `customer_selected_payment_cents IS NULL`.
- **Execution guard behaviour:** because the column is nullable and new orders may legitimately leave it NULL, running `20260305203528` on Production **would rewrite every such order** (`cents := deposit_due_cents`, `type := 'deposit'`), a data change that is not an idempotent no-op. The number of such rows today is unknown (needs `SELECT count(*) FROM orders WHERE customer_selected_payment_cents IS NULL;`, read-only, not executed).
- **Supersession:** `20260305205811` is a later, refined version of the same change and is recorded in Production; the file `20260305203528` reads as an earlier draft of it. No later migration supersedes either file's column definitions.
- **Development:** neither version is recorded in Development; both columns exist there (effects present), but the capture cannot say which SQL created them.
- **Conclusion:** the two versions are **not equivalent**. Do not execute `20260305203528` on Production. Can the repository version receive a history-reconciliation record? Only as an explicitly marked record ("superseded draft; SQL not executed"), which is a **version-identity decision for the owner**; the alternative that matches the Case 43 precedent is to withdraw the file before application. E2A class: **I (identity decision)**.

## Case 42: `20260407203226` (add_refund_requested_to_orders) vs recorded `20260408200431` (add_refund_requested_to_orders)

| # | Statement | Same? |
|---|---|---|
| 1 | One `DO $$ ... IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='refund_requested') THEN ALTER TABLE orders ADD COLUMN refund_requested boolean DEFAULT false; COMMENT ON COLUMN orders.refund_requested IS '...'; END IF; END $$;` | **identical in both files** |

- Executable-SQL digest of both files: `23fa13edf474228c...` (equal). The files differ only in the header comment (the earlier file has a long explanation, the later a two-line summary).
- **Effects:** `orders.refund_requested boolean DEFAULT false` is present in Production (and Development). The `COMMENT ON COLUMN` text is not part of the catalog capture (unverified; query in section D of `e2a-unresolved-evidence.md`).
- **Execution guard behaviour:** the whole body is guarded by the column's existence, so executing `20260407203226` on Production is a **no-op**; it can neither alter data nor schema.
- **Supersession / conflict:** none; the second file is a duplicate of the first with a different timestamp.
- **Conclusion:** the executable SQL is identical, so a reconciliation record for `20260407203226` would be truthful as "duplicate of the recorded `20260408200431`; identical SQL, effect present" (history-only), and executing it would also be harmless. Which of the two (bookkeeping record or withdrawing the duplicate file) is a **repository-identity decision for the owner**. E2A class: **I (identity decision)**, with the evidence favouring a history-only record or withdrawal over execution.

## Summary
| Case | Executable SQL | Safe to execute? | History-only record truthful? | Recommended treatment (owner decides) |
|---|---|---|---|---|
| 41 | differs (backfill rule) | **No** (rewrites NULL rows) | only with an explicit "superseded draft, not executed" marker | withdraw before application (Case 43 precedent) or marked bookkeeping; never execute |
| 42 | identical | yes (no-op) | yes ("identical SQL to recorded version") | bookkeeping record, or withdraw the duplicate |

Nothing was renamed, no history was modified, and no hosted system was contacted.
