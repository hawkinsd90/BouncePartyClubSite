# Stage E2B-1 report: Production execution-set reconciliation

Branch `Dev`, HEAD `63672cd221b4cc11fb436fd7ad65444d29746960` (four checkpoint commits intact). Offline analysis plus local scratch rehearsals on databases cloned from the restored pre-upgrade Production snapshot (hash-verified Stage B dump, 2026-10-16 18:54:59 UTC). **No hosted connection, no hosted write, no history change, no executable reconciliation manifest.** Deliverables: this report, `e2b1-production-execution-crosswalk.csv` (67 rows), `e2b1-execution-dependencies.csv` (71 edges), `e2b1-classification-reconciliation.md`, `e2b1-owner-decision-options.md`; tools `e2b1_analyze.py`, `e2b1_rehearse.py`, `e2b1_build.py`.

## 1. Answer
**The correct proposed Production upgrade execution set remains the 67-version set.** The apparent conflict (67 vs 41) is a **classification artifact**, not a proposed reduction: E2A's "41" counts only class X ("no statement reflected by the catalog" plus the 23 October files). The remaining 26 are 24 class P ("requires more proof", not "skip": 21 contain statements whose effect is absent from Production and 3 are data-only) and 2 class H (a net-zero pair). Of the 67, **64 carry an effect Production lacks (or a data statement)**. The three that do not are `20260715221828`, `20260716104333` (create-then-drop pair) and `20261010110000` (adds a column Production already has). A shorter sequence **can** be built, but it is optional, and I did not replace the baseline (section 5).

## 2. Exact reconciliation (details: `e2b1-classification-reconciliation.md`)
| Group | Versions | In the 67 | E2A |
|---|---|---|---|
| Baseline | 40 | 0 | H 24, P 16 |
| Cases 41, 42 | 2 | 0 | I 2 |
| Development-line | 44 | 44 | X 18, P 24, H 2 |
| October | 23 | 23 | X 23 |
| Total | **109** | **67** | H 26, P 40, I 2, X 41 |
Case 43 stays withdrawn and is in none of these counts. All 44 Development-line and all 23 October versions are in the crosswalk.

## 3. Crosswalk results (`e2b1-production-execution-crosswalk.csv`)
Per version: filename, D3 result, E2A class and reason, evidence counts (present/superseded/no-op/absent/unmatched/unprovable), whether an effect is absent from Production, data-dependent or unprovable statements, dependencies on earlier and later selected versions, intermediate effects replaced later, necessity, consequence of omission, proposed action, execute-versus-record, confidence and evidence references.
Proposed actions: **57 execute** (a real effect or data statement that Production lacks); **6 execute in the baseline, omission-tested** (every effect is replaced by a later selected version: `20260716151530`, `20260716152823`, `20260716173644`, `20260717111737`, `20260717113131`, `20260814114825`); **3 history-only/record-only candidates** (`20260715221828`, `20260716104333`, `20261010110000`); **1 owner decision** (`20260722172048`). Confidence is high for effect-absent versions without data, medium where a data statement cannot be proven from a schema snapshot or an effect rests on heuristic definition matching (22 versions medium, 45 high, per the crosswalk CSV).
Execute versus record: a version that is executed records itself; a version that is omitted must still be recorded (marked history-only) or withdrawn, or the pending-set calculator keeps listing it.

## 4. Dependency graph (`e2b1-execution-dependencies.csv`)
71 edges inside the 67: 28 "intermediate effect replaced by a later selected version", 29 "requires a table created by an earlier selected version", 11 "requires a function created by an earlier selected version", and 3 informative edges: `20260814114825` touches `contact_inquiries`, created later by `20260814120000` (an ordering defect; in Production its statements are guarded and do nothing), and `20261007120000` REVOKEs on `record_cash_payment`/`record_check_payment`, which exist in Production and are re-created later by `20261020120000`. No edge shows a selected version consuming an intermediate effect of an omittable one.

