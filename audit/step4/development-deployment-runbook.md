# Step 4 Development deployment runbook (PLAN ONLY: nothing here has been run)

Status: written in Step 4A on 2026-10-18 and revised in Step 4A.1 (same day) from the committed `Dev` HEAD `ecdda40cb2e858bb21469ce7fbc55fbfc5a05d6a`. It authorizes nothing. Step 4B starts only after the owner approves this runbook, resolves the blockers in `owner-decisions-and-gates.md`, and names the stage range to run. Every stage below ends with a **stop** and the next stage needs its own go-ahead from the owner unless the owner approves a range in writing.

Target: hosted Development `srxunxiytojjsuhcmzjg` only. Production `qaagfafagdpgzcijnfbw` is never touched. A Production release is a later, separate plan.

Provenance tags: **[LIVE]** observed read-only on 2026-10-18; **[CAP]** earlier read-only capture; **[REPO]** committed files; **[ASSUMED]** not verified.

## Step 4A.3 revision (2026-10-19): owner decisions incorporated
Status line: still PLAN ONLY. Owner strategy decisions 1-5 are recorded below; **none authorizes execution**.

| Decision | What changed in this runbook |
|---|---|
| 1 Demo master account | strategy approved: verify another master works, then disable the demo account if unused, Development and Production separately, no replacement master, no sign-in with the historical password. Execution still needs a separate authorization (G-03, G-03P; `sec005-demo-account-owner-procedure.md`) |
| 2 Development backups | **method chosen (Step 4A.5): verify a recent managed backup, encrypted `pg_dump -Fc` immediately before the first authorized hosted database migration, local restore proof, keep until deployment and integration testing finish, no PITR, Storage bytes accounted separately.** D-02 = STRATEGY APPROVED - EXECUTION AND RESTORE VERIFICATION PENDING; commands, storage rules and pass criteria are in `d02-restore-point-procedure.md`; the dump is not authorized yet |
| 3 Long-term migrations | the executor is temporary. New stage **S15** restores standard deployment (`standard-migration-recovery-plan.md`); Supabase automation stays controlled until S15 proves it |
| 4 Integration testing | Stripe test mode, approved recipients, controlled SMS/e-mail, synthetic data approved as a strategy. `provider-safety-checklist.md` is the configuration and validation checklist (its section 0 records the expected pre-deployment state of the relays). No test is run before S13 |
| 5 Netlify | continuous deployment stays ON. It is **not a blocker**. The frontend may be incompatible with the backend between the push and S12; that is accepted. A rollback path is recorded; Production (`bouncepartyclub`, branch `main`) is untouched |

**Updated owner decisions (2026-10-19, supersede earlier text):** the owner is the only tester; temporary Development downtime and broken functionality during the coordinated deployment are acceptable; **no individual Development feature is fixed or tested before the coordinated deployment completes**; no isolated SMS or frontend hotfix; all corrected Edge Functions deploy inside this rollout in their planned positions; functional, integration and provider testing begins only after the approved deployment (S12). The social-preview change (`index.html`, `public/og-image.jpg`) is already committed (`0ea1ffe`) and is not part of this plan. Supabase integrations: Development `Dev`, Deploy to production ON, Automatic branching OFF; Production `main`, Deploy to production ON, Automatic branching ON; no integration setting is changed by planning.

