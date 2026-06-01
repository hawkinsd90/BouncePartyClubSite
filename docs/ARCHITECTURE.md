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
| `messages` | Notification dispatch log — records what was sent (template key, channel, payload, status). Does NOT store message body text. Distinct from `sms_conversations`. |
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

The `orders` table is the most complex record in the system. Notable columns beyond the obvious (event_date, address_id, subtotal_cents, etc.):

| Column | Purpose |
|---|---|
| `status` | Order lifecycle status (default `'pending'`; see Order Status Model below) |
| `workflow_status` | Crew operational status (default `'pending'`; separate from order `status`) |
| `event_end_date` | End date for multi-day rentals |
| `event_start_time` / `pickup_time` / `event_end_time` | Precise event and pickup times |
| `start_window` / `end_window` | Delivery arrival window |
| `pickup_preference` | `same_day` or `next_day` |
| `until_end_of_day` | Whether the equipment can stay until end of event day |
| `overnight_allowed` | Whether overnight is permitted for this order |
| `can_use_stakes` | Whether ground stakes are allowed (affects surface fee) |
| `location_type` | `residential` or `commercial` (affects pricing multiplier) |
| `surface` | Surface type (grass, concrete, asphalt, etc.) |
| `has_pets` | Whether pets are present (displayed to crew) |
| `special_details` | Free-text field for extra setup instructions |
| `generator_selected` | Boolean — whether generator was requested |
| `generator_qty` | Number of generators requested (integer) |
| `generator_fee_cents` | Generator fee amount captured at booking |
| `total_cents` | Full order total (subtotal + all fees + tax) |
| `tip_cents` | Tip amount (tracked separately, excluded from balance due calculations) |
| `deposit_required` | Whether a deposit is required |
| `custom_deposit_cents` | Admin-overridden deposit amount (overrides percentage-based calculation) |
| `deposit_due_cents` | Final deposit required at confirmation |
| `deposit_paid_cents` | Amount collected toward deposit (sentinel `-1` during atomic charge) |
| `balance_due_cents` | Outstanding balance |
| `balance_paid_cents` | Amount collected toward balance |
| `damage_charged_cents` | Amount charged for equipment damage |
| `total_refunded_cents` | Total amount refunded |
| `travel_fee_cents` | Calculated travel fee |
| `travel_total_miles` | Total driving miles to event address |
| `travel_base_radius_miles` | Free-travel radius at booking time |
| `travel_chargeable_miles` | Miles beyond free radius |
| `travel_per_mile_cents` | Per-mile rate at booking time |
| `travel_is_flat_fee` | Whether a ZIP-code zone flat rate was applied |
| `surface_fee_cents` | Surface/sandbag fee |
| `same_day_pickup_fee_cents` | Same-day pickup surcharge |
| `tax_cents` | Tax amount |
| `tax_waived` / `tax_waive_reason` | Admin tax waiver with required reason |
| `travel_fee_waived` / `travel_fee_waive_reason` | Admin travel fee waiver |
| `same_day_pickup_fee_waived` / `same_day_pickup_fee_waive_reason` | Admin same-day fee waiver |
| `surface_fee_waived` / `surface_fee_waive_reason` | Admin surface fee waiver |
| `generator_fee_waived` / `generator_fee_waive_reason` | Admin generator fee waiver |
| `stripe_customer_id` | Stripe customer token |
| `stripe_payment_method_id` | Saved Stripe payment method ID for off-session charges |
| `stripe_payment_status` | Stripe-specific status; set to `'paid'` even for zero-deposit approvals to signal payment obligation satisfied |
| `payment_method_brand` | Card brand (Visa, Mastercard, etc.) |
| `payment_method_last_four` | Last four digits of saved card |
| `payment_method_exp_month` / `payment_method_exp_year` | Card expiration date (used for expiring card monitoring) |
| `payment_method_validated_at` | When the payment method was last validated |
| `customer_selected_payment_cents` | What the customer indicated they would pay (reconciled after webhook) |
| `customer_selected_payment_type` | `deposit`, `balance`, or `custom` |
| `require_card_on_file` | Whether checkout must save a card even with no immediate charge |
| `clear_payment_info` | Signals saved Stripe payment method should be cleared (set when items/deposit increase) |
| `admin_message` | Admin-written message visible to customer in the portal |
| `edit_summary` | Summary of changes sent to customer when approval is requested |
| `awaiting_customer_approval` | Boolean flag set during approval-required edit flow |
| `customer_approval_requested_at` / `customer_approved_at` | Timestamps for the approval workflow |
| `refund_requested` | Whether the customer requested a refund on cancellation |
| `cancellation_reason` / `cancelled_at` / `cancelled_by` | Cancellation metadata |
| `same_day_responsibility_accepted` | Customer acceptance of same-day responsibility clause |
| `overnight_responsibility_accepted` | Customer acceptance of overnight responsibility clause |
| `sms_consent` / `sms_consent_text` / `sms_consented_at` | SMS marketing consent captured at checkout |
| `card_on_file_consent` / `card_on_file_consent_text` / `card_on_file_consented_at` | Card-on-file authorization consent |
| `e_signature_consent` | Whether electronic signature consent was accepted |
| `waiver_signed_at` | Timestamp of waiver signing |
| `signed_waiver_url` | URL to the generated signed waiver PDF |
| `signature_id` | FK to `order_signatures` |
| `waiver_signature_data` | Raw canvas signature data (stored for audit before PDF generation) |
| `lot_pictures_requested` / `lot_pictures_requested_at` | Whether and when admin requested lot photos |
| `invoice_sent_at` / `invoice_accepted_at` | Invoice distribution and acceptance timestamps |
| `booking_confirmation_sent` | Deduplication flag — prevents duplicate booking confirmation emails |
| `pending_review_admin_alerted` / `confirmed_admin_alerted` | Deduplication flags for admin SMS/email notifications |
| `current_eta` | Crew ETA timestamp updated as route progresses |
| `billing_address_line1–zip` | Billing address collected from Stripe Checkout (separate from event address) |
| `referral_source` / `referral_source_detail` | How the customer found the business and sub-detail (e.g., `social` / `instagram`) |
| `archived_at` | Timestamp when order was archived (soft delete for completed/old orders) |

