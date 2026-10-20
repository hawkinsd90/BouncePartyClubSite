# Step 4A readiness report

Date: 2026-10-18. Scope: planning and read-only verification only. No push, merge, deployment, hosted write or provider call occurred. Provenance tags: **[LIVE]** read-only observation today, **[CAP]** earlier capture, **[REPO]** committed files, **[ASSUMED]** unverified.

## 1. Verdict
**PARTIAL: ready for owner review, not ready to authorize Step 4B.** Three real gaps (D-01 hosted migration mechanism, D-02 restore point, D-03 Netlify behavior) and fifteen owner gates are open (`owner-decisions-and-gates.md`). The local state is sound: everything that can be verified locally passes.

## 2. Verified starting state
| Item | Result |
|---|---|
| Branch / HEAD / tree | `Dev`, `ecdda40cb2e858bb21469ce7fbc55fbfc5a05d6a`, clean at start [REPO] |
| `origin/Dev` | `b2cd801e748df098064f484365d9b29dbfed1ef4` (matches `git ls-remote`, a read of GitHub); local is **103 ahead, 0 behind** |
| `origin/main` | `b79ca48`; `origin/Dev` is 200 ahead and 0 behind `main`; local `Dev` is 303 ahead of `main` |
| What a push of `Dev` sends | 103 commits: ~795 files, +108k/-15k lines; 83 migration-path changes (46 added, 7 deleted, 30 renamed), 44 Edge Function directories touched, 492 `src`/config paths, `package.json` (one script). **Not just Steps 2 and 3**: it includes earlier feature and refactor work since 2026-09-29 |
| Unrelated or unfinished work in the push | none identified as unfinished; the earlier feature commits were not reviewed line by line in 4A (limit) |
| Hosted Development ledger [LIVE] | 58 rows, max `20260929161925`, exactly equal to `audit/evidence/derived/dev-ledger-versions.txt` (no drift) |
| Hosted Development schema [LIVE] | PostgreSQL 17.6, role `postgres`; `anon` and `authenticated` lack USAGE on `public`; `service_role` has USAGE and CREATE; 67 public tables, 0 without RLS; 222 public policies; 6 storage policies; 75 anon-executable functions; 63 tables with an anon privilege; 2 sequences with anon privilege; `orders` still has "Service role full access to orders" (ALL, public); no `public` default ACL rows; 11 tables lack `service_role` SELECT; no `pg_net`; no signup trigger on `auth.users`; realtime publishes only `orders`; demo master account exists |
| Buckets [LIVE] | carousel-media, event-essentials-media, order-pictures, unit-images public; lot-pictures, physical-waivers, public-assets, signatures, signed-waivers private; `public-assets`, `carousel-media`, `unit-images` have no size limit |
| Login roles [LIVE] | authenticator, cli_login_postgres, pgbouncer, postgres, supabase_admin, supabase_auth_admin, supabase_etl_admin, supabase_read_only_user, supabase_replication_admin, supabase_storage_admin (SEC-038 review) |
| Edge Functions [LIVE] | 42 deployed. 14 untouched June-2026 stubs (created = updated). ~14 redeployed 2026-10-16 (origin unverified; plausibly the earlier refresh work, **not verified**). 11 repository functions are not deployed at all. 1 hosted-only function (`send-booking-confirmation`). 25 functions have a hosted `verify_jwt` that differs from `config.toml` (listed in the matrix) |
| `record-consent` on Development [LIVE] | hosted source is empty (v3); restored source cannot overwrite a newer version here. Production's source was reported empty in Step 2 and was **not** re-read in 4A |
| Production | not contacted in 4A; no Production data, rows or secrets read |
| Not observable from here | Netlify settings and deployed commit, project secrets (names), backup/PITR availability, Twilio/Stripe console settings |

Drift against previous captures: ledger none; schema booleans/counters match the Step 2 capture; Edge Function state has **no earlier capture to compare** other than the "14 stubs" statement (consistent).

