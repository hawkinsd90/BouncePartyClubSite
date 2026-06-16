# Features

## Unit Catalog and Inventory

Rentable units (bounce houses, water slides, combos) are stored in the `units` table. Each unit has:

- `name`, `slug` — display name and URL-friendly identifier
- `types` — array of unit types (e.g., `['bounce_house', 'slide']`) for filtering
- `price_dry_cents`, `price_water_cents` — separate pricing for dry and wet mode
- `dimensions`, `dimensions_water` — physical size in dry and wet mode
- `footprint_sqft` — square footage for lot assessment
- `power_circuits` — number of 20-amp circuits required (stored as decimal)
- `capacity` — max number of riders
- `indoor_ok`, `outdoor_ok` — suitability flags
- `quantity_available` — how many of this unit exist in inventory
- `is_combo` — whether the unit is a combo inflatable
- `active` — whether the unit is visible and bookable. Inactive units are excluded from cart duplication.

Unit media (`unit_media` table) supports multiple images and videos per unit, with:
- `mode` — `dry` or `wet` (which set-up mode the image shows)
- `visibility_mode` — controls which mode tab the image appears under (`dry`, `wet`, or `both`)
- `is_featured` — marks the primary hero image for a unit

Unit images are uploaded to the `unit-images` Supabase storage bucket (admin-only write access).

---

## Quote / Booking Form (`/quote`)

The quote form is a multi-section page where customers configure their rental:

1. **Event Details** — date range (start and end dates for multi-day events), event start/end time, pickup preference (same-day vs. next-day)
2. **Address** — Google Places autocomplete; geocoded for travel fee calculation
3. **Setup Details** — location type (residential/commercial), surface type (grass/concrete/indoor), generator need and quantity, special details, pets on premises
4. **Cart** — unit selection with real-time availability checking
5. **Summary** — full pricing breakdown with all fees before submission

On submission:
1. Blackout dates are checked client-side against `check_date_blackout` RPC
2. Unit availability is verified against the `check_unit_availability` function
3. A `draft` order is created in the database via `src/lib/orderCreation.ts`
4. Customer is created or upserted by email
5. An invoice email and SMS are dispatched via the `send-invoice` edge function
6. Customer is redirected to `/checkout/:orderId`

If the customer is logged in, their previous address and contact details are prefilled from `CustomerProfileContext`. Customers with a `default_address_id` saved get their home address pre-populated in the form.

### Quote Pricing Debounce

Live price calculations in the quote summary (`useQuotePricing.ts`) are debounced 500ms via `debounceTimerRef`. The timer is reset on every form input change so rapid typing or address selection does not trigger excessive recalculations. The pricing output is cleared (and `sessionStorage` is purged) whenever required inputs are incomplete.

### Quote Prefill from Duplication

When an admin duplicates an existing order, the quote form is prepopulated via `localStorage` entries set by `useOrderDuplication`. Event dates are intentionally left blank so the user must consciously choose new dates. Time windows, address, setup details, cart items, and contact info are all preserved.

---

## Checkout Page (`/checkout/:orderId`)

The checkout page handles Stripe payment collection. Flow:

1. Customer reviews the order summary
2. Selects a payment amount (deposit, full, or custom via `PaymentAmountSelector`)
3. Adds an optional tip
4. Confirms card-on-file and SMS consent (if not already given)
5. Enters billing address (stored in Stripe and on the order record)
6. Selects referral source (how they heard about the business)
7. Stripe Checkout Session is created via `stripe-checkout` edge function
8. Customer is redirected to Stripe's hosted checkout page
9. On success, redirects to `/payment-complete` which finalizes the order

### Payment Amount Options

| Option | Description |
|---|---|
| Deposit only | Pay the configured deposit amount now; balance due later |
| Full payment | Pay the entire order total now |
| Custom amount | Pay any amount between deposit and full total |

The customer's selection is recorded in `customer_selected_payment_cents` and `customer_selected_payment_type` on the order.

### Billing Address

The checkout form collects a billing address for Stripe. This is stored inline on the `orders` record (`billing_address_line1`, `billing_city`, `billing_state`, `billing_zip`) — separate from the event delivery address.

### Card-on-File (Setup Mode)

If `require_card_on_file` is true on the order, a Stripe setup session is created instead of (or in addition to) a charge session. This saves the card for future charges (deposit, balance) without charging at checkout.

### Referral Source Tracking

The checkout form captures how the customer heard about the business via a `referral_source` dropdown (e.g., Google, Facebook, referred by friend). Free-text detail is captured in `referral_source_detail`. Both fields are stored on the order for analytics.

---

## Contacts (Phonebook)

The `contacts` table is a deduplicated phonebook of every person who has ever placed an order. It is separate from `customers` — `customers` is per-order, `contacts` is per-person across all orders.

A contact record is upserted automatically whenever a new order is submitted (matched by email address). Contact statistics are maintained by database triggers:

- `total_bookings` — total order count
- `total_spent_cents` — lifetime spend including custom fees and discounts
- `completed_bookings_count`, `first_completed_booking_date`, `last_completed_booking_date`
- `is_repeat_customer` — true if 2+ completed bookings
- `opt_in_sms`, `opt_in_email` — communication preferences
- `tags` — admin-assigned labels (array)
- `business_name` — for commercial customers
- `source` — how the contact was first acquired
- `last_contact_date` — last time the contact was interacted with

Contacts are viewable, searchable, and filterable from the admin Contacts tab. Each contact shows their full order history and allows sending an SMS directly from the conversation thread.

---

## Invoices and Invoice Links

