# Architecture

## Overview

The application is a React single-page app backed entirely by Supabase (Postgres database + Deno edge functions). There is no separate API server. All business logic runs either in the browser or in Supabase edge functions. The frontend communicates with the database through the Supabase JS client and through edge function HTTP calls.

---

## Provider Stack

`App.tsx` wraps the entire application in a nested provider hierarchy. Order matters — inner providers can consume outer ones.

```
ErrorBoundary
  BrowserRouter
    BusinessProvider       — loads admin_settings into context (business name, address, branding, etc.)
      AuthProvider         — manages user session, roles, OAuth, consent draining
        CustomerProfileProvider  — loads customer profile data for logged-in customers
          Routes / Pages
```

### BusinessProvider (`src/contexts/BusinessContext.tsx`)

Loaded once on app mount. Reads the `admin_settings` table and exposes:
- `businessName`, `businessNameShort`, `businessLegalEntity`
- `businessAddress`, `businessPhone`, `businessEmail`, `businessWebsite`
- `businessLicenseNumber`
- `logoUrl`, `faviconUrl`, `brandPrimaryColor`
- Social media URLs (Facebook, Instagram, TikTok, YouTube, Yelp)
- `googleReviewUrl`, `googleMapsUrl`

Used throughout for display, email templates, and dynamically generated waiver text.

### AuthProvider (`src/contexts/AuthContext.tsx`)

Manages authentication state and exposes:

```typescript
{
  user: User | null
  role: string | null        // primary role (first found in user_roles)
  roles: string[]            // all assigned roles
  loading: boolean
  isAdmin: boolean
  isMaster: boolean
  signIn(email, password): Promise<void>
  signInWithGoogle(): Promise<void>
  signInWithApple(): Promise<void>
  signUp(email, password, metadata): Promise<void>
  signOut(): Promise<void>
  hasRole(role): boolean
}
```

On every auth state change to `SIGNED_IN`, AuthProvider also runs the consent draining flow (see AUTH_AND_ROLES.md).

### CustomerProfileProvider (`src/contexts/CustomerProfileContext.tsx`)

Loads the logged-in customer's profile data and exposes it for prefilling the quote/checkout forms. Implements retry logic (up to 6 attempts, 800ms apart) to handle the delay between auth signup and profile creation by the Postgres trigger.

Exposes:
- `customerProfile` — the `customers` record linked to the current user
- `defaultAddress` — customer's previously saved address
- `sessionData` — ephemeral form data for the current quote/checkout session
- `updateSessionData(partial)` — updates session data

---

## Routing

Routes are defined in `App.tsx` using React Router v6. Components are lazy-loaded to minimize initial bundle size.

### Public Routes (no auth required)

| Path | Page |
|---|---|
| `/` | Home |
| `/catalog` | Unit catalog |
| `/units/:id` | Unit detail |
| `/quote` | Quote / booking form |
| `/checkout/:orderId` | Checkout (Stripe payment) |
| `/payment-complete` | Post-payment confirmation |
| `/payment-canceled` | Payment canceled |
| `/invoice/:token` | Customer invoice view (tokenized, no login required) |
| `/customer-portal` | Customer self-service portal (tokenized, no login required) |
| `/i/:shortCode` | Short link redirect — resolves `short_code` from `invoice_links` table and redirects to `/customer-portal/:orderId?t=:token` |
| `/receipt/:orderId/:paymentId` | Payment receipt |
| `/sign/:orderId` | Electronic waiver signing |
| `/menu-preview` | Unit menu (printable) |
| `/login` | Login |
| `/signup` | Sign up |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset form |
| `/setup` | First-time admin setup |
| `/contact` | Contact page |
| `/about` | About page |

### Protected Routes

| Path | Required Role(s) |
|---|---|
| `/my-orders` | customer, admin, crew, master |
| `/admin` | admin, master |
| `/admin/inventory/*` | admin, master |
| `/crew` | admin, crew, master |
| `/crew/*` | admin, crew, master |

