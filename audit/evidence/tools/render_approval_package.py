"""Renders audit/development-execution-approval-package.md from the execution manifest, rules and batches (offline; no database). Narrative text lives here so the document can be regenerated after any change.
Usage: python -I render_approval_package.py"""
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_execution_package as P  # noqa: E402

rules, man, B = P.rules, P.man, P.BORDER
bat = defaultdict(list)
for i in B:
    bat[i["batch"]].append(i["v"])
cls = {b: P.klass(vs[0]) if vs[0] != P.CANARY else "canary" for b, vs in bat.items()}
CLS = {"canary": "CANARY (history-only)", "H": "history-only, plain", "S": "history-only, security-touching objects", "Q": "attestation, rule defined", "X": "SQL, Storage decision", "W": "attestation, WEAK rule", "Z": "BLOCKED"}
kinds = Counter(rules[v]["kind"].split("(")[0] for v in P.plan)
st = Counter(rules[v]["status"] for v in P.plan)
sup_only = [v for v in P.plan if rules[v]["kind"] in ("supersession", "vacuous (no persistent effect)")]
res = json.load(open(os.path.join(P.AUDIT, "evidence", "development-execution-test-results.json"), encoding="utf-8"))["summary"]
L = []
w = L.append
w("# Development execution approval package (pre-October, 259 operations)")
w("")
w("**Status: a proposal for owner review. Nothing in this package is approved, executed or authorized.** No hosted write occurred while preparing it; Production was not contacted. Every ledger entry proposed here is bookkeeping: a `history-only` or `attestation` row means \"this version is handled\", never \"this SQL ran\". Source of truth: `development-execution-manifest.csv` (one row per operation), `development-verification-rules.json` (one read-only rule per operation), `development-execution-batches.json` (batch membership and script hashes), `development-hosted-procedure.md` (how a batch would be applied). Regenerate with `audit/evidence/tools/build_execution_manifest.py`, `build_execution_package.py`, `render_approval_package.py`.")
w("")
w("## 1. Final migration decisions in this package")
w("### `20260611184401` (creates `update_pricing_rules`): proposed permanent exclusion (NOT yet owner-confirmed)")
w("- **Why the function is unnecessary:** it exists only in Production; no repository file, Edge Function or application code calls it (searched `src/`, `supabase/functions/`); no Development database function mentions it (hosted check Q33 = 0); `20261007120000` already treats its absence as normal (`IF to_regprocedure(...) IS NOT NULL`). The pricing screens change `pricing_rules` through the table, not this RPC.")
w("- **Does leaving it absent change behaviour?** No caller exists, so no application behaviour changes. Production compatibility is unaffected because Production keeps its own copy; if a real dependency appears later it must be raised as a new SQL decision.")
w("- **How tooling avoids executing it:** it is not in any allowlist; the manifest category is `Excluded from plan`; every future allowlist document must carry it (and the demo-admin migration `20251003170350`) in its `deny` list, which the local executor already refuses; the standing prohibition on `--include-all` / applying all pending migrations stays.")
w("- **Ledger treatment, two options:** (a) leave the version pending (recommended: nothing claims it was handled, and the deny list prevents execution); (b) a separately justified *not-applicable attestation* stating that the function was deliberately not created. Option (b) makes the Development and Production ledgers look alike but writes a row for SQL that never ran, so it needs its own owner decision. **Owner decision required: confirm exclusion, and choose (a) or (b).**")
w("### `20251003182356` (seeds six SMS templates): the missing `test_message` template does not need recreation")
w("It is a testing-only row (\"Used for testing SMS functionality\"), referenced nowhere in the repository, the Edge Functions or the application; the other five templates exist; a re-run would only re-insert the test row (`ON CONFLICT DO NOTHING`). The operation's rule requires the five real templates and expects `test_message` to be absent. No attestation exists. Before any attestation is signed the owner must confirm that the removal was deliberate; otherwise the version stays pending (**owner decision**).")
w("")
w("## 2. Are the 259 operations adequately verified?")
w(f"**No, not all.** Rule status: **{st['DEFINED']} DEFINED**, **{st['WEAK']} WEAK**, **{st['BLOCKED']} BLOCKED**. A rule is one read-only SELECT returning a boolean; it shows the *current* state is consistent with the migration and is never proof that it ran. Rules use `to_regclass`, `information_schema`, `pg_indexes/pg_policies/pg_trigger/pg_proc/pg_constraint` and effective-privilege functions only, no `NOT NULL` constraint rows (PostgreSQL 17 stores them differently from 18).")
w("")
w("| Rule kind | Operations |")
w("|---|---|")
for k, n in kinds.most_common():
    w(f"| {k} | {n} |")
