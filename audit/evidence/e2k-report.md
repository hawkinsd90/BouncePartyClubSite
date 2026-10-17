# Stage E2K report: final Step 2 audit, evidence closure and Development handoff preparation

Branch `Dev`, HEAD `efda4177433258c4b2c469e5aa381bc2545f36ba` (unchanged; nothing staged or committed). Offline analysis of repository files, committed evidence and the protected transcribed E2J-B results. **No hosted Production or Development connection, no database write or migration-history change, no migration SQL change or further withdrawal, no alias rename, no hosted-capable executor, no application, frontend or Edge Function change, no deployment, no payment-provider call, no Supabase CLI.** The only database used was a disposable local scratch cluster (parse check of four proposed queries; stopped afterwards).

Deliverables: this report; `e2k-final-development-disposition.csv` (388 rows); `e2k-attestation-decisions.md`; `e2k-security-handoff.md`; `e2k-step2-closure-checklist.md`; `e2k-commit-inventory.md`; plus `e2k-additional-readonly-queries.sql` (four proposed queries, not run, SHA-256 prefix `2c0a076c`) and the tool `tools/e2k_build.py`.

## 1. E2J-B evidence-integrity verdict: **sound for classification, with four recorded limits**
Checked by `e2k_build.py verify` (results in the protected folder, outside Git):
- **42 of 42 statements accounted for:** the capture summary has 42 unique ids equal to the file's tags, all `success`; each saved statement hash equals the hash recomputed from the file.
- **Package hash** (LF-normalized) equals the approved `6f0be432…57a3`.
- **Identity:** the 58 live ledger versions equal the Stage B Development set; 57 have a repository file with the same version, the 58th (`20260814002658`) is the contact-inquiry alias recorded under its own version while the file keeps `20260814120000`.
- **388 rows reconcile:** counts sum to 388 (59/221/53/2/40/3/10); every manifest filename resolves to an active file, an archived file or the alias; no active file is missing from the manifest; 384 active + 3 withdrawn + 1 alias-only = 388; the 17 changed rows each have a closure row whose recommended class equals the new class and a live-result explanation; the 371 unchanged rows equal their E2I class. The E2I counts (59/220/42/2/37/3/25) are reproduced from the same table.
- **Aggregates consistent:** exact counts agree with planner estimates for orders (171), customers (123), addresses (165), contacts (95) and user roles (9); estimates were **stale** for units (12 versus 16) and the ledger (37 versus 58), so `estimated_rows` must not be used to prove a table is empty.
- **No unsupported execution claim:** every closure row states "no: current-state equivalence only"; none of the 69 says a migration was executed.
Limits and corrections (also written into `e2jb-report.md`): (1) **transcription:** results were copied by the assistant from the integration's output into the protected folder; they are not native database exports, and Q00_2 and Q22 are stored in summarized form; (2) **transaction protection:** the integration runs as `postgres` (can write); read-only behaviour rests on a `SET TRANSACTION READ ONLY` prefix verified on `Q00_1` and one probe, not on a per-call report; (3) **Q15 is invalid** (see section 3) and four versions were wrongly shown as "conflicting"; (4) the manifest wording "schema state unchanged since Stage B" covers only the objects the queries read, not all 221 history-only candidates, which still rest on the Stage B/E2A evidence and need fresh re-verification at run time.

## 2. Final Development classification (proposal; nothing approved) - `e2k-final-development-disposition.csv`
| Category | E2I | E2J-B | **E2K** |
|---|---|---|---|
| Already recorded (58 + alias) | 59 | 59 | **59** |
| Evidence-backed history-only candidate | 220 | 221 | **222** |
| Qualified owner-attestation candidate | 42 | 53 | **54** |
| Actual SQL execution required | 2 | 2 | **2** |
| Withheld for the October deployment gate | 37 | 40 | **40** |
| Withdrawn | 3 | 3 | **3** |
| Unresolved | 25 | 10 | **8** |
Two offline resolutions in E2K: `20260311111714` to history-only (its one "unmatched" statement is `payments.ledger_sequence`, present and identical in both captures, with `unique_receipt_pi_type` and `unique_receipt_charge_type`; no data statement) and `20260311113547` to attestation (constraint and trigger identical in both captures; its data update is vacuous on the empty table).

