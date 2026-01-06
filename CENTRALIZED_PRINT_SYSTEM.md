# Centralized Print/PDF System

## Overview

The application now has a unified, robust print/PDF system that eliminates code duplication and provides a consistent experience across all print features.

## Core Components

### 1. `PrintModal` Component
Location: `src/components/common/PrintModal.tsx`

A generic modal wrapper for all print previews.

**Features:**
- Consistent UI across all print features
- Print and close buttons
- Optional download button
- Configurable title and max width
- Callbacks for before/after print events
- Responsive design

**Usage:**
```tsx
import { PrintModal } from '../../components/common/PrintModal';

<PrintModal
  isOpen={isPrintModalOpen}
  onClose={closePrintModal}
  title="Invoice Preview"
  maxWidth="5xl"
  onBeforePrint={() => console.log('About to print')}
  onAfterPrint={() => console.log('Print complete')}
>
  <PrintableInvoice {...data} />
</PrintModal>
```

### 2. `usePrint` Hook
Location: `src/hooks/usePrint.ts`

Manages print-related state and operations.

**Features:**
- Modal state management
- Print event handling
- Before/after print callbacks
- Browser print event listeners
- Immediate print functionality

**Usage:**
```tsx
import { usePrint } from '../../hooks/usePrint';

const { isPrintModalOpen, openPrintModal, closePrintModal, print } = usePrint({
  onBeforePrint: () => {
    // Analytics, cleanup, etc.
  },
  onAfterPrint: () => {
    // Post-print actions
  },
});
```

### 3. `PrintDocument` Component
Location: `src/components/common/PrintDocument.tsx`

Wrapper for configuring print-specific layout and styling.

**Features:**
- Portrait/landscape orientation
- Paper size configuration (letter, A4, legal)
- Optional headers and footers
- Print-specific CSS injection
- Screen vs. print rendering

**Usage:**
```tsx
import { PrintDocument } from '../../components/common/PrintDocument';

<PrintDocument
  orientation="portrait"
  size="letter"
  showHeader={true}
  headerContent={<div>Custom Header</div>}
  showFooter={true}
  footerContent={<div>Page Footer</div>}
>
  <YourContent />
</PrintDocument>
```

### 4. `PrintableInvoice` Component
Location: `src/components/common/PrintableInvoice.tsx`

Generic invoice/document renderer that works for all document types.

**Features:**
- Supports invoices, receipts, quotes, waivers, catalogs, reports
- Flexible business branding
- Line items with quantities and prices
- Charges (fees, discounts)
- Contact and address display
- Payment information
- Custom headers and footers

**Usage:**
```tsx
import { PrintableInvoice } from '../../components/common/PrintableInvoice';

<PrintableInvoice
  type="invoice"
  documentNumber="INV-12345"
  title="Invoice"
  date="2026-01-06"
  items={items}
  charges={charges}
  subtotal={10000}
  tax={600}
  total={10600}
  contact={contactInfo}
  address={addressInfo}
  showDepositInfo={true}
  metadata={{ depositDue: 5000, balanceDue: 5600 }}
/>
```

### 5. Print Utilities
Location: `src/lib/printUtils.ts`

Comprehensive utility functions for data transformation and formatting.

**Key Functions:**
- `transformOrderToPrintableDocument()` - Converts order data to print format
- `transformPaymentToPrintableReceipt()` - Converts payment data to receipt format
- `formatPrintableAddress()` - Formats addresses for display
- `formatPrintableContact()` - Formats contact information
- `formatPrintablePaymentMethod()` - Formats payment method display
- `calculatePrintableTotal()` - Calculates totals with charges
- `formatDocumentNumber()` - Generates document numbers with prefixes

**Data Interfaces:**
```typescript
interface PrintableDocument {
  type: 'invoice' | 'receipt' | 'quote' | 'waiver' | 'catalog' | 'report';
  documentNumber?: string;
  title: string;
  date: string;
  items: PrintableItem[];
  charges: PrintableCharge[];
  subtotal: number;
  tax: number;
  total: number;
  contact?: PrintableContact;
  address?: PrintableAddress;
  payment?: PrintablePayment;
  notes?: string;
  metadata?: Record<string, any>;
}
```

### 6. Print Integration Helpers
Location: `src/lib/printIntegration.ts`

High-level functions for preparing data for specific print scenarios.

**Functions:**
- `prepareInvoicePreview()` - Invoice preview from order
- `preparePaymentReceipt()` - Receipt from payment
- `prepareQuotePreview()` - Quote from cart data
- `prepareCatalogPrint()` - Catalog from units
- `prepareWaiverPrint()` - Waiver from signature