The `invoices` table tracks the financial state of an order from the admin perspective.

Invoice statuses: `draft`, `sent`, `paid`, `partial`, `void`

When an admin approves an order, an invoice is created automatically with the appropriate status based on what was collected.

**Invoice Links** (`invoice_links` table) provide secure tokenized public URLs for customers to view their invoice and access their customer portal without logging in. Each link has two access paths:

- **Full token URL** (`/customer-portal/:orderId?t=:token`) — 64-character hex token; used for email links where length is not a concern.
- **Short URL** (`/i/:shortCode`) — 8-character alphanumeric code using an unambiguous character set (no `0`, `O`, `1`, `I`, `l`); used in SMS messages to stay within character limits.

The `link_type` column on `invoice_links` distinguishes between:
- `invoice` — created by the `send-invoice` edge function during admin invoice distribution
- `portal_shortlink` — created by `createShortPortalLink()` for crew ETA SMS messages and other compact-URL use cases

Both types resolve via the `/i/:shortCode` route (`ShortLink.tsx`) which looks up the short code and redirects to the appropriate customer portal URL.

Links expire via the `expires_at` field: 3 days after the event date (or 30 days from creation if no event date).

**Admin Invoice Sending** (`send-invoice` edge function) dispatches a formatted invoice email (full token URL) and an SMS (short URL) in parallel. A failure of one does not block the other.

Admins can also use the **Invoice Builder** to manually construct invoices with custom line items, fees, and discounts, then send them directly to a customer by email/SMS.

---

## Electronic Waiver System

Every order requires a signed waiver before the rental takes place. The waiver is ESIGN/UETA compliant.

### Waiver Content (`src/lib/waiverContent.ts`)

The waiver text is generated dynamically using business settings from `admin_settings`. The waiver includes:

1. Acknowledgment and Assumption of Risk
2. Waiver and Release of Liability
3. Indemnification
4. Renter's Responsibility
5. Equipment Condition and Inspection
6. Cancellations and Refunds (72-hour cancellation policy)

The waiver is versioned (`version: 1.0`) so future updates are tracked per signature.

### Signing Flow (`/sign/:orderId`)

The `/sign/:orderId` page collects:
- Renter name, phone, email
- Event date and full event address
- Optional home address
- Canvas-based signature (using `signature_pad` library)
- Optional typed name and initials
- Electronic consent acknowledgment checkbox

On submission, the `save-signature` edge function:
1. Stores the signature record in `order_signatures` with the full waiver text snapshot, IP address, user agent, device info, signer home/event address, initials, and typed name
2. Stores a `consent_records` row with `consent_type: 'electronic_signature'`
3. Generates a signed PDF asynchronously (`generate-signed-waiver` function) — stored in the `signed-waivers` bucket (private)
4. Sets `waiver_signed_at` and `signed_waiver_url` on the order
5. Sends a confirmation email to the customer with the PDF as an attachment (falls back to download link if PDF is not yet ready)
6. Returns the PDF URL for immediate display

The `order_signatures` record stores everything needed for a legally defensible audit: signer identity, consent text, waiver version, IP, user agent, device info, and a complete snapshot of the waiver text as it existed at signing time.

### Overnight and Same-Day Responsibility Agreements

Separate responsibility acknowledgments are tracked on the order:
- `same_day_responsibility_accepted` — customer acknowledged same-day pickup responsibility
- `overnight_responsibility_accepted` — customer acknowledged overnight equipment responsibility

These are separate from the main waiver and are shown as inline consent checkboxes during checkout.

---

## Media Library (Admin Photos Tab)

The admin Photos tab provides a unified view of all photos across the entire system — delivery proof, damage photos, customer-submitted order photos, lot pictures, unit catalog images, and carousel media.

### Sources and Filters

Photos are aggregated from multiple tables and storage buckets:

| Source | Table | Description |
|---|---|---|
| `delivery` | `task_status.delivery_images` | Crew delivery proof photos |
| `damage` | `task_status.damage_images` | Crew damage documentation photos |
| `order` | `order_pictures` | Customer-submitted photos via portal |
| `lot` | `order_lot_pictures` | Pre-event lot assessment photos |
| `unit` | `unit_media` | Unit catalog images |
| `carousel` | `hero_carousel_images` | Homepage carousel media |

### Advanced Filtering

The filter bar supports:
- **Source filter** — show photos from one specific source or all
- **Search** — filter by customer name, address, unit name, or order ID
- **Sort** — newest first, oldest first, alphabetical by source/customer/unit
- **Date range** — last 7 days, 30 days, 90 days, or all time
- **Evidence filter** — show only protected evidence (damage photos), non-protected, or all
- **Saved to address filter** — show only lot photos saved to a canonical address
- **Display status filter** — filter by visibility mode (unit catalog images)
- **Group by** — flat list, or grouped by source, order, unit, or address

### Pagination

Photos load 24 at a time with a "Load more" button. Count is displayed as "Showing X of Y photos."

### Photo Detail Modal

Clicking any photo opens a detail view with:
- Full-resolution image
- Source metadata (order ID, customer name, unit, address)
- Status badges (saved to address, protected evidence, in unit gallery, in carousel)
- Admin actions: Promote to unit gallery, promote to carousel, save lot photo to address, download

### Promote to Unit Gallery / Carousel (`promote-media` edge function)

