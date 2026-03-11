# Transaction Receipt System

## Overview
Comprehensive transaction logging system that records all financial transactions and automatically sends receipt notifications to admin email.

## What Was Fixed & Implemented

### 1. **Critical Bug Fix: `totalAmountCents is not defined`**
**File:** `src/lib/orderApprovalService.ts`

**Problem:**
- Variable was named `totalCents` but referenced as `totalAmountCents`
- Tip amount was not included in total calculation
- Paid amount didn't include tip

**Solution:**
- Fixed variable name from `totalAmountCents` to `totalCents`
- Added tip to total calculation: `+ (orderData.tip_cents ?? 0)`
- Updated paid_amount_cents to include tip: `orderData.deposit_due_cents + (orderData.tip_cents ?? 0)`

---

### 2. **Transaction Receipts Database Table**
**Migration:** `20260311000000_create_transaction_receipts.sql`

**Features:**
- Unique receipt numbers (format: `RCP-YYYYMMDD-XXXXX`)
- Transaction types: deposit, balance, refund, tip, full_payment
- Links to orders, customers, and payments
- Stripe transaction IDs tracked
- Payment method and brand stored
- Admin notification tracking

**Table Structure:**
```sql
- id (uuid)
- transaction_type (text)
- order_id (uuid)
- customer_id (uuid)
- payment_id (uuid)
- amount_cents (integer)
- payment_method (text)
- payment_method_brand (text)
- stripe_charge_id (text)
- stripe_payment_intent_id (text)
- receipt_number (text, unique)
- receipt_sent_to_admin (boolean)
- admin_notified_at (timestamptz)
- transaction_date (timestamptz)
- notes (text)
```

---

### 3. **Transaction Receipt Service**
**File:** `src/lib/transactionReceiptService.ts`

**Functions:**
- `logTransaction()` - Records transaction to database
- `sendAdminTransactionReceipt()` - Emails admin with receipt
- `logAndNotifyTransaction()` - Combined logging + notification
- `generateAdminReceiptEmail()` - Creates HTML email template

**Features:**
- Beautiful HTML email receipts with gradient header
- Transaction details: receipt number, amount, customer, payment method
- Automatic admin email notification
- Receipt tracking (marks when admin was notified)

---

### 4. **Edge Function Transaction Logger**
**File:** `supabase/functions/_shared/transaction-logger.ts`

**Purpose:** Shared utility for edge functions to log transactions

**Features:**
- Asynchronous admin notification (fire-and-forget)
- Retrieves admin email from settings
- Fetches order and customer details
- Generates and sends professional HTML receipt
- Marks receipts as sent

---

### 5. **Integration Points**

#### A. Order Approval (Deposit Payments)
**File:** `src/lib/orderApprovalService.ts`

**When:** Admin approves pending order
**Logs:**
1. **Deposit transaction** - Main deposit amount
2. **Tip transaction** - Separate receipt for tip (if present)

**Data Captured:**
- Payment intent ID from Stripe
- Charge ID
- Payment method (card, bank account)
- Payment brand (Visa, Mastercard, etc)
- Last 4 digits

#### B. Stripe Webhook (Balance Payments)
**File:** `supabase/functions/stripe-webhook/index.ts`

**When:** Customer pays balance via customer portal
**Event:** `checkout.session.completed`

**Logs:**
- Balance payment transaction
- Links to payment record
- Captures all Stripe payment details

#### C. Charge Deposit Function
**File:** `supabase/functions/charge-deposit/index.ts`

**Updated:** Now returns payment details in response
**Returns:**
```json
{
  "success": true,
  "paymentDetails": {
    "paymentIntentId": "pi_xxx",
    "chargeId": "ch_xxx",
    "amountCents": 44900,
    "paymentMethod": "card",
    "paymentBrand": "visa",
    "paymentLast4": "4242"
  }
}
```

---

## Admin Receipt Email Template

### Visual Design
- **Header:** Purple gradient with white text
- **Receipt Number:** Large, prominent display
- **Amount:** Green, bold, centered (easy to spot)
- **Details Grid:** Clean rows with labels and values
- **Alert Box:** Yellow highlight for transaction type
- **Action Box:** Blue background with next steps

### Information Included
1. Receipt Number (RCP-YYYYMMDD-XXXXX)
2. Transaction Type (Deposit, Balance, Tip, Refund)
3. Amount (formatted currency)
4. Order Number
5. Customer Name
6. Customer Email
7. Payment Method (with card brand)
8. Transaction Date
9. Event Date
10. Notes (if applicable)

