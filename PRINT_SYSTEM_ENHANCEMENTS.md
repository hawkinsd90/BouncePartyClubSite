# Print System Enhancements

This document describes the recent enhancements made to the centralized print system.

## New Features

### 1. Print Event Callbacks

The print system now supports comprehensive event callbacks for tracking and handling print operations:

```typescript
interface PrintEventCallbacks {
  onBeforePrint?: () => void | Promise<void>;  // Async support!
  onAfterPrint?: () => void | Promise<void>;   // Async support!
  onPrintStart?: () => void;
  onPrintSuccess?: () => void;
  onPrintError?: (error: Error) => void;
  onPrintCancel?: () => void;
}
```

**Example Usage:**

```typescript
import { usePrint } from '../hooks/usePrint';

const { isPrintModalOpen, openPrintModal, closePrintModal, printState } = usePrint({
  onBeforePrint: async () => {
    // Prepare data, fetch resources, etc.
    console.log('Preparing document...');
    await fetchAdditionalData();
  },
  onAfterPrint: () => {
    console.log('Print completed');
  },
  onPrintError: (error) => {
    console.error('Print failed:', error);
    showToast(`Print failed: ${error.message}`, 'error');
  },
  onPrintSuccess: () => {
    showToast('Document printed successfully', 'success');
  },
});
```

### 2. Print State Management

The system now tracks print operation states:

```typescript
type PrintState = 'idle' | 'preparing' | 'printing' | 'success' | 'error' | 'cancelled';

interface PrintStateInfo {
  state: PrintState;
  message?: string;
  timestamp: number;
}
```

**Example:**

```typescript
const { printState, isPrinting } = usePrint();

// printState.state will be:
// - 'idle' when not printing
// - 'preparing' when onBeforePrint is running
// - 'printing' when print dialog is open
// - 'success' after successful print
// - 'error' if an error occurred
// - 'cancelled' if user cancelled
```

### 3. Print Templates System

Pre-configured templates for different document types with optimal settings:

```typescript
const PRINT_TEMPLATES: Record<PrintDocumentType, PrintTemplate> = {
  invoice: {
    orientation: 'portrait',
    size: 'letter',
    margins: '0.5in',
    showHeader: true,
    showFooter: true,
    quality: 'high',
  },
  receipt: {
    orientation: 'portrait',
    size: 'letter',
    margins: '0.25in',
    showHeader: true,
    showFooter: true,
    quality: 'normal',
  },
  waiver: {
    orientation: 'portrait',
    size: 'legal',
    margins: '0.75in',
    showHeader: true,
    showFooter: true,
    quality: 'high',
  },
  report: {
    orientation: 'landscape',
    size: 'letter',
    margins: '1in',
    showHeader: true,
    showFooter: true,
    quality: 'high',
  },
  // ... more templates
};
```

**Usage:**

```typescript
<PrintModal
  isOpen={true}
  onClose={onClose}
  documentType="invoice"  // Automatically applies invoice template settings
>
  {children}
</PrintModal>

// Or with PrintDocument:
<PrintDocument documentType="receipt">
  {content}
</PrintDocument>
```

### 4. Better Print Preview Styling

#### Zoom Controls

Users can now zoom in/out of print previews:

- **Zoom In**: Ctrl/Cmd + Plus (+)
- **Zoom Out**: Ctrl/Cmd + Minus (-)
- **Reset Zoom**: Ctrl/Cmd + 0
- **UI Controls**: Click the zoom buttons in the toolbar

Zoom levels: 50%, 75%, 100%, 125%, 150%

```typescript
<PrintModal
  isOpen={true}
  onClose={onClose}
  showZoomControls={true}  // Enable zoom controls (default: true)
>
  {children}
</PrintModal>
```

#### State Indicators

Visual feedback for print operations with loading spinners and status messages:

```typescript
<PrintModal
  printState={printState.state}
  printStateMessage={printState.message}
>
  {children}
</PrintModal>
```

### 5. Enhanced Type Safety

Improved TypeScript types for better code safety:

```typescript
// Generic PrintableDocument with typed metadata
interface PrintableDocument<T = unknown> {
  type: PrintDocumentType;
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
  metadata?: T;  // Type-safe metadata!
}

// Usage with custom metadata type
interface InvoiceMetadata {
  orderId: string;
  eventDate: string;
  depositDue: number;
}

const invoice: PrintableDocument<InvoiceMetadata> = {
  type: 'invoice',
  // ... other fields
  metadata: {
    orderId: '12345',
    eventDate: '2024-01-15',
    depositDue: 50000,
  },
};
```

### 6. Accessibility Improvements

#### Keyboard Shortcuts

- **Ctrl/Cmd + P**: Print document
- **Escape**: Close print preview
- **Ctrl/Cmd + Plus**: Zoom in
- **Ctrl/Cmd + Minus**: Zoom out
- **Ctrl/Cmd + 0**: Reset zoom

#### Screen Reader Support

- ARIA labels on all interactive elements
- Live region announcements for state changes
- Proper dialog roles and modal semantics
- Focus management (auto-focus on print button)
- Screen reader instructions

```typescript
// Automatic screen reader announcements:
// "Invoice Preview opened. Press Control P or Command P to print, or Escape to close."
// "Preparing document..."
// "Printing..."
// "Print successful"
```

#### Focus Management

- Modal opens: Focus moves to Print button
- Modal closes: Focus returns to trigger element
- Tab navigation within modal is trapped

## Complete Usage Example

Here's a complete example showing all features:

```typescript
import { useState } from 'react';
import { PrintModal } from '../components/common/PrintModal';
import { usePrint } from '../hooks/usePrint';
import { showToast } from '../lib/notifications';

export function MyInvoiceComponent() {
  const [showPrintModal, setShowPrintModal] = useState(false);

  const { printState } = usePrint({
    onBeforePrint: async () => {
      console.log('Preparing invoice...');
      // Fetch fresh data, validate, etc.
    },
    onAfterPrint: () => {
      console.log('Print dialog closed');
    },
    onPrintSuccess: () => {
      showToast('Invoice printed successfully', 'success');
    },
    onPrintError: (error) => {
      console.error('Print error:', error);
      showToast(`Print failed: ${error.message}`, 'error');
    },
  });

  return (
    <>
      <button onClick={() => setShowPrintModal(true)}>
        Preview Invoice
      </button>

      <PrintModal
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        title="Invoice Preview"
        documentType="invoice"
        showZoomControls={true}
        printState={printState.state}
        printStateMessage={printState.message}
        maxWidth="5xl"
        onBeforePrint={async () => {
          // Additional pre-print logic
        }}
        onPrintError={(error) => {
          showToast(`Print failed: ${error.message}`, 'error');
        }}
      >
        <InvoiceContent />
      </PrintModal>
    </>
  );
}
```

## Migration Guide

### Before (Old System)

```typescript
<PrintModal
  isOpen={true}
  onClose={onClose}
  title="Invoice"
>
  {children}
</PrintModal>
```

### After (Enhanced System)

```typescript
<PrintModal
  isOpen={true}
  onClose={onClose}
  title="Invoice"
  documentType="invoice"        // NEW: Use template
  showZoomControls={true}        // NEW: Zoom controls
  printState={printState.state}  // NEW: Show state
  onBeforePrint={handleBefore}   // ENHANCED: Async support
  onAfterPrint={handleAfter}     // ENHANCED: Async support
  onPrintError={handleError}     // NEW: Error handling
>
  {children}
</PrintModal>
```

## Best Practices

1. **Use Templates**: Always specify `documentType` for consistent styling
2. **Handle Errors**: Provide `onPrintError` callback to handle print failures gracefully
3. **Async Operations**: Use async `onBeforePrint` for data fetching or validation
4. **User Feedback**: Show loading states and success/error messages
5. **Accessibility**: The keyboard shortcuts work automatically - no additional setup needed
6. **State Management**: Use the `printState` to show appropriate UI feedback

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Print dialog behavior varies by browser

## Performance Notes

- Zoom is CSS-based (transform: scale) - no re-rendering
- Print templates are static - no runtime overhead
- State management is minimal and optimized
- Focus management uses native browser APIs

## Future Enhancements (Not Yet Implemented)

These were considered but not implemented in this phase:

- Batch printing (multiple documents in sequence)
- Print history/analytics tracking
- Custom paper sizes beyond letter/a4/legal
- Print quality selection UI
- Page preview with page numbers