### Phase map (stage numbers are unchanged; phases group them)
| Phase | Content | Stages / gates |
|---|---|---|
| P-A Owner security actions | demo account (Dev; strategy approved, separate authorization), Bolt freeze | G-03, G-20 |
| P-B Git, approvals, backup | reconcile `origin/Dev` (merge), commit planning files, choose and validate the backup | G-22, G-18, D-02, S0 |
| P-C Supabase automation control | turn **Deploy to production** and **Automatic branching** OFF for the Development project before any push; keep OFF until S15 | D-03b |
| P-D Provider safety and notification containment | provider checklist C1-C10, V1-V3; guarded relays | G-01, G-02, G-05, G-06, S1 |
| P-E Step 2 reconciliation | history-only and signed attestations, bucket SQL | G-07, G-08, S2, S3 |
| P-F Guarded Edge Functions | deploy-first set with explicit JWT flags; storage canary | D-JWT-1, S4, G-16, S4b |
| P-G October and Step 3B | sealed executor | G-17, S5, S6, S7, S8 |
| P-H Security verification and containment removal | 20-check gate, then the single containment script | S10, S11, S12 |
| P-I Netlify publication | push (CD ON); incompatibility window until S12; rollback = publish the previous deploy | G-15, S9 |
| P-J Integration testing | provider checklist V4-V8, test matrix | S13 |
| P-K Restore standard migrations | close the 13 unrecordable files, alias file, config alignment, dry run, canary push, re-enable | G-21, G-24, G-25, S15 |
Netlify timing: the push can happen any time after P-C is verified; the recommended point is after S8 so the window of an incompatible frontend is shortest. **Testing resumes** when S11 is applied, S12 passes, the Netlify deploy for the final HEAD is "ready" and published (record its deploy ID), and provider checklist V1-V3 pass. **Rollback of the frontend:** Netlify > Deploys > the recorded previous deploy > Publish deploy (the deploy live on 2026-10-19 is `6ad6164006e80bd67c7754ed`, commit `aeb708e`; record the then-current one just before the push). No Git rewrite.

## 0. Facts that shape the order

1. **Development is contained.** [LIVE] `anon` and `authenticated` have no USAGE on schema `public`; `service_role` has USAGE and CREATE. While this holds, the transient privilege widening of the historical October chain (13 steps, 3 genuinely callable portal short-link functions; `audit/evidence/e2h-security-recovery-plan.md`) is **unreachable through the public API**. The plan keeps containment ON until stage S11. Do not remove it earlier "to test".
2. **The deployed Development frontend (origin/Dev `b2cd801`) calls none of the 11 new functions**; the committed frontend calls all 11 (`check-availability`, `complete-booking`, `create-booking`, `customer-portal-action`, `customer-portal-data`, `portal-link`, `record-site-event`, `request-portal-link`, `resolve-link`, `staff-order-save`, `task-evidence`). [REPO, git grep] None of these exists on hosted Development. [LIVE]
3. **Git, Netlify, Supabase and providers are not atomic, and a push can reach two automated systems.** `git push origin Dev` is 103 commits (not 303; origin/Dev is `b2cd801`, 0 behind). `dev.bouncepartyclub.com` is a Netlify site [LIVE] but its branch and auto-publish settings are not readable here. **New in 4A.1:** the Supabase project has a branch record "Dev" linked to Git branch `Dev` with status `MIGRATIONS_FAILED` [LIVE], so the Supabase GitHub integration is probably connected and a push could make Supabase run `supabase/migrations` and deploy `supabase/functions` by itself. The push therefore happens late (S9) and only after the owner has answered the nine inspection questions in `d03-netlify-and-integration-control.md` and switched off Supabase auto-deploy and Netlify auto-publishing.
4. **The hosted ledger matches the Step 2 capture exactly.** [LIVE] 58 rows, max `20260929161925`, identical to `audit/evidence/derived/dev-ledger-versions.txt`. Do not use `supabase db push` or `migration repair`; the ledger is drifted by design.
5. **D-01 is resolved locally (4A.1).** `scripts/dev/hosted-executor/dev-migration-executor.cjs` applies the 28 files (23 October, 5 Step 3B) at their own versions, one transaction each, with in-database pre/post assertions, a sealed catalog fingerprint chain, a CLI-style ledger name and `statements = [marker, exact SQL]`. It was rehearsed on a Development-shaped local clone (all 28 files, restart, negative controls, mutation matrix, hosted-like privileges). It has **not** been run against any hosted project; hosted use needs the signed authorization described in its README. `apply_migration` (own timestamp), `db push`, `migration repair` and `--include-all` remain forbidden.
6. **Hosted-like privileges (4A.1).** The hosted `postgres` role is not a superuser and not a member of `supabase_admin`, `supabase_storage_admin` or `supabase_auth_admin` [LIVE]; it does hold DML and TRIGGER on `auth.users` and the storage tables by grant, and it can `SET ROLE` to `anon`, `authenticated` and `service_role`. Under that profile 25 of the 28 files ran locally; the 3 storage-policy files (`20261014120000`, `20261015120000`, `20261015123000`) stop on "must be owner of relation objects". The same statement types ran on this project in recorded migration `20260723174017`, and `supautils` is loaded, so they will probably be allowed, but a **rolled-back canary (S4b) is required before S5**.
7. **Hosted function sources are partly unknown.** [LIVE] 14 hosted functions are untouched June-2026 stubs; ~14 were redeployed on 2026-10-16 (origin unverified); one function (`send-booking-confirmation`) is hosted-only. Before deploying any function, read its hosted source and compare (read-only `get_edge_function`).

