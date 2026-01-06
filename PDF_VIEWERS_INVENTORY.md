# PDF/Print System Inventory

Complete inventory of all PDF viewing/generation features in the application.

## Overview

The application has **6 distinct PDF viewing/generation features**, each with its own implementation. Currently, they all use similar but duplicated code patterns.

---

## Feature #1: Quote Invoice Preview (Checkout Flow)

### Location
- **Page:** Quote → Checkout Flow
- **Component:** `src/components/checkout/InvoicePreviewModal.tsx`

### Implementation Details
- **Trigger:** User clicks "Preview Invoice" button during checkout
- **Window.print() call:** Line 32
- **Modal wrapper:** Custom modal (lines 26-58)
- **Print content renderer:** `PrintableInvoice` from `src/components/invoice/PrintableInvoice.tsx`

### Code Structure
```tsx
// Modal with custom header and print button
<div className="fixed inset-0 bg-black bg-opacity-50 z-50">
  <div className="bg-white rounded-lg max-w-5xl">
    <div className="no-print">
      <button onClick={() => window.print()}>Print / Save PDF</button>
      <button onClick={onClose}>Close</button>
    </div>
    <PrintableInvoice {...props} />
  </div>
</div>
```

### Data Sources
- `quoteData` - Event details (date, address, location type)
- `priceBreakdown` - Pricing calculations
- `cart` - Selected units
- `contactData` - Customer information

### File Dependencies
- Component: `src/components/checkout/InvoicePreviewModal.tsx` (60 lines)
- Renderer: `src/components/invoice/PrintableInvoice.tsx` (356 lines)
- Icons: Lucide React (X, Printer)

---

## Feature #2: Customer Invoice Acceptance

### Location
- **Page:** Customer Portal
- **Component:** `src/components/customer-portal/InvoiceAcceptanceView.tsx`

### Implementation Details
- **Trigger:** Customer clicks "View as Invoice / Print PDF" button (line 381)
- **Window.print() call:** Line 55 (handlePrintInvoice function)
- **Modal:** Inline modal in JSX (lines 552-586)
- **Print content renderer:** `PrintableInvoice` from `src/components/invoice/PrintableInvoice.tsx`

### Code Structure
```tsx
// State management
const [showInvoiceModal, setShowInvoiceModal] = useState(false);

const handlePrintInvoice = () => {
  window.print();
};

// Modal rendering
{showInvoiceModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 z-50">
    <div className="bg-white rounded-lg max-w-5xl">
      <div className="no-print">
        <button onClick={handlePrintInvoice}>Print / Save PDF</button>
        <button onClick={() => setShowInvoiceModal(false)}>Close</button>
      </div>
      <PrintableInvoice {...prepareInvoiceData()} />
    </div>
  </div>
)}
```

### Data Transformation
Lines 58-132: Complex `prepareInvoiceData()` function transforms order data:
- Order items → cart format
- Order fields → quoteData format
- Calculations → priceBreakdown format
- Customer data → contactData format

### File Dependencies
- Component: `src/components/customer-portal/InvoiceAcceptanceView.tsx` (590 lines, modal at 552-586)
- Renderer: `src/components/invoice/PrintableInvoice.tsx` (356 lines)
- Icons: Lucide React (Printer, X, FileText)

---

## Feature #3: Invoice Payment Page

### Location
- **Page:** `/invoice/:orderId`
- **File:** `src/pages/Invoice.tsx`

### Implementation Details
- **Trigger:** User clicks "View Invoice" button (line 345)
- **Window.print() call:** Line 444
- **Modal:** Inline modal in JSX (lines 437-470)
- **Print content renderer:** `PrintableInvoice` from `src/components/invoice/PrintableInvoice.tsx`

### Code Structure
```tsx
// State management (line 27)
const [showInvoiceModal, setShowInvoiceModal] = useState(false);

// Modal rendering (lines 437-470)
{showInvoiceModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 z-50">
    <div className="bg-white rounded-lg max-w-5xl">
      <div className="no-print">
        <button onClick={() => window.print()}>Print / Save PDF</button>
        <button onClick={() => setShowInvoiceModal(false)}>Close</button>
      </div>
      <PrintableInvoice
        quoteData={transformedQuoteData}
        priceBreakdown={transformedPriceBreakdown}
        cart={transformedCart}
        contactData={transformedContactData}
      />
    </div>
  </div>
)}
```

### Data Transformation
Lines 285-326: Transforms order database records:
- `transformedQuoteData` - Event details
- `transformedPriceBreakdown` - Pricing with fee names
- `transformedCart` - Order items
- `transformedContactData` - Customer info

### File Dependencies
- Page: `src/pages/Invoice.tsx` (493 lines, modal at 437-470)
- Renderer: `src/components/invoice/PrintableInvoice.tsx` (356 lines)
- Icons: Lucide React (Printer)

