# Stage E1 report: reconciliation readiness, evidence completeness and decision register

Branch `Dev`, HEAD `63672cd221b4cc11fb436fd7ad65444d29746960` (the four checkpoint commits are intact). Audit and planning only: nothing was written to any database, no history row was created, and no hosted system was contacted. E1 used the local Stage B captures (2026-10-16 18:54-18:55 UTC), the D1-D4 evidence, and disposable local scratch databases with synthetic data for two checks (the preflight query validation and the U-5 exclusion experiment). Detailed outputs: `e1-reconciliation-readiness.csv` (775 rows), `e1-evidence-gap-register.csv` (304 rows), `e1-production-preflight-queries.sql`, `e1-owner-decisions.md`, `e1-financial-rpc-test-plan.md`; analysis script `tools/e1_analyze.py`.

## 1. Preflight
Branch `Dev`, HEAD `63672cd`; 386 migration files, Case 43 absent; recovered-migration hash tests 63/63; replay-safety 144/144; pending-set 54/54; calculator against the captured histories: 386 versions, Production 277 recorded / 109 pending, Development 58 / 329, 0 findings; D3 upgrade set unchanged (67 files, manifest `6bc153ae...`), D2 selected manifest `82d8797b...`, D1-D4 reports present. The uncommitted `.gitignore` line belongs to another workstream and was not touched. The Stage B CSVs describe 387 versions (they include Case 43); E1 removes Case 43 everywhere and lists it once as "excluded".

## 2. Is the Stage B definition of done satisfied? (evidence-completeness verdict)
| Stage B requirement | Status | Note |
|---|---|---|
| 1 Independent Production and Development schema-only capture, catalog agreement | satisfied | manifests re-verified (24/24 files, 0 hash mismatches); read-only sessions recorded |
| 2 History records and fingerprints | satisfied | Production 277 unique versions; Development 58 |
| 3 All 277 Production entries classified | satisfied | 233 consistent, 43 no catalog effect, 1 recorded but effect missing (`20251207163822`, the role CHECK absent in Production) |
| 4 Versions not recorded in Production classified | satisfied at classification level | 109 (110 less Case 43); per-version proof incomplete (section 3) |
| 5 Versions not recorded in Development classified | satisfied at classification level | 329 (330 less Case 43); per-version proof incomplete |
| 6 History-only vs missing-effect distinction | satisfied | method limits recorded (name-level and data/privilege effects are not catalog-provable) |
| 7 Register of out-of-band differences | satisfied | `drift-register.csv`, 191 lines |
| 8 No customer records or credentials in exports | satisfied | credential/PII scan recorded |
| 9 Classification report | satisfied | the four CSVs and `stage-b-report.md` |
| 10 Unresolved discrepancies listed | satisfied | carried into E1 as the gap register |

**Verdict:** Stage B is complete as an evidence capture and classification. It is **not yet sufficient** for an approval-ready bookkeeping manifest, because a classification is not a per-version proof for every version. Stage B created no signed per-version proof table; E1 therefore cites the artifact that backs each verdict (capture file with its catalog fingerprint, `classification_raw.json[env][version]`, the version matrix and the class CSV), and does not invent proof identifiers (gap `GAP-GLOBAL-2`).

## 3. Per-version results (E1 seven-way grouping; `e1-reconciliation-readiness.csv`)
Verdicts come from Stage B; E1 only regroups them and downgrades any version whose SQL contains data or dynamic statements the catalog cannot verify. "Superseded" cites the later migration recorded in `super_items`.

| E1 category | Production (109 pending) | Development (329 pending) |
|---|---|---|
| 1 Recorded and verified (recorded rows) | 276 of 277 | 55 of 58 |
| 2 Effects present, catalog-proven | 10 (9 baseline + 1 October) | 84 (83 pre-October + 1 October) |
| 3 Effects partially present | 13 pending (+1 recorded row with a missing effect) | 18 pending (+2 recorded rows with missing effects) |
| 4 Effects absent, SQL execution required | 43 | 16 |
| 5 Superseded by an identified later migration | 13 | 100 |
| 6 Alias / identity discrepancy | 2 (cases 41, 42) | 3 (cases 41, 42, `20260814120000`) + the recorded-only `20260814002658` |
| 7 Not yet proven | 28 | 108 |

Recorded rows with a missing effect: Production `20251207163822` (role CHECK); Development `20260718000744` and `20260723174017` (policies). The 23 October versions fall in categories 2, 3, 4 and 7 because some of their objects already exist, but all are "execute later" in both environments.