## Stage format
Each stage: **Pre** (predecessors/gates), **Action** (exact proposed operation), **Expect**, **Verify** (read-only), **Stop** (conditions), **Recover** (pointer to `rollback-and-recovery-plan.md`), **Owner** (approval needed).

---

## P0. Read-only preflight (no mutation; repeat at the start of 4B)
- **Pre:** owner starts 4B.
- **Action:** (a) `git rev-parse HEAD` equals the approved commit; clean tree; `git ls-remote origin Dev` equals `b2cd801` (nothing moved). (b) Hosted Development, read-only: ledger export `(version, name, md5(statements::text))` with SHA-256 (Q01); `SELECT` snapshot of containment booleans, default ACLs, anon-executable function count, policies, buckets, extensions, realtime tables, signup trigger (the query used in Step 4A is in the evidence index). (c) `list_edge_functions` and `get_edge_function` for every function in the deployment matrix with stage S1/S4/S6; diff against the origin/Dev copy; record `ezbr_sha256`. (d) Confirm by name (dashboard) which secrets exist: Stripe TEST keys, Resend, Twilio, `SITE_URL`, `RETURN_ORIGINS`. Never print values. (e) Local acceptance on the committed HEAD: `node scripts/dev/security-scratch.cjs accept` (PASS at Step 3: 120 files, 134 runs; the new `devMigrationExecutor` suite adds one file). (f) Run the read-only fingerprint statement (`scripts/dev/hosted-executor/lib/fingerprint.cjs`, `READ_ONLY_STATEMENT`) on Development and compare each category with `start_state.fingerprint` of the sealed package **after S3** (before S3 only the `bkt` category differs); any other difference is drift and stops the rollout. (g) Check the Supabase GitHub integration and Netlify settings (`d03-netlify-and-integration-control.md`, questions 1-9) and record the answers. (h) `git ls-remote --heads origin` equals the recorded `Dev`, `main` values (2026-10-19: `aeb708e`, `b79ca48`); any difference stops the stage (Bolt or another actor may push; see `bolt-access-control.md`). (i) `list_migrations` count equals the recorded count (58 before S2).
- **Expect:** ledger 58 rows / max `20260929161925` / same SHA as capture; containment booleans unchanged; local acceptance PASS.
- **Stop:** any difference from the capture, any function that is neither a known stub nor matches the origin/Dev copy (record it, do not overwrite), wrong project id/role, `transaction_read_only` unexpectedly on/off for the step.
- **Owner:** none beyond starting 4B.