Admins can promote photos taken during events to the unit catalog or homepage carousel. The `promote-media` edge function:
- Requires `consent_confirmed: true` in the request body
- Requires `admin` or `master` role (verified via `get_user_role()` RPC)
- Re-verifies that delivery photo URLs actually exist in `task_status.delivery_images` before allowing promotion (prevents arbitrary file promotion)
- Copies the file to the appropriate storage bucket with a path like `promoted/{safeBaseName}-{timestamp}.{ext}`
- Creates the necessary `unit_media` or `hero_carousel_images` record with appended sort/display order

### Media Health Panel

A collapsible panel at the top of the Photos tab surfaces warnings:
- Unit images without a storage path
- Damage photo counts
- Notes about evidence restrictions (damage photos are protected)
- Notes about video exclusion (videos are not shown in the photo grid)

---

## Google Maps Integration

Google Maps is used for three purposes:

### Address Autocomplete

The `AddressAutocomplete` component uses the Google Places Autocomplete API to help customers enter their event address. On selection, the address is geocoded and coordinates (lat/lng) are stored on the `addresses` record for travel fee calculation.

### Travel Fee Calculation

The `distanceCalculator.ts` library computes driving distance from the home base (Wayne, MI) to the event address using the Distance Matrix API. Chargeable miles (miles beyond the free radius) are stored on the order. The fee display always shows the full driving distance, not just chargeable miles.

### Route Optimization

See the Crew and Operations documentation.

The Google Maps SDK is loaded lazily using a singleton loader (`src/lib/googleMapsLoader.ts`) to prevent duplicate loads across components.

---

## Google Reviews

The admin manages customer reviews displayed on the homepage via the admin panel. Reviews are stored in the `google_reviews` table with:

- `reviewer_name`, `reviewer_initial` — display name
- `rating` — 1-5 stars
- `review_text` — the review content
- `review_date` — human-readable date string (e.g., "3 months ago")
- `is_active` — toggle visibility without deleting
- `display_order` — controls sequence

Only real reviews from actual customers should be entered here. The "Read more reviews on Google" button links to the business Google review page configured in admin settings (`google_review_url`).

---

## Admin Panel (`/admin`)

The admin panel is a tabbed interface with the following sections:

### Orders Tab
- View all orders with filtering by status, search by customer name/email/order ID
- Click any order to open the Order Detail Modal
- Approve, reject, cancel, void, and progress orders through workflow stages
- Add custom fees, discounts, and internal notes

### Contacts Tab
- Full phonebook with search and filtering
- Customer details, order history, lifetime spend, repeat-customer flag
- SMS conversation thread per customer

### Invoices Tab
- View and manage all invoices
- Access Invoice Builder for manual invoice creation

### Analytics Tab
- Business performance charts (revenue, bookings, lead time)
- Date range filtering: **today** / last 1d / 7d / 30d / 90d / this month / last month / two months ago / all time
- The **Today** period spans from midnight to the current moment (America/Detroit timezone)
- Site analytics (page views, funnel conversion)
- Booking source analytics (how customers found the business)

### Photos Tab
- Unified media library across all photo sources
- Advanced filtering, grouping, and pagination
- Promote photos to unit gallery or carousel
- Media health panel with warnings

### Crew Calendar Tab
- Monthly calendar view with confirmed orders
- Day view showing all deliveries and pickups
- Route optimization controls
- Task card management
- Mileage logging
- Task equipment lists include generators: if `generator_qty > 0` on an order, the generator (with quantity if more than one) is appended to the equipment list shown in crew task cards and calendar views (e.g., "Generator (2x)")

### Settings Tab (sub-tabs):
- **Business Info** — name, address, phone, email, website, legal entity, license
- **Branding** — logo, favicon, brand colors, social media URLs
- **Pricing Rules** — per-mile rates, fee amounts, deposit percentage, tax settings, free cities
- **Blackout** — dates, addresses, and contacts
- **Message Templates** — SMS template management
- **Email Templates** — email template management
- **Google Calendar** — Google Calendar sync configuration
- **Changelog** — audit log of all settings changes
- **Permissions** — role management for admin/crew users
- **Stripe** — Stripe keys and webhook configuration
- **Twilio** — Twilio credentials for SMS

---

## Order Detail Modal

The Order Detail Modal is the primary admin interface for managing a single order. Tabs:

### Details Tab
- Full order information (event details, customer info, items, pricing)
- Edit event details, address, setup details
- Add/remove units from cart
- Manage custom fees and discounts (with saved template support)
- Override deposit amount
- Waive fees (tax, travel, surface, generator, same-day pickup, sandbag) with reason
- View/edit admin message (displayed to customer in portal)

### Payments Tab
- Full payment history with ledger sequence
- Record cash or check payments
- Initiate Stripe refund (admin/master only)
- Send customer balance payment link
- View Stripe fee and net amounts

### Workflow Tab
- Status progression controls
- Send customer notifications
- Manage lot picture requests
- Request customer approval for order changes

### Notes Tab
- Internal admin notes (not visible to customer)

### Changelog Tab
- Complete audit trail of all changes to the order

### Waiver Tab
- Waiver status (signed/unsigned)
- Link to signed waiver PDF
- Customer signing link

### SMS Tab
- Full inbound/outbound SMS thread with customer

---

## Fee Waivers

Any fee on an order can be waived by an admin with a documented reason:

| Fee | Waiver Flag | Reason Field |
|---|---|---|
| Tax | `tax_waived` | `tax_waive_reason` |
| Travel fee | `travel_fee_waived` | `travel_fee_waive_reason` |
| Surface fee | `surface_fee_waived` | `surface_fee_waive_reason` |
| Same-day pickup fee | `same_day_pickup_fee_waived` | `same_day_pickup_fee_waive_reason` |
| Same-day weekday delivery fee | `same_day_weekday_delivery_fee_waived` | `same_day_weekday_delivery_fee_waive_reason` |
| Generator fee | `generator_fee_waived` | `generator_fee_waive_reason` |
| Sandbag fee | `sandbag_fee_waived` | `sandbag_fee_waive_reason` |

