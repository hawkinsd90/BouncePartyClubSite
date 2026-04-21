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

---

## Environment Variables — What Goes Where

### Frontend `.env` (safe to expose, VITE_ prefix)

These are public values embedded in the compiled JavaScript bundle. They are safe to expose.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anon key |
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps API key |

**Note:** The Stripe publishable key is NOT stored in env vars. It is read at runtime from `admin_settings` via the `get-stripe-publishable-key` edge function. Do not add `VITE_STRIPE_PUBLISHABLE_KEY` to the environment.

### Backend Secrets — Stored in `admin_settings` Table (NEVER in env vars)

The following secrets are stored as rows in the `admin_settings` database table and read at runtime by edge functions:

| Setting Key | Purpose |
|---|---|
| `stripe_secret_key` | Stripe secret key for server-side API calls |
| `stripe_webhook_secret` | Stripe webhook signing secret |
| `twilio_account_sid` | Twilio account SID |
| `twilio_auth_token` | Twilio auth token |
| `twilio_from_number` | Twilio sending phone number |
| `admin_email` | Admin notification email address |
| `admin_phone` | Admin notification phone number |

**Do not add these to Netlify's environment variables panel, `.env`, or any other frontend-accessible location.** They are only readable by Supabase edge functions running server-side with the service role key.

### Edge Function Secrets (Supabase dashboard only)

Supabase edge functions have access to:

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

---

## Stripe Webhook Security

The `stripe-webhook` edge function enforces:

1. The `STRIPE_WEBHOOK_SECRET` environment secret must be present. If absent, the function returns 500 — it does not fall back to unverified mode.
2. Every incoming request is verified using Stripe's `constructEvent()` with the webhook signing secret. Invalid signatures return 400.
3. Idempotency: every processed webhook event ID is stored. Duplicate events are silently discarded.

---

## Rate Limiting

Key entry points are rate-limited using the `checkRateLimit()` utility (`supabase/functions/_shared/rate-limit.ts`). Rate limit state is stored in the database.

Protected endpoints:
- Stripe checkout session creation (per order)
- Payment recording
- Email sending

---

## Admin Settings Security

The `admin_settings_changelog` table logs every change to settings. Secret values (Stripe keys, Twilio credentials) are redacted in the changelog — only the key name is recorded, not the value.

---

## Storage Buckets

| Bucket | Public | Write Access | Purpose |
|---|---|---|---|
| `public-assets` | Yes | Admin/master only | Logo, branding assets |
| `carousel-media` | Yes | Admin/master only | Homepage carousel images and videos |
| `unit-images` | Yes | Admin/master only | Rental unit photos |
| `signed-waivers` | Yes | Edge function (`save-signature`) | Signed waiver PDFs |
| `order-pictures` | Yes | Crew (authenticated) | Delivery and damage photos |
| `lot-pictures` | No | Crew (authenticated + anonymous with order token) | Pre-event lot condition photos |
| `signatures` | Yes | Edge function (`save-signature`) | Signature pad images |

All buckets except `lot-pictures` are public (no auth required to view). The `lot-pictures` bucket requires authenticated access or a valid anonymous upload token.

---

## Public Settings RPC

The `get_public_business_settings()` SECURITY DEFINER function is the safe mechanism for reading a whitelisted subset of `admin_settings` without admin credentials. It runs as the `postgres` role, bypassing RLS, and returns only 12 non-secret keys (business name, phone, email, address, social URLs). This is called by public-facing components (`Layout`, `PrintableInvoice`, `PaymentSuccessState`) to display live business settings to unauthenticated users.

---

## Security Audit Trail

The `order_changelog` table records every meaningful state change on an order including:

- Status transitions (with actor user ID)
- Payment events
- Admin notes
- Customer approval / rejection actions

This provides a full non-repudiation audit trail for every order.

---

## Role Escalation Prevention

The `user_roles` table uses RLS to prevent self-elevation:

- Only `master` role users can assign or revoke `admin` or `master` roles.
- `admin` users can manage `crew` and `customer` roles.
- Customers cannot modify their own roles.

All role changes are logged via the `log_permission_change` trigger with the actor's email embedded at write time.