## 3. Step 2 recovery verification
- **Reproducibility:** in a clean clone of `ecdda40`, `build_development_plan.py`, `build_execution_manifest.py`, `build_production_plan.py candidates` and `manifest` ran without scratch evidence; the four generated manifest/rule files differ from committed ones only by line endings (`git diff --ignore-cr-at-eol` empty); execution manifest and batches unchanged. All inputs are in `audit/evidence/derived/` (committed). The required external protected captures (`BPC_EVIDENCE_ROOT`) are needed only by the rehearsal scripts, not generation. Limits: only Windows was exercised; hosted PostgreSQL 17 behavior of the rules is not proven by local PG 18.
- **Classifications preserved** (Development manifest, 393 rows, unchanged by the Step 3B append except +5 rows): 59 already recorded, 225 evidence-backed history-only, 58 qualified attestation candidates, 40 withheld for the October gate, 5 Step 3B SQL, 3 withdrawn, 2 actual SQL (bucket limits), 1 excluded (`update_pricing_rules`). Batches: 145 plain + 55 security-touching history-only, 44 attestation (rule defined), 9 attestation WEAK (not approvable), 3 BLOCKED (`20251001052039`, `20260125173238`, `20260305222010`), 2 SQL, 1 canary; all 259 operations `not approved`.
- **Deny list intact:** blocked 3, excluded pricing, withdrawn Cases 41/42/43, demo admin never executed, withheld October. Verified against the checkpoint `0658fdd` in Step 3 and by the passing `developmentExecutionManifest` suite.
- **Local suites:** full strict acceptance on the committed HEAD: 120 files, 134 runs, 131 passed, 3 baselines matched, 0 failed/skipped/missing, 143,213 assertions (run at the Step 3 close on `ecdda40`; no code changed since).

## 4. Step 3 security readiness
Register (committed): 20 fixed locally and verified, 17 corrected earlier and verified, 6 need hosted Development verification (SEC-015, 017, 021, 031, 040, 044), 4 need an operational action (SEC-005, 020, 038, 048), 2 need an owner decision (SEC-004, 035), 1 not a vulnerability (SEC-046). All "fixed" items are **committed locally and undeployed**.
Observed today that bears on them: SEC-005 the demo account exists on Development; SEC-015 Development has no `public` default ACLs (expected no-op); SEC-016 11 tables lack `service_role` SELECT (gap present until `…0100`); SEC-001/002/003 the open `orders` policy and 63 anon-privileged tables are still present but unreachable because of containment; SEC-014 two sequences still carry anon privilege; SEC-031 `send-booking-confirmation` is hosted-only; SEC-049 hosted Development source empty.
Conditions that must hold before containment is removed (S11): all of S4-S8 complete, `securityPosture` and the Step 3B rules true on Development, synthetic anon probe refused, owner approval.

## 5. Dependency findings that change the plan
1. Containment makes the October transient-widening windows unreachable on Development; keep it until S11 (no extra containment needed beyond the existing state; recovery containment for the three portal functions stays prepared).
2. The frontend to be pushed requires 11 functions that do not exist on Development: push late (S9).
3. 25 `verify_jwt` mismatches. Five functions marked "no deployment needed" (`auth-email-hook`, `get-stripe-publishable-key`, `save-pending-consent`, `save-signup-address`, `submit-contact-inquiry`) still differ from `config.toml`; either redeploy them to align or accept the difference explicitly (owner/4B).
4. Redeploying with `config.toml` flips JWT on real payment functions (e.g. `charge-deposit`, `stripe-checkout`, `send-invoice`: hosted false, config true). The committed frontend must send a user token to these; verify in S13 before Production.
5. D-01 (mechanism for 28 files) is the largest open design item.

## 6. Risks ranked
1. **Security:** live notification credentials plus real customer data on Development (SEC-040); mitigation S1 first. Demo master account exists (SEC-005).
2. **Database/migration:** no approved hosted executor for October/Step 3B (D-01); no restore point recorded (D-02); committed SQL not reversible by ledger edit.
3. **Financial:** JWT flips on payment functions; October financial migrations need `stripe-refund`/`staff-order-save`/`complete-booking` first (S4 ordering). Mitigation: Stripe TEST only, S13 FIN tests.
4. **Authentication:** signup trigger and role repair in `20261016120000`; snapshot before it.
5. **Customer privacy:** legacy public evidence photos (SEC-020); public buckets `order-pictures`, `carousel-media`, `unit-images` [LIVE] (decide at S3/S14).
6. **External integrations:** Twilio console URLs; Netlify env vars; Google redirect URIs.
7. **Operational:** unknown Netlify auto-publish; push of 103 mixed commits; hosted functions of unknown provenance (diff before overwrite).

## 7. Deliverables in this package
`step4a-readiness-report.md` (this), `development-deployment-runbook.md`, `migration-reconciliation-matrix.csv` (393 rows), `edge-function-deployment-matrix.csv` (53 rows), `development-integration-test-matrix.csv` (119 tests), `owner-decisions-and-gates.md`, `rollback-and-recovery-plan.md`, `step4a-evidence-index.md`. Not committed (awaiting approval).