Waiver reasons are logged in the order changelog for audit purposes. The `tax_waived` field is backfilled for historical orders that predate the `apply_taxes_by_default` setting.

---

## Custom Fees and Discounts

### Custom Fees (`order_custom_fees`)

Admins can add arbitrary fee line items to any order (e.g., "Extra cleaning fee", "Late cancellation fee"). Each fee has a name and a fixed amount in cents.

### Discounts (`order_discounts`)

Admins can add discounts as either a fixed dollar amount or a percentage. Discounts affect the order total and thus the deposit calculation.

### Saved Templates

Frequently-used fees and discounts can be saved as templates (`saved_fee_templates`, `saved_discount_templates`) for quick application without retyping. Managed from the admin Pricing Rules tab.

---

## Address Deduplication and Lot Photo Persistence

Addresses are stored as canonical records in the `addresses` table with a unique `address_key` for deduplication. When the same address is submitted twice, the existing record is returned rather than creating a duplicate. Coordinates (lat/lng) are stored for travel fee and distance calculations.

### Save to Address (Lot Pictures)

When crew or admin uploads lot pictures for an order, they can "Save to Address" from the Photo Detail view. This calls the `save_lot_picture_to_address` RPC atomically — it creates a record in `address_lot_pictures` and updates the `address_id` on the `order_lot_pictures` record. Future orders at the same address automatically surface these reference photos to crew and admins, providing institutional memory about the setup location. This eliminates the need for crews to re-photograph familiar venues.

---

## Customer Portal (`/customer-portal`)

The customer portal is a public-facing, tokenized view that does not require login. Customers access it via a unique link sent in their confirmation email/SMS.

### Short Link Access (`/i/:shortCode`)

The portal can also be reached via a compact short URL (`/i/:shortCode`). The `ShortLink` page resolves the 8-character code by querying the `invoice_links` table and redirects to `/customer-portal/:orderId?t=:token`. This URL form is used in SMS messages to stay within character limits.

### Regular Portal View

Shows the customer:
- Order status and event details
- Invoice and pricing breakdown
- Payment options (if balance is due)
- Lot pictures (uploaded by crew after setup)
- Delivery tracking (crew ETA and status updates via Supabase Realtime)
- Link to sign the waiver
- Order cancellation option
- Admin message (if admin has posted a note for the customer)

### Order Approval View

When the admin modifies a confirmed order and sends it for customer review, the portal displays:
- What changed (item additions/removals, price changes, date changes)
- New pricing breakdown
- Approve or Reject buttons

Approval atomically confirms the changes via the `atomic_approve_order` RPC function and moves the order back to `confirmed`. Rejection logs the rejection and notifies the admin. Both happen without login.

### Payment Tab

Customers with an outstanding balance can pay via their saved card on file. If the saved card is declined, a link to update the card is provided (via `fix-payment-method` edge function).

### Lot Pictures Tab

Displays photos uploaded by the crew, visible to the customer after upload.

### Customer Cancellation

Customers can cancel their own order from the portal. They select a cancellation reason and can optionally flag that they want a refund. The `customer-cancel-order` edge function records:
- `cancellation_reason` — selected from a standardized list
- `cancelled_at`, `cancelled_by` timestamps
- `refund_requested` — customer's refund intent flag (admin must still process manually)

---

## Customer Dashboard (`/my-orders`)

Logged-in customers can view all their orders with status, payment status, and quick links to:
- Customer portal
- Waiver signing
- Payment
- Receipt download

---

## Travel Calculator (Admin Tool)

The admin Travel Calculator tab allows admins to calculate travel fees for any arbitrary address without creating an order. Useful for quoting travel costs to potential customers or auditing pricing. Calls the same distance calculation logic used during order creation.

---

## Address Coordinate Backfill (Admin Tool)

The `AddressCoordinateBackfill` admin component allows admins to retroactively geocode historical addresses that are missing lat/lng coordinates. This ensures all addresses can be used for travel fee calculations and route optimization.

---

## Payment Backfill Section (Admin Tool)

The `PaymentBackfillSection` admin component allows admins to retroactively fix orders where payment method details (brand, last four digits, expiry) were not saved — typically from early orders before the payment method backfill migration. Calls the `backfill-payment-methods` edge function.

---

## SMS Conversations

Each customer phone number has a dedicated SMS thread stored in the `sms_conversations` table. Each record stores the actual message body, direction (inbound/outbound), Twilio message SID, and the linked `order_id`.

Admins view and reply to SMS threads directly from the order detail SMS tab. The `twilio-webhook` edge function handles inbound messages and routes them to the correct conversation by phone number.

**Important:** Messages only appear in an order's SMS thread if the outgoing send was made with `orderId` (camelCase) in the `send-sms-notification` edge function request body. Messages sent without `orderId` are stored with `order_id = null` and are invisible in the order thread.

Note: The separate `messages` table is a notification dispatch log (template key, channel, payload, status) — it does NOT store message body text. See the "SMS Architecture: Two Distinct Tables" section below.

---

## Hero Carousel

The homepage features a media carousel managed through the admin panel. The `hero_carousel_images` table stores image and video entries with:
- `media_type` — `image` or `video`
- `storage_path` — path in `carousel-media` Supabase storage bucket
- `display_order` — controls sequence

