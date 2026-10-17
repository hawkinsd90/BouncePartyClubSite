# E2G interruption, failure and recovery scenarios

All scenarios ran the local executor (`scripts/dev/local-executor/local-migration-executor.cjs`) as a separate process against **disposable local PostgreSQL databases** (`bpc_exec_*`, loopback only) cloned from the restored pre-upgrade Production schema, whose ledger holds exactly the 277 captured Production rows, with the synthetic D4 dataset; the synthetic-repository scenarios use throwaway git repositories. Harness: `audit/evidence/tools/e2g_executor_tests.py`; per-test results: `e2g-executor-test-results.json` (103 of 103 pass on a clean rerun of the whole suite). Nothing touched a hosted system.

## 1. Successful approved execution (R01 to R11)
- Allowlist built from the E2C manifest, bound to commit `efda417` (58 execute, 9 history-only, deny list of Cases 41, 42, 43, document hash `4835290f...`).
- Without `--acknowledge-older-than-latest` the run is refused; with the wrong number (30 instead of 31) it is refused (R01, R02).
- Approved run: **58 executed, 9 history-only, 277 base rows untouched**, 24 to 26 seconds; none of the nine omitted versions and none of Cases 41, 42, 43 executed (R03, R04).
- Execution order equals the allowlist order exactly (R06). The pair `20260715221828`/`20260716104333` and `20261010110000` were recorded history-only **before** the first execution, and each of the six superseded versions only **after** all of its superseders had executed (R07).
- Audit evidence separates real execution (`item_start`/`item_end`, with the LF hash) from history-only reconciliation (`history_only` events with basis); the two sets of versions are disjoint (R08). `verify` reports 58 executed, 9 history-only, nothing missing, hash chain valid (R09). A second run changes nothing (R10).
- The final catalog fingerprint equals the LF-normalized reference run in all ten categories; with carriage returns stripped from function bodies it equals the earlier CRLF working-copy rehearsal; the only raw difference from that rehearsal is function-body carriage returns (R05, R05b, R05c).

## 2. Interruption between migrations and resumption (T01 to T10)
| Scenario | Result |
|---|---|
| Stop inside the critical window without the explicit flag | refused (`critical-window`) (T01) |
| Stop before the window (`--stop-after 20260715214053`) | pair and `20261010110000` recorded up front; one migration executed (T02) |
| Deliberate stop after `20260716151549` (flag) | `20260716151530` **not** recorded: its superseder `20260716152447` has not run (T03) |
| Stop after `20260716152447` | `20260716151530` now recorded history-only (T04) |
| Stop after `20260717110808` | `20260716152823` recorded only after both superseders (T05) |
| Crash gap: ledger row committed but the audit end record lost (audit truncated to a valid prefix) | the next run reconciles `20260717111014` from the audit start record, writes a flagged end record, completes with 58/9 (T06); final catalog equals the reference (T07) |
| Omitted versions across the whole interrupted history | never started (T08) |
| Audit store deleted while the ledger holds executed rows | refused (`audit`), nothing run (T09) |
| A live process holds the audit-store lock | second executor refused (`lock`) (T10) |

## 3. Failures and rollback (F01 to F07, synthetic and real)
| Scenario | Result |
|---|---|
| Migration with a failing statement after DDL and DML | whole file rolled back: no partial table, no ledger row, later files not run; failure written to the audit store (F01, F02) |
| Executor killed (process tree) while a migration sleeps inside its transaction | no table and no ledger row from the half-applied file after the server ends the session (F03) |
| Restart after the kill | stale lock detected (dead pid) and cleared with an audit note; the two remaining files execute (F04) |
| Declared dependency not executed | refused before the dependent runs; nothing written (F05) |
| Real allowlist with `20260716151458` removed and no declared dependency | the seed migration `20260716151549` fails (`inventory_products` does not exist), rolls back, execution stops (F06) |
| Omitted versions in both failure cases | never executed (F07) |
Finding F05b: the dependency declarations derived from the E2B-1 graph (20 edges) are **incomplete**: the seed migration `20260716151549` declares no dependency on `20260716151458`. Missing objects are therefore caught by the SQL failure and rollback, not by the declared-dependency check; a future allowlist should add declared dependencies for data-seeding migrations.

## 4. Ledger discrepancies, tampering and hosted-target refusals
Ledger refusals (L01 to L09): extra unknown row, missing base row, row for withdrawn Case 41, history-only marker on an executable item, executed marker on an omitted version, executed row without audit evidence, executed row with a different file hash, row without an executor marker, tampered audit hash chain: **all refused**, and in each case the executor ran nothing. File-integrity refusals (I03 to I12): modified working-tree file, allowlist hash differing from the bound commit, edited allowlist without a new document hash, missing commit, a file not in the bound commit, Cases 41/42/43 and four omitted versions on the allowlist as executable items, a withdrawn file present in the active directory: **all refused**. LF handling (I01, I02): an LF working tree and a CRLF working tree (autocrlf-style) of the same commit both verify and execute, and the recorded hash is the LF-normalized hash. Guard refusals (G01 to G15): see `e2g-report.md` section 3.

## 5. Failures in the critical window (W-series, real files, data-induced causes)
See `e2g-security-failure-analysis.md` for the security reading. Mechanics:
| Scenario | Failing version | Executor outcome | Resumption after the cause is fixed |
|---|---|---|---|
| W1 duplicate active portal link | `20261009120000` (inside the window) | stops, version not recorded; all nine history-only records had already become true and were written, none prematurely | completes, 58/9 (W1e) |
| W2 role outside the vocabulary | `20261016120000` (after the lockdown migrations) | stops, not recorded | completes; final catalog equals the reference (W2e, W2f) |
| W3 invalid order item | `20260716151458` (first migration of the window) | stops; the failing transaction rolled back, so the catalog is the **start state** | completes; final equals the reference (W3e, W3f) |
| W4 lock held on `orders` by another session | `20260925151621` | fails fast with `canceling statement due to lock timeout` (1.5 s test setting), not recorded | after the holder's backend is terminated, completes, final equals the reference (W4a, W4b) |
In no scenario was an omitted version executed (W1c, W2c, W3c, F07, R04, T08).

## 6. What these scenarios do not show
Concurrent application traffic (only the executor and test sessions ran), network faults, a database server crash during commit, hosted privilege limits, and any behavior of the Supabase platform services. A kill of the executor was tested; a kill of PostgreSQL itself was not.
