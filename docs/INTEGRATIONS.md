# External Integrations

## Overview

The application integrates with four external services: Stripe (payments), Twilio (SMS), Resend (email), and Google (Maps, Calendar). All API credentials are stored in the `admin_settings` table — never in environment variables or code.

---

## Stripe

### Overview

Stripe handles all card payment processing. The integration uses Stripe Checkout Sessions (hosted payment page) for customer-facing payments and the Stripe API directly for admin-initiated charges.

### Configuration

Credentials stored in `admin_settings`:
- `stripe_secret_key` — Stripe secret key (server-side only)
- `stripe_publishable_key` — Stripe publishable key (returned to frontend via `get-stripe-publishable-key` edge function)
- `stripe_webhook_secret` — webhook signature verification secret

### Payment Flows

#### Customer Checkout (Stripe Checkout Session)

1. Frontend calls `stripe-checkout` edge function with order ID and payment details
2. Edge function creates a Stripe Checkout Session:
   - Sets `customer_email` from order
   - Sets metadata: `orderId`, `paymentType` (deposit/full/custom)
   - Sets `success_url` to `/payment-complete?session_id={CHECKOUT_SESSION_ID}`
   - Sets `cancel_url` to `/payment-canceled`
3. Frontend redirects to Stripe's hosted checkout page
4. On success, Stripe calls the webhook and redirects customer

#### Setup Mode (Card-on-File Only)

When `require_card_on_file` is true and no immediate charge is needed:
1. Checkout session created in `setup` mode (no charge)
2. Card is tokenized and saved to the Stripe customer
3. Payment method details saved via `save-payment-method-from-session` after session completes

#### Admin Direct Charge (`stripe-charge`)

For admin-initiated charges outside the checkout flow. Used for balance collection or ad-hoc charges.

#### Deposit Charge (`charge-deposit`)

Called in two contexts:
1. **Order approval** — by `orderApprovalService` when admin approves an order with a positive deposit
2. **Day-of balance collection** — by the Task Detail Modal's "Charge Card on File" button when admin charges the remaining balance on event day

Flow:
1. Reads `stripe_customer_id` and `stripe_payment_method_id` from the order
2. Creates a PaymentIntent for the specified amount
3. Confirms the PaymentIntent immediately (off-session charge)
4. On success: logs payment to `payments`, records transaction receipt, updates `balance_paid_cents` or `deposit_paid_cents` on order, sends customer receipt email
5. On failure: sends decline notification to customer, logs failure

When called from task detail, `selectedPaymentType` is `'balance'` and `tipCents` is `0`.

#### Customer Balance Payment (`customer-balance-payment`)

Allows customers to pay their remaining balance from the Customer Portal:
1. Customer views balance due in portal
2. Clicks "Pay Now" — calls `customer-balance-payment` edge function
3. Edge function charges the saved card on file for the balance amount
4. Logs payment and sends receipt to customer

### Webhook Processing (`stripe-webhook`)

All Stripe events are received at the `stripe-webhook` edge function (JWT not required, verified by signature).

**Signature Verification:**
Every webhook is verified using `stripe.webhooks.constructEvent()` with the `stripe_webhook_secret`. Requests with invalid or missing signatures return 400 immediately.

**Idempotency:**
The `webhook-idempotency.ts` shared utility checks the `stripe_webhook_events` table before processing. If the event ID has already been processed, the function returns 200 without re-applying changes.

**Handled Events:**

| Event | Action |
|---|---|
| `payment_intent.succeeded` | Records payment in `payments` table, updates `deposit_paid_cents` or `balance_paid_cents` on order, logs transaction receipt, sends customer receipt |
| `charge.refunded` | Records refund in `order_refunds` table, updates `total_refunded_cents` on order, logs refund receipt |
| `checkout.session.completed` | Saves payment method details via `save-payment-method-from-session` |

### Payment Method Storage

After a successful checkout session:
1. `checkout.session.completed` webhook fires
2. `save-payment-method-from-session` edge function retrieves the payment method from Stripe
3. Stores on the order record: `stripe_customer_id`, `stripe_payment_method_id`, `payment_method_brand`, `payment_method_last_four`, `payment_method_exp_month`, `payment_method_exp_year`
4. These are used for future off-session charges (deposit, balance)

### Updating a Saved Card (`fix-payment-method`)

When a charge is declined, customers receive an email with a link to update their card. The `fix-payment-method` edge function:
1. Creates a new Stripe Checkout Session in setup mode
2. Customer enters new card details
3. New payment method replaces the old one on the order
4. Admin is notified

### Refunds (`stripe-refund`)

Admin-only (requires `admin` or `master` role):
1. Admin specifies amount and reason in the Payments tab
2. `stripe-refund` edge function calls `stripe.refunds.create()`
3. Creates record in `order_refunds`
4. Updates `total_refunded_cents` on order
5. Logs refund transaction receipt
6. Sends refund confirmation to customer

