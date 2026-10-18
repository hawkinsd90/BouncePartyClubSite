# Step 3 to Step 4 deployment dependencies

Nothing here is done. This extends section 4 of `audit/step2-compatibility-and-handoff.md`; the Step 2 order is kept.

## Order for the combined hosted Development rollout
0. **Preconditions:** owner authorization; Step 3B committed and rehearsed on both replays; credential for the demo master account rotated (SEC-005); Development restore point; read-only preflight of hosted function sources, including the caller of `get_admin_users` (SEC-011) and `send-booking-confirmation` (SEC-031).
1. **First, before any data refresh or hosted send:** deploy the guarded `send-email` and `send-sms-notification` (SEC-030, 040).
2. Step 2 bookkeeping part 1 (security-touching checks run before Step 3 changes the checked objects).
3. Storage decision and the two bucket-limit updates (SEC-021).
4. Deploy the deploy-first Edge set: waiver functions, `customer-portal-*`, `task-evidence`, `record-site-event`, `staff-order-save`, `complete-booking`, `create-booking`, `customer-cancel-order`, `stripe-refund`; replace the 14 stubs; JWT flips; new Step 3B function changes (SEC-022 to 029, 032).
5. Development grants (SEC-016) before exercising `create-booking`.
6. October block in version order with the portal containment ready; snapshot before `20261016120000`.
7. Step 3B corrective migrations (sequences, leftovers, policies), then the allow-list verification.
8. Bookkeeping part 2.
9. **Last:** apply the schema end state (SEC-017) only after SEC-001, 002, 003, 010, 014 pass the live synthetic anon probe on Dev.
10. Verify: allow-list queries, anon probes with a synthetic key, financial workflows, signed-URL reads, ledger export comparison.

## Hard dependencies
| Change | Needs first |
|---|---|
| 20261012 (SEC-001/002) | create-booking, customer-portal-*, staff-order-save, frontend |
| 20261014/15 (SEC-018 to 020) | waiver functions, customer-portal-*, task-evidence |
| 20261018120100 | record-site-event |
| 20261021 to 24 | staff-order-save, stripe-refund, complete-booking |
| 20261008 | identify get_admin_users caller |
| Sequence revoke (SEC-014) | 20261013 number-generator checks |
| Twilio signature (SEC-025) | confirm webhook URL in Twilio console (owner) |
| Evidence migration (SEC-020) | task-evidence and 20261015123000; separate approval |

## Production (separate, later)
Production remains exposed until its own release (live evidence: SEC-001, 002, 005, 014, 015, 018 to 020). Its release needs its own approval, restore point, fresh read-only preflight and the Production manifest. The Production verification queries used in this audit are reusable for that preflight.

## Step 3B additions (local implementation, 2026-10-17): what changed in this plan

New files that Step 4 must carry. None is deployed; all are committed only after owner acceptance.

| Item | Kind | Where it fits in the order above |
|---|---|---|
| `20261026120000` sequences and anonymous table privileges, `20261026120100` service_role catalog read, `20261026120200` crew task / receipt policies, `20261026120300` confirmation-column guard, `20261026120400` supabase_admin default privileges | five forward-only migrations (Development manifest phase P5, Production manifest group `step3b`) | after the whole October block and its verification (step 6), in version order, one transaction each; the read-only pre/post checks are in `audit/security/step3b-verification-rules.json`. `20261026120300` needs `20261017120000` and `20261021120000` first (it names columns they create). `20261026120100` is required on Development before `create-booking` is exercised and is a no-op on Production |
| `audit/security/step4-development-containment-end-state.sql` | reviewed script, **not** a migration | **last** (step 9): only after the posture checks pass against Development with containment still on, then re-run them |
| `supabase/functions/_shared/twilio-signature.ts`, `twilio-webhook`, `twilio-status-callback` | Edge Functions | deploy with the Edge set; **confirm the Twilio console URLs first**; `twilio-status-callback` flips `verify_jwt` true to false (`config.toml`); test with a real signed test message on Development |
| `get-session-metadata`, `get-payment-method`, `create-order-short-link` | retired to HTTP 410 | before deploying, check the hosted function logs for callers over the last weeks; `get-session-metadata` flips `verify_jwt` false to true |
| `sync-google-calendar` | staff or service role only | confirm how the database trigger authenticates (it sends the service-role key); the trigger is absent on Development (`pg_net`) |
| `send-error-notification`, `_shared/rate-limit.ts` | escaping, caps, throttling | none beyond the Edge deploy; note the function still calls a non-existent `resend` function |
| `checkout-bridge` | origin allow-list | `SITE_URL` / `RETURN_ORIGINS` must be set on the project (as for `stripe-checkout`) |
| `config.toml` | `create-order-short-link` and `submit-contact-inquiry` added with `verify_jwt = true`; `twilio-status-callback` false; `get-session-metadata` true | deploy-time flips; keep `verify_jwt` settings equal to the file |
| `scripts/SyncDevDataFromProd/lib/config.mjs` | the refresh utility now lists `trg_guard_booking_confirmation_columns` as a reviewed trigger | needed before the first Production-to-Development refresh after the guard exists |
| Frontend (`App.tsx`, `safeInternalPath.ts`, `MessageTemplatesTab.tsx`, `vite.config.ts`) | open-redirect guard, sandboxed template preview, dev-server guard | ships with the normal frontend deploy; the dev-server guard only affects `vite` and `vite preview` |

