# Orders and Workflow

## Overview

An order is the central record of the application. It is created when a customer submits a quote, moves through a defined status lifecycle, and is eventually completed or cancelled. This document covers the full lifecycle of an order from creation through completion.

---

## Order Creation (`src/lib/orderCreation.ts`)

Order creation happens when a customer submits the quote form. The process:

1. **Early Rejection Gates** — client-side blackout date check (`check_date_blackout` RPC) and unit availability check. These are pre-validation only; the authoritative enforcement gates are server-side at Stripe checkout.

2. **Customer Handling** — looks up customer by email. If found, updates; if new, creates. The customer record is linked to the order.

3. **Address Handling** — calls `upsertCanonicalAddress()` to create or find a deduplicated address record. The address is geocoded (lat/lng stored for travel fee calculation).

4. **Order Record Creation** — inserts the `orders` record with:
   - `status = 'draft'`
   - All pricing fields (subtotal, fees, tax, deposit, balance)
   - Fee waiver flags if admin applied any waivers in the quote
   - Consent flags (SMS, card-on-file) from the form
   - Referral source and detail fields
   - Billing address fields from checkout

5. **Order Items** — creates `order_items` records for each unit in the cart with a snapshot of the price at time of booking.

6. **Discounts and Custom Fees** — if provided, creates `order_discounts` and `order_custom_fees` records.

7. **Invoice Dispatch** — calls the `send-invoice` edge function to send the invoice email and SMS to the customer.

8. **Return** — returns the order ID to redirect the customer to `/checkout/:orderId`.

---

## Notable Order Fields

The `orders` table has many fields. Key ones beyond basic customer and pricing data:

| Field | Purpose |
|---|---|
| `status` | Lifecycle state (see below) |
| `workflow_status` | Crew operations state (separate from lifecycle) |
| `admin_message` | Admin note displayed to customer in their portal |
| `require_card_on_file` | Forces setup-mode checkout even if no charge is needed |
| `awaiting_customer_approval` | Set when admin sends order for customer review |
| `customer_approval_requested_at` | Timestamp of approval request |
| `customer_approved_at` | Timestamp of customer approval |
| `edit_summary` | Text description of changes sent for customer review |
| `booking_confirmation_sent` | Whether the confirmation email/SMS has been sent |
| `invoice_sent_at` | When invoice was dispatched |
| `invoice_accepted_at` | When customer accepted invoice via portal |
| `pending_review_admin_alerted` | Prevents duplicate admin alerts on new orders |
| `confirmed_admin_alerted` | Prevents duplicate admin alerts on confirmation |
| `lot_pictures_requested` | Admin has requested lot photos |
| `lot_pictures_requested_at` | When lot photos were requested |
| `waiver_signed_at` | When the waiver was signed |
| `signed_waiver_url` | URL to signed waiver PDF in storage |
| `same_day_responsibility_accepted` | Customer accepted same-day pickup terms |
| `overnight_responsibility_accepted` | Customer accepted overnight rental terms |
| `cancellation_reason` | Why the order was cancelled |
| `cancelled_at`, `cancelled_by` | Cancellation timestamp and actor |
| `refund_requested` | Customer flagged wanting a refund (informational only) |
| `archived_at` | Set when order is archived |
| `referral_source` | How customer heard about the business |
| `referral_source_detail` | Free-text detail for referral source |
| `billing_address_line1/city/state/zip` | Stripe billing address (separate from event address) |
| `generator_qty` | Number of generators requested (integer; separate from `generator_selected` boolean) |
| `stripe_payment_status` | Stripe payment state; set to `'paid'` on zero-deposit approvals to signal the obligation is satisfied without an actual charge |
| `clear_payment_info` | Signals saved Stripe payment method should be cleared when items change or deposit increases |
| `current_eta` | Current crew ETA timestamp |
| `e_signature_consent` | Whether the signer accepted the electronic consent checkbox |
| `damage_charged_cents` | Amount charged for equipment damage |

---

## Order Lifecycle States

### Status Transitions

