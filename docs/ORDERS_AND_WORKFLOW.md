# Orders and Workflow

## Overview

An order is the central record of the application. It is created when a customer submits a quote, moves through a defined status lifecycle, and is eventually completed or cancelled. This document covers the full lifecycle of an order from creation through completion.

---

## Order Creation (`src/lib/orderCreation.ts`)

Order creation happens when a customer submits the quote form. The process:

1. **Early Rejection Gates** — client-side blackout date check and unit availability check. These prevent obvious invalid submissions but are not the trusted enforcement gate (Stripe checkout is).

2. **Customer Handling** — looks up customer by email. If found, updates; if new, creates. The customer record is linked to the order.

3. **Address Handling** — calls `upsertCanonicalAddress()` to create or find a deduplicated address record. The address is geocoded (lat/lng stored for travel fee calculation).

4. **Order Record Creation** — inserts the `orders` record with:
   - Status = `draft`
   - All pricing fields (subtotal, fees, tax, deposit, balance)
   - Fee waiver flags if admin applied any waivers in the quote
   - Consent flags (SMS, card-on-file) from the form

5. **Order Items** — creates `order_items` records for each unit in the cart with a snapshot of the price at time of booking.

6. **Discounts and Custom Fees** — if provided, creates `order_discounts` and `order_custom_fees` records.

7. **Invoice Dispatch** — calls the `send-invoice` edge function to send the invoice email and SMS to the customer.

8. **Return** — returns the order ID to redirect the customer to `/checkout/:orderId`.

---

## Order Lifecycle States

### Status Transitions

Valid transitions are enforced server-side by the `validate_order_status_transition` PostgreSQL function. Invalid transitions are rejected with an error.

```
draft
  → pending_review       (customer submits checkout form)

pending_review
  → confirmed            (admin approves with zero deposit or after card save)
  → awaiting_customer_approval  (admin sends edited order for review)
  → cancelled            (admin rejects)
  → void                 (admin voids)

awaiting_customer_approval
  → confirmed            (customer approves changes)
  → cancelled            (customer or admin rejects)

confirmed
  → in_progress          (crew marks en-route on event day)
  → cancelled            (admin cancels)
  → void                 (admin voids)

in_progress
  → completed            (event done, pickup complete)
  → cancelled            (rare edge case)

completed
  → (terminal, no transitions)

cancelled
  → (terminal, no transitions)

void
  → (terminal, no transitions)
```

### Order Lifecycle Edge Function (`order-lifecycle`)

The `order-lifecycle` edge function is the authoritative handler for status transitions. It:
1. Validates the requested transition
2. Applies the status change to the `orders` table
3. Logs the change to `order_changelog`
4. Triggers admin notifications for key transitions (e.g., admin alert when order moves to `pending_review`)
5. Handles `paymentOutcome` tracking for financial reconciliation

Called from:
- Frontend after successful Stripe checkout (draft → pending_review → confirmed)
- Admin approval flow
- Customer approval/rejection in portal

---

## Order Approval Service (`src/lib/orderApprovalService.ts`)

The most complex order workflow. Triggered when admin clicks "Approve" on a `pending_review` or `awaiting_customer_approval` order.

### Standard Approval Flow

1. **Availability Revalidation** — re-checks all order items are still available. Prevents overbooking if another order was confirmed concurrently.

2. **Deposit Decision:**
   - If `deposit_due_cents <= 0`: Skip charging, immediately confirm. Customer receives confirmation.
   - If `deposit_due_cents > 0`: Call `charge-deposit` edge function to charge saved card.

3. **Card Decline Handling** — if charge fails:
   - Customer receives email and SMS with a link to update payment method
   - Order remains unapproved
   - Admin is notified

4. **Invoice Creation** — creates an `invoices` record with status:
   - `paid` if full payment collected
   - `partial` if deposit only collected
   - `sent` if no payment collected (zero deposit waived)

5. **Transaction Receipt Logging** — logs to `transaction_receipts` and sends receipt email to admin via `logAndNotifyTransaction()`.

6. **Status Transition** — calls `order-lifecycle` edge function with `paymentOutcome` parameter to move order to `confirmed`.

7. **Customer Notifications** — sends confirmation email and SMS.

### Force Approve (Admin Override)

Admin can bypass deposit collection entirely by using "Force Approve." The order is confirmed without any charge. Useful for cash-pay customers or manual override situations.