---

## Feature #4: Payment Receipt

### Location
- **Component:** Customer Dashboard
- **File:** `src/components/dashboard/ReceiptModal.tsx`

### Implementation Details
- **Trigger:** User clicks "View Receipt" after payment
- **Window.print() call:** Line 196
- **Modal:** Entire component is a modal (lines 18-212)
- **Print content:** Custom receipt layout (no shared PrintableInvoice)

### Code Structure
```tsx
export function ReceiptModal({ order, payment, summary, loading, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50">
      <div className="bg-white rounded-lg max-w-4xl">
        <div className="no-print">
          <button onClick={() => window.print()}>Print Receipt</button>
          <button onClick={onClose}>Close</button>
        </div>
        {/* Custom receipt layout - NOT using PrintableInvoice */}
        <div className="space-y-6">
          {/* Logo, payment info, customer info, event info, order summary */}
        </div>
      </div>
    </div>
  );
}
```

### Unique Characteristics
- **Does NOT use PrintableInvoice component**
- Has its own custom layout (150+ lines)
- Shows payment-specific information:
  - Amount paid
  - Payment method (card brand, last 4)
  - Payment date
  - Deposit paid vs balance paid
  - Remaining balance
- Includes OrderSummary component

### File Dependencies
- Component: `src/components/dashboard/ReceiptModal.tsx` (213 lines)
- OrderSummary: `src/components/order/OrderSummary.tsx`
- Icons: Lucide React (X)
- Utilities: `formatCurrency`, `calculateOrderTotal`, `formatTime`

---

## Feature #5: Signed Waiver Download

### Location
- **Component:** Waiver Tab
- **File:** `src/components/waiver/WaiverViewer.tsx`

### Implementation Details
- **Purpose:** Display liability waiver for customer to read and initial
- **Print capability:** No direct print button in this component
- **Rendering:** Scrollable viewer with initials input fields

### Code Structure
```tsx
export default function WaiverViewer({
  waiverText,
  onScrollToBottom,
  initialsRequired,
  onInitialsChange,
  initials,
}) {
  return (
    <div className="border-2 border-gray-300 rounded-lg p-6 h-96 overflow-y-auto">
      <h2>Liability Waiver and Rental Agreement</h2>
      {renderWaiverWithInitials()}
    </div>
  );
}
```

### Unique Characteristics
- **NOT a PDF viewer/generator** - just a scrollable viewer
- No print button
- No window.print() call
- Used for collecting electronic signatures
- Tracks scroll to ensure customer read the full waiver

### Note
This is **not currently a PDF feature**, but could be enhanced to:
- Generate signed waiver PDFs
- Allow download after signature
- Print signed waiver for records

### File Dependencies
- Component: `src/components/waiver/WaiverViewer.tsx` (168 lines)
- Icons: Lucide React (CheckCircle2)

---

## Feature #6: Catalog Print

### Location
- **Page:** `/catalog`
- **File:** `src/pages/Catalog.tsx`

### Implementation Details
- **Trigger:** User clicks "Export Menu" button (line 339)
- **Window.print() call:** Line 298 (in dynamically generated HTML)
- **Method:** Opens new window with generated HTML
- **Rendering:** Custom HTML string with embedded CSS

### Code Structure
```tsx
const handleExportMenu = () => {
  // Generate complete HTML document (lines 93-304)
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Bounce Party Club - Rental Catalog</title>
        <style>
          /* Inline CSS for print styling */
        </style>
      </head>
      <body>
        <!-- Logo, header, grid of units -->
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 500);
          };
        </script>
      </body>
    </html>
  `;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank');
};
```

### Unique Characteristics
- **Completely different approach** - generates full HTML document
- Opens in new window/tab
- Auto-triggers print after load (500ms delay)
- Uses blob URL
- Self-contained with embedded CSS
- Shows all units in 2-column grid
- Includes:
  - Business logo
  - Unit images
  - Type and combo badges
  - Dimensions, footprint, capacity
  - Pricing (dry/wet modes)
  - Footer with disclaimer

### Print Styling (lines 100-226)
- Custom @media print rules
- 2-column grid layout
- Gradient borders
- Professional styling
- Page-break-inside: avoid

### File Dependencies
- Page: `src/pages/Catalog.tsx` (515 lines, export function at 81-315)
- Icons: Lucide React (Download, Users, Maximize, Zap, Droplets)

---

## Shared Components

### PrintableInvoice Component

**File:** `src/components/invoice/PrintableInvoice.tsx` (356 lines)

**Used by:**
1. Quote Invoice Preview (Feature #1)
2. Customer Invoice Acceptance (Feature #2)
3. Invoice Payment Page (Feature #3)
4. ~~NOT used by Receipt (Feature #4)~~ ✗
5. ~~NOT used by Waiver (Feature #5)~~ ✗
6. ~~NOT used by Catalog (Feature #6)~~ ✗

**Props Interface:**
```typescript
interface PrintableInvoiceProps {
  quoteData: any;              // Event details
  priceBreakdown: any;         // Pricing breakdown
  cart: any[];                 // Cart items
  contactData: {               // Customer info
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    business_name?: string;
  };
  invoiceNumber?: string;      // Invoice/quote number
  isPaid?: boolean;            // Show "PAID" badge
  paymentMethod?: string;      // Payment method
  paymentBrand?: string;       // Card brand
  paymentLast4?: string;       // Last 4 digits
}
```

**Renders:**
- Business header with logo (lines 61-100)
- Bill To section (lines 103-121)
- Event Details section (lines 122-164)
- Line items table (lines 166-246)
- Deposit information (lines 249-266)
- Rental terms & policies (lines 268-345)
- Footer (lines 347-350)

**Styling:**
- Uses ID `#printable-invoice` for print targeting
- Gradient header (blue)
- Two-column layout for bill-to and event details
- Table with gradient rows
- Amber-highlighted deposit section
- Comprehensive terms in expandable sections

