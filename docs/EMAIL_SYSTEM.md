# Email and Notification System

## Overview

All outbound communication (email and SMS) is dispatched through a unified notification service (`src/lib/notificationService.ts`). Email is sent via the `send-email` edge function (which calls Resend). SMS is sent via the `send-sms-notification` edge function (which calls Twilio). Neither service is called directly from the frontend — all calls go through edge functions.

---

## Notification Service (`src/lib/notificationService.ts`)

The service provides these functions:

| Function | Purpose |
|---|---|
| `sendEmail(payload)` | Posts to `send-email` edge function |
| `sendSms(phone, message, orderId?)` | Posts to `send-sms-notification` edge function |
| `getAdminEmail()` | Reads admin email from `admin_settings` |
| `getAdminPhone()` | Reads admin phone from `admin_settings` |
| `sendAdminEmail(subject, html)` | Convenience wrapper — sends to admin email |
| `sendAdminSms(message)` | Convenience wrapper — sends to admin phone |
| `sendNotificationToCustomer(email, sms)` | Sends both in parallel, independently |

Email and SMS are always sent independently. A failure of one does not block the other.

---

## Email Edge Function (`send-email`)

**Endpoint:** `POST /functions/v1/send-email`

Reads the Resend API key from `admin_settings` at call time — not from environment variables.

**Payload:**

```typescript
{
  to: string
  from?: string           // defaults to business email from admin_settings
  subject: string
  html: string
  text?: string
  attachments?: { filename: string; content: string; encoding: string }[]
  context?: string        // for logging/debugging
  skipFallback?: boolean  // suppress admin SMS on failure
  templateName?: string
  orderId?: string
}
```

**Fallback behavior:** If the email fails to send and `skipFallback` is not set, the function sends an SMS to the admin phone with the recipient, subject, and truncated error message. This ensures critical notifications are not silently dropped.

---

## SMS Edge Function (`send-sms-notification`)

**Endpoint:** `POST /functions/v1/send-sms-notification`

Reads Twilio credentials (Account SID, Auth Token, From Number) from the `admin_settings` table at call time — not from environment variables.

**Important:** The request body must use `orderId` (camelCase) to link the outbound message to an order's SMS thread. Using `order_id` (snake_case) is silently ignored, causing the message to be stored with `order_id = null` and making it invisible in the order SMS thread.

```typescript
{
  to: string       // destination phone number
  message: string  // SMS body
  orderId?: string // camelCase — required for thread linking
}
```

If `orderId` is provided, the outbound message is stored in the `sms_conversations` table linked to the order and appears in the order's SMS thread in the admin panel.

---

## Email Template System (`src/lib/emailTemplateBase.ts`)

All HTML emails are built using a shared component library. Templates use table-based HTML for maximum email client compatibility. The logo URL and brand color are pulled from `admin_settings` at send time so all transactional emails stay on-brand.

### Wrapper

```typescript
createEmailWrapper(content: string, options?: {
  title?: string
  preheader?: string
  theme?: EmailTheme
}): string
```

Renders the outer email shell with the company logo (from `admin_settings`), a header section, the body content, and a branded footer with contact information.

### Content Components

| Function | Output |
|---|---|
| `createGreeting(name)` | "Hi [Name]," heading |
| `createParagraph(text)` | Body text paragraph |
| `createInfoBox(rows)` | Key-value info table (event details, order info) |
| `createItemsTable(items)` | Line-item table (units, prices) |
| `createPricingSummary(rows)` | Pricing breakdown table |
| `createAlertBox(message, theme)` | Colored alert banner |
| `createBulletList(items)` | Bulleted list |
| `createButton(label, url, theme)` | Call-to-action button |
| `createContactInfo()` | Footer contact block |

### Themes

```typescript
EMAIL_THEMES = {
  primary: { border: '#3b82f6', header: '#3b82f6', ... }
  success: { border: '#10b981', header: '#10b981', ... }
  warning: { border: '#f59e0b', header: '#f59e0b', ... }
  danger:  { border: '#ef4444', header: '#ef4444', ... }
}
```

