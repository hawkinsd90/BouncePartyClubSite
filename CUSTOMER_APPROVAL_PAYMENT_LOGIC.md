# Customer Approval Payment Logic

## Overview
When a customer approves changes to their order (status: `awaiting_customer_approval`), the system determines whether to charge a deposit based on payment history.

## Payment Flow Logic

### Scenario A: Customer Already Paid Initial Deposit
**Condition:** `deposit_paid_cents >= deposit_due_cents`

**What Happens:**
1. Customer approves changes via portal
2. System detects deposit was already paid
3. **No additional charge is made** (even if deposit requirement increased)
4. Order status updates to `confirmed`
5. Any price increases are added to the final balance due at the event
6. Customer sees: "Order approved successfully! Any changes will be added to your final balance."

**Example:**
- Original: Total $1000, Deposit $200 (paid ✓)
- Admin adds inflatable: Total becomes $1200, Deposit requirement $240
- Customer approves: No charge, deposit stays $200
- Final balance due: $1000 (original balance due + $200 increase)

### Scenario B: Customer Has Not Paid Initial Deposit
**Condition:** `deposit_paid_cents < deposit_due_cents`

**What Happens:**
1. Customer approves changes via portal
2. System detects no deposit paid yet
3. **Charge the full deposit** via `charge-deposit` edge function
4. Order status updates to `confirmed`
5. Customer sees: "Order approved and payment processed successfully!"

**Example:**
- Draft order: Total $1000, Deposit $200, $0 paid
- Customer approves: Charges $200 deposit
- Order confirmed

## Implementation Details

### Frontend (ApprovalModal.tsx)
```typescript
const alreadyPaidDeposit = (order.deposit_paid_cents || 0) >= (order.deposit_due_cents || 0);

if (alreadyPaidDeposit) {
  // Just update status to confirmed - skip charge
  await supabase
    .from('orders')
    .update({ status: 'confirmed' })
    .eq('id', order.id);
} else {
  // Charge the deposit
  await supabase.functions.invoke('charge-deposit', {
    body: { orderId: order.id }
  });
}
```

### Backend (charge-deposit edge function)
The edge function also has duplicate protection:
```typescript
if (order.deposit_paid_cents >= order.deposit_due_cents) {
  // Already paid - just update status if needed
  if (order.status !== 'confirmed') {
    await supabase
      .from("orders")
      .update({ status: "confirmed" })
      .eq("id", orderId);
  }
  return { success: true, alreadyCharged: true };
}
```

## Business Rules

1. **No Double Charging:** Once initial deposit is paid, never charge additional deposit amounts
2. **Price Increases:** Any increases from added items go entirely to final balance due
3. **Customer Flexibility:** Customers who already committed financially aren't penalized for admin changes
4. **Transparent Communication:** Clear messaging about what's happening with their payment

## Edge Cases Handled

- **Date Changes Only:** If only event date changes (no price change), no charge if deposit paid
- **Adding Multiple Items:** All increases accumulate to final balance if deposit paid
- **Partial Deposit:** If `deposit_paid_cents < deposit_due_cents`, charges the difference
- **Concurrent Approvals:** Both frontend and backend check payment status to prevent double charge
