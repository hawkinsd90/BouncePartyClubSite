# Contacts & Invoices Feature Guide

## Overview
This document explains the new Contacts (phonebook) and Invoices features added to the Bounce Party Club admin system.

## Contacts / Phonebook System

### What It Does
- Automatically adds every customer who makes a booking to a contacts list
- Stores customer information for marketing campaigns
- Tracks customer lifetime value and booking history
- Manages email and SMS opt-in permissions

### Database Table: `contacts`
```
- id (uuid, primary key)
- customer_id (links to customers table)
- first_name
- last_name
- email (unique)
- phone
- opt_in_email (default: true)
- opt_in_sms (default: true)
- source ('booking', 'manual', 'import')
- tags (array for segmentation)
- last_contact_date
- total_bookings (auto-updated)
- total_spent_cents (auto-updated)
- created_at
- updated_at
```

### Features
1. **Automatic Addition**: Every booking automatically adds customer to contacts
2. **Duplicate Prevention**: Uses email as unique key (upsert on conflict)
3. **Customer Statistics**: Automatically tracks:
   - Number of bookings per customer
   - Total amount spent (lifetime value)
4. **Segmentation**: Filter by:
   - All contacts
   - Email subscribers only
   - SMS subscribers only

### Admin Dashboard View
- Access via "Contacts" tab in Admin dashboard
- View all contacts with:
  - Contact information (name, email, phone)
  - Booking statistics
  - Lifetime spending
  - Opt-in status
  - Date added
- Filter contacts by marketing channel

### Use Cases
- Build email marketing lists
- Send mass SMS campaigns
- Identify high-value customers
- Track customer engagement
- Export contacts for CRM systems

---

## Invoices System

### What It Does
- Automatically generates invoices when orders are approved
- Tracks payment status and balances
- Provides manual invoice generation for special cases
- Maintains invoice history for tax purposes

### Database Table: `invoices`
```
- id (uuid, primary key)
- invoice_number (unique, format: INV-YYYY-0001)
- order_id (links to orders table)
- customer_id (links to customers table)
- invoice_date
- due_date
- status ('draft', 'sent', 'paid', 'cancelled')
- subtotal_cents
- tax_cents
- travel_fee_cents
- surface_fee_cents
- same_day_pickup_fee_cents
- total_cents
- paid_amount_cents
- payment_method ('cash', 'card', 'check', etc.)
- notes
- pdf_url (for future PDF storage)
- created_at
- updated_at
```

### Invoice Number Format
- Format: `INV-YYYY-0001`
- Example: `INV-2025-0042`
- Auto-increments per year
- Generated via PostgreSQL function `generate_invoice_number()`

### Automatic Invoice Generation
When an admin approves a booking:
1. System generates a unique invoice number
2. Creates invoice record with order details
3. Sets status to 'sent'
4. Records deposit amount as paid
5. Calculates remaining balance

### Manual Invoice Generation
Admins can manually generate invoices:
1. Go to "Invoices" tab
2. Click "+ Generate Invoice"
3. Enter Order ID
4. System creates invoice with 'draft' status

### Features
1. **Invoice Tracking**: View all invoices with status
2. **Payment Status**: See paid vs. unpaid amounts
3. **Balance Calculations**: Automatic balance due calculations
4. **Filtering**: Filter by:
   - All invoices
   - Draft
   - Unpaid
   - Paid
5. **Quick View**: Click "View" to see invoice details in popup

### Admin Dashboard View
- Access via "Invoices" tab in Admin dashboard
- View all invoices with:
  - Invoice number
  - Customer information
  - Invoice date
  - Total amount
  - Paid amount
  - Balance due
  - Status badge
  - View/Download actions

### Invoice Status Workflow
1. **draft**: Manually created, not sent to customer
2. **sent**: Automatically created on order approval
3. **paid**: Full payment received
4. **cancelled**: Order was cancelled

### Use Cases
- Track outstanding payments
- Generate financial reports
- Tax record keeping
- Customer payment history
- Dispute resolution

---

## Integration with Existing Systems

### Checkout Flow
1. Customer completes booking
2. System creates customer record
3. **NEW**: Automatically adds to contacts table
4. Creates order (status: pending_review)
5. Admin receives SMS notification

### Admin Approval Flow
1. Admin reviews pending booking
2. Admin clicks "Approve"
3. Order status changes to 'confirmed'
4. Payment status changes to 'succeeded'
5. **NEW**: Invoice is automatically generated
6. **NEW**: Contact stats are updated (booking count, total spent)

### Contact Statistics Auto-Update
A database trigger automatically updates contact statistics when orders are approved:
- Increments `total_bookings`
- Adds order total to `total_spent_cents`
- Updates `updated_at` timestamp

---

## Database Functions

### generate_invoice_number()
Returns next sequential invoice number for current year.

**Example:**
```sql
SELECT generate_invoice_number();
-- Returns: 'INV-2025-0001'
```

### update_contact_stats()
Trigger function that runs when orders are approved.
Automatically updates contact statistics.

---

## Future Enhancements

### Planned Features
1. **PDF Invoice Generation**: Generate downloadable PDF invoices
2. **Email Integration**: Send invoices via email
3. **Payment Tracking**: Record individual payments against invoices
4. **Bulk SMS**: Send mass text messages to filtered contacts
5. **Bulk Email**: Send marketing emails to filtered contacts
6. **Export**: Export contacts to CSV for external use
7. **Invoice Templates**: Customizable invoice designs
8. **Payment Links**: Include payment links in invoices
9. **Recurring Invoices**: For repeat customers
10. **Invoice Reminders**: Automatic payment reminders

---

## Testing Guide

### Test Contacts Feature
1. Complete a test booking as a customer
2. Go to Admin → Contacts tab
3. Verify customer appears in contacts list
4. Check that opt-in flags are set to true
5. Approve the booking
6. Refresh Contacts tab
7. Verify `total_bookings` increased to 1
8. Verify `total_spent_cents` shows order total

### Test Invoices Feature
1. Complete a test booking
2. Go to Admin → Pending Review
3. Approve the booking
4. Go to Admin → Invoices tab
5. Verify invoice was created automatically
6. Check invoice number format (INV-2025-XXXX)
7. Verify status is 'sent'
8. Verify paid amount shows deposit
9. Click "View" to see invoice details
10. Test manual invoice generation:
    - Click "+ Generate Invoice"
    - Enter the same order ID
    - Should see error or create duplicate draft

---

## Security

### Row Level Security (RLS)
Both tables have RLS enabled with policies:
- Admin users can read/write all records
- Service role (for automation) can manage records
- Regular users have no access

### Data Privacy
- Contacts are only accessible to admin users
- Email and phone numbers are protected
- No public API access to contact information