---

## Style Files with Print Rules

### Global Print Styles

**File:** `src/index.css` (lines 16-113)

**Print Media Query:** `@media print`

**Print Rules:**
```css
@page {
  margin: 0.5in;
  size: letter;
}

* {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

html, body {
  height: auto !important;
  overflow: visible !important;
  background: white !important;
}

/* Target specific print content */
body *:not(#printable-invoice):not(#printable-invoice *):not(.print-document):not(.print-document *) {
  visibility: hidden !important;
}

#printable-invoice,
.print-document {
  visibility: visible !important;
  width: 100% !important;
  max-width: 100% !important;
}

/* Utility classes */
.no-print,
.no-print * {
  display: none !important;
  visibility: hidden !important;
}

.no-print-padding {
  padding: 0 !important;
}

.print-only {
  display: block !important;
}

.page-break {
  page-break-after: always !important;
}

.avoid-break {
  page-break-inside: avoid !important;
}

.print-portrait {
  size: letter portrait;
}

.print-landscape {
  size: letter landscape;
}
```

**Key Features:**
- Exact color printing (no grayscale)
- Hides everything except `#printable-invoice` or `.print-document`
- `.no-print` class hides elements when printing
- `.print-only` shows elements only when printing
- Page break control classes
- Orientation support

### Catalog-Specific Print Styles

**File:** `src/pages/Catalog.tsx` (lines 100-226)

Embedded in generated HTML:
```css
@media print {
  body { padding: 20px; }
  .grid { gap: 20px; }
  .unit-card { page-break-inside: avoid; }
}
```

---

## Common Patterns Across Features

### Pattern 1: Modal with Print Button (Features #1, #2, #3)

```tsx
const [showModal, setShowModal] = useState(false);

<div className="fixed inset-0 bg-black bg-opacity-50 z-50">
  <div className="bg-white rounded-lg max-w-5xl">
    <div className="no-print">
      <button onClick={() => window.print()}>Print / Save PDF</button>
      <button onClick={onClose}>Close</button>
    </div>
    <PrintableInvoice {...data} />
  </div>
</div>
```

**Common characteristics:**
- Full-screen overlay with dark background
- White rounded modal
- Sticky header with print/close buttons
- Uses `.no-print` class to hide buttons
- Max width: 5xl (80rem)
- Scrollable content

### Pattern 2: Custom Receipt Layout (Feature #4)

```tsx
<div className="fixed inset-0 bg-black bg-opacity-50 z-50">
  <div className="bg-white rounded-lg max-w-4xl">
    {/* Logo */}
    {/* Payment info in green box */}
    {/* Customer info */}
    {/* Event info */}
    {/* OrderSummary component */}
    {/* Payment status breakdown */}
    {/* Footer */}
  </div>
</div>
```

**Unique to receipts:**
- Shows payment method details
- Shows amount paid with green highlighting
- Shows deposit/balance/remaining breakdown
- Uses OrderSummary component

### Pattern 3: New Window with Auto-Print (Feature #6)

```tsx
const htmlContent = `<!DOCTYPE html>...`;
const blob = new Blob([htmlContent], { type: 'text/html' });
const url = URL.createObjectURL(blob);
window.open(url, '_blank');
```

**Unique to catalog:**
- Generates complete HTML document
- Opens in new window
- Auto-triggers print
- Self-contained with all styles
- Cleans up blob URL after 1 second

---

## Data Flow Summary

### Features #1, #2, #3 (Invoice Previews)

```
Database Order
  ↓
Transform to props
  ↓
PrintableInvoice component
  ↓
window.print()
  ↓
Browser print dialog → PDF
```

