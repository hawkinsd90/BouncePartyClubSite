# Dynamic Rental Terms & Policies Pricing

## Problem

The Rental Terms & Policies section on the Checkout page displayed hardcoded pricing values:
- Deposit amount: Hardcoded "$12.50"
- Generator fee: Hardcoded "$35"

These values did NOT reflect the actual pricing configured by the admin in the Pricing tab, leading to customer confusion and incorrect expectations.

## Solution

Updated the Rental Terms component to dynamically fetch and display current pricing from the database:
- **Deposit amount** from `pricing_rules.deposit_per_unit_cents`
- **Generator fee** from `pricing_rules.generator_fee_single_cents`

## Implementation

### 1. Enhanced Pricing Cache (`src/lib/pricingCache.ts`)

**Added new fields to PricingRules interface:**
```typescript
interface PricingRules {
  deposit_percentage: number;
  deposit_per_unit_cents: number;          // NEW
  generator_fee_single_cents: number;      // NEW
  generator_fee_multiple_cents: number;    // NEW
}
```

**Added new function to fetch generator fee:**
```typescript
export async function getGeneratorFeeSingle(): Promise<number> {
  // If we already have cached data, return it
  if (cachedPricingRules) {
    return cachedPricingRules.generator_fee_single_cents || 10000;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    const result = await fetchPromise;
    return result?.generator_fee_single_cents || 10000;
  }

  // Start a new fetch
  fetchPromise = fetchPricingRules();

  const result = await fetchPromise;
  return result?.generator_fee_single_cents || 10000;
}
```

**Updated getDepositAmount() to fetch actual cents value:**
```typescript
export async function getDepositAmount(): Promise<number> {
  // If we already have cached data, return it
  if (cachedPricingRules) {
    return cachedPricingRules.deposit_per_unit_cents || 5000;
  }

  // If a fetch is already in progress, wait for it
  if (fetchPromise) {
    const result = await fetchPromise;
    return result?.deposit_per_unit_cents || 5000;
  }

  // Start a new fetch
  fetchPromise = fetchPricingRules();

  const result = await fetchPromise;
  return result?.deposit_per_unit_cents || 5000;
}
```

**Consolidated fetch logic:**
```typescript
async function fetchPricingRules(): Promise<PricingRules | null> {
  try {
    const { data, error } = await supabase
      .from('pricing_rules')
      .select('deposit_percentage, deposit_per_unit_cents, generator_fee_single_cents, generator_fee_multiple_cents')
      .maybeSingle();

    if (error) throw error;

    cachedPricingRules = data;
    return data;
  } catch (error) {
    console.error('Failed to fetch pricing rules:', error);
    return null;
  } finally {
    fetchPromise = null;
  }
}
```

**Benefits:**
- Single database query fetches all pricing fields
- Shared cache across all pricing functions
- Single in-flight request prevents duplicate fetches
- Default values if fetch fails (5000 cents = $50 deposit, 10000 cents = $100 generator)

### 2. Updated Rental Terms Component (`src/components/waiver/RentalTerms.tsx`)

**Added generator fee state and fetch:**
```typescript
import { getDepositAmount, getGeneratorFeeSingle } from '../../lib/pricingCache';

export function RentalTerms() {
  const [depositCents, setDepositCents] = useState(5000);
  const [generatorFeeCents, setGeneratorFeeCents] = useState(10000);

  useEffect(() => {
    getDepositAmount().then(setDepositCents);
    getGeneratorFeeSingle().then(setGeneratorFeeCents);  // NEW
  }, []);

  const depositAmount = formatCurrency(depositCents);
  const generatorFee = formatCurrency(generatorFeeCents);  // NEW
```

**Updated generator fee text to use dynamic value:**

**Before:**
```typescript
<li>We require access to a standard electrical outlet within 50 feet. If unavailable, a $35 generator rental fee applies</li>
```

**After:**
```typescript
<li>We require access to a standard electrical outlet within 50 feet. If unavailable, a {generatorFee} generator rental fee applies</li>
```

## How It Works

### On Page Load

1. **RentalTerms component mounts**
2. **useEffect triggers** two parallel cache lookups:
   - `getDepositAmount()` → fetches deposit_per_unit_cents
   - `getGeneratorFeeSingle()` → fetches generator_fee_single_cents
3. **pricingCache checks cache**:
   - If cached: returns immediately
   - If fetching: waits for existing promise
   - If fresh: starts new database query
4. **Single database query** fetches all pricing fields (efficient)
5. **Cache populated** for subsequent calls
6. **State updated** with fetched values
7. **Component re-renders** with dynamic pricing
8. **User sees current pricing** matching admin configuration

### Cache Behavior

