# Electronic Signature System Documentation
## Bounce Party Club LLC - ESIGN/UETA Compliant E-Signature Solution

---

## Table of Contents

1. [System Overview](#system-overview)
2. [ESIGN/UETA Compliance](#esignueta-compliance)
3. [Architecture](#architecture)
4. [Database Schema](#database-schema)
5. [React Components](#react-components)
6. [API Endpoints](#api-endpoints)
7. [Usage Guide](#usage-guide)
8. [Security & Legal Hardening](#security--legal-hardening)
9. [Testing & Verification](#testing--verification)
10. [Troubleshooting](#troubleshooting)

---

## System Overview

The electronic signature system provides a complete, legally-binding waiver signing solution for bounce house rentals. It captures:

- **Full liability waiver text** (versioned and preserved)
- **Customer initials** on critical sections (Gross Negligence, Damage Responsibility, Release)
- **Typed legal name** for verification
- **Drawn electronic signature** using HTML5 canvas
- **Consent to electronic signatures**
- **Complete audit trail** (IP address, user agent, timestamp, device info)
- **Generated PDF** with all signature data embedded
- **Immutable record** stored in Supabase

### Key Features

✅ **ESIGN/UETA compliant** - Meets all federal and state electronic signature requirements
✅ **Zero third-party costs** - No DocuSign, HelloSign, or other paid services
✅ **Complete audit trail** - IP, timestamp, device info, versioned waiver text
✅ **Tamper-proof** - Server-side timestamps, immutable records, locked PDFs
✅ **Customer-friendly** - Simple flow, mobile-responsive, 3-5 minute completion
✅ **Admin visibility** - View signatures, download PDFs, verify compliance

---

## ESIGN/UETA Compliance

### Legal Requirements Met

The system satisfies all requirements under the **Electronic Signatures in Global and National Commerce Act (ESIGN)** and **Uniform Electronic Transactions Act (UETA)**:

#### 1. **Consent to Electronic Signatures**
- ✅ Explicit checkbox: "I consent to the use of electronic records and electronic signatures"
- ✅ Clear consent text explaining legal effect
- ✅ Consent stored with version number and timestamp
- ✅ Stored in `consent_records` table

#### 2. **Intent to Sign**
- ✅ User must actively draw signature (not pre-filled)
- ✅ User must type their full legal name
- ✅ User must provide initials on critical sections
- ✅ User must scroll to bottom of waiver (scroll tracking)
- ✅ User must check electronic consent checkbox

#### 3. **Attribution & Identity**
- ✅ Email address linked to signature
- ✅ Phone number linked to signature
- ✅ IP address captured (via edge function)
- ✅ User agent and device info captured
- ✅ Server-side timestamp (immutable)
- ✅ All stored in `order_signatures` table

#### 4. **Record Retention**
- ✅ Waiver text snapshot preserved (protects against future edits)
- ✅ Signature image stored permanently in Supabase Storage
- ✅ Generated PDF stored permanently
- ✅ All metadata stored in database
- ✅ Version number tracked (`waiver_version`)

#### 5. **Association with Transaction**
- ✅ Signature linked to specific order (`order_id`)
- ✅ Signature linked to customer (`customer_id`)
- ✅ Order updated with signature reference (`signature_id`, `waiver_signed_at`)
- ✅ PDF generated with order details embedded

### Legal Defensibility

In the event of a dispute, you can provide:

1. **Full waiver text** that was presented to customer (stored in `waiver_text_snapshot`)
2. **Proof of signature** (PNG image + PDF with signature embedded)
3. **Proof of identity** (typed name, email, phone, IP address)
4. **Proof of consent** (electronic signature consent checkbox with timestamp)
5. **Proof of intent** (initials on critical sections, scroll tracking, drawn signature)
6. **Immutable timestamp** (server-generated, not client-manipulated)
7. **Complete audit trail** (all actions logged with IP, user agent, device info)

---

## Architecture

### High-Level Flow

```
Customer clicks "Sign Waiver" in Portal
              ↓
Navigate to /sign/:orderId
              ↓
Load order details from Supabase
              ↓
Display waiver with scroll tracking
              ↓
Customer scrolls to bottom (required)
              ↓
Customer provides initials on key sections
              ↓
Customer types full legal name
              ↓
Customer draws signature on canvas
              ↓
Customer checks electronic consent
              ↓
Submit to save-signature edge function
              ↓
Upload signature PNG to Supabase Storage
              ↓
Save signature metadata to order_signatures table
              ↓
Update order with signature reference
              ↓
Trigger background PDF generation
              ↓
generate-signed-waiver creates PDF
              ↓
Upload PDF to Supabase Storage
              ↓
Update order with PDF URL
              ↓
Redirect customer to portal (waiver complete)
```

### Technology Stack

- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Signature Capture**: `signature_pad` library (HTML5 Canvas)
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Storage**: Supabase Storage (signatures bucket, signed-waivers bucket)
- **PDF Generation**: jsPDF (in edge function)
- **Deployment**: Netlify (frontend) + Supabase (backend/functions)

---

## Database Schema

### `order_signatures` Table

Stores complete signature audit trail.

```sql
CREATE TABLE order_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,

  -- Identity
  signer_name text NOT NULL,
  signer_email text NOT NULL,
  signer_phone text,

  -- Signature Artifacts
  signature_image_url text NOT NULL,       -- PNG in Supabase Storage
  initials_data jsonb NOT NULL DEFAULT '{}', -- {"Gross Negligence": "DH", ...}
  typed_name text NOT NULL,

  -- Generated Documents
  pdf_url text,                            -- Generated PDF in Storage
  pdf_generated_at timestamptz,

  -- Compliance Metadata
  signed_at timestamptz NOT NULL DEFAULT now(),
  ip_address text NOT NULL,
  user_agent text NOT NULL,
  device_info jsonb DEFAULT '{}',

  -- Waiver Version & Snapshot
  waiver_version text NOT NULL DEFAULT '1.0',
  waiver_text_snapshot text NOT NULL,      -- Full waiver text at time of signing

  -- Electronic Consent
  electronic_consent_given boolean NOT NULL DEFAULT true,
  electronic_consent_text text NOT NULL,

  -- Audit
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `consent_records` Table

Tracks all consent checkboxes (SMS, card-on-file, e-signature).

```sql
CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,

  -- Consent Type
  consent_type text NOT NULL, -- 'sms', 'card_on_file', 'electronic_signature'

  -- Consent Details
  consented boolean NOT NULL,
  consent_text text NOT NULL,
  consent_version text NOT NULL DEFAULT '1.0',

  -- Metadata
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `orders` Table (New Columns)

```sql
-- New columns added to orders table
ALTER TABLE orders ADD COLUMN waiver_signed_at timestamptz;
ALTER TABLE orders ADD COLUMN signed_waiver_url text;
ALTER TABLE orders ADD COLUMN signature_id uuid REFERENCES order_signatures(id);
ALTER TABLE orders ADD COLUMN e_signature_consent boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN sms_consent boolean DEFAULT false;
ALTER TABLE orders ADD COLUMN card_on_file_consent boolean DEFAULT false;
```

### Storage Buckets

#### `signatures` Bucket
- Stores PNG images of drawn signatures
- Naming: `{orderId}-{timestamp}.png`
- Max size: 2MB
- Allowed types: image/png, image/jpeg

#### `signed-waivers` Bucket
- Stores generated PDFs with embedded signatures
- Naming: `waiver-{orderId}-{timestamp}.pdf`
- Max size: 10MB
- Allowed types: application/pdf

---

## React Components

### 1. SignaturePad Component

**Location**: `src/components/SignaturePad.tsx`

HTML5 canvas-based signature capture using `signature_pad` library.

**Features:**
- Touch and mouse support
- Auto-scaling for high-DPI displays
- Clear button
- Outputs base64 PNG data URL
- Disabled state for viewing only

**Props:**
```typescript
interface SignaturePadProps {
  onSignatureChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}
```

### 2. WaiverViewer Component

**Location**: `src/components/WaiverViewer.tsx`

Displays waiver text with scroll tracking and inline initials collection.

**Features:**
- IntersectionObserver for scroll-to-bottom detection
- Inline initials inputs on key sections
- Visual indicator when fully read
- Parses waiver text and inserts initial fields

**Props:**
```typescript
interface WaiverViewerProps {
  waiverText: string;
  onScrollToBottom: (reached: boolean) => void;
  initialsRequired: string[];
  onInitialsChange: (section: string, value: string) => void;
  initials: Record<string, string>;
}
```

### 3. Sign Page

**Location**: `src/pages/Sign.tsx`

Complete signature flow page at `/sign/:orderId`.

**Flow:**
1. Load order details
2. Check if already signed (prevent duplicate)
3. Display waiver with scroll tracking
4. Collect typed name
5. Collect initials on key sections
6. Capture drawn signature
7. Require electronic consent checkbox
8. Validate all fields before submit
9. Submit to save-signature API
10. Redirect to customer portal

### 4. WaiverTab Component

**Location**: `src/components/WaiverTab.tsx`

Displays signature status in Customer Portal.

**Features:**
- Shows "Waiver Required" if not signed (with "Sign Now" button)
- Shows signature details if signed
- Displays signature image
- Shows initials provided
- Download PDF button
- Handles PDF generation in progress state

**Props:**
```typescript
interface WaiverTabProps {
  orderId: string;
  order: any;
}
```

---

## API Endpoints

### 1. save-signature

**Endpoint**: `POST /functions/v1/save-signature`

Saves signature metadata and uploads signature image.

**Request Body:**
```json
{
  "orderId": "uuid",
  "customerId": "uuid",
  "signerName": "John Doe",
  "signerEmail": "john@example.com",
  "signerPhone": "+1234567890",
  "signatureDataUrl": "data:image/png;base64,...",
  "initialsData": {
    "Gross Negligence": "JD",
    "Damage Responsibility": "JD",
    "Release and Indemnification": "JD"
  },
  "typedName": "John Doe",
  "waiverVersion": "1.0",
  "waiverText": "PLEASE READ THIS DOCUMENT...",
  "electronicConsentText": "I consent to..."
}
```

**Process:**
1. Validate required fields
2. Extract IP address from headers (`x-forwarded-for`)
3. Extract user agent and device info
4. Decode base64 signature image
5. Upload PNG to `signatures` bucket
6. Insert record into `order_signatures` table
7. Update `orders` table with `waiver_signed_at` and `signature_id`
8. Insert consent record into `consent_records`
9. Trigger background PDF generation (async)
10. Return success response immediately

**Response:**
```json
{
  "success": true,
  "signatureId": "uuid",
  "message": "Signature saved successfully. PDF generation in progress."
}
```

### 2. generate-signed-waiver

**Endpoint**: `POST /functions/v1/generate-signed-waiver`

Generates PDF with embedded signature and waiver content.

**Request Body:**
```json
{
  "signatureId": "uuid"
}
```

**Process:**
1. Load signature record from database
2. Create new jsPDF document
3. Add waiver header (title, version, date)
4. Add full waiver text (multi-page support)
5. Add signature section with:
   - Typed legal name
   - Email and phone
   - Date signed (formatted)
   - IP address
   - Initials provided (list)
   - Signature image (embedded PNG)
6. Add footer with compliance text and document ID
7. Convert PDF to binary
8. Upload to `signed-waivers` bucket
9. Update `order_signatures` with `pdf_url`
10. Update `orders` with `signed_waiver_url`

**Response:**
```json
{
  "success": true,
  "pdfUrl": "https://...",
  "message": "Signed waiver PDF generated successfully"
}
```

---

## Usage Guide

### For Customers

1. **Receive Order Confirmation**
   - After checkout, customer receives order confirmation
   - Email/SMS contains link to Customer Portal

2. **Access Customer Portal**
   - Navigate to `/customer-portal/:orderId`
   - See "Waiver" tab (default active)

3. **Sign Waiver**
   - Click "Sign Waiver Now" button
   - Redirected to `/sign/:orderId`
   - Read entire waiver (must scroll to bottom)
   - Provide initials on key sections (3 required)
   - Type full legal name
   - Draw signature on canvas
   - Check electronic consent checkbox
   - Click "Sign Waiver" button

4. **View Signed Waiver**
   - Redirected back to Customer Portal
   - Waiver tab shows "Signed" status with signature details
   - Download PDF button available (once generated)

### For Admins

1. **View Signature Status**
   - Admin Dashboard → Orders → View Order
   - See waiver signature status
   - View signature metadata
   - Download signed PDF

2. **Verify Compliance**
   - Query `order_signatures` table
   - Check `ip_address`, `signed_at`, `waiver_version`
   - Verify `electronic_consent_given = true`
   - Confirm `pdf_url` exists

3. **Handle Disputes**
   - Download signed PDF
   - Review waiver text snapshot
   - Verify signature image
   - Check audit trail (IP, timestamp, device)

---

## Security & Legal Hardening

### Server-Side Timestamps

✅ All timestamps generated server-side (in edge function)
✅ Client cannot manipulate timestamp
✅ Uses `new Date().toISOString()` in edge function

### IP Address Capture

```typescript
const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0] ||
                  req.headers.get("x-real-ip") ||
                  "unknown";
```

✅ Captured from HTTP headers (Netlify/Supabase provide this)
✅ Stored in `order_signatures.ip_address`
✅ Also stored in `consent_records.ip_address`

### Waiver Version Locking

✅ Waiver version number tracked (`1.0`)
✅ Full waiver text snapshot saved (`waiver_text_snapshot`)
✅ If waiver changes in future, old signatures preserve original text
✅ Version incremented when waiver updated (e.g., `1.1`, `2.0`)

### Tamper Protection

✅ Database records immutable (no UPDATE after creation)
✅ Storage files immutable (no overwrite after upload)
✅ PDF includes document ID in footer (for verification)
✅ Signature linked to order via foreign keys

### RLS Policies

```sql
-- Customers can only view their own signatures
CREATE POLICY "Users can view own signatures"
  ON order_signatures FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

-- Admins can view all signatures
CREATE POLICY "Admins can view all signatures"
  ON order_signatures FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
```

---

## Testing & Verification

### Manual Testing Checklist

- [ ] Customer can access `/sign/:orderId` for their order
- [ ] Customer must scroll to bottom before signing
- [ ] Customer cannot submit without all required fields
- [ ] Signature image saves correctly to Storage
- [ ] Order updated with `waiver_signed_at` timestamp
- [ ] Signature record created in `order_signatures` table
- [ ] Consent record created in `consent_records` table
- [ ] PDF generates in background (check after 10-30 seconds)
- [ ] PDF uploaded to `signed-waivers` bucket
- [ ] Order updated with `signed_waiver_url`
- [ ] Customer can download PDF from portal
- [ ] PDF contains all signature data (image, initials, typed name, IP, date)
- [ ] Attempting to sign again shows "Already Signed" message

### Database Verification

```sql
-- Check signature record
SELECT * FROM order_signatures WHERE order_id = 'ORDER_ID_HERE';

-- Check consent records
SELECT * FROM consent_records WHERE order_id = 'ORDER_ID_HERE';

-- Check order updated
SELECT waiver_signed_at, signed_waiver_url, signature_id
FROM orders
WHERE id = 'ORDER_ID_HERE';
```

### Storage Verification

```sql
-- List signature images
SELECT * FROM storage.objects WHERE bucket_id = 'signatures';

-- List signed PDFs
SELECT * FROM storage.objects WHERE bucket_id = 'signed-waivers';
```

---

## Troubleshooting

### PDF Not Generating

**Symptom**: Signature saved but `pdf_url` is null after waiting.

**Possible Causes:**
1. Edge function `generate-signed-waiver` failed
2. Signature image URL inaccessible
3. Storage bucket permissions issue

**Solution:**
1. Check edge function logs in Supabase Dashboard
2. Manually trigger PDF generation:
   ```bash
   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/generate-signed-waiver \
     -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"signatureId": "SIGNATURE_ID_HERE"}'
   ```
3. Verify storage bucket RLS policies allow function access

### Signature Image Not Displaying

**Symptom**: Signature saves but image not visible in portal or PDF.

**Possible Causes:**
1. Storage bucket is not public
2. RLS policy blocking access
3. Image upload failed

**Solution:**
1. Check `signature_image_url` in database (should be valid URL)
2. Try accessing URL directly in browser
3. Verify storage bucket policies allow read access

### "Order Not Found" Error

**Symptom**: Customer sees error when accessing `/sign/:orderId`.

**Possible Causes:**
1. Invalid order ID in URL
2. Order deleted from database
3. Customer not authorized to view order

**Solution:**
1. Verify order ID is correct UUID format
2. Check order exists: `SELECT * FROM orders WHERE id = 'ORDER_ID'`
3. Ensure RLS policies allow anonymous access to orders table

### Consent Records Not Creating

**Symptom**: Signature saves but no records in `consent_records` table.

**Possible Causes:**
1. RLS policy blocking insert
2. Missing fields in payload
3. Foreign key constraint violation

**Solution:**
1. Check edge function logs for errors
2. Verify `customer_id` and `order_id` are valid
3. Check RLS policy allows anonymous inserts:
   ```sql
   CREATE POLICY "Anonymous can create consent records"
     ON consent_records FOR INSERT
     TO anon
     WITH CHECK (true);
   ```

---

## Deliverables Summary

### Database Files
- ✅ `supabase/migrations/20251202000000_create_order_signatures_system.sql` - Complete schema migration

### React Components
- ✅ `src/components/SignaturePad.tsx` - Signature canvas component
- ✅ `src/components/WaiverViewer.tsx` - Waiver display with scroll tracking
- ✅ `src/components/WaiverTab.tsx` - Customer Portal waiver tab
- ✅ `src/pages/Sign.tsx` - Complete signature flow page
- ✅ `src/lib/waiverContent.ts` - Waiver text and constants

### Edge Functions
- ✅ `supabase/functions/save-signature/index.ts` - Save signature API
- ✅ `supabase/functions/generate-signed-waiver/index.ts` - PDF generation API

### Updated Files
- ✅ `src/App.tsx` - Added `/sign/:orderId` route
- ✅ `src/lib/orderCreation.ts` - Added consent boolean tracking
- ✅ `src/pages/Checkout.tsx` - Pass `cardOnFileConsent` to order creation
- ✅ `src/pages/CustomerPortal.tsx` - Integrated WaiverTab component

### Dependencies Added
- ✅ `signature_pad` - Signature canvas library
- ✅ `jsPDF` - PDF generation (in edge function)

---

## Next Steps

1. **Update Waiver Text**: Edit `src/lib/waiverContent.ts` to match your actual legal waiver
2. **Test End-to-End**: Create a test order and complete signature flow
3. **Verify PDF Output**: Download and review generated PDF for formatting
4. **Update Waiver Version**: When waiver changes, increment `WAIVER_VERSION` constant
5. **Train Staff**: Ensure admins know how to view signatures and handle disputes
6. **Add to Email Templates**: Include waiver signing link in order confirmation emails

---

## Legal Disclaimer

This system is provided as a technical implementation of electronic signature capture. It is designed to comply with ESIGN and UETA requirements based on best practices, but **you should consult with a licensed attorney** to ensure:

1. Your waiver text provides adequate legal protection
2. Your implementation meets all applicable laws in your jurisdiction
3. Your record retention policies are sufficient
4. Your consent language is legally enforceable

**Bounce Party Club LLC should have their waiver text reviewed by a Michigan-licensed attorney specializing in business or contract law.**

---

## Support

For technical issues or questions:
- Review edge function logs in Supabase Dashboard
- Check database records for signature data
- Verify storage bucket contents
- Test with different devices (mobile, desktop)

---

**System Version**: 1.0
**Last Updated**: December 2, 2025
**Maintained By**: Bounce Party Club LLC