Pass a theme to `createEmailWrapper` or `createAlertBox` to change the color scheme. Default is `primary`.

### Adding a New Email Template

1. Create a new file in `src/lib/` (e.g., `src/lib/myEmailTemplate.ts`).
2. Import and use functions from `emailTemplateBase.ts`.
3. Build the HTML string using the component functions.
4. Call `createEmailWrapper(content)` to wrap it in the branded shell.
5. Pass the resulting HTML string to `sendEmail()` via `notificationService`.

Example:

```typescript
import {
  createEmailWrapper,
  createGreeting,
  createParagraph,
  createButton,
  EMAIL_THEMES
} from './emailTemplateBase'

export function generateMyEmail(customerName: string, actionUrl: string): string {
  const content = [
    createGreeting(customerName),
    createParagraph('Your action is ready.'),
    createButton('Take Action', actionUrl, EMAIL_THEMES.primary)
  ].join('')

  return createEmailWrapper(content, { title: 'Action Required' })
}
```

---

## Existing Email Templates

| Template file | Sends when |
|---|---|
| `bookingEmailTemplates.ts` | Customer booking confirmation (order submitted) |
| `orderEmailTemplates.ts` | Order status changes, admin notifications, approvals, cancellations, changes |
| `transactionReceiptService.ts` | Admin receipt on each payment event |

### Invoice Email (`send-invoice` edge function)

The `send-invoice` edge function builds its own inline HTML email (not using `emailTemplateBase.ts`) and sends it directly to the `send-email` edge function. The email includes:
- Order total amount and deposit due
- A styled "View & Accept Invoice" button linking to the full token URL (`/customer-portal/:orderId?t=:token`)
- Contact phone number

The companion SMS uses the short URL (`/i/:shortCode`) to keep the message concise and within SMS character limits. Email and SMS are sent in parallel via `EdgeRuntime.waitUntil`, so a failure of one does not block the other or the API response.

### Waiver Confirmation Email (`save-signature` edge function)

After a waiver is signed, the `save-signature` edge function sends a confirmation email to the customer:
- Subject: "Your Rental Agreement Has Been Signed — Bounce Party Club"
- Includes the signed PDF as an email attachment (base64-encoded)
- Falls back to a download link if the PDF is not yet generated
- Shows signer name, event date, event address, and signed timestamp
- Includes safety reminders (no shoes, no food, no sharp objects, etc.)

---

## Branded Auth Emails (`auth-email-hook` edge function)

Supabase's default auth emails (signup confirmation, password reset) are replaced with branded versions via the `auth-email-hook` edge function. This hook is registered in Supabase as a custom auth email handler and:

1. Receives the auth event type from Supabase (signup, password reset, etc.)
2. Generates a branded HTML email using `emailTemplateBase.ts` (business logo, colors, footer)
3. Sends the email via Resend

This ensures all auth emails match the business branding rather than using Supabase's generic templates.

---

## SMS Message Templates

Admins manage reusable SMS templates in the admin Message Templates tab. Templates are stored in the `sms_message_templates` table with:
- `template_key` — unique identifier used in code
- `template_name` — human-readable name
- `description` — what the template is for
- `message_template` — the message body with `{variable}` placeholders

Variable placeholders use single braces: `{variable_name}`. They are substituted at send time.

### Current Templates (confirmed from live DB)

