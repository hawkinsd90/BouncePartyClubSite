# Centralized Components Integration Guide

This document outlines the centralized components that have been created and where they need to be integrated.

## Components Created

### 1. TipSelector (`src/components/TipSelector.tsx`)
**Purpose:** Unified tip selection UI with percentage options (10%, 15%, 20%) and custom amount input.

**Current Usage:**
- ✅ Already used in `src/pages/Checkout.tsx` (lines 605-719) - **NEEDS TO BE REPLACED**
- ✅ Already used in `src/pages/CustomerPortal.tsx` - **NEEDS TO BE REPLACED**

**How to Integrate:**
```typescript
import { TipSelector, calculateTipCents } from '../components/TipSelector';

<TipSelector
  totalCents={priceBreakdown.total_cents}
  tipAmount={tipAmount}
  customTipAmount={customTip}
  onTipAmountChange={setTipAmount}
  onCustomTipAmountChange={setCustomTip}
  formatCurrency={formatCurrency}
/>

// To get tip amount in cents:
const tipCents = calculateTipCents(tipAmount, customTip, totalCents);
```

### 2. OvernightResponsibilityAgreement (`src/components/OvernightResponsibilityAgreement.tsx`)
**Purpose:** Displays overnight responsibility agreement for next-day pickup rentals.

**Needs Integration In:**
- `src/pages/Quote.tsx` (lines 678-695) - **REPLACE INLINE CODE**
- `src/pages/CustomerPortal.tsx` - **ADD WHERE NEEDED**

**How to Integrate:**
```typescript
import { OvernightResponsibilityAgreement } from '../components/OvernightResponsibilityAgreement';

<OvernightResponsibilityAgreement
  accepted={formData.overnight_responsibility_accepted}
  onChange={(accepted) => setFormData({ ...formData, overnight_responsibility_accepted: accepted })}
  locationType={formData.location_type}
  pickupPreference={formData.pickup_preference}
/>
```

### 3. CardOnFileAuthorization (`src/components/CardOnFileAuthorization.tsx`)
**Purpose:** Displays card-on-file authorization and SMS consent checkboxes.

**Needs Integration In:**
- `src/pages/Checkout.tsx` (lines 741-789) - **REPLACE INLINE CODE**
- `src/pages/CustomerPortal.tsx` - **REPLACE INLINE CODE**

**How to Integrate:**
```typescript
import { CardOnFileAuthorization } from '../components/CardOnFileAuthorization';

<CardOnFileAuthorization
  cardOnFileConsent={cardOnFileConsent}
  onCardOnFileConsentChange={setCardOnFileConsent}
  smsConsent={smsConsent}
  onSmsConsentChange={setSmsConsent}
/>
```

### 4. AvailableUnitsSelector (`src/components/AvailableUnitsSelector.tsx`)
**Purpose:** Displays grid of available units with dry/water mode buttons.

**Needs Integration In:**
- `src/components/InvoiceBuilder.tsx` (lines 1134-1184) - **REPLACE INLINE CODE**
- `src/components/OrderDetailModal.tsx` (lines 1802-1837) - **REPLACE INLINE CODE**

**How to Integrate:**
```typescript
import { AvailableUnitsSelector } from '../components/AvailableUnitsSelector';

<AvailableUnitsSelector
  units={units}
  cartItems={cartItems}
  onAddItem={(unit, mode) => addItemToCart(unit, mode)}
  title="Available Units"
  buttonSize="sm"
/>
```

## CustomerPortal Price Breakdown Issue

### Problem
The "Complete Price Breakdown" section in the awaiting approval flow (lines 1515-1725 in `CustomerPortal.tsx`) manually builds the price breakdown and doesn't consistently show miles in the travel fee.

### Solution
The travel fee DOES show miles (line 1597-1599), but only if `order.travel_total_miles` is populated. This is already present in the code:
```typescript
Travel Fee
{order.travel_total_miles > 0 &&
  ` (${parseFloat(order.travel_total_miles).toFixed(1)} mi)`
}
```

**The issue is that this manual breakdown duplicates logic.** The centralized `OrderSummary` component in `src/lib/orderSummary.ts` already handles this properly via the `formatOrderSummary()` function (lines 165-169):
```typescript
if (data.travel_fee_cents > 0) {
  const travelFeeName = data.travel_total_miles > 0
    ? `Travel Fee (${data.travel_total_miles.toFixed(1)} mi)`
    : 'Travel Fee';
  fees.push({ name: travelFeeName, amount: data.travel_fee_cents });
}
```

**Recommendation:** The manual "Complete Price Breakdown" section should remain for now as it has special change-tracking functionality (showing old vs new values with strikethrough). Ensure `travel_total_miles` is properly saved in the database when orders are created/updated.

## Summary of Work Needed

1. **Replace inline tip selector** in Checkout.tsx and CustomerPortal.tsx with `<TipSelector>`
2. **Replace overnight agreement** in Quote.tsx with `<OvernightResponsibilityAgreement>`
3. **Replace card-on-file auth** in Checkout.tsx and CustomerPortal.tsx with `<CardOnFileAuthorization>`
4. **Replace available units** in InvoiceBuilder.tsx and OrderDetailModal.tsx with `<AvailableUnitsSelector>`
5. **Verify** that `travel_total_miles` is properly stored in database during order creation

All centralized components have been created and the project builds successfully.
