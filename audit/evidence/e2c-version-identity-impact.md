# E2C version-identity impact analysis (D-3, D-4, D-5)

**Analysis only.** No file was deleted, moved or renamed, no history was written, no hosted system was contacted. Inventories below were computed with the real pending-set calculator (`scripts/dev/migration-pending-set.cjs`, unmodified) on **hypothetical file lists** and the Stage B captured histories (`tools/e2c_inventory.cjs`, results in the protected scratch folder `e2c-scratch/e2c-inventory.json`). Evidence date: Stage B captures, Production 2026-10-16 18:54:59 UTC, Development 18:55:20 UTC. All of it must be re-verified against a fresh capture before any repository change is made.

## 1. Expected pending inventory before and after each change
| Scenario | Repository files | Production pending | Development pending | Development recorded without a file | Calculator findings (current alias document) |
|---|---|---|---|---|---|
| S0 current | 386 | 109 | 329 | 1 (`20260814002658`) | none |
| S1 withdraw Case 41 | 385 | 108 (`20260305203528` leaves) | 328 (same version leaves) | 1 | Production: 1 "alias contradicts data" |
| S2 withdraw Case 42 | 385 | 108 (`20260407203226` leaves) | 328 | 1 | Production: 1 |
| S3 withdraw both | 384 | 107 | 327 | 1 | Production: 2 |
| S4 rename alias only | 386 | 109 (`20260814120000` out, `20260814002658` in) | 328 (`20260814120000` out; recorded alias now matched) | 0 | Development: 1 (alias entry now contradicts the data) |
| S5 all three | 384 | 107 (cases out; alias version string changes) | 326 | 0 | 3 (stale alias entries) |
| S5b all three **and** an updated alias document (no aliases; Case 41/42 listed as withdrawn alongside Case 43) | 384 | **107** | **326** | 0 | **none** |
Reading it: (a) a withdrawal removes the version from both environments' pending lists and creates no history row; (b) the rename leaves Production's pending **count** unchanged (the version string changes, and it stays pending) and removes one pending version from Development because the recorded `20260814002658` finally matches a file; (c) until `version-aliases.json` is updated, the calculator reports the stale alias entries as findings, so the alias document and the pending-set test assertions must change in the same repository change; (d) of the 39 versions older than Production's latest recorded version, none changes, because `20260814120000` and `20260814002658` are both older.

Expected final history inventory after a completed Production release: repository 384 files = 277 recorded + 40 baseline (history-only, if each is proven or attested) + 67 (executed) in the 67-version case, or 277 + 40 + 58 executed + 9 history-only in the 58-version case. Either way 384 rows; only the row kinds differ.