## S0. Approvals, restore point, mechanism
- **Pre:** the S0 gates of `owner-approval-checklist.md` (D-02 with the chosen method, D-03a, G-14, G-18, G-20, G-22) are PASS; the commit sequence of `package-freeze-and-commit-sequence.md` is done and the final HEAD, package hash and evidence hashes are recorded in the approval.
- **Action:** owner records (1) a Development restore point (provider backup/PITR; `Q: is it available on this plan` is unknown [ASSUMED]) with its timestamp, (2) the rollout window and who is on call, (3) that no real customer is expected to use Development, (4) approved test recipients (e-mail, phone), (5) approval of the executor design after reading `scripts/dev/hosted-executor/README.md` and `audit/step4/executor-rehearsal-results.json`, and signing the hosted authorization document (project ref, package hash, version range, released October versions, base-ledger export identity, restore point, window of at most 48 h). The restore point comes from `d02-restore-point-procedure.md`.
- **Expect:** a signed approval record outside Git (hashes of runbook, manifests, scripts).
- **Verify:** restore point visible in the dashboard (owner screenshot or text, no secrets).
- **Stop:** no restore point; no mechanism approved; recipients not named.
- **Recover:** n/a (nothing changed).
- **Owner:** required.

## S1. Notification relay containment (SEC-030, SEC-040)
- **Placement (owner decision, 2026-10-19):** this is part of the single coordinated rollout, not a separate hotfix. The corrected relays stay in this position (before any operation that could send a real message, and before provider tests). The currently deployed old versions are expected until then.
- **Pre:** P0, S0. Owner confirmed that Development's Resend/Twilio credentials are sandbox/test, or are unset, or that recipients are restricted. If they are live, S1 is **mandatory before anything else** and the owner decides whether to unset them for the rollout.
- **Action:** deploy `send-email` (hosted v7) and `send-sms-notification` (hosted v6) from the committed source, `verify_jwt` as listed in the JWT matrix (both `true` once the owner releases D-JWT-1; in-function relay authorization applies either way). Read both hosted sources first.
- **Expect:** unauthenticated and customer-token calls refused; no message sent by any test.
- **Verify:** `list_edge_functions` shows new versions; negative calls with the anon key return 401/403 (no provider reached; check function logs).
- **Stop:** hosted source differs unexpectedly from origin/Dev copy; any message sent.
- **Recover:** redeploy previous version (bundle saved from P0); accidental send -> section "Accidental real notification" of the rollback plan.
- **Owner:** required (first hosted mutation).

## S2. Bookkeeping part 1 (Step 2)
- **Pre:** S0; mechanism for ledger writes approved (history-only/attestation scripts exist: `build_execution_package.py`).
- **Action:** batch order from `development-execution-batches.json`: canary, plain history-only by dependency wave, security-touching history-only (**before** Step 3 changes the checked objects), attestation groups (only those with signed attestations), never the 3 blocked, never the 9 WEAK-rule attestations as they stand. One batch per call, advisory lock, count assertions.
- **Expect:** ledger count = 58 + operations of approved batches; markers `-- BPC-DEV-RECONCILIATION`.
- **Verify:** Q01 before/after; pre-existing rows' md5 unchanged; rules true.
- **Stop:** any rule false, hash mismatch, count mismatch, unrequested statement.
- **Recover:** batch is atomic; do not resend after a dropped connection (inspect first). Reversal script only with separate owner approval; deleting a ledger row never undoes SQL.
- **Owner:** per batch.

## S3. Storage decision and the two bucket-limit updates (SEC-021)
- **Pre:** S2 (as ordered), owner decision on bucket limits.
- **Action:** the two SQL batches for the `storage.buckets` limit updates (versions in manifest class "SQL (Storage decision)"). Read any trigger on `storage.buckets` first (unverified).
- **Expect:** bucket rows equal the file values; ledger rows `executed`.
- **Verify:** `SELECT id, file_size_limit FROM storage.buckets`; Q01.
- **Stop:** trigger found, limits differ.
- **Recover:** reversal restores the pre-batch values recorded in the script.
- **Owner:** required.

