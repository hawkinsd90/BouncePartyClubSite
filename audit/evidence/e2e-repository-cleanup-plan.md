# E2E repository cleanup: exact implementation proposal (nothing executed)

**Proposal only.** No file was moved, archived, renamed, deleted or edited in the real repository during E2E. Everything below was **simulated on disposable copies of the working tree** (`C:\Users\vikki\migration-evidence\e2e-scratch\repo-base`, `repo-c`, `repo-r`, outside Git) with `tools/e2e_cleanup_sim.py`, which refuses any path outside that folder, and the existing test suites were run against the copies. Executing any step needs its own explicit authorization. Facts are from the Stage B captures (2026-10-16), the E2C/E2D results and the simulation.

## 1. Result of the simulation (what the owner can rely on)
| Tree | Migration files | Migration-related suites (the 19 test files under `src/lib/tests` that read `supabase/migrations`) | Pending (Production / Development) |
|---|---|---|---|
| `repo-base` (current content) | 386 | all pass except 2 pre-existing failures (section 6); `refundSafety` reports 0 of 0 because its database layer is skipped without a configured scratch database | 109 / 329 |
| `repo-c` (Cases 41 and 42 withdrawn + the test and alias edits below) | 384 | identical results to base | 107 / 327 |
| `repo-r` (`repo-c` + alias file renamed to `20260814002658` + test edits below) | 384 | identical results to base; `contactInquiryMigrations` 59 of 59 (was 51: eight more assertions from the added legacy-order check) | 107 / 326 |
Negative controls: the **unedited** pending-set test fails 3 assertions against `repo-c` ("386 repository versions", "Production pending 109, Development pending 329", "cases 41 and 42 stay pending") and the unedited contact-inquiry test fails 3 assertions against `repo-r`; so the test edits are required, not optional. `recoveredMigrationFiles` (63) and `migrationReplaySafety` (144) pass unchanged on both copies. No other test file references the three versions (searched all of `src`, `scripts`, `supabase/functions`).

## 2. Discovery safety (why a withdrawn file cannot be picked up)
Every discovery path in the repository is a **non-recursive** `readdirSync` of `supabase/migrations` (the Supabase CLI convention, `scripts/dev/migration-replay.cjs`, the pending-set calculator and the test files). `supabase/config.toml` has no branch or remote migration setting and no `.github` workflow exists. A file under `audit/evidence/withdrawn-migrations/` is therefore never discovered, as Case 43 already demonstrates. The archived copy keeps the `.sql` extension so its bytes and hashes stay verifiable.

## 3. Case 41 `20260305203528_add_customer_payment_amount.sql` (D-3)
| Step | Operation |
|---|---|
| 3.1 | `git mv supabase/migrations/20260305203528_add_customer_payment_amount.sql audit/evidence/withdrawn-migrations/` (content unchanged; history follows the file) |
| 3.2 | Add/extend `audit/evidence/withdrawn-migrations/withdrawn-index.json` (exact content in section 5) |
| 3.3 | `audit/evidence/version-aliases.json`: remove the `prod` alias entry for `20260305203528`; add a `withdrawn` entry for it (patch in section 7) |
| 3.4 | `src/lib/tests/security/migrationPendingSet.test.ts`: edit the three evidence assertions (patch in section 7) |
| 3.5 | No migration SQL is edited; no history row is written anywhere |
- **Preserved:** the SQL (archive), SHA-256 of the working-copy bytes `a6a679d26b0e7200990438338a66f684184721e4f80e60fd72cf2828bed601e8` (774 bytes, CRLF in this checkout) and of the LF-normalized text `b322d4f57d596a4a...` (full value in the index), and the evidence of the differing backfill: recorded `20260305205811` sets `customer_selected_payment_type` to `'full'` when `deposit_due_cents` covers subtotal + travel + surface + same-day pickup + tax and `'deposit'` otherwise, whereas Case 41 sets `'deposit'` for every NULL row (local test, E2B-1: 13 `'deposit'` versus 12 `'deposit'` and 1 `'full'`); reports `e2a-prod-alias-comparison.md`, `e2b1-report.md`, `e2c-version-identity-impact.md`.
- **Inventory effect:** Production pending 109 to 108, Development 329 to 328, repository 386 to 385; nothing is recorded anywhere.
- **Development note:** Development has not recorded `20260305205811`; that version stays a pending class-P item in the Development manifest (backfill unprovable) and is *not* resolved by this withdrawal.

