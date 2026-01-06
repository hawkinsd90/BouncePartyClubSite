# Print System Quick Start Guide

## 5-Minute Setup for Any New Print Feature

### Step 1: Import the Essentials

```tsx
import { usePrint } from '../../hooks/usePrint';
import { PrintModal } from '../../components/common/PrintModal';
import { PrintableInvoice } from '../../components/common/PrintableInvoice';
```

### Step 2: Add Print State

```tsx
function YourComponent() {
  const { isPrintModalOpen, openPrintModal, closePrintModal } = usePrint();

  // Your component code...
}
```

### Step 3: Add Print Button

```tsx
<button onClick={openPrintModal}>
  View Invoice / Receipt / Quote
</button>
```

### Step 4: Add Print Modal

```tsx
<PrintModal
  isOpen={isPrintModalOpen}
  onClose={closePrintModal}
  title="Your Document Title"
>
  <PrintableInvoice
    type="invoice"
    documentNumber="INV-001"
    date={new Date().toISOString()}
    items={[
      { name: 'Item 1', quantity: 2, unitPrice: 5000, totalPrice: 10000 }
    ]}
    charges={[
      { label: 'Delivery Fee', amount: 2500 }
    ]}
    subtotal={10000}
    tax={600}
    total={13100}
  />
</PrintModal>
```

Done! You now have a fully functional print feature.

---

## Common Patterns

### Pattern 1: Invoice/Order Preview

```tsx
import { prepareInvoicePreview } from '../../lib/printIntegration';

const invoiceData = prepareInvoicePreview(order, orderItems, discounts, customFees);

<PrintableInvoice
  {...invoiceData}
  showDepositInfo={true}
/>
```

### Pattern 2: Payment Receipt

```tsx
import { preparePaymentReceipt } from '../../lib/printIntegration';

const receiptData = preparePaymentReceipt(payment, order, orderItems);

<PrintableInvoice
  {...receiptData}
  showPaymentInfo={true}
  businessLogo="/logo.png"
/>
```

### Pattern 3: Quote Generation

```tsx
import { prepareQuotePreview } from '../../lib/printIntegration';

const quoteData = prepareQuotePreview(quoteData, cart, priceBreakdown, contactData);

<PrintableInvoice
  {...quoteData}
  type="quote"
  title="Price Quote"
/>
```

### Pattern 4: Custom Document

```tsx
<PrintableInvoice
  type="report"
  title="Custom Report"
  date={new Date().toISOString()}
  items={myItems}
  charges={myCharges}
  subtotal={mySubtotal}
  tax={myTax}
  total={myTotal}
  customHeader={
    <div>Your custom header</div>
  }
  customFooter={
    <div>Your custom footer</div>
  }
/>
```

---

## Props Reference

### PrintModal Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | required | Modal visibility |
| `onClose` | `() => void` | required | Close handler |
| `title` | `string` | `'Print Preview'` | Modal title |
| `printButtonText` | `string` | `'Print / Save PDF'` | Button text |
| `showDownloadButton` | `boolean` | `false` | Show download button |
| `maxWidth` | `'sm' \| 'md' \| 'lg' \| 'xl' \| '2xl' \| '3xl' \| '4xl' \| '5xl' \| 'full'` | `'5xl'` | Modal width |
| `onBeforePrint` | `() => void` | - | Before print callback |
| `onAfterPrint` | `() => void` | - | After print callback |

