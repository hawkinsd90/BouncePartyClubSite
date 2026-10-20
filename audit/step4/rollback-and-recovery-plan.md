# Step 4 rollback and recovery plan (Development only)

Principle: a code deployment is reversible; a committed SQL migration is not. Deleting a ledger row is bookkeeping only and never undoes SQL that ran. No recovery action touches Production. Every recovery that restores the database loses Development-only data written after the restore point (test orders, synthetic users, rows created by Step 4C tests); the owner is told which before approving.

## Classes of recovery
| Class | Applies to | Method | Data loss risk |
|---|---|---|---|
| R1 Code redeploy | Edge Functions, Netlify | redeploy previous function version from the P0 bundle; Netlify "publish previous deploy"; `git revert` (never force-push, never rewrite pushed history) | none |
| R2 Ledger bookkeeping reversal | history-only/attestation batches | prepared `REVERSAL <batch>` script, only with written owner approval and a fresh ledger export | none to business data; dependents must be reversed first |
| R3 Compensating forward migration | committed SQL that must be undone logically | new reviewed migration; never edit applied files | depends on the change |
| R4 Restore point | corrupted or unexplained state | provider restore to the S0 restore point, then reconcile ledger and functions to that time | loses everything after the point |
| R5 Full stop | anything unexplained | stop, change nothing, collect read-only evidence, ask the owner | none |

## Scenario table
| Scenario | First response | Recovery |
|---|---|---|
| Git push or Netlify build fails | stop; nothing hosted changed | fix on a new commit; R1 |
| Netlify publishes before backend ready | owner locks/rolls back publish | R1; Development was already contained |
| Missing or unexpected ledger rows at P0 | stop; do not "repair" | export, compare with capture, owner decides; no mutation |
| Historical reconciliation batch rejects | batch is atomic, nothing recorded | fix cause outside the migration; re-run validity; never split a batch |
| Connection drops mid batch | do **not** resend | export ledger, compare counts/markers; continue at verification or conclude it did not happen |
| Migration file errors | transaction rolls back; no ledger row | stop; diagnose; later files must not run |
| Migration succeeded but a rule is false | stop | R3 or R4; decide with the owner |
| Partial Edge deployment | stop deploying | per function: R1 to the previous version; keep the matrix updated |
| Unexpected RLS behavior (data visible or blocked) | if exposure: re-apply containment (`REVOKE USAGE ON SCHEMA public FROM anon, authenticated`) immediately | then R3/R4 |
| Missing service-role permission (e.g. function 42501 on catalog) | log the table | forward grant migration (see `…0100` pattern); never broad grants |
| Storage change fails | stop | R2 restores recorded bucket values for the two limit updates |
| Customer login broken | check signup trigger / `user_roles` migration `20261016120000` | R3, or R4 if roles damaged (snapshot taken before that file) |
| Booking creation fails | check `create-booking` logs and `service_role` catalog grants | forward grant; R1 for the function |
| Stripe/Twilio errors | stop provider tests | check TEST keys, signature settings, console URLs; no live retries |
| Security postcondition not met (e.g. `…0400` raises 42501) | do not bypass; no ledger row exists | owner option A/B for SEC-015; rerun |
| Real e-mail/SMS sent by accident | stop all provider tests; record recipients/time (no content copying into reports) | notify owner; if customer recipients, owner decides on notice; revoke relay credentials |
| Anon probe returns data after S11 | run the S11 reversal at once | investigate; R3 |

## Executor-specific scenarios (4A.1)
Each was rehearsed locally on a Development-shaped clone (`audit/step4/executor-rehearsal-results.json`); none has been run on hosted Development.
| Scenario | What the tool does | Operator action |
|---|---|---|
| SQL error or timeout inside a step | the step's transaction rolls back: no SQL effect, no ledger row; run reports `failed` with `ledger_row_present: false` | fix the cause outside the migration; rerun (it resumes at the failed step) |
| Postcondition or fingerprint mismatch after the SQL ran | the `RAISE` rolls everything back, including the SQL | investigate with the category digests in the error; never re-seal the package to "make it pass" without a new rehearsal |
| Client killed after commit, before the audit record | restart reads the ledger, accepts the recorded prefix, writes `reconciled_after_crash` | rerun; check `prior_run_incomplete` in the audit store |
| Connection lost during a step | if the ledger row is absent the step did not happen; if present the report says to verify first | export the ledger; compare with the audit store; do not resend blindly |
| A foreign or edited ledger row | refused before any step (`ledger` code) | export, compare with the approved base; owner decides; no automatic repair |
| Post-commit fingerprint or role probe differs | the run stops; the step is committed | treat as an incident: containment still on? run the S10 gate; restore point or compensating forward migration (R3/R4) |
| Storage canary fails (S4b) | nothing persisted | the three storage-policy files need another channel; owner decision |
| Supabase GitHub integration or Netlify fires unexpectedly on a push | not controlled by the tool | Supabase: disable the integration, export the ledger and compare with the executor's audit head; Netlify: publish the recorded previous deploy |

## Restore and ledger consistency
After R4 the ledger, schema, buckets and function versions can all disagree. After a restore: take a fresh ledger export; list function versions; compare with the stage log; resume only from the earliest stage whose evidence no longer holds. Never re-run a batch whose rows already exist.

## What is deliberately not offered
No `supabase db push`, `migration repair`, `--include-all`, baseline/alias files, or ledger-row deletion as a substitute for undoing SQL.


---

## Step 4A.3 additions
| Scenario | Response |
|---|---|
| A ledger row written by the recovery turns out to be wrong (for example a `NOT EXECUTED` marker on the wrong version) | Do not edit or delete it as a "fix": a row is a statement about history. Record the correction as a new, dated owner note and, if it blocks deployment, handle it through a new reviewed bookkeeping step (see `standard-migration-recovery-plan.md`) |
| An unexpected commit appears on `Dev` during the rollout (any cause) | Netlify publishes it; the Supabase integration may act if it is on. Stop, compare `ls-remote` with the recorded value, export the ledger, review the commit; the frontend rolls back by publishing the recorded deploy |
| SQL is applied through the Supabase connection outside the runbook (any cause) | the ledger gets a row with no file and the executor's pre-state checks fail (safe stop). Export the ledger and compare with the audit store; treat schema changes as unreviewed until the fingerprint says otherwise; restore point if needed |
| The Supabase integration applies migrations after being re-enabled (S15) | turn "Deploy to production" OFF, export the ledger, compare with the CLI dry run, decide forward fix vs restore point |
