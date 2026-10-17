# E2B-1 owner decision options (nothing here is implemented or decided)

Each section gives the facts, the viable options with their risks, and my recommendation. The approved 67-version rehearsal set stays the baseline until you decide otherwise.

## D-1. Should the Production upgrade execution set stay at 67 versions?
**Facts.** 64 of the 67 carry an effect Production lacks or a data statement; the other three are the net-zero pair `20260715221828` / `20260716104333` and the no-op `20261010110000` (details and test results in `e2b1-report.md`). Six more versions have every effect replaced by a later selected version (`20260716151530`, `20260716152823`, `20260716173644`, `20260717111737`, `20260717113131`, `20260814114825`); the local rehearsal (section 5 of `e2b1-report.md`) shows that omitting them, individually or all together, leaves the final catalog and the synthetic-data digests identical to the full 67-version result.
| Option | What it means | Risk |
|---|---|---|
| A. Keep all 67 (recommended) | the exact sequence rehearsed in D3 and D4 (4 full upgrades, 5 intended-failure fixtures) | none new; includes a few no-op steps |
| B. Run 64 and record the three no-op versions without executing them | omit the net-zero pair and `20261010110000` | rehearsed: 64 of 64 apply; catalog and data digests identical to the full result; needs three history-only records and a changed manifest; D4's failure and data scenarios were run on the 67-version sequence |
| C. Run 58 (also omit the six intermediate versions) | omit nine versions in total | rehearsed: 58 of 58 apply; catalog and data digests identical to the full result; saves little, loses the audit trail of the original sequence, needs nine history-only records, and the omitted files contain no data statements but the equivalence is verified only for the synthetic starting state |
**Recommendation:** A. A shorter sequence saves minutes and adds a bookkeeping decision per omitted version.

## D-2. `20260722172048_allow_null_surface_for_ee_only_orders` (U-5)
Facts: header says Dev only; Development already has the effect; the Production schema has `orders.surface NOT NULL`; current booking code sends NULL surface for Event-Essentials-only orders (`supabase/functions/_shared/booking/bookingBuild.ts` line 271) and `create_booking_request` inserts `v_order->>'surface'`; staff order-save code normalizes a missing surface to `'grass'` (`staff-order-save.ts` line 168) so it does not depend on it; a local test rejects a NULL-surface order without the migration and accepts it with the migration. Options: **include** (recommended; needed for Event-Essentials-only bookings), **exclude and change the booking code** (re-introduces a placeholder surface, an application change outside Step 2), **replace with a new Production-reviewed migration** (new version for the same effect), **defer** (October booking code would still be deployed). Whatever is chosen, the header comment should be corrected in a separately authorized documentation-only change.

## D-3. Case 41 `20260305203528`
Facts: not equivalent to the recorded `20260305205811` (backfill differs); local test on 13 synthetic orders with a NULL selection: `20260305203528` writes `'deposit'` to all 13, `20260305205811` writes 12 `'deposit'` and 1 `'full'`; both rewrite every NULL row, so executing it on Production changes data. Options: **withdraw before application** (Case 43 precedent; recommended if Development never applied it), **marked bookkeeping record** ("superseded draft, not executed"), **leave unreconciled** (it will always appear pending). Never execute.

## D-4. Case 42 `20260407203226`
Facts: executable SQL identical to the recorded `20260408200431`; whole body guarded by the column's existence; executing it on Production is a no-op. Options: **bookkeeping record** with a note "identical to 20260408200431" (truthful), **withdraw the duplicate file**, or **execute** (harmless). Recommendation: withdraw or record; either keeps the repository 1:1 with history.

## D-5. Development alias `20260814002658` vs `20260814120000`
Facts: recorded SQL is digest-identical to the file; the repository cleanup (commit `ce5637b`) already gave 22 other Development-recorded files the recorded version as their filename prefix (the Development `name` column carries the original intended filename for 23 rows, including this one); this is the only one of the 23 whose repository file still carries a different version. Renaming would place the file before `20260814113146` and `20260814114825`, which currently run before it creates `contact_inquiries` (an ordering defect worked around by `20260814120100`); rehearsed: with the file moved to that position all 67 versions still apply and the final catalog and data digests are identical to the full result. Options: **rename the file** (matches the precedent; changes a file in `main`; Production has recorded neither version), **alias record** for `20260814120000` on Development, **leave both unreconciled**. Recommendation: rename (the rehearsal found no difference), after you approve the change to a file in `main`.

## D-6. History records for versions that are not executed
For any version omitted from execution (net-zero pair, `20261010110000`, withdrawn cases), choose between a **marked history-only record** (truthful when the end state exists; the `statements` column carries an explicit marker) and **withdrawal**. Records must never claim execution.

## D-7. Timing and scope (unchanged)
Bookkeeping window (recommended: release window, inside the 24 h evidence freshness limit); whether Development is reconciled before or after Production; deploy-first order for `customer-cancel-order` and private-bucket consumers (Step 4).
