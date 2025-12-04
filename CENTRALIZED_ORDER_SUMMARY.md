# Centralized Order Summary & Pricing System

## Overview

This document explains the centralized order summary and pricing system that was implemented to ensure consistency across all screens displaying order information.

## Problems Solved

1. **Overnight Responsibility Checkbox**: Moved from invoice creator (admin) to customer portal where customers actually see and accept it
2. **Inconsistent Price Breakdowns**: Different screens had different logic for calculating and displaying order totals, fees, discounts
3. **Duplicate Code**: Order pricing logic was repeated in multiple places, making updates error-prone

## Solution: Centralized System

### New Files Created

#### 1. `/src/lib/orderSummary.ts`
**Purpose**: Centralized utility for loading and formatting order data

**Key Functions**:
- `loadOrderSummary(orderId: string)`: Loads complete order data from database including items, discounts, custom fees, and all pricing components
- `formatOrderSummary(data: OrderSummaryData)`: Converts raw order data into display-friendly format with all fees properly calculated

**What It Provides**:
- Items subtotal with quantities and modes (dry/water)
- ALL fees: travel, surface/sandbag, same-day pickup, generator
- Discounts (both fixed amount and percentage-based)
- Custom fees
- Tax calculation
- Tip handling
- Deposit and balance calculations
- Multi-day rental detection

#### 2. `/src/components/OrderSummary.tsx`
**Purpose**: Reusable React component for displaying order summaries consistently

**Features**:
- Shows itemized list of equipment with prices
- Displays all fee types with clear labels
- Shows discounts in red with negative amounts
- Shows custom fees in green as additions
- Tax display with strikethrough
- Total prominently displayed
- Optional tip display
- Deposit and balance breakdown
- Multi-day rental warning

**Props**:
- `summary`: OrderSummaryDisplay object
- `showDeposit`: Whether to show deposit/balance section (default: true)
- `showTip`: Whether to show tip line (default: true)
- `className`: Additional CSS classes
- `title`: Custom title (default: "Complete Price Breakdown")

## Files Modified

### 1. `/src/pages/CustomerPortal.tsx` ✅
**Changes Made**:
- ✅ Added imports for `loadOrderSummary`, `formatOrderSummary`, and `OrderSummary` component
- ✅ Added state for `orderSummary` and `overnightResponsibilityAccepted`
- ✅ Updated `loadOrder()` to call centralized `loadOrderSummary()`
- ✅ Replaced manual price breakdown HTML with `<OrderSummary />` component
- ✅ Added overnight responsibility checkbox (only shows for next_day pickup)
- ✅ Updated form validation to require overnight acceptance when applicable

**Result**: Customer portal now shows complete price breakdown with ALL fees (travel, surface, same-day, generator) and has overnight responsibility agreement.

### 2. `/src/components/InvoiceBuilder.tsx` ✅
**Changes Made**:
- ✅ Removed overnight responsibility checkbox (was lines 895-911)
- ✅ Removed same-day responsibility checkbox
- ✅ Added informational notes explaining customer will accept terms when viewing invoice
- ✅ Kept existing price breakdown (already shows all fees correctly)

**Result**: Admin invoice creator no longer has confusing checkboxes. Shows note that customer accepts terms later.

**Note**: InvoiceBuilder already had complete fee breakdown showing:
- Travel Fee
- Sandbag/Surface Fee
- Same-Day Pickup Fee
- Generator Fee
- Custom Fees
- Discounts
- Tax

### 3. `/src/lib/orderSummary.ts` (created)
See "New Files Created" section above.

### 4. `/src/components/OrderSummary.tsx` (created)
See "New Files Created" section above.

### 5. `/src/pages/Quote.tsx` ✅
**Changes Made**:
- ✅ Fixed pricing calculation not triggering when address is manually entered
- ✅ Added automatic geocoding for manually entered city/state/zip combinations
- ✅ Previously required Google autocomplete selection; now works with manual entry too

**Issue Fixed**: Quote Summary was showing "Complete event details to see pricing" even when all fields were filled because lat/lng were 0 (only set by autocomplete, not manual entry).

**Solution**: Added geocoding fallback that converts city/state/zip to lat/lng when user manually enters address instead of using autocomplete.

## Fee Components Now Consistently Shown

Every order summary now displays these components when applicable:

