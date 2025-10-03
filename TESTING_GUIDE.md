# Complete Booking & Two-Way SMS Communication Testing Guide

## Overview
This guide will walk you through testing the complete booking flow including SMS notifications, two-way SMS conversations, Street View integration, and customer reply handling.

## Prerequisites

### 1. Twilio Setup (for SMS notifications and two-way messaging)
To enable actual SMS sending and receiving, you need to configure Twilio:

1. **Create a Twilio account** at https://www.twilio.com/try-twilio
2. **Get your credentials** from the Twilio Console:
   - Account SID
   - Auth Token
   - Twilio Phone Number (get one from Console)
3. **Configure Supabase Environment Variables**:
   - Go to your Supabase Dashboard
   - Navigate to Project Settings > Edge Functions
   - Add these secrets:
     - `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
     - `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token
     - `TWILIO_PHONE_NUMBER`: Your Twilio phone number (format: +1234567890)

4. **Configure Twilio Webhook** (for receiving customer replies):
   - In Twilio Console, go to Phone Numbers > Manage > Active numbers
   - Click on your phone number
   - Scroll to "Messaging Configuration"
   - Under "A MESSAGE COMES IN", select "Webhook"
   - Set the URL to: `https://0ec90b57d6e95fcbda19832f.supabase.co/functions/v1/twilio-webhook`
   - Set HTTP method to: "HTTP POST"
   - Click "Save"

**Note**: If Twilio is not configured, the SMS function will run in "mock mode" and log what would have been sent without actually sending SMS.

### 2. Google Maps API Key
Your `.env` file should already have `VITE_GOOGLE_MAPS_API_KEY` set for Street View to work.

## Testing Steps

### Step 1: Create a Test Booking (as Customer)

1. **Navigate to "Get Quote"** page
2. **Choose event type**:
   - Select "Residential" or "Commercial"
3. **Fill out the booking form**:
   - **Address**: Enter a real address with autocomplete
     - Example: "123 Main St, Detroit, MI"
   - **Event Date**: Choose a future date (e.g., tomorrow)
   - **Start Time**: 09:00 AM
   - **End Time**: 05:00 PM
   - **Pickup preference**:
     - Residential: Choose "Same Day" or "Next Morning"
     - Commercial: Automatically set to "Same Day"
   - **Check the responsibility agreement checkbox**
4. **Add inflatables to cart**:
   - Click "Add to Cart" on 2-3 different units
5. **Click "Continue to Checkout"**
6. **Fill out checkout information**:
   - **First Name**: John
   - **Last Name**: Doe
   - **Email**: your-test-email@example.com
   - **Phone**: (313) 555-0123
   - **Payment Amount**: Choose "Deposit" (default)
   - **Check "Card on File Authorization" checkbox**
7. **Click "Place Order"**
8. **Confirmation screen appears**:
   - Note the Order ID displayed
   - You should see a success message

### Step 2: Check SMS Notification

**If Twilio is configured:**
- Within seconds, the phone number (313) 889-3860 should receive an SMS like:
  ```
  🎈 NEW BOOKING! John Doe for 2025-10-03. Review at: https://yourdomain.com/admin Order #a1b2c3d4
  ```

**If Twilio is NOT configured:**
- Check the browser console (F12 → Console tab)
- You'll see: "Twilio credentials not configured. SMS sending disabled."
- The order is still created successfully

### Step 3: Sign In as Admin

1. **Click "Login"** in the top-right header
2. **Click "Create Demo Accounts"** button (if not already created)
3. **Sign in with admin credentials**:
   - Email: `admin@bouncepartyclub.com`
   - Password: `admin123`
4. **You're redirected to the Admin dashboard**

### Step 4: Review Booking with Street View

1. **The "Pending Review" tab** should be active by default
2. **You'll see the pending booking card** showing:
   - Customer name, email, phone
   - Order ID and timestamp
   - Event date and location address
   - **Street View image** of the event location (if API key is configured)
     - Shows a street-level view of the address
     - Includes a note about image currency
   - List of ordered inflatables
   - Total amount and pricing breakdown
   - **SMS Conversation section** (if any messages exist)
   - Two action buttons: "Approve" and "Reject"

**Street View Assessment:**
- The Street View image helps you quickly assess:
  - Property type (residential, commercial, park, etc.)
  - Available space for inflatables
  - Accessibility for delivery vehicles
  - Ground surface (grass vs concrete)

**Note**: Street View images may be outdated, so always verify during delivery

### Step 5: Approve the Booking

1. **Click "Approve & Process Payment"** button
2. **Confirm the action** in the popup dialog
3. **System actions performed**:
   - Order status changes from `pending_review` → `confirmed`
   - Payment status changes from `pending` → `succeeded`
   - Deposit amount is marked as paid
   - Customer receives confirmation (message record created)
4. **Success alert appears**: "Booking approved! Customer will receive confirmation."
5. **The booking disappears** from the Pending Review tab

### Step 6: Verify Database Changes

You can verify the changes in the database:

