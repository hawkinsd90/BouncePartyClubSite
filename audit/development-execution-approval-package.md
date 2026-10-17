# Development execution approval package (pre-October, 259 operations)

**Status: a proposal for owner review. Nothing in this package is approved, executed or authorized.** No hosted write occurred while preparing it; Production was not contacted. Every ledger entry proposed here is bookkeeping: a `history-only` or `attestation` row means "this version is handled", never "this SQL ran". Source of truth: `development-execution-manifest.csv` (one row per operation), `development-verification-rules.json` (one read-only rule per operation), `development-execution-batches.json` (batch membership and script hashes), `development-hosted-procedure.md` (how a batch would be applied). Regenerate with `audit/evidence/tools/build_execution_manifest.py`, `build_execution_package.py`, `render_approval_package.py`.

## 1. Final migration decisions in this package
### `20260611184401` (creates `update_pricing_rules`): proposed permanent exclusion (NOT yet owner-confirmed)
- **Why the function is unnecessary:** it exists only in Production; no repository file, Edge Function or application code calls it (searched `src/`, `supabase/functions/`); no Development database function mentions it (hosted check Q33 = 0); `20261007120000` already treats its absence as normal (`IF to_regprocedure(...) IS NOT NULL`). The pricing screens change `pricing_rules` through the table, not this RPC.
- **Does leaving it absent change behaviour?** No caller exists, so no application behaviour changes. Production compatibility is unaffected because Production keeps its own copy; if a real dependency appears later it must be raised as a new SQL decision.
- **How tooling avoids executing it:** it is not in any allowlist; the manifest category is `Excluded from plan`; every future allowlist document must carry it (and the demo-admin migration `20251003170350`) in its `deny` list, which the local executor already refuses; the standing prohibition on `--include-all` / applying all pending migrations stays.
- **Ledger treatment, two options:** (a) leave the version pending (recommended: nothing claims it was handled, and the deny list prevents execution); (b) a separately justified *not-applicable attestation* stating that the function was deliberately not created. Option (b) makes the Development and Production ledgers look alike but writes a row for SQL that never ran, so it needs its own owner decision. **Owner decision required: confirm exclusion, and choose (a) or (b).**
### `20251003182356` (seeds six SMS templates): the missing `test_message` template does not need recreation
It is a testing-only row ("Used for testing SMS functionality"), referenced nowhere in the repository, the Edge Functions or the application; the other five templates exist; a re-run would only re-insert the test row (`ON CONFLICT DO NOTHING`). The operation's rule requires the five real templates and expects `test_message` to be absent. No attestation exists. Before any attestation is signed the owner must confirm that the removal was deliberate; otherwise the version stays pending (**owner decision**).

## 2. Are the 259 operations adequately verified?
**No, not all.** Rule status: **247 DEFINED**, **9 WEAK**, **3 BLOCKED**. A rule is one read-only SELECT returning a boolean; it shows the *current* state is consistent with the migration and is never proof that it ran. Rules use `to_regclass`, `information_schema`, `pg_indexes/pg_policies/pg_trigger/pg_proc/pg_constraint` and effective-privilege functions only, no `NOT NULL` constraint rows (PostgreSQL 17 stores them differently from 18).

| Rule kind | Operations |
|---|---|
| catalog | 149 |
| catalog+data | 66 |
| supersession | 9 |
| exact predicate | 8 |
| net-zero/absence | 5 |
| partial | 4 |
| consistency only | 3 |
| vacuous  | 3 |
| recompute of all rows | 2 |
| effect-absent | 2 |
| sample units seed | 1 |
| function identity | 1 |
| effect-present | 1 |
| natural keys minus the removed test row | 1 |
| successor predicate | 1 |
| absence | 1 |
| presence only | 1 |
| schema only; data vacuous | 1 |