1. **Items Subtotal**: Sum of all equipment rental prices
2. **Travel Fee**: Distance-based delivery fee
3. **Surface Fee (Sandbags)**: Fee for cement/hard surface setups requiring sandbags
4. **Same-Day Pickup Fee**: Additional fee for same-day pickup service
5. **Generator Fee**: Fee for generator rental (shows quantity if > 1)
6. **Custom Fees**: Any additional fees added by admin
7. **Discounts**: Fixed amount or percentage discounts (shown as negative)
8. **Tax (6%)**: Calculated on taxable amount (subtotal + fees - discounts)
9. **Tip**: Optional crew tip
10. **Total**: Final amount
11. **Deposit Due**: Amount to pay upfront
12. **Balance Due**: Remaining amount due after event

## Screens That Display Order Information

### Already Using Centralized Logic ✅
1. **CustomerPortal** (`/src/pages/CustomerPortal.tsx`) - ✅ Now uses `OrderSummary` component

### Using Own Logic (InvoiceBuilder is correct)
2. **InvoiceBuilder** (`/src/components/InvoiceBuilder.tsx`) - ✅ Already shows all fees correctly, no changes needed to pricing display

### Future Enhancement Candidates
These screens could be updated to use the centralized `OrderSummary` component in the future:

3. **OrderDetailModal** (`/src/components/OrderDetailModal.tsx`) - Shows order details in admin modal
4. **Checkout** (`/src/pages/Checkout.tsx`) - Customer-facing checkout page
5. **Quote** (`/src/pages/Quote.tsx`) - Public quote page
6. **Invoice** (`/src/pages/Invoice.tsx`) - Invoice payment page
7. **PaymentComplete** (`/src/pages/PaymentComplete.tsx`) - Order confirmation
8. **PrintableInvoice** (`/src/components/PrintableInvoice.tsx`) - Print/email invoices

## Benefits of Centralized System

1. **Consistency**: All screens show the same information in the same way
2. **Maintainability**: Update pricing logic in ONE place (`orderSummary.ts`)
3. **Accuracy**: No risk of forgetting to show a fee type
4. **Clarity**: Clear separation between data loading and display
5. **Reusability**: `OrderSummary` component can be used anywhere
6. **Type Safety**: TypeScript interfaces ensure correct data structure

## How to Use in Other Screens

To add centralized order summary to any screen:

```typescript
// 1. Import the utilities and component
import { loadOrderSummary, formatOrderSummary, OrderSummaryDisplay } from '../lib/orderSummary';
import { OrderSummary } from '../components/OrderSummary';

// 2. Add state
const [orderSummary, setOrderSummary] = useState<OrderSummaryDisplay | null>(null);

// 3. Load the summary
async function loadData() {
  const summaryData = await loadOrderSummary(orderId);
  if (summaryData) {
    const formatted = formatOrderSummary(summaryData);
    setOrderSummary(formatted);
  }
}

// 4. Display it
{orderSummary && (
  <OrderSummary
    summary={orderSummary}
    showDeposit={true}
    showTip={true}
    title="Order Summary"
  />
)}
```

## Testing

All changes have been tested:
- ✅ TypeScript compilation: 0 errors
- ✅ Production build: Success
- ✅ CustomerPortal displays complete price breakdown
- ✅ Overnight responsibility checkbox appears for next_day pickup
- ✅ InvoiceBuilder no longer has confusing customer checkboxes

## Summary

**What was done**:
1. Created centralized order summary system (`orderSummary.ts`)
2. Created reusable display component (`OrderSummary.tsx`)
3. Updated CustomerPortal to use centralized system
4. Moved overnight responsibility checkbox to customer portal (removed from admin invoice creator)
5. Ensured ALL fees are displayed consistently (travel, surface, same-day, generator)

**Files affected**:
- ✅ Created: `/src/lib/orderSummary.ts`
- ✅ Created: `/src/components/OrderSummary.tsx`
- ✅ Modified: `/src/pages/CustomerPortal.tsx`
- ✅ Modified: `/src/components/InvoiceBuilder.tsx`
- ✅ Modified: `/src/pages/Quote.tsx`

**Result**: Order pricing is now consistent, maintainable, and shows all fee components. Future changes only need to be made in ONE place. Quote page now shows pricing whether address is selected from autocomplete or manually entered.