- **First call**: Initiates database fetch, returns promise
- **Concurrent calls**: Wait for same promise (no duplicate queries)
- **Subsequent calls**: Return cached values instantly
- **Cache lifetime**: Persists until page reload
- **Cache invalidation**: Call `clearPricingCache()` to force refresh

### Fallback Values

If database fetch fails:
- Deposit: $50.00 (5000 cents)
- Generator: $100.00 (10000 cents)

These are reasonable defaults that won't cause major issues.

## Example Scenarios

### Scenario 1: Admin Sets Deposit to $75

**Admin Action:**
1. Navigate to Admin → Pricing tab
2. Set "Deposit Per Unit" to $75.00
3. Save

**Customer Experience:**
1. Go to checkout page
2. Scroll to "Rental Terms & Policies"
3. Read: "This booking requires a minimum **$75.00** deposit per inflatable..."
4. Pricing matches what they'll actually pay

### Scenario 2: Admin Sets Generator Fee to $125

**Admin Action:**
1. Navigate to Admin → Pricing tab
2. Set "First Generator Fee" to $125.00
3. Save

**Customer Experience:**
1. Go to checkout page
2. Scroll to "Setup & Pickup Expectations"
3. Read: "...If unavailable, a **$125.00** generator rental fee applies"
4. Pricing matches what they'll actually pay

### Scenario 3: Multiple Values Changed

**Admin Changes:**
- Deposit: $50.00 → $60.00
- Generator: $100.00 → $95.00

**Customer sees:**
- "...minimum **$60.00** deposit per inflatable..."
- "...a **$95.00** generator rental fee applies"

All values update automatically without code changes.

## Testing

### Test 1: Verify Deposit Display

1. Navigate to Admin → Pricing tab
2. Note current "Deposit Per Unit" value (e.g., $50.00)
3. Navigate to Checkout page (add item to cart first)
4. Scroll to "Rental Terms & Policies"
5. Verify deposit matches: "$50.00 deposit per inflatable"

### Test 2: Verify Generator Display

1. Navigate to Admin → Pricing tab
2. Note current "First Generator Fee" value (e.g., $95.00)
3. Navigate to Checkout page
4. Scroll to "Setup & Pickup Expectations"
5. Find the generator fee line
6. Verify fee matches: "$95.00 generator rental fee applies"

### Test 3: Update Pricing and Verify

1. Navigate to Admin → Pricing tab
2. Change "Deposit Per Unit" to $75.00
3. Change "First Generator Fee" to $125.00
4. Click "Save Pricing Rules"
5. Navigate to Checkout page (refresh if already there)
6. Verify both values updated:
   - Deposit: $75.00
   - Generator: $125.00

### Test 4: Cache Performance

1. Open browser DevTools → Network tab
2. Navigate to Checkout page
3. Note single query to `pricing_rules` table
4. Scroll through page
5. Verify NO additional queries to pricing_rules
6. Cache working correctly

## Files Changed

### 1. `src/lib/pricingCache.ts`

**Changes:**
- Added `deposit_per_unit_cents`, `generator_fee_single_cents`, `generator_fee_multiple_cents` to `PricingRules` interface
- Created `fetchPricingRules()` helper to consolidate database query
- Updated `getDepositAmount()` to return `deposit_per_unit_cents` from cache
- Added `getGeneratorFeeSingle()` to return `generator_fee_single_cents` from cache
- All functions share same cache and in-flight promise
- Single database query fetches all fields efficiently

### 2. `src/components/waiver/RentalTerms.tsx`

**Changes:**
- Imported `getGeneratorFeeSingle` from pricingCache
- Added `generatorFeeCents` state (default 10000 = $100)
- Added `useEffect` call to fetch generator fee
- Created `generatorFee` formatted currency string
- Replaced hardcoded "$35" with dynamic `{generatorFee}` variable

## Benefits

### 1. Accuracy
- Customers see actual pricing, not outdated hardcoded values
- Eliminates confusion and support tickets
- Builds trust with transparent, correct pricing

### 2. Maintainability
- Admin can update pricing without touching code
- No need to redeploy when prices change
- Single source of truth in database

### 3. Consistency
- Pricing shown in terms matches actual checkout calculations
- Deposit amount consistent across checkout flow
- Generator fee matches what's added to invoice

### 4. Performance
- Efficient caching prevents duplicate queries
- Single database query fetches all pricing
- Fast subsequent renders use cached values

### 5. User Experience
- No stale pricing information
- Real-time reflection of current rates
- Professional, trustworthy presentation

## Related Documentation

- See admin pricing configuration in Pricing tab
- Generator fees also used in quote/order calculations
- Deposit amounts used throughout checkout flow
- See `src/lib/pricing.ts` for pricing calculation logic