`ProtectedRoute` in `src/components/common/ProtectedRoute.tsx` handles enforcement. Unauthenticated users are redirected to `/login`. Authenticated users without the required role see an "Access Denied" screen.

---

## Database Tables

All tables live in the `public` schema. Confirmed from live database:

| Table | Purpose |
|---|---|
| `address_lot_pictures` | Lot photos saved directly to a canonical address record, linking future deliveries to known setup-location photos |
| `addresses` | Canonical address records with lat/lng geocoding and a unique `address_key` for deduplication |
| `admin_settings` | Key-value store for all runtime configuration (Stripe keys, Twilio credentials, branding, pricing, etc.) |
| `admin_settings_changelog` | Audit log of settings changes; secret values are automatically redacted by trigger |
| `auth_trigger_logs` | Debugging log for Postgres auth trigger execution steps |
| `billing_addresses` | Billing address records collected at Stripe checkout (separate from event/delivery addresses) |
| `blackout_addresses` | Specific delivery addresses blocked from new bookings |
| `blackout_contacts` | Specific customers (by email or phone) blocked from placing orders |
| `blackout_dates` | Date ranges blocking all new bookings; supports `one_time`, `weekly`, and `annual` recurrence with optional expiration |
| `consent_records` | Per-order SMS and card-on-file consent records with IP and user agent |
| `contacts` | Deduplicated phonebook — one record per unique customer across all orders; maintains lifetime stats via triggers |
| `crew_location_history` | GPS breadcrumbs from crew members during deliveries (lat/lng, accuracy, speed, heading) |
| `customer_profiles` | Extended profile linked to auth users (notification preferences, name) |
| `customers` | Customer records linked to orders and optionally to auth users (`user_id` FK, `default_address_id`, `oauth_provider`, `oauth_profile_data`) |
| `daily_mileage_logs` | Crew odometer readings for gas mileage expense tracking per shift |
| `documents` | General document storage (kind + url + optional metadata JSON) |
| `email_templates` | Admin-managed email template content by category (configurable subject, header, body, theme) |
| `google_calendar_sync` | Per-event-date record of last Google Calendar sync state and event ID |
| `google_calendar_sync_queue` | Queue of pending calendar sync operations triggered by order status changes |
| `google_reviews` | Admin-managed customer review records displayed on the homepage |
| `hero_carousel_images` | Homepage carousel media entries (images and videos) with display order |
| `invoice_links` | Secure tokenized links for customer invoice/portal access. Contains a 64-char hex `link_token` for direct URL access and an optional 8-char alphanumeric `short_code` for compact SMS links. The `link_type` column (`invoice` or `portal_shortlink`) distinguishes creation context. |
| `invoices` | Invoice records with status tracking (`draft`, `sent`, `partial`, `paid`, `void`) |
| `messages` | All SMS messages (inbound and outbound) per customer phone number |
| `notification_failures` | Log of email/SMS send failures with recipient, error, and resolution status |
| `notification_system_status` | Real-time health status of email and SMS subsystems with consecutive failure counts |
| `order_changelog` | Full audit trail of every edit, status change, payment, and cancellation on an order |
| `order_custom_fees` | Admin-added custom fee line items on an order |
| `order_discounts` | Discount line items applied to an order (fixed amount or percentage) |
| `order_items` | Rental units included in an order with price snapshot and wet/dry mode |
| `order_lot_pictures` | Photos of the event lot submitted before/after setup; includes an `address_id` FK for linking to canonical address records |
| `order_notes` | Internal admin-only notes on an order |
| `order_pictures` | General order photos (delivery, damage) stored in `order-pictures` bucket |
| `order_refunds` | Refund records linked to Stripe refund IDs |
| `order_signatures` | ESIGN-compliant waiver signatures with full waiver text snapshot, IP, user agent, device info, signer home/event address, initials, and typed name |
| `order_workflow_events` | Crew workflow events (en route, arrived, setup complete, etc.) with optional GPS and ETA |
| `orders` | The central order record — all bookings live here (see Orders table section below) |
| `payments` | Payment ledger records with `ledger_sequence`, Stripe fee breakdown (`stripe_fee_amount`, `stripe_net_amount`), brand/last4, and `order_financials_applied` flag |
| `pending_signups_consent` | Temporary staging table for pre-signup consent (drained to `user_consent_log` after auth) |
| `pricing_rules` | Single-row pricing configuration (zones, fees, multipliers, deposit settings, tax toggle) |
| `rate_limits` | Per-identifier request rate limiting with sliding window |
| `route_stops` | Ordered delivery/pickup stops for a day's route with ETA calculations |
| `saved_discount_templates` | Admin-saved discount presets for quick application |
| `saved_fee_templates` | Admin-saved custom fee presets for quick application |
| `site_events` | Analytics event log (page views, quote starts, booking completions, referral sources, etc.) |
| `sms_conversations` | Inbound/outbound SMS thread per order; `is_admin_internal` flag marks internal crew messages |
| `sms_message_templates` | Admin-managed SMS message templates with variable substitution |
| `stripe_webhook_events` | Idempotency log for processed Stripe webhook events |
| `task_status` | Crew task cards — one per confirmed order per task type — tracking day-of workflow with JSONB `delivery_images` and `damage_images` arrays |
| `transaction_receipts` | Immutable financial audit log with unique receipt numbers and `receipt_group_id` for grouped multi-type charges |
| `unit_media` | Images and videos for each rentable unit with `mode` (dry/wet), `visibility_mode`, and `is_featured` flag |
| `units` | Inventory — each bounce house, water slide, or combo unit with `types` array and `active` boolean |
| `user_consent_log` | Permanent record of user consent decisions (SMS, card-on-file) with batch idempotency |
| `user_permissions_changelog` | Audit log of all role grant/revoke actions with actor email embedded at write time |
| `user_roles` | Role assignments per auth user (master, admin, crew, customer) |

