# Stripe Payment Integration Guide

## Overview

Your application now has full Stripe payment integration with the ability to collect deposits, store payment methods on file, and charge customers later for damages or remaining balances.

## Features Implemented

### 1. **Secure Payment Collection**
- Customers enter their payment information through Stripe's secure hosted form
- PCI-compliant payment processing (you never handle raw card data)
- Real-time payment validation and error handling

### 2. **Card-on-File Storage**
- Payment methods are securely stored with Stripe
- Enables charging customers after the event without them being present
- Perfect for damage fees, late fees, or remaining balance charges

### 3. **Admin Payment Management**
- View all payments associated with an order
- Charge saved payment methods for balance or damage fees
- Track payment history with detailed descriptions
- Real-time payment status updates

### 4. **Payment Tracking**
- Database records for all transactions
- Separate tracking for deposits, balance payments, damage charges, and refunds
- Payment history visible in admin panel

## How It Works

### Customer Flow:

1. Customer fills out booking form on Quote page
2. Proceeds to Checkout page and enters contact information
3. Clicks "Complete Booking" button
4. Order is created in database
5. Stripe payment modal appears
6. Customer enters card details securely
7. Payment is processed and card is saved for future use
8. Order confirmation is displayed

### Admin Flow:

1. Admin reviews pending bookings
2. Sees payment status for each order
3. Can charge saved payment method for:
   - Remaining balance (before/after event)
   - Damage fees (with description)
   - Cleaning fees
   - Late return fees
4. All charges are tracked with full audit trail

## Database Structure

### New Tables:
- **payments**: Tracks all payment transactions
  - Links to orders
  - Stores Stripe payment intent IDs
  - Records amount, type, status, and description

### New Columns in orders:
- `stripe_customer_id`: Stripe Customer ID
- `stripe_payment_method_id`: Saved payment method
- `deposit_paid_cents`: Amount of deposit paid
- `balance_paid_cents`: Amount of balance paid
- `damage_charged_cents`: Damage charges
- `total_refunded_cents`: Total refunds issued

## Edge Functions

Three Stripe-related edge functions were deployed:

### 1. **stripe-checkout**
- Creates payment intent for deposit collection
- Creates/retrieves Stripe customer
- Stores payment method for future use
- Returns client secret for payment form

### 2. **stripe-charge** (Admin only)
- Charges saved payment method
- Used for balance and damage fees
- Creates payment record in database
- Updates order totals

### 3. **stripe-webhook**
- Receives webhooks from Stripe
- Handles payment success/failure
- Processes refunds
- Updates database automatically

## Environment Variables

The following variables are configured in your `.env`:

```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...  # Used in frontend
STRIPE_SECRET_KEY=sk_test_...             # Used in edge functions
```

## Testing with Stripe Test Mode

Your integration is currently using Stripe test mode. Use these test card numbers:

- **Success**: 4242 4242 4242 4242
- **Decline**: 4000 0000 0000 0002
- **Requires Authentication**: 4000 0025 0000 3155

Use any future expiry date and any 3-digit CVC.

## Going Live

To switch to live mode:

1. Get your live Stripe keys from Stripe Dashboard
2. Update `.env` with live keys:
   - `VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...`
   - `STRIPE_SECRET_KEY=sk_live_...`
3. No code changes needed!

## Webhook Setup (Recommended for Production)

To receive real-time payment updates from Stripe:

1. Go to Stripe Dashboard > Developers > Webhooks
2. Add endpoint: `https://your-domain.supabase.co/functions/v1/stripe-webhook`
3. Select events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
4. Copy the webhook signing secret
5. Add to your environment: `STRIPE_WEBHOOK_SECRET=whsec_...`

## Security Features

- **PCI Compliance**: Stripe handles all card data
- **Admin Authentication**: Only authenticated admins can charge cards
- **Audit Trail**: All payments logged with timestamps
- **Row Level Security**: Database policies prevent unauthorized access
- **Secure Storage**: No card numbers stored in your database

## Support

If customers have payment issues:
1. Check payment status in Admin panel
2. View payment history for detailed error messages
3. Can manually charge saved payment method if initial charge failed
4. Contact Stripe support for payment-specific issues

## Next Steps

1. Test the payment flow end-to-end with test cards
2. Verify admin panel shows payment information correctly
3. Test charging saved payment methods
4. When ready, switch to live mode with your live Stripe keys