### Zero-Deposit Case

When `deposit_due_cents` is 0 (either naturally or through admin override), the approval flow skips charging and moves directly to confirmed. A card may still be on file for balance collection.

### Payment Outcome Values

The `paymentOutcome` parameter passed to `order-lifecycle` controls how the order's financial state is recorded:

| Value | Meaning |
|---|---|
| `waived` | Admin waived the deposit |
| `already_paid` | Payment was collected earlier |
| `charged_now` | Deposit just charged successfully |
| `zero_due_with_card` | Zero deposit, card saved |
| `full_paid` | Full amount collected |
| `custom_paid` | Custom amount collected |
| `cash` | Cash payment outside Stripe |

---

## Order Edit and Modification (`src/lib/orderSaveService.ts`)

Admins can modify confirmed orders. Changes are sent to the customer for approval before taking effect (unless admin overrides).

### Change Detection

The service compares the edited order against the original field by field:
- Event date, start/end time, pickup preference
- Event location, surface type, setup details
- Address
- Order items (additions and removals)
- Custom fees and discounts
- Pricing fields

### Availability Validation

If items or dates changed, availability is re-checked for the new configuration. If conflicts exist, the save is rejected with a specific error.

### Atomic Update

All changes are applied atomically:
1. Updates `orders` record
2. Deletes and recreates `order_items` if items changed
3. Deletes and recreates `order_discounts` if discounts changed
4. Deletes and recreates `order_custom_fees` if fees changed
5. Upserts address if address changed

### Changelog Logging

Every changed field is recorded to `order_changelog`:
```
field_changed: "surface"
old_value: "grass"
new_value: "concrete"
change_type: "edit"
user_id: <admin user id>
notes: optional context
```

### Customer Approval Flow

After saving changes, the order moves to `awaiting_customer_approval` (unless admin forces immediate confirm):
1. Order status set to `awaiting_customer_approval`
2. `awaiting_customer_approval` flag set to `true`
3. `customer_approval_requested_at` timestamp recorded
4. `edit_summary` text stored on order
5. Customer receives email and SMS with portal link to review changes

In the Customer Portal, the customer sees what changed and can:
- **Approve** → calls `atomic_approve_order` RPC → order returns to `confirmed`
- **Reject** → logs rejection to changelog, notifies admin, admin must decide next step

---

## Order Cancellation

### Admin Cancellation

Admins can cancel any non-terminal order from the Order Detail Modal. The status dialog captures a reason. Cancellation:
1. Sets `status = 'cancelled'`
2. Records `cancelled_at`, `cancelled_by`, `cancellation_reason`
3. Logs to `order_changelog`
4. Sends customer notification

### Customer Cancellation (`customer-cancel-order` edge function)

Customers cancel from the Customer Portal. The flow:
1. Customer selects cancellation reason from a standardized list
2. Customer optionally checks "I'd like a refund"
3. Edge function updates order: `status = 'cancelled'`, `cancellation_reason`, `refund_requested`
4. Logs to `order_changelog`
5. Notifies admin via SMS and email
6. Customer receives cancellation confirmation

`refund_requested = true` is a flag only — it does not trigger an automatic refund. The admin must review and process any refund manually from the Payments tab.

---

## Order Changelog (`order_changelog` table)

Every significant action on an order is recorded:

| change_type | When Used |
|---|---|
| `status_change` | Order status transition |
| `edit` | Field changed by admin |
| `payment` | Payment recorded |
| `cancellation` | Order cancelled |
| `approval` | Customer approved changes |
| `rejection` | Customer rejected changes |
| `note` | Admin added a note |

Each entry has:
- `order_id` — which order
- `user_id` — who made the change (null for anonymous customer actions)
- `field_changed` — what was changed
- `old_value`, `new_value` — before and after
- `change_type` — category
- `notes` — optional context

The changelog is visible in the Order Detail Modal's Changelog tab and is used for admin audit purposes.

---

## Order Notes (`order_notes` table)

Internal admin notes not visible to customers. Each note has:
- `order_id`
- `user_id` — which admin wrote it
- `note` — free text
- `created_at`

Notes appear in the Order Detail Modal's Notes tab.

---

## Order Archival

Orders more than a configured number of months old and in a terminal state (`completed`, `cancelled`, `void`) can be archived. The `archive_old_orders()` database function marks them with an `archived_at` timestamp. Archived orders are hidden from the default admin order list but remain in the database for audit and financial reporting.