Valid transitions are enforced server-side by the `validate_order_status_transition` PostgreSQL function. Invalid transitions are rejected with an error before any change is applied. The same-status "transition" (no change) is always permitted.

```
draft
  → pending_review       (customer submits checkout / payment initiated)

pending_review
  → confirmed            (admin approves; deposit charged or waived)
  → awaiting_customer_approval  (admin sends edited order for review)
  → cancelled            (admin rejects)
  → void                 (admin voids)

awaiting_customer_approval
  → confirmed            (customer approves changes via portal)
  → pending_review       (customer rejects — returns to review queue)
  → cancelled            (customer or admin rejects)

confirmed
  → in_progress          (crew marks en-route on event day)
  → awaiting_customer_approval  (admin sends additional changes for review)
  → cancelled            (admin cancels)
  → void                 (admin voids)

in_progress
  → completed            (event done, pickup complete)
  → cancelled            (rare edge case)
  → void                 (rare edge case)

completed
  → (terminal, no transitions)

cancelled
  → (terminal, no transitions)

void
  → (terminal, no transitions)
```

Cancellable statuses: `draft`, `pending_review`, `awaiting_customer_approval`, `confirmed` only.

### Order Lifecycle Edge Function (`order-lifecycle`)

The `order-lifecycle` edge function is the authoritative handler for status transitions. It:
1. Validates the requested transition
2. Applies the status change to the `orders` table
3. Logs the change to `order_changelog`
4. Triggers admin notifications for key transitions

**`enter_pending_review` action:**
- Sends admin SMS with "NEW BOOKING REQUEST" alert
- Sends admin email with order details and admin panel link
- Sets `pending_review_admin_alerted = true` (idempotency guard to prevent duplicate alerts)

**`enter_confirmed` action:**
- Verifies `deposit_paid_cents >= deposit_due_cents` unless `paymentOutcome` signals a waiver or zero-due case
- Sends admin SMS with "BOOKING CONFIRMED" and payment status
- Sends admin email with deposit/balance breakdown
- Sets `confirmed_admin_alerted = true` (idempotency guard)

Called from:
- Frontend after successful Stripe checkout (draft → pending_review)
- Admin approval flow (pending_review → confirmed)
- Customer approval/rejection in portal (awaiting_customer_approval → confirmed or cancelled)

---

## Order Approval Service (`src/lib/orderApprovalService.ts`)

The most complex order workflow. Triggered when admin clicks "Approve" on a `pending_review` or `awaiting_customer_approval` order.

### Standard Approval Flow

1. **Idempotency Guard** — aborts if order is already `confirmed`, `cancelled`, or `void`.

2. **Availability Revalidation** — re-checks all order items are still available. Prevents overbooking if another order was confirmed concurrently.

3. **Deposit Decision:**
   - If `deposit_due_cents <= 0`: Set `stripe_payment_status = 'paid'` (signals waived), skip charging, immediately confirm.
   - If `deposit_due_cents > 0`: Call `charge-deposit` edge function to charge saved card.

4. **Card Decline Handling** — if charge fails:
   - Customer receives email and SMS with a link to update payment method
   - Order remains unapproved
   - Admin is notified

5. **Invoice Creation** — creates an `invoices` record with status:
   - `paid` if full payment collected
   - `partial` if deposit only collected
   - `sent` if no payment collected (zero deposit)
   - Invoice number generated via `generate_invoice_number` RPC or fallback `INV-${Date.now()}`

6. **Transaction Receipt Logging** — calls `logGroupedTransactions()` to log deposit and optional tip as separate receipt rows sharing a `receipt_group_id`.

7. **Status Transition** — calls `order-lifecycle` edge function with `paymentOutcome` parameter to move order to `confirmed`.

8. **Customer Notifications** — sends confirmation email and SMS with portal link.

### Force Approve (Admin Override)

Admin can bypass deposit collection entirely by using "Force Approve." The order is confirmed without any charge. Calls `enterConfirmed()` with `paymentOutcome: 'waived'`. Useful for cash-pay customers or manual override situations.

### Zero-Deposit Case