- 12 DEFINED operations are *supersession-only or vacuous*: every statement was replaced by a predecessor that is recorded first, or has no persistent effect, so there is no object of their own to check. They are valid only in the stated order.
- **WEAK (not approvable as is; each needs the owner to accept the stated limit in the attestation scope):** `20251001051901`, `20251001192425`, `20260126193205`, `20260224133344`, `20260224161311`, `20260224183629`, `20260224184535`, `20260311113547`, `20260315173745`.
- **BLOCKED (no safe rule; kept out of every approvable batch):** `20251001052039`, `20260125173238`, `20260305222010`. `20251001052039` (sample units: none exists, so nothing can be verified), `20260125173238` and `20260305222010` (recompute every order's balance with no predicate; the formula cannot be re-proved on orders edited since). Options for the owner: leave pending, or sign an explicit *unverifiable* attestation that names the limit; the second changes this package.
- Local validation (`test_execution_scripts.py`, 19 pass, 0 fail): every catalog atom evaluates on the captured Development schema; every plain/security history-only rule is TRUE there; rules are FALSE when an object is missing (a mutated scratch schema rolls the whole batch back); the Production pre-upgrade schema is only a weak negative control (most of these objects pre-date it). **Hosted truth of every rule is established only by running it on Development immediately before its batch.**

## 3. Canary and batch sequence
**Canary: `20251002195907` (`20251002195907_006_add_unit_inventory.sql`), batch B01.** One `history-only` row; rule: 1 catalog objects must exist. Why: it has no predecessors, checks only that an added column exists, touches no policy, grant or data, and the column is part of the core orders schema. Expected change: ledger +1 row (58 to 59), no schema change. Verify: the row exists with the marker, the rule re-evaluates true, `Q01` shows exactly 59 rows and the 58 earlier rows unchanged. Reversal: `REVERSAL B01` (deletes exactly that row). Not executed.

| Batch | Class | Ops | Needs earlier batch(es) | Approval / decision | Versions (execution order) |
|---|---|---|---|---|---|
| B01 | CANARY (history-only) | 1 | - | owner approves the canary and the mechanism check | 20251002195907 |
| B02 | history-only, plain | 12 | - | owner approves the batch | 20251003135541, 20251003142953, 20251003200000, 20251004233954, 20251006142419, 20251008132209, 20251008202716, 20251019141249, 20251126190540, 20251130201520, 20251201183508, 20251202161637 |
| B03 | history-only, plain | 12 | - | owner approves the batch | 20251202175322, 20251203132851, 20251203143006, 20251205130430, 20251207160919, 20251209124126, 20251209130147, 20251209132737, 20251209132832, 20251209160206, 20251209160751, 20251213183547 |
| B04 | history-only, plain | 12 | - | owner approves the batch | 20251215014935, 20251215020530, 20251215163706, 20251216210332, 20251221223035, 20251221223207, 20251221231332, 20251227152354, 20251231171245, 20260105212344, 20260224145954, 20260305172037 |
| B05 | history-only, plain | 12 | - | owner approves the batch | 20260306143732, 20260311202123, 20260316162524, 20260316174421, 20260316234814, 20260317003321, 20260318191537, 20260318193312, 20260320134456, 20260323040745, 20260323163328, 20260323204632 |
| B06 | history-only, plain | 12 | - | owner approves the batch | 20260324043743, 20260324160956, 20260324175909, 20260324191556, 20260324195725, 20260324200626, 20260324210923, 20260324230943, 20260325060943, 20260325062358, 20260326052438, 20260327134130 |
| B07 | history-only, plain | 12 | - | owner approves the batch | 20260327171915, 20260402143448, 20260408200431, 20260409154545, 20260415182819, 20260415194218, 20260415233743, 20260415235903, 20260420171351, 20260421133448, 20260501173956, 20260518174651 |
| B08 | history-only, plain | 10 | - | owner approves the batch | 20260521153805, 20260526165639, 20260526182307, 20260611153900, 20260611170601, 20260611172855, 20260611174321, 20260712101626, 20260814120100, 20260816222905 |
| B09 | history-only, security-touching objects | 12 | - | owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS | 20251006222941, 20251201023349, 20251201204918, 20251205125943, 20251207182057, 20251209124118, 20251209125102, 20251213223314, 20251215015109, 20251221231712, 20251221234856, 20251222022503 |
| B10 | history-only, security-touching objects | 12 | - | owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS | 20251231170906, 20260305005525, 20260305010420, 20260305011324, 20260305012217, 20260305160637, 20260317181119, 20260317183923, 20260317201616, 20260317202513, 20260318191608, 20260321194111 |
| B11 | history-only, security-touching objects | 12 | - | owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS | 20260321210200, 20260323175228, 20260323200931, 20260323200947, 20260323201532, 20260323204640, 20260324135229, 20260324150819, 20260324162302, 20260324175947, 20260324191502, 20260324191655 |
| B12 | history-only, security-touching objects | 6 | - | owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS | 20260327211441, 20260409155123, 20260421025937, 20260421160051, 20260501173826, 20260526165610 |
| B13 | attestation, rule defined | 7 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251003152224, 20251003183947, 20251007210840, 20251231171420, 20260126184412, 20260203053948, 20260325231020 |
| B14 | attestation, rule defined | 5 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251003182356, 20251008144308, 20251205125907, 20251216201450, 20260126193254 |
| B15 | attestation, rule defined | 6 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251002180149, 20251130231633, 20251222014723, 20251222020729, 20260119195140, 20260311121119 |
| B16 | attestation, rule defined | 6 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251007220415, 20251007221227, 20251007221817, 20251130191333, 20260816221636, 20260928172217 |
| B17 | attestation, rule defined | 5 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251231174711, 20260224165424, 20260318191352, 20260331151647, 20260415234700 |
| B18 | attestation, rule defined | 2 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20260324175546, 20260324190039 |
| B19 | attestation, rule defined | 8 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251209133113, 20260120203953, 20260125170305, 20260302131311, 20260305205811, 20260311191611, 20260314213726, 20260314215031 |
| B20 | attestation, rule defined | 2 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20260323175236, 20260326004004 |
| B21 | attestation, rule defined | 1 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20260323164559 |
| B22 | attestation, rule defined | 1 | - | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251003170350 |
| B23 | SQL, Storage decision | 1 | - | owner approves the exact SQL (Storage decision: bucket limits); rule: limit still NULL | 20260325231044 |
| B24 | SQL, Storage decision | 1 | - | owner approves the exact SQL (Storage decision: bucket limits); rule: limit still NULL | 20260517221038 |
| B25 | attestation, WEAK rule | 2 | - | NOT approvable until the owner accepts the WEAK limit per version | 20260126193205, 20260224184535 |
| B26 | attestation, WEAK rule | 1 | - | NOT approvable until the owner accepts the WEAK limit per version | 20260224183629 |
| B27 | attestation, WEAK rule | 2 | - | NOT approvable until the owner accepts the WEAK limit per version | 20260224133344, 20260224161311 |
| B28 | attestation, WEAK rule | 1 | - | NOT approvable until the owner accepts the WEAK limit per version | 20260311113547 |
| B29 | BLOCKED | 1 | - | NOT approvable (blocked) | 20251001052039 |
| B30 | BLOCKED | 2 | - | NOT approvable (blocked) | 20260125173238, 20260305222010 |
| B31 | history-only, plain | 12 | B02, B03, B05, B07, B12, B18, B21 | owner approves the batch | 20251008141359, 20251008153245, 20251008170619, 20251126190624, 20251207183240, 20251209115445, 20251209163552, 20251209163810, 20251213205448, 20251213222807, 20251218153557, 20251231174141 |
| B32 | history-only, plain | 12 | B05, B06, B07 | owner approves the batch | 20251231190052, 20260101163312, 20260302131724, 20260315173552, 20260315175240, 20260315190615, 20260315194114, 20260315202232, 20260317144212, 20260317162507, 20260320001735, 20260320150558 |
| B33 | history-only, plain | 12 | B05, B06, B07, B08, B21 | owner approves the batch | 20260322210503, 20260322224107, 20260323035524, 20260323155019, 20260323155222, 20260323163432, 20260323200908, 20260323210432, 20260323210519, 20260324175858, 20260324191543, 20260324193222 |
| B34 | history-only, plain | 12 | B06, B07, B08 | owner approves the batch | 20260325061545, 20260326052113, 20260327125333, 20260327131256, 20260327162019, 20260327163057, 20260327170800, 20260327171850, 20260328182519, 20260328183418, 20260328183925, 20260328184611 |
| B35 | history-only, plain | 1 | B08 | owner approves the batch | 20260521153603 |
| B36 | history-only, security-touching objects | 11 | B06, B09, B10, B11 | owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS | 20251008180000, 20251201025216, 20251207182041, 20251221224640, 20251221231556, 20260304230635, 20260305004845, 20260318182333, 20260324052320, 20260324161031, 20260324191353 |
| B37 | attestation, rule defined | 1 | B09 | signed attestation per version (identity, date, scope, not_proven, evidence hash) | 20251221225000 |
| B38 | attestation, WEAK rule | 2 | B03, B04, B17 | NOT approvable until the owner accepts the WEAK limit per version | 20251001051901, 20251001192425 |
| B39 | attestation, WEAK rule | 1 | B06 | NOT approvable until the owner accepts the WEAK limit per version | 20260315173745 |
| B40 | history-only, plain | 12 | B09, B31, B33, B36 | owner approves the batch | 20251002195922, 20251003164124, 20251007214737, 20251007215413, 20251007215603, 20251207175802, 20251221223055, 20260322203342, 20260322204401, 20260322204444, 20260322205212, 20260322223521 |
| B41 | history-only, plain | 2 | B36 | owner approves the batch | 20260324051349, 20260324190114 |
| B42 | history-only, security-touching objects | 1 | B36 | owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS | 20260305002952 |
| B43 | history-only, security-touching objects | 1 | B10, B42 | owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS | 20260126193229 |

Execution order is the batch order. A batch is one transaction. Batches B01 to the last plain/security history-only batch change no schema and no application behaviour; they do change what migration tooling believes is applied, so no pending-migration tool may be run against Development afterwards without reading the ledger first. The two SQL batches change `storage.buckets` limits (`carousel-media`; `public-assets` size and type) and require the Storage decision.

## 4. Business and security issues: migration-history consequence versus Step 3
| Item | Migration-history consequence | Step 3 / other owner | Not changed here |
|---|---|---|---|
| 25 stale contact counters | `20260323164559` is an attestation (function identity proven; backfill not proven); three earlier counter versions are history-only after it | Owner: accept (self-corrects on the next order change) or approve a separate recompute | data untouched |
| Dormant `master` demo account (committed password) | `20251003170350` attested so it is never re-applied; deny-listed for execution | Step 3: disable or rotate; password redaction | account untouched |
| Absent `test_message` template | part of `20251003182356` attestation | none | not recreated |
| Absent `update_pricing_rules` | exclusion (section 1) | long-term keep/drop is Step 3 item 3.8 | not created |
| Two Storage bucket updates | `20260325231044`, `20260517221038` are the only pre-October SQL (batches X) | Storage decision; public-assets stays private | not run |
| Missing `service_role` SELECT on eight tables | none (no migration is involved) | Step 3: new reviewed grant | not granted |
| Broad `orders`/`user_roles` policies; schema containment | none | Step 3 / Step 4 item 4.9 | not changed |

## 5. Hosted PostgreSQL 17 risks (see `development-hosted-procedure.md`)
Non-superuser `postgres` (owns the ledger; UPDATE on `storage.buckets` is by grant, the table is owned by `supabase_storage_admin`, and Storage triggers on that table are unverified); rules avoid PostgreSQL 18 behaviours; the integration's multi-statement call was observed to run as one transaction (read-only test) but a failing write call has not been rehearsed hosted; ledger markers differ from the local executor's, so a later tool must recognise both; concurrent writers are blocked only by the advisory lock and the pre-batch count assertion.

## 6. Repository changes required before any execution
1. Commit the Step 2 files as local checkpoints (inventory in `evidence/e2k-commit-inventory.md`, updated for these files) so the plan is bound to a commit and the SQL hashes are reproducible.
2. Add the deny list (`20260611184401`, `20251003170350`) to the Development allowlist generator when a hosted mechanism is designed.
3. Decide the ledger `name` convention for new rows (the manifest proposes the filename without version and extension; existing Development rows mix both styles).
4. The hosted mechanism itself (generation of the signed per-batch scripts from the approved CSV, an operator audit log, the pre/post ledger export) is a separate, reviewed design: the local executor stays loopback-only and is not extended.

## 7. Proposed final Git organization (nothing staged or committed)
- **Active, small, kept in Git:** `audit/development-migration-manifest.csv`, `development-execution-manifest.csv`, `development-verification-rules.json`, `development-execution-batches.json`, `development-execution-approval-package.md`, `development-hosted-procedure.md`, `step2-completion.md`, `step2-migration-audit.md`; recovered migrations; `audit/evidence/withdrawn-migrations/`; `version-aliases.json`; the tests (`recoveredMigrationFiles`, `migrationReplaySafety`, `migrationPendingSet`, `developmentManifest`, `developmentExecutionManifest`); the generators and rehearsal tools in `audit/evidence/tools/`; `scripts/dev/local-executor/`.
- **Archive in Git, clearly superseded (do not edit):** the C to E2K narrative reports and CSVs under `audit/evidence/` (e2c to e2k). Suggested move into `audit/evidence/archive/` only when the owner wants a physical split; a rename changes no meaning but touches many references, so it is deferred.
- **Never in Git:** `C:\Users\vikki\migration-evidence\` (protected captures, transcribed results, scratch databases, audit stores), `__pycache__`, the unrelated `.gitignore` change.

## 8. Step 2 closure conditions
Step 2 closes as an audit, recovery and implementation-planning deliverable when the owner (1) accepts this package and `step2-completion.md`, (2) answers the decisions in section 1 and states whether the batch classes in section 3 are to be pursued, (3) accepts that hosted reconciliation, the October block and Step 3 remain open by design. Hosted reconciliation is complete only after the ledger shows the approved operations and a fresh `Q01` plus per-batch post-verification agree.