### PrintableInvoice Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | `'invoice' \| 'receipt' \| 'quote' \| 'waiver' \| 'catalog' \| 'report'` | `'invoice'` | Document type |
| `documentNumber` | `string` | - | Document ID |
| `title` | `string` | - | Document title |
| `date` | `string` | - | ISO date string |
| `items` | `PrintableItem[]` | `[]` | Line items |
| `charges` | `PrintableCharge[]` | `[]` | Additional charges |
| `subtotal` | `number` | `0` | Subtotal in cents |
| `tax` | `number` | `0` | Tax in cents |
| `total` | `number` | `0` | Total in cents |
| `contact` | `PrintableContact` | - | Customer info |
| `address` | `PrintableAddress` | - | Address info |
| `payment` | `PrintablePayment` | - | Payment info |
| `notes` | `string` | - | Additional notes |
| `metadata` | `Record<string, any>` | - | Custom metadata |
| `businessName` | `string` | `'Bounce Party Club'` | Business name |
| `businessLogo` | `string` | - | Logo URL |
| `businessAddress` | `string` | - | Business address |
| `businessPhone` | `string` | - | Business phone |
| `businessEmail` | `string` | - | Business email |
| `showPaymentInfo` | `boolean` | `false` | Display payment section |
| `showDepositInfo` | `boolean` | `false` | Display deposit section |
| `customHeader` | `ReactNode` | - | Custom header content |
| `customFooter` | `ReactNode` | - | Custom footer content |

---

## CSS Classes for Print Control

Use these in your content:

- `.no-print` - Hidden when printing
- `.print-only` - Visible only when printing
- `.page-break` - Force page break after
- `.avoid-break` - Prevent break inside
- `.no-print-padding` - Remove padding when printing

Example:
```tsx
<div className="no-print">
  <button>This won't print</button>
</div>

<div className="print-only">
  <p>This only appears in PDF</p>
</div>

<div className="avoid-break">
  <h2>Section Title</h2>
  <p>Content that stays together</p>
</div>
```

---

## Troubleshooting

### Problem: Content not showing in print

**Solution:** Make sure your content is inside `PrintModal` and not marked with `.no-print`

### Problem: Wrong page size

**Solution:** Use `PrintDocument` wrapper with `size` prop:

```tsx
<PrintDocument size="letter" orientation="portrait">
  <YourContent />
</PrintDocument>
```

### Problem: Logo not printing

**Solution:** Ensure logo path is correct and accessible. Use absolute URLs for remote images.

### Problem: Colors not printing

**Solution:** Already handled! The CSS includes `print-color-adjust: exact`

### Problem: Multiple pages breaking incorrectly

**Solution:** Use `.avoid-break` class on sections that should stay together

---

## Best Practices

1. **Always use the centralized components** - Don't create custom modals
2. **Transform data once** - Use the `prepare*` functions from `printIntegration.ts`
3. **Test in browser** - Use "Save as PDF" to verify layout
4. **Keep custom content minimal** - Use `customHeader` and `customFooter` sparingly
5. **Type your data** - Use the provided TypeScript interfaces
6. **Consider mobile** - Print preview should look good on mobile too

---

## Examples in Codebase

Look at these files for reference:

- `src/components/dashboard/ReceiptModal.tsx` - Payment receipt
- `src/components/checkout/InvoicePreviewModal.tsx` - Invoice preview
- `src/pages/Invoice.tsx` - Invoice acceptance
- `src/components/waiver/WaiverViewer.tsx` - Waiver document

---

## Need More Control?

### Use PrintDocument for Custom Layouts

```tsx
<PrintDocument
  orientation="landscape"
  size="legal"
  showHeader={true}
  headerContent={<div>Custom Header</div>}
  showFooter={true}
  footerContent={<div>Page {pageNum}</div>}
>
  <YourCustomContent />
</PrintDocument>
```

### Use Print Utilities Directly

```tsx
import { formatPrintableAddress, calculatePrintableTotal } from '../../lib/printUtils';

const addressString = formatPrintableAddress(address);
const total = calculatePrintableTotal(subtotal, charges, tax);
```

### Add Print Callbacks

```tsx
const { isPrintModalOpen, openPrintModal, closePrintModal } = usePrint({
  onBeforePrint: () => {
    console.log('Printing started');
    // Track analytics
  },
  onAfterPrint: () => {
    console.log('Printing finished');
    // Close modal automatically
    closePrintModal();
  },
});
```

---

## Getting Help

- Check `CENTRALIZED_PRINT_SYSTEM.md` for detailed documentation
- Look at `MIGRATION_EXAMPLE.md` for real-world migration example
- Review TypeScript interfaces in `src/lib/printUtils.ts`
- Test your implementation with different browsers