When `deposit_due_cents` is 0 (either naturally or through admin override), the approval flow sets `stripe_payment_status = 'paid'` to signal the payment obligation is satisfied, then moves directly to confirmed without any Stripe involvement.

### Payment Outcome Values

| Value | Meaning |
|---|---|
| `waived` | Admin waived the deposit |
| `already_paid` | Payment was collected earlier |
| `charged_now` | Deposit just charged successfully |
| `zero_due_with_card` | Zero deposit, card saved for future use |
| `full_paid` | Full amount collected |
| `custom_paid` | Custom amount collected |
| `cash` | Cash payment outside Stripe |

---

## Short Order ID Lookup

Admins and crew can look up orders by entering a short prefix of the order UUID (up to 8 characters) in the `SingleOrderView` component. When the entered string is 8 characters or fewer, the `find_order_id_by_prefix` SECURITY DEFINER RPC is called instead of a direct lookup. This RPC performs a case-insensitive prefix match on `orders.id::text` and returns the full UUID, which is then used for the standard order detail load.

The RPC returns `null` if no match is found or if the prefix is ambiguous (multiple matches).

---

## Order Edit and Modification (`src/lib/orderSaveService.ts`)

Admins can modify confirmed orders. Changes can be sent to the customer for approval before taking effect, or applied immediately (admin override).

### Change Detection

The service compares the edited order against the original field by field. Only fields that differ are written to the database. Tracked fields include:
- Event date, start/end time, pickup preference, overnight allowed
- Event location, surface type, generator qty, setup details
- Address (any component: line1, city, state, zip)
- Order items (additions and removals)
- Custom fees and discounts
- All pricing and fee waiver fields

### Deposit Catch-Up Logic

When editing a confirmed order that has already had a deposit charged:
- If the new deposit requirement exceeds what was already paid, a `deposit_catchup_cents` field is calculated.
- `depositCatchupMode === 'require'`: the catch-up amount is added to the balance due.
- `depositCatchupMode === 'waive'`: the catch-up is waived; already-captured amount is used as the deposit.

### Payment Method Clearing

The saved Stripe payment method (`stripe_payment_method_id`) is cleared when:
1. Any items are added or deleted
2. Deposit increased above already-captured amount
3. Order was paid in full but total increased

This forces the customer to re-enter payment details for the updated amount.

### Atomic Update

All changes are applied atomically:
1. Updates `orders` record (only changed fields)
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
3. Updates any pending payment records to `cancelled` status
4. Logs to `order_changelog`
5. Sends customer notification

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

Orders more than a configured number of months old and in a terminal state (`completed`, `cancelled`, `void`) can be archived. The `archive_old_orders()` database function (admin-only RPC) marks them with an `archived_at` timestamp. Archived orders are hidden from the default admin order list but remain in the database for audit and financial reporting.

---

## Order Duplication (`src/hooks/useOrderDuplication.ts`)

Admins can duplicate any existing order from the Order Detail Modal. This creates a new booking prefilled with the same items, address, and configuration.

### Duplication Flow

1. Loads the original order and its items (with unit active status).
2. Filters out inactive units. If all items are inactive, the duplication is aborted. If some are inactive, a confirmation dialog asks if the admin wants to proceed with only the valid items.
3. Writes prefill data to `localStorage` (7-day expiration) via `safeStorage`:
   - `bpc_cart` — array of valid cart items
   - `bpc_quote_prefill` — address, setup details, time windows (event dates intentionally cleared so the user must re-select)
   - `bpc_contact_data` — customer contact information
   - `bpc_duplicate_order: 'true'` — signals the quote form this is a duplication
4. Fires a custom `bpc-cart-updated` DOM event so any open cart component refreshes.
5. Navigates to `/quote`.

Event dates are always blank in the duplication. Time windows (`start_window`, `end_window`) are preserved from the original order.

---

## Invoice System (`src/lib/invoiceService.ts`)

### Invoice Creation

An invoice is created automatically when an order is approved. It captures a snapshot of the order's financial state:
- Line items (units, quantity, price)
- All fee line items (travel, surface, same-day pickup, generator)
- Custom fees and discounts
- Tax
- Payment collected to date

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