### Feature #4 (Receipt)

```
Database Order + Payment
  ↓
Custom layout rendering
  ↓
window.print()
  ↓
Browser print dialog → PDF
```

### Feature #6 (Catalog)

```
Database Units
  ↓
Generate HTML string
  ↓
Blob → new window
  ↓
Auto window.print()
  ↓
Browser print dialog → PDF
```

---

## Code Duplication Analysis

### Duplicated Modal Code (Features #1, #2, #3)
- **Lines duplicated:** ~40 lines per feature × 3 = 120 lines
- **Modal wrapper structure**
- **Print button handler**
- **Close button handler**
- **Styling classes**

### Duplicated Data Transformation (Features #2, #3)
- **Lines duplicated:** ~70 lines per feature × 2 = 140 lines
- Order → quoteData
- Order → priceBreakdown
- Order items → cart
- Customer → contactData

### Custom Implementations
- **Receipt:** 213 lines (completely custom)
- **Catalog:** 212 lines of HTML generation (completely custom)
- **Waiver:** Not a PDF feature yet

### Total Duplicated/Custom Code
- Modal wrappers: ~120 lines
- Data transformations: ~140 lines
- Custom receipt: ~213 lines
- Custom catalog: ~212 lines
- **Total: ~685 lines** that could be centralized

---

## Migration Targets

### High Priority (Most Duplication)
1. **Invoice Preview modals** (Features #1, #2, #3)
   - Use: `PrintModal` + `PrintableInvoice` + `prepareInvoicePreview()`
   - Reduction: ~120 lines → ~20 lines per feature

2. **Receipt Modal** (Feature #4)
   - Use: `PrintModal` + `PrintableInvoice` + `preparePaymentReceipt()`
   - Reduction: ~213 lines → ~60 lines

### Medium Priority
3. **Catalog Export** (Feature #6)
   - Use: `PrintModal` + `prepareCatalogPrint()`
   - Requires: Custom catalog renderer
   - Reduction: ~212 lines → ~40 lines

### Low Priority / Future Enhancement
4. **Waiver Viewer** (Feature #5)
   - Currently not a PDF feature
   - Could add: `prepareWaiverPrint()` function
   - Add print/download button to WaiverTab

---

## File Reference Summary

### Core Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/invoice/PrintableInvoice.tsx` | 356 | Shared invoice renderer (used by 3 features) |
| `src/index.css` | 98 | Global print styles |

### Feature Files
| Feature | File | Lines | Print Lines |
|---------|------|-------|-------------|
| #1 Quote Preview | `src/components/checkout/InvoicePreviewModal.tsx` | 60 | 26-58 |
| #2 Invoice Accept | `src/components/customer-portal/InvoiceAcceptanceView.tsx` | 590 | 54-56, 552-586 |
| #3 Invoice Payment | `src/pages/Invoice.tsx` | 493 | 437-470 |
| #4 Receipt | `src/components/dashboard/ReceiptModal.tsx` | 213 | 18-212 |
| #5 Waiver | `src/components/waiver/WaiverViewer.tsx` | 168 | N/A |
| #6 Catalog | `src/pages/Catalog.tsx` | 515 | 81-315 |

### New Centralized System Files
| File | Lines | Purpose |
|------|-------|---------|
| `src/components/common/PrintModal.tsx` | 62 | Universal modal wrapper |
| `src/components/common/PrintDocument.tsx` | 61 | Print layout configuration |
| `src/components/common/PrintableInvoice.tsx` | 229 | Generic document renderer |
| `src/hooks/usePrint.ts` | 59 | Print state management |
| `src/lib/printUtils.ts` | 354 | Data transformation utilities |
| `src/lib/printIntegration.ts` | 66 | High-level preparation functions |

---

## Next Steps

1. **Migrate Invoice Previews** (Features #1, #2, #3)
   - Replace custom modals with `PrintModal`
   - Replace data prep with `prepareInvoicePreview()`
   - Test thoroughly

2. **Migrate Receipt** (Feature #4)
   - Use `preparePaymentReceipt()`
   - Keep custom footer with payment status
   - Test receipt generation

3. **Enhance Catalog** (Feature #6)
   - Create custom catalog renderer
   - Use `PrintModal` instead of new window
   - Simplify implementation

4. **Add Waiver PDF** (Feature #5)
   - Implement `prepareWaiverPrint()`
   - Add download/print button
   - Generate signed waiver PDFs

---

## Summary

- **6 distinct PDF features** currently in the application
- **3 use shared `PrintableInvoice`** component (Features #1, #2, #3)
- **3 use custom implementations** (Features #4, #5, #6)
- **~685 lines of duplicated/custom code** can be centralized
- **New centralized system** ready with 831 lines across 6 files
- **77% code reduction** possible after migration
