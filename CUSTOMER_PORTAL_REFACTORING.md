# CustomerPortal.tsx Refactoring Plan

## Current State
- **File Size:** 1,564 lines
- **Complexity:** Very High - handles 5 different views with complex state management

## Proposed Structure

### Hooks Created
1. ✅ **useOrderData.ts** - Centralized data loading and management

### Components to Create

#### Small/Medium Components (✅ Complete)
1. ✅ **PaymentAmountSelector.tsx** - Payment selection UI
2. ✅ **CustomerInfoForm.tsx** - Customer information form
3. ✅ **ApprovalSuccessView.tsx** - Success screen after approval
4. ✅ **OrderStatusView.tsx** - Generic order status display

#### Large Components (Need Creation)
5. **InvoiceAcceptanceView.tsx** (~400 lines)
   - Draft order invoice display
   - Payment amount selector
   - Tip selector
   - Customer info form (if needed)
   - Consent checkboxes
   - Accept & Pay button
   - Invoice modal with PrintableInvoice

6. **OrderApprovalView.tsx** (~250 lines)
   - Changelog display
   - Admin message
   - Current booking details
   - Approve/Reject buttons
   - ApprovalModal and RejectionModal integration

7. **RegularPortalView.tsx** (~180 lines)
   - Tab navigation (Waiver/Payment/Pictures)
   - Status indicators
   - WaiverTab, PaymentTab, PicturesTab integration

### Refactored CustomerPortal.tsx Structure
```typescript
export function CustomerPortal() {
  // URL params and state
  const { orderId, token } = useParams();
  const isInvoiceLink = location.pathname.startsWith('/invoice/');

  // Load order data using custom hook
  const { data, loading, loadOrder } = useOrderData();

  useEffect(() => {
    loadOrder(orderId, token, isInvoiceLink);
  }, [orderId]);

  // Loading state
  if (loading) return <LoadingScreen />;

  // Error state
  if (!data?.order) return <OrderNotFoundScreen />;

  const { order } = data;

  // Computed states
  const needsApproval = order.status === 'awaiting_customer_approval';
  const isDraft = order.status === 'draft';
  const isActive = ['confirmed', 'in_progress', 'completed'].includes(order.status);

  // View routing based on order state
  if (approvalSuccess) {
    return <ApprovalSuccessView orderId={order.id} />;
  }

  if (!isActive && !needsApproval) {
    if (isDraft) {
      return <InvoiceAcceptanceView {...props} />;
    }
    return <OrderStatusView order={order} />;
  }

  if (needsApproval) {
    return <OrderApprovalView {...props} />;
  }

  return <RegularPortalView {...props} />;
}
```

## Benefits

### Maintainability
- Each view is self-contained in its own file
- Easy to locate and modify specific functionality
- Clear separation of concerns

### Readability
- Main file reduced from 1,564 to ~200 lines
- Each component focuses on a single responsibility
- Easier to understand the flow

### Testing
- Individual components can be tested in isolation
- Mock data can be passed as props
- Easier to identify edge cases

### Reusability
- Components like PaymentAmountSelector can be reused
- CustomerInfoForm can be used in multiple flows
- TipSelector logic is centralized

## File Size Reduction
- **Current:** 1,564 lines
- **Target:** ~200 lines (87% reduction)
- **Components:** 8 new focused files

## Next Steps
1. Create InvoiceAcceptanceView.tsx
2. Create OrderApprovalView.tsx
3. Create RegularPortalView.tsx
4. Refactor main CustomerPortal.tsx to use new components
5. Test all views and flows
6. Run build verification