```sql
-- View the order
SELECT id, status, deposit_paid_cents, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 1;

-- View the payment
SELECT order_id, status, amount_cents
FROM payments
WHERE order_id = 'YOUR_ORDER_ID';

-- View messages created
SELECT to_email, template_key, status
FROM messages
WHERE order_id = 'YOUR_ORDER_ID';
```

### Step 7: Test Two-Way SMS Communication

**Sending SMS from Admin Dashboard:**

1. **While viewing a pending booking**, scroll to the SMS Conversation section
2. **Click "Reply via SMS"** button
3. **Type a message**: "Hi John, your booking is confirmed! We'll arrive at 9:00 AM. Reply if this time doesn't work."
4. **Click "Send SMS"**
5. **If Twilio is configured**:
   - Customer receives the SMS on their phone
   - Message appears in the conversation thread (blue bubble on right)
   - Customer can reply to the SMS

**Receiving Customer Replies:**

1. **Customer texts back** to your Twilio number
   - Example: "Can you come at 10 AM instead?"
2. **Twilio webhook automatically**:
   - Receives the message
   - Stores it in the `sms_conversations` table
   - Links it to the correct order (by matching customer phone)
   - Sends auto-reply: "Thank you for your message! We've received it and will respond shortly."
3. **Refresh the Admin page**
   - Customer's reply appears in conversation (gray bubble on left)
   - Shows timestamp
4. **Admin can reply again**:
   - Click "Reply via SMS"
   - Type: "Yes, 10 AM works! See you then."
   - Customer receives the reply

**SMS Conversation Features:**
- Messages are threaded by order
- Inbound messages (from customer) appear on the left in gray
- Outbound messages (from admin) appear on the right in blue
- All messages show timestamps
- Conversation history is preserved

### Step 8: Test Rejection Flow (Optional)

1. **Create another test booking** (Steps 1-3)
2. **Sign in as admin** and navigate to Pending Review
3. **Click "Reject Booking"** button
4. **Enter rejection reason**: "Units not available for that date"
5. **Confirm rejection**
6. **System actions performed**:
   - Order status changes to `cancelled`
   - Payment status changes to `cancelled`
   - Customer receives rejection notice (message record created with reason)
7. **Success alert appears** with your rejection message

## What to Verify

### ✅ Complete Flow Checklist:

- [ ] Customer can submit booking successfully
- [ ] SMS notification sent to admin phone (or mock logged)
- [ ] Admin can see pending booking in dashboard
- [ ] Street View image loads for the address
- [ ] All booking details are accurate
- [ ] Admin can send SMS to customer
- [ ] Customer receives SMS on their phone
- [ ] Customer can reply via SMS
- [ ] Customer reply appears in admin dashboard
- [ ] Admin can reply to customer's message
- [ ] SMS conversation thread is maintained
- [ ] Approve button works and updates status
- [ ] Reject button works and accepts reason
- [ ] Order disappears from pending after action
- [ ] Messages are created in database

## Troubleshooting

### SMS Not Sending
- Check browser console for errors
- Verify Twilio credentials are set in Supabase
- Ensure phone number is in E.164 format (+13138893860)
- Check Twilio Console for any API errors

### Customer Replies Not Appearing
- Verify webhook URL is configured in Twilio (see Prerequisites)
- Check Supabase Edge Function logs for errors
- Ensure webhook URL is using HTTPS and is publicly accessible
- Test webhook using Twilio's "Test" button in Console
- Check `sms_conversations` table to see if messages are being stored

### Street View Not Loading
- Verify `VITE_GOOGLE_MAPS_API_KEY` is set in `.env`
- Check browser console for API errors
- Ensure Google Maps Street View API is enabled in Google Cloud Console
- Try a different address (some locations don't have Street View)

### Admin Login Issues
- Clear localStorage: `localStorage.clear()`
- Recreate demo accounts from Login page
- Check browser console for authentication errors

## Additional Notes

### Admin Phone Configuration
The admin notification phone is stored in the `admin_settings` table:
```sql
SELECT * FROM admin_settings WHERE key = 'admin_notification_phone';
```

You can update it:
```sql
UPDATE admin_settings
SET value = '+19876543210'
WHERE key = 'admin_notification_phone';
```

### Message Templates
Currently these message templates are referenced:
- `deposit_receipt`: Sent to customer after booking
- Future: `booking_confirmed`: Sent when admin approves
- Future: `booking_rejected`: Sent when admin rejects

### Edge Function URLs

**Send SMS (outbound):**
```
https://0ec90b57d6e95fcbda19832f.supabase.co/functions/v1/send-sms-notification
```

Test it directly:
```bash
curl -X POST https://0ec90b57d6e95fcbda19832f.supabase.co/functions/v1/send-sms-notification \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"+13138893860","message":"Test message"}'
```

**Twilio Webhook (inbound):**
```
https://0ec90b57d6e95fcbda19832f.supabase.co/functions/v1/twilio-webhook
```

This URL must be configured in Twilio Console for receiving customer replies.

## Next Steps

After testing, you may want to:
1. Add email sending alongside SMS
2. Create actual email templates
3. Add admin dashboard statistics
4. Implement notification preferences
5. Add booking modification flow
6. Create customer portal for viewing orders