## 2. Case 41 `20260305203528_add_customer_payment_amount` (D-3: withdraw and archive)
- **Hashes:** file sha256 `a6a679d26b0e7200990438338a66f684184721e4f80e60fd72cf2828bed601e8` (774 bytes). Related recorded Production version `20260305205811_add_customer_selected_payment_tracking.sql`, sha256 `8f6892b3bea402bf217f4c97bd2af29f9708cdae88e8ec7ac2f43cd847ecbe38` (1,246 bytes).
- **Difference that matters:** the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements are identical; the `UPDATE orders ... WHERE customer_selected_payment_cents IS NULL` backfill differs. Case 41 sets `customer_selected_payment_type = 'deposit'` for every NULL row; the recorded version sets `'full'` when `deposit_due_cents` covers subtotal + travel + surface + same-day pickup + tax, otherwise `'deposit'`. Local test (E2B-1, 13 synthetic orders): 13 `'deposit'` versus 12 `'deposit'` + 1 `'full'`. Executing Case 41 on Production could therefore overwrite the correct payment-type classification of any order whose selection is NULL.
- **Preserved SQL (so the archive loses nothing):**
```sql
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS customer_selected_payment_cents INTEGER,
ADD COLUMN IF NOT EXISTS customer_selected_payment_type TEXT;

UPDATE orders
SET customer_selected_payment_cents = deposit_due_cents,
    customer_selected_payment_type = 'deposit'
WHERE customer_selected_payment_cents IS NULL;
```
(The file's header comment and exact whitespace are in the file; the sha256 above identifies it.)
- **Production:** never recorded, pending now; after withdrawal not pending, still never recorded. Production's behavior comes from the recorded `20260305205811`; nothing changes there.
- **Development:** the columns exist (E2A: 2 present statements). Development has not recorded `20260305205811`, and its backfill result is unknown. Withdrawing Case 41 removes one pending Development version but does **not** settle `20260305205811` on Development (class P with an unprovable data statement; see the Development plan).
- **References to change in the implementing repository change (not now):** `audit/evidence/version-aliases.json` (remove the alias, add a withdrawn entry), `src/lib/tests/security/migrationPendingSet.test.ts` (the "evidence" assertions that cases 41 and 42 stay pending on Production, around line 144), the archive folder `audit/evidence/withdrawn-migrations/` (Case 43 precedent: `20260407211122_add_anon_insert_policy_order_changelog_cancellation.sql`), and the documentation. Historical evidence reports are records of what was true then and are not rewritten.
- **Hard rule carried forward:** the version must never be recorded in any history, and never executed.

## 3. Case 42 `20260407203226_add_refund_requested_to_orders` (D-4: withdraw and archive)
- **Hashes:** file sha256 `589560b47350a0d0c1ffe64988971fa89ea4c68330465d5b761b21b6e09f5170` (1,178 bytes); retained recorded counterpart `20260408200431_add_refund_requested_to_orders.sql`, sha256 `26988ec16332be273a76e857e4fecbf52331f90d317e7e7f4e0bdafb5f74e06f` (536 bytes).
- **Equivalence evidence:** after removing comments and collapsing whitespace the executable SQL digests are equal (`23fa13edf474228c...`, tool `c4_sql_fingerprint.py`, reported in `e2a-prod-alias-comparison.md`): a `DO $$` block that adds `orders.refund_requested boolean DEFAULT false` and a column comment only if the column is missing. The files differ in the header comment, which in Case 42 is the longer one.
- **What the archive must preserve:** the whole file including its long header (the only content not present in the retained file).
- **Limit:** the equivalence compares the repository files with digests of the recorded statements; the recorded statements text itself was not read (query in `e2a-unresolved-evidence.md` section D, not run).
- **Inventory:** Production 109 to 108, Development 329 to 328 (table in section 1). Production keeps `20260408200431` recorded; Development does not record either, so on Development the retained file remains a pending class-H candidate (E2A: schema effects present).
- **References to change later:** the same set as Case 41.

## 4. Development alias `20260814120000` versus recorded `20260814002658` (D-5, conditional)
The owner's condition: verify all cross-environment dependencies and risks; do not assume a rename is harmless. Results by condition:
| # | Condition or dependency | Result |
|---|---|---|
| 1 | Content identity | Satisfied: recorded SQL digests (normalized `c2fd5486...`, comment-free `faa9f2b1...`) equal the file's; DDL only (table, one index, RLS, one drop and one create of policies); no data effects. File sha256 `9ef0fe6e6f484c3a706f6beb8ab2f6c987d5bc0be8a0b04d6602f1f900ce4cd0`. |
| 2 | Production history | Satisfied (re-verify on fresh capture): Production recorded neither version, so no row is affected. Its pending count stays 109 (the string changes). |
| 3 | Development history | Satisfied: renaming makes the recorded row match a file, Development pending 329 to 328, "recorded without a file" 1 to 0. Development's `name` column (`20260814120000_create_contact_inquiries.sql`) would no longer equal the new filename; the CLI matches by version only, so this is cosmetic, and no history row is edited. |
| 4 | Position in the sequence | Changes: the file would sort between `20260723210953` and `20260814113146`, so it runs **before** the grant and upgrade migrations instead of after. Development's recorded versions show that is the order Development actually applied them: `20260814002658` (create), then `20260814113146` (grant, original name `...143000...`), then `20260814114825` (upgrade, original name `...150000...`). The ordering comment in `contactInquiryMigrations.test.ts` says Development "received them in that order" with the grant and upgrade first; the recorded versions do not support that reading, so the existing ordering story is an artifact of the version mismatch (inference: recorded versions are application timestamps, as the earlier alignment commit `ce5637b` assumed). |
| 5 | Effect on the migrations that follow in a Production run | Tested (`aliasfx`, `e2c-aliasfx.json`): in the current order `20260814113146` and `20260814114825` run when the table does not exist and change nothing, then `20260814120000` creates 9 columns and `20260814120100` adds the 10 invoice columns (19). In the alias order `20260814120000` creates 9, `20260814113146` re-grants (no catalog change, platform default ACLs already cover it), `20260814114825` adds the 10 columns (19) and `20260814120100` becomes the no-op. Final catalog and synthetic data digests are identical to the current order for both the 67-version and the 58-version sequences (`e2c-steps.json`: `full67_alias` and `c58_alias`, zero differences). |
| 6 | Interaction with D-1 | `20260814114825` is one of the nine omission candidates; with the alias order it is no longer a no-op, but omitting it is still catalog-equivalent because `20260814120100` adds the same columns and grant (tested: `c58_alias`). |
| 7 | Tests that encode the old order | `src/lib/tests/security/contactInquiryMigrations.test.ts` pins the four filenames (constants at lines 37 to 40), asserts "grant < upgrade < create" (line 49), "ensure after create" (line 50) and its header describes the old order; these assertions would fail after a rename by design and need to be rewritten. `migrationPendingSet.test.ts` has an "evidence" assertion (line 145) that `20260814120000` stays pending. |
| 8 | Stale wording inside migrations | `20260814113146`, `20260814114825` and `20260814120100` carry "Ordering note" comments saying they are versioned before `20260814120000`. After a rename they would be wrong. Editing them changes migration files (and their hashes in the D3 manifest); leaving them is harmless but misleading. Owner choice at implementation time. |
| 9 | Rehearsal and evidence manifests | `d3-selected-manifest.json` and `d2-selected-manifest.json` list files by name and sha256; a rename needs a new manifest revision. The reports remain correct for the order they rehearsed. |
| 10 | Other consumers | The Edge Function `submit-contact-inquiry` writes to the table; deploy order is table first, function second; unaffected by the version string. No application code references the migration version. |
| 11 | Local developer databases | **Open and unverifiable from the repository:** any developer database that already recorded `20260814120000` would see `20260814002658` as pending and the old version as recorded-without-file. |
| 12 | Safety restrictions | `--include-all` stays forbidden; the rename does not change the 39-older-versions problem (both versions are older than `20260928172217`). |
**Result:** no harm found in any rehearsal; the change is a multi-file repository change (file, alias document, two test files, optionally three comments, a manifest revision). Conditions 2 and 3 need re-verification on a fresh read-only capture, and condition 11 cannot be checked from here. I do not treat the rename as approved for execution; it is conditionally approved for planning.

## 5. Proposed implementing change set (for a later, separately authorized stage)
1. Move Case 41 and Case 42 files to `audit/evidence/withdrawn-migrations/` with an index recording sha256, the evidence reports that justify the withdrawal, and the retained counterpart; no history row.
2. Rename `20260814120000_create_contact_inquiries.sql` to `20260814002658_create_contact_inquiries.sql` (content unchanged).
3. Update `version-aliases.json` (S5b form), `contactInquiryMigrations.test.ts`, `migrationPendingSet.test.ts`; optionally the three ordering comments.
4. Publish a revised upgrade manifest and rerun the existing suites plus the D3/E2C sequence tests on the new file list.
5. Recompute inventories with the calculator; expected: Production 107, Development 326, no findings.