---

### Pricing Rules Table

Single-row configuration table (one row for the whole system). All pricing options:

| Column | Purpose |
|---|---|
| `base_radius_miles` | Free travel radius from home base |
| `per_mile_after_base_cents` | Per-mile charge beyond base radius |
| `included_cities` | Array of city names with free travel (newer format) |
| `included_city_list_json` | JSONB list of free cities (legacy/alternative format) |
| `zone_overrides_json` | JSONB map of ZIP code → flat fee (overrides distance-based) |
| `residential_multiplier` | Price multiplier for residential orders (e.g., `1.0`) |
| `commercial_multiplier` | Price multiplier for commercial orders (e.g., `1.2`) |
| `surface_sandbag_fee_cents` | Fee charged when sandbags/stakes are needed |
| `same_day_pickup_fee_cents` | Surcharge for same-day pickup |
| `same_day_matrix_json` | Reserved JSON matrix for future same-day pricing logic (not currently used) |
| `overnight_holiday_only` | Restricts overnight rentals to holiday dates only |
| `extra_day_pct` | Percentage of day-1 price charged for each additional day (e.g., `50` = 50% for days 2+) |
| `generator_price_cents` | Legacy generator fee (superseded by single/multiple split) |
| `generator_fee_single_cents` | Fee for one generator |
| `generator_fee_multiple_cents` | Fee for each additional generator beyond the first |
| `deposit_per_unit_cents` | Flat deposit per unit (e.g., $50/unit) |
| `deposit_percentage` | Alternative percentage-based deposit calculation (e.g., `25` for 25% of total) |
| `apply_taxes_by_default` | Whether tax is applied by default on new orders |

### Unit Media Table

Each unit can have multiple media items. Key columns:

| Column | Purpose |
|---|---|
| `mode` | `dry`, `wet`, or `both` — which setup mode the image shows |
| `visibility_mode` | Controls which mode tab this image appears under (`dry`, `wet`, `both`) |
| `is_featured` | Whether this is the primary image shown on catalog/detail pages |
| `sort` | Display order within a unit's gallery |

### Consent Records Table

Per-order consent records (collected at checkout / invoice acceptance). Distinct from `user_consent_log` (which is per-user post-signup):