### Orders Table — Key Columns

The `orders` table is the most complex record in the system. Notable columns beyond the obvious:

| Column | Purpose |
|---|---|
| `workflow_status` | Crew operational status (separate from order `status`) |
| `referral_source` / `referral_source_detail` | How the customer found the business (e.g., `social`, `google`) and the sub-detail (e.g., `instagram`) |
| `billing_address_line1–zip` | Billing address captured from Stripe (stored inline, separate from event address) |
| `travel_is_flat_fee` | Whether travel fee was applied as a flat ZIP-code zone rate vs. per-mile |
| `custom_deposit_cents` | Admin-overridden deposit amount (overrides percentage-based calculation) |
| `require_card_on_file` | Whether checkout must save a card even if no immediate charge |
| `admin_message` | Admin-written message visible to the customer in the portal |
| `same_day_responsibility_accepted` / `overnight_responsibility_accepted` | Customer acceptance of equipment responsibility clauses |
| `booking_confirmation_sent` | Prevents duplicate confirmation emails |
| `pending_review_admin_alerted` / `confirmed_admin_alerted` | Deduplication flags for admin notifications |
| `generator_qty` | Number of generators requested (integer; separate from the boolean `generator_selected`) |
| `clear_payment_info` | Signals that saved Stripe payment method should be cleared (set when items change or deposit increases) |
| `current_eta` | Current crew ETA timestamp, updated as route progresses |
| `waiver_signature_data` | Raw signature canvas data (stored for audit before PDF is generated) |
| `e_signature_consent` | Whether the electronic consent checkbox was accepted during waiver signing |
| `deposit_required` | Whether a deposit is required for this order |
| `damage_charged_cents` | Amount charged for equipment damage |
| `stripe_payment_status` | Stripe-specific payment status; set to `'paid'` even for zero-deposit approvals to signal the payment obligation is satisfied |
| `order_financials_applied` (on `payments`) | Whether `deposit_paid_cents`/`balance_paid_cents` on the order have been updated for this payment |

---

## Query Layer

All database calls go through the centralized query layer in `src/lib/queries/`. Direct Supabase client calls in components or hooks are avoided.

