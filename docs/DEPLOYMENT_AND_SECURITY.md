# Deployment and Security

## Hosting

The frontend is deployed to Netlify. Build configuration is in `netlify.toml`:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20.17.0"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

The SPA redirect rule sends all paths to `index.html` so React Router handles client-side navigation.

A `vercel.json` is also present for optional Vercel deployment with the same SPA redirect behavior.

---

## Environment Variables — What Goes Where

### Frontend `.env` (safe to expose, VITE_ prefix)

These are public values embedded in the compiled JavaScript bundle. They are safe to expose.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anon key |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps API key |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (used as local dev fallback in `StripeCheckoutForm.tsx`) |

### Backend Secrets — Stored in `admin_settings` Table (NEVER in env vars)

The following secrets are stored as rows in the `admin_settings` database table and read at runtime by edge functions. This pattern keeps all secrets server-side and allows them to be updated from the admin panel without redeployment.

| Setting Key | Purpose |
|---|---|
| `stripe_secret_key` | Stripe secret key for server-side API calls |
| `stripe_publishable_key` | Stripe publishable key (served to frontend via `get-stripe-publishable-key` edge function) |
| `stripe_webhook_secret` | Stripe webhook signing secret |
| `twilio_account_sid` | Twilio account SID |
| `twilio_auth_token` | Twilio auth token |
| `twilio_from_number` | Twilio sending phone number |
| `resend_api_key` | Resend API key for email |
| `admin_email` | Admin notification email address |
| `admin_phone` / `admin_notification_phone` | Admin notification phone number |
| `google_maps_api_key` | Google Maps API key (also available as VITE_ env for frontend) |
| `google_oauth_client_id` | Google OAuth client ID (used for Google Sign-In button) |
| `google_oauth_client_secret` | Google OAuth client secret (server-side only) |
| `google_calendar_client_id` | Google Calendar OAuth client ID |
| `google_calendar_client_secret` | Google Calendar OAuth client secret |
| `google_calendar_refresh_token` | Long-lived refresh token |
| `google_calendar_id` | Target calendar ID |
| `google_calendar_enabled` | Toggle calendar sync on/off (`'true'` / `'false'`) |
| `google_review_url` | Google Review page URL |
| `google_maps_url` | Google Maps listing URL for the business |
| `supabase_url` | Supabase project URL (used at runtime by edge functions that cannot access env vars) |
| `home_address_line1` | Business home base street address line 1 for travel fee origin |
| `home_address_line2` | Business home base street address line 2 |
| `home_address_city` | Business home base city |
| `home_address_state` | Business home base state |
| `home_address_zip` | Business home base ZIP code |
| `home_address_lat` | Home base latitude (decimal) |
| `home_address_lng` | Home base longitude (decimal) |
| `home_base_radius_miles` | Free-travel radius in miles from home base |
| `travel_fee_per_mile` | Per-mile rate in dollars charged beyond free radius |
| `apply_travel_fee_by_default` | Whether travel fees are auto-applied on new orders (`'true'` / `'false'`) |
| `use_business_address_for_travel` | Use home address for travel calculations instead of stored coordinates |
| `carousel_show_arrows` | Whether navigation arrows appear on the homepage carousel |
| `apply_taxes_by_default` | Whether tax is applied by default on new orders (`'true'` / `'false'`) |
| `business_name` | Business display name |
| `business_name_short` | Short business name (for compact displays) |
| `business_legal_entity` | Legal entity name (for waivers and invoices) |
| `business_address` | Full business address |
| `business_phone` | Business contact phone number |
| `business_email` | Business contact email address |
| `business_website` | Business website URL |
| `business_license_number` | License number for legal documents |
| `logo_url` | URL to the business logo (used in all emails and portal) |
| `favicon_url` | URL to the favicon |
| `brand_primary_color` | Hex color for branding (e.g., `#3b82f6`) |
| `facebook_url` | Facebook page URL |
| `instagram_url` | Instagram profile URL |
| `tiktok_url` | TikTok profile URL |
| `youtube_url` | YouTube channel URL |
| `yelp_url` | Yelp business listing URL |

**Do not add these to Netlify's environment variables panel, `.env`, or any other frontend-accessible location.** They are only readable by Supabase edge functions running server-side with the service role key.

### Edge Function Secrets (Supabase dashboard only)

Supabase edge functions have access to these automatically injected variables:

- `SUPABASE_URL` — automatically injected
- `SUPABASE_ANON_KEY` — automatically injected
- `SUPABASE_SERVICE_ROLE_KEY` — automatically injected
- `SUPABASE_DB_URL` — automatically injected

These are never set manually — Supabase provides them to every edge function automatically.

---

## Row Level Security (RLS)

Every table has RLS enabled. The general policy model:

| Operation | Who can perform it |
|---|---|
| SELECT own orders | Authenticated customer (matches `user_id` or email) |
| SELECT all orders | Admin / master / crew |
| INSERT orders | Anonymous (quote submission) and authenticated |
| UPDATE order status | Admin / master (via RPC or direct update) |
| UPDATE own profile | Authenticated customer |
| DELETE | Admin / master only (select tables) |

RLS policies use `auth.uid()` (never `current_user`) for user identification.

All admin access checks use the `get_user_role()` database function to avoid circular dependency issues in policy evaluation.

### RLS Policy Naming Convention

All policies use lowercase role names (`authenticated`, `anon`) and explicit `FOR SELECT`, `FOR INSERT`, `FOR UPDATE`, or `FOR DELETE` policy types. The `FOR ALL` shorthand is never used. Policy names are descriptive strings that explain the access rule.

---

## Stripe Webhook Security

The `stripe-webhook` edge function enforces:

1. The `stripe_webhook_secret` must be present in `admin_settings`. If absent, the function returns 500 — it does not fall back to unverified mode.
2. Every incoming request is verified using Stripe's `constructEvent()` with the webhook signing secret. Invalid signatures return 400.
3. Idempotency: every processed webhook event ID is stored in `stripe_webhook_events`. Duplicate events are silently discarded.

The `stripe_webhook_events` table tracks each event with `status` (`processed`, `failed`, `skipped`), `attempts` count, and `last_error` for operational visibility. This enables admins to identify stuck or repeatedly-failing webhook events without digging through edge function logs.

---

## Rate Limiting

Key entry points are rate-limited using the `checkRateLimit()` utility (`supabase/functions/_shared/rate-limit.ts`). Rate limit state is stored in the `rate_limits` database table.

Protected endpoints:
- Stripe checkout session creation (per order ID + IP)
- Payment recording
- Email sending

The rate limiter uses a sliding-window approach. On each request it reads `(identifier, endpoint)` from the `rate_limits` table, increments the counter, and sets a `blocked_until` timestamp when the threshold is exceeded.

A `cleanup_old_rate_limits()` database function purges expired rate limit rows. This should be called periodically (e.g., via a scheduled job) to prevent the `rate_limits` table from growing unbounded.

---

## Admin Settings Security

The `admin_settings_changelog` table logs every change to settings. Secret values (Stripe keys, Twilio credentials, Resend API key) are automatically redacted in the changelog by a database trigger — only the key name is recorded, not the value. The redaction trigger (`redact_sensitive_changelog_values`) substitutes `[REDACTED]` for any key whose name contains `key`, `secret`, `token`, `sid`, or `password`.

---

## Storage Buckets

| Bucket | Public? | Who Can Write | Purpose |
|---|---|---|---|
| `public-assets` | Yes | Admin only | Logo, favicon, branding assets |
| `carousel-media` | Yes | Admin only | Homepage carousel images/videos |
| `unit-images` | Yes | Admin only | Rental unit catalog photos |
| `signed-waivers` | No | Edge function only | Stored signed waiver PDFs |
| `physical-waivers` | No | Edge function only (`upload-physical-waiver`) | Admin-uploaded paper/physical waiver images; service role required; never directly accessible by frontend |
| `order-pictures` | Yes | Crew / authenticated | Delivery proof and damage photos |
| `lot-pictures` | No | Crew / authenticated | Pre-event lot assessment photos |

---

## Security Audit Trail

Three overlapping audit systems provide non-repudiation:

### Order Changelog (`order_changelog`)

Records every meaningful state change on an order:
- Status transitions (with actor user ID)
- Payment events
- Admin edits (field-by-field with old/new values)
- Customer approval/rejection actions
- Admin notes
- Cancellation with reason

### User Permissions Changelog (`user_permissions_changelog`)

