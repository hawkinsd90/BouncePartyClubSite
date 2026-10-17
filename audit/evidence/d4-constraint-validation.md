# D4 constraint validation: the four NOT VALID constraints (and `order_refunds_allocation_shape`)

Source: `tools/d4_run.py` scenarios D4-V-1 (valid synthetic history) and D4-V-2 (invalid history allowed by the Production-equivalent schema, which has none of these constraints). Synthetic data only; no migration SQL was changed and no automatic validation was added.

## `order_custom_fees_amount_non_negative` on `order_custom_fees` (created by `20261020120000`)
- Definition: `CHECK ((amount_cents >= 0)) NOT VALID`
- State before the upgrade: absent (constraint does not exist before the migration); after the upgrade: **NOT VALID**.
- `VALIDATE CONSTRAINT` on valid synthetic history: **succeeds**.
- `VALIDATE CONSTRAINT` with invalid historical rows: **fails** (`check constraint "order_custom_fees_amount_non_negative" of relation "order_custom_fees" is violated by some row`); constraint still NOT VALID = `True`; rows untouched = `True`; the failed statement rolled back cleanly.
- Updating an existing invalid row, even only its name: rejected: new row for relation "order_custom_fees" violates check constraint "order_custom_fees_amount_non_negative"
- Recommendation: later: run only after a read-only count of negative custom fees in Production is zero (or corrected).

## `order_discounts_amounts_valid` on `order_discounts` (created by `20261020120000`)
- Definition: `CHECK (((COALESCE(amount_cents, 0) >= 0) AND (COALESCE(percentage, (0)::numeric) >= (0)::numeric) AND (COALESCE(percentage, (0)::numeric) <= (100)::numeric))) NOT VALID`
- State before the upgrade: absent (constraint does not exist before the migration); after the upgrade: **NOT VALID**.
- `VALIDATE CONSTRAINT` on valid synthetic history: **succeeds**.
- `VALIDATE CONSTRAINT` with invalid historical rows: **fails** (`check constraint "order_discounts_amounts_valid" of relation "order_discounts" is violated by some row`); constraint still NOT VALID = `True`; rows untouched = `True`; the failed statement rolled back cleanly.
- Recommendation: later: after counting discounts with negative amounts or percentage outside 0-100.

## `order_refunds_amount_positive` on `order_refunds` (created by `20261022120000`)
- Definition: `CHECK ((amount_cents > 0)) NOT VALID`
- State before the upgrade: absent (constraint does not exist before the migration); after the upgrade: **NOT VALID**.
- `VALIDATE CONSTRAINT` on valid synthetic history: **succeeds**.
- `VALIDATE CONSTRAINT` with invalid historical rows: **fails** (`check constraint "order_refunds_amount_positive" of relation "order_refunds" is violated by some row`); constraint still NOT VALID = `True`; rows untouched = `True`; the failed statement rolled back cleanly.
- Recommendation: later: after counting refund rows with amount <= 0 (legacy rows may contain zero/negative values).

## `order_refunds_operation_shape` on `order_refunds` (created by `20261022120000`)
- Definition: `CHECK (((operation_key IS NULL) OR ((operation_index IS NOT NULL) AND (request_amount_cents IS NOT NULL) AND (provider_idempotency_key IS NOT NULL)))) NOT VALID`
- State before the upgrade: absent (constraint does not exist before the migration); after the upgrade: **NOT VALID**.
- `VALIDATE CONSTRAINT` on valid synthetic history: **succeeds**.
- Recommendation: now or later: legacy rows cannot violate it (the operation columns are new and NULL); cheap and safe.

## `order_refunds_allocation_shape`
- Added NOT VALID and validated inside `20261023120000`. Legacy refund rows have every allocation column NULL (those columns are new), so they satisfy the first branch of the CHECK and the in-migration `VALIDATE` always succeeds on existing data; it cannot fail because of historical rows. Enforcement on new rows is covered by D4-A1 (valid 3000-cent allocation accepted; 3001 vs 3000 rejected).

## Cross-cutting findings
- Enforcement applies to new and changed rows from the moment each NOT VALID constraint exists; a historical invalid row cannot be edited (any UPDATE of that row is rechecked) but can be deleted, so `order_custom_fees`, `order_discounts` and `order_refunds` maintenance screens must expect that error until the data is corrected.
- Whether Production contains rows that would fail validation is unknown (schema-only snapshot): it requires a read-only count query in Production before any hosted `VALIDATE`, which D4 did not run.
- The validation was never added to the release sequence; each VALIDATE is a separate, reversible-by-rollback operation that takes a SHARE UPDATE EXCLUSIVE lock.