w("")
w(f"- {len(sup_only)} DEFINED operations are *supersession-only or vacuous*: every statement was replaced by a predecessor that is recorded first, or has no persistent effect, so there is no object of their own to check. They are valid only in the stated order.")
w("- **WEAK (not approvable as is; each needs the owner to accept the stated limit in the attestation scope):** " + ", ".join(f"`{v}`" for v in P.plan if rules[v]["status"] == "WEAK") + ".")
w("- **BLOCKED (no safe rule; kept out of every approvable batch):** " + ", ".join(f"`{v}`" for v in P.plan if rules[v]["status"] == "BLOCKED") + ". `20251001052039` (sample units: none exists, so nothing can be verified), `20260125173238` and `20260305222010` (recompute every order's balance with no predicate; the formula cannot be re-proved on orders edited since). Options for the owner: leave pending, or sign an explicit *unverifiable* attestation that names the limit; the second changes this package.")
w(f"- Local validation (`test_execution_scripts.py`, {res['pass']} pass, {res['fail']} fail): every catalog atom evaluates on the captured Development schema; every plain/security history-only rule is TRUE there; rules are FALSE when an object is missing (a mutated scratch schema rolls the whole batch back); the Production pre-upgrade schema is only a weak negative control (most of these objects pre-date it). **Hosted truth of every rule is established only by running it on Development immediately before its batch.**")
w("")
w("## 3. Canary and batch sequence")
c = P.CANARY
w(f"**Canary: `{c}` (`{man[c]['filename_or_archived_source']}`), batch {P.bid[c]}.** One `history-only` row; rule: {rules[c]['note']}. Why: it has no predecessors, checks only that an added column exists, touches no policy, grant or data, and the column is part of the core orders schema. Expected change: ledger +1 row (58 to 59), no schema change. Verify: the row exists with the marker, the rule re-evaluates true, `Q01` shows exactly 59 rows and the 58 earlier rows unchanged. Reversal: `REVERSAL {P.bid[c]}` (deletes exactly that row). Not executed.")
w("")
w("| Batch | Class | Ops | Needs earlier batch(es) | Approval / decision | Versions (execution order) |")
w("|---|---|---|---|---|---|")
for b in sorted(bat):
    vs = bat[b]
    need = sorted({P.bid[p] for v in vs for p in rules[v]["predecessors"] if p in P.bid and P.bid[p] != b})
    k = cls[b]
    appr = {"canary": "owner approves the canary and the mechanism check", "H": "owner approves the batch", "S": "owner approves the batch; run BEFORE any Step 3 change to the checked policies/grants/RLS", "Q": "signed attestation per version (identity, date, scope, not_proven, evidence hash)",
            "X": "owner approves the exact SQL (Storage decision: bucket limits); rule: limit still NULL", "W": "NOT approvable until the owner accepts the WEAK limit per version", "Z": "NOT approvable (blocked)"}[k]
    w(f"| {b} | {CLS[k]} | {len(vs)} | {', '.join(need) or '-'} | {appr} | {', '.join(vs)} |")
