# From temporary recovery to standard automatic Supabase migrations (Decision 3)

The custom executor is a **temporary recovery tool**. This plan says how Development gets from its current ledger to a state where `supabase db push` and the Supabase GitHub integration work in the ordinary way, with no recurring repairs. Evidence: the real Supabase CLI (v2.104.0) pointed at disposable local databases (`scripts/dev/hosted-executor/cli-oracle.py`, results in `cli-oracle-results.json`). Nothing hosted was contacted or changed.

> **Step 4A.4 update:** the representation of the 13 unrecordable versions below (sections 4 O3, 5, 6 T4-T6) is a **proposal, not an approved plan**. It is independently reviewed in `thirteen-migration-review.md`, which tests the alternatives with the real CLI (`exclusion-alternatives-oracle.json`): `migration repair --status applied` is rejected because it records the file's own SQL as if executed; moving or renaming files hides them from the CLI but breaks Production's reconciliation; marker rows are honest only with explicit wording and a per-version signature. Nothing is recorded until the owner decides per version (G-21).
>
> **Step 4A.6 update:** a database built from the repository files stops at `20260324175546` (not caused by the 13); markers fix only existing databases. Recommended strategy: markers now, a reviewed baseline later; fresh-database management rules and the optional additive compatibility files are in `thirteen-migration-review.md` sections 13-18 (evidence: `fresh-database-oracle-results.json`).
>
> **Step 4A.5 update:** hosted read-only evidence (thirteen-migration-review.md sections 8-12) shows none of the 13 is demonstrated as executed on Development, 9 would be harmful to execute and 4 would be redundant. Recording a marker row (option B) satisfies the CLI and the integration but leaves a fresh database executing those files; that trade-off needs an explicit owner decision before T4-T6.

## 1. How the standard tooling behaves (observed, not assumed)
| Rule | Observed with the real CLI |
|---|---|
| Every version in the remote ledger must have a local file | otherwise `db push` stops: "Remote migration versions not found in local migrations directory" (suggests `migration repair` or `db pull`). **This is exactly the message on every `Dev` push check since 2026-09-28.** |
| Every local file with no ledger row is "pending" and **will be executed**, in version order | yes: it does not know about blocked, withheld, excluded or "history-only" intentions |
| A pending file older than the newest remote version | refused without `--include-all` ("Found local migration files to be inserted before the last migration on remote database") |
| Files not named `<digits>_<name>.sql` | ignored (so the three withdrawn files, which live under `audit/evidence/withdrawn-migrations/`, are invisible to it; their versions are not in any ledger either) |
| Content of a file | irrelevant to pending-ness; a comment-only file is applied as a no-op |

## 2. Current state
- Ledger: 58 rows, 57 of which have a file of the same version; **1 remote-only version**, `20260814002658` (a ledger alias; the file is `20260814120000_create_contact_inquiries.sql`). That single row is the whole reason the integration fails.
- 389 repository files: 57 recorded + 1 alias-covered + 225 history-only candidates + 46 owner-attestation candidates + 2 bucket-limit SQL + 28 executor files + 17 withheld (record after October) + **13 that cannot be recorded under the approvals given so far**.

## 3. What a standard push would do at each stage (CLI oracle, local)
| Stage | Result |
|---|---|
| A. today | refuses (remote-only alias version) |
| B. if only the alias problem were fixed | **would execute 332 files, including all 13 that must never run** (the 3 blocked versions `20251001052039`, `20260125173238`, `20260305222010`; `update_pricing_rules` `20260611184401`; the 9 weak-rule attestations), and would re-run `20260814120000_create_contact_inquiries.sql` a second time |
| C. after Step 2 bookkeeping rows (225 history-only, 46 attestations, 2 bucket updates, the alias-covered file) | 58 pending |
| D. after the 28 executor files | 30 pending |
| E. after the 17 withheld versions | exactly the 13 unrecordable ones remain pending |
| F. after those 13 also have honest "NOT EXECUTED" rows (a simulation of a decision not yet made) | **"Remote database is up to date."** |
| G. then one new future file | exactly that one file is pending |
| H. an older unrecorded file without `--include-all` | refused |

**Real pushes (not dry runs), local scratch database only, `cli-oracle-results.json` steps I, I2, J, K:**
| Step | Observed |
|---|---|
| I | one new future-dated file was applied; exactly one ledger row was added (`20261101120000`, name from the file) |
| I2 | a dry run afterwards printed "Remote database is up to date." |
| J | two new files created in reverse order of creation were applied in ascending version order (`20261102120000`, `20261103120000`) |
| K | a failing file followed by a good one: the failing file recorded **no** ledger row and the later file did not apply; the error was shown |
So after recovery the standard push does only what a developer expects: new files, in version order, one transactional row each, nothing recorded on failure.