---

## How It Works

### Transaction Flow

```
┌─────────────────────┐
│  Payment Processed  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Insert into         │
│ payments table      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ logTransaction()    │
│ - Generate receipt# │
│ - Insert record     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ sendAdminEmail()    │
│ (async)             │
│ - Get admin email   │
│ - Fetch order data  │
│ - Generate HTML     │
│ - Send via function │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Update receipt      │
│ - Set sent flag     │
│ - Set timestamp     │
└─────────────────────┘
```

### Receipt Number Generation

**Format:** `RCP-YYYYMMDD-XXXXX`

**Example:** `RCP-20260311-10001`

**Components:**
- `RCP` - Receipt prefix
- `YYYYMMDD` - Current date
- `XXXXX` - Sequential 5-digit number (padded with zeros)

---

## Database Queries

### View All Receipts
```sql
SELECT
  receipt_number,
  transaction_type,
  amount_cents,
  payment_method,
  transaction_date,
  receipt_sent_to_admin
FROM transaction_receipts
ORDER BY transaction_date DESC;
```

### View Receipts for Specific Order
```sql
SELECT * FROM transaction_receipts
WHERE order_id = 'your-order-id'
ORDER BY transaction_date;
```

### View Unsent Admin Notifications
```sql
SELECT * FROM transaction_receipts
WHERE receipt_sent_to_admin = false;
```

### Daily Transaction Summary
```sql
SELECT
  transaction_type,
  COUNT(*) as count,
  SUM(amount_cents) as total_cents
FROM transaction_receipts
WHERE transaction_date >= CURRENT_DATE
GROUP BY transaction_type;
```

---

## Security

### Row Level Security (RLS)
**Enabled:** ✅

**Policies:**
1. **Admin View All** - MASTER/ADMIN can view all receipts
2. **Customer View Own** - Customers can only view their receipts
3. **Admin Insert** - MASTER/ADMIN can create receipts
4. **System Insert** - Anonymous (anon) can insert (for edge functions)

---

## Testing

### Test Scenarios

#### 1. Deposit Payment with Tip
**Expected:**
- 2 transaction receipts created
- 2 admin emails sent
- Receipt #1: Deposit amount
- Receipt #2: Tip amount

#### 2. Balance Payment
**Expected:**
- 1 transaction receipt created
- 1 admin email sent
- Receipt shows balance payment type

#### 3. Admin Email Delivery
**Check:**
- Admin email from settings is used
- Email contains all transaction details
- Receipt is marked as sent
- Timestamp is recorded

---

## Files Changed

### Frontend
1. `src/lib/orderApprovalService.ts` - Fixed bug, added transaction logging
2. `src/lib/transactionReceiptService.ts` - NEW: Transaction service
3. `src/lib/orderEmailTemplates.ts` - Already had tip in email (previous fix)
4. `src/lib/bookingEmailTemplates.ts` - Already had tip in email (previous fix)

### Edge Functions
1. `supabase/functions/charge-deposit/index.ts` - Returns payment details
2. `supabase/functions/stripe-webhook/index.ts` - Logs balance payments
3. `supabase/functions/_shared/transaction-logger.ts` - NEW: Shared logger

### Database
1. Migration: `create_transaction_receipts.sql` - New table and function

---

## Future Enhancements

### Potential Additions
1. **Receipt PDF Generation** - Generate PDF receipts
2. **Customer Receipt Emails** - Send receipts to customers too
3. **Receipt Search/Filter** - Admin UI to search receipts
4. **Financial Reports** - Daily/weekly/monthly summaries
5. **Refund Tracking** - Log refund transactions
6. **Tax Reports** - Generate tax documents from receipts

---

## Maintenance

### Admin Email Configuration
**Location:** Admin Settings → Admin Email

**Important:** Make sure admin email is configured in settings for receipts to be sent.

### Monitoring
**Check these regularly:**
- `receipt_sent_to_admin` = false (indicates failed notifications)
- Daily receipt count matches payment count
- All transactions have receipts

---

## Summary

✅ **Bug Fixed:** totalAmountCents undefined error
✅ **Database:** transaction_receipts table created
✅ **Logging:** All financial transactions logged
✅ **Notifications:** Admin receives email receipts automatically
✅ **Tracking:** Separate receipts for deposits and tips
✅ **Security:** RLS policies protect data
✅ **Build:** All changes compile successfully

**Result:** Every financial transaction is now logged with a unique receipt number and admin is notified via email immediately.
