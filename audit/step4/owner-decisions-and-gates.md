# Owner decisions and gates for Step 4B

Nothing is decided here. "Blocks" names the first runbook stage that cannot start without an answer. Recommendations are Claude's, for the owner to accept or change.

## Step 4A.2: consolidated checklist
All gates now live in one register with risk, owner action, exact location, evidence, hosted-mutation flag, blocked stages, pass/fail criteria and status: `owner-gates-register.csv` (26 rows) and its readable form `owner-approval-checklist.md`. Verified in 4A.2: the Supabase GitHub integration reacts to every push of `Dev` (D-03), WAL archiving runs but backups are unverified (D-02), the storage-policy capability is probable but unproven (G-16, `g16-storage-capability.md`), the JWT decisions are per function (`edge-function-jwt-compatibility-matrix.csv`), the demo-account procedure is `sec005-demo-account-owner-procedure.md`, and the freeze sequence is `package-freeze-and-commit-sequence.md`. The tables below are kept for history.

## Status after Step 4A.1 (supersedes the three blocker rows below)

| ID | Status now | What remains |
|---|---|---|
| D-01 exact-version executor | **Resolved locally.** `scripts/dev/hosted-executor/` (sealed package of 28 files, in-database guards, restart-safe, 96 rehearsal checks, mutation matrix, S11 gate controls). Never run against any hosted project. | Owner reads `scripts/dev/hosted-executor/README.md` and the rehearsal results, approves the executor, and signs a hosted authorization per run (stages S5 and S7). New hosted-only unknown: the rolled-back storage-policy canary (S4b, G-16). |
| D-02 restore point | **BLOCKED.** Plan is Pro [LIVE]; backups, PITR and a tested restore cannot be verified read-only. | Owner executes `d02-restore-point-procedure.md` (dashboard check, manual dump, local restore proof) and records the restore point. |
| D-03 Netlify / push behavior | **Partially resolved, new risk.** Netlify serves `dev.bouncepartyclub.com` and the deployed bundle targets the Development project and predates the 11 new functions [LIVE]. The Supabase project has a GitHub-linked branch "Dev" with status `MIGRATIONS_FAILED` [LIVE]: a push may trigger Supabase migrations and function deploys. | Owner answers the nine inspection questions in `d03-netlify-and-integration-control.md` and switches off Supabase auto-deploy and Netlify auto-publishing (D-03a/b/c). |

New gates:

| ID | Item | Recommendation | Stage |
|---|---|---|---|
| G-16 | Approve the rolled-back canary `CREATE/DROP POLICY` on `storage.objects` as the hosted operator | Approve; it persists nothing. If it fails, the three storage-policy files cannot run through the postgres role and the owner must choose a different channel | S4b |
| G-17 | Hosted authorization documents (one for steps 1-23 with the 23 October versions released, one for steps 24-28) | Sign each separately; 48 h maximum window; restore point taken before approval | S5, S7 |
| D-JWT-1 | Release the `verify_jwt` changes in `edge-function-jwt-compatibility-matrix.csv`: 21 of the 25 hosted/config differences predate Step 3 and are not part of any security fix; 4 are Step 3 (`twilio-status-callback`, `get-session-metadata`, `create-order-short-link`, explicit `submit-contact-inquiry` entry) | Release the Step 3 four and the retired/relay/payment tightenings the matrix marks; deploy each with an explicit value; keep the two `false` webhooks and `checkout-bridge`/`send-error-notification` false; leave the stubs and `save-signup-address`, `submit-contact-inquiry` undeployed unless the owner wants them aligned | S1, S4, S6 |
| D-03a/b/c | Netlify and Supabase answers, disconnecting the GitHub integration, stopping auto publishing | Answer; disconnect or disable Supabase auto-deploy permanently; stop Netlify auto publishing during the rollout | S9 |

## Blockers that stop Step 4B from starting (real gaps, not owner preferences)