**Updated hard dependencies**

| Change | Needs first |
|---|---|
| `20261026120300` | `20261017120000` (columns), `20261021120000` (guard pattern) |
| `20261026120000` | `20261013120000` (number generators are admin-gated definers) and `20261018120000` (future defaults) |
| Frontend `?next=` guard | none |
| Containment end-state script | everything above verified; it is the only step that restores broad access |

**Production** (separate, later): the same five files run after plan item 67 in version order; Production needs no containment script. After `20261026120400`, check `pg_default_acl` for `supabase_admin` (see the migration header) because the hosted migration role may be refused.

### Step 3B review corrections (2026-10-17): ordering against the Step 2 plans and the default-privilege gate

**Where the five files sit.** Development manifest: phase P5, chained `20261025120000` > `20261026120000` > `...0100` > `...0200` > `...0300` > `...0400` (`required_predecessor_versions`), no `plan_order` (the 259-operation bookkeeping order is untouched). Production manifest: group `step3b`, after `plan_order` 67, same chain. Combined Development order: P1 bookkeeping, P2 bucket SQL, deploy-first Edge Functions, P3 October block (23 files, version order, verified), **P5 Step 3B (five files, version order, each verified with `step3b-verification-rules.json`)**, P4 bookkeeping part 2 (independent of P5), containment end-state script last. The Step 2 handoff (section 4, item 5) listed "Step 3 database changes" before the October block; that cannot hold for these files because they run in version order and `20261026120300` names columns created by `20261017120000` and `20261021120000`. The intent behind that item is kept: nothing broadens access, because the containment end state is still the last step.

**Default-privilege gate (`20261026120400`, SEC-015).** The migration now fails closed: it re-checks its postcondition and raises (42501, no history row) when `supabase_admin` or `postgres` default privileges in `public` still name `anon`, `authenticated` or PUBLIC. Locally the operator is a superuser, so it succeeds on both replays; a hosted-like non-superuser, non-member operator is refused when defaults are open (reproduced). Whether the hosted `postgres` role can alter `supabase_admin` defaults is **unverified**. Step 4 gate: before running the file on a project, run the read-only `pre_work_remaining` query; if it is true, either confirm the operator can do it or have the owner close the defaults once from the dashboard SQL editor as `supabase_admin` (no new role); the file then passes as a no-op. Development has no `public` defaults in the captured state, so there it is expected to be a no-op; Production has six rows. Do not mark the version applied unless `post_effect_present` is true.

### Edge Function deployment register (final acceptance review, 2026-10-18)

Every Edge Function whose source or `verify_jwt` setting differs from the Step 2 checkpoint, with the caller model it must serve and its hosted preflight gate. Asserted by `edgeFunctionHardening` (config values and presence in this document).

| Function | verify_jwt | Intended caller and in-function proof | Hosted preflight gate before deploying |
|---|---|---|---|
| `twilio-webhook` | false | Twilio only; `X-Twilio-Signature` checked before any write | Confirm the webhook URL in the Twilio console (or set `TWILIO_WEBHOOK_URL`); test with a real signed message on Development |
| `twilio-status-callback` | false (was true) | Twilio only; same signature check | Confirm the status-callback URL (or `TWILIO_STATUS_CALLBACK_URL`); accept the `verify_jwt` flip |
| `get-session-metadata` | true (was false) | none: retired to HTTP 410 | Read the hosted function logs for callers over the last weeks; no repository caller exists |
| `get-payment-method` | true | none: retired to HTTP 410 | As above |
| `create-order-short-link` | true (added) | none: retired to HTTP 410; the legacy RPC it called is revoked | As above |
| `sync-google-calendar` | true | service role (the database trigger sends the service-role key) or Admin/Master; anon key refused | Confirm the hosted trigger sends the service-role key (the trigger needs `pg_net`, absent on Development; the integration is currently disabled) |
| `send-error-notification` | false | browser crash reports with the anon key; rate-limited per address and globally; input escaped | Decide whether it should call `send-email` (it calls a function named `resend` that does not exist) |
| `checkout-bridge` | false | Stripe return redirect; `postMessage` target limited to the return-origin allow-list | `SITE_URL` / `RETURN_ORIGINS` set on the project |
| `record-consent` | true | signed-in user token (signup consent and `?action=drain-pending`); rows scoped to the caller | **Compare with the hosted function first.** The repository file had been empty since commit `8d4701f`; it is restored byte for byte from `8d4701f^` (SEC-049). Do not overwrite a newer hosted version without reading it (Step 2 reported Production's source as empty) |
| every importer of `_shared/rate-limit.ts` (`charge-deposit`, `check-availability`, `complete-booking`, `create-booking`, `customer-portal-action`, `record-site-event`, `request-portal-link`, `resolve-link`, `send-error-notification`, `stripe-checkout`, `stripe-refund`, `submit-contact-inquiry`) | unchanged | unchanged (two constants were added) | Ride along with the coordinated redeploy; no behaviour change for them |

`save-pending-consent` and `auth-email-hook` remain deliberate HTTP 410 stubs (unchanged). `config.toml` also gains `create-order-short-link` and `submit-contact-inquiry` blocks (`verify_jwt = true`, the platform default, now explicit).