Records every role grant and revoke:
- Actor email embedded at write time (so historical records remain accurate even if the actor's email changes)
- `target_user_id`, `changed_by_user_id`, `action` (granted/revoked), `old_role`, `new_role`

### Transaction Receipts (`transaction_receipts`)

Immutable financial log of every payment event with unique receipt numbers. Cannot be updated or deleted after creation. Supports `receipt_group_id` for grouping related transactions (e.g., deposit + tip from same charge).

---

## Role Escalation Prevention

The `user_roles` table uses RLS to prevent self-elevation:

- Only `master` role users can assign or revoke `admin` or `master` roles.
- `admin` users can manage `crew` and `customer` roles.
- Customers cannot modify their own roles.
- No user can assign a role higher than their own.

All role changes are logged via the `log_permission_change` trigger with the actor's email embedded at write time.

---

## Notification Failure Tracking

The `notification_failures` table logs every failed email or SMS send. The `notification_system_status` table tracks real-time health per system type:
- `is_operational` flag
- `consecutive_failures` count
- `total_failures_24h`
- `last_success_at`, `last_failure_at`
- `admin_notified_at` — prevents duplicate admin alerts

When 3+ consecutive failures occur, the admin is automatically alerted. The admin Notification Failures panel allows viewing and resolving failures.

---

## SMS Thread Integrity

All outbound SMS messages sent via `send-sms-notification` must pass `orderId` (camelCase) in the request body. The edge function uses this to link the `sms_conversations` record to the order. Messages sent without an `orderId` are saved with `order_id = null` and will not appear in any order's SMS thread. The delivery checkpoint messages (En Route, Arrived, Drop-off Complete) are sent with `orderId` explicitly to ensure thread visibility.

---

## Input Validation and Sanitization

- Email addresses and phone numbers are validated client-side via `src/lib/validation.ts`. Phone validation requires exactly 10 digits after stripping non-digits (no international support).
- Payment amounts are validated server-side in `_shared/payment-validation.ts`
- Order status transitions are validated by the `validate_order_status_transition` database function — invalid transitions are rejected with an error before any change is made
- All RPC functions that require elevated privilege run with `SECURITY DEFINER` and explicit `search_path` set to prevent schema injection
- The `check_date_blackout` function correctly handles wrap-aware annual recurrence patterns (date ranges that span year-end)

---

## Consent Compliance

The application maintains a complete, auditable record of every consent given (or declined) by customers for:
- **SMS marketing** — consent to receive SMS messages from the business
- **Card on file** — consent to save a card for future charges

Consent is captured in two stages:

1. **Pre-auth staging (`pending_signups_consent`)** — consent given during checkout before the customer has an account is stored with a `batch_id` UUID so it can be matched to the account after signup.
2. **Permanent log (`user_consent_log`)** — after sign-in, the `record-consent` edge function drains pending consent into this table. The unique index on `(user_id, consent_batch_id, consent_type)` prevents duplicate entries even if the drain fires from multiple tabs.

Each consent record stores: `user_id`, `customer_id`, `consent_type`, `consented` (bool), `policy_version`, `source` (checkout, signup, etc.), `consent_batch_id`, `ip_hint`, and `user_agent_hint`.

---

## Auth Trigger Debugging

Every execution of the `handle_new_user` Postgres trigger (which fires on new user creation) is logged to the `auth_trigger_logs` table. This table records:
- `user_id` — the new user's UUID
- `event` — the trigger event type
- `message` — status message or error
- `created_at` — timestamp

This provides a persistent debug trail for diagnosing signup failures, OAuth profile merge issues, or role assignment errors without needing to inspect edge function or Supabase Auth logs.

---

## Role Management Security

All role changes go through RPCs that enforce the role hierarchy at the database level:

- `assign_role_by_email` and `assign_user_role` check that the caller's role is at or above the target role being assigned
- `remove_user_role` enforces the same hierarchy for revocations
- Every insert/delete in `user_roles` fires the `log_permission_change` trigger, embedding the actor's email at write time for an immutable audit trail

The `user_permissions_changelog` table retains a full history of all role grants and revocations, which remains accurate even if the actor's email address is later changed.

---

## Payment Race-Condition Safety

Two independent safety mechanisms prevent double-charging:

### Deposit Charging (`charge-deposit`)
Uses a sentinel value `deposit_paid_cents = -1`. The update only succeeds if the current value is `<= 0`. Exactly one concurrent caller wins; others receive a 409 response. The sentinel is released if the charge fails before Stripe is called.

### Balance Payment Reconciliation (`reconcile-balance-payment` + `apply_balance_payment_financials` RPC)
Uses the unique constraint on `payments.stripe_payment_intent_id` as a distributed mutex. Concurrent callers invoke the `apply_balance_payment_financials` RPC, which atomically checks and sets the `order_financials_applied` flag. Only the first caller to set the flag applies the financial update to the order.