| ID | Gap | Why it blocks | Proposed resolution | Blocks |
|---|---|---|---|---|
| D-01 | **No approved mechanism applies the 23 October and 5 Step 3B files to hosted Development with their own versions in the ledger.** The Step 2 hosted procedure covers history-only/attestation batches and the 2 bucket updates only. `supabase db push`, `migration repair`, `--include-all` and `apply_migration` (own timestamp) are all unacceptable. | Without it S5 and S7 cannot run | 4B pre-work: generate one reviewed script per file (file verbatim + ledger row with the file's version and statements), one transaction each, advisory lock, pre/post rule from the manifests; rehearse on the local restores; owner approves the generated scripts by SHA-256 | S5, S7 |
| D-02 | **No Development restore point is recorded**; plan/PITR availability on this project is unknown | Committed SQL has no ledger-only reversal | Owner confirms the backup/PITR option and takes a point immediately before S5 and before S7 | S0 |
| D-03 | **Netlify behavior is unknown** (branch deploys, build hooks, env vars). Pushing 103 commits may publish immediately | Frontend must not publish before the 11 new functions exist | Owner states the Netlify setting; recommended: lock auto-publishing for the Dev site during the rollout, push at S9, publish after S8 | S9 |

## Gates (answers needed before the named stage)

| ID | Item | Choices | Recommendation | Stage |
|---|---|---|---|---|
| G-01 | Provider credentials on Development: are Resend/Twilio live, sandbox or unset? Stripe keys test? (names only; Claude cannot list secrets) | live / sandbox / unset | Treat as live until proven otherwise; deploy guarded relays first; unset live sending credentials for the rollout if feasible | S1 |
| G-02 | Approved test recipients (e-mail address, phone number) | named by owner | One owner-controlled address and number | S1, S13 |
| G-03 | SEC-005 demo master account (exists on Development [LIVE]) | rotate / disable / keep | Rotate first, disable later; owner runs `step3b-credential-check.sql` himself; no recreation, no login attempts by Claude | before any Production-to-Development refresh; recommended before S1 |
| G-04 | SEC-015 hosted default privileges | A run file as operator / B owner closes via dashboard / C skip | Development has 0 `public` default ACL rows [LIVE], so expected no-op; re-check at S7 | S7 |
| G-05 | Twilio console URLs for the two webhooks (or `TWILIO_WEBHOOK_URL`, `TWILIO_STATUS_CALLBACK_URL`) | confirm | Owner confirms exact public URLs on Development | S6 |
| G-06 | `SITE_URL`, `RETURN_ORIGINS` project secrets | set | Set to `https://dev.bouncepartyclub.com` | S6 |
| G-07 | Attestation approvals: 56 owner-attestation operations (44 with defined rule, 9 WEAK rule not approvable as is, 3 BLOCKED) | sign / defer | Sign only the 44 defined; the 9 and the 3 stay out; `20251003170350` attestation only, never SQL | S2 |
| G-08 | Storage decision for the two bucket-limit updates and legacy evidence photos (SEC-020) | A run staged migration script on Dev / B leave public | A on Development after `task-evidence` and `20261015123000` are live; no silent move or delete; Production later | S3, after S5 |
| G-09 | SEC-004 anonymous consent insert; SEC-035 crew scope | accept / narrow | SEC-004 accept; SEC-035 decide after S13 crew testing | S13 |
| G-10 | SEC-038 temporary roles | keep / drop | [LIVE] login roles include `cli_login_postgres`; owner reviews each; no change in 4A | S14 |
| G-11 | SEC-048 dependencies (`react-router-dom` 6.30.1 installed, `ws` 8.18.3, `qs` 6.14.0; `package-lock.json` pins) | A in-range patch update as its own change / B wait | A as a separate small commit after 4B passes; needs `npm install` (registry), build, typecheck and browser regression; not part of the rollout commit | before frontend release to Production |
| G-12 | Hosted-only function `send-booking-confirmation` (no repository source or caller; deployed 2026-10-16) | read source / retire / keep | Read the hosted source read-only first; retire only after hosted caller proof (SEC-031) | S14 |
| G-13 | `send-error-notification` calls a non-existent `resend` function | route via `send-email` / leave | Leave until after rollout; log as defect | S13 |
| G-14 | Rollout window and on-call person | named | Owner | S0 |
| G-15 | Push scope: `git push origin Dev` of 103 commits; nothing to `main` | approve / adjust | Approve fast-forward push only, no force, no PR | S9 |

## Not owner decisions, but must be re-verified at 4B start
Ledger = 58 rows, max `20260929161925`, same SHA-256 as the capture; containment booleans; hosted function sources; `git ls-remote origin Dev` = `b2cd801`; local acceptance PASS on the commit to be pushed.


---

## Step 4A.3 (2026-10-19)
Decisions 1-5 are recorded in the gate register as **OWNER STRATEGY APPROVED (execution NOT authorized)** where they are strategy only. The register now has 31 gates (new: G-20 Bolt freeze (since removed by owner decision, Step 4B AUTH-1), G-21 standard-migration closure, G-22 reconcile `origin/Dev`, G-24 `config.toml` alignment, G-25 re-enable Supabase automation) with `decision_timing` and `gate_class` columns (the social-preview matter was completed by the owner's own commit and is not a gate); `owner-approval-checklist.md` lists them in the order they are needed. New documents: `backup-options-comparison.md`, `standard-migration-recovery-plan.md`, `provider-safety-checklist.md`, `git-remote-reconciliation.md`, `bolt-access-control.md`.
