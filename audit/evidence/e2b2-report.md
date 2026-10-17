# Stage E2B-2 report: owner decision package and final reconciliation readiness

Branch `Dev`, HEAD `63672cd221b4cc11fb436fd7ad65444d29746960`. Offline documentation and cross-checks only. No hosted connection, no executable reconciliation SQL, no migration or history change, no staging or commit. Deliverables: this report, `e2b2-owner-decision-package.md`, `e2b2-release-sequence-outline.md`, `e2b2-reconciliation-blockers.csv` (17 rows), `e2b2-commit-inventory.md`, tool `tools/e2b2_build.py`.

## 1. Verified 67-version proposed-action breakdown
`tools/e2b2_build.py` re-verified the E2B-1 crosswalk: 67 unique versions in version order, each present in `e2a-proposed-actions.csv` and `e1-reconciliation-readiness.csv`; D3 manifest counts 67 upgrade / 109 pending / 44 Development-line / 23 October. **57 execute + 6 execute (omission-tested) + 3 history-only candidates + 1 owner decision = 67.** Each version's treatment is listed individually in section 1 of the decision package. 39 of the 67 are older than Production's latest recorded version `20260928172217`.

## 2. The nine special versions
- **History-only candidates:** `20260715221828` (creates the anonymous INSERT policy on `invoice_links`; never execute without the next), `20260716104333` (drops it), `20261010110000` (`ADD COLUMN IF NOT EXISTS customer_approved_at`, already in Production). Effects, evidence and marking risks: decision package section 1.1.
- **Omission-tested:** `20260716151530`, `20260716152823`, `20260716173644`, `20260717111737`, `20260717113131`, `20260814114825`. Catalog equivalence shown; no data statements; intermediate states and interrupted runs not shown (section 1.2).

## 3. Decisions D-1 to D-7 (my recommendations, none approved)
| ID | Recommendation | Changes the 67 baseline? |
|---|---|---|
| D-1 | Keep all 67 (rehearsed) | A no; B (64) and C (58) yes |
| D-2 | Include `20260722172048` (the October booking path needs nullable `surface`; the "Dev only" header predates it) | no (exclude or replace would) |
| D-3 | Case 41: withdraw (never execute; backfill differs) | no |
| D-4 | Case 42: withdraw the duplicate, or annotated record | no |
| D-5 | Development alias: rename after approval (digest-identical; precedent `ce5637b`); change nothing until then | order within the 67 only |
| D-6 | Marked history-only records only where proof is complete; attestation for data effects no query can show | no |
| D-7 | Bookkeeping in the release window; Production first; Development after; Step 4 designs the path for the 39 older versions | no |

## 4. Readiness
- **Production: not ready for a manifest.** Blocked by decisions D-1 to D-7 and by evidence: 15 baseline versions with 25 unprovable data statements, one baseline version with constraint drift, six unmatched definitions, 16 of the 67 with data or dynamic statements against real rows (preflight not run), the unapproved application path for the 39 older versions. Execution-set and dependency analysis is complete.
- **Development: not ready and not on the critical path.** 306 pre-October files: 209 H, 89 P, 5 X (custom e-mail hook grants/function, `update_pricing_rules`, one anon policy), 3 I; 26 have absent or unmatched effects; 73 have 95 unprovable statements. Containment and the 14 stubs stay; October migrations must not run there until the coordinated release.

## 5. Remaining evidence gaps and resolution
Blocker table: `e2b2-reconciliation-blockers.csv` (B-01 to B-17: ID, scope, versions, gap, minimum resolution, decision, what it blocks, status). Minimum resolutions: per-statement read-only queries (`e2a-prod-baseline-proof.csv`, `e2a-dev-proof.csv`), definition queries (`e2a-unresolved-evidence.md` A), recorded statement text for cases 42 and the alias (D), the 24 preflight checks, Case 41 NULL-selection count, or an owner attestation worded as "attested, not proven". A count never proves the original SQL ran.

## 6. Ordering and prerequisites
`e2b2-release-sequence-outline.md`: decisions, read-only preconditions, security and deployment prerequisites, history-only records, SQL execution, Edge Function and frontend, verification and containment. `--include-all` and any unbounded hosted push stay forbidden.

## 7. Evidence integrity review
- All 31 Python tools under `audit/evidence/tools/` parse; secret-pattern scan over `audit/evidence` found nothing; the three test suites pass (63, 144 and 54).
- Cross-report consistency checked: 109 / 67 / 44 / 23 agree in E1, E2A, E2B-1, D3; manifest counts agree with the crosswalk.
- **Factual corrections made (my own E2B-1 files only):** the crosswalk's `evidence_references` text contained the stray placeholder "e2a-dev... n/a" (67 rows) and was removed in the CSV and in `tools/e2b1_build.py`; the statement in `e2b1-classification-reconciliation.md` that the D4 matrix "mentions 26 of the 67 versions" is accurate but the rows include column-default, NOT NULL, CHECK and privilege statements, not only data statements; wording clarified. No earlier-stage report was changed.
- E1's "18 unproven baseline versions" was refined by E2A to 16 class P (3 became H, 1 became P through the user_roles constraints); E2A's figure is the current one and E2A documents the change.

## 8. Git
Nothing staged or committed. Commit inventory: `e2b2-commit-inventory.md`. The `.gitignore` change belongs to another workstream and is untouched; `audit/evidence/tools/__pycache__/` is excluded.

## 9. Safety
No hosted environment was contacted or changed; no deployment, Supabase CLI, Docker, WSL, payment-provider call, migration SQL or application-code change; four checkpoint commits intact.