**Will the CLI and the GitHub integration recognize the final ledger?** The CLI: yes, proven locally at stage F and steps I-K (it compares versions only). The integration: its pre-check is the same remote-versus-local comparison (its failure text on every `Dev` push is the CLI's message), so it should pass once every ledger version has a file and every file has a row; **that is inferred, not observed**, which is why gate G-25 keeps a canary.

**Re-enabling the integration (Development).** Current settings (owner-reported, not to be changed by this work): production branch `Dev`, Deploy to production ON, Automatic branching OFF. During recovery the integration must not execute migrations on its own (it would try the 332-file push shown in stage B once the alias problem is fixed). So: it stays ineffective while its check fails (today), the owner turns Deploy to production OFF for Development before the first push of the rollout (gate D-03b), and it is turned back ON only after the completion postconditions in section 8 hold and the T9 canary is approved (G-25). Production's own integration (production branch `main`, Deploy ON, Automatic branching ON) is untouched by this work.

**Isolated standard-migration proof plan (nothing hosted):** (1) local: `cli-oracle.py` against disposable PostgreSQL with the real CLI (done; re-run after T5-T6 change the file set); (2) at T8, a hosted read-only dry run; (3) at T9, the one-file canary push. Steps 2 and 3 need separate owner approval.

**Conclusion:** ordinary deployment can resume only after stage F. Matching ledger counts alone prove nothing: the oracle checks identity (every file has a row), not counts.

## 4. Remaining structural obstacles (all must be closed, none is closed today)
| # | Obstacle | Why | Honest fix | Owner decision |
|---|---|---|---|---|
| O1 | Remote-only ledger version `20260814002658` | CLI refuses | add a **comment-only** migration file with that exact version (no SQL, header explains it). It is additive, rewrites nothing, and is harmless on Production (it would apply as a no-op there) | G-21 |
| O2 | File `20260814120000` has no ledger row (only its alias) | CLI would execute it again | add a ledger row `history-only NOT EXECUTED (recorded as alias 20260814002658)` through the Step 2 bookkeeping design. This amends the Step 2 manifest line "Already recorded, no change" and needs a new Step 2 decision | G-21 |
| O3 | 13 files cannot be recorded (3 blocked, 1 excluded, 9 weak-rule) and the Step 2 plan says they "stay pending" | the CLI executes pending files, including `update_pricing_rules` and balance-fix data scripts | each needs an **owner-signed attestation row** that says exactly what it is: `attestation NOT EXECUTED`, scope, `not_proven`, evidence hash. For the 3 blocked and the 9 weak ones that requires new read-only evidence first (Step 2 rule), and the owner accepting the stated limits. No row may say "executed" | G-21 |
| O4 | New migrations stamped earlier than `20261026120400` | the 28 files carry October 2026 versions; today is 2026-10-19; a new file stamped now is "older than the last remote" and is refused without `--include-all` | stamp every new migration later than `20261026120400` (for example `20261027000000` or later) until the real clock passes it | procedure |
| O5 | Bolt (the original builder) can push to GitHub and applies SQL through Supabase's MCP `apply_migration`, which stamps its **own** timestamp as the version and writes no matching file | that is how the alias rows and mixed names in the Development ledger arose; every such call recreates O1 | Bolt must not touch the database or Git while recovery runs, and afterwards must not apply migrations (see `bolt-access-control.md`) | G-20 |
| O6 | `config.toml` drives function deployment | with "Deploy to production" on, every push deploys the 52 functions declared there, with their `verify_jwt` values, including stubs and the 21 flips nobody approved | align `config.toml` to the approved JWT matrix and the owner's deploy decisions in a reviewed commit **before** re-enabling the integration | G-24 |
| O7 | Integration behavior beyond the pre-check is unproven | its toggles are unreadable; the check run name suggests branching/preview behavior | owner reads the toggles; prove with a canary push (section 7) | G-25 |

## 5. How each class is represented so the standard workflow cannot execute it
| Class | Count | Representation |
|---|---|---|
| Already recorded | 57 (+ the alias row) | nothing to do |
| Evidence-backed history-only | 225 | ledger row `-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED; ... basis=...` after its rule is true (Step 2 batches) |
| Attested (rule defined) | 46 (includes the demo-admin migration: history only, **never executed**) | row `attestation NOT EXECUTED` with signed identity, date, scope, not_proven |
| Actual SQL | 2 bucket updates + 28 files | executed with their own ledger row (Step 2 batch; sealed executor) |
| Withheld (record after October) | 17 | history-only rows after the October file that supersedes them has run and been verified |
| Blocked / excluded / weak (13) | 13 | **honest attestation rows after new evidence and owner signature** (O3). Not "executed"; not deleted from the directory; not renamed |
| Withdrawn Cases 41/42/43 | 3 | not in `supabase/migrations/` (archived under `audit/evidence/withdrawn-migrations/`) and **never recorded**: the CLI ignores them. A test already forbids a ledger row or a file for them |
Why attestation rather than moving the 13 files out of the directory: the same repository will later carry the Production release, and Production's ledger already records **10 of the 13** (`20260125173238` ... `20260611184401`, all executed there historically; the 3 oldest, `20251001051901`, `20251001052039`, `20251001192425`, are baseline files recorded nowhere on Production). Removing those files would recreate "remote versions not found" on Production. Why not repair/delete ledger rows or squash history: it rewrites applied history, which is not allowed.

## 6. Temporary recovery to standard deployment: the sequence
| Step | Action | Hosted mutation | Gate |
|---|---|---|---|
| T0 | Bolt access frozen; Supabase "Deploy to production" and "Automatic branching" OFF for the Development project; backup per `backup-options-comparison.md`; Git reconciled (`git-remote-reconciliation.md`) | owner toggles | G-20, D-03b, D-02, G-22 |
| T1 | Step 2 bookkeeping part 1 (S2) and the two bucket updates (S3) | ledger rows, 2 bucket rows | G-07, G-08 |
| T2 | Guarded Edge deployments (S1, S4, S6), canary (S4b), October (S5), Step 3B (S7) via the sealed executor | executor | existing |
| T3 | Bookkeeping part 2 (S8): the 25 deferred history-only, 2 deferred attestations, the 17 withheld | ledger rows | existing |
| T4 | **New evidence package for the 13** (read-only queries), owner decision, signatures | none until signed | G-21 |
| T5 | Close O2: ledger row for `20260814120000` (new Step 2 batch); close O1: reviewed commit adding the comment-only alias file and the regenerated manifests and tests (the manifests, execution manifest and pinned file counts move from 389 to 390 files) | one ledger row; a local commit | G-21 |
| T6 | Record the 13 attestation rows | ledger rows | G-21 |
| T7 | Align `config.toml` to the approved functions and flags (O6) in a reviewed commit | none | G-24 |
| T8 | Completion check (section 8), including `supabase migration list` and `supabase db push --dry-run --include-all` against Development with the owner's connection string (reads only; requires approval because it is a hosted connection) | hosted connection, no write | G-25 |
| T9 | Canary: with the integration still OFF, push a single comment-only migration with a future timestamp, run the dry run (expect exactly that file), then turn "Deploy to production" ON and observe the push's check run apply it. Keep the GitHub required check on | owner toggle; one ledger row | G-25 |
| T10 | Retire the executor for Development (keep it archived; the sealed package stays in Git as evidence) | none | |
All new migrations from now on: files only, timestamps later than `20261026120400`, pushed to `Dev`; no `apply_migration`, no dashboard SQL for schema changes, no `migration repair`.

## 7. Proving safe automatic deployment before turning it on
1. **Local oracle (done):** the real CLI against local clones reproduces the integration's error, the 332-file danger, and "up to date" only when every file has an honest row. Re-run `cli-oracle.py` after T5-T6 changes to the manifests.
2. **Hosted dry run (T8):** `supabase db push --dry-run --include-all` against Development must print "Remote database is up to date" (or only the canary file).
3. **Isolated integration test (optional, small cost):** restore the newest backup into a temporary project (about USD 10/month, prorated [QUOTE]), connect it to a throwaway GitHub branch with "Deploy to production" ON, push the canary file, observe, delete the project. This is the only way to watch the integration itself without risking Development. A Supabase preview branch (USD 0.01344/hour [QUOTE]) is **not** equivalent: it replays every migration on an empty database.
4. **Production is a separate project** with its own ledger (277 rows), its own GitHub-linked branch record (also `MIGRATIONS_FAILED`) and 110 pending versions: it needs its own oracle run and plan.

## 8. Recovery completion: exact postconditions
All must hold on hosted Development, evidenced by read-only output kept with the audit store:
1. Ledger versions == repository file versions (390 files including the alias file; 390 rows).
2. Every row that was not executed carries an explicit `NOT EXECUTED` marker; every `executed` row carries the file hash; no row claims execution that did not happen.
3. The three withdrawn versions are absent from both the ledger and the directory.
4. `supabase db push --dry-run --include-all` (CLI) prints "Remote database is up to date".
5. The final catalog fingerprint equals the sealed end state; the 20-check S11 gate is true (after S11, only the schema-ACL category differs by the S11 effect).
6. `config.toml` equals the approved Edge Function and JWT decisions.
7. Bolt access is revoked or restricted so that it cannot apply migrations or push to `Dev`.