## S4. Deploy-first Edge Functions and retirements (SEC-018/019/022/023/024/031/034)
- **Pre:** P0 diffs reviewed; hosted-log check (no callers in recent weeks) for `get-session-metadata`, `get-payment-method`, `create-order-short-link`; Twilio not involved yet.
- **Action:** deploy the 21 functions marked `S4` in `edge-function-deployment-matrix.csv` (new: the 11 listed above; changed: waiver set, `customer-cancel-order`, `stripe-refund`, retirements to HTTP 410). One function at a time; `verify_jwt` set **explicitly per function from `edge-function-jwt-compatibility-matrix.csv`**, never implicitly from `config.toml` (21 of the 25 hosted/config differences predate Step 3 and the owner must release each flip: D-JWT-1); checked afterwards against the deployed value.
- **Expect:** each function answers its negative smoke test (anon refused where required) without calling a provider.
- **Verify:** `list_edge_functions` (versions, verify_jwt); smoke tests with synthetic input only; Stripe/Twilio/e-mail untouched.
- **Stop:** a function's hosted source was not understood; a verify_jwt value differs from `config.toml`; any provider call.
- **Recover:** redeploy the previous version from the P0 bundle (new functions: delete only with approval, or redeploy a refusing stub).
- **Owner:** required (per group is acceptable).

## S4b. Storage-policy capability canary (always aborted)
- **Pre:** S4 verified; the owner approves gate G-16; restore point recorded; background and rehearsal in `g16-storage-capability.md`.
- **Action:** send `audit/step4/g16-storage-canary.sql` exactly as written, as ONE statement. It creates and drops a probe policy on `storage.objects`, drops one existing policy, and then always raises `BPC-CANARY-OK`. Because the block ends in an error, the database rolls everything back by itself (no `COMMIT`, no `ROLLBACK` to forget).
- **Expect:** `ERROR: BPC-CANARY-OK: ...` is the success signal.
- **Verify (read-only, mandatory):** `pg_policies` for schema `storage` still returns 6 policies with the same digest as before; no `zz_bpc_canary`; the ledger export is unchanged.
- **Stop:** `BPC-CANARY-STOP` (precondition drift) or any other error such as `must be owner of table objects`: the three files `20261014120000`, `20261015120000`, `20261015123000` cannot run through this role. The rollout stops before October step 9; the owner decides (see section 5 of the G-16 document). No privileged workaround is allowed without a new approval.
- **Recover:** nothing persists; if the recheck differs, treat it as an incident (restore point).
- **Owner:** required.

## S5. Snapshot, then the October block (23 files, version order)
- **Pre:** S4b passed; the signed hosted authorization names steps 1-23 and releases the 23 October versions; restore point `rp-S5` taken (and a second one immediately before `20261016120000`, step 12); containment still ON [LIVE check]; owner confirms the `get_admin_users` caller (SEC-011) and `20251207163822` read-only check outcome (SEC-007).
- **Action:** `dev-migration-executor.cjs run --target hosted-development --authorization AUTH.json --package audit/step4/executor/dev-package-oct-s3b.sealed.json --audit-dir DIR --approval-hash <authorization hash> --expect-base-count N --expect-base-sha256 H --stop-after 20261025120000`. The tool executes each file in version order as one transaction with its in-database pre/post assertions (including the catalog fingerprint and containment) and records the ledger row with the file's version; after each commit it re-reads the ledger, re-captures the fingerprint and probes `public.orders` as `anon` and `authenticated`.
- **Expect:** `executed` lists 23 versions; the fingerprint after step 23 equals the sealed `post_fp_all`; ledger rows outside the package are unchanged.
- **Verify:** per-file rule queries; after the last file `securityPosture` queries; anon probe not needed while contained but repeat at S10.
- **Stop:** any file fails (nothing recorded for that file), any rule false, containment booleans changed.
- **Recover:** a failed file leaves nothing recorded; stop and investigate; later files must not run. A committed October file has **no ledger-only reversal**; recovery is a compensating forward migration or restore to the snapshot (Development-only data created since is lost).
- **Owner:** required, plus explicit "go" for the file range.