### Browse Inflatables CTA

Immediately below the hero carousel ribbon, the homepage shows a slim blue strip ("View Our Full Inflatable Catalog") with a "Browse" button that navigates to `/catalog`. This strip is always visible on the home page and provides a direct entry point to the unit catalog for customers who want to browse inventory before filling out the quote form.
- `is_active` — toggles visibility without deleting
- `title`, `description` — optional overlay text

An admin setting (`carousel_show_arrows`) controls whether navigation arrows are displayed on the carousel.

---

## Blackout System

Admins can block orders from the Blackout tab using three types of restrictions:

### Blackout Dates

Prevent new orders on specified date ranges. Supports:
- `block_type`: `full` (no orders) or `same_day_pickup_only` (blocks same-day pickups but allows next-day)
- `recurrence`: `one_time`, `annual`, or `weekly`
- `expires_at`: optional expiration date for temporary blocks

The `check_date_blackout` database function is called by both the client-side quote form and the server-side `stripe-checkout` edge function. The server-side check cannot be bypassed. The function correctly handles wrap-aware annual recurrence (dates that span year boundaries).

### Blackout Addresses

Block specific delivery locations by full address. Used for problem venues or restricted areas. Includes `reason` and optional `notes`.

### Blackout Contacts

Block specific customers by email or phone. Used for customers with past payment issues or policy violations. Includes `reason` and optional `notes`.

---

## Business Branding

The admin Business Branding tab manages:
- Logo upload (stored in `public-assets` Supabase storage)
- Favicon upload
- Brand primary color
- Social media URLs (Facebook, Instagram, TikTok, YouTube, Yelp)
- Google Review URL and Google Maps URL

Branding is loaded by `BusinessContext` and used throughout the app for display and in email templates. The logo URL and brand color are also used in the `emailTemplateBase.ts` component library for all transactional emails.

---

## Admin Analytics

### Business Analytics Tab

Revenue and booking performance charts with configurable date ranges (**today** / last 1d / 7d / 30d / 90d / this month / last month / two months ago / all time):
- Total revenue, revenue this month with trend vs. last month
- Average order value
- Total tips and tip rate
- Deposits collected, balance owed, total refunds
- Cash vs. card payment split
- Total orders, orders this month with trend
- Average lead time (days between booking and event)
- Cancelled orders count and cancellation rate
- Repeat customer count and rate (2+ completed bookings)
- Top 8 units by revenue (name, booking count, revenue)
- Top 8 cities by order count
- Crew mileage breakdown by crew member (fetches display names via `get-user-info` edge function)
- Cancellation reason breakdown

### Performance Analytics

Detailed performance metrics including:
- Conversion funnel (quotes → submitted → confirmed → completed)
- Cancellation rate and reasons
- Payment method breakdown

### Site Analytics

Tracks user behavior via the `site_events` table:
- Page views by path
- Quote form starts and completions
- Unit detail views
- Checkout starts and completions
- Conversion funnel: `unit_view → cart_started → cart_submitted → checkout_started → checkout_completed`
- Today's session count (unique `session_id` values)
- Recent activity feed (last 20 events)

### Booking Source Analytics

Tracks referral sources via `referral_source` and `referral_source_detail` fields on orders. Groups by source with order count and revenue. The `get_booking_source_analytics` SECURITY DEFINER database RPC provides the aggregated data. Sources include: social_media (with sub-source breakdown), google, physical_marketing, referral, returning_customer, other.

---

## Admin Settings / Configuration

All runtime configuration is stored in the `admin_settings` key-value table and managed through the admin Settings tabs. Key groups:

| Key Prefix | What It Stores |
|---|---|
| `business_*` | Business name, address, phone, email, website, legal entity, license |
| `home_address_*` | Home base address components and coordinates for travel calculations |
| `logo_url`, `favicon_url` | Branding assets |
| `social_*` | Social media URLs |
| `stripe_*` | Stripe secret key, publishable key, webhook secret |
| `twilio_*` | Twilio Account SID, Auth Token, From Number |
| `resend_*` | Resend API key for email |
| `google_*` | Google Maps API key, OAuth client, Review URL, Calendar credentials |
| `admin_*` | Admin email, admin phone number |
| `carousel_*` | Carousel display settings |
| `apply_travel_fee_by_default` | Whether to apply travel fee on new orders |
| `use_business_address_for_travel` | Whether to use business address as travel origin |

Secret values (Stripe keys, Twilio credentials, Resend API key) are redacted in the `admin_settings_changelog` by a database trigger. The trigger substitutes `[REDACTED]` for any key whose name contains `key`, `secret`, `token`, `sid`, or `password`.

---

## Google Calendar Sync

Confirmed orders can be synced to a Google Calendar. When an order is confirmed:

1. A record is added to the `google_calendar_sync_queue` table (via database trigger)
2. The `sync-google-calendar` edge function processes the queue
3. A calendar event is created or updated with order summaries
4. Sync status is tracked in `google_calendar_sync` per event date

**Calendar Event Format:**
- Summary: `BPC: {activeCount} Active / {orderCount} Total Orders`
- Description: order date, active/total counts, and customer name list (up to 15)
- Reminders: email + popup at 9am and 6pm the previous day

Configuration (Google OAuth credentials) is managed in the admin Google Calendar Settings tab. Sync can be toggled on/off without removing credentials via the `google_calendar_enabled` setting. The sync is currently inactive until Google credentials are fully configured.

---

## Notification Reliability

The `notification_failures` and `notification_system_status` tables track email and SMS delivery health. When failures accumulate (3+ consecutive failures for a notification type), the admin is alerted. The admin Notification Failures panel shows unresolved failures and allows marking them resolved.