## 4. Case 42 `20260407203226_add_refund_requested_to_orders.sql` (D-4)
Steps 4.1 to 4.5 mirror Case 41 (move, index entry, alias document, pending-set test; no history row).
- **Preserved:** SHA-256 of the working-copy bytes `589560b47350a0d0c1ffe64988971fa89ea4c68330465d5b761b21b6e09f5170` (1,178 bytes) and of the LF text; the **whole file including its long header**, the only content absent from the retained counterpart `20260408200431_add_refund_requested_to_orders.sql` (sha256 `26988ec16332be273a76e857e4fecbf52331f90d317e7e7f4e0bdafb5f74e06f`, 536 bytes, recorded in Production).
- **Equivalence evidence kept:** the executable-SQL digest of both files is `23fa13edf474228c...` (comment-removed, whitespace-collapsed; `tools/c4_sql_fingerprint.py`, reported in `e2a-prod-alias-comparison.md`): a `DO $$` block adding `orders.refund_requested boolean DEFAULT false` plus a column comment only when the column is missing. Equivalence rests on that digest, not on the file names. The recorded `statements` text itself was not read (digest only).
- **Inventory effect:** Production 109 to 108 (both cases: 107), Development 329 to 328 (both: 327).

## 5. Archive index (exact content, produced by the simulation)
`audit/evidence/withdrawn-migrations/withdrawn-index.json` lists the three withdrawn files with `version`, `file`, `sha256_working_copy_bytes`, `sha256_lf_normalized`, `bytes`, `reason`, `retained_counterpart` and `never_record_in_any_history: true`; it doubles as the executor deny list. Values: Case 41 `a6a679d2...e8` / LF `b322d4f5...`, 774 bytes; Case 42 `589560b4...70` / LF `0947816e...`, 1,178 bytes; Case 43 `9e09c0a24aec4b6fa4e6403b64f8c89b4f2488af977c6055d3916ef16b7c0a85` / LF `12e457dd...`, 1,007 bytes. Because this checkout stores CRLF (git index is LF, `core.autocrlf=true`), **the LF-normalized digest is the stable identity**; the working-copy digest only reproduces on this checkout.