---

## Twilio (SMS)

### Overview

Twilio handles all SMS communication: outbound notifications to customers and crew, and inbound customer replies.

### Configuration

Credentials stored in `admin_settings`:
- `twilio_account_sid` — Twilio Account SID
- `twilio_auth_token` — Twilio Auth Token
- `twilio_from_number` — The "From" phone number (e.g., `+15550001234`)

Credentials are read at runtime by each edge function that needs them — never hardcoded or in environment variables.

### Outbound SMS (`send-sms-notification`)

All outbound SMS goes through the `send-sms-notification` edge function:
- Requires authentication (JWT)
- Reads Twilio credentials from `admin_settings`
- Calls Twilio REST API to send the message
- If `orderId` is provided, logs the message to `messages` table and `sms_conversations` record
- Returns success/failure to caller

### Inbound SMS (`twilio-webhook`)

Twilio calls the `twilio-webhook` edge function when a customer texts the business number:

1. **Signature Validation** — verifies the `X-Twilio-Signature` header against the webhook URL and POST body using the Twilio Auth Token. Rejects any request with an invalid signature.

2. **Conversation Lookup** — finds or creates an `sms_conversations` record for the sender's phone number. Links to an order if the phone number matches a customer.

3. **Message Storage** — stores the inbound message in `messages` with:
   - `direction: 'inbound'`
   - `from_phone`, `to_phone`
   - `message_body`
   - `twilio_message_sid`
   - `channel: 'sms'`

4. **Admin Notification** — forwards the message to the admin via SMS and email so they know a customer replied.

### Short URLs in SMS (`invoice_links` table)

SMS messages have strict character limits. To keep links short, the system uses 8-character short codes that resolve to full URLs:

- **Route:** `/i/:shortCode` → handled by `ShortLink` component → redirects to `/customer-portal/:orderId?t=:token`
- **`link_type` field** distinguishes the purpose of each record:
  - `invoice` — created by `send-invoice` edge function when admin sends an invoice
  - `portal_shortlink` — created by `createShortPortalLink()` (`src/lib/utils.ts`) for crew ETA messages and other SMS use cases
- **`short_code`** is 8 characters using an unambiguous character set (no `0`, `O`, `1`, `I`, `l`) to avoid misreading
- **Expiry** is set to 3 days after the event date (or 30 days from creation if no event date)

`createShortPortalLink(orderId, supabaseClient, eventDate?)` returns the full short URL (e.g., `https://bouncepartyclub.com/i/AbCdEfGh`) and falls back to the full portal URL if short code generation fails.

### Delivery Status Callback (`twilio-status-callback`)

Twilio calls this endpoint with delivery status updates for outbound messages:
- `delivered` — message delivered successfully
- `failed`, `undelivered` — delivery failed

Status is recorded on the `sms_conversations` record. Failed deliveries can trigger a `notification_failures` entry.

### SMS Message Templates

Templates are stored in `sms_message_templates` and managed from the admin Message Templates tab:

| Template Key | When Used |
|---|---|
| `booking_confirmation` | Customer submits order |
| `order_confirmed` | Admin approves order |
| `eta_customer` | Crew en route to delivery |
| `deposit_charged` | Deposit collected |
| `balance_reminder` | Balance payment reminder |
| `waiver_reminder` | Waiver not yet signed |
| `pickup_complete` | Equipment picked up (includes Google Review link) |
| `cancellation` | Order cancelled |
| `order_changes` | Admin modified confirmed order |
| `crew_checkpoint_*` | Crew status updates |
| `admin_new_order` | Admin notification: new order submitted |
| `admin_cancellation` | Admin notification: customer cancelled |

Variable substitution is performed at send time. Supported variables:
- `{{customer_name}}` — customer first name
- `{{order_id}}` — formatted order ID (e.g., `BPC-1234`)
- `{{event_date}}` — event date in readable format
- `{{portal_link}}` — customer portal URL (short `/i/:shortCode` URL when available, otherwise full token URL)
- `{{invoice_link}}` — invoice URL (short `/i/:shortCode` URL when available)
- `{{signing_link}}` — waiver signing URL
- `{{google_review_url}}` — Google Review URL from admin settings
- `{{eta_time}}` — estimated arrival time
- `{{balance_due}}` — formatted balance amount

---

## Resend (Email)

### Overview

All transactional emails are sent via Resend through the `send-email` edge function.

### Configuration

Stored in `admin_settings`:
- `resend_api_key` — Resend API key

### `send-email` Edge Function

**Payload:**
```typescript
{
  to: string              // recipient email
  from?: string           // sender (defaults to business email)
  subject: string
  html: string            // full HTML email body
  text?: string           // plain text fallback
  attachments?: { filename, content, encoding }[]
  context?: string        // for logging
  skipFallback?: boolean  // suppress admin SMS on failure
  templateName?: string
  orderId?: string
}
```

