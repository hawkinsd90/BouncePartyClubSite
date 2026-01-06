# Order Edit Screen vs Invoice Builder - Comprehensive Analysis

## Executive Summary

This document provides a detailed comparison of the **Edit Order Screen** (OrderDetailModal) and **Invoice Builder** screen, identifying all shared components, behavioral differences, and opportunities for unification.

---

## 1. Shared Components - Confirmed Identical Behavior

### ✅ 1.1 EventDetailsEditor
**Location:** `src/components/order-detail/EventDetailsEditor.tsx`

**Usage:**
- **Order Edit:** Used in OrderDetailsTab (non-compact mode)
- **Invoice Builder:** Used directly (compact mode)

**Props Comparison:**
| Prop | Order Edit | Invoice Builder |
|------|-----------|-----------------|
| editedOrder | Order data | Event details state |
| pricingRules | Loaded from DB | Loaded from DB |
| onOrderChange | Updates order state | Updates event state |
| onAddressSelect | Updates address fields | Updates address fields |
| compact | `false` (default) | `true` |
| showUntilEndOfDay | `false` (default) | `true` |

**Behavioral Differences:**
- **Compact mode** affects styling and layout (Invoice Builder uses compact)
- **Show Until End of Day** checkbox only appears in Invoice Builder
- Both validate multi-day rentals (same_day pickup locks end date to start date)
- Both handle location type (residential/commercial) identically
- Both calculate generator fees the same way
- Address autocomplete works identically in both

**Status:** ✅ **SHARED - Behaves consistently**

---

### ✅ 1.2 ItemsEditor
**Location:** `src/components/shared/ItemsEditor.tsx`

**Usage:**
- **Order Edit:** Via OrderDetailsTab
- **Invoice Builder:** Directly included

**Props Comparison:**
| Prop | Order Edit | Invoice Builder |
|------|-----------|-----------------|
| items | stagedItems (with is_deleted, is_new flags) | cartItems (simple array) |
| units | Available units from DB | Available units from DB |
| onRemoveItem | Marks as deleted / removes new | Removes from cart by index |
| onAddItem | Adds to staged items | Adds to cart |
| onUpdateQuantity | Not used (undefined) | Updates quantity in cart |
| onUpdatePrice | Not used (undefined) | Not used (false) |
| allowQuantityEdit | `false` (default) | `true` |
| allowPriceEdit | `false` (default) | `false` |
| title | "Order Items" | "Items" |
| removeByIndex | `false` | `true` |

**Behavioral Differences:**
- **Order Edit**: Items have lifecycle flags (is_new, is_deleted) for tracking changes
- **Invoice Builder**: Simple cart with no change tracking
- **Order Edit**: Cannot edit quantities (must remove and re-add)
- **Invoice Builder**: Can edit quantities with +/- buttons
- **Order Edit**: Removes by item object matching
- **Invoice Builder**: Removes by array index

**Status:** ✅ **SHARED - Different configurations for different needs**

---

### ✅ 1.3 DiscountsManager
**Location:** `src/components/order-detail/DiscountsManager.tsx`

**Usage:**
- **Order Edit:** Via OrderDetailsTab
- **Invoice Builder:** Directly included

**Props Comparison:**
| Prop | Order Edit | Invoice Builder |
|------|-----------|-----------------|
| discounts | State array with DB IDs | State array with temp IDs |
| onDiscountChange | Updates state | Updates state |
| onMarkChanges | Sets hasChanges flag | Empty function (no-op) |

**Behavioral Differences:**
- Both load saved templates from `saved_discount_templates`
- Both allow fixed amount or percentage discounts
- Both allow saving new templates
- Both validate exclusive amount/percentage
- **Order Edit**: Calls onMarkChanges to track unsaved changes
- **Invoice Builder**: No change tracking needed

**Status:** ✅ **SHARED - Behaves identically**

---

### ✅ 1.4 CustomFeesManager
**Location:** `src/components/order-detail/CustomFeesManager.tsx`

**Usage:**
- **Order Edit:** Via OrderDetailsTab
- **Invoice Builder:** Directly included

**Props Comparison:**
| Prop | Order Edit | Invoice Builder |
|------|-----------|-----------------|
| customFees | State array with DB IDs | State array with temp IDs |
| onFeeChange | Updates state | Updates state |
| onMarkChanges | Sets hasChanges flag | Empty function (no-op) |

