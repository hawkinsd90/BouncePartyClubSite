# Google Review Link Setup

This document explains how to configure the Google review link that gets sent to customers after pickup completion.

## Overview

After the crew completes a pickup, the system automatically sends both an SMS and email to the customer thanking them and encouraging them to leave a Google review. These messages include a direct link to your Google Business review page.

## Setting Up Your Google Review Link

### Step 1: Find Your Google Place ID

1. Go to [Google Place ID Finder](https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder)
2. Search for your business name
3. Copy your Place ID (it will look something like: `ChIJN1t_tDeuEmsRUsoyG83frY4`)

### Step 2: Create Your Review Link

Your review link format is:
```
https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID
```

Replace `YOUR_PLACE_ID` with the Place ID you found in Step 1.

**Alternative format** (if you have a Google Maps short URL):
```
https://g.page/r/YOUR_SHORT_CODE/review
```

### Step 3: Configure in Admin Settings

1. Log in to your admin dashboard
2. Go to **Admin > Settings**
3. Find the **Google Review URL** setting
4. Paste your review link
5. Save changes

## How It Works

### SMS Message
When pickup is completed, customers receive an SMS like:
```
Hi John! Thank you for choosing Bounce Party Club! We hope you had a blast.
We'd love to hear about your experience - please leave us a Google review:
https://g.page/r/YOUR_SHORT_CODE/review. See you next time!
```

### Email Message
Customers also receive a professional email with:
- Thank you message
- Order details recap
- Prominent "Leave a Google Review" button
- Professional email template with your business branding

## Template Management

Both messages use database templates that can be customized:

### SMS Template: `pickup_thanks_sms`
- Located in the `sms_message_templates` table
- Can be edited in Admin > Message Templates

### Email Template: `pickup_complete`
- Located in the `email_templates` table
- Can be edited in Admin > Message Templates

## Testing

To test the review link flow:
1. Update the Google Review URL in Admin Settings
2. Complete a pickup from the Calendar view
3. Check that the SMS and email were sent with the correct review link

## Notes

- The review link is automatically inserted into both SMS and email templates
- If no review URL is configured, the `{review_url}` variable will be replaced with an empty string
- Make sure your Google Business Profile is verified and active before sharing review links