### `executeQuery<T>()` — `src/lib/queries/base.ts`

Every query is wrapped in this function:

```typescript
executeQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  context?: string,
  options?: { throws?: boolean }
): Promise<{ data: T | null; error: any }>
```

It standardizes error logging, optional throwing, and returns a consistent `{ data, error }` shape.

### Query Modules

| Module | File | Purpose |
|---|---|---|
| Orders | `queries/orders.ts` | Full order CRUD, status updates, list views |
| Customers | `queries/customers.ts` | Customer lookup, upsert, linking to auth users |
| Contacts | `queries/contacts.ts` | Phonebook operations, loyalty stats |
| Units | `queries/units.ts` | Inventory queries, availability |
| Pricing | `queries/pricing.ts` | `pricing_rules` table read/write |
| Payments | `queries/payments.ts` | Payment record queries and ledger operations |
| Invoices | `queries/invoices.ts` | Invoice and invoice link queries |
| Tasks | `queries/tasks.ts` | `task_status` table queries for crew |

### Standard Select Shapes

Two reusable select strings are defined in `base.ts`:

- **`STANDARD_ORDER_SELECT`** — Full nested join: customers, addresses, order_items with units, payments, discounts, custom_fees. Used wherever a complete order object is needed.
- **`COMPACT_ORDER_SELECT`** — Minimal join: customers and addresses only. Used in list views.

Always use `maybeSingle()` (not `single()`) when fetching zero or one row.

---

## Order Status Model

Orders move through two independent status dimensions:

### Order Status (`src/lib/constants/statuses.ts`)

```
draft → pending_review → awaiting_customer_approval → confirmed → in_progress → completed
                                                                          ↘ cancelled
                                                                          ↘ void
```

| Status | Meaning |
|---|---|
| `draft` | Created but not yet submitted |
| `pending_review` | Customer submitted; awaiting admin action |
| `awaiting_customer_approval` | Admin sent modified order back for customer review |
| `confirmed` | Admin approved; deposit charged or waived |
| `in_progress` | Crew is actively delivering/setting up |
| `completed` | Event finished, pickup done |
| `cancelled` | Cancelled by admin or customer |
| `void` | Administratively voided (no charge) |

Valid transitions are enforced by the `validate_order_status_transition` database function. Invalid transitions return an error. The same-status "transition" (no change) is always permitted.

### Workflow Status (crew operations, stored on `orders.workflow_status`)

```
pending → on_the_way → arrived → setup_in_progress → setup_completed
        → pickup_scheduled → pickup_in_progress → completed
```

Tracks the crew's physical progress on event day, independent of order lifecycle status.

### Payment Status (derived)

Computed from order amounts, not stored directly, via `getPaymentStatus(order)` in `src/lib/constants/statuses.ts`:

- `payment_due` — No deposit collected (`deposit_paid_cents === 0`)
- `deposit_paid` — Deposit collected, balance remaining
- `paid_in_full` — Total collected equals total due

---

## All-Cents Convention

Every monetary value in the database and throughout the codebase is stored in **cents** (integer). There are no decimal dollar amounts in the data layer. Display formatting is handled at the UI layer only.

---

## Database Migrations

Migrations live in `supabase/migrations/` and are applied sequentially by timestamp prefix. Each migration begins with a multi-line comment block summarizing the change.

Rules:
1. Name files `YYYYMMDDHHMMSS_short_description.sql`
2. Begin with a `/* */` comment block: what changed, why, new tables/columns, security notes
3. Use `IF EXISTS` / `IF NOT EXISTS` on all DDL
4. Every new table must immediately have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
5. Never use `DROP` on columns or tables — use nullable additions or soft-delete patterns
6. Never use `BEGIN` / `COMMIT` / `ROLLBACK` — Supabase runs migrations in auto-commit mode

---

## Edge Functions

Edge functions live in `supabase/functions/`. Each is a standalone Deno module. Shared utilities live in `supabase/functions/_shared/`.

### Shared Utilities (`_shared/`)