The `notification_system_status` table maintains real-time health status per system type (`email`, `sms`) with:
- `is_operational` flag
- `consecutive_failures` count
- `total_failures_24h`
- `last_success_at`, `last_failure_at`
- `admin_notified_at` — prevents duplicate alerts

---

## Crew Page (`/crew`)

The crew page is a dedicated calendar view for crew members showing:
- Monthly calendar with event counts per day
- Day view with all task cards for the selected date
- Route management and optimization controls
- Equipment checklist access per task
- Mileage logging modal
- Real-time task status updates via Supabase Realtime subscriptions

Admin users also have access to the crew page. The crew page does not show financial details — only operational task information.

---

## Menu Preview (`/menu-preview`)

A printable catalog page showing all active units with photos, dimensions, pricing, and capacity. Used for in-person sales or as a PDF handout. Accessible without login.

The page preloads all unit images before triggering the browser print dialog, preventing missing images in the printed output. Data is passed via `sessionStorage` (key `menuPreviewData`) to support print-optimized rendering without a separate network request.

### Save as Image

The menu preview includes a "Save as Image" button that renders the full catalog to an HTML Canvas (pure Canvas 2D — no DOM capture libraries) and triggers a native save/share sheet. Implementation details:

- Draws all unit cards onto a `1200px × auto` canvas at 2× retina resolution
- Loads unit images with CORS-anonymous fallback to prevent canvas tainting
- On iOS 15+ / Android Chrome, uses the Web Share API (`navigator.share({ files: [file] })`) to trigger the native share/save sheet
- On desktop, falls back to an anchor `<a download>` element

### PDF Layout

The print layout groups units into pages of 6 (2 rows × 3 columns per page) using explicit `page-break-after` on container elements — not on grid items — for reliable cross-browser page breaks. The screen layout uses 2 columns. The header shows the business logo, title, and generation date; the footer shows the website and a pricing disclaimer.

---

## Pricing Engine

Pricing is calculated in `src/lib/pricing.ts` using the `PricingRules` record from `admin_settings`. The engine is used both client-side (live quote updates) and server-side (order validation at checkout).

### Unit Price

Each unit contributes either `price_dry_cents` or `price_water_cents` depending on the order's `water_slide` flag.

### Multi-Day Pricing

Multi-day orders use the `extra_day_pct` field on `pricing_rules` (default 0.5) to calculate additional day charges. Each day beyond the first costs `price × extra_day_pct`. The full duration spanning `event_date` to `event_end_date` is used.

### Travel Fee (Three-Tier Logic)

1. **ZIP Zone Override** — if the event address ZIP code is in the `zip_travel_overrides` map (from `pricing_rules`), that fixed fee applies.
2. **Free Cities List** — if the city is in the `free_travel_cities` array, the travel fee is $0.
3. **Distance-Based** — miles beyond `home_base_radius_miles` from the home address are charged at `travel_fee_per_mile` per mile. Distance is calculated via Google Maps Distance Matrix.

The stored `travel_fee_cents` on the order reflects which tier was used. Admins can waive the travel fee per-order with a reason.

### Generator Fee Tiering

- First generator: charged at `generator_fee_single_cents`
- Each additional generator: charged at `generator_fee_multiple_cents`
- Total: `generator_fee_single_cents + (count - 1) × generator_fee_multiple_cents`
- Can be waived with `generator_fee_waived` flag.

### Surface Fee

A flat `surface_sandbag_fee_cents` applies when the surface type is `cement`, OR when the surface is `grass` AND `can_use_stakes` is false. Can be waived with `surface_fee_waived` flag.

### Same-Day Pickup Fee

Applied when `location_type === 'commercial'` OR `overnight_allowed === false`. Rate is `same_day_pickup_fee_cents` from `pricing_rules`. Can be waived with `same_day_pickup_fee_waived` flag.

**Note:** The `same_day_matrix_json` column exists on `pricing_rules` and is populated in the live database with tiered same-day pricing entries, but is not used by the current `calculatePrice` engine. It is reserved for future tiered same-day pricing logic.

### Same-Day Weekday Delivery Fee

A separate fee applied when the event date is today **and** today is a weekday (Monday–Friday). Determined by `isSameDayWeekdayDelivery(eventDateYMD)` in `src/lib/pricing.ts`, which checks both date equality (in the `America/Detroit` timezone) and day-of-week (dow 1–5).

- Rate is `same_day_weekday_delivery_fee_cents` from `pricing_rules` (default $50)
- Stored as `same_day_weekday_delivery_fee_cents` on the `orders` and `invoices` tables
- Excluded from the tax base
- Can be waived with `same_day_weekday_delivery_fee_waived` flag
- Displayed in `OrderSummary` with a "WAIVED" badge when waived
- The `isSameDayWeekdayDelivery` check is made at quote time in the quote form and at invoice build time in `InvoiceBuilder`

### Tax

Applied at exactly 6% (hardcoded in the engine) on (subtotal + travel fee + surface fee + generator fee). The same-day pickup fee is **excluded** from the tax base. Controlled by:
- `apply_taxes_by_default` on `pricing_rules` — currently `false` in the live database (tax is OFF by default for new orders)
- Per-order `tax_waived` flag — admin can waive per order with reason
- Historical orders were backfilled via the `backfill_tax_waived_for_old_orders` migration to honor the original no-tax policy.

### Deposit

