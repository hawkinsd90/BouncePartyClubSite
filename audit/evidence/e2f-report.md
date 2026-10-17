# Stage E2F report: approved historical migration withdrawals (Cases 41 and 42)

Branch `Dev`, HEAD `efda4177433258c4b2c469e5aa381bc2545f36ba` (unchanged; nothing committed). Repository-only change authorized by the owner (decisions D-3 and D-4), implemented exactly as simulated in `e2e-repository-cleanup-plan.md` sections 3, 4 and 7.1. **No hosted system was contacted, no migration SQL was run or edited, no history row was written, the Development alias file was not touched, no application code changed.**

## 1. Preflight (before any change)
Branch `Dev`, HEAD `efda417`; checkpoint commits `831ea94`, `992da3a`, `fa08fb5`, `d36af73`, `63672cd`, `eb0b43c`, `efda417` present; 386 active migration files; nothing staged; `.gitignore` modified by another workstream (untouched). Protected hashes at the start: Case 41 `a6a679d2...e8` (774 bytes), Case 42 `589560b4...70` (1,178 bytes), Case 43 archive `9e09c0a2...85` (1,007 bytes), alias file `20260814120000` `9ef0fe6e...d0` (1,105 bytes).

## 2. The two withdrawals
| Case | Moved with `git mv` | Original = archived SHA-256 (working-copy bytes) | Git detects |
|---|---|---|---|
| 41 | `supabase/migrations/20260305203528_add_customer_payment_amount.sql` to `audit/evidence/withdrawn-migrations/` | `a6a679d26b0e7200990438338a66f684184721e4f80e60fd72cf2828bed601e8`, 774 bytes, identical | rename, 100% similarity |
| 42 | `supabase/migrations/20260407203226_add_refund_requested_to_orders.sql` to the same folder | `589560b47350a0d0c1ffe64988971fa89ea4c68330465d5b761b21b6e09f5170`, 1,178 bytes, identical | rename, 100% similarity |
Contents, filenames and line endings were not touched. LF-normalized digests (the form git stores) are in `withdrawn-index.json`.
- **Case 41 context:** its `ADD COLUMN` statements equal Production-recorded `20260305205811`, but its backfill differs materially: it sets `customer_selected_payment_type` to `'deposit'` for every NULL row, whereas `20260305205811` sets `'full'` when `deposit_due_cents` covers subtotal + travel + surface + same-day pickup + tax and `'deposit'` otherwise (E2B-1 local test on 13 synthetic orders: 13 `'deposit'` versus 12 `'deposit'` and 1 `'full'`). It was never executed and no alternative migration was created.
- **Case 42 context:** executable SQL identical (digest `23fa13edf474228c...`) to Production-recorded `20260408200431`; only the longer header comment differs, kept in the archived copy. Never executed; no history row inserted.

## 3. Metadata and test changes (minimum required)
- `audit/evidence/withdrawn-migrations/withdrawn-index.json` (new): entries for Cases 41, 42 and 43 with both SHA-256 forms, byte counts, reason, retained counterpart, evidence references and `never_record_in_any_history`. The Case 43 entry records its existing hash; the Case 43 file itself is untouched.
- `audit/evidence/version-aliases.json`: removed the two Production alias objects for `20260305203528` and `20260407203226` (they would otherwise contradict the data); added two `withdrawn` objects with the same wording style as Case 43. The Development alias object (`20260814120000` to `20260814002658`) is unchanged. Textual edits only; file layout preserved.
- `src/lib/tests/security/migrationPendingSet.test.ts`: three assertions in the EVIDENCE section: `386` to `384` repository versions; Production/Development pending `109/329` to `107/327`; "cases 41 and 42 stay pending on Production" to "are withdrawn: not in the repository, not pending anywhere, no alias annotation". The Development alias assertion is unchanged. No other test, script or document stated an active-inventory number that became wrong (searched `scripts`, `src`, `docs`, `README.md`).
- Historical audit documents (E2A to E2E reports, the Stage B and C reports, the audit file's earlier sections) were not rewritten; they describe the state at their dates. Evidence tools that open the old paths are historical and are listed in the E2E plan as accepted limitations.

## 4. Inventories (same captured histories, Stage B 2026-10-16)
| | Before | After |
|---|---|---|
| Active migration files | 386 | **384** |
| Production recorded / pending | 277 / 109 | 277 / **107** |
| Development recorded / pending | 58 / 329 | 58 / **327** |
| Calculator findings (Production, Development) | none | none |
| Development "recorded without a local file" | `20260814002658` | `20260814002658` (unchanged) |
| October migrations pending in both | 23 | 23 |
Computed with the unmodified pending-set calculator (`scripts/dev/migration-pending-set.cjs`) through the test's evidence layer and `tools/e2c_inventory.cjs` scenario S0; both give 384 / 107 / 327.

## 5. Verification results
- Withdrawn versions absent from active discovery: yes (all discovery is a non-recursive read of `supabase/migrations`).
- Archived copies equal the original SHA-256: Cases 41 and 42 yes; Case 43 unchanged.
- No executable SQL changed: every one of the 384 remaining active files equals its `HEAD` content (LF-normalized), `git diff` shows only the two 100% renames under `supabase/`; the D3 67-candidate hashes still verify; the alias file hash `9ef0fe6e...d0` is unchanged.
- Migration order/security: only removals; neither case is in the 67 or the 58; `migrationReplaySafety` 144 of 144; no behavior of any remaining migration changed.
- Tests (all 19 test files under `src/lib/tests` that read `supabase/migrations`): results are identical to the E2E base run except the three edited assertions, which now pass. `migrationPendingSet` 54 of 54; `recoveredMigrationFiles` 63 of 63; `migrationReplaySafety` 144 of 144; `contactInquiryMigrations` 51 of 51 (0 skipped); `bookingConfirmationClaim` 17; `orderEventAddress` 62; `paymentOperations` 18; `portalLinks` 217; `pricingReconciliation` 197; `adminAccessHardening` 83; `customerPhotoAccess` 270; `databaseHardening` 21; `orderEvidenceAccess` 369; `paymentRpcHandlerAuthorization` 246; `privateMediaAccess` 125; `publicBookingSecurity` 355; `roleAssignment` 57; `refundSafety` reports 0 of 0 (its database layer is skipped without a configured scratch database).
- **Two pre-existing failing assertions, documented and not repaired (out of scope):** `coreDatabaseAccess.test.ts` 307 passed, 1 failed ("before the booking migration the column is only mentioned by this migration and by the older approval function body": its allow-list predates recovered `20251126190624_add_customer_approval_workflow.sql`), and `databaseFunctionAccessClassification.test.ts` 59 passed, 1 failed ("no earlier migration creates the billing addresses table": recovered `20260501173826_add_billing_addresses_table.sql` now creates it). Both failed identically at `efda417` before this stage.

## 6. Git consequence to note
`git mv` stages a rename by definition, so the two moves are the **only staged changes**; nothing else is staged, no commit was made. All other changes are unstaged or untracked.

## 7. Restrictions honored
No hosted Production or Development connection or write; no history repair or insert; no Supabase CLI; no Docker, WSL or payment-provider call; no migration SQL executed (a local scratch PostgreSQL was started for the existing test suites and stopped afterwards); no executable SQL modified; no Development alias rename; no deployment or application change; no commit, push, merge or branch switch; the executor implementation was not started.