## 6. Pre-existing test failures (not caused by, and not fixed by, the cleanup)
Two assertions fail identically on the current tree and on both simulated trees, so they are not regressions of this proposal:
1. `coreDatabaseAccess.test.ts` (307 passed, 1 failed): "before the booking migration the column is only mentioned by this migration and by the older approval function body": it predates the recovery of Production-only `20251126190624_add_customer_approval_workflow.sql`, which also mentions `customer_approved_at` (the test's allow-list does not contain it). This is also the evidence that the test's premise behind `20261010110000` is wrong, which supports the E2C finding that `20261010110000` is a no-op in Production.
2. `databaseFunctionAccessClassification.test.ts` (59 passed, 1 failed): "no earlier migration creates the billing addresses table (it exists only on the live database)": the recovered Production migration `20260501173826_add_billing_addresses_table.sql` (commit `014615b`) now creates it.
Both are test-expectation updates that need their own authorization; they are listed as unresolved decision U-E2E-9.

## 7. Exact edits (tested on the copies)
### 7.1 Withdrawal of Cases 41 and 42 (repo-c)
```diff
--- a/audit/evidence/version-aliases.json
+++ b/audit/evidence/version-aliases.json
@@ -3,11 +3,23 @@
   "aliases": [
-    { "env": "prod", "local_version": "20260305203528", "recorded_version": "20260305205811", "kind": "case-41 related-but-not-identical SQL",
-      "note": "Prod recorded add_customer_selected_payment_tracking under a different version; the SQL differs (Stage B report, case 41)." },
-    { "env": "prod", "local_version": "20260407203226", "recorded_version": "20260408200431", "kind": "case-42 related-but-not-identical SQL",
-      "note": "Prod recorded add_refund_requested_to_orders under a different version; the SQL differs (Stage B report, case 42)." },
-    { "env": "dev", "local_version": "20260814120000", "recorded_version": "20260814002658", "kind": "dev recorded the migration under a different version",
-      "note": "Dev recorded this migration as 20260814002658 (Stage B notes); the repository file is 20260814120000." }
+    {
+      "env": "dev",
+      "local_version": "20260814120000",
+      "recorded_version": "20260814002658",
+      "kind": "dev recorded the migration under a different version",
+      "note": "Dev recorded this migration as 20260814002658 (Stage B notes); the repository file is 20260814120000."
+    }
   ],
   "withdrawn": [
-    { "version": "20260407211122", "note": "Case 43, withdrawn before application in Stage C3 (audit/evidence/withdrawn-migrations/). Must not be in the repository and must not be recorded in any history." }
+    {
+      "version": "20260407211122",
+      "note": "Case 43, withdrawn before application in Stage C3 (audit/evidence/withdrawn-migrations/). Must not be in the repository and must not be recorded in any history."
+    },
+    {
+      "version": "20260305203528",
+      "note": "Case 41, withdrawn (D-3); SQL preserved in audit/evidence/withdrawn-migrations/. Must not be in the repository and must not be recorded in any history."
+    },
+    {
+      "version": "20260407203226",
+      "note": "Case 42, withdrawn (D-4); executable SQL identical to recorded 20260408200431; preserved in audit/evidence/withdrawn-migrations/. Must not be in the repository and must not be recorded in any history."
+    }
   ]
--- a/src/lib/tests/security/migrationPendingSet.test.ts
+++ b/src/lib/tests/security/migrationPendingSet.test.ts
@@ -139,7 +139,7 @@
   ok('evidence: no findings in the repository or either history', loc.findings.length === 0 && P.findings.length === 0 && D.findings.length === 0);
-  ok('evidence: 386 repository versions', loc.versions.length === 386);
+  ok('evidence: 384 repository versions (Cases 41 and 42 withdrawn)', loc.versions.length === 384);
   ok('evidence: 277 Production and 58 Development recorded', P.recorded_count === 277 && D.recorded_count === 58);
-  ok('evidence: Production pending 109, Development pending 329', P.pending_count === 109 && D.pending_count === 329);
+  ok('evidence: Production pending 107, Development pending 327', P.pending_count === 107 && D.pending_count === 327);
   ok('evidence: Case 43 is not pending anywhere and not in the repository', !P.pending_versions.includes('20260407211122') && !D.pending_versions.includes('20260407211122') && !loc.versions.includes('20260407211122'));
-  ok('evidence: cases 41 and 42 stay pending on Production (annotated, not removed)', P.pending_versions.includes('20260305203528') && P.pending_versions.includes('20260407203226') && P.alias_annotations.length === 2);
+  ok('evidence: cases 41 and 42 are withdrawn: not in the repository, not pending anywhere, no alias annotation', ['20260305203528', '20260407203226'].every((v: string) => !loc.versions.includes(v) && !P.pending_versions.includes(v) && !D.pending_versions.includes(v)) && P.alias_annotations.length === 0);
   ok('evidence: Development 20260814120000 stays pending; 20260814002658 is recorded without a local file', D.pending_versions.includes('20260814120000') && same(D.recorded_without_local_file, ['20260814002658']));
```

### 7.2 Alias alignment on top of 7.1 (repo-r; only if the owner later approves the rename)
```diff
--- a/audit/evidence/version-aliases.json
+++ b/audit/evidence/version-aliases.json
@@ -2,11 +2,3 @@
   "purpose": "Documented relationships between a repository migration version and a DIFFERENT recorded history version. ANNOTATIONS ONLY: the pending-set calculator never removes a version from the pending set because of an alias, and nothing here renames a file or marks anything applied.",
-  "aliases": [
-    {
-      "env": "dev",
-      "local_version": "20260814120000",
-      "recorded_version": "20260814002658",
-      "kind": "dev recorded the migration under a different version",
-      "note": "Dev recorded this migration as 20260814002658 (Stage B notes); the repository file is 20260814120000."
-    }
-  ],
+  "aliases": [],
   "withdrawn": [
--- a/src/lib/tests/security/contactInquiryMigrations.test.ts
+++ b/src/lib/tests/security/contactInquiryMigrations.test.ts
@@ -3,5 +3,5 @@
 // Three migrations touch public.contact_inquiries. Two of them (the service-role grant and the invoice-ready columns) are
-// versioned BEFORE the one that creates the table, because the hosted Development database received them in that order. Their
-// versions cannot change, so they must be safe on a database that has no table yet, and a later corrective migration must
-// guarantee the same end state everywhere.
+// versioned AFTER the one that creates the table (20260814002658), which is the order the hosted Development database applied them. They
+// stay guarded so they are also safe on a database that has no table yet (the legacy order is still tested), and a later corrective
+// migration must guarantee the same end state everywhere.
 //
@@ -38,3 +38,3 @@
 const UPGRADE = '20260814114825_upgrade_contact_inquiries_for_invoices.sql';
-const CREATE = '20260814120000_create_contact_inquiries.sql';
+const CREATE = '20260814002658_create_contact_inquiries.sql';
 const ENSURE = '20260814120100_ensure_contact_inquiries_invoice_fields.sql';
@@ -48,3 +48,3 @@
 ok('static: all four contact-inquiry migrations exist', [GRANT, UPGRADE, CREATE, ENSURE].every((f) => order(f) >= 0));
-ok('static: the historical versions are unchanged (grant < upgrade < create)', order(GRANT) < order(UPGRADE) && order(UPGRADE) < order(CREATE));
+ok('static: the table is created first (create < grant < upgrade), the order Development applied them', order(CREATE) < order(GRANT) && order(GRANT) < order(UPGRADE));
 ok('static: the corrective migration runs after the table is created', order(ENSURE) > order(CREATE));
@@ -135,3 +135,3 @@
     const db1 = fresh('empty');
-    for (const f of [GRANT, UPGRADE, CREATE, ENSURE]) {
+    for (const f of [CREATE, GRANT, UPGRADE, ENSURE]) {
       const r = apply(db1, read(DIR + f));
@@ -147,2 +147,7 @@
     }
+
+    // 1b. Legacy order (guards): the grant and upgrade files before the table exists must still apply strictly.
+    const dbL = fresh('legacy');
+    for (const f of [GRANT, UPGRADE, CREATE, ENSURE]) ok(`executed/legacy-order: ${f} applies strictly`, apply(dbL, read(DIR + f)).status === 0);
+    finalOk('executed/legacy-order', state(dbL));
 
--- a/src/lib/tests/security/migrationPendingSet.test.ts
+++ b/src/lib/tests/security/migrationPendingSet.test.ts
@@ -141,6 +141,6 @@
   ok('evidence: 277 Production and 58 Development recorded', P.recorded_count === 277 && D.recorded_count === 58);
-  ok('evidence: Production pending 107, Development pending 327', P.pending_count === 107 && D.pending_count === 327);
+  ok('evidence: Production pending 107, Development pending 326', P.pending_count === 107 && D.pending_count === 326);
   ok('evidence: Case 43 is not pending anywhere and not in the repository', !P.pending_versions.includes('20260407211122') && !D.pending_versions.includes('20260407211122') && !loc.versions.includes('20260407211122'));
   ok('evidence: cases 41 and 42 are withdrawn: not in the repository, not pending anywhere, no alias annotation', ['20260305203528', '20260407203226'].every((v: string) => !loc.versions.includes(v) && !P.pending_versions.includes(v) && !D.pending_versions.includes(v)) && P.alias_annotations.length === 0);
-  ok('evidence: Development 20260814120000 stays pending; 20260814002658 is recorded without a local file', D.pending_versions.includes('20260814120000') && same(D.recorded_without_local_file, ['20260814002658']));
+  ok('evidence: Development 20260814002658 is recorded and has a repository file; 20260814120000 no longer exists', loc.versions.includes('20260814002658') && !loc.versions.includes('20260814120000') && D.recorded_without_local_file.length === 0 && D.alias_annotations.length === 0);
   const octo = loc.versions.filter((v: string) => v >= '20261007000000');
```
The renamed file is the old file byte for byte (`git mv supabase/migrations/20260814120000_create_contact_inquiries.sql supabase/migrations/20260814002658_create_contact_inquiries.sql`).
`version-aliases.json` is shown re-serialized by the simulation; the real edit is only the removal of the three `aliases` objects and the addition of the two `withdrawn` objects, preserving the file's existing layout.

## 8. Development alias `20260814120000` versus recorded `20260814002658` (D-5)
**Determination: the consequences inside the repository and inside both captured histories are fully characterized and show no harm, but two assumptions outside the repository cannot be verified here. The rename is therefore NOT cleared for execution; it stays a separately gated item. Until the owner clears it, keep the file name and the alias annotation (no change).**
### 8.1 Verified
| # | Check | Result |
|---|---|---|
| V1 | Content identity | recorded SQL digests (normalized `c2fd5486...`, comment-free `faa9f2b1...`) equal the file's; DDL only; file sha256 (working copy) `9ef0fe6e6f484c3a706f6beb8ab2f6c987d5bc0be8a0b04d6602f1f900ce4cd0` |
| V2 | Production history (277-row capture) | contains neither `20260814120000` nor `20260814002658`; no row is affected; Production pending stays 109 before other changes (the version string changes) |
| V3 | Development history (58-row capture) | contains `20260814002658` (name `20260814120000_create_contact_inquiries.sql`) and not `20260814120000`; after the rename the calculator reports no "recorded without a file" entry and Development pending falls by one (329 to 328; 326 with the Case 41/42 withdrawal) |
| V4 | Order Development really applied them | recorded versions `20260814002658` (create), `20260814113146` (grant, original name `...143000...`), `20260814114825` (upgrade, original name `...150000...`): create first. The current repository order (grant, upgrade, then create) is the opposite, which is why `20260814120100` exists |
| V5 | The 58-version Production candidate | the file is an `execute` item; moving it before `20260814113146`/`20260814114825` was run in E2C (`c58_alias`: 0 catalog differences in 19 categories, equal row digests) and, in E2E, the full D4 scenario set was rerun on the alias-ordered 58: **94 of 94 checks pass, and the expected/actual text of every one of the 94 is identical to the non-renamed 58 run** (`e2e_alias_run.py`) |
| V6 | Behavior of the four contact-inquiry migrations | current order: `20260814113146` and `20260814114825` find no table and change nothing, `20260814120000` creates 9 columns, `20260814120100` adds 10 (19). Alias order: create (9), grant re-applied (no catalog change), upgrade adds the 10 columns, `20260814120100` becomes the no-op. Identical end state (19 columns, service_role INSERT/SELECT/UPDATE, anon/authenticated none, RLS with one admin SELECT policy) |
| V7 | Tests on the renamed copy | `contactInquiryMigrations` 59 of 59 with the edits in 7.2 (the unedited test fails 3 assertions: file names, order, the "only these four migrations" list), `migrationPendingSet` 54, `migrationReplaySafety` 144, `recoveredMigrationFiles` 63; the other migration-reading suites are unchanged |
| V8 | Other references | `d2-selected-manifest.json`/`d3-selected-manifest.json` list the old file name and hash (a revised manifest is needed for any future rehearsal on the renamed tree; the 67/58 content and hash do not change); evidence reports and the tool constants in `tools/e1_analyze.py`, `e2*.py` refer to the old string (historical, not rewritten); three migration comments (`20260814113146`, `20260814114825`, `20260814120100`) say the files are "versioned before 20260814120000": after a rename they would be wrong but harmless (editing them changes migration files and hashes, an owner choice) |
| V9 | Hosted CLI behavior | not relied on; no CLI is used against a hosted project; the rename changes only a local file name |
### 8.2 Unresolved assumptions (cannot be verified from the repository or the captures)
| # | Assumption | How it could fail | How to resolve |
|---|---|---|---|
| A1 | No developer or local database, CI database or demo database has `20260814120000` recorded | such a database would show `20260814002658` as pending and `20260814120000` as recorded without a file; a push there could try to re-create the table (the file is guarded, `CREATE TABLE IF NOT EXISTS`, but policies are dropped and re-created) | owner attestation, or ask each developer to run the read-only pending-set calculator against their database |
| A2 | No other hosted or preview environment (staging, branch database, a second project) recorded either version | same as A1 | owner confirmation of the full list of environments (only Production `qaagfafagdpgzcijnfbw` and Development `srxunxiytojjsuhcmzjg` are known) |
| A3 | No runbook, ticket, deployment script or external document refers to the old version string | stale reference | owner/search of external systems |
| A4 | Development's recorded row and the file are still identical at the time of the change | history changed since 2026-10-16 | fresh read-only capture (24 h rule) before the change |
| A5 | The Production history still contains neither version | same | same fresh capture |
Decision rule: rename only if A1 to A3 are attested by the owner and A4/A5 are re-verified; otherwise leave as is. Either way the 58-version plan, the Production result and the Development manifest are unaffected, because the pending count of Production does not change and Development's row is already recorded.

## 9. Implementation checklist for a later, separately authorized stage
1. Re-run the preflight (branch, HEAD, 386 files, hashes of the 317 historical and 67 candidate files) and take a fresh capture if the rename is included.
2. Apply sections 3 and 4 (two `git mv`, the index, `version-aliases.json`, the pending-set test). Optionally 7.2 afterwards, as its own commit.
3. Run `recoveredMigrationFiles` (63), `migrationReplaySafety` (144), `migrationPendingSet` (54), `contactInquiryMigrations` (51; 59 after 7.2) and the other migration-reading suites; expect the same two pre-existing failures and nothing else.
4. Recompute the pending sets with the calculator against the captured histories: expected repository 384, Production 107, Development 327 (326 after 7.2), zero findings.
5. Regenerate the upgrade manifest if the rename is applied (file name/hash of one row, new order position) and rerun the E2D scenario set on it.
6. Stage and commit only the explicit paths above; no history is written anywhere.
7. Update the audit file.
Tooling that reads the original paths and would no longer reproduce unchanged (historical rehearsal tooling, not release tooling): `tools/e2b1_rehearse.py case41` (opens the Case 41 file), `tools/d3_upgrade.py` (asserts the two Production alias versions), and the evidence tools' hard-coded version constants. Accepted as documented limitations or repointed to the archive in the same change.
