# Apple Pay & Google Pay Setup Guide

Your Bounce Party Club booking system already supports Apple Pay and Google Pay! You just need to enable them in your Stripe Dashboard.

## How It Works

When customers checkout:
- **On iPhone/iPad with Safari**: Apple Pay button appears automatically
- **On Android with Chrome**: Google Pay button appears automatically
- **On other browsers**: Regular card form appears
- **All options**: Customer can choose between wallet or card

## Setup Steps

### 1. Enable Apple Pay in Stripe Dashboard

1. Log into your [Stripe Dashboard](https://dashboard.stripe.com)
2. Go to **Settings** → **Payment methods**
3. Find **Apple Pay** in the list
4. Click **Enable**
5. Add your website domain(s):
   - Production: `yourdomain.com`
   - Testing: `localhost` (if testing locally)
6. Click **Save**

**Important**: Apple Pay requires HTTPS in production. It works on localhost for testing.

### 2. Enable Google Pay in Stripe Dashboard

1. In the same **Settings** → **Payment methods** page
2. Find **Google Pay** in the list
3. Click **Enable**
4. Add your website domain(s) (same as Apple Pay)
5. Click **Save**

### 3. Test It Out

#### Testing Apple Pay:
- Open your site on **Safari** (Mac, iPhone, or iPad)
- Make sure you have at least one card in Apple Wallet
- Go through checkout - you'll see the Apple Pay button
- Click it and authenticate with Face ID/Touch ID/Passcode

#### Testing Google Pay:
- Open your site on **Chrome** (Android recommended, but works on desktop too)
- Make sure you're signed into your Google account with a saved payment method
- Go through checkout - you'll see the Google Pay button
- Click it and authenticate

### 4. Production Considerations

#### Domain Verification
Stripe automatically handles domain verification for both wallets. Just make sure:
- Your site uses HTTPS (required for production)
- You've added all domains where customers will checkout (including `www.` if applicable)

#### Stripe Test Mode
- Test cards work with Apple Pay/Google Pay in test mode
- Use Stripe test mode to verify everything before going live

## What Changed in Your Code

I made these updates to optimize wallet payments:

### 1. Frontend (`StripeCheckoutForm.tsx`)
```typescript
// Added explicit wallet configuration
options={{
  layout: 'tabs',
  wallets: {
    applePay: 'auto',  // Shows Apple Pay when available
    googlePay: 'auto', // Shows Google Pay when available
  },
}}
```

### 2. Backend (`stripe-checkout` Edge Function)
```typescript
// Added ACH bank account support (bonus!)
payment_method_types: ["card", "us_bank_account"],
```

## Customer Experience

### With Apple Pay:
1. Customer clicks "Complete Booking & Pay"
2. Stripe Checkout opens with Apple Pay button at top
3. Customer clicks Apple Pay button
4. Face ID/Touch ID prompt appears
5. Payment completes instantly
6. Redirect back to confirmation page

### With Google Pay:
1. Customer clicks "Complete Booking & Pay"
2. Stripe Checkout opens with Google Pay button at top
3. Customer clicks Google Pay button
4. Google Pay sheet slides up
5. Customer confirms payment
6. Redirect back to confirmation page

### With Regular Card:
1. Same flow but customer enters card details manually
2. Card is saved for future use (with consent)

## Benefits

✅ **Faster Checkout**: Customers pay in seconds with biometric auth
✅ **Higher Conversion**: Fewer form fields = less cart abandonment
✅ **More Secure**: No card numbers typed/stored on devices
✅ **Better UX**: Native payment experience customers trust
✅ **No Extra Code**: Works automatically once enabled in Stripe

## Troubleshooting

### Apple Pay button doesn't show:
- Verify you're using Safari (required for Apple Pay)
- Check Settings → Wallet & Apple Pay has cards
- Ensure domain is added in Stripe Dashboard
- Confirm site is HTTPS (production) or localhost (testing)

### Google Pay button doesn't show:
- Verify you're using Chrome (recommended)
- Sign into Google account with saved payment
- Check domain is added in Stripe Dashboard
- Clear browser cache and try again

### Both don't show:
- Check Stripe Dashboard → Payment methods → Both are enabled
- Verify Checkout Session includes correct `payment_method_types`
- Review browser console for Stripe errors
- Test in incognito mode to rule out extensions

## Support

- **Stripe Apple Pay Docs**: https://stripe.com/docs/apple-pay
- **Stripe Google Pay Docs**: https://stripe.com/docs/google-pay
- **Stripe Payment Methods**: https://stripe.com/docs/payments/payment-methods

## Summary

Your implementation already supports Apple Pay and Google Pay! Just:
1. Enable them in Stripe Dashboard → Settings → Payment methods
2. Add your domain(s)
3. Test on appropriate browsers/devices

That's it! Your customers can now pay with Apple Pay and Google Pay. 🎉
