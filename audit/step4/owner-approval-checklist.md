# Owner approval checklist (Step 4A.2)

One place for every gate that stands between the committed work and the first hosted action. Source of truth: `owner-gates-register.csv` (same rows, all columns). Claude changed nothing hosted to produce this; every item marked *hosted mutation* is an owner action or a controlled Step 4B action.

Legend: **S0** approvals and restore point; **S1** notification containment; **S4/S4b** deploy-first functions and storage canary; **S5** October block; **S9** push and Netlify; **S11** containment removal.

## A. Can be satisfied now (reading, deciding, preparing; no controlled hosted action needed)

| Gate | Item | Owner action | Blocks | Hosted mutation | Status |
|---|---|---|---|---|---|
| D-02 | Development restore point | Approve separately: dashboard backup read, the hosted dump at a named UTC time, encrypted storage location, the local restore proof and pass criteria, the Storage accounting choice, tolerated Development-only data loss | S0,S5 | No for reading | STRATEGY APPROVED - EXECUTION AND RESTORE VERIFICATION PENDING |
| D-03a | Supabase and Netlify settings inspection | Record the answers to the nine questions in d03 (Supabase GitHub integration toggles, production branch, working directory; Netlify branch, branch deploys, published deploy, env vars) | S0,S9 | No | ANSWERED for Supabase and for Netlify build/env |
| D-03c | Netlify continuous deployment (kept ON) | Nothing to change. Record the currently published deploy ID before the push as the rollback target; accept the incompatibility window | none (recorded only; not a blocker) | No (continuous deployment stays on) | OWNER STRATEGY APPROVED |
| G-01 | Provider credentials and testing safeguards | No separate action. Inside the single coordinated rollout the guarded relays (S1) deploy before any operation that could send a real message; confirm configuration items C1-C10 in provider-safety-checklist.md (read-only) before provider tests | S1 | YES if secrets must be changed (owner action) | OWNER STRATEGY APPROVED |
| G-02 | Approved test recipients | Name one owner-controlled e-mail address and one phone number for all tests | S1,S13 | No | OWNER STRATEGY APPROVED |
| G-03 | SEC-005 demo master account: Development | Follow sec005-demo-account-owner-procedure.md for Development: ban or rotate, run the credential check yourself | S1,S11 | YES (hosted account change | OWNER STRATEGY APPROVED |
| G-03P | SEC-005 demo master account: Production | Same procedure on Production, separately, count other masters first | none of S0-S11 | YES (Production account | OWNER STRATEGY APPROVED |
| G-05 | Twilio console callback URLs | Read the current inbound and status-callback URLs and the Account SID/auth token availability by name; confirm the exact Development URLs | S6 | YES if a URL must be changed (provider setting | OPEN |
| G-07 | Attestation-dependent bookkeeping (Step 2) | Sign only the 44 attestations with a defined rule after reading e2k-attestation-decisions.md; leave the 9 weak-rule and the 3 blocked out | S2,S5 | Writes ledger rows later (S2), not now | OPEN |
| G-08 | SEC-020 legacy evidence photos and bucket limits | Decide: run the staged migrate-order-evidence.mjs on Development after S8, or leave; approve the two bucket-limit updates (S3) | S3 | Writes later (S3 yes | OPEN |
| G-09 | SEC-004 anonymous signup-consent insert | Accept as is (consent is recorded by record-consent) | none (S13) | No | OPEN |
| G-09b | SEC-035 crew permissions on orders and customers | Decide after S13 crew testing; do not narrow earlier | none (S13) | No (later migration) | OPEN |
| G-10 | SEC-038 database login roles | Review each login role (authenticator, cli_login_postgres, pgbouncer, supabase_* roles); drop only cli_login_postgres if unused | none | YES if dropped (owner) | OPEN |
| G-11 | SEC-048 dependency updates | Approve a separate patch change: npm update react-router-dom; run build, typecheck and a browser pass | none (before the frontend release to Production) | No | OPEN |
| G-12 | send-booking-confirmation (hosted-only function) | Read its source (read-only) and decide retire or keep | none (S14) | Retiring is a deploy (later) | OPEN |
| G-13 | send-error-notification target | Leave until after the rollout | none | No | OPEN |
| G-14 | Deployment window and on-call | Name the window (start/end) and the person reachable throughout | S0 | No | OPEN |
| D-JWT-1 | Edge Function verify_jwt decisions | Decide each row of edge-function-jwt-compatibility-matrix.csv: 17 deploy at true, 3 at false (required), 5 not deployed (preserve) | S1,S4,S6 | Deploys later | OPEN |
| G-18 | Commit and package freeze | Approve the commit sequence in package-freeze-and-commit-sequence.md; commit only after approval; do not edit the 28 files | S0 | No (local commits) | OPEN |
| G-19 | Stub functions with repository changes (fix-payment-method, backfill-payment-methods) | Decide deploy or leave the stubs | S6 | Deploy later if chosen | OPEN |
| G-20 | Bolt access freeze | Read which Supabase project(s) and branch Bolt is connected to; disconnect or restrict Bolt during the recovery; add branch protection on Dev and main | S0,S9 | YES (settings in Bolt, GitHub, Supabase | OPEN |
| G-21 | Close the standard-migration obstacles | Decide: (a) comment-only alias file for 20260814002658, (b) ledger row for 20260814120000, (c) owner-signed attestation rows for the 13 after new read-only evidence | S15 | YES later (ledger rows) + local commits | OPEN. Proposal to record all 13 as NOT EXECUTED is NOT approved. Step 4A.5 read-only Development evidence is in thirteen-migration-review.md sections 8-12: none of the 13 is S1; 9 would be harmful to execute |
| G-22 | Reconcile origin/Dev (aeb708e) | Choose R1 merge (recommended) or R3 force push; confirm whether the stray vite timestamp file should stay deleted | S0,S9 | No for R1 (local merge) | OPEN |
| G-24 | Align config.toml with the approved function decisions | Make config.toml equal the approved JWT matrix (reviewed commit) before the integration is re-enabled | S15 | No (a commit) | OPEN |
| G-25 | Re-enable Supabase automatic deployment (after proof) | Read the toggles; approve the dry run against Development (hosted connection, no write); approve the canary push; then switch Deploy to production ON | S15 | YES (owner toggle | OPEN |

## B. Requires a controlled Step 4B action (after approval of the runbook stage)

| Gate | Item | Action | Blocks | Hosted mutation | Status |
|---|---|---|---|---|---|
| D-03b | Switch off Supabase auto-deploy for the rollout | Turn Deploy to production OFF and Automatic branching OFF (or disconnect) before S9; keep it off until the ledger and repository agree | S9 | YES (hosted setting | OPEN |
| G-04 | SEC-015 default privileges | Read-only check at S7 (Development has 0 public default rows [LIVE]) | S7 | No | READY |
| G-06 | SITE_URL and RETURN_ORIGINS | Set to https://dev.bouncepartyclub.com (and any extra return origin) as Edge Function secrets | S6 | YES (secret | OPEN |
| G-15 | Git push scope | Approve exactly: git push origin Dev (fast-forward, 103 commits plus the Step 4 commits), no force, no merge to main, no PR | S9 | YES (publishes commits | OPEN |
| G-16 | Storage-policy capability canary | Approve running g16-storage-canary.sql once; it always aborts, so nothing persists | S4b,S5 | Attempts DDL inside a transaction that is always aborted (no persistent change by construction) | OPEN |
| G-17 | Hosted authorization documents | Sign one document for steps 1-23 (releasing the 23 October versions) and one for steps 24-28; each valid at most 48 h; restore point taken before approval | S5,S7 | No (documents) | OPEN |

## B2. Decisions in the order they are needed

### Immediate (before any step 4b action)

| Gate | Item | Class | Status |
|---|---|---|---|
| D-02 | Development restore point | Strategy approved | STRATEGY APPROVED - EXECUTION AND RESTORE VERIFICATION PENDI |
| D-03a | Supabase and Netlify settings inspection | Requires read-only verification | ANSWERED for Supabase and for Netlify build/env |
| G-14 | Deployment window and on-call | Pending owner authorization | OPEN |
| G-18 | Commit and package freeze | Pending owner authorization | OPEN |
| G-20 | Bolt access freeze | Pending owner authorization | OPEN |
| G-22 | Reconcile origin/Dev (aeb708e) | Pending owner authorization | OPEN |

### Before the stage that needs it

| Gate | Item | Class | Status |
|---|---|---|---|
| D-03b | Switch off Supabase auto-deploy for the rollout | Requires controlled hosted execution | OPEN |
| G-01 | Provider credentials and testing safeguards | Strategy approved | OWNER STRATEGY APPROVED |
| G-02 | Approved test recipients | Strategy approved | OWNER STRATEGY APPROVED |
| G-03 | SEC-005 demo master account: Development | Strategy approved | OWNER STRATEGY APPROVED |
| G-05 | Twilio console callback URLs | Requires read-only verification | OPEN |
| G-06 | SITE_URL and RETURN_ORIGINS | Requires controlled hosted execution | OPEN |
| G-07 | Attestation-dependent bookkeeping (Step 2) | Pending owner authorization | OPEN |
| G-08 | SEC-020 legacy evidence photos and bucket limits | Pending owner authorization | OPEN |
| G-15 | Git push scope | Pending owner authorization | OPEN |
| G-16 | Storage-policy capability canary | Requires controlled hosted execution | OPEN |
| G-17 | Hosted authorization documents | Pending owner authorization | OPEN |
| D-JWT-1 | Edge Function verify_jwt decisions | Pending owner authorization | OPEN |
| G-19 | Stub functions with repository changes (fix-payment-method, backfill-payment-methods) | Pending owner authorization | OPEN |
| G-21 | Close the standard-migration obstacles | Deferred until after the Development deployment | OPEN. Proposal to record all 13 as NOT EXECUTED is NOT appro |
| G-24 | Align config.toml with the approved function decisions | Deferred until after the Development deployment | OPEN |
| G-25 | Re-enable Supabase automatic deployment (after proof) | Deferred until after the Development deployment | OPEN |

### Later (after the rollout or only needed late)

| Gate | Item | Class | Status |
|---|---|---|---|
| D-03c | Netlify continuous deployment (kept ON) | Strategy approved | OWNER STRATEGY APPROVED |
| G-03P | SEC-005 demo master account: Production | Strategy approved | OWNER STRATEGY APPROVED |
| G-04 | SEC-015 default privileges | Requires read-only verification | READY |
| G-09 | SEC-004 anonymous signup-consent insert | Deferred until after the Development deployment | OPEN |
| G-09b | SEC-035 crew permissions on orders and customers | Deferred until after the Development deployment | OPEN |
| G-10 | SEC-038 database login roles | Deferred until after the Development deployment | OPEN |
| G-11 | SEC-048 dependency updates | Deferred until after the Development deployment | OPEN |
| G-12 | send-booking-confirmation (hosted-only function) | Deferred until after the Development deployment | OPEN |
| G-13 | send-error-notification target | Deferred until after the Development deployment | OPEN |


## C. What PASS and FAIL mean

See the `pass_criteria` and `fail_criteria` columns of the register for each gate. A gate with status OPEN or BLOCKED is **not** satisfied; evidence that is merely consistent (for example WAL archiving being active) is not a pass.

## D. Minimum set to start the first hosted action (S1)

S0 gates: D-02 (or an explicit owner statement that Development has no data worth protecting, plus a manual dump), D-03a, G-14, G-18, D-JWT-1 for `send-email` and `send-sms-notification`. S1 gates: G-01, G-02, G-03 (recommended). Nothing past S1 is approved by satisfying these.

## E. Gate to stage map

| Stage | Gates that must be PASS before it starts |
|---|---|
| S0 | D-02, D-03a, G-14, G-18, G-20, G-22 |
| S1 | G-01, G-02, G-03, D-JWT-1 |
| S2 | G-07 |
| S3 | G-08 |
| S4 | D-JWT-1 |
| S4b | G-16 |
| S5 | D-02, G-07, G-16, G-17 |
| S6 | G-05, G-06, D-JWT-1, G-19 |
| S7 | G-04, G-17 |
| S9 | D-03a, D-03b, G-15, G-20, G-22 |
| S11 | G-03 |
| S15 | G-21, G-24, G-25 |