**Behavioral Differences:**
- Both load saved templates from `saved_fee_templates`
- Both allow fixed amount fees (no percentage option)
- Both allow saving new templates
- **Order Edit**: Calls onMarkChanges to track unsaved changes
- **Invoice Builder**: No change tracking needed

**Status:** ✅ **SHARED - Behaves identically**

---

### ✅ 1.5 DepositOverride
**Location:** `src/components/order-detail/DepositOverride.tsx`

**Usage:**
- **Order Edit:** Via OrderDetailsTab
- **Invoice Builder:** Directly included

**Props Comparison:**
| Prop | Order Edit | Invoice Builder |
|------|-----------|-----------------|
| calculatedDepositCents | From pricing calculation | From pricing hook |
| customDepositCents | State (null or number) | From custom hook |
| customDepositInput | State string | From custom hook |
| onInputChange | Updates input state | Updates hook state |
| onApply | Callback with amount | Hook function |
| onClear | Clears override | Hook function |
| compact | `false` (default) | `true` |
| showZeroHint | `false` (default) | `true` |

**Behavioral Differences:**
- **Compact mode** changes layout/styling
- **showZeroHint** adds text about $0 acceptance-only invoices (Invoice Builder only)
- Both allow setting custom deposit amounts
- Both validate input and convert to cents
- Both show override status

**Status:** ✅ **SHARED - Behaves consistently with prop variations**

---

### ✅ 1.6 TaxWaiver
**Location:** `src/components/order-detail/TaxWaiver.tsx`

**Usage:**
- **Order Edit:** Via OrderDetailsTab
- **Invoice Builder:** Directly included

**Props Comparison:**
| Prop | Order Edit | Invoice Builder |
|------|-----------|-----------------|
| taxCents | From calculated pricing | From calculated pricing |
| taxWaived | State boolean | State boolean |
| taxWaiveReason | State string | State string |
| onToggle | Callback with reason | Callback with reason |
| compact | `false` (default) | `true` |

**Behavioral Differences:**
- Both show confirmation dialog before waiving/restoring
- Both require a reason when waiving
- Both display current waive status and reason
- **Compact mode** affects styling/layout
- Identical validation logic

**Status:** ✅ **SHARED - Behaves identically**

---

### ✅ 1.7 FeeWaiver
**Location:** `src/components/shared/FeeWaiver.tsx`

**Usage:**
- **Order Edit:** Via OrderDetailsTab (for travel, same-day pickup, surface, generator fees)
- **Invoice Builder:** Directly included (for same fees)

**Props Comparison:**
| Prop | Order Edit | Invoice Builder |
|------|-----------|-----------------|
| feeName | "Travel Fee", "Same Day Pickup Fee", "Surface Fee (Sandbags)", "Generator Fee" | Same |
| feeAmount | From calculated pricing | From calculated pricing |
| isWaived | State boolean per fee | State boolean per fee |
| waiveReason | State string per fee | State string per fee |
| onToggle | Callback with reason | Callback with reason |
| compact | `false` (default) | `true` |
| color | Varies by fee type | Same colors |

**Behavioral Differences:**
- Both show confirmation dialog before waiving/restoring
- Both require a reason when waiving
- Both only appear when fee amount > 0
- **Compact mode** affects styling/layout
- Identical validation logic

**Status:** ✅ **SHARED - Behaves identically**

---

### ✅ 1.8 OrderSummary
**Location:** `src/components/order/OrderSummary.tsx`

**Usage:**
- **Order Edit:** Shows both "Current Pricing" and "Updated Pricing" side-by-side
- **Invoice Builder:** Shows single "Invoice Summary"

**Props Comparison:**
| Prop | Order Edit (Current) | Order Edit (Updated) | Invoice Builder |
|------|---------------------|---------------------|-----------------|
| summary | Current order summary | Updated pricing summary | Built invoice summary |
| showDeposit | `true` | `true` | `true` |
| showTip | Based on order.tip_cents | Based on order.tip_cents | `false` |
| title | "Current Pricing" | "Updated Pricing" | "Invoice Summary" |
| highlightNewItems | `false` | `true` | N/A |
| comparisonTotal | N/A | currentOrderSummary.total | N/A |
| customDepositCents | N/A | From state | From state |
| taxWaived | order.tax_waived | State value | State value |
| travelFeeWaived | order.travel_fee_waived | State value | State value |
| surfaceFeeWaived | order.surface_fee_waived | State value | State value |
| generatorFeeWaived | order.generator_fee_waived | State value | State value |
| sameDayPickupFeeWaived | order.same_day_pickup_fee_waived | State value | State value |