---

## 8. Step 4A.1 addendum (2026-10-18): the three blockers re-examined

**Revised verdict: PARTIAL, closer.** D-01 is resolved locally; D-02 is still blocked on facts only the owner can read; D-03 is better understood and exposed a new control to switch off. Development deployment still cannot be authorized.

### 8.1 D-01: exact-version executor (resolved locally)
`scripts/dev/hosted-executor/` (README there). One transaction per version; the guards (database/role, version not recorded, predecessors, package prefix, approved base export, containment, catalog fingerprint before and after, RLS, the version's own rule, ledger count) are `RAISE`s inside the same transaction as the migration SQL and the ledger `INSERT`, so a ledger row exists only for SQL that ran and whose postconditions held. Ledger rows carry the file's version, the CLI-style name, a `-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; ...` marker and the exact SQL. Package: 28 files (23 October gate, 5 Step 3B) bound to `ecdda40`, sealed with a 28-link fingerprint chain. Local evidence: full run on a Development-shaped clone passes; the final catalog equals the Step 3 accepted `bpc_replay_devshape` in every category except the schema ACL (the S11 effect); every step probed `anon`/`authenticated` as denied; rerun is idempotent; crash after commit, killed client, SQL timeout, wrong post-state, foreign/missing/edited ledger rows, tampered or re-hashed package, denied versions, missing approval, schema drift and lost containment are all refused or rolled back; a guard-by-guard mutation matrix shows which layers are redundant and which are sole catchers (the base-export check needs the count check as a second layer; the count check is the sole catcher of a trigger that writes an extra ledger row). Full list: `audit/step4/executor-rehearsal-results.json`.
**Hosted-only unknowns that remain:** the executor's hosted transport has never connected; the three storage-policy files (`20261014120000`, `20261015120000`, `20261015123000`) fail locally for a hosted-like operator that does not own `storage.objects` (probable success on hosted, see the canary S4b); PostgreSQL 17 vs 18 behaviour beyond the catalog fingerprint; statement time on real data volume.

### 8.2 D-02: restore point (blocked)
Observed: Pro plan; PostgreSQL 17.6. Not observable: backup list, PITR, a tested restore. `d02-restore-point-procedure.md` gives the owner steps (dashboard check, logical dump with checksums, local restore proof, ledger-consistency record, Development-only data list) and the stop conditions. The 28 files do not delete or rewrite any Storage object.

### 8.3 D-03: Netlify and push behavior (partially resolved, new risk)
Observed: `dev.bouncepartyclub.com` is on Netlify; the deployed bundle targets the Development project, not Production, and contains none of the 11 new functions. **New:** the Supabase project has a GitHub-linked branch "Dev" with status `MIGRATIONS_FAILED`, so a push may make Supabase run migrations and deploy functions. Owner questions 1-9, the control table and rollback (publish the previous Netlify deploy) are in `d03-netlify-and-integration-control.md`. The push stays at S9 behind these controls.

### 8.4 The 58-versus-59 count (not drift)
The live ledger has **58** versions and equals the Step 2 capture exactly (set comparison, 0 differences). The Development manifest has **59** rows classified "Already recorded": 58 are ledger versions recorded under their own version (including the ledger-only alias row `20260814002658`), and the 59th is the **file** `20260814120000_create_contact_inquiries.sql`, whose migration is recorded under the alias version `20260814002658`. One ledger entry, two manifest rows. No classification was changed; the committed manifest already says so ("not recorded under this version; recorded as 20260814002658 (alias)"). The unit test now pins this relationship and the matrix has a `ledger_note_4a1` column.

### 8.5 JWT differences (25), missing functions (11) and stubs (14)
`edge-function-jwt-compatibility-matrix.csv` lists all 25 with hosted value, repository value, origin of the difference, caller, authentication model, risk, proposed explicit value, disposition, preflight and post-deploy test. **Only 4 differences come from Step 3 changes** (`twilio-status-callback`, `get-session-metadata`, `create-order-short-link`, `submit-contact-inquiry` explicit entry); the other 21 predate Step 3 (hosted Development simply differs from `config.toml`), so deploying with the repository's `config.toml` values would silently apply 21 unrelated flips. Deployments therefore pass `verify_jwt` explicitly per function and the owner releases each flip (D-JWT-1). All raw `fetch` callers in the committed frontend send an `Authorization` header (user token or anon key), which satisfies a `verify_jwt = true` gateway. Webhooks and browser-navigation functions must stay `false` (`twilio-webhook`, `twilio-status-callback`, `checkout-bridge`, `stripe-webhook`) and the crash reporter stays `false`. The 11 missing functions are all in stage S4 and called only by the committed frontend; the 14 stubs are untouched June-2026 functions: 8 have repository code that differs from origin/Dev and are scheduled in S6 (`checkout-bridge`, `record-consent`, `send-error-notification`, `sync-google-calendar`, `twilio-status-callback`, `twilio-webhook`, plus `fix-payment-method` and `backfill-payment-methods`, which need the owner's decision on deployment and, for `fix-payment-method`, on its JWT value), and 6 are unchanged vs origin/Dev and stay as stubs (`auth-email-hook`, `save-pending-consent`, `backfill-oauth-customers`, `get-stripe-publishable-key`, `get-user-info`, `save-signup-address`).

