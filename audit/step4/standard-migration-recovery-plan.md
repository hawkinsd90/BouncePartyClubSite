# From temporary recovery to standard automatic Supabase migrations (Decision 3)

The custom executor is a **temporary recovery tool**. This plan says how Development gets from its current ledger to a state where `supabase db push` and the Supabase GitHub integration work in the ordinary way, with no recurring repairs. Evidence: the real Supabase CLI (v2.104.0) pointed at disposable local databases (`scripts/dev/hosted-executor/cli-oracle.py`, results in `cli-oracle-results.json`). Nothing hosted was contacted or changed.

> **Step 4A.4 update:** the representation of the 13 unrecordable versions below (sections 4 O3, 5, 6 T4-T6) is a **proposal, not an approved plan**. It is independently reviewed in `thirteen-migration-review.md`, which tests the alternatives with the real CLI (`exclusion-alternatives-oracle.json`): `migration repair --status applied` is rejected because it records the file's own SQL as if executed; moving or renaming files hides them from the CLI but breaks Production's reconciliation; marker rows are honest only with explicit wording and a per-version signature. Nothing is recorded until the owner decides per version (G-21).
>
> **Step 4A.7 finalization:** the compatibility files are to be **recorded without executing** on Development and Production (B's SQL is never run on a hosted database; recording alone leaves the tooling up to date and changes no schema object, tested on both shapes), and the marker SQL is now one plain-PostgreSQL statement with no psql meta-command or transaction control. See `strategy-a-attestation-package.md` sections 2 and 4.5.
>
> **Step 4A.7 correction:** compatibility file B no longer trusts the ledger alone (three independent tests; verified not to remove `orders` from an existing database under a wrong, missing or empty ledger), and the marker block now enforces its order (sealed package and alias rows first), requires a separate approval id for the four deny-list versions and verifies Development-only facts instead of the database name alone. See `strategy-a-attestation-package.md` sections 2 and 4.
>
> **Step 4A.7 update:** Strategy A is approved **in principle**; marker contents and the 13 individual attestations are not approved. The marker SQL proposal, the attestation records and two local compatibility migrations (`20260324175545`, `20260615175815`) are in `strategy-a-attestation-package.md`. The compatibility files are older than both ledger heads: the standard tooling needs `--include-all` (or a ledger row) for them, Development's and Production's pending counts each rise by 2, and they must not reach `main` before Production records them. The sealed package, executor, manifests and deny list are unchanged.
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
| O5 | Bolt (the original builder) can push to GitHub and applies SQL through Supabase's MCP `apply_migration`, which stamps its **own** timestamp as the version and writes no matching file | that is how the alias rows and mixed names in the Development ledger arose; every such call recreates O1 | Going forward new migrations are files only (no `apply_migration`, no dashboard SQL for schema changes). No Bolt freeze is required (owner decision, Step 4B AUTH-1); Git state and the migration fingerprints are verified immediately before each authorized stage | none (G-20 removed) |
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
| T0 | Supabase "Deploy to production" and "Automatic branching" OFF for the Development project; backup per `backup-options-comparison.md`; Git reconciled (`git-remote-reconciliation.md`) | owner toggles | D-03b, D-02, G-22 |
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
7. Immediately before each authorized stage, Git state (`git ls-remote`) and the ledger and schema fingerprints are verified; no restriction of any tool is required.


---

## 9. End state, operating model and retirement of the recovery controls (Step 4A.9)

**Owner decision recorded (2026-10-19): a permanent deny list, a permanent custom executor and recurring historical attestations are rejected.** They are temporary controls for one historical recovery. Nothing here deletes, disables or weakens any of them; retiring a control is not deleting its evidence.

### 9.1 Finding
The existing plan does return Bounce Party Club to ordinary automatic Supabase migrations without a permanent dependency on the deny list or the custom executor. Evidence: the Supabase CLI and the GitHub integration never read `audit/development-execution-deny.json`, the manifests, the sealed package or the executor; the repository has no CI workflow or git hook (`.github` does not exist; `package.json` scripts are `build`, `lint` and `preview`); Netlify runs `vite build`. These controls matter only in two places: the one-time recovery, and the manual security-acceptance runs (`scripts/dev/security-scratch.cjs accept`).
**One real exception, found by probe:** the acceptance suite contains tests that pin the exact migration file set. In a throwaway worktree, adding a single ordinary future migration (`select 1;`) made these fail: `developmentManifest` (1), `productionManifest` (1), `step3bMigrationPlan` (2), `migrationPendingSet` (3) and one assertion in `payments/paymentOperations.test.ts` ("the migration sorts after the previous newest migration"); the rest of the suite passed. They are recovery-era inventory pins, not security checks, and they must be relaxed or archived when recovery ends (R2 below), otherwise every future migration would trip them. They do not affect any deployment.

### 9.2 Temporary versus permanent
| Component | Class | After recovery |
|---|---|---|
| Step 2 deny list (`audit/development-execution-deny.json`) | temporary control | stops being evaluated at R2; file kept as evidence |
| Step 2 manifests, execution manifest, approval package, reconciliation matrix | temporary control, permanent evidence | archived; no longer gate anything |
| Sealed 28-file package and hosted exact-version executor (`scripts/dev/hosted-executor/`) | temporary; evidence | unused after R1; marked recovery-only (R4); never needed for ordinary migrations |
| Step 2 local executor and rehearsal evidence | temporary; evidence | archived |
| Marker SQL, the 13 + 46 attestations, alias rows, compatibility rows | one-time | the hosted rows persist forever; the SQL is never rerun |
| S11 containment release and the 20-check gate | one-time | containment released once; the 20 checks may stay as an optional postcondition test |
| Hosted ledger rows (58 existing + bookkeeping + 28 + markers + compat) | permanent | never deleted or edited; the standard tooling depends on them |
| Inventory-pin tests (the five files listed in 9.1) | temporary | relaxed to "historical set immutable, additions allowed", or archived (R2) |
| Security regression tests over migrations (grants, policies, RLS, function access, replay safety, evidence access, payment RPCs) | optional CI | keep; they check new migrations, not history |
| Notification outbound guard, Development containment, Stripe-test and recipient rules | permanent product controls | unrelated to migration history |
| Backups (D-02) | one-time for this recovery, routine decision afterwards | per owner |

### 9.3 What must remain after recovery
Only ordinary rules: never edit a migration file once it has been applied anywhere; no SQL outside migration files on a connected project (no connector or dashboard SQL for schema changes); every new version later than the newest recorded version (`20261026120400` until the real clock passes it); no `migration repair` as routine work; change-specific owner approval for destructive or financially significant migrations (this is not a historical attestation). The ledger rows and the archived evidence stay.

### 9.4 Retirement plan and exit criteria
| Phase | Earliest safe point | Objective exit criteria | Effect |
|---|---|---|---|
| R0 | now | none | nothing is retired; nothing is deleted |
| R1: stop using the executor for Development | after S12 | all 28 package versions recorded as executed; S11 gate (20 checks) true; end-state fingerprint equals the sealed value; the 13 markers (or the owner's changed set), the alias file and row, and the two compatibility rows recorded; ledger versions equal repository versions; `db push --dry-run --include-all` prints "up to date" | the executor is never run again for Development |
| R2: stop evaluating the deny list and inventory pins | after the acceptance test in 9.7 items 6-11 pass (canary applied once by the integration, repeat is a no-op) and one genuine new migration has gone through the normal path | the deny list no longer gates any command; the five pin test files are relaxed or archived; all other acceptance tests still pass with an ordinary new migration added | normal deployment has no deny-list or executor step |
| R3: Production | only after Production's own reconciliation and authorized release | Production's ledger equals the files on `main` (see 9.5) | Production joins the same workflow |
| R4: prevent accidental reuse | with R1 | recovery-only banners in `scripts/dev/hosted-executor/README.md` and the runbook; no routine command refers to the executor; it already refuses to run without a signed authorization bound to the package hash and the base-ledger hash, which no longer match after recovery | accidental rerun is refused |
| R5: archive | with R2 | keep `audit/` evidence and the sealed package in Git (a local tag such as `bpc-recovery-evidence` is proposed, not created); keep the executor and oracles recovery-only | audit and rollback evidence stays available |
**When the archived tools become relevant again:** only if a database's ledger and schema diverge so that the standard tooling cannot proceed (for example a restore to an older backup, or another out-of-band migration tool). Then the lessons and the oracles apply, with new evidence and new approval.

### 9.5 Reconciled end state
**Development**, all true and evidenced read-only before R1: (E1) every file version in `supabase/migrations` has a ledger row that truthfully says executed, history-only or NOT EXECUTED (bypassed); (E2) no row claims execution that did not happen; (E3) the 3 withdrawn versions are in neither the directory nor the ledger; (E4) the 13 historical bypasses are recorded after the owner decides them; (E5) the two compatibility versions are recorded **without executing** (never executed on an existing hosted database); (E6) the alias requirements are closed: a comment-only file for the remote-only version `20260814002658` (**not yet created**: one more repository change, needed before the ledger can match the files) and a history-only row for `20260814120000`; (E7) the 28 sealed-package versions executed in the approved order; (E8) the 20-check S11 gate and the sealed end-state fingerprint hold; (E9) no demo or seed migration executed on the existing database (`20251003170350` is an attestation only); (E10) the dry run lists nothing, and a genuinely new migration runs once. "Up to date" alone proves only E1 and E10; E2 to E9 come from the evidence above.
**Versions outside the 13 that would otherwise still block automatic deployment** (matrix of 393 rows, the 13 removed leaves 380): 59 already recorded (including the alias-covered file), 3 withdrawn (not in the directory), 225 history-only candidates, 46 attestation candidates, 2 bucket-limit SQL, 28 sealed-package SQL and 17 withheld rows. Every one is covered by the approved Step 2 plan and the sealed package (batches S2, S3, S5-S8), so none needs a new design. They are one-time approvals taken at the actual reconciliation stage, not now: batch approvals for the history-only rows, and the Step 2 per-version attestations (presented in groups) for the 46, in the same way as for the 13. None recurs.
**Production** is a separate reconciliation, only when its rollout is authorized: its ledger has 277 rows against fewer files on `main`, 110 pending versions, its own integration (Deploy ON, branching ON), baseline versions `20251001051901`, `20251001052039` and `20251001192425` unrecorded, and the two compatibility versions to be recorded. It needs its own read-only comparison (the CLI oracle against a Production-shaped ledger exists), its own plan and its own approvals; the Development package and executor are not reused. The compatibility files must not reach `main` before Production has recorded them.

### 9.6 Fresh databases
- **Local replay result:** with the two compatibility files, all 390 files replay on the plain-PostgreSQL stub (the pg_net file `20260323201502` skipped).
- **Representativeness:** the stub lacks pg_net, vault and the real Supabase auth/storage/realtime shapes, and the Docker engine is not running here, so this does not prove that a new hosted project initializes; the faithful test is `supabase db reset` on the local stack or a throwaway hosted project or branch, both of which need authorization (an image download, or a cost of about USD 0.01344 per hour for a branch). the calendar-sync migrations (`20260323201502`, `20260323201532`) read the URL and key from database settings or `admin_settings`, not from literals; the e-mail hook migrations that also use pg_net were not reviewed here; hosted behavior is unverified.
- **What a fresh build contains (counts from the replay):** reference data the application needs: `admin_settings` 31, `email_templates` 6, `sms_message_templates` 13, `pricing_rules` 1, `notification_system_status` 2, `product_categories` 5, `product_pricing` 2 (apparent reference data; the owner confirms). Sample or demo content: `units` 8, `unit_media` 8, `google_reviews` 1, `hero_carousel_images` 3, and a catalogue seed (`inventory_products` 2, `product_bundles` 3, `product_bundle_components` 6) for the owner to classify. **A demo identity: one `auth.users` row for the historical demo master account** (created by `20251003170350`, e-mail confirmed, password set, role `master`), plus `user_roles` 2 (`master` and `customer`), `customers`, `contacts` and `customer_profiles` 1 each, and 4 changelog rows (3 settings, 1 permission). No migration after it disables it; the SEC-005 owner procedure covers only the existing Development and Production accounts.
- **Verdict:** acceptable as a local-test artifact; **not acceptable for a real-use environment** until the demo identity and sample content are handled. It is **not** a blocker for Step 4B or for ordinary migrations on the existing databases.
- **Minimum safe separation, without a new executor or directory:** no rewrite of history now. For any new BPC environment before a baseline exists, create it from a dump or restore of the reconciled Development schema plus reference data (the D-02 style `pg_dump -Fc`), or run the migrations and then complete a short written checklist before use: disable and then remove the demo master, remove sample content the owner names, and confirm the reference tables. Acceptance criteria for a new environment: (N1) no `auth.users` row that came from a migration; (N2) no `master` role without an owner-chosen account; (N3) sample units, media, reviews and carousel rows absent or explicitly accepted; (N4) reference tables populated; (N5) the dry run lists nothing; (N6) notification secrets absent until the outbound guard is confirmed. A canonical baseline (one schema file plus later files) is the proper fix and is a **separate modernization project**, scheduled after Production is reconciled; it is not needed to restore normal migrations.

### 9.7 Acceptance test for restoring automatic migrations on the Development integration
| # | Check | Local (disposable PostgreSQL, real CLI) | Needs a controlled, authorized hosted test |
|---|---|---|---|
| 1 | Historical recovery is finished | rehearsed in the scratch template | R1 criteria above, evidenced read-only |
| 2 | No unexpected missing versions | CLI oracle stage F | `supabase migration list` / ledger export equals file versions (392 with the alias file and compat files) |
| 3 | No denied SQL eligible | oracle: the 13 and denied versions not pending once recorded | dry run on Development lists none of them |
| 4 | Schema postconditions | S11 20 checks and fingerprint on the scratch template | same checks, read-only, on Development |
| 5 | Compat versions represented without executing | tested on both shapes (C13) | the two rows exist; dry run does not list them |
| 6 | Dry run lists only new versions | oracle steps G and I | dry run lists exactly the canary |
| 7 | A test migration is applied once by the standard mechanism | real push on scratch (step I) | the integration applies the canary after "Deploy to production" is turned ON (G-25) |
| 8 | Repeat deployment does not rerun it | steps I2 and K | a second push or re-run adds no row |
| 9 | Expected schema change present | scratch catalog read | read-only catalog check of the canary (a catalog-only `COMMENT ON` an existing table is proposed) |
| 10 | A failing migration is visible and skips nothing | step K: a failing file records nothing and the later file does not apply | observe on the first real failure; a deliberate hosted failure is optional and needs its own authorization |
| 11 | The integration works after restoration | cannot be tested locally | GitHub check green and a Supabase deployment log for the canary |
| 12 | Rollback and recovery understood | documented | forward-fix migration; D-02 backup; "Deploy to production" OFF |
Nothing here enables an integration or pushes a branch; items 1-6 can be rehearsed locally, 7-11 need the authorized Step 4B steps.

### 9.8 Permanent operating model after recovery
- **New migration:** Claude adds one new file with a version later than the newest recorded version, additive and idempotent where possible, following the project's security rules (RLS, grants, function access); runs the local checks (the security regression tests and a dry run on a disposable database); describes any destructive or financial effect for change-specific approval. No historical attestation, deny-list check or executor is involved.
- **Development:** a push to `Dev` is applied once, in order, by the Development integration; Netlify publishes the site as it does now.
- **Testing before `main`:** the owner tests the Development site after each coordinated deployment (the Stripe-test, recipient-limited provider checks stay as already decided).
- **Production:** merging to `main` lets Production's integration apply the new versions, but only after Production's history is reconciled and the release is authorized.
- **Ordinary rollback:** write a forward-fix migration with a later version; restore from backup only for data loss; never edit a ledger row by hand.
- **Exceptional recovery:** the archived tools, as in 9.4, with new evidence and approval.

### 9.9 Comparison with the Step 4B plan
- **Already correct:** the executor is declared temporary and retired in T10; S15 restores standard deployment; ordinary future migrations are files only, later-stamped, with no `apply_migration`; markers are bounded to this recovery; Production is separate.
- **Implied permanence to fix in wording:** the deny list is described as a "fail-closed deny list for the Development execution package" but nothing says when it stops gating; the pin tests are described as invariants; the compatibility registry has no retirement note. R1, R2 and R4 above supply the missing exits.
- **Missing exit criteria (added here):** R1 to R5; the new-environment checklist; the point that the pin tests must be relaxed when the alias file (or any ordinary migration) is added.
- **One-time requirements that remain genuine:** the 13 attestations, the 46 grouped attestations, the history-only batch approvals, the alias file and row, and the two compatibility rows, each once per database. The integration restoration (G-25) is sufficient once the acceptance test in 9.7 is its exit.
- **Smallest changes before Step 4B:** (1) accept these retirement criteria; (2) decide who prepares the comment-only alias file `20260814002658` (a repository change that will also need the pin tests relaxed or the registry extended); (3) record the new-environment rule. Nothing else, and no new architecture.


### 9.10 Owner acceptance of R0-R5 and status (Step 4B preparation, 2026-10-19)
The owner accepted the R0-R5 retirement plan **in principle**: the historical deny list and the custom executor are temporary recovery controls and must stop being required for routine migrations after the documented verification gates pass. **No hosted condition below is marked satisfied; each needs actual verification.**
| Phase | Owner decision | Status | Exit condition (exact; evidence still required) |
|---|---|---|---|
| R0 | accepted | in effect: nothing retired, disabled or deleted | n/a |
| R1: stop using the executor for Development | accepted in principle | **NOT satisfied** | (a) all required historical versions reconciled; (b) the sealed package executed and verified; (c) database security postconditions passed (S11 gate, fingerprint); (d) no dangerous historical migration pending; (e) standard CLI migration state reconciled (`db push --dry-run --include-all` says up to date, ledger versions equal file versions) |
| R2: stop evaluating the deny list and the exact-inventory pins | accepted in principle | **NOT satisfied** | (f) one normal new migration applied by the Development Supabase GitHub integration; (g) a repeated deployment does not rerun it; (h) the normal workflow succeeds without invoking the historical executor or consulting a temporary deny list |
| R3: Production | separate | not started | Production reconciled and release authorized |
| R4: prevent reuse | accepted | not started (activates with R1) | recovery-only banners; the executor already refuses without a signed authorization bound to the base-ledger hash |
| R5: archive | accepted | not started (activates with R2) | evidence stays in Git; a local tag is proposed, not created |
Historical evidence stays archived in every case; retiring a control never deletes it.

### 9.11 The inventory pins: the correction made now and the activation point for the rest
Before this correction, five test files failed on any ordinary new migration (9.1). They now use a **horizon rule** recorded in `audit/step4/compat-migrations.json` (`historical_horizon` = `20261026120400`, the last Step 3B version): a file at or before the horizon must be one of the 389 inventory files or a declared, hash-pinned exception (the two compatibility files and the comment-only alias file); a file after the horizon is an ordinary new migration, allowed without editing the inventory when its name is well-formed, its version is unique and later than the horizon, and it is not a manifest, withdrawn or denied version. Preserved: an unreviewed historical-dated file, a modified or deleted historical migration, a modified sealed-package or pinned compatibility file, a badly named or duplicate-version migration all still fail (probes in a disposable worktree). The sealed package and the executor tests are unchanged. **Activation point for retiring the exact-inventory pins entirely: R2.** Until then they stay as recovery protections; weakening them earlier is not proposed.

### 9.12 The alias file and the original contact-inquiries migration
- **File:** `supabase/migrations/20260814002658_ledger_alias_of_20260814120000.sql`, comment-only (no table, trigger, function, policy, grant or data statement); it names the original only by version, and the original migration file is unmodified. The version is unique and sorts before `20260814120000`.
- **Development:** the ledger already has a row for `20260814002658`, so nothing is recorded for the alias file. The migration with version `20260814120000` has no row and is recorded **without executing** (a history-only row; template in `compat-migrations-oracle-results.json` C15), because its effects already exist under the alias version. Tested (C15): running that migration on a Development-shaped replay is itself a no-op (exit 0, schema unchanged), so it is not dangerous; recording it without executing is the truthful, least-action representation (it claims no execution), and executing it would be an acceptable alternative only if the owner prefers. Neither version can run SQL by accident: the alias runs nothing, and the original is recorded.
- **Production:** the ledger has no row for the alias version; the file is a harmless no-op there, to be recorded or applied in Production's own reconciliation before the file reaches `main`. Production's migration `20260814120000` is genuinely pending (never applied there) and runs for real in Production's own release.
- **No hosted record was created.**

### 9.13 New-environment prohibition
A newly initialized BPC database must not be exposed to real customers until its demo master account, migration-generated sample content, security controls and outbound notification settings pass the acceptance criteria N1 to N6 in 9.6. This is separate from the Development recovery and does not block Step 4B. No historical migration file is modified; the historical demo credential is neither used nor repeated.