Deposit amount is calculated as `quantity_of_units × deposit_per_unit_cents` (default $50/unit from `pricing_rules.deposit_per_unit_cents`). Admin can override per-order with `custom_deposit_cents`.

**Note:** The `deposit_percentage` column exists on `pricing_rules` but is NOT used by the current `calculatePrice` engine. Deposit is always per-unit in the live calculation.

### Overnight Pricing

The `overnight_holiday_only` flag on `pricing_rules` restricts overnight rental availability to holiday dates only. When enabled, overnight pickup is blocked on non-holiday dates.

---

## Site Analytics and Admin Bypass

User behavior is tracked via `src/lib/siteEvents.ts` and stored in the `site_events` table. Tracked events follow a conversion funnel:

| Event | When |
|---|---|
| `unit_view` | Customer views a unit detail page |
| `cart_started` | Customer adds first item to cart |
| `cart_submitted` | Customer submits the quote form |
| `checkout_started` | Customer reaches the checkout page |
| `checkout_completed` | Payment successfully completed |

Each event record includes: `event_name`, `session_id` (text per browser session), `page_path`, `unit_id` (FK if applicable), `order_id` (FK if applicable), `referrer`, `metadata` (JSONB), `created_at`.

**Admin bypass:** The `siteEvents.ts` module checks the user's role before recording any event. Admin and master users are excluded from tracking entirely to prevent internal navigation from polluting funnel conversion data.

---

## Customer Portal Realtime Subscriptions

The Customer Portal subscribes to live Supabase Realtime changes on 6 tables simultaneously to show real-time updates without requiring page refreshes:

| Table | Purpose |
|---|---|
| `orders` | Order status changes, payment updates |
| `task_status` | Crew workflow status (en route, arrived, etc.) |
| `route_stops` | ETA updates from route optimization |
| `order_pictures` | New customer-uploaded photos |
| `order_lot_pictures` | New lot photos uploaded by crew |
| `order_signatures` | Waiver signing completion |

All 6 subscriptions are debounced (600ms) before refreshing data to prevent excessive re-renders when multiple changes fire in rapid succession. Subscriptions are scoped to the specific `order_id` and cleaned up on unmount.

**Note:** The `orders` table is explicitly added to the `supabase_realtime` publication via migration (`ALTER PUBLICATION supabase_realtime ADD TABLE orders`) to enable filtered row-level change events. Without this, `orders` changes would not be delivered to the realtime subscription.

---

## Invoice Acceptance Flow (Three Paths)

When a customer opens their Customer Portal via the invoice link, the system determines which payment flow to present based on order configuration:

### Path 1: No Card Required
If `require_card_on_file` is false and `deposit_due_cents` is 0, the customer just accepts the invoice. No payment UI is shown. `invoice_accepted_at` is recorded.

### Path 2: Card Setup Only
If `require_card_on_file` is true but no charge is needed (deposit waived or already paid), the customer is prompted to save a card on file. A Stripe Setup Session is created (not a Payment Session). The card is saved for future use (e.g., deposit charge on approval, balance charge on completion).

### Path 3: Normal Charge
If `deposit_due_cents > 0`, the customer selects a payment amount (deposit, full, or custom), optionally adds a tip, and proceeds through Stripe checkout.

All three paths are handled by the `InvoiceAcceptanceView` component which reads `require_card_on_file` and `deposit_due_cents` from the order to route to the correct flow.

---

## Order Approval with Change Detection

When an admin modifies a confirmed order and sends it for customer review, the Customer Portal's `OrderApprovalView` component performs change detection by:

1. Reading all `order_changelog` entries with `change_type = 'edit'` that occurred after `customer_approval_requested_at`
2. Grouping changes by field name
3. Displaying a human-readable summary of what changed (e.g., "Event date changed from June 1 to June 15")
4. Showing the updated pricing breakdown

The customer can then select how much they want to pay (deposit, full, or custom amount) before approving. On approval, the `atomic_approve_order` RPC atomically:
- Sets `awaiting_customer_approval = false`
- Clears `customer_approval_requested_at`
- Sets `status = 'confirmed'` (if previously confirmed before the edit)
- Logs the approval to `order_changelog`

---

## Waiver PDF Generation

The `generate-signed-waiver` edge function creates a PDF of the completed waiver:

1. Fetches the `order_signatures` record for the order
2. Retrieves the business logo URL from `admin_settings`
3. Renders a structured PDF document including:
   - Business logo and name
   - Full waiver text (stored verbatim in the signature record)
   - Signer identity (name, phone, email)
   - Signature date and IP address
   - Device information and user agent
   - UETA compliance statement: "This electronic signature is legally binding under the Electronic Signatures in Global and National Commerce Act (ESIGN) and the Uniform Electronic Transactions Act (UETA)"
   - Canvas signature image (PNG data URI from the signature record)
4. Stores the PDF in the `signed-waivers` storage bucket (private)
5. Updates `signed_waiver_url` on the order

The PDF is attached to the waiver confirmation email sent to the customer. If PDF generation is not yet complete when the email sends, a download link is provided instead.

---

## Repeat Customer Form Prefill

When a logged-in customer starts a new quote, the `get_user_order_prefill` SECURITY DEFINER RPC is called. It returns the most recent confirmed order for that user's email address with:
- Event address (all fields)
- Setup details (surface type, location type, special details)
- Generator preference
- Contact information

This data prefills the quote form so repeat customers don't need to re-enter their delivery address and setup preferences. The prefill can be cleared if the customer wants to start fresh.

---

## Backfill and Maintenance Tools (Admin-Only)

### Address Coordinate Backfill

