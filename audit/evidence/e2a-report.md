# Stage E2A report: historical migration proof and reconciliation dependency analysis

Branch `Dev`, HEAD `63672cd221b4cc11fb436fd7ad65444d29746960` (four checkpoint commits intact). **Local research only.** No hosted connection, no migration run, no history row inserted, no executable reconciliation transaction written. Inputs: the immutable Stage B captures (2026-10-16 18:54:59 UTC Production, 18:55:20 UTC Development), repository SQL (386 files, Case 43 absent), and the E1 results. Outputs in `audit/evidence/`: `e2a-prod-baseline-proof.csv` (40 rows) + `e2a-prod-baseline-statements.csv`, `e2a-dev-proof.csv` (306 rows), `e2a-proposed-actions.csv` (every version pending against each environment, 438 rows + Case 43), `e2a-dependency-register.csv` (562 edges), `e2a-prod-alias-comparison.md`, `e2a-recorded-exceptions.md`, `e2a-unresolved-evidence.md`; method in `tools/e2a_sql.py`, `e2a_analyze.py`, `e2a_run.py`, `e2a_docs.py`; the full per-statement evidence (both environments, about 6,800 statement elements) is in the protected `e2a-scratch` folder.

## 1. Preflight
Branch `Dev`, HEAD `63672cd`; 386 migration files, Case 43 absent; recovered-file hash tests 63/63, replay-safety 144/144, pending-set 54/54; calculator: 386 versions, Production 277 recorded / 109 pending, Development 58 / 329; D3 upgrade manifest (67 files) and D2/D1-D4/E1 reports unchanged; nothing staged. The uncommitted `.gitignore` line is another workstream's and was not touched.

## 2. Method (and what it does and does not prove)
Every migration file was split into statements, and each statement into chain elements keyed by object: table, column attribute (type, NOT NULL, default), constraint, index, policy, trigger, function, RLS flag, grant, extension, storage bucket. For each environment the captured catalog state of each object was matched against the elements of its chain: the elements whose definition equals the captured state are `PRESENT`; an earlier element is `SUPERSEDED` by the nearest later matching element, which the report cites; an element after the last matching one is `ABSENT` (the catalog reflects an older definition); an existing object matching no element is `UNMATCHED`; `IF NOT EXISTS` statements on objects an earlier migration already created are `NOOP`. Elements of the unapplied October release can never explain an earlier migration. Definition matching: functions by the Stage B body digests, columns by normalized type/NOT NULL/default, indexes, constraints, policies and triggers by normalized token sets (a **heuristic**, not a byte comparison). Data statements (INSERT/UPDATE/DELETE), unguarded dynamic SQL and wide grants stay `UNPROVABLE`, each with a generated read-only query.
**What a verdict means:** `H` says the captured target state equals what the migration chain describes for every material statement, so a history-only record would describe a true state of the schema; it does **not** say the original SQL ran, and it says nothing about data. This is the "schema-equivalence reconciliation candidate" the stage asked for.

## 3. Updated classifications
Classes: **H** history-only (schema-equivalence) candidate, **X** future SQL execution required, **I** version identity decision, **P** requires additional proof, **W** intentionally withdrawn, **B** blocked by unresolved dependency (none occurred; see section 6).

| | Production (109 pending) | Development (329 pending) |
|---|---|---|
| H history-only candidates | **26** (24 of 40 baseline; 2 net-zero dev-line files) | **209** |
| X execution required | **41** (18 dev-line, including U-5; 23 October) | **28** (5 pre-October: custom e-mail hook x3, update_pricing_rules, one anon policy; 23 October) |
| P requires additional proof | **40** (16 baseline; 24 dev-line) | **89** (68 data-only; 21 with absent or unmatched objects) |
| I identity decision | **2** (cases 41, 42) | **3** (cases 41, 42, `20260814120000`) |
| W withdrawn | Case 43 (excluded) | Case 43 (excluded) |
| B blocked by dependency | 0 | 0 |

Pre-October only: Production 86 (H 26, P 40, I 2, X 18); Development 306 (H 209, P 89, I 3, X 5). Every pending version has a row in `e2a-proposed-actions.csv` with its class, the statement counts (present / superseded / no-op / absent / unmatched / unprovable), the superseding versions cited, the evidence artifacts and the read-only queries needed.

