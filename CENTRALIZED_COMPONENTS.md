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

## Travel Fee Miles Fix

### Problem
The travel fee wasn't showing miles (e.g., "Travel Fee (12.5 mi)") on invoices in the CustomerPortal.

### Root Cause
When orders were created or modified, the `travel_total_miles` field (and other travel breakdown fields) were not being saved to the database in two places:
1. `InvoiceBuilder.tsx` - When admin creates invoices
2. `OrderDetailModal.tsx` - When admin modifies existing orders

### Solution Applied
Added the missing travel breakdown fields to both components when saving orders:
- `travel_total_miles` - Total distance in miles
- `travel_base_radius_miles` - Free radius (e.g., 25 miles)
- `travel_chargeable_miles` - Miles beyond base that are charged
- `travel_per_mile_cents` - Rate per mile
- `travel_is_flat_fee` - Whether it's a flat fee or per-mile

**Files Modified:**
- `src/components/InvoiceBuilder.tsx` (lines 483-491)
- `src/components/OrderDetailModal.tsx` (lines 692-696)

The centralized `OrderSummary` component already had the correct logic to display miles - it just needed the data to be saved properly.

## Summary of Work Needed

1. **Replace inline tip selector** in Checkout.tsx and CustomerPortal.tsx with `<TipSelector>`
2. **Replace overnight agreement** in Quote.tsx with `<OvernightResponsibilityAgreement>`
3. **Replace card-on-file auth** in Checkout.tsx and CustomerPortal.tsx with `<CardOnFileAuthorization>`
4. **Replace available units** in InvoiceBuilder.tsx and OrderDetailModal.tsx with `<AvailableUnitsSelector>`
5. **Verify** that `travel_total_miles` is properly stored in database during order creation

All centralized components have been created and the project builds successfully.