**Behavioral Differences:**
- **Order Edit**: Renders TWO summaries for before/after comparison
- **Invoice Builder**: Renders ONE summary
- Both display items, fees, discounts, tax, total, deposit
- Both show waived fees with strikethrough
- Both support custom deposit overrides
- **Order Edit**: Shows change badges and highlights
- **Invoice Builder**: No comparison features needed

**Status:** ✅ **SHARED - Used differently but same component**

---

## 2. Components That Are Similar But NOT Shared

### ⚠️ 2.1 AdminMessage vs AdminMessageSection
**Locations:**
- `src/components/order-detail/AdminMessage.tsx`
- `src/components/invoice/AdminMessageSection.tsx`

**Purpose:** Allow admin to add custom message to customer

**Differences:**

| Feature | AdminMessage (Order Edit) | AdminMessageSection (Invoice Builder) |
|---------|---------------------------|---------------------------------------|
| Container styling | Purple background | Slate background |
| Border | Purple border | No border |
| Shadow | No shadow | Has shadow |
| Example placeholder | Order edit context | Invoice context |
| Feedback message | Shows when value exists | None |

**Code Comparison:**

**AdminMessage:**
```tsx
<div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
  <h3 className="font-semibold text-slate-900 mb-3">Message to Customer</h3>
  <p className="text-sm text-slate-600 mb-3">
    Add an optional message to explain the changes to the customer.
    This will be included in the email and text notification.
  </p>
  <textarea ... />
  {value.trim() && (
    <p className="text-xs text-purple-600 mt-2">
      This message will be sent to the customer when you save changes.
    </p>
  )}
</div>
```

**AdminMessageSection:**
```tsx
<div className="bg-slate-50 rounded-lg shadow p-4 sm:p-6">
  <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">
    Message to Customer
  </h3>
  <p className="text-sm text-slate-600 mb-4">
    Add an optional message to explain the invoice details to the customer.
    This will be included in the email and text notification.
  </p>
  <textarea ... />
</div>
```

**Recommendation:** ⚠️ **SHOULD BE UNIFIED**
These components do the exact same thing with only cosmetic differences. Should use a single component with optional styling props.

---

## 3. Features That DON'T Share Components But SHOULD

### 🔴 3.1 Pricing Calculation Logic

**Order Edit:**
- Uses `useOrderPricing` hook (`src/hooks/useOrderPricing.ts`)
- Calculates: subtotal, fees, tax, total, deposit
- Handles fee waivers in calculation
- Returns `updatedOrderSummary` and `calculatedPricing`

**Invoice Builder:**
- Uses `useInvoicePricing` hook (`src/hooks/useInvoicePricing.ts`)
- Calculates similar values
- Manual tax adjustment in component (lines 171-192)
- Manual total calculation (lines 184-192)

**Issues:**
```tsx
// Invoice Builder manually calculates adjusted tax (BAD)
const adjustedTaxCents = useMemo(() => {
  if (taxWaived) return 0;

  const travelFee = travelFeeWaived ? 0 : (pricing.priceBreakdown?.travel_fee_cents || 0);
  const surfaceFee = surfaceFeeWaived ? 0 : (pricing.priceBreakdown?.surface_fee_cents || 0);
  const sameDayFee = sameDayPickupFeeWaived ? 0 : (pricing.priceBreakdown?.same_day_pickup_fee_cents || 0);
  const generatorFee = generatorFeeWaived ? 0 : (pricing.priceBreakdown?.generator_fee_cents || 0);

  const adjustedFees = travelFee + surfaceFee + sameDayFee + generatorFee;
  const taxableAmount = Math.max(0, pricing.actualSubtotal + adjustedFees - pricing.discountTotal + pricing.customFeesTotal);
  return Math.round(taxableAmount * 0.06);
}, [pricing, taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived]);
```

**Recommendation:** 🔴 **CRITICAL - MUST BE UNIFIED**
- Pricing logic should be centralized
- Fee waiver handling should be in the pricing hook, not component
- Both screens should use the SAME pricing calculation logic
- Risk of bugs: changes to one screen don't reflect in the other

---

### 🔴 3.2 Customer Selection/Creation

