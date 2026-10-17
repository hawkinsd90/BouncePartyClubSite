# E2B-1: reconciling the E2A classification with the 67-version upgrade set

Inputs cross-checked: `d3-selected-manifest.json`, `e1-reconciliation-readiness.csv`, `e2a-proposed-actions.csv`, `e2a-prod-baseline-proof.csv`, `d4-data-change-coverage.csv`, `d3-execution-report.json`, the Stage B Production capture (2026-10-16 18:54:59 UTC). Method for the statement-level facts: `tools/e2a_analyze.py` (see E2A), `tools/e2b1_analyze.py`.

## 1. Exact count reconciliation of the 109 Production-pending versions
| Group | Versions | In the 67-version set | E1 categories | E2A classes |
|---|---|---|---|---|
| Baseline (pre-history) | 40 | 0 | 9 present, 13 superseded, 18 not yet proven | H 24, P 16 |
| Cases 41 and 42 | 2 | 0 | identity | I 2 |
| Development-line | 44 | **44** | 30 absent, 6 partial, 8 not yet proven | X 18, P 24, H 2 |
| October | 23 | **23** | 13 absent, 7 partial, 1 present, 2 not yet proven | X 23 |
| **Total** | **109** | **67** | | H 26, P 40, I 2, X 41 |
Case 43 is withdrawn and is in none of these counts. No baseline version and neither case is in the upgrade set; all 67 members come from the Development-line and October groups (44 + 23 = 67), so there is no overlap and no omission between the two lists. All 67 are present in `e2a-proposed-actions.csv`.

## 2. Why E2A shows 41 and not 67 (answer: a classification artifact, not a proposed reduction)
E2A's "41" is the count of class **X** only, and X was defined as "no material statement is reflected by the captured catalog" (plus the 23 October files by design). The other 26 members of the 67-version set are:
- **24 class P ("requires additional proof")**: 21 are *mixed* versions (some statements already present or superseded, other statements **absent** from Production) and 3 are *data-only* (seed rows, grants). In the E2A scheme, P is not a statement that the version can be skipped; it only means a history-only verdict could not be justified. Every one of the 21 mixed versions contains at least one statement whose effect is absent from Production, so executing it is what creates that effect.
- **2 class H**: `20260715221828` and `20260716104333`, a create-then-drop pair whose end state Production already has; they are the only members of the 44 whose omission is plausibly schema-neutral.
So the 67-version set and E2A are consistent: **64 of 67 versions carry an effect that Production lacks** (or a data statement); the three that do not are the net-zero pair and `20261010110000` (its `ADD COLUMN IF NOT EXISTS` finds `orders.customer_approved_at`, which the recorded `20251126190624` created). E2A put `20261010110000` in X only because it labels all 23 October files X.

## 3. Execution versus recording
- **Executing** a migration changes the schema/data and records its version as part of the same operation.
- **Recording only** (history-only reconciliation) changes nothing but the history table and is truthful only when the target state already exists. For the 67 versions: 64 need execution, 3 are record-only candidates (the net-zero pair and `20261010110000`), and `20260722172048` is an owner decision.
- A version omitted from execution still has to be recorded (or withdrawn) or the pending-set calculator will keep listing it. Omitting is therefore never "free".

## 4. Cases where the schema is compatible but historical data execution is unavailable
Versions whose schema effects are present but which carry data statements a schema snapshot cannot prove (the 16 class-P baseline versions and three dev-line seeds/grants, and 16 of the 67 with unprovable statements) are **not** classified as historically executed; they are P with read-only queries listed in `e2a-prod-baseline-proof.csv`/`e2a-proposed-actions.csv`. D4 covered them as: 57 proven, 12 partially verified and 1 unverified (function-body DML) data statements.

## 5. Checks performed
- Every E2A class is one of H/P/I/X/W; the sum 26 + 40 + 2 + 41 = 109 matches.
- The 67-version set equals 44 Development-line + 23 October; neither group contains a baseline or case version.
- D3 executed all 67 (0 failures); D4 re-ran them on 4 further datasets (0 failures).
- The D4 data-coverage matrix mentions 26 of the 67 versions; its rows include column-default, NOT NULL, CHECK, UNIQUE, privilege and bucket statements as well as INSERT/UPDATE/DELETE, so this is not a count of versions with data statements (16 of the 67 carry data or dynamic statements per the crosswalk); the other 41 appear in no D4 row. (Wording clarified in E2B-2.)