## 5. Shortened-sequence rehearsal (local scratch; nothing replaced)
Each run started from a fresh clone of the Production-schema snapshot with one synthetic master user (so the role-repair guard can run), applied the listed subset in version order, and was compared with a fresh full 67-version run: all 19 catalog categories (tables, columns, constraints, indexes, triggers, **function bodies, policies, grants, default privileges, Storage buckets and policies, publication membership**, extensions, roles, event triggers) plus a per-table digest of the rows (ids and timestamps stripped).
| Sequence | Versions run | Failures | Catalog differences | Row-digest differences |
|---|---|---|---|---|
| Full baseline | 67 | 0 | reference | reference |
| S1: omit the net-zero pair and `20261010110000` | 64 | 0 | none | none |
| S2: S1 and the six intermediate versions | 58 | 0 | none | none |
| each of the six intermediate versions alone | 66 | 0 | none | none |
| order variant: `20260814120000` moved before `20260814113146` (the rename option) | 67 | 0 | none | none |
Limits: equivalence is shown only for the **synthetic starting state**; the omitted files contain no data statements, but catalog equality is not proof of data-transform equivalence against real rows, and D4's failure and data scenarios ran on the 67-version sequence. The result says the three no-op versions and six intermediate versions are *not needed for the final schema*; it does not say they should be dropped. "Do not remove a migration merely because its final effects are superseded" is respected: no omission is proposed.

## 6. Independent verifications requested
- **41 as a deliberate reduction?** No; a classification artifact (section 1).
- **Are the 26 other versions safe to exclude?** 24 are not (they contain absent effects or data); only the 2 net-zero versions (plus `20261010110000`) are schema-neutral, and even they need a history record.
- **Case 41:** not equivalent to the recorded `20260305205811` (different backfill). Local test on 13 synthetic orders with NULL selection: `20260305203528` sets `'deposit'` on all 13, `20260305205811` sets 12 `'deposit'` and 1 `'full'`; both rewrite every NULL row. Do not execute. Treatment: withdraw (recommended if Development never applied it) or a marked record; further evidence wanted: Production count of orders with NULL `customer_selected_payment_cents` and Development provenance of the columns (queries in `e2a-unresolved-evidence.md`).
- **Case 42:** executable SQL identical to the recorded `20260408200431`; whole body guarded; executing is a no-op. Treatment: marked record or withdraw the duplicate; the `COMMENT ON COLUMN` text is unverifiable from the capture.
- **`20260722172048` still necessary?** Yes if Event-Essentials-only bookings must work: `bookingBuild.ts` line 271 sends `surface: null` without inflatables, `create_booking_request` inserts it, the Production column is NOT NULL, and a local insert is rejected without the migration (accepted with it). `staff-order-save.ts` line 168 maps a missing surface to `'grass'`, so staff saves do not depend on it. The other 66 versions apply without it (E1). Owner decision.
- **Development alias:** recorded `20260814002658` and the file `20260814120000_create_contact_inquiries.sql` have identical normalized and comment-free digests; the file contains DDL only (table, index, RLS, one drop and one create of policies), so there are no data effects. Metadata: the recorded `name` column holds the filename with the intended version, as it does for 22 other recorded rows (commit `ce5637b` already gave those files the recorded version prefix; this is the only remaining mismatch); recorded `stmt_count` is 6 against 5 statements by my splitter (a splitter difference, digests equal). The rename option was rehearsed (section 5) with no difference.

## 7. Remaining data uncertainties
16 of the 67 versions carry data statements (seeds, backfills, the role repair's deletes/updates) whose effect against real Production rows is unknown (the schema-only snapshot has no rows); the D4 synthetic scenarios cover the role, payment, refund, invoice-link and bucket cases, the 12 partially verified statements and the unverified function-body DML remain. The 24-check read-only Production preflight (E1) has not been run.

## 8. Owner decisions (`e2b1-owner-decision-options.md`)
D-1 keep 67 (recommended) or run 64/58; D-2 U-5; D-3 case 41 (withdraw / marked record / leave); D-4 case 42 (record / withdraw / execute); D-5 Development alias (rename recommended / alias record / leave); D-6 how omitted versions are recorded; D-7 timing, scope and deploy-first order.

## 9. Files, Git, safety
Created in `audit/evidence/`: `e2b1-report.md`, `e2b1-production-execution-crosswalk.csv`, `e2b1-execution-dependencies.csv`, `e2b1-classification-reconciliation.md`, `e2b1-owner-decision-options.md`, `tools/e2b1_analyze.py`, `tools/e2b1_rehearse.py`, `tools/e2b1_build.py`. Modified: `audit/step2-migration-audit.md` (section AI). No migration SQL, application code, replay tool, pending-set tool or earlier report changed. Hosted Production and Development were not contacted or modified; no Supabase CLI, Docker, WSL, deployment, staging, commit or push.