## 3. The eight remaining unresolved versions - individual determination
| Version | Finding | Route |
|---|---|---|
| `20251008153245`, `20260323155222`, `20260323163432`, `20260323164559` (contact counters) | E2J-B's Q15 was built on the wrong key and wrong status set. The final trigger counts by e-mail through `customers`, excluding draft, void and cancelled, and `20260323164559`'s backfill recomputed all contacts. The first three versions are superseded by it. Currently matching or differing counters would not prove the SQL ran | **One narrow read-only query is indispensable: Q31** (corrected). Then attestation candidates if the counters agree, or an owner decision on a reviewed recompute if not. Step 4 |
| `20260305205811` (payment-selection backfill) | The backfill sets `customer_selected_payment_cents` from `deposit_due_cents` only where NULL. 22 of 171 orders (deposit due set, selection unset) are consistent with either "orders created after the backfill by a flow that does not set the column" or "backfill never applied". The withdrawn Case 41 file is a materially different variant of this version | **Q32** (created-before/after the migration date and status counts) then owner decision; application validation in Step 4/6 |
| `20251003182356` (missing SMS test template) | The only seeded row absent is `test_message` ("Used for testing SMS functionality"); no code or migration references it; the other five templates exist | **Owner decision, no query**: confirm deliberate removal, then a qualified attestation; low risk |
| `20260311113547` | resolved to attestation (above) | - |
| `20260311111714` | resolved to history-only (above) | - |
| `20260611184401` (`update_pricing_rules`) | Absent on Development; Production-only function with no caller; `20261007120000` guards its absence; existing Step 3.8 | **Owner decision U-E2I-4**; optional Q33 (database-internal callers); Step 3/4 |
| `20251003170350` (demo admin) | The login exists (Q26). Execution prohibited whatever happens | **Step 3**: security review, rotation/removal; optional Q34 (booleans only); the ledger treatment (leave unrecorded or "obsolete, never applied" attestation) is an owner decision |
Eight versions remain unresolved: the four counters, `20260305205811`, `20251003182356`, `20260611184401` and `20251003170350`. The two resolved rows are shown for completeness.

## 4. Owner attestation decisions required (`e2k-attestation-decisions.md`)
54 versions in seven evidence/risk groups, each listed individually with purpose, live evidence, re-run effect if left pending, recommended disposition and a per-version signature requirement. **No blanket attestation is requested.** Highlights: `20251001052039` must not be attested as applied (the sample units are absent); six versions are "query first, or leave pending" (`20260318191352`, `20260415234700`, `20260928172217`, parts of `20251001192425`, `20251222020729`); the high-risk-if-re-run group is the financial/identity group (balance and tax recomputes, address merges), where leaving a version *pending* is the dangerous option if any tool were to apply pending migrations.

## 5. Step 3 security handoff - `e2k-security-handoff.md`
Containment end state; the `orders` policy `Service role full access` (role public, not dropped by any October file) and anonymous policies; `service_role` SELECT on the eight tables; default privileges; demo-admin login; function and sequence privileges; bucket exposure; Edge Function order; financial/booking validation. Each item is tagged LIVE, SNAP, LOCAL or REPO.

## 6. Step 4 Development implementation prerequisites
Fresh `Q00`/`Q01`; approved Q31 to Q34 results; owner answers to U-E2I-1 to U-E2I-11 and capture decisions; Step 3 decisions that gate each action; signed per-version attestations; a rehearsal of the final manifest on a fresh restore with a Development-specific allowlist; a separately designed hosted mechanism (not built); a SELECT-based ledger export and a prepared reversal; a named window and operator; Production untouched; first write a single canary history-only row. Detail in `e2k-step2-closure-checklist.md` section C.

## 7. Can Step 2 close as an audit and planning stage?
**Yes**, as an audit, recovery and implementation-planning deliverable, on the conditions A1 to A6 of the checklist. It is not hosted reconciliation.

## 8. Requirements that must remain open
Hosted migration reconciliation, all attestations, the two bucket-limit executions, the October block, the eight unresolved versions, Step 3 remediation, Edge Function deployment, application validation and any Production work.

## 9. Files created or changed (alphabetical)
- `audit/evidence/e2jb-report.md` (modified): "Corrections recorded in E2K" note (Q15 invalid, wording limits, transcription, transaction-protection limit).
- `audit/evidence/e2k-additional-readonly-queries.sql` (new): Q31 to Q34, proposed only, parse-checked on a local scratch copy.
- `audit/evidence/e2k-attestation-decisions.md` (new): per-version attestation decisions for 54 versions.
- `audit/evidence/e2k-commit-inventory.md` (new): proposed local checkpoint commits.
- `audit/evidence/e2k-final-development-disposition.csv` (new): 388-row final proposal.
- `audit/evidence/e2k-report.md` (new): this report.
- `audit/evidence/e2k-security-handoff.md` (new): Step 3/4 handoff.
- `audit/evidence/e2k-step2-closure-checklist.md` (new): closure determination.
- `audit/evidence/tools/e2k_build.py` (new): integrity verification, disposition, attestation and inventory generator.
- `audit/step2-migration-audit.md` (modified): concise closing assessment (section AU).
Protected, outside Git: `C:\Users\vikki\migration-evidence\e2jb-development\e2k-integrity.json` (verification output).

## 10. Safety
Hosted environments, Git history and executable migrations unchanged; the local executor untouched; the alias file untouched; `.gitignore` and other workstream changes preserved.