## S6. Remaining Step 3B Edge Functions
- **Pre:** S5 verified; owner confirmed the Twilio console URLs (or `TWILIO_WEBHOOK_URL`/`TWILIO_STATUS_CALLBACK_URL` set); `SITE_URL`/`RETURN_ORIGINS` set; hosted source of `record-consent` is empty [LIVE] so overwrite risk is nil on Development.
- **Action:** deploy the 21 `S6` functions (`twilio-webhook`, `twilio-status-callback` with the `verify_jwt` flip, `sync-google-calendar`, `send-error-notification`, `checkout-bridge`, `record-consent`, and the shared-helper importers). Do not touch `HOLD` functions.
- **Expect:** invalid Twilio signatures give 403 before side effects; calendar refuses the anon key.
- **Verify:** smoke tests; `config.toml` equals deployed `verify_jwt` for every function.
- **Stop:** console URL mismatch; a function in `HOLD` appears in the deploy list.
- **Recover:** as S4.
- **Owner:** required.

## S7. Step 3B corrective migrations (5 files)
- **Pre:** S5, S6; SEC-015 preflight: run the read-only `pre_work_remaining` check from `20261026120400`'s header. [LIVE] Development has **0** `public` default-ACL rows, so the file is expected to be a no-op; if it is not zero, owner decides option A/B before running (D-04).
- **Action:** the same executor with a second authorization (steps 24-28, no withheld versions): `20261026120000`, `…0100`, `…0200`, `…0300`, `…0400` in order, one transaction each; each step carries its `post_effect_present` rule from `audit/security/step3b-verification-rules.json` inside the transaction.
- **Expect:** anon sequence/table privileges removed; `service_role` SELECT on 8 catalog tables (tables without service SELECT: 11 -> 3 expected [LIVE baseline 11]); guard trigger installed; no default ACL entries for anon/authenticated/PUBLIC.
- **Stop:** 42501 from `…0400` (do **not** bypass; no ledger row is written); any postcondition false.
- **Recover:** forward-only; compensating migration or restore.
- **Owner:** required.

## S8. Bookkeeping part 2
- **Pre:** S5, S7; Q22/Q29/Q30 match target.
- **Action:** the 8 storage-policy versions as history-only; remaining deferred history-only rows.
- **Verify/Stop/Recover:** as S2.
- **Owner:** per batch.

## S9. Frontend: push and Netlify (first Git/Netlify action; Netlify CD stays ON)
- **Pre:** S8; Supabase **Deploy to production** and **Automatic branching** are OFF (gate D-03b verified by the owner's text/screenshot and, after the push, by the new commit's "Supabase Preview" check not applying anything and an unchanged ledger count); Bolt frozen (G-20); `origin/Dev` merged locally (G-22) so the push is a fast-forward; the exact push command approved (G-15); the currently published Netlify deploy ID recorded. Netlify auto publishing is **not** stopped and is **not** a blocker (owner decision 5): the push publishes `dev.bouncepartyclub.com` automatically.
- **Action:** `git push origin Dev` (fast-forward, no force, no merge to `main`, no PR). Nothing is pushed to `main`; the production Netlify site (`bouncepartyclub`) builds only `main` and is unaffected.
- **Expect:** Netlify builds `Dev` (about 20 seconds for the last build) and publishes it. Between the publish and S12 the frontend may call functions or tables that are not in their final state: errors on the Development site are accepted and are not a reason to stop.
- **Verify:** Netlify deploy ID and commit equal the pushed HEAD; build log has no error; Supabase ledger count unchanged by the push; `vite.config.ts` guard did not fire.
- **Stop:** the build fails (fix on a new commit); the ledger count changed (a Supabase automation acted: stop everything, export the ledger, compare with the executor audit store); a commit appears on `Dev` that is not yours (Bolt).
- **Recover:** Netlify > Deploys > publish the recorded previous deploy; `git revert` (never force-push).
- **Owner:** required.