| Column | Purpose |
|---|---|
| `order_id` | Which order this consent was captured for |
| `consent_type` | Type: `sms_marketing`, `card_on_file`, `e_signature`, etc. |
| `consented` | Boolean |
| `consent_text` | Exact text the customer agreed to (snapshot) |
| `consent_version` | Version of the consent language shown |
| `consented_at` | When consent was given |
| `ip_address` / `user_agent` | Audit trail |

### Email Templates Table

Admin-editable email template content, managed from the Settings → Message Templates tab:

| Column | Purpose |
|---|---|
| `template_name` | Unique identifier |
| `subject` | Email subject line with `{variable}` placeholders |
| `description` | Human-readable description of when this template is used |
| `header_title` | Text shown in the email header banner |
| `content_template` | Email body with `{variable}` placeholders |
| `theme` | Color theme: `primary`, `success`, `warning`, `danger` |
| `category` | Template category (`booking`, `payment`, `admin`, etc.) |

### Contacts Table — Loyalty Fields

The `contacts` table maintains auto-updated lifetime statistics for each customer via database triggers:

| Column | Purpose |
|---|---|
| `total_bookings` | Count of all non-cancelled orders for this contact |
| `total_spent_cents` | Lifetime revenue from this contact (includes custom fees, excludes refunds) |
| `completed_bookings_count` | Count of completed (not just confirmed) orders |
| `first_completed_booking_date` / `last_completed_booking_date` | Lifecycle of customer relationship |
| `is_repeat_customer` | Auto-set to `true` when `completed_bookings_count >= 2` |
| `tags` | Admin-assigned text tags array for segmentation |
| `opt_in_sms` / `opt_in_email` | Marketing consent flags |

---

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
| `checkout-bridge` | No | Minimal HTML page served from the Supabase domain that relays payment completion from Stripe back to the checkout window via `window.opener.postMessage({ type: 'BPC_CHECKOUT_COMPLETE', orderId, session_id })` then calls `window.close()`. Exists because Stripe cannot redirect to localhost or arbitrary dev URLs. |
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

## Database Functions and RPCs

All 63 database functions (confirmed from live DB). Functions marked `SECURITY DEFINER` run with elevated privileges and have explicit `search_path` to prevent schema injection.

### Business Logic RPCs