**Order Edit:**
- Customer is pre-selected (existing order)
- Shows customer info at top
- No customer selection UI

**Invoice Builder:**
- Uses `CustomerSelector` component (`src/components/invoice/CustomerSelector.tsx`)
- Uses `NewCustomerForm` component (`src/components/invoice/NewCustomerForm.tsx`)
- Uses `useCustomerManagement` hook
- Can search and select existing customers
- Can create new customers
- Can generate link without customer

**Recommendation:** 🟡 **CONSIDER UNIFICATION**
- Order Edit might benefit from ability to change customer
- Customer creation logic should be shared
- Could extract customer management as reusable feature

---

### 🟡 3.3 Availability Checking

**Order Edit:**
- Has built-in availability checking in `OrderDetailModal`
- Shows availability warnings/errors
- Checks on date/item changes
- Displays conflicts visually

```tsx
async function checkAvailability() {
  if (!editedOrder.event_date || !editedOrder.event_end_date || stagedItems.length === 0) {
    setAvailabilityIssues([]);
    return;
  }

  setCheckingAvailability(true);
  try {
    const activeItems = stagedItems.filter(item => !item.is_deleted);
    const checks = activeItems.map(item => ({
      unitId: item.unit_id,
      eventStartDate: editedOrder.event_date,
      eventEndDate: editedOrder.event_end_date,
      excludeOrderId: order.id,
    }));

    const results = await checkMultipleUnitsAvailability(checks);
    const issues = results
      .filter(result => !result.isAvailable)
      .map(result => {
        const item = activeItems.find(i => i.unit_id === result.unitId);
        return {
          unitName: item?.unit_name || 'Unknown',
          unitId: result.unitId,
          conflicts: result.conflictingOrders,
        };
      });

    setAvailabilityIssues(issues);
  } catch (error) {
    console.error('Error checking availability:', error);
  } finally {
    setCheckingAvailability(false);
  }
}
```

**Invoice Builder:**
- Checks availability only when generating invoice
- No visual feedback during building
- Blocks invoice creation if unavailable
- No proactive checking

```tsx
// Only checked on submit
const availabilityChecks = cartItems.map(item => ({
  unitId: item.unit_id,
  eventStartDate: eventDetails.event_date,
  eventEndDate: eventDetails.event_end_date,
}));

const availabilityResults = await checkMultipleUnitsAvailability(availabilityChecks);
const unavailableUnits = availabilityResults.filter(result => !result.isAvailable);

if (unavailableUnits.length > 0) {
  // Show error and return
}
```

**Recommendation:** 🟡 **SHOULD BE UNIFIED**
- Extract availability checking to shared hook
- Invoice Builder should show real-time availability
- Both should use same visual indicators
- Both should use same conflict resolution logic

---

### 🔴 3.4 Order/Invoice Summary Building

**Order Edit:**
- Uses `formatOrderSummary` from `src/lib/orderSummary.ts`
- Builds summary from order data

**Invoice Builder:**
- Uses `buildInvoiceSummary` from `src/lib/invoiceSummaryBuilder.ts`
- Builds summary from cart/event data

**Problem:** Two separate functions doing essentially the same thing!

**formatOrderSummary:**
```typescript
export function formatOrderSummary(data: OrderSummaryData): OrderSummaryDisplay {
  const items = data.items.map(item => ({
    name: item.units?.name || item.unit_name || 'Unknown Item',
    qty: item.qty,
    mode: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
    lineTotal: item.unit_price_cents * item.qty,
    isNew: item.is_new || false,
  }));
  // ... builds summary
}
```

**buildInvoiceSummary:**
```typescript
export function buildInvoiceSummary(params: InvoiceSummaryParams): OrderSummaryDisplay {
  const items = params.cartItems.map(item => ({
    name: item.unit_name,
    qty: item.qty,
    mode: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
    lineTotal: (item.adjusted_price_cents || item.unit_price_cents) * item.qty,
    isNew: false,
  }));
  // ... builds summary (nearly identical logic)
}
```

**Recommendation:** 🔴 **CRITICAL - MUST BE UNIFIED**
- Consolidate into single summary builder
- Pass consistent data structure
- Reduce code duplication
- Easier to maintain and test

---

### 🟡 3.5 Save/Submit Logic

**Order Edit:**
- Uses `saveOrderChanges` from `src/lib/orderSaveService.ts`
- Complex change tracking (items added/removed/modified)
- Changelog creation
- Status management
- Payment method handling
- Notification sending