| Template Key | Template Name | Purpose |
|---|---|---|
| `arrived_sms` | Crew - Arrival Notification | Sent when crew arrives at delivery location |
| `booking_received_admin` | Admin - New Booking Notification | Notifies admin when a new booking is received |
| `delivery_notification` | Delivery Notification | Sent when crew is en route to delivery |
| `dropoff_done_sms` | Crew - Drop-Off Complete | Sent when drop-off is finished |
| `eta_sms` | Crew - ETA Notification | Sent at crew shift start with GPS-calculated ETA |
| `lot_pictures_uploaded_admin` | Admin - Lot Pictures Uploaded | Notifies admin when customer uploads lot pictures |
| `order_approved` | Order Approved | Sent when admin approves an order |
| `order_cancelled_admin` | Admin - Order Cancellation Notification | Notifies admin when a customer cancels |
| `order_confirmation` | Order Confirmation | Auto-sent when customer places an order |
| `order_rejected` | Order Rejected | Sent when admin rejects an order |
| `payment_reminder` | Payment Reminder | Sent for outstanding balance reminders |
| `pickup_thanks_sms` | Crew - Pickup Complete | Thank-you with Google Review link after pickup |
| `pictures_reminder` | Pictures Reminder | Reminder for customer to upload setup area photos |

### Template Variables

Variables use single-brace `{variable}` format (not double-brace):

| Variable | Meaning |
|---|---|
| `{name}` | Customer full name |
| `{customer_name}` | Customer full name (admin-facing templates) |
| `{customer_first_name}` | Customer first name |
| `{order_id}` | Formatted order ID |
| `{event_date}` | Event date |
| `{event_address}` | Delivery address |
| `{total_amount}` | Order total |
| `{balance_amount}` | Balance due |
| `{eta}` | Estimated arrival time |
| `{portal_link}` | Customer portal URL (short URL form for SMS) |
| `{review_url}` | Google Review URL from admin settings |
| `{rejection_reason}` | Reason for rejection |
| `{refund_policy}` | Refund policy text |
| `{order_link}` | Direct link to order |

---

## Notification Reliability (`src/lib/notificationReliability.ts`)

Every email and SMS send is wrapped with failure tracking:

- `recordNotificationFailure(context)` — calls a database RPC to log the failure with recipient, subject, error message, and order ID.
- `recordNotificationSuccess(type)` — resets the consecutive failure counter.
- `shouldNotifyAdmin()` — returns true if 3+ consecutive failures have occurred for a notification type.
- `getUnresolvedFailures()` — returns up to 50 unresolved failures for the admin dashboard.

The admin Notification Failures panel (`src/components/admin/NotificationFailuresAlert.tsx`) displays active failures and allows marking them resolved.

---

## Twilio Inbound Webhook (`twilio-webhook`)

Inbound SMS from customers is received by the `twilio-webhook` edge function. It:

1. **Validates** the `X-Twilio-Signature` header against the webhook URL and POST body using the Twilio Auth Token. Rejects any request with an invalid signature.
2. **Finds or creates** an `sms_conversations` record for the sender's phone number.
3. **Stores** the inbound message in `sms_conversations` with `direction: 'inbound'`, `from_phone`, `to_phone`, `message_body`, `twilio_message_sid`.
4. **Forwards** the message content to the admin via SMS and email notification so they know a customer replied.

The admin can reply from the order detail SMS conversation panel, which calls `send-sms-notification` directly.

---

## Twilio Delivery Status Callback (`twilio-status-callback`)

Twilio calls this endpoint with delivery status updates for outbound messages:
- `delivered` — message delivered successfully
- `failed`, `undelivered` — delivery failed

Failed deliveries can trigger a `notification_failures` entry and contribute to the consecutive failure counter monitored by the admin Notification Failures panel.

---

## SMS Architecture: Two Distinct Tables

The SMS system uses two separate tables with distinct purposes — they are not related by foreign key:

| Table | Purpose | Columns |
|---|---|---|
| `sms_conversations` | Actual SMS thread — all inbound and outbound messages linked to an order | `order_id`, `from_phone`, `to_phone`, `message_body`, `direction`, `twilio_message_sid`, `status`, `is_admin_internal` |
| `messages` | Notification dispatch log — records what was sent, to whom, and via which channel | `order_id`, `to_phone`, `to_email`, `channel`, `template_key`, `payload_json`, `sent_at`, `status` |

The `messages` table does **not** store message bodies. It is a structured log of notification dispatch events (which template was triggered, when, and whether it succeeded). The `sms_conversations` table stores the full text of every SMS message exchanged with a customer and is what drives the SMS thread UI in the admin order panel.
