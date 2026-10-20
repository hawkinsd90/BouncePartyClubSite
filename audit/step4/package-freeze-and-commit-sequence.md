# Package integrity, uncommitted-file inventory, commit sequence and freeze

Updated 2026-10-19 (Step 4A.4). The local merge of `origin/Dev` was performed and the files below are committed in three groups; the resulting commit hashes are in the Step 4A.4 report. The inventory grew from 34 to 37 files: Step 4A.4 added `thirteen-migration-review.md`, `exclusion-alternatives-oracle.json` and `exclusion-alternatives-oracle.py`.

## 1. Current state (verified)
| Item | Value |
|---|---|
| Branch / HEAD before Step 4A.4 | `Dev`, `0ea1ffe164f716babf03419f82b60ca56dae5c67` ("update link/reference image", 2026-10-19, the owner's commit: `index.html` and `public/og-image.jpg` only). Parent chain: `ecdda40` (Step 3 tip) |
| `origin/Dev` / `origin/main` | `aeb708ed9d5f0fbc2b146a52d378babd07024b30` / `b79ca480d244808a1926ef6f87dc5666a1dee052` (fresh `ls-remote`) |
| Ahead / behind | before: **104 ahead, 1 behind**. Step 4A.4 merged `origin/Dev` (`aeb708e`, a one-file deletion) with `git merge --no-ff`: merge commit `9085630bc253eea1286ddf6746f1b869a919c5f2`, then 105 ahead, 0 behind; `ecdda40` remains an ancestor |
| Staged | 0 |
| Uncommitted before the commits | 34 untracked files (section 3) plus the 3 added in Step 4A.4. `index.html` and `og-image.jpg` are committed and are **not** part of them |
| Sealed package | `audit/step4/executor/dev-package-oct-s3b.sealed.json`, `document_sha256 = 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0`, bound to commit `ecdda40`, which **is** an ancestor of HEAD |
| The 28 migration files | no change under `supabase/`, `scripts/`, `src/` or `audit/` between `ecdda40` and HEAD; a fresh `build --commit ecdda40...` equals the sealed package |

## 2. What binds to what
| Check | Bound to | Effect of the owner's commit and of later planning commits |
|---|---|---|
| File content | the content of each of the 28 files at the package commit; the working tree must equal it | none |
| Git HEAD identity | **not used**: only the existence of the package commit (`ecdda40`) | HEAD moved to `0ea1ffe`; still valid |
| Authorization hash | the package `document_sha256`, the base-ledger export identity, the restore point | unchanged |
| Fingerprint chain | sealed rehearsal values | unchanged (no migration or fingerprint change) |
| Execution manifests, deny list | Step 2 bookkeeping operations | untouched |
| Clean checkout | committed inputs only | verified earlier in a throwaway clone: unit suite green after the planning files were committed |
| Reconciliation with `origin/Dev` | a **merge** keeps `ecdda40` and all 104 hashes; a rebase would remove `ecdda40` from the branch history and weaken the package's Git identity | use the merge (`git-remote-reconciliation.md`) |

## 3. Inventory of the 37 files (34 from Step 4A.3 plus 3 added in Step 4A.4)
Columns: **R** required for the Development rollout, **A** required for recovery or auditability, **dup** duplicated by another file, **regen** can be regenerated from files in the repository, **dep** depended on by other files or tests, **sec** protected data or secrets (every file scanned: none; the only hits are dummy `postgresql://postgres:p@...` URLs used as test inputs in `rehearse.cjs` and the test).
| Path | Purpose | R | A | dup | regen | dep | Commit group |
|---|---|---|---|---|---|---|---|
| `scripts/dev/hosted-executor/dev-migration-executor.cjs` | the exact-version executor | yes | yes | no | no (source) | package, rehearsal, test, README | 3 |
| `scripts/dev/hosted-executor/lib/fingerprint.cjs` | catalog fingerprint SQL | yes | yes | no | no | executor, rehearse, test | 3 |
| `scripts/dev/hosted-executor/rehearse.cjs` | 96-check rehearsal harness | no | yes | no | no | results JSON, test | 3 |
| `scripts/dev/hosted-executor/build-gate.cjs` | generates the 20-check S11 gate | yes | yes | no | no | `s11-gate-checks.sql`, test | 3 |
| `scripts/dev/hosted-executor/cli-oracle.py` | real-CLI oracle (local scratch only) | no | yes | no | no | `cli-oracle-results.json`, test | 3 |
| `scripts/dev/hosted-executor/README.md` | executor design and authorization format | yes | yes | no | no | test | 3 |
| `src/lib/tests/security/devMigrationExecutor.test.ts` | unit and static checks of all of the above | no | yes | no | no | reads the package, results, register, matrices, canary, runbook and four documents | 3 (green only at the tip) |
| `audit/step4/executor/dev-package-oct-s3b.sealed.json` | sealed 28-file package | yes | yes | no | only with the scratch database and protected fixtures | executor, test, this file | 3 |
| `audit/step4/executor-rehearsal-results.json` | rehearsal evidence (96/96) | no | yes | no | yes (`rehearse.cjs`, scratch DB) | test | 3 |
| `audit/step4/executor-rehearsal-results.hostlike.json` | hosted-like privilege result per file | no | yes | no | yes (same run) | test | 3 |
| `audit/step4/s11-gate-checks.sql` | read-only containment-release gate | yes | yes | no | yes (`build-gate.cjs`) | runbook, test | 3 |
| `audit/step4/g16-storage-canary.sql` | always-aborting storage canary | yes | yes | no | no | runbook, test | 3 |
| `audit/step4/cli-oracle-results.json` | real-CLI evidence | no | yes | no | yes (`cli-oracle.py`) | test, recovery plan | 3 |
| `audit/step4/development-deployment-runbook.md` | the staged runbook | yes | yes | no | no | test | 1 |
| `audit/step4/standard-migration-recovery-plan.md` | recovery to standard migrations | yes | yes | no | no | none | 1 |
| `audit/step4/backup-options-comparison.md` | backup options and recommendation | yes | no | overlaps `d02` (kept: d02 holds the owner procedure) | no | test | 1 |
| `audit/step4/d02-restore-point-procedure.md` | owner steps for the restore point | yes | no | partly `backup-options-comparison.md` | no | none | 1 |
| `audit/step4/d03-netlify-and-integration-control.md` | integration and Netlify facts and steps | yes | yes | no | no | none | 1 |
| `audit/step4/g16-storage-capability.md` | storage-policy analysis | yes | yes | no | no | none | 1 |
| `audit/step4/provider-safety-checklist.md` | provider configuration and validation | yes | no | no | no | test | 1 |
| `audit/step4/sec005-demo-account-owner-procedure.md` | demo-account procedure | yes | yes | no | no | none | 1 |
| `audit/step4/git-remote-reconciliation.md` | Git state and options | yes | no | no | no | test | 1 |
| `audit/step4/bolt-access-control.md` | background note on Bolt (not a requirement; owner decision, Step 4B AUTH-1) | yes | no | no | no | none | 1 |
| `audit/step4/rollback-and-recovery-plan.md` | failure responses | yes | yes | no | no | none | 1 |
| `audit/step4/thirteen-migration-review.md` | independent review of the 13 unresolved historical migrations | yes | yes | no | no | none | 1 |
| `audit/step4/exclusion-alternatives-oracle.json` | real-CLI evidence for exclusion alternatives | no | yes | no | yes (the script, scratch DB) | recovery plan, review | 3 |
| `scripts/dev/hosted-executor/exclusion-alternatives-oracle.py` | local-only experiment producing that JSON | no | yes | no | no | the JSON | 3 |
| `audit/step4/package-freeze-and-commit-sequence.md` | this file | yes | yes | no | no | test | 1 |
| `audit/step4/owner-approval-checklist.md` | readable gate list | yes | no | **duplicates the register** (generated from it) | only with the session generator | none | 1 |
| `audit/step4/step4a-readiness-report.md` | verification record with addenda | no | yes | overlaps the evidence index | no | none | 1 |
| `audit/step4/step4a-evidence-index.md` | what was observed and how | no | yes | overlaps the readiness report | no | none | 1 |
| `audit/step4/owner-decisions-and-gates.md` | earlier gate text, now superseded by the register | no | yes (history) | **superseded by the register** | no | none | 1 |
| `audit/step4/owner-gates-register.csv` | the 31-gate register | yes | yes | no | only with the session generator | test | 2 |
| `audit/step4/edge-function-jwt-compatibility-matrix.csv` | 25 per-function JWT decisions | yes | yes | no | only with the session generator | test | 2 |
| `audit/step4/edge-function-deployment-matrix.csv` | 53-function deployment matrix | yes | yes | no | only with the session generator | none | 2 |
| `audit/step4/development-integration-test-matrix.csv` | 119 post-deployment tests | yes | no | no | only with the session generator | none | 2 |
| `audit/step4/migration-reconciliation-matrix.csv` | 393-row Development migration matrix | yes | yes | derived from the committed Step 2 manifests plus hosted observations | only with the session generator | none | 2 |
**Regeneration caveat:** the generators for the five CSV files and the checklist live in the session's scratch folder, not in the repository, so those files are the only copies. Committing them preserves the work; if you want them rebuildable, the generators can be added as a separate reviewed change. Overlap candidates (`owner-decisions-and-gates.md`, `owner-approval-checklist.md`, parts of the readiness report and evidence index) are listed, not removed.

## 4. Proposed commit sequence (needs your approval; nothing is committed)
1. **Reconcile Git first (local): done in Step 4A.4** (`git fetch origin Dev`, `git merge --no-ff origin/Dev`, clean). Not part of the three commits below.
2. **Commit group 1** `docs(step4): add the Development rollout planning documents` (17 files marked 1).
3. **Commit group 2** `docs(step4): add the migration, Edge Function, test and gate matrices` (5 files marked 2).
4. **Commit group 3** `feat(migration-executor): add the exact-version executor, sealed package, rehearsal evidence and tests` (15 files marked 3).
The unit suite is green only after all three (it reads documents and matrices), as for Step 3.

## 4b. Later additions (Step 4A.5 and 4A.6)
After the three commits above, one more local commit adds the Step 4A.5 evidence and Step 4A.6 strategy: the eight Step 4A.5 modifications (`backup-options-comparison.md`, `d02-restore-point-procedure.md`, `development-deployment-runbook.md`, `owner-approval-checklist.md`, `owner-gates-register.csv`, `standard-migration-recovery-plan.md`, `thirteen-migration-review.md`, `devMigrationExecutor.test.ts`), this file, and two new files: `scripts/dev/hosted-executor/fresh-database-oracle.py` and `audit/step4/fresh-database-oracle-results.json`. The sealed package, the 28 migration files and the executor are unchanged.

## 4c. Step 4A.7 additions (local, not committed; compatibility file `20260615175815`, the marker proposal and both oracles were corrected in the Step 4A.7 review)
New: `supabase/migrations/20260324175545_compat_replace_legacy_user_roles_check.sql`, `supabase/migrations/20260615175815_compat_orders_realtime_before_duplicate_add.sql`, `audit/step4/compat-migrations.json` (registry and pinned hashes), `audit/step4/compat-migrations-oracle-results.json`, `audit/step4/marker-proposal-oracle-results.json`, `audit/step4/strategy-a-attestation-package.md`, `audit/step4/strategy-a-marker-proposal.sql`, `scripts/dev/hosted-executor/compat-migrations-oracle.py`, `scripts/dev/hosted-executor/marker-proposal-oracle.py`. Modified: this file, `development-deployment-runbook.md`, `owner-gates-register.csv`, `owner-approval-checklist.md`, `standard-migration-recovery-plan.md`, `thirteen-migration-review.md`, `devMigrationExecutor.test.ts`, `developmentManifest.test.ts`, `productionManifest.test.ts`, `step3bMigrationPlan.test.ts`, `migrationPendingSet.test.ts`. The two migration files are the only additions under `supabase/migrations/`; the 28 sealed files and the package are untouched.

## 4d. Step 4A.8 (local commits approved)
The Step 4A.7 files above are committed as two local commits (A: compatibility migrations, their registry, oracle and the four inventory tests; B: attestation package, marker proposal, owner attestation review, oracles' evidence, documents and the executor test). New in Step 4A.8: `audit/step4/owner-attestation-review.md` (the 13 individual attestation blocks for owner review, markers copied from the SQL) and a status record in `step4a-readiness-report.md` section 11. Commit hashes are in the Step 4A.8 report. Nothing is pushed.

## 4e. Step 4B preparation (uncommitted)
New: `supabase/migrations/20260814002658_ledger_alias_of_20260814120000.sql` (comment-only alias), `audit/step4/step4b-first-authorization-package.md`. Modified: `audit/step4/compat-migrations.json` (horizon rule and the alias entry), `audit/step4/compat-migrations-oracle-results.json`, `audit/step4/marker-proposal-oracle-results.json`, the two oracle scripts, the five inventory-pin tests (`developmentManifest`, `productionManifest`, `step3bMigrationPlan`, `migrationPendingSet`, `payments/paymentOperations`), `devMigrationExecutor.test.ts`, and the Step 4 documents. Not touched: the 389 historical migrations, the sealed package, the executor, the manifests, the deny list and the two compatibility migrations.

## 5. Freeze rules after committing
1. The 28 migration files, `fingerprint.cjs`, the sealed package and the template state are **frozen**; any change means a new seal, a new package hash, new authorizations and a new rehearsal.
2. Record in the S0 approval: the final HEAD, the package `document_sha256`, and the SHA-256 of `executor-rehearsal-results.json`, `s11-gate-checks.sql`, `g16-storage-canary.sql` and `cli-oracle-results.json`.
3. Before S0 run: the executor unit suite and the strict `node scripts/dev/security-scratch.cjs accept` on the committed HEAD.
4. If a future commit must touch a migration file, stop (the executor and test refuse it).