## 4. Production baseline (40 files), one verdict per version
- **24 H:** every material statement is present or superseded in Production's catalog, each supersession citing the later migration (19 distinct superseding versions, all earlier than October: `20251003200318`, `20251006222941`, `20251008153245`, `20251008153325`, `20251126190540`, `20251207184549`, `20251209115445`, `20251209124058`, `20251209124118`, `20251209124126`, `20251209125102`, `20251209160751`, `20251216210332`, `20260224145954`, `20260224165424`, `20260323164559`, `20260323175233`, `20260324180043`, `20260421025937`). E2A resolves the guarded `DO $$ ... IF NOT EXISTS ... ALTER TABLE ... $$` blocks into ordinary statements and checks full definitions.
- **16 P:** 15 contain data statements a schema snapshot cannot prove (seed rows for units, `admin_settings`, `sms_message_templates`, `pricing_rules`; backfill updates of `orders.status`, `deposit_required`, `contacts.total_bookings`; the demo admin user in `015_create_demo_admin_user`, which is also finding SEC-A) and 1, `20251001051900_000_create_user_roles`, has two **absent** effects: the `user_roles.user_id` foreign key and the role CHECK, the known out-of-band drift (no applied migration removes them). All 16 have read-only count queries in the CSV.
- **Against E1:** of the 22 baseline versions E1 treated as proven (effects present or superseded), 21 stay H and 1 (`000_create_user_roles`) becomes P because its absent FK and CHECK are now counted; of the 18 E1 called unproven, **3 become H** (their guarded blocks and definitions are now verified) and 15 remain P (all 15 carry data statements).

## 5. Cases 41 and 42 (details in `e2a-prod-alias-comparison.md`)
- **41:** the column additions are identical, but the backfill `UPDATE` differs (`'deposit'` always vs `'full'`/`'deposit'` by amount) and is guarded only by `customer_selected_payment_cents IS NULL`. Executing `20260305203528` on Production would rewrite every order that still has NULL there. **Do not execute.** Class I; treatment options: withdraw before application (Case 43 precedent) or a record explicitly marked "superseded draft, not executed".
- **42:** executable SQL **identical** (digest `23fa13ed...`); only header comments differ; the whole body is guarded by the column's existence, so execution is a no-op. A history-only record is truthful; withdrawing the duplicate is equally valid. Class I (owner decision).