The `AddressCoordinateBackfill` admin tool retroactively geocodes historical `addresses` records that are missing `lat` and `lng` coordinates. Uses the Google Maps Geocoding API. Essential for enabling travel fee calculations and route optimization on old orders.

### Payment Method Backfill

The `PaymentBackfillSection` admin tool retroactively populates `payment_method_brand` and `payment_method_last_four` on orders that were processed before these fields existed. Calls the `backfill-payment-methods` edge function which queries Stripe for each order's payment intent and updates the record.

### OAuth Customer Backfill

The `backfill-oauth-customers` edge function links existing customer records to auth users who signed up via Google OAuth after their orders were placed. Matches on email address and sets `user_id` on the `customers` record.

---

## Transaction Receipt System

Every payment event generates an immutable `transaction_receipts` record. Receipts:
- Cannot be updated or deleted after creation (enforced by RLS — no UPDATE or DELETE policies)
- Have a unique human-readable `receipt_number` (format: `REC-{timestamp}` or sequential)
- Group related transactions via `receipt_group_id` (e.g., deposit + tip from the same Stripe charge share a group)
- Track `payment_type` (`stripe`, `cash`, `check`), `amount_cents`, `tip_cents`, `subtotal_cents`, `net_cents`, `stripe_fee_cents`
- Reference `order_id`, `payment_id`, and `stripe_payment_intent_id`

Receipts are viewable by customers from their Customer Dashboard and by admins from the Order Detail Payments tab.

---

## Rate Limiting

Key edge function endpoints are protected by a sliding-window rate limiter using the `rate_limits` database table:

| Endpoint | Identifier | Limit |
|---|---|---|
| Stripe checkout session creation | order ID + IP | Prevents brute force / repeated session creation |
| Payment recording | order ID | Prevents duplicate payment submissions |
| Email sending | recipient + type | Prevents email flooding |

The `checkRateLimit()` function (in `_shared/rate-limit.ts`) reads the `(identifier, endpoint)` pair, increments the counter, and sets `blocked_until` when the threshold is exceeded. The `cleanup_old_rate_limits()` database function purges expired rows.

---

## Stripe Webhook Event Tracking

All incoming Stripe webhook events are recorded in the `stripe_webhook_events` table for operational visibility and idempotency:

| Column | Purpose |
|---|---|
| `stripe_event_id` | Stripe event ID (unique) |
| `event_type` | e.g., `checkout.session.completed` |
| `status` | `processed`, `failed`, or `skipped` |
| `attempts` | Number of processing attempts |
| `last_error` | Error message if processing failed |
| `processed_at` | Timestamp |

Duplicate webhook deliveries are silently discarded (same `stripe_event_id` = `skipped`). Failed events remain in the table for admin diagnosis without digging through edge function logs.

---

## Permissions and Role Management

The admin Permissions tab allows master and admin users to grant and revoke roles for other users. Role operations are backed by SECURITY DEFINER RPCs that enforce the role hierarchy:

- Only `master` users can assign `admin` or `master` roles
- `admin` users can assign `crew` and `customer` roles
- No user can assign a role higher than their own

All role changes are logged to `user_permissions_changelog` with the actor's email embedded at write time — the audit trail remains accurate even if the actor's email later changes.

The `get_all_role_users()` RPC returns all users with non-customer roles (admin, master, crew) with their email and assigned roles, used to populate the Permissions tab user list.

---

## SMS Architecture: Two Distinct Tables

The application uses two distinct tables for different SMS concerns:

### `sms_conversations` — The SMS Thread

Stores the actual content of every SMS message exchanged with a customer:
- `message_body` — the text of the message
- `direction` — `inbound` (from customer) or `outbound` (to customer)
- `from_phone`, `to_phone` — parties
- `twilio_message_sid` — Twilio's unique message identifier
- `is_admin_internal` — flags messages meant only for admin eyes
- `order_id` — links to the relevant order for display in Order Detail SMS tab
- `status` — delivery status from Twilio

### `messages` — The Notification Dispatch Log

Records what notifications were dispatched — not the message body:
- `template_key` — which notification template was used (e.g., `booking_confirmed`)
- `channel` — `email` or `sms`
- `payload_json` — the data passed to the template
- `status` — `sent`, `failed`, `pending`
- `recipient_id`, `order_id` — context for the notification

This table is for operational monitoring (did the notification go out? did it fail?) — not for reading message content. Message content is only in `sms_conversations`.

---

## Loyalty and Repeat Customer Tracking

The `contacts` table tracks loyalty metrics automatically via database triggers:

- `completed_bookings_count` — incremented each time an order for this contact reaches `completed` status
- `is_repeat_customer` — set to `true` when `completed_bookings_count >= 2`
- `first_completed_booking_date` — date of first completed order
- `last_completed_booking_date` — date of most recent completed order
- `total_spent_cents` — cumulative spend including custom fees and discounts, updated by trigger

Cancelled orders are excluded from the loyalty calculations. The trigger fires on every `orders` UPDATE, checking the `status` transition to `completed`.

The Business Analytics tab surfaces aggregate repeat customer count and rate across all contacts.

---

## Waiver Reminder and Payment Reminder SMS

The task status system tracks two boolean flags to prevent duplicate reminder messages:

- `waiver_reminder_sent` — set after a waiver reminder SMS is sent to the customer. Prevents the reminder from firing again if the crew marks "arrived" a second time.
- `payment_reminder_sent` — set after a balance payment reminder SMS is sent. Included in the en-route or arrived message if the customer still has an outstanding balance.

These flags are on the `task_status` record and are evaluated during delivery checkpoint SMS sends.