w("")
w("Execution order is the batch order. A batch is one transaction. Batches B01 to the last plain/security history-only batch change no schema and no application behaviour; they do change what migration tooling believes is applied, so no pending-migration tool may be run against Development afterwards without reading the ledger first. The two SQL batches change `storage.buckets` limits (`carousel-media`; `public-assets` size and type) and require the Storage decision.")
w("")
w("## 4. Business and security issues: migration-history consequence versus Step 3")
w("| Item | Migration-history consequence | Step 3 / other owner | Not changed here |")
w("|---|---|---|---|")
w("| 25 stale contact counters | `20260323164559` is an attestation (function identity proven; backfill not proven); three earlier counter versions are history-only after it | Owner: accept (self-corrects on the next order change) or approve a separate recompute | data untouched |")
w("| Dormant `master` demo account (committed password) | `20251003170350` attested so it is never re-applied; deny-listed for execution | Step 3: disable or rotate; password redaction | account untouched |")
w("| Absent `test_message` template | part of `20251003182356` attestation | none | not recreated |")
w("| Absent `update_pricing_rules` | exclusion (section 1) | long-term keep/drop is Step 3 item 3.8 | not created |")
w("| Two Storage bucket updates | `20260325231044`, `20260517221038` are the only pre-October SQL (batches X) | Storage decision; public-assets stays private | not run |")
w("| Missing `service_role` SELECT on eight tables | none (no migration is involved) | Step 3: new reviewed grant | not granted |")
w("| Broad `orders`/`user_roles` policies; schema containment | none | Step 3 / Step 4 item 4.9 | not changed |")
w("")
w("## 5. Hosted PostgreSQL 17 risks (see `development-hosted-procedure.md`)")
w("Non-superuser `postgres` (owns the ledger; UPDATE on `storage.buckets` is by grant, the table is owned by `supabase_storage_admin`, and Storage triggers on that table are unverified); rules avoid PostgreSQL 18 behaviours; the integration's multi-statement call was observed to run as one transaction (read-only test) but a failing write call has not been rehearsed hosted; ledger markers differ from the local executor's, so a later tool must recognise both; concurrent writers are blocked only by the advisory lock and the pre-batch count assertion.")
w("")
w("## 6. Repository changes required before any execution")
w("1. Commit the Step 2 files as local checkpoints (inventory in `evidence/e2k-commit-inventory.md`, updated for these files) so the plan is bound to a commit and the SQL hashes are reproducible.")
w("2. Add the deny list (`20260611184401`, `20251003170350`) to the Development allowlist generator when a hosted mechanism is designed.")
w("3. Decide the ledger `name` convention for new rows (the manifest proposes the filename without version and extension; existing Development rows mix both styles).")
w("4. The hosted mechanism itself (generation of the signed per-batch scripts from the approved CSV, an operator audit log, the pre/post ledger export) is a separate, reviewed design: the local executor stays loopback-only and is not extended.")
w("")
w("## 7. Proposed final Git organization (nothing staged or committed)")
w("- **Active, small, kept in Git:** `audit/development-migration-manifest.csv`, `development-execution-manifest.csv`, `development-verification-rules.json`, `development-execution-batches.json`, `development-execution-approval-package.md`, `development-hosted-procedure.md`, `step2-completion.md`, `step2-migration-audit.md`; recovered migrations; `audit/evidence/withdrawn-migrations/`; `version-aliases.json`; the tests (`recoveredMigrationFiles`, `migrationReplaySafety`, `migrationPendingSet`, `developmentManifest`, `developmentExecutionManifest`); the generators and rehearsal tools in `audit/evidence/tools/`; `scripts/dev/local-executor/`.")
w("- **Archive in Git, clearly superseded (do not edit):** the C to E2K narrative reports and CSVs under `audit/evidence/` (e2c to e2k). Suggested move into `audit/evidence/archive/` only when the owner wants a physical split; a rename changes no meaning but touches many references, so it is deferred.")
w("- **Never in Git:** `C:\\Users\\vikki\\migration-evidence\\` (protected captures, transcribed results, scratch databases, audit stores), `__pycache__`, the unrelated `.gitignore` change.")
w("")
w("## 8. Step 2 closure conditions")
w("Step 2 closes as an audit, recovery and implementation-planning deliverable when the owner (1) accepts this package and `step2-completion.md`, (2) answers the decisions in section 1 and states whether the batch classes in section 3 are to be pursued, (3) accepts that hosted reconciliation, the October block and Step 3 remain open by design. Hosted reconciliation is complete only after the ledger shows the approved operations and a fresh `Q01` plus per-batch post-verification agree.")
open(os.path.join(P.AUDIT, "development-execution-approval-package.md"), "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
print("written", len(L), "lines; batches", len(bat))