## 4. Production reconciliation assessment
- Classification confirmed: 40 baseline + cases 41/42 (the 42 reconciliation-only versions) + 44 Development-line + 23 October = 109. Case 43 is excluded and must never be marked applied.
- **44 Development-line (execute):** 30 absent, 6 partially present, 8 in category 7 (7 data/privilege-only files and `20260722172048`); all 44 executed in D3 and D4. Exceptions to "pure execution": 8 are net-zero chains that must run with their partner, and **`20260722172048` is an owner decision (U-5)**.
- **23 October (execute):** unchanged; deploy-first dependencies apply.
- **42 reconciliation-only versions:** only **22 are bookkeeping candidates** (9 effects present, 13 superseded; each still needs re-verification inside the 24 h window); **18 baseline versions are not yet proven** (9 data/privilege-only, 3 name-level definitions, 6 present or superseded but with data statements); **2 are identity decisions** (cases 41, 42, whose recorded SQL differs from the files; the exact diff was never run).
- **Readiness: the execution set (67) is rehearsed and ready for an approval-ready manifest; the bookkeeping part is not.**

## 5. Development reconciliation assessment
Of the 306 pre-October unrecorded versions: **183 are bookkeeping candidates** (83 effects present + 100 superseded), but **34 of the 100 superseded versions depend on a superseding migration that is not itself recorded or proven**, so order matters; **106 are not yet proven** (50 data/privilege-only, 29 name-level definitions, 27 with data statements); **11 are partially present** (examples: storage policies removed by containment, the role CHECK, `pg_net`, Realtime tables); **3 are absent** (`20251129190039`, `20260324154955`, `20260611184401`, i.e. parity items needing an owner decision); **3 are identity discrepancies**. The assumption that all 306 are safe to bookkeep is therefore **not supported**. October (23) stays pending. Nothing about Development was changed.

## 6. U-5: `20260722172048` (details in `e1-owner-decisions.md`)
Dev-only header; recorded in Development; Production lacks its effect (`orders.surface` NOT NULL). **Current booking code depends on it**: `bookingBuild.ts` sends `surface: null` for Event-Essentials-only bookings and `create_booking_request` inserts it. Local experiment: the other 66 migrations apply cleanly without it (66/66); the only schema difference is the surface NOT NULL and old CHECK, and a NULL-surface order insert is rejected. Options (include, exclude + change code, replace with a new migration, defer) and risks are laid out; I recommend including it after your confirmation. **I did not decide.**

## 7. Production data-precondition checklist
`e1-production-preflight-queries.sql`: 24 read-only checks (one `BEGIN READ ONLY` transaction, aggregate counts and booleans only, no identifiers or rows): schema-shape assumptions; roles outside the vocabulary, case/padding, duplicates after normalization, orphans, empty auth; duplicate positive PaymentIntents; duplicate portal links; order items without a unit; violators of the three constraints that can fail a later VALIDATE; refund aggregates (the allocation and operation-shape constraints cannot be violated by existing rows because their columns do not exist yet); surface NULLs; bucket configuration; history fingerprint. Validated on three synthetic scratch databases (empty schema, valid dataset, deliberately bad dataset): every guard condition is detected (`P01`, `P10`, `P12`, `P13`, `P20`-`P22` all counted 1 on the bad fixture; `P05` false when `auth.users` is empty) and a write inside the read-only transaction is rejected. **Not executed against Production; no current Production count is claimed.**

## 8. Financial RPC coverage gap
`e1-financial-rpc-test-plan.md`: 11 local scenarios (A1-A11), most feasible locally with the `service_role` stub because the functions are service-role-only; B-class tests need Supabase Auth/PostgREST; C-class tests need Edge Functions or Stripe test mode; nine scenarios form the minimum release-confidence set. Not run.

## 9. Owner decisions required before the manifest can be finalized
U-5; identity of `20260814120000` vs `20260814002658`; cases 41 and 42; evidence route for the 18 unproven baseline versions; Development scope (106 unproven, 11 partial, 3 absent); `update_pricing_rules` on Development; bookkeeping timing; NOT VALID validation timing; `supabase_admin` default privileges (Step 3); hosted path for the 39 out-of-order versions (Step 4); deploy-first confirmation; SEC-A and the temporary role (outside Step 2); `.sql.sql` filenames. See `e1-owner-decisions.md`.

## 10. Can Stage E proceed?
Yes for the **Production execution set** (67 versions, rehearsed, with U-5 pending) and for the **22 Production bookkeeping candidates after re-verification in the freshness window**. **Not yet** for the 18 unproven baseline versions, the 2 identity cases, U-5, or any Development bookkeeping: those need additional evidence (a local definition-level diff of the captured catalogs for the name-level versions, per-statement checks or attestation for data-bearing and data/privilege-only versions) and owner decisions. A sensible next step is a documentation-and-local-analysis stage that produces those definition diffs and a draft manifest, still without touching any hosted system.

## 11. Files
Created in `audit/evidence/`: `e1-report.md`, `e1-evidence-gap-register.csv`, `e1-reconciliation-readiness.csv`, `e1-production-preflight-queries.sql`, `e1-owner-decisions.md`, `e1-financial-rpc-test-plan.md`, `tools/e1_analyze.py`. Modified: `audit/step2-migration-audit.md` (section AG). No migration, application, replay-tool or pending-set-tool change; no earlier report changed.

Production and Development were not contacted or modified; no history row inserted; no Supabase CLI, Docker, WSL, deployment, staging or commit.