| File | Purpose |
|---|---|
| `cors.ts` | Standard CORS headers (`Access-Control-Allow-Origin: *`) for all responses |
| `admin-settings.ts` | Helper to read `admin_settings` key-value table |
| `format-order-id.ts` | Canonical order ID formatting — first 8 chars of UUID uppercased (e.g., `D2BD1A2F`) |
| `fmt.ts` | Currency and date formatting utilities for edge function templates |
| `payment-validation.ts` | Shared payment amount validation logic |
| `payment-receipt-email.ts` | Shared HTML receipt email builder used by multiple payment functions |
| `rate-limit.ts` | Per-identifier sliding-window rate limiting via `rate_limits` table |
| `transaction-logger.ts` | Transaction receipt creation and admin notification; supports grouped receipts via `receipt_group_id` |
| `webhook-idempotency.ts` | Stripe webhook deduplication via `stripe_webhook_events` table |

All edge functions handle CORS preflight (`OPTIONS`) and include CORS headers on every response.

### Complete Edge Function Reference

| Function | JWT Required | Purpose |
|---|---|---|
| `auth-email-hook` | No | Sends branded signup/password-reset emails via Resend (Supabase auth hook) |
| `backfill-oauth-customers` | Yes | Data migration: ensures all Google OAuth users have customer records |
| `backfill-payment-methods` | Yes | Data migration: reconciles Stripe payment method records; fills `payment_brand`/`last_four` from Stripe API |
| `calculate-route-mileage` | Yes | Computes total miles for a day's route from `route_stops` |
| `charge-deposit` | Yes | Charges saved payment method for deposit or balance. Uses a sentinel value (`deposit_paid_cents = -1`) for atomic race-condition safety. Called during order approval and day-of balance collection. |
| `checkout-bridge` | No | Orchestration layer between checkout completion and order lifecycle progression |
| `create-admin-user` | Yes | Bootstraps the first master user during initial setup |
| `customer-balance-payment` | No | Allows customers to pay remaining balance via saved card on file or a new Stripe Checkout session |
| `customer-cancel-order` | No | Handles customer-initiated cancellation with reason and refund-request flag |
| `fix-payment-method` | No | Allows customer to update a saved card after a declined charge |
| `generate-signed-waiver` | No | Generates a downloadable signed waiver PDF |
| `get-payment-method` | Yes | Returns customer's saved payment method details |
| `get-session-metadata` | No | Returns customer session data for form prefill |
| `get-stripe-publishable-key` | No | Returns Stripe publishable key (read from `admin_settings`) |
| `get-user-info` | Yes | Returns authenticated user's profile and role information; also used by analytics to resolve crew display names |
| `get-waiver-status` | No | Checks if an order has a signed waiver and returns PDF URL |
| `order-lifecycle` | No | Authoritative handler for order status transitions; sends admin SMS/email for `enter_pending_review` and `enter_confirmed` actions with idempotency guards |
| `promote-media` | Yes | Copies a photo from one source (lot, order, delivery) to the unit gallery or homepage carousel; re-verifies delivery URLs exist before promotion; requires `consent_confirmed: true` |
| `reconcile-balance-payment` | No | Verifies Stripe session on checkout return; uses `apply_balance_payment_financials` RPC with `order_financials_applied` flag for race-condition-safe idempotency |
| `record-cash-payment` | Yes | Admin records a cash payment (atomic RPC + receipt logging) |
| `record-check-payment` | Yes | Admin records a check payment with check number stored in `payments.notes` |
| `record-consent` | Yes | Permanently records or revokes user consent (drain-pending, record, revoke) |
| `save-payment-method-from-session` | Yes | Saves Stripe payment method details after successful checkout session |
| `save-pending-consent` | No | Stores pre-signup consent in staging table |
| `save-signature` | No | Records waiver signature with full audit data; generates PDF asynchronously; sends email confirmation with PDF attachment |
| `save-signup-address` | No | Saves customer's home address submitted during signup |
| `send-email` | Yes | Sends email via Resend with fallback SMS to admin on failure |
| `send-error-notification` | No | Sends admin alert for application errors |
| `send-invoice` | Yes | Generates and distributes invoice to customer via email/SMS; creates `invoice_links` record with both a 64-char token and 8-char short code; resolves origin from request header or env `SITE_URL` |
| `send-sms-notification` | Yes | Sends SMS via Twilio; logs to `sms_conversations` if `orderId` (camelCase) provided |
| `stripe-charge` | Yes | Direct Stripe charge (admin-initiated, outside checkout flow) |
| `stripe-checkout` | Yes | Creates Stripe Checkout Session or Payment Intent; enforces rate limiting per order; performs server-side blackout check |
| `stripe-refund` | Yes | Issues Stripe refund and records in `order_refunds` |
| `stripe-webhook` | No | Processes Stripe webhook events with signature verification and idempotency; handles: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `setup_intent.succeeded` |
| `sync-google-calendar` | Yes | Syncs confirmed orders to Google Calendar (inactive until Google credentials configured) |
| `twilio-status-callback` | No | Receives SMS delivery status updates from Twilio |
| `twilio-webhook` | No | Receives inbound SMS from customers and routes to conversations |