### 8.6 Containment through the intermediate states
With containment on (`anon`/`authenticated` without USAGE on `public`), every one of the 28 steps was followed by a successful denied probe of `public.orders` as `anon` and `authenticated`, and the fingerprint after each step records that the schema ACL never changed before S11. The executor refuses to start or continue if containment is off, and the stage-S11 gate (20 read-only checks, each with a negative control) must be all true before the end-state script may be proposed.


---

## 9. Step 4A.2 addendum (2026-10-18): owner gates

**Verdict: owner-gate package ready; deployment still blocked on owner evidence.** 26 gates are in `owner-gates-register.csv` and `owner-approval-checklist.md`.

- **D-02 (blocked):** WAL archiving is running (WAL-G push command, `archive_mode on`) and the plan is Pro, but the backup list, PITR and a tested restore cannot be read. `d02-restore-point-procedure.md` now has exact dashboard steps, what a restore does to the ledger, functions and Storage, and two ways to validate a restore without touching Development.
- **D-03 (verified, controls needed):** the Supabase GitHub integration has reacted to every push of `Dev` since at least 2026-09-28 and has failed each time at the consistency pre-check ("Remote migration versions not found in local migrations directory"). Whether it would apply migrations and deploy `config.toml` functions if the check passed depends on a toggle only the owner can read. Netlify behavior remains unverified; GitHub shows no Netlify statuses. The repository is public.
- **G-16 (open, favorable):** the three files need ownership of `storage.objects` only for `DROP POLICY` and `CREATE POLICY`. The operator is not the owner but is a member of `supabase_privileged_role`, and the six policies on the table were created by recorded migrations through the same channel. A canary that always aborts is written and was rehearsed locally (owner: success signal; non-owner: privilege error; policy digest unchanged both times).
- **D-JWT-1:** each of the 25 rows now has caller class, necessity, recommended explicit flag, remaining owner decision, integration tests and notes. Result: 3 must be `false` (two Twilio callbacks and checkout-bridge), 17 are recommended `true` (3 are Step 3 changes, the rest need the owner's release), 5 are not deployed. Every committed frontend caller sends a Supabase JWT, so `true` is compatible; expired sessions need a test.
- **SEC-005:** the demo password is readable in a **public** repository. Development has the account (master, 92 days since sign-in) and 2 other masters. Owner procedure: `sec005-demo-account-owner-procedure.md`.
- **Package integrity:** the 28 files equal the sealed package and a fresh build. The package binds to file content at commit `ecdda40`, not to HEAD, so planning commits do not invalidate it. Freeze rules: `package-freeze-and-commit-sequence.md`.


---

## 10. Step 4A.3 addendum (2026-10-19): owner decisions, standard-migration recovery, backups

- **Owner decisions 1-5 incorporated** as strategy (not execution): demo account, backups (no method yet), temporary executor then standard migrations, Stripe-test/approved-recipient testing, Netlify CD kept ON (not a blocker).
- **Expected pre-deployment state (not a defect):** the Development `send-sms-notification` (v6, 2026-07-01) and `send-email` (v7) are the older versions because the corrected, guarded code is committed locally and not yet deployed. They deploy inside the coordinated rollout (S1, before any operation that could send a message); no isolated hotfix, no testing before S12. Stripe keys in `admin_settings` are test-class. See `provider-safety-checklist.md`.
- **Standard migrations (decision 3):** the real Supabase CLI, run against local scratch databases, reproduces the integration's failure (one remote-only version, `20260814002658`) and shows that fixing only that would make a standard push **execute 332 files including 13 that must never run**. Ordinary deployment can resume only after every file has an honest ledger row (including `NOT EXECUTED` attestation rows for those 13, needing a new owner decision, G-21). `standard-migration-recovery-plan.md`, `cli-oracle-results.json`.
- **Git:** local `Dev` is `0ea1ffe` (the owner's committed social-preview change, out of scope), 104 ahead and 1 behind `origin/Dev` (`aeb708e`); a clean merge exists; nothing in the package is stale. `git-remote-reconciliation.md`.
- **Bolt** (background only): it can push to `Dev` and apply SQL through Supabase's MCP, but the owner removed any Bolt freeze requirement (Step 4B AUTH-1); Git state and fingerprints are verified before each authorized stage. `bolt-access-control.md` is a background note.
- **Gates:** 31 in `owner-gates-register.csv` with decision timing and class.
- **Backups:** `backup-options-comparison.md` (recommendation: managed-backup check + verified manual dump, no PITR; D-02 stays BLOCKED).


---

## 11. Step 4A.8 status record (2026-10-19)
Recorded decisions and states; **no hosted execution gate is marked passed**.
| Item | Status |
|---|---|
| Strategy A (markers with individual attestations) | approved **in principle** only |
| The 13 exact attestations | **pending individual owner review** (`owner-attestation-review.md`); none approved, signed or recorded; four need a separate deny-list exception id |
| Marker SQL (`strategy-a-marker-proposal.sql`) | execution **not authorized**; future invocation `psql -X -v ON_ERROR_STOP=1 -1 -f <approved-filled-file>`; no filled file exists |
| Compatibility migrations A (`20260324175545`) and B (`20260615175815`) | **approved for inclusion in the repository**; on existing Development and Production databases both versions are to be **recorded without executing their SQL**, never executed there; the hosted records are not yet authorized; `supabase db push --include-all` is prohibited against hosted Development and Production for them |
| Record-only prerequisite | required before automatic Supabase deployments resume (both files are older than both ledger heads) |
| Local commits | approved (this task); pushes, merges, rebases, resets, deployments and hosted mutations remain prohibited |
| Netlify continuous deployment | stays ON |
| Isolated Development SMS or feature hotfixes | none; functional testing starts after the full coordinated Development deployment |
| Backups | combined approach approved (D-02 strategy approved); backup execution and restore proof **pending** |
| Supabase automatic Development migration deployment | must stay **controlled** during historical recovery (Deploy to production OFF for Development before the first push) |
| Production | requires separate approval and is not changed |


---

## 12. Step 4A.9 decision record (2026-10-19)
| Item | Status |
|---|---|
| Permanent deny list, permanent custom executor, recurring historical attestations | **rejected by the owner**; they are temporary recovery controls (`standard-migration-recovery-plan.md` section 9) |
| Retirement of the executor and the deny list | planned in phases R1 to R5 with objective exit criteria; **nothing is retired, disabled or deleted yet** |
| The 13 attestations | paused by the owner pending assurance of a normal end state; one-time approvals taken at the actual reconciliation stage, together with the 46 grouped attestations and the history-only batches |
| Fresh databases | acceptable as a local-test artifact; a new real-use environment needs the new-environment checklist (a fresh build contains a demo master account and sample content); a canonical baseline is a separate modernization project, not a blocker |
| Ordinary new migration vs the acceptance suite | five test files pin the exact migration set and fail on any new migration; they are relaxed or archived at R2, not now |
| Hosted execution gates | none marked passed |


---

## 13. Step 4B preparation record (2026-10-19)
| Item | Status |
|---|---|
| R0-R5 retirement plan | accepted by the owner **in principle**; R1 and R2 exit conditions are **not satisfied** and are listed in `standard-migration-recovery-plan.md` section 9.10; nothing is retired, disabled or deleted |
| Comment-only alias file `20260814002658_ledger_alias_of_20260814120000.sql` | prepared by Claude (owner decision); no hosted record created; Development already has the row for that version; the original `20260814120000` is to be recorded without executing; Production handles both in its own reconciliation |
| Exact-inventory pin tests | corrected locally with a horizon rule so an ordinary later-versioned migration needs no inventory edit; unreviewed, modified, deleted, duplicate-version or badly named migrations still fail; further retirement of the pins activates at R2 |
| First operational authorization package | `step4b-first-authorization-package.md`; only AUTH-1 (a read-only verification session) is requested; nothing authorized |
| Fresh databases | a newly initialized BPC database must not be exposed to real customers until the demo master, sample content, security controls and outbound notification settings pass N1-N6 |
| Historical approvals | one-time, taken at their stages (13 paused; 46 grouped; history-only batches; alias row; compatibility rows) |
| Hosted execution gates | none marked passed |