- `link_token` — a 64-character hex token used in full URLs (`/customer-portal/:orderId?t=:token`)
- `short_code` — an 8-character URL-safe code used in compact URLs (`/i/:shortCode`). Uses an unambiguous character set (no `0`, `O`, `1`, `I`, `l`).
- `link_type` — `invoice` (created by `send-invoice`) or `portal_shortlink` (created for SMS via `createShortPortalLink()`)
- `expires_at` — 3 days after event date (or 30 days from creation if no event date)
- `deposit_cents` — snapshot of deposit at invoice link creation time

**Short URL Route (`/i/:shortCode`):** The `ShortLink` component handles this route. It looks up the short code, extracts the `order_id` and `link_token`, and immediately redirects to `/customer-portal/:orderId?t=:token`.

### Admin Invoice Sending (`send-invoice` edge function)

The `send-invoice` edge function:
1. Creates an `invoice_links` record with `link_type: 'invoice'`
2. Generates a unique `short_code` (8 characters, up to 5 collision retry attempts)
3. Sets expiry 3 days after the event date
4. Updates `invoice_sent_at` on the order
5. Resolves the site origin from the request `Origin` header, then `SITE_URL` env, then defaults to `https://bouncepartyclub.com`
6. Sends both email and SMS in parallel (fire-and-forget via `EdgeRuntime.waitUntil`):
   - **Email** — full HTML invoice with "View & Accept Invoice" button linking to full token URL
   - **SMS** — compact short URL (e.g., `https://bouncepartyclub.com/i/AbCdEfGh`)
7. Returns `invoiceUrl`, `shortInvoiceUrl`, `shortCode`, and `linkToken` to the caller

### Invoice Builder

Admins can manually build invoices from the Invoices tab with:
- Customer selector (search existing or create new)
- Line item editor (add/remove/edit items)
- Custom fee and discount editor
- Admin message field
- Send via email/SMS or generate link only

---

## Checkout Bridge (`checkout-bridge` edge function)

The `checkout-bridge` is a minimal HTML page served from the Supabase edge function domain. After the customer completes payment on Stripe's hosted checkout, Stripe redirects to this page with query parameters: `orderId`, `session_id`, and `origin`.

The page's inline JavaScript:
1. Reads `orderId`, `session_id`, and `origin` from the URL query string
2. Calls `window.opener.postMessage({ type: 'BPC_CHECKOUT_COMPLETE', orderId, session_id }, origin)` to send the payment completion signal back to the original checkout window
3. Calls `window.close()` to close itself

The original checkout tab listens for the `BPC_CHECKOUT_COMPLETE` message and navigates to the booking confirmation page.

**Why this exists:** Stripe cannot redirect to `localhost` or arbitrary development URLs. The bridge lives on the Supabase domain (always accessible, no CORS issues) and acts as a secure cross-domain relay. Actual payment reconciliation (verifying the session, recording payment, updating order status, sending emails) is handled by the `stripe-webhook` edge function processing Stripe's webhook — not by this bridge page.

---

## Order State Machine (`src/lib/orderStateMachine.ts`)

Defines valid status transitions and business rules for moving orders between states. Used client-side to determine which actions are available for a given order status. The server-side equivalent is the `validate_order_status_transition` database function, which rejects any write that would violate the state machine.

Key behaviors:
- Same-status transitions are always valid (no-ops permitted)
- `getAvailableStatuses(currentStatus)` returns the valid next states for UI control enabling
- `formatStatusName(status)` converts snake_case to Title Case for display

---

## Lifecycle Notification Flags

The `orders` table has two flags to prevent duplicate admin notifications:

| Flag | Purpose |
|---|---|
| `pending_review_admin_alerted` | Admin has been notified this order is pending review |
| `confirmed_admin_alerted` | Admin has been notified this order is confirmed |

These prevent the admin from receiving multiple notifications if the webhook fires more than once or if the lifecycle function is called multiple times for the same transition.
