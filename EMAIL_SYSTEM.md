# Email and Notification System

## Overview

All outbound communication (email and SMS) is dispatched through a unified notification service (`src/lib/notificationService.ts`). Email is sent via the `send-email` edge function (which calls Resend). SMS is sent via the `send-sms-notification` edge function (which calls Twilio). Neither service is called directly from the frontend.

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

**Payload:**

```typescript
{
  to: string
  from?: string
  subject: string
  html: string
  text?: string
  attachments?: { filename: string; content: string; encoding: string }[]
  context?: string         // for logging/debugging
  skipFallback?: boolean   // suppress admin SMS on failure
  templateName?: string
  orderId?: string
}
```

**Fallback behavior:** If the email fails to send and `skipFallback` is not set, the function sends an SMS to the admin phone with the recipient, subject, and truncated error message.

---

## SMS Edge Function (`send-sms-notification`)

**Endpoint:** `POST /functions/v1/send-sms-notification`

Reads Twilio credentials (Account SID, Auth Token, From Number) from the `admin_settings` table at call time — not from environment variables.

If `orderId` is provided, the outbound message is logged to the `messages` table under the customer's `sms_conversations` record.

---

## Email Template System (`src/lib/emailTemplateBase.ts`)

All HTML emails are built using a shared component library. Templates use table-based HTML for compatibility with email clients.

### Wrapper

```typescript
createEmailWrapper(content: string, options?: {
  title?: string
  preheader?: string
  theme?: EmailTheme
}): string
```

Renders the outer email shell with the company logo, a header section, the body content, and a branded footer with contact information.

- Logo URL: stored in Supabase public storage
- Footer includes company phone: (313) 889-3860

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
| `orderEmailTemplates.ts` | Order status changes, admin notifications |
| `transactionReceiptService.ts` | Admin receipt on each payment event |

---

## Notification Reliability (`src/lib/notificationReliability.ts`)

Every email and SMS send is wrapped with failure tracking:

- `recordNotificationFailure(context)` — calls a database RPC to log the failure with recipient, subject, error message, and order ID.
- `recordNotificationSuccess(type)` — resets the consecutive failure counter.
- `shouldNotifyAdmin()` — returns true if 3+ consecutive failures have occurred for a notification type.
- `getUnresolvedFailures()` — returns up to 50 unresolved failures for the admin dashboard.

The admin Notification Failures panel (`src/components/admin/NotificationFailuresAlert.tsx`) displays active failures and allows marking them resolved.

---

## SMS Message Templates

Admins manage reusable SMS templates in the admin Message Templates tab. Templates are stored in the `sms_message_templates` table and can be selected when composing messages from the order detail view.

Variable placeholders (e.g., customer name, event date, order ID) are substituted at send time.

---

## Twilio Inbound (Webhook)

Inbound SMS from customers is received by the `twilio-webhook` edge function. It:

1. Validates the Twilio signature.
2. Finds or creates an `sms_conversations` record for the sender's phone number.
3. Stores the message in `messages`.
4. Forwards the message content to the admin via SMS and email notification.

The admin can reply from the order detail SMS conversation panel, which calls `send-sms-notification` directly.
