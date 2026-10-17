# E2B-2 proposed evidence checkpoint commit inventory

**Proposal only. Nothing is staged or committed.** Taken from `git status --short -uall` at the end of E2B-2 (HEAD `63672cd221b4cc11fb436fd7ad65444d29746960`, branch `Dev`). A fresh `git status` is required before any commit, because files change as stages are added.

## Eligible files (64)
Suggested grouping (four small commits or one, your choice; commit messages are not drafted here):

### 1. Analysis and rehearsal tools (21)
- `audit/evidence/tools/d2_classify.py`
- `audit/evidence/tools/d2_compare.py`
- `audit/evidence/tools/d2_rebuild.py`
- `audit/evidence/tools/d3_catalog.py`
- `audit/evidence/tools/d3_classify.py`
- `audit/evidence/tools/d3_data_scan.py`
- `audit/evidence/tools/d3_restore.py`
- `audit/evidence/tools/d3_upgrade.py`
- `audit/evidence/tools/d4_build.py`
- `audit/evidence/tools/d4_lib.py`
- `audit/evidence/tools/d4_run.py`
- `audit/evidence/tools/d4_seed.py`
- `audit/evidence/tools/e1_analyze.py`
- `audit/evidence/tools/e2a_analyze.py`
- `audit/evidence/tools/e2a_docs.py`
- `audit/evidence/tools/e2a_run.py`
- `audit/evidence/tools/e2a_sql.py`
- `audit/evidence/tools/e2b1_analyze.py`
- `audit/evidence/tools/e2b1_build.py`
- `audit/evidence/tools/e2b1_rehearse.py`
- `audit/evidence/tools/e2b2_build.py`

### 2. Stage D rehearsal evidence (D2-D4) (17)
- `audit/evidence/d2-discrepancy-register.csv`
- `audit/evidence/d2-rebuild-result.json`
- `audit/evidence/d2-report.md`
- `audit/evidence/d2-selected-manifest.json`
- `audit/evidence/d3-data-dependent-behaviours.md`
- `audit/evidence/d3-discrepancy-register.csv`
- `audit/evidence/d3-execution-report.json`
- `audit/evidence/d3-final-schema-assertions.json`
- `audit/evidence/d3-report.md`
- `audit/evidence/d3-restore-integrity-report.md`
- `audit/evidence/d3-selected-manifest.json`
- `audit/evidence/d4-constraint-validation.md`
- `audit/evidence/d4-data-change-coverage.csv`
- `audit/evidence/d4-financial-integrity.json`
- `audit/evidence/d4-reapplication-matrix.csv`
- `audit/evidence/d4-report.md`
- `audit/evidence/d4-scenario-matrix.csv`

### 3. Stage E1-E2A evidence (15)
- `audit/evidence/e1-evidence-gap-register.csv`
- `audit/evidence/e1-financial-rpc-test-plan.md`
- `audit/evidence/e1-owner-decisions.md`
- `audit/evidence/e1-production-preflight-queries.sql`
- `audit/evidence/e1-reconciliation-readiness.csv`
- `audit/evidence/e1-report.md`
- `audit/evidence/e2a-dependency-register.csv`
- `audit/evidence/e2a-dev-proof.csv`
- `audit/evidence/e2a-prod-alias-comparison.md`
- `audit/evidence/e2a-prod-baseline-proof.csv`
- `audit/evidence/e2a-prod-baseline-statements.csv`
- `audit/evidence/e2a-proposed-actions.csv`
- `audit/evidence/e2a-recorded-exceptions.md`
- `audit/evidence/e2a-report.md`
- `audit/evidence/e2a-unresolved-evidence.md`

### 4. Stage E2B evidence (10)
- `audit/evidence/e2b1-classification-reconciliation.md`
- `audit/evidence/e2b1-execution-dependencies.csv`
- `audit/evidence/e2b1-owner-decision-options.md`
- `audit/evidence/e2b1-production-execution-crosswalk.csv`
- `audit/evidence/e2b1-report.md`
- `audit/evidence/e2b2-commit-inventory.md`
- `audit/evidence/e2b2-owner-decision-package.md`
- `audit/evidence/e2b2-reconciliation-blockers.csv`
- `audit/evidence/e2b2-release-sequence-outline.md`
- `audit/evidence/e2b2-report.md`

### 5. Master audit file (modified) (1)
- `audit/step2-migration-audit.md`

## Excluded

- `.gitignore`: belongs to another workstream
- `audit/evidence/tools/__pycache__/d4_lib.cpython-314.pyc`: compiled Python cache
- `audit/evidence/tools/__pycache__/d4_seed.cpython-314.pyc`: compiled Python cache
- `audit/evidence/tools/__pycache__/e2a_analyze.cpython-314.pyc`: compiled Python cache
- `audit/evidence/tools/__pycache__/e2a_sql.cpython-314.pyc`: compiled Python cache
- `audit/evidence/tools/__pycache__/stage_b_capture.cpython-314.pyc`: compiled Python cache
- Everything under `C:\Users\vikki\migration-evidence\` is outside the repository and must stay out of Git (raw captures, restored dumps, scratch databases, sensitive snapshots).

## Checks behind the list
- Secret-pattern scan over `audit/evidence` (JWT-like strings, `sb_secret_`, connection strings with passwords, live Stripe keys): no matches.
- All evidence files are derived summaries; no real customer or payment rows. Size of `audit/evidence`: about 2.6 MB.
- Tracked files modified: only `.gitignore` (excluded) and `audit/step2-migration-audit.md` (eligible). No migration SQL, application code, replay tool or pending-set tool changed.
- `audit/evidence/tools/__pycache__/` is not ignored by the current `.gitignore`; adding an ignore rule would touch the other workstream's file and is left to the owner.
- Re-run the three test suites immediately before a commit (63 / 144 / 54 passed at the end of E2B-2).
