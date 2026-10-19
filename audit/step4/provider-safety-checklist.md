# Provider safety checklist for Development integration testing (Decision 4)

Owner decision recorded (strategy, 2026-10-19): Stripe **test mode**, approved e-mail recipients, approved phone recipient, controlled SMS and e-mail tests, synthetic orders and customers where practical. **Nothing here was run, no provider was called, and no credential value was read or is printed.** Names and classes only.

## 0. Expected state before the coordinated deployment
The relays deployed on Development are the **old, pre-guard versions** (`send-sms-notification` v6, updated 2026-07-01; `send-email` v7, updated 2026-08-14). The guard was committed on 2026-10-15, after both. **This is expected**: the corrected code is committed locally and has not been deployed. It is not a separate defect, there is **no isolated hotfix**, and no functional testing starts until the approved coordinated deployment has completed.
What the plan keeps is the **ordering rule** inside that single rollout: the notification functions (stage S1) are deployed **before any operation that could send a real message**, and provider tests (V4 onward) start only after S12. Facts that explain why (read-only, unchanged): the old versions accept unauthenticated callers and have no recipient guard; Twilio and Resend credentials are stored in the Development database; customer contact data is copied from Production; the Stripe keys stored there are test-class. Nothing in the migrations, bookkeeping or executor sends anything (no `pg_net`, no HTTP in their path), so the ordering rule costs nothing.

## 1. What the guarded code does (repository, once deployed)
`supabase/functions/_shared/notifications/outbound-guard.ts`: when the project reference in `SUPABASE_URL` is the Development project, **every** e-mail and SMS is redirected to hard-coded approved destinations (one phone number, three e-mail addresses) with `[DEV -> original]` prefixed to the subject or body; for any other project reference nothing is sent. The destinations are constants on purpose. **Owner: confirm those constants are the intended recipients** (a change is a reviewed commit and a redeploy). Local tests cover the decision logic.

## 2. Configuration checklist (names only; confirm each, never paste a value)
| # | Item | Where | Expected | How the owner confirms |
|---|---|---|---|---|
| C1 | Stripe secret key used by functions | Supabase Edge secret `STRIPE_SECRET_KEY` and `admin_settings.stripe_secret_key` | test mode (`sk_test_`) | Edge secrets page shows only a digest; check the Stripe dashboard is in **Test mode** and the key shown there matches by its first characters; `admin_settings` class already verified as test |
| C2 | Stripe publishable key in the frontend | Netlify site `bouncepartyclubdev` > Environment variables > `VITE_STRIPE_PUBLISHABLE_KEY` (4 values in 4 deploy contexts) | `pk_test_` in **every** context that can build `Dev` (at least Production and Branch deploys) | expand each context and read the first 8 characters |
| C3 | Stripe webhook | Stripe dashboard (**Test mode**) > Developers > Webhooks | one endpoint pointing at the Development `stripe-webhook` URL; `STRIPE_WEBHOOK_SECRET` is that endpoint's `whsec_` | endpoint list; no live-mode endpoint points at Development |
| C4 | Customer and payment-method ids copied from Production | database | live-mode ids; they simply fail with test keys ("no such customer"). **Never** make them work by switching to live keys | expected behavior, documented |
| C5 | Twilio account | `admin_settings` rows + Twilio console | owner states live or test credentials; sending is redirected to the approved number by the guard; cost is the owner's | Twilio console: Account SID class, message logs |
| C6 | Twilio callback URLs | Twilio console / `TWILIO_WEBHOOK_URL`, `TWILIO_STATUS_CALLBACK_URL` | Development function URLs (gate G-05) | console page |
| C7 | Resend | `admin_settings.resend_api_key` + Resend dashboard | sender domain verified; recipients limited by the guard | Resend logs |
| C8 | `SITE_URL`, `RETURN_ORIGINS` | Edge secrets | `https://dev.bouncepartyclub.com` only (gate G-06) | secrets page (names) |
| C9 | Google Maps key | Netlify `VITE_GOOGLE_MAPS_API_KEY` (5 values / 5 contexts) | referrer-restricted to the Development and Production domains | Google Cloud console |
| C10 | `pg_net` and DB triggers that call HTTP | database | absent on Development [LIVE: `pg_net` not installed; no signup/calendar HTTP triggers] so a migration or data refresh cannot send by itself | already verified |

## 3. Validation checklist before the first controlled test
| # | Check | Provider call? | PASS |
|---|---|---|---|
| V1 | Hosted `send-email` and `send-sms-notification` sources contain the guard (read-only `get_edge_function`; grep for the outbound-guard import) and their `verify_jwt` equals the JWT matrix | no | both |
| V2 | Relay called with only the anon key and with a customer token | **no** (must be refused before any provider call; read the function logs to confirm no Twilio/Resend request) | 401/403, no provider request in logs |
| V3 | C1-C3 confirmed in test mode; Stripe test dashboard open | no | all test |
| V4 | One controlled e-mail from a synthetic order | yes (redirected) | arrives only at an approved address with the `[DEV -> ...]` subject |
| V5 | One controlled SMS | yes (redirected) | arrives only at the approved number with the `[DEV -> ...]` prefix |
| V6 | One Stripe test checkout with `4242 4242 4242 4242` | Stripe test | event appears in **test** mode only; no live-mode event; refund in test mode |
| V7 | Webhook replay | Stripe test | idempotent, one ledger row |
| V8 | Twilio inbound signed test message | Twilio | valid accepted; invalid 403 |
**Stop at once** if any message reaches an unapproved recipient, any live-mode Stripe event appears, or Twilio bills unexpected volume: turn the relays off (redeploy the refusing version or revoke the credentials) and report.

## 4. Data and side-effect rules
- Use synthetic customers and orders. Do not enter a real card, ever; the only cards are Stripe's published test cards.
- Do not use a real customer's order id for any notification test, even though the guard redirects.
- Do not run the Production-to-Development refresh until: the guarded relays are deployed (V1), the demo account is handled (G-03), and the owner approves; the refresh tool has its own outbound guard tests.
- Migrations, bookkeeping batches and the executor make **no** provider call (verified: no `pg_net`, no HTTP in the 28 files' execution path).

## 5. Evidence to retain (no secrets)
Function version numbers and `ezbr_sha256` before and after, the `list_edge_functions` output, the Stripe test-mode event ids, the Twilio message SID prefix and status, the Resend message id, screenshots of the three console checks with values hidden.