---

## Pricing Calculation

Pricing is computed in `src/lib/pricing.ts` using rules fetched from the `pricing_rules` table.

**Calculation order:**

1. Day 1 subtotal — sum of `(unit_price × qty × locationMultiplier)` for each item. Location multiplier is either `residential_multiplier` or `commercial_multiplier`.
2. Extra day charges — `day1Subtotal × (extra_day_pct / 100) × (numDays - 1)`
3. Travel fee (see `travelFeeCalculator.ts`)
4. Surface fee — charged when surface is `cement` OR (`grass` AND stakes cannot be used). Amount: `surface_sandbag_fee_cents`.
5. Same-day pickup fee — charged when `location_type === 'commercial'` OR `overnight_allowed === false`. Amount: `same_day_pickup_fee_cents`.
6. Generator fee — single generator: `generator_fee_single_cents` (fallback to `generator_price_cents`, default $100). Two or more: first at single price, each additional at `generator_fee_multiple_cents` (default $75).
7. Tax — 6% (hardcoded) on (subtotal + travel + surface + generator fees), only if `apply_taxes_by_default` is enabled.
8. Deposit — `quantity_of_units × deposit_per_unit_cents` (default $50/unit). Admin can override with `custom_deposit_cents`.
9. Balance due — `Math.max(0, total_cents - deposit_due_cents)`

Any fee can be administratively waived with a documented reason. Waived fees are stored as boolean flags + reason text on the `orders` record.

**Note:** The `same_day_matrix_json` column exists on `pricing_rules` but is not used in the current pricing engine.

### Travel Fee Zones (`src/lib/travelFeeCalculator.ts`)

Three-tier lookup, evaluated in priority order:

1. **ZIP code zone override** — flat fee for specific ZIP codes (configured in `pricing_rules.zone_overrides_json`). Sets `travel_is_flat_fee = true` and `zone_name = zip`.
2. **Free cities list** — zero travel fee for listed cities (case-insensitive match against `pricing_rules.included_cities` array and `included_city_list_json`). Displayed as "FREE".
3. **Distance-based** — per-mile charge beyond the base radius from home base (Wayne, MI, 4426 Woodward St). Rate: `per_mile_after_base_cents`. If address is within the base radius: also free, displayed as "Within Base".

### Distance Calculation (`src/lib/distanceCalculator.ts`)

Driving distance between the business home base and the event address is calculated using the Google Maps Distance Matrix API. The result (in miles) is stored on the order as `travel_total_miles`, `travel_base_radius_miles`, and `travel_chargeable_miles`. The travel fee display always shows total miles to the customer, not just chargeable miles.

---

## Availability Checking

`src/lib/availability.ts` provides:

- `checkDateBlackout(startDate, endDate)` — RPC call to `check_date_blackout` database function
- `checkUnitAvailability(unitId, startDate, endDate, excludeOrderId?)` — checks for conflicting orders
- `checkMultipleUnitsAvailability(...)` — batched version; deduplicates the blackout RPC call (only one call per unique date range, not per unit)

Orders in these statuses block availability: `pending_review`, `awaiting_customer_approval`, `confirmed`, `in_progress`, `completed` (plus the legacy `approved` status for backward compatibility).

Date overlap logic is inclusive on both ends. The `excludeOrderId` parameter allows checking availability for an order that is being edited without conflicting with itself.

Availability is checked at two trusted enforcement points:
1. Client-side in the quote form (prevents selection of blocked dates)
2. Server-side inside `stripe-checkout` before creating a Stripe session (cannot be bypassed). Blackout checks also distinguish between full blocks and same-day-pickup-only blocks.

---

## Error Handling

`src/lib/errorHandling.ts` provides:

- `AppError` — custom error class with `code` and `statusCode`
- `handleError(error, context)` — logs, reports to error reporter, shows user toast notification
- `withErrorHandling(fn)` — try/catch wrapper returning `T | null`
- `queryWithErrorHandling(query, options)` — wraps Supabase queries with optional silent mode

Supabase error codes are mapped to user-friendly messages (e.g., PGRST116 → "No data found", 23505 → "Record already exists").

---

## Analytics Tracking

User interactions are logged to the `site_events` table via `src/lib/siteEvents.ts`. Events include:

- Page views (path, referrer)
- Quote starts, quote completions
- Unit views
- Checkout starts, checkout completions
- Referral source attribution

Tracked funnel: `unit_view → cart_started → cart_submitted → checkout_started → checkout_completed`

Each event optionally carries a `session_id`, `unit_id`, `order_id`, and arbitrary `metadata` JSON. Analytics are surfaced in the admin Site Analytics tab, including booking source attribution reports powered by the `get_booking_source_analytics` SECURITY DEFINER database function.

---

## Admin Settings Cache

`src/lib/adminSettingsCache.ts` provides a lightweight in-memory cache for the `admin_settings` table. Frequently-read values like business address text are cached to avoid repeated database queries during the same session.

---

## Utility Libraries

| File | Purpose |
|---|---|
| `src/lib/utils.ts` | Currency formatting (`formatCurrency`), date formatting, order ID display, `createShortPortalLink()` |
| `src/lib/validation.ts` | Email, phone, address validation utilities. Phone validation requires exactly 10 digits (no international support). |
| `src/lib/logger.ts` | Centralized logging: `createLogger('ModuleName')` returns a scoped logger with `.debug()`, `.warn()`, `.error()` |
| `src/lib/safeStorage.ts` | Safe wrapper around `localStorage`/`sessionStorage` that catches exceptions on restricted browsers |
| `src/lib/printUtils.ts` | Utilities for triggering browser print dialogs |
| `src/lib/printIntegration.ts` | Multi-document print system: invoice, receipt, quote, waiver, catalog — with typed print templates. Quote preview generates a mock order with ID `'QUOTE-' + Date.now()` (not persisted). |
| `src/lib/pricingCache.ts` | In-memory cache for `pricing_rules` to avoid redundant fetches during a session |
| `src/lib/calendarUtils.ts` | Date/time manipulation utilities for the calendar view |
| `src/lib/styles.ts` | Shared Tailwind class string helpers |
| `src/lib/invoiceSummaryBuilder.ts` | Transforms order data into a normalized `OrderSummaryDisplay` object used across invoice, receipt, and print views |
| `src/lib/addressService.ts` | `upsertCanonicalAddress()` — create-or-find logic for deduplicated address records |

### `createShortPortalLink()` (`src/lib/utils.ts`)

Generates a time-limited compact portal URL for SMS messages:
- Short code: 8 random chars from an unambiguous set (no `0`, `O`, `1`, `I`, `l`)
- Expiration: event date + 3 days, or 30 days from now if no event date
- Inserts into `invoice_links` with `link_type: 'portal_shortlink'`
- Falls back to full portal URL if the database insert fails