**Invoice Builder:**
- Uses `generateInvoice` from `src/lib/invoiceService.ts`
- Creates new order
- Creates invoice link
- Sends notifications
- No change tracking needed

**Current State:** These are appropriately separate since one edits existing orders and one creates new ones.

**Recommendation:** 🟡 **ACCEPTABLE AS-IS**
- Core logic is different enough to warrant separation
- Could extract common notification/validation logic
- Payment handling could be shared

---

## 4. Data Flow Comparison

### Order Edit Flow:
```
OrderDetailModal (main container)
  ↓
OrderDetailsTab (aggregator)
  ↓
[EventDetailsEditor, ItemsEditor, DiscountsManager, CustomFeesManager, DepositOverride, TaxWaiver, FeeWaiver, AdminMessage]
  ↓
useOrderPricing hook → recalculatePricing
  ↓
OrderSummary (x2: current + updated)
  ↓
Save → saveOrderChanges → sendOrderEditNotifications
```

### Invoice Builder Flow:
```
InvoiceBuilder (main container)
  ↓
[CustomerSelector, EventDetailsEditor, ItemsEditor, DiscountsManager, CustomFeesManager, DepositOverride, TaxWaiver, FeeWaiver, AdminMessageSection]
  ↓
useInvoicePricing hook
  ↓
Manual tax/total adjustments (useMemo)
  ↓
buildInvoiceSummary
  ↓
OrderSummary (x1)
  ↓
Generate → generateInvoice → send notifications
```

---

## 5. State Management Comparison

### Order Edit State:
```typescript
- activeSection (tabs)
- orderItems (from DB)
- notes, workflowEvents, changelog (from DB)
- availableUnits (from DB)
- editedOrder (modified order fields)
- stagedItems (items with is_new/is_deleted flags)
- discounts, customFees (arrays)
- adminMessage (string)
- saving, hasChanges (boolean flags)
- showCloseConfirm, showStatusDialog (modal states)
- adminOverrideApproval (boolean)
- availabilityIssues (array)
- checkingAvailability (boolean)
- customDepositCents, customDepositInput
- taxWaived, taxWaiveReason
- travelFeeWaived, travelFeeWaiveReason
- sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason
- surfaceFeeWaived, surfaceFeeWaiveReason
- generatorFeeWaived, generatorFeeWaiveReason
```

### Invoice Builder State:
```typescript
- cartItems (from hook)
- discounts, customFees (arrays)
- adminMessage (string)
- invoiceUrl (string)
- saving (boolean)
- taxWaived, taxWaiveReason
- travelFeeWaived, travelFeeWaiveReason
- sameDayPickupFeeWaived, sameDayPickupFeeWaiveReason
- surfaceFeeWaived, surfaceFeeWaiveReason
- generatorFeeWaived, generatorFeeWaiveReason
- eventDetails (from hook)
- customerManagement (from hook)
- deposit (from hook)
```

**Key Differences:**
- Order Edit manages more complex state (tabs, changelog, workflow)
- Order Edit tracks changes explicitly
- Invoice Builder uses more custom hooks
- Both manage fee waivers identically (duplicated state pattern)

---

## 6. Critical Issues Found

### 🔴 Issue #1: Duplicate Pricing Logic
**Problem:** Two different pricing calculation systems

**Impact:**
- Bug in one won't be fixed in the other
- Invoice pricing might differ from order edit pricing
- Tax calculation done differently (manual vs. hook-based)
- Maintenance nightmare

**Solution:**
- Create unified pricing hook/service
- Handle fee waivers in pricing logic, not UI
- Single source of truth for calculations

---

### 🔴 Issue #2: Tax Calculation Inconsistency
**Problem:** Invoice Builder manually calculates adjusted tax in component

**Order Edit:**
```typescript
// Tax handled in useOrderPricing hook
const { updatedOrderSummary, calculatedPricing, recalculatePricing } = useOrderPricing();
```

**Invoice Builder:**
```typescript
// Tax manually calculated in component (duplicated logic)
const adjustedTaxCents = useMemo(() => {
  if (taxWaived) return 0;
  const travelFee = travelFeeWaived ? 0 : (pricing.priceBreakdown?.travel_fee_cents || 0);
  // ... more manual calculations
  return Math.round(taxableAmount * 0.06);
}, [pricing, taxWaived, travelFeeWaived, ...]);
```