## S10. Posture verification with containment still ON
- **Action:** run, read-only, `audit/step4/s11-gate-checks.sql` (20 checks, all must be true; each has a negative control in the rehearsal) and the executor's `verify` (final fingerprint equals the sealed one); confirm in the executor's audit store that every step recorded `anon: denied, authenticated: denied`; run the allow-list queries from `audit/security/step3-test-plan.md`; run an anon-surface check with a synthetic anon key.
- **Expect:** SEC-001/002/003/010/014 pass (the Step 3 prerequisite for S11).
- **Stop:** any failure keeps containment ON; return to the failing stage.
- **Owner:** reviews evidence.

## S11. Containment end state (SEC-017) - last schema change
- **Gate:** `owner-gates-register.csv` S11 gates (G-03 for Development) are PASS, in addition to the S10 evidence below.
- **Pre:** S10 PASS; owner approval for this single script.
- **Action:** `audit/security/step4-development-containment-end-state.sql` (`GRANT USAGE ON SCHEMA public TO anon, authenticated; REVOKE CREATE ON SCHEMA public FROM service_role;`).
- **Verify:** re-run S10 queries and a synthetic anon probe immediately; anon reads of `orders` etc. refused.
- **Stop/Recover:** if any probe returns data, immediately run the reversal (`REVOKE USAGE ON SCHEMA public FROM anon, authenticated; GRANT CREATE ON SCHEMA public TO service_role;`) and investigate.
- **Owner:** required.

## S12. Final verification
Ledger export comparison (expected count = 58 + executed/recorded rows), catalog diff against the rehearsed reference, `list_edge_functions` vs matrix, bucket state, secrets by name, local acceptance on the pushed tip.

## S13. Step 4C integration testing
Run `development-integration-test-matrix.csv` (119 tests). Automated and DB-level first, then manual flows. Real provider calls only in Stripe TEST mode and to the approved recipients named in S0. Stop on the first unexpected provider message.

## S14. Security acceptance and evidence archive
All SEC rows re-classified with hosted evidence; owner signs. Only then is a Production plan drafted.

## S15. Restore standard Supabase migration deployment (owner decision 3)
Full detail, evidence and the stage-by-stage CLI oracle results: `standard-migration-recovery-plan.md`.
- **Pre:** S14 complete; the ledger holds the executor, bookkeeping and withheld rows (S2, S3, S5-S8); gates G-21 (the 13 unrecordable files, the alias version and alias-covered file), G-24 (`config.toml` aligned to the approved function decisions) and G-25 (integration toggles read, canary approved) are PASS.
- **Action (T4-T10):** evidence package and signatures for the 13; ledger row for `20260814120000`; reviewed commit with the comment-only alias file `20260814002658_...sql`, regenerated manifests and tests; rows for the 13; `config.toml` alignment commit; completion check; canary push; re-enable "Deploy to production".
- **Expect:** `supabase db push --dry-run --include-all` against Development prints "Remote database is up to date"; ledger versions equal repository file versions (390); the canary migration (a comment-only file with a version later than `20261026120400`) is applied by the integration and recorded once.
- **Stop:** any pending file other than the canary; any row claiming execution that did not happen; the integration applies more than the canary.
- **Recover:** turn "Deploy to production" OFF again (owner toggle); the ledger rows written are `NOT EXECUTED` markers and are not undone by a ledger edit (see the rollback plan); restore point if schema changed.
- **Owner:** required at each of G-21, G-24, G-25.

## Order differences from the brief's starting framework
Notification containment (S1) is before everything; hosted preflight (P0) includes function-source reading; retirements are in S4 because `20261013120000` revokes the RPC they call; the Netlify/Git push is deliberately late (S9) because 11 new functions must exist first. The brief's "remaining application changes" after migrations is S6 (Edge) and S9 (frontend).