| Function | Security | Purpose |
|---|---|---|
| `apply_balance_payment_financials(p_pi_id, p_order_id, p_balance_cents, p_tip_cents, ...)` | DEFINER | Atomically updates `balance_paid_cents`/`deposit_paid_cents` on order using `order_financials_applied` flag for idempotency |
| `approve_order_changes(p_order_id, p_token, ...)` | DEFINER | Customer approves admin-requested order changes; optionally triggers payment |
| `archive_old_orders(threshold_days)` | DEFINER | Soft-archives orders older than threshold by setting `archived_at` |
| `check_date_blackout(p_start, p_end)` | DEFINER | Returns `{ is_full_blocked, is_same_day_pickup_blocked }` for a date range, handling annual/recurring blackouts |
| `check_expiring_cards()` | DEFINER | Returns orders with payment method cards expiring within 30 days |
| `check_rate_limit(p_identifier, p_endpoint, p_max_requests, p_window_seconds)` | DEFINER | Sliding-window rate limiter; returns `{ allowed, remaining }` |
| `check_unit_availability(p_unit_id, p_start_date, p_end_date, p_exclude_order_id?)` | DEFINER | Returns conflict count for a single unit (overloaded — also accepts array form) |
| `check_unit_availability(p_unit_ids[], p_start_date, p_end_date)` | DEFINER | Batch availability check across multiple units |
| `claim_balance_payment_financials(p_pi_id)` | DEFINER | First step of balance payment: claims atomic lock for a payment intent ID |
| `cleanup_old_rate_limits()` | DEFINER | Deletes expired rate limit rows; call periodically to prevent table growth |
| `generate_invoice_number()` | INVOKER | Returns next sequential invoice number from database sequence |
| `generate_receipt_group_id()` | INVOKER | Returns a new UUID for grouping related transaction receipts |
| `generate_receipt_number()` | DEFINER | Returns next sequential unique receipt number |
| `get_admin_analytics(p_start?, p_end?)` | DEFINER | Returns 25+ business metrics as JSONB for the admin analytics dashboard |
| `get_booking_source_analytics(p_start?, p_end?)` | DEFINER | Returns booking count and revenue grouped by referral source |
| `get_booking_sources_analytics(p_since, p_until?)` | DEFINER | Alternative booking source analytics with different time range parameters |
| `get_order_by_token(p_token)` | DEFINER | Fetches order by invoice link token (used for tokenized customer access) |
| `get_order_with_relations_by_token(p_token)` | DEFINER | Returns full order with all relations as JSONB (used by Customer Portal) |
| `get_public_business_settings()` | DEFINER | Returns non-sensitive business settings for public display (branding, contact info) |
| `get_signature_status(order_uuid)` | DEFINER | Returns waiver signing status and PDF URL for an order |
| `get_unresolved_failures_count()` | DEFINER | Returns count of unresolved notification failures |
| `get_user_creation_logs(target_email)` | DEFINER | Returns `auth_trigger_logs` for a given email (admin debugging tool) |
| `get_user_order_prefill()` | DEFINER | Returns last-used order data for the current authenticated user to prefill forms |
| `get_user_role(user_id_input)` | DEFINER | Returns a user's primary role |
| `is_admin()` | DEFINER | Returns boolean — whether the calling session user is admin or master |
| `order_has_valid_signature(order_uuid)` | DEFINER | Returns boolean — whether order has a valid waiver signature |
| `record_cash_payment(p_order_id, p_amount_cents, p_tip_cents, p_acting_user_id)` | DEFINER | Atomic: inserts payment row + updates order totals + logs changelog |
| `record_check_payment(p_order_id, p_amount_cents, p_tip_cents, p_acting_user_id, p_check_number?)` | DEFINER | Same as cash, but stores check number in `payments.notes` |
| `record_notification_failure(p_type, p_recipient, p_subject, p_message_preview, p_error, p_context?)` | DEFINER | Logs a notification failure and increments consecutive failure counter |
| `record_notification_success(p_type)` | DEFINER | Resets consecutive failure counter for a notification type |
| `save_lot_picture_to_address(p_order_lot_picture_id)` | DEFINER | Copies a lot picture from an order to the canonical `address_lot_pictures` table |
| `upsert_contact_from_checkout(p_first_name, p_last_name, p_email, p_phone, ...)` | DEFINER | Creates or updates a contacts record from checkout form data |

### Role Management RPCs

| Function | Security | Purpose |
|---|---|---|
| `assign_role_by_email(p_email, p_role)` | DEFINER | Grants a role to a user identified by email |
| `assign_user_role(target_user_id, target_role)` | DEFINER | Grants a role to a user identified by UUID |
| `remove_user_role(target_user_id, target_role)` | DEFINER | Revokes a specific role from a user |
| `get_all_role_users()` | DEFINER | Returns all users with non-customer roles |
| `get_admin_users()` | DEFINER | Returns all users with `admin` or `master` role |
| `get_user_highest_role(check_user_id)` | DEFINER | Returns the highest role for a user |
| `user_has_role(check_user_id, check_role)` | DEFINER | Returns boolean — whether user has a specific role |

### Trigger Functions

All trigger functions are `SECURITY DEFINER`:

| Trigger Function | Fires On |
|---|---|
| `auto_assign_customer_role()` | New user signup — assigns `customer` role |
| `auto_create_task_status()` | Order status → `confirmed` — creates `task_status` rows for drop-off and pickup |
| `auto_sync_google_calendar()` | Order status changes — queues a Google Calendar sync event |
| `auto_update_order_status()` | `task_status` changes — advances order workflow status |
| `log_admin_settings_change()` | `admin_settings` inserts/updates — writes to changelog with value redaction |
| `log_permission_change()` | `user_roles` insert/delete — writes to `user_permissions_changelog` with actor email |
| `redact_sensitive_changelog_values()` | Before insert on `admin_settings_changelog` — redacts values for keys containing `key`, `secret`, `token`, `sid`, or `password` |
| `sync_invoice_links_expires_at()` | `orders.event_date` change — updates expiration on related `invoice_links` rows |
| `update_blackout_*_timestamp()` | Updates to blackout tables — maintains `updated_at` |
| `update_contact_booking_stats()` | Order inserts/updates — maintains `contacts` lifetime stats and loyalty flags |
| `validate_order_status_transition()` | Before order update — rejects transitions not in the valid state graph |

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
