# Development rollout S3 to S15: stage-group authorization plan (2026-10-20)

Status: **PLANNING ONLY. NOTHING HERE IS AUTHORIZED OR EXECUTED.** The stage order of `development-deployment-runbook.md` is unchanged; this file only groups consecutive stages so that each hosted mutation needs one meaningful approval instead of many. Production is outside this plan. Netlify Development automatic deployment stays ON; Supabase Development automatic migration deployment stays OFF until the S15 gate. Sources: the runbook sections S2 to S15, `owner-gates-register.csv`, `standard-migration-recovery-plan.md`, `g16-storage-capability.md`.

## 1. Authorization already in hand

| Stage | State |
|---|---|
| P0, S0 | approved and executed (AUTH-4) |
| S1 | approved and executed (AUTH-5): guarded relays `send-sms-notification` v7, `send-email` v8 |
| S2 | partly: canary B01, B02, B03 to B08 recorded (ledger 141 rows). Wave 2 (82 versions, 11 batches) is prepared for one decision (`s2-wave2-approval-package.md`, AUTH-9). The 44 attestations are prepared for one review session (`s2-attestation-decision-package.md`). B31, B33 and B40 (36 versions) follow the attestations |
| S3 to S15 | **none authorized** |

## 2. Proposed stage-group approvals (in runbook order)

| Group | Stages | What it mutates | Needs from the owner | Depends on | Irreversible or security-sensitive |
|---|---|---|---|---|---|
| SG-1 | S2 completion | ledger rows only (wave 2, then the attested batches and B31, B33, B40) | AUTH-9; the 44 decisions | previous batches | low: rows only; attestation consequences in the decision package |
| SG-2 | S3, S4, S4b | S3: the two `storage.buckets` limit updates (SQL, B23 and B24). S4: deploy 21 Edge Functions one at a time, `verify_jwt` set explicitly per function, retirements answer HTTP 410. S4b: the always-aborted Storage-policy canary | bucket-limit decision (SEC-021); release of each `verify_jwt` flip (D-JWT-1, 21 differences); G-16 approval for the canary; confirmation that the three hosted-log callers (`get-session-metadata`, `get-payment-method`, `create-order-short-link`) are unused | S2 as ordered (S3 follows the history-only rows it checks); P0 function diffs | bucket limits revert by script; function deploys revert by redeploying the saved bundles; the canary leaves nothing behind |
| SG-3 | S5, S6, S7 | the 23 October migrations (executor, one transaction each), 21 more Edge Functions, 5 Step 3B corrective migrations | go for the file range; Twilio console URLs or `TWILIO_WEBHOOK_URL` / `TWILIO_STATUS_CALLBACK_URL`; `SITE_URL` and `RETURN_ORIGINS`; the `get_admin_users` caller (SEC-011) and the `20251207163822` read-only check outcome (SEC-007); option A or B only if the SEC-015 pre-check is not zero | **S4b passed** (the three Storage-policy files `20261014120000`, `20261015120000`, `20261015123000` cannot run if the role cannot own `storage.objects`); a fresh restore point `rp-S5` and a second before `20261016120000` | **forward-only**: committed October and Step 3B files have no ledger-only reversal; recovery is a compensating migration or the restore point (data created since is lost) |
| SG-4 | S8 | remaining history-only rows (8 storage-policy versions, the deferred rows) and the 2 attestations of S8 | the 2 attestation decisions (included in the 44-version session if you list them there; they are not among the 44) | S5, S7 | rows only |
| SG-5 | S9 | `git push origin Dev` (fast-forward, no force, nothing to `main`); Netlify publishes `dev.bouncepartyclub.com` automatically | the exact push command (G-15); local merge of `origin/Dev` first (G-22); recorded current Netlify deploy ID; confirmation that Supabase "Deploy to production" and "Automatic branching" are OFF (D-03b) | S8 | a push is hard to retract (`git revert` only); the Development site may show errors until S12 (accepted) |
| SG-6 | S10, S11, S12 | S10 read-only posture checks; S11 one script: `GRANT USAGE ON SCHEMA public TO anon, authenticated; REVOKE CREATE ON SCHEMA public FROM service_role;` (the containment end state, SEC-017); S12 final verification | owner reviews the S10 evidence; approves the single S11 script | S10 PASS (20 gate checks, gates G-03 PASS) | **security-sensitive**: it ends the anon/authenticated lock-out of `public`; the reversal (REVOKE USAGE, GRANT CREATE) is prepared and runs immediately if any probe returns data |
| SG-7 | S13, S14 | integration tests (119); real provider calls only in Stripe TEST mode and to the four approved recipients; evidence archive | go for provider-involving tests; sign-off of the SEC re-classification (S14) | S12 | provider messages cannot be recalled |
| SG-8 | S15 | the 13 disputed versions (individually signed markers; four also need a deny-list exception id), alias reconciliation (`20260814120000` row and the comment-only alias file), the two compatibility versions recorded without executing, `config.toml` alignment, a canary push, then re-enabling Supabase "Deploy to production" | G-21 (the 13), G-24 (`config.toml` alignment), G-25 (integration toggle and canary); the 13 individual signatures | S14; S2 and S8 rows; S11 | ledger rows say NOT EXECUTED and are not undone by editing the ledger; re-enabling the integration is the point where ordinary migrations resume |

## 3. Cross-cutting dependencies

- **Attestations:** the 44 unlock B13 to B22 and B37 and, through B18 and B21, B31, B33 and B40. SG-3 (October files) does not require them in the runbook order, but S2 "attestation groups (only those with signed attestations)" precede S3 only where the history-only checks need the objects unchanged; rejecting an attestation leaves that version pending and must be settled before S15 ("any pending file other than the canary" is a stop condition).
- **Storage-policy permission verification (S4b):** gates SG-3. If the canary reports a permission error, the three Storage-policy October files cannot run and the rollout stops for an owner decision; no privileged workaround is allowed without a new approval.
- **Provider operations:** none in SG-1 to SG-6 (smoke tests use synthetic input). SG-7 is the first stage with Stripe TEST and messaging calls.
- **Frontend and Git:** only SG-5 (push) and SG-8 (config and canary commits and push).
- **Security-touching history-only batches** (B09 to B12, B36, B42, B43) are in wave 2 so that they are recorded **before** SG-3 changes the objects their rules check.

## 4. Recommended next approvals, in order

1. AUTH-9 (wave 2) and the attestation decision session: both are S2, ledger-only, and can be answered together.
2. Then SG-2 as one approval (S3 to S4b), after its owner decisions are collected in a single checklist (bucket limits, 21 `verify_jwt` releases, G-16, hosted-log caller confirmation).
3. SG-3 after S4b passes.

I will prepare the SG-2 package (exact SQL hashes, function list with `verify_jwt` values, the canary statement, expected results and stop conditions) as the next preparation step once you have decided AUTH-9 and the attestations, because its S3 versions (B23 and B24) and its pre-conditions use the ledger state those decisions produce.