## 6. Development proof and dependency closure
The register has 562 edges: **supersession** edges (a version's effect is replaced by a cited later version) and **table-creator** edges (the version touches a table created by another version). Closure: all supersession edges point to a later element that the catalog reflects (that is what `SUPERSEDED` means), so no version is blocked by an unproven superseder; 154 Development supersession edges are fully closed and 53 are "ordering" edges (the superseding version is itself pending and unproven for other reasons, so it should be reconciled first, but the supersession claim itself is proven). Table-creator edges: Development 113 closed, 128 ordering, none block (no referenced table is missing); Production 24 closed, 41 ordering, and **9 block** (dev-line versions touching tables that do not exist in Production, so they cannot be bookkept and need execution or further proof; they are classes X or P).

Results for the populations E1 asked to prioritize (Development, pre-October):
| E1 population | n | E2A: H | P | X |
|---|---|---|---|---|
| superseded with an unproven superseding dependency | 34 | 29 | 3 | 2 |
| not yet proven | 106 | 39 | 67 | 0 |
| partially present | 11 | 0 | 11 | 0 |
| reported absent | 3 | 0 | 2 | 1 |
| effects present | 83 | 78 | 4 | 1 |
| superseded | 100 | 92 | 5 | 3 |

So the E1 worry about unproven superseding dependencies is largely discharged (29 of 34 are H); 39 of the 106 unproven are now H after guarded `DO` blocks and full definitions are checked; the 11 partially present versions stay P (their absent effects are genuine: storage policies removed by containment, the role CHECK, `pg_net`, Realtime tables, the custom e-mail hook, `update_pricing_rules`).

## 7. Recorded-version exceptions (details in `e2a-recorded-exceptions.md`)
- Production `20251207163822`: role CHECK absent, **out-of-band drift** (later recorded migrations prove it was gone before 2026-03-24).
- Development `20260718000744`: **no exception**: the two "missing" policies exist under 63-byte truncated names (correction of an earlier "out-of-band rename" claim).
- Development `20260723174017`: policy removed after application (containment), not an incorrect application.
- Development `20260814002658`: recorded SQL digest equals the file `20260814120000_create_contact_inquiries.sql`; identity decision for the owner.

## 8. Reconciliation of counts across Stage B, E1 and E2A
| Production (109, Case 43 excluded) | Stage B class | E1 category | E2A class |
|---|---|---|---|
| baseline 40 | 17 superseded + 11 present, 9 no-catalog-effect, 3 name-level | 9 present, 13 superseded, 18 unproven | 24 H, 16 P |
| cases 41/42 | effects present (alias) | identity | I, I |
| dev-line 44 | 28 pending-expected, 8 net-zero chain, 7 data/privilege-only, 1 redefinition | 30 absent, 6 partial, 8 unproven | 2 H (net-zero), 24 P, 18 X |
| October 23 | pending expected | execute later | X |

Why the numbers moved: (1) E2A resolves guarded `DO` blocks into statements instead of calling them dynamic; (2) it applies PostgreSQL's 63-byte identifier truncation; (3) it treats a PUBLIC grant as covering every role; (4) it ignores `IF NOT EXISTS` statements on objects already created (no-ops); (5) it matches full definitions rather than names; (6) it will not let unapplied October elements explain earlier migrations; (7) two net-zero create-then-drop files in Production are schema-equivalent rather than "execution required" (both are still in the 67-file rehearsal set, which is unchanged). Development: Stage B history-only 212+50+30, 14 unexpected-missing; E1 183 candidates, 106 unproven, 11 partial, 3 absent, 3 identity; E2A 209 H, 89 P, 5 X, 3 I (pre-October).

## 9. New evidence and corrected assumptions
- **Correction:** Stage B/E1's "out-of-band rename" of two Development policies is a PostgreSQL 63-byte identifier truncation; the Development recorded-effect-missing count is 1, not 2.
- Case 42 is executable-identical; Case 41 is not and must not be executed.
- The Development alias is content-identical to the repository file.
- Net-zero create-then-drop chains (`20260715221828`/`20260716104333` in Production) are already schema-equivalent.
- 24 of 40 baseline files are provable as schema-equivalent with a cited superseder; the remaining 16 are limited by data statements (15) and one known drift (1), not by schema.
- E1's "34 unproven superseding dependencies" resolve to 29 H, 3 P, 2 X.

## 10. U-5 (`20260722172048`, nullable `orders.surface`)
Retained in the proposed Production release set and in the unchanged 67-version rehearsal set; class **X** in Production (the NOT NULL and the old CHECK are still there) pending the owner's decision. Purpose: allow NULL surface for Event-Essentials-only orders, which the current booking code (`bookingBuild.ts` line 271) sends; excluding it leaves Production rejecting those bookings. Recorded in Development; its DDL statements are `PRESENT` there. Full analysis in `e1-owner-decisions.md`.

## 11. Outstanding owner decisions
U-5; version identity of `20260305203528` (withdraw / marked record / leave), `20260407203226` (record / withdraw duplicate) and `20260814120000` vs `20260814002658` (rename / alias record / leave); whether Development is reconciled at all and how to treat its absent items (custom e-mail hook, `update_pricing_rules`, Realtime tables, containment policies) without restoring them by default; evidence route for the 16 Production baseline and 68 Development data-only versions (read-only count queries vs attestation); bookkeeping timing; the earlier Step 3/4 items (`supabase_admin` defaults, out-of-band release path, deploy-first order, SEC-A).

## 12. Can an approval-ready manifest be produced?
- **Production:** the 67-version execution set is ready. A bookkeeping manifest is possible for the **26 H versions** after re-verification inside the 24 h window; the **40 P versions** need either the read-only data checks (prepared, not run) or attestation; the 2 identity cases need decisions; U-5 needs its decision.
- **Development:** a manifest could cover the **209 H versions** (after re-verification and ordering the 53 ordering edges), but not the 89 P, 5 X or 3 I; Development has more open evidence and decisions than Production and should follow the Production path.
- Neither manifest should be called approval-ready until the decisions in section 11 are answered and the captures are refreshed.

## 13. Files and boundaries
Created in `audit/evidence/`: `e2a-report.md`, `e2a-prod-baseline-proof.csv`, `e2a-prod-baseline-statements.csv`, `e2a-prod-alias-comparison.md`, `e2a-dev-proof.csv`, `e2a-proposed-actions.csv`, `e2a-dependency-register.csv`, `e2a-recorded-exceptions.md`, `e2a-unresolved-evidence.md`, `tools/e2a_sql.py`, `tools/e2a_analyze.py`, `tools/e2a_run.py`, `tools/e2a_docs.py`. Modified: `audit/step2-migration-audit.md` (section AH). No migration SQL, pending-set tool, replay tool or application code changed. Production and Development were not contacted or modified; no Supabase CLI, Docker, WSL, deployment, staging, commit or push.
