# E2D history-only recording and resumption tests

Local disposable PostgreSQL 18.4 only (`bpc_replay_e2d_h_*`, `bpc_replay_e2d_guard`), cloned from the restored pre-upgrade Production schema with the synthetic D4 dataset. The ledger is a **local scratch copy** of `supabase_migrations.schema_migrations` (277 captured rows plus the 42 simulated baseline/case rows used since D3). Tool: `tools/e2d_extra.py` (commands `hist`, `guards`, `txscan`); raw JSON in the protected scratch folder. **No hosted history was read or modified, and nothing here authorizes a hosted history change.**

## 1. What was tested
A **model executor** (class `Executor` in `e2d_extra.py`; requirements in `e2d-executor-requirements.md`) that: works only from the exact 58-version allowlist and each file's SHA-256; selects work as *allowlist minus ledger* (never "all pending"); writes **two distinct ledger kinds** - `-- E2D EXECUTED ... allowlist sha256 <hash>` for versions it ran and `-- E2D HISTORY-ONLY ...: NOT EXECUTED; basis=<why>` for the nine omitted versions; and applies the E2C timing rule: the net-zero pair and `20261010110000` are recorded as soon as a catalog precondition holds (policy absent; column present), and each of the six superseded versions only after **all** of its superseders have been executed.

## 2. Uninterrupted run
- 58 versions executed, 9 history-only records written, 319 other rows (the 277 captured and 42 simulated). **None of the nine omitted versions was ever executed.**
- Order of the history-only records: `20260715221828`, `20260716104333`, `20261010110000` (before the first execution), then `20260716151530` (after `20260716152447`), `20260716152823` (after `20260717012112` and `20260717110808`), `20260717111737` (after `20260717111803`), `20260717113131` (after `20260717115647`), `20260814114825` (after `20260814120100`), `20260716173644` (after `20260820165646`).
- The final catalog fingerprint equals both the E2C 58-version result and the E2C 67-version result.
- Audit query result (one query separates the two kinds): `20260715221828` history-only; `20260716151530` history-only; `20260716152823` history-only; `20260814114825` history-only; `20260722172048` executed; `20261025120000` executed.

## 3. Interruption and controlled resumption (18 runs)
Each run executed the allowlist up to the stop version, then a **fresh** executor (no memory) resumed from the ledger. In the "crash" variant the history-only rows for superseded versions were deleted first, to model a crash between an execution and its record.
| Interrupted after | Crash model | Executed on resume | Omitted versions executed | Premature 'superseded' records | Final = uninterrupted 58 | Ledger: executed / history-only |
|---|---|---|---|---|---|---|
| `20260716151549` | records written normally | 55 | 0 | 0 | yes | 58 / 9 |
| `20260716151549` | history-only rows for superseded versions dropped (crash before recording) | 55 | 0 | 0 | yes | 58 / 9 |
| `20260716152447` | records written normally | 54 | 0 | 0 | yes | 58 / 9 |
| `20260716152447` | history-only rows for superseded versions dropped (crash before recording) | 54 | 0 | 0 | yes | 58 / 9 |
| `20260717012112` | records written normally | 50 | 0 | 0 | yes | 58 / 9 |
| `20260717012112` | history-only rows for superseded versions dropped (crash before recording) | 50 | 0 | 0 | yes | 58 / 9 |
| `20260717110808` | records written normally | 49 | 0 | 0 | yes | 58 / 9 |
| `20260717110808` | history-only rows for superseded versions dropped (crash before recording) | 49 | 0 | 0 | yes | 58 / 9 |
| `20260717111803` | records written normally | 46 | 0 | 0 | yes | 58 / 9 |
| `20260717111803` | history-only rows for superseded versions dropped (crash before recording) | 46 | 0 | 0 | yes | 58 / 9 |
| `20260717115647` | records written normally | 45 | 0 | 0 | yes | 58 / 9 |
| `20260717115647` | history-only rows for superseded versions dropped (crash before recording) | 45 | 0 | 0 | yes | 58 / 9 |
| `20260814120100` | records written normally | 30 | 0 | 0 | yes | 58 / 9 |
| `20260814120100` | history-only rows for superseded versions dropped (crash before recording) | 30 | 0 | 0 | yes | 58 / 9 |
| `20260820165646` | records written normally | 29 | 0 | 0 | yes | 58 / 9 |
| `20260820165646` | history-only rows for superseded versions dropped (crash before recording) | 29 | 0 | 0 | yes | 58 / 9 |
| `20261010120000` | records written normally | 18 | 0 | 0 | yes | 58 / 9 |
| `20261010120000` | history-only rows for superseded versions dropped (crash before recording) | 18 | 0 | 0 | yes | 58 / 9 |

Result: **18 of 18 resumes reached the uninterrupted 58-version final state; no omitted version was executed in any resume; no history-only record claimed "superseded by" a version that had not been executed; every final ledger held exactly 58 executed and 9 history-only rows.** Stops were placed immediately before and after each superseding version (for example `20260716151549` is before `20260716152447`, `20260717115647` is the superseder of `20260717113131`, `20260820165646` the superseder of `20260716173644`, `20260814120100` of `20260814114825`).

## 4. Can history-only bookkeeping cause omitted SQL to run?
- **During a proper resume: no.** Work is allowlist minus ledger, and the omitted versions are not on the allowlist as executable items; they appear only as history-only items. The 18 runs above confirm it.
- **Through a different tool: yes.** E2C showed that a runner which derives its list from "pending versions" (what a plain push would do) runs omitted versions late and regresses the finished release at 7 of 11 stop points. A history-only record prevents that only if the runner honors the ledger; the executor requirement is therefore that the runner be allowlist-based (X-04), not that the record exist.

## 5. Guards on an inconsistent ledger (`guards`)
The executor refuses to run, rather than silently skipping, when the ledger contradicts the allowlist:
| Tampered ledger | Outcome |
|---|---|
| history-only row for the executable `20260722172048` | refused: "ledger marks executable version ... as history-only" |
| executed row for the omitted `20260716152823` | refused |
| any E2D row for withdrawn Case 41 `20260305203528` | refused |
| E2D row for an unknown version | refused |
Pure-logic checks: withdrawn Cases 41, 42 and 43 and an unknown version are refused; a one-byte change to an allowlisted file is detected; allowlisted versions older than `20260928172217` (31 of the 58) are not blocked.

## 6. What a "reconciled" mark does and does not mean
- A **history-only** row means: *the owner-approved plan decided this version's SQL would not be executed, and the stated basis held when the row was written.* It is **not** evidence that the SQL ever ran, in Production or anywhere. For the nine versions the basis is a catalog fact or a superseding executed version; for the 40 baseline versions it would have to be a per-version proof or a labelled attestation (D-6).
- An **executed** row means the executor ran that exact file hash, in that run, and the transaction committed.
- A **qualified owner attestation** is a third, separate label: "attested by <name> on <date>; not proven by the catalog". It is never displayed as proof.
- Schema equivalence is not execution: a version whose effects are already present is still a *candidate* for a history-only row, never "executed".
- Because the pending-set calculator compares versions only, it counts history-only and executed rows alike; reports must therefore use the marker, not the calculator, to say what ran.

## 7. Limits
Local scratch ledger and markers only; the hosted `supabase_migrations` table, its `statements` column semantics, and any companion audit table are undesigned. The model does not cover concurrent runs, network failure, or privilege problems. The crash model covers a crash before recording; a crash inside the commit itself is covered by the single-transaction rule in the requirements (X-06), which was not exercised against a real kill of the database session.