---

## Order Duplication (`src/hooks/useOrderDuplication.ts`)

Admins can duplicate any existing order from the Order Detail Modal. This creates a new `draft` order with the same items, address, and configuration, allowing quick re-booking for repeat customers or events.

---

## Invoice System (`src/lib/invoiceService.ts`)

### Invoice Creation

An invoice is created automatically when an order is approved. It captures a snapshot of the order's financial state:
- Line items (units, quantity, price)
- All fee line items (travel, surface, same-day pickup, generator)
- Custom fees and discounts
- Tax
- Payment collected

### Invoice Statuses

| Status | Meaning |
|---|---|
| `draft` | Created but not sent to customer |
| `sent` | Sent to customer; payment pending |
| `partial` | Deposit received; balance outstanding |
| `paid` | Fully paid |
| `void` | Invoice voided |

### Invoice Links and Short URLs

The `invoice_links` table is the access control layer for all unauthenticated customer-facing order links. Every record has:

- `link_token` — a 64-character hex token used in full URLs (e.g., `/customer-portal/:orderId?t=:token`)
- `short_code` — an 8-character URL-safe code used in compact URLs (e.g., `/i/:shortCode`)
- `link_type` — distinguishes the purpose of the link:
  - `invoice` — created by `send-invoice` edge function when admin sends an invoice
  - `portal_shortlink` — created by `createShortPortalLink()` for crew ETA SMS messages
- `expires_at` — links expire 3 days after the event date (or 30 days from creation if no event date)
- `deposit_cents` — the deposit amount at time the invoice link was created

**Short URL Route (`/i/:shortCode`):** The `ShortLink` component handles the `/i/:shortCode` route. It looks up the short code in `invoice_links`, extracts the `order_id` and `link_token`, and immediately redirects to `/customer-portal/:orderId?t=:token`. This allows compact SMS-friendly links to resolve to the full customer portal.

### Admin Invoice Sending (`send-invoice` edge function)

Admins send invoices from the Invoice Builder or from an order's detail view. The `send-invoice` edge function:

1. Creates an `invoice_links` record with `link_type: 'invoice'`
2. Generates a unique `short_code` (8 characters, up to 5 collision retry attempts)
3. Sets expiry 3 days after the event date (or 30 days if no event date)
4. Updates `invoice_sent_at` on the order
5. Sends both email and SMS in parallel (fire-and-forget via `EdgeRuntime.waitUntil`):
   - **Email** — calls `send-email` edge function with a full HTML invoice summary including total amount, deposit due, and a styled "View & Accept Invoice" button linking to the full token URL
   - **SMS** — calls `send-sms-notification` with the compact short URL (e.g., `https://bouncepartyclub.com/i/AbCdEfGh`)
6. Returns `invoiceUrl` (full token URL), `shortInvoiceUrl` (short URL), `shortCode`, and `linkToken` to the caller

The full token URL is used in emails; the short URL is used in SMS messages to stay within character limits.

### Invoice Builder

Admins can manually build invoices from the Invoices tab with:
- Customer selector (search existing or create new)
- Line item editor (add/remove/edit items)
- Custom fee and discount editor
- Admin message field
- Send via email/SMS or generate link

---

## Checkout Bridge (`checkout-bridge` edge function)

The `checkout-bridge` edge function orchestrates the handoff between checkout completion and order lifecycle progression. After Stripe redirects the customer to `/payment-complete`, this function:
1. Receives the Stripe session ID
2. Verifies payment status
3. Updates order status from `draft` to `pending_review`
4. Triggers admin notification
5. Returns the updated order for display on the success page

---

## Order State Machine (`src/lib/orderStateMachine.ts`)

Defines valid status transitions and business rules for moving orders between states. Used client-side to determine which actions are available for a given order status, and server-side via the `validate_order_status_transition` database function.

---

## Lifecycle Notification Flags

The `orders` table has two flags to prevent duplicate admin notifications:

| Flag | Purpose |
|---|---|
| `pending_review_admin_alerted` | Admin has been notified this order is pending review |
| `confirmed_admin_alerted` | Admin has been notified this order is confirmed |

These prevent the admin from receiving multiple notifications if the webhook fires more than once or if the lifecycle function is called multiple times.