**Fallback Behavior:**
If the email fails and `skipFallback` is not set, the function sends an SMS to the admin phone with the recipient, subject, and truncated error message. This ensures critical notifications are not silently lost.

### Branded Email Hook (`auth-email-hook`)

Supabase's default auth emails (signup confirmation, password reset) are intercepted and replaced with branded versions. The hook receives the auth event from Supabase and sends via Resend using the `emailTemplateBase.ts` component library.

### Email Template System (`src/lib/emailTemplateBase.ts`)

All emails use a shared component library for consistent branding:

```typescript
createEmailWrapper(content, { title, preheader, theme })
createGreeting(name)
createParagraph(text)
createInfoBox(rows)           // key-value table
createItemsTable(items)       // line-item table
createPricingSummary(rows)    // pricing breakdown
createAlertBox(message, theme)
createBulletList(items)
createButton(label, url, theme)
```

**Themes:** `primary` (blue), `success` (green), `warning` (amber), `danger` (red)

### Email Templates in Use

| Template File | When Sent |
|---|---|
| `bookingEmailTemplates.ts` | Customer: order submitted confirmation |
| `orderEmailTemplates.ts` | Customer/admin: status changes, approvals, changes, cancellations |
| `transactionReceiptService.ts` | Admin: each payment event receipt |

---

## Google Maps

### Configuration

Stored in environment variable: `VITE_GOOGLE_MAPS_API_KEY` (public key, safe for frontend)

### APIs Used

| API | Purpose |
|---|---|
| Places Autocomplete | Address input on quote form |
| Geocoding | Converting selected address to lat/lng |
| Distance Matrix | Travel fee calculation, route optimization |

### SDK Loading (`src/lib/googleMapsLoader.ts`)

The Google Maps JavaScript SDK is loaded lazily using a singleton pattern:
- First call initiates the SDK load via `<script>` tag injection
- Subsequent calls wait for the same promise
- Prevents duplicate SDK loads on pages that import multiple Maps-dependent components

### Distance Matrix Usage

The Distance Matrix API is called with:
- `origins`: array of lat/lng coordinates
- `destinations`: array of lat/lng coordinates
- `departureTime`: `new Date()` for route optimization (traffic modeling)
- `travelMode: 'DRIVING'`

**Chunking:** The API supports a maximum of 100 elements (origins × destinations) per request. The route optimization code automatically splits larger requests into multiple chunks and merges results.

### Distance Calculator (`src/lib/distanceCalculator.ts`)

For travel fee calculation, computes driving distance between the home base (Wayne, MI) and the event address:
1. Geocodes event address to lat/lng (already done during address autocomplete)
2. Calls Distance Matrix with home base as origin
3. Returns total miles and chargeable miles (miles beyond free radius)

Results stored on order: `travel_total_miles`, `travel_base_radius_miles`, `travel_chargeable_miles`.

---

## Google Calendar

### Overview

Confirmed orders can be automatically synced to a Google Calendar, providing the business with a visual overview of their schedule outside the app.

### Configuration

Stored in `admin_settings`:
- `google_calendar_client_id` — OAuth 2.0 client ID
- `google_calendar_client_secret` — OAuth 2.0 client secret
- `google_calendar_refresh_token` — Long-lived refresh token from OAuth flow
- `google_calendar_id` — Which calendar to write events to
- `google_calendar_enabled` — Whether sync is active

Configured from the admin Google Calendar Settings tab.

### Sync Flow

1. When an order moves to `confirmed`, a database trigger adds a row to `google_calendar_sync_queue`
2. The `sync-google-calendar` edge function processes the queue
3. For each queued date, the function:
   - Fetches all confirmed orders for that date
   - Creates or updates a Google Calendar event with order summaries
   - Records sync status in `google_calendar_sync` (success or error)
   - Marks queue row as processed

### Sync Status Tracking (`google_calendar_sync` table)

Per event date:
- `google_event_id` — the ID of the calendar event in Google
- `last_synced_at` — when this date was last synced
- `last_sync_status` — `success`, `error`, or `pending`
- `last_sync_error` — error message if sync failed
- `order_count` — number of orders included in this calendar event

---

## Rate Limiting

All public-facing edge functions use the shared `rate-limit.ts` utility backed by the `rate_limits` table.

### How It Works

1. On each request, the rate limiter reads the row for `(identifier, endpoint)` from `rate_limits`
2. `identifier` is typically the order ID, customer email, or IP address
3. If a request comes in within the window:
   - Increment `request_count`
   - If `request_count` exceeds the threshold: set `blocked_until` timestamp
4. If `blocked_until` is in the future: return 429 Too Many Requests
5. After the blocking window expires: reset counter

Rate limiting protects against:
- Duplicate checkout session creation (per order ID)
- Brute-force payment attempts
- Webhook replay attacks