**Solution:**
- Move fee waiver handling into pricing hooks
- Remove manual calculations from components
- Ensure both screens use same tax logic

---

### 🔴 Issue #3: Summary Builder Duplication
**Problem:** Two functions doing the same thing
- `formatOrderSummary` (orderSummary.ts)
- `buildInvoiceSummary` (invoiceSummaryBuilder.ts)

**Solution:**
- Consolidate into single function
- Handle both use cases with parameters
- Reduce code duplication

---

### ⚠️ Issue #4: AdminMessage Components Not Shared
**Problem:** Two components with identical functionality, different styling

**Solution:**
- Create single AdminMessage component
- Accept styling props or variant prop
- Use consistently across both screens

---

### 🟡 Issue #5: No Real-Time Availability in Invoice Builder
**Problem:** Availability only checked on submit, not during building

**Impact:**
- Poor UX - user builds entire invoice then finds items unavailable
- No way to see conflicts while building

**Solution:**
- Add real-time availability checking to Invoice Builder
- Extract availability logic to shared hook
- Show same visual feedback as Order Edit

---

## 7. Recommendations Summary

### High Priority (Must Fix):

1. **🔴 Unify Pricing Calculation**
   - Create `usePricing` hook used by both screens
   - Handle fee waivers in pricing logic
   - Remove manual calculations from components
   - Estimated effort: 4-6 hours

2. **🔴 Consolidate Summary Builders**
   - Merge `formatOrderSummary` and `buildInvoiceSummary`
   - Single source of truth for summary display
   - Estimated effort: 2-3 hours

3. **🔴 Fix Tax Calculation**
   - Move tax calculation entirely into pricing logic
   - Remove manual useMemo calculations
   - Estimated effort: 1-2 hours

### Medium Priority (Should Fix):

4. **⚠️ Unify AdminMessage Components**
   - Single component with styling variants
   - Estimated effort: 30 minutes

5. **🟡 Add Real-Time Availability to Invoice Builder**
   - Extract availability checking to shared hook
   - Add visual feedback during building
   - Estimated effort: 2-3 hours

6. **🟡 Extract Customer Management**
   - Make customer selection/creation reusable
   - Could be useful in other areas
   - Estimated effort: 3-4 hours

### Low Priority (Nice to Have):

7. **Standardize Error Handling**
   - Both use different error patterns
   - Unify notification system usage

8. **Consolidate Validation Logic**
   - Both validate dates, addresses, etc.
   - Extract to shared validators

---

## 8. Testing Checklist

After unification, verify:

### Order Edit:
- [ ] Can modify event details (dates, times, location type)
- [ ] Can add/remove items
- [ ] Can add discounts and custom fees
- [ ] Can override deposit
- [ ] Can waive tax
- [ ] Can waive each fee type (travel, same-day pickup, surface, generator)
- [ ] Pricing recalculates correctly with all waivers
- [ ] Availability checking shows conflicts
- [ ] Save creates changelog entries
- [ ] Notifications sent correctly
- [ ] Payment method cleared when appropriate

### Invoice Builder:
- [ ] Can select/create customer
- [ ] Can build cart with quantities
- [ ] Can set event details
- [ ] Can add discounts and custom fees
- [ ] Can override deposit (including $0)
- [ ] Can waive tax
- [ ] Can waive each fee type
- [ ] Pricing calculates correctly with all waivers
- [ ] Availability checked before creation
- [ ] Invoice created successfully
- [ ] Link generated correctly
- [ ] Notifications sent to customer

### Both:
- [ ] Pricing matches between screens for same configuration
- [ ] Tax calculation identical
- [ ] Fee waivers work identically
- [ ] Deposit override works identically
- [ ] Discounts calculate the same
- [ ] Custom fees calculate the same

---

## 9. Conclusion

The Order Edit screen and Invoice Builder share many components successfully, but have critical differences in pricing calculation logic that must be unified. The shared components (EventDetailsEditor, ItemsEditor, DiscountsManager, CustomFeesManager, etc.) work well and demonstrate good code reuse.

**Priority Actions:**
1. Unify pricing calculation logic immediately
2. Consolidate summary builders
3. Fix tax calculation inconsistencies
4. Add real-time availability to Invoice Builder

These changes will ensure both screens behave consistently, reduce bugs, and make the codebase more maintainable.
