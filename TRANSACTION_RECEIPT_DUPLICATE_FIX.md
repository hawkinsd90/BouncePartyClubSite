# Transaction Receipt Duplicate Fix

## Problem

When approving orders, the console showed a duplicate key violation error:

```
[TransactionReceipt] Error logging transaction:
{code: "23505", details: null, hint: null, message: "duplicate key value violates unique constraint"}
```

This occurred because the `transaction_receipts` table has a unique constraint on `stripe_charge_id` (added in migration `20260311111714_upgrade_transaction_receipts_enterprise_safety.sql`) to prevent duplicate receipts.

## Root Cause

The order approval flow was attempting to log transaction receipts that already existed:

1. **Initial deposit charge**: When `charge-deposit` edge function creates a deposit payment, it does NOT create a transaction receipt
2. **Order approval**: The `approveOrder()` function calls `logGroupedTransactions()` to create deposit and tip receipts
3. **Duplicate attempt**: If approval is attempted twice (e.g., user clicks approve again, or webhook retry), the second attempt tries to insert a receipt with the same `stripe_charge_id`
4. **Constraint violation**: The unique constraint `unique_receipt_charge` on `stripe_charge_id` prevents the duplicate and throws error code `23505`

## Solution

Modified `logTransaction()` in `src/lib/transactionReceiptService.ts` to handle duplicates gracefully:

### Before
```typescript
export async function logTransaction(data: TransactionReceiptData): Promise<string | null> {
  try {
    const { data: receipt, error } = await supabase
      .from('transaction_receipts')
      .insert({...})
      .select('receipt_number')
      .single();

    if (error) {
      console.error('[TransactionReceipt] Error logging transaction:', error);
      return null;
    }

    return receipt.receipt_number;
  }
}
```

### After
```typescript
export async function logTransaction(data: TransactionReceiptData): Promise<string | null> {
  try {
    // If stripe_charge_id exists, check for existing receipt first
    if (data.stripeChargeId) {
      const { data: existingReceipt } = await supabase
        .from('transaction_receipts')
        .select('receipt_number')
        .eq('stripe_charge_id', data.stripeChargeId)
        .maybeSingle();

      if (existingReceipt) {
        console.log('[TransactionReceipt] Receipt already exists for charge:', existingReceipt.receipt_number);
        return existingReceipt.receipt_number;
      }
    }

    // Attempt insert
    const { data: receipt, error } = await supabase
      .from('transaction_receipts')
      .insert({...})
      .select('receipt_number')
      .single();

    if (error) {
      // If unique constraint violation on stripe_charge_id, try to fetch existing receipt
      if (error.code === '23505' && data.stripeChargeId) {
        console.warn('[TransactionReceipt] Duplicate charge_id detected, fetching existing receipt');
        const { data: existingReceipt } = await supabase
          .from('transaction_receipts')
          .select('receipt_number')
          .eq('stripe_charge_id', data.stripeChargeId)
          .maybeSingle();

        if (existingReceipt) {
          return existingReceipt.receipt_number;
        }
      }

      console.error('[TransactionReceipt] Error logging transaction:', error);
      return null;
    }

    return receipt.receipt_number;
  }
}
```

## Changes Made

1. **Pre-check for duplicates**: Before inserting, check if a receipt already exists with the same `stripe_charge_id`
2. **Return existing receipt**: If duplicate found, return the existing receipt number instead of attempting insert
3. **Fallback on constraint violation**: If insert fails with error code `23505` (unique violation), fetch and return the existing receipt
4. **Graceful degradation**: The function now handles race conditions where two requests try to create the same receipt simultaneously

## Benefits

- **No more console errors**: Duplicate charge_id attempts now return existing receipt silently
- **Idempotent behavior**: Calling `logGroupedTransactions()` multiple times for the same charge is safe
- **Better UX**: Order approval no longer fails due to receipt logging errors
- **Admin notifications still work**: Even when returning an existing receipt, the admin notification logic continues normally
- **Webhook retry safety**: If Stripe retries a webhook, duplicate receipts won't be created

## Testing

To verify the fix:

1. Create an order and submit payment method
2. Approve the order (this creates transaction receipts)
3. Try approving again or refresh and click approve
4. Check console - should see `[TransactionReceipt] Receipt already exists for charge: RCP-...` instead of error
5. Verify in database that only one receipt exists per charge_id:

```sql
SELECT
  stripe_charge_id,
  COUNT(*) as receipt_count
FROM transaction_receipts
WHERE stripe_charge_id IS NOT NULL
GROUP BY stripe_charge_id
HAVING COUNT(*) > 1;
```

Expected result: 0 rows (no duplicate charge_ids)

## Deployment

- Build: ✅ Success (9.61s)
- Files modified: `src/lib/transactionReceiptService.ts`
- Database changes: None (leverages existing unique constraint)

## Related Files

- `src/lib/orderApprovalService.ts` - Calls `logGroupedTransactions()`
- `supabase/functions/charge-deposit/index.ts` - Creates deposit payment (no receipt)
- `supabase/migrations/20260311111714_upgrade_transaction_receipts_enterprise_safety.sql` - Defines `unique_receipt_charge` constraint