## Migration Guide

### Existing Features to Migrate

1. **Quote Invoice Preview** (Quote.tsx)
2. **Customer Invoice Acceptance** (CustomerPortal.tsx / InvoiceAcceptanceView.tsx)
3. **Invoice Payment Page** (Invoice.tsx)
4. **Payment Receipt** (ReceiptModal.tsx)
5. **Signed Waiver Download** (WaiverViewer.tsx)
6. **Catalog Print** (Catalog.tsx)

### Step-by-Step Migration Example

#### Before (ReceiptModal.tsx):
```tsx
// 150+ lines of duplicated code
const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

const prepareReceiptData = () => {
  // Complex data transformation
  return { ... };
};

return (
  <div className="fixed inset-0 bg-black bg-opacity-50 z-50">
    {/* Duplicated modal structure */}
    <div className="bg-white rounded-lg">
      <div className="flex justify-between">
        <button onClick={() => window.print()}>Print</button>
        <button onClick={onClose}>Close</button>
      </div>
      {/* Custom invoice layout */}
    </div>
  </div>
);
```

#### After (Using Centralized System):
```tsx
import { usePrint } from '../../hooks/usePrint';
import { PrintModal } from '../../components/common/PrintModal';
import { PrintableInvoice } from '../../components/common/PrintableInvoice';
import { preparePaymentReceipt } from '../../lib/printIntegration';

const { isPrintModalOpen, openPrintModal, closePrintModal } = usePrint();

const receiptData = preparePaymentReceipt(payment, order, orderItems);

return (
  <>
    <button onClick={openPrintModal}>View Receipt</button>

    <PrintModal
      isOpen={isPrintModalOpen}
      onClose={closePrintModal}
      title="Payment Receipt"
    >
      <PrintableInvoice
        {...receiptData}
        showPaymentInfo={true}
      />
    </PrintModal>
  </>
);
```

### Benefits

- **Reduced from 150+ lines to 15-20 lines per feature**
- **Type-safe** data transformation
- **Consistent UI** across all print features
- **Easy to extend** for new document types
- **Centralized styling** and print CSS
- **Better maintainability** - fix once, apply everywhere

## Adding New Print Features

### Example: Adding a "Packing Slip" Feature

1. **Define the data structure** (if needed):
```tsx
// In printUtils.ts - use existing PrintableDocument or extend it
```

2. **Create a preparation function**:
```tsx
// In printIntegration.ts
export function preparePackingSlip(order: any, orderItems: any[]) {
  return transformOrderToPrintableDocument(order, orderItems);
}
```

3. **Use in your component**:
```tsx
import { usePrint } from '../../hooks/usePrint';
import { PrintModal } from '../../components/common/PrintModal';
import { PrintableInvoice } from '../../components/common/PrintableInvoice';
import { preparePackingSlip } from '../../lib/printIntegration';

function PackingSlipButton({ order, items }) {
  const { isPrintModalOpen, openPrintModal, closePrintModal } = usePrint();
  const slipData = preparePackingSlip(order, items);

  return (
    <>
      <button onClick={openPrintModal}>Print Packing Slip</button>

      <PrintModal
        isOpen={isPrintModalOpen}
        onClose={closePrintModal}
        title="Packing Slip"
      >
        <PrintableInvoice
          {...slipData}
          type="report"
          title="Packing Slip"
          showPaymentInfo={false}
        />
      </PrintModal>
    </>
  );
}
```

That's it! No need to build custom modals, print handlers, or data transformers.

## Print CSS Classes

The system includes these CSS classes for print control:

- `.no-print` - Hides element when printing
- `.print-only` - Shows element only when printing
- `.page-break` - Forces page break after element
- `.avoid-break` - Prevents page break inside element
- `.no-print-padding` - Removes padding when printing

## Future Enhancements

The centralized system makes it easy to add:

- **PDF generation** (replace `window.print()` with a library)
- **Email PDF** functionality
- **Save to database** functionality
- **Print templates** system
- **Custom branding** per customer
- **Watermarks** for unpaid invoices
- **QR codes** for quick access
- **Digital signatures** integration
- **Multi-language** support

## Testing

Test the print system by:

1. Opening the print modal
2. Clicking "Print / Save PDF"
3. Using browser's "Save as PDF" option
4. Verifying all data displays correctly
5. Checking page breaks are appropriate
6. Ensuring branding appears correctly

## Support

For issues or questions about the print system, check:
- Component props and TypeScript interfaces
- Browser compatibility (Chrome, Firefox, Safari, Edge all supported)
- Print CSS in browser dev tools
- Console for any errors during print lifecycle
