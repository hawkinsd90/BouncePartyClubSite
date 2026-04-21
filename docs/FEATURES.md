# Features

## Unit Catalog and Inventory

Rentable units (bounce houses, water slides, combos) are stored in the `units` table. Each unit has:

- `name`, `slug` — display name and URL-friendly identifier
- `types` — array of unit types (e.g., `['bounce_house', 'slide']`) for filtering
- `price_dry_cents`, `price_water_cents` — separate pricing for dry and wet mode
- `dimensions`, `dimensions_water` — physical size in dry and wet mode
- `footprint_sqft` — square footage for lot assessment
- `power_circuits` — number of 20-amp circuits required
- `capacity` — max number of riders
- `indoor_ok`, `outdoor_ok` — suitability flags
- `quantity_available` — how many of this unit exist in inventory
- `is_combo` — whether the unit is a combo inflatable

Unit media (`unit_media` table) supports multiple images and videos per unit, with:
- `mode` — `dry` or `wet` (which set-up mode the image shows)
- `visibility_mode` — controls which mode tab the image appears under
- `is_featured` — marks the primary hero image for a unit

Unit images are uploaded to the `unit-images` Supabase storage bucket (admin-only write access).

---

## Quote / Booking Form (`/quote`)

The quote form is a multi-section page where customers configure their rental:

1. **Event Details** — date, event start/end time, pickup preference (same-day vs. next-day)
2. **Address** — Google Places autocomplete; geocoded for travel fee calculation
3. **Setup Details** — location type (residential/commercial), surface type (grass/concrete/indoor), generator need, special details, pets
4. **Cart** — unit selection with availability checking
5. **Summary** — full pricing breakdown before submission

On submission:
1. Blackout dates are checked client-side
2. Unit availability is verified
3. A `draft` order is created in the database via `src/lib/orderCreation.ts`
4. Customer is created or upserted by email
5. An invoice email/SMS is dispatched
6. Customer is redirected to `/checkout/:orderId`

If the customer is logged in, their previous address and contact details are prefilled from `CustomerProfileContext`.

---

## Checkout Page (`/checkout/:orderId`)

The checkout page handles Stripe payment collection. Flow:

1. Customer reviews the order summary
2. Selects a payment amount (deposit, full, or custom via `PaymentAmountSelector`)
3. Adds an optional tip
4. Confirms card-on-file and SMS consent (if not already given)
5. Stripe Checkout Session is created via `stripe-checkout` edge function
6. Customer is redirected to Stripe's hosted checkout page
7. On success, redirects to `/payment-complete` which finalizes the order

### Payment Amount Options

| Option | Description |
|---|---|
| Deposit only | Pay the configured deposit amount now; balance due later |
| Full payment | Pay the entire order total now |
| Custom amount | Pay any amount between deposit and full total |

The customer's selection is recorded in `customer_selected_payment_cents` and `customer_selected_payment_type` on the order.

### Card-on-File (Setup Mode)

If `require_card_on_file` is true on the order, a Stripe setup session is created instead of (or in addition to) a charge session. This saves the card for future charges (deposit, balance) without charging at checkout.

---

## Contacts (Phonebook)

The `contacts` table is a deduplicated phonebook of every person who has ever placed an order. It is separate from `customers` — `customers` is per-order, `contacts` is per-person across all orders.

A contact record is upserted automatically whenever a new order is submitted (matched by email address). Contact statistics are maintained by database triggers:

- `total_bookings` — total completed orders
- `total_spent_cents` — lifetime spend including custom fees and discounts
- `completed_bookings_count`, `first_completed_booking_date`, `last_completed_booking_date`
- `is_repeat_customer` — true if 2+ completed bookings
- `opt_in_sms`, `opt_in_email` — communication preferences
- `tags` — admin-assigned labels
- `business_name` — for commercial customers
- `loyalty_points` — accumulated loyalty points from completed orders
- `loyalty_tier_override` — admin-set tier that overrides the computed tier

Contacts are viewable, searchable, and filterable from the admin Contacts tab. Each contact shows their full order history and allows sending an SMS directly from the conversation thread.

---

## Invoices and Invoice Links

The `invoices` table tracks the financial state of an order from the admin perspective.

Invoice statuses: `draft`, `sent`, `paid`, `partial`, `void`

When an admin approves an order, an invoice is created automatically with the appropriate status based on what was collected.

**Invoice Links** (`invoice_links` table) provide secure tokenized public URLs for customers to view their invoice and access their customer portal without logging in. Each link has two access paths:

- **Full token URL** (`/customer-portal/:orderId?t=:token`) — 64-character hex token; used for email links where length is not a concern.
- **Short URL** (`/i/:shortCode`) — 8-character alphanumeric code; used in SMS messages to keep character counts low.

The `link_type` column on `invoice_links` distinguishes between `invoice` links (created by the `send-invoice` edge function during admin invoice distribution) and `portal_shortlink` links (created by `createShortPortalLink()` in the frontend for crew ETA SMS messages). Both types resolve via the `/i/:shortCode` route (`ShortLink.tsx`) which looks up the short code and redirects to the appropriate customer portal URL.

Links expire via the `expires_at` field. Invoice links default to 3 days after the event date (or 30 days from creation if no event date). Portal shortlinks default to 30 days.

**Admin Invoice Sending** (`send-invoice` edge function) — Admins send invoices to customers by triggering the `send-invoice` edge function from the admin panel (Invoice Builder or order detail workflow). The function:
1. Creates or updates an `invoice_links` record with both a full token and a short code.
2. Dispatches a formatted invoice email with a "View Invoice" button linked to the full token URL.
3. Sends an SMS with the short URL (`/i/:shortCode`) to reduce character count.
Both email and SMS are sent in parallel; a failure of one does not block the other.

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
- Canvas-based signature
- Optional typed name and initials
- Electronic consent acknowledgment

On submission, the `save-signature` edge function:
1. Stores the signature record in `order_signatures` with the full waiver text snapshot, IP address, user agent, and device info
2. Generates a signed PDF and stores it in the `signed-waivers` Supabase storage bucket
3. Sets `waiver_signed_at` and `signed_waiver_url` on the order
4. Returns the PDF URL for display

The `order_signatures` record stores everything needed for a legally defensible audit: signer identity, consent text, waiver version, IP, user agent, and a complete snapshot of the waiver text as it existed at signing time.

---

## Google Maps Integration

Google Maps is used for two purposes:

### Address Autocomplete

The `AddressAutocomplete` component uses the Google Places Autocomplete API to help customers enter their event address. On selection, the address is geocoded and coordinates (lat/lng) are stored on the `addresses` record for travel fee calculation.

The Google Maps SDK is loaded lazily using a singleton loader (`src/lib/googleMapsLoader.ts`) to avoid loading it on pages that don't need it.

### Route Optimization

See the Day-of Workflow section.

---

## Google Reviews

The admin manages customer reviews displayed on the homepage via the admin panel. Reviews are stored in the `google_reviews` table with:

- `reviewer_name`, `reviewer_initial` — display name
- `rating` — 1-5 stars
- `review_text` — the review content
- `review_date` — human-readable date string (e.g., "3 months ago")
- `is_active` — toggle visibility without deleting
- `display_order` — controls sequence

Only real reviews from actual customers should be entered here. The "Read more reviews on Google" button links to the business Google review page configured in admin settings.

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
- Customer details, order history, loyalty stats
- SMS conversation thread per customer

### Invoices Tab
- View and manage all invoices
- Access Invoice Builder for manual invoice creation

### Analytics Tab
- Business performance charts (revenue, bookings, lead time)
- Date range filtering
- Site analytics (page views, funnel conversion)

### Crew Calendar Tab
- Monthly calendar view with confirmed orders
- Day view showing all deliveries and pickups
- Route optimization controls
- Task card management

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
- Waive fees (tax, travel, surface, generator, same-day pickup) with reason

### Payments Tab
- Full payment history
- Record cash or check payments
- Initiate Stripe refund
- Send customer balance payment link
- Issue Stripe refund with reason (admin/master only)

### Workflow Tab
- Status progression controls
- Send customer notifications
- View/send admin message visible to customer in portal
- Manage lot picture requests

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
| Generator fee | `generator_fee_waived` | `generator_fee_waive_reason` |

Waiver reasons are logged in the order changelog for audit purposes.

---

## Custom Fees and Discounts

### Custom Fees (`order_custom_fees`)

Admins can add arbitrary fee line items to any order (e.g., "Extra cleaning fee", "Late cancellation fee"). Each fee has a name and a fixed amount in cents.

### Discounts (`order_discounts`)

Admins can add discounts as either a fixed dollar amount or a percentage. Both are stored on `order_discounts`. Discounts affect the order total and thus the deposit calculation.

### Saved Templates

Frequently-used fees and discounts can be saved as templates (`saved_fee_templates`, `saved_discount_templates`) for quick application without retyping. Managed from the admin Pricing Rules tab.

---

## Day-of Workflow

### Task Order Management

From the Task Detail Modal (accessible from both the admin Calendar tab and the `/crew` page), admins have direct order management controls that do not require navigating to the full order detail:

| Action | When Available | What It Does |
|---|---|---|
| **Record Cash Payment** | Balance due > $0 | Calls `record-cash-payment` edge function; sends receipt email to customer |
| **Record Check Payment** | Balance due > $0 | Calls `record-check-payment` with check number; sends receipt email |
| **Charge Card on File** | Balance due > $0 AND a Stripe card is saved | Charges the saved card for the full remaining balance via `charge-deposit` edge function; sends receipt and booking confirmation email; updates `balance_due_cents` on the order |
| **Mark Waiver Signed (Paper)** | Waiver not yet signed | Creates an `order_signatures` record flagged as paper waiver; sets `waiver_signed_at` on order |
| **Cancel Order** | Order not in terminal state | Shows reason form → refund intent confirmation dialog (with "Yes, Refund Needed" / "No Refund" buttons) → calls `customer-cancel-order` edge function |

The "Charge Card on File" button displays the saved card brand and last four digits (e.g., "Mastercard •••• 1840") so the admin can confirm the correct card before charging.

### Task Cards (`task_status` table)

When an order moves to `confirmed`, a database trigger automatically creates a `task_status` record for that order. Each task card tracks:

- `task_type` — `delivery` or `pickup`
- `task_date` — the event date
- `status` — workflow progress (pending → on_the_way → arrived → setup_in_progress → setup_completed)
- `en_route_time`, `arrived_time`, `completed_time` — timestamps
- `eta_sent` — whether an ETA SMS has been sent to the customer
- `waiver_reminder_sent`, `payment_reminder_sent` — notification flags
- `sort_order` — position in the day's route
- `delivery_images`, `damage_images` — arrays of image URLs
- `notes` — crew notes on the task
- `gps_lat`, `gps_lng` — crew GPS at task completion
- `calculated_eta_minutes` — drive time estimate from route optimization

Crew see these cards in the Calendar view and can update status, add photos, and log their location.

### Route Optimization (`src/lib/routeOptimization.ts`)

Admins and crew optimize the day's delivery route from the calendar day view. The algorithm runs client-side using the Google Maps Distance Matrix API.

**Three-stage pipeline:**

1. **Geographic Sweep** — sorts stops by compass angle from home base to cluster nearby stops
2. **Multi-Start Greedy** — tests up to 8 starting points using nearest-neighbor; picks lowest-scoring route
3. **2-Opt Refinement** — iteratively swaps stop pairs (up to 100 iterations) to reduce total drive time

**Scoring factors:**
- Drive duration in minutes
- Lateness penalty (100× multiplier for arriving after event start time)
- Early event priority bonus
- Equipment dependency enforcement (pickup stops must follow drop-off stops for the same unit)

**Setup times:** 20 minutes per unit for delivery setup; 15 minutes for pickups.

**Traffic modeling:** 6:20 AM departure with Google Maps live traffic data.

The optimized route is saved to `route_stops` and displayed on the calendar with arrival time estimates and lateness warnings.

### Crew Location Tracking

The `crew_location_history` table stores GPS breadcrumbs from crew during active deliveries. Each record captures latitude, longitude, accuracy, speed, heading, and a checkpoint label. The admin can monitor crew progress in real time.

### Mileage Tracking

Crew log start/end odometer readings via the Mileage Modal in the calendar. Readings are stored in `daily_mileage_logs` with start/end time, user ID, and optional notes. The `calculate-route-mileage` edge function can also compute theoretical route mileage from the optimized route for comparison.

### Equipment Checklist

The Equipment Checklist Modal allows crew to mark off equipment conditions before/during delivery (inflatable condition, blower status, stakes, sandbags, water connections). This is accessed from the task card in the day view.

### Lot Pictures

Crew can photograph the event lot before setup (to document condition) and after setup (for customer confirmation). Photos are stored in the `order_lot_pictures` table and the `lot-pictures` Supabase storage bucket. Customers can view these photos in their Customer Portal.

The admin can request lot pictures from a confirmed order (sets `lot_pictures_requested` flag and timestamp). Customers are notified when pictures are available.

---

## Customer Portal (`/customer-portal`)

The customer portal is a public-facing, tokenized view that does not require login. Customers access it via a unique link sent in their confirmation email/SMS.

### Short Link Access (`/i/:shortCode`)

The portal can also be reached via a compact short URL (`/i/:shortCode`). The `ShortLink` page resolves the 8-character code by querying the `invoice_links` table and redirects to `/customer-portal/:orderId?t=:token`. This URL form is used in SMS messages to stay within character limits. Short links expire after the `expires_at` date stored on the `invoice_links` record.

### Regular Portal View

Shows the customer:
- Order status and event details
- Invoice and pricing breakdown
- Payment options (if balance is due)
- Lot pictures (submitted by crew after setup)
- Delivery tracking (crew ETA and live location)
- Link to sign the waiver
- Order cancellation option

### Order Approval View

When the admin modifies a confirmed order and sends it for customer review, the portal displays:
- What changed (item additions/removals, price changes, date changes)
- New pricing breakdown
- Approve or Reject buttons

Approval atomically confirms the changes and moves the order back to `confirmed`. Rejection logs the rejection and notifies the admin. Both happen without login via an atomic RPC function.

### Payment Tab

Customers with an outstanding balance can pay via:
- Saved card on file (processed by `customer-balance-payment` edge function)
- The customer can update their card if the saved card is declined (via `fix-payment-method` edge function)

### Lot Pictures Tab

Displays photos uploaded by the crew, visible to the customer after setup is complete.

### Customer Cancellation

Customers can cancel their own order from the portal. They select a cancellation reason and can optionally request a refund. The `customer-cancel-order` edge function records:
- `cancellation_reason` — selected from a standardized list
- `cancelled_at`, `cancelled_by` timestamps
- `refund_requested` — whether the customer wants a refund (admin must still process manually)

---

## Customer Dashboard (`/my-orders`)

Logged-in customers can view all their orders with status, payment status, and quick links to:
- Customer portal
- Waiver signing
- Payment
- Receipt download

---

## SMS Conversations

Each customer phone number has a dedicated `sms_conversations` record. Inbound and outbound messages are stored in the `messages` table.

Admins view and reply to SMS threads directly from the order detail SMS tab. The `twilio-webhook` edge function handles inbound messages and routes them to the correct conversation by phone number.

**Message Templates** (`sms_message_templates` table) are managed in the admin Message Templates tab. Variables like `{{customer_name}}`, `{{order_id}}`, `{{event_date}}`, `{{portal_link}}`, `{{google_review_url}}` are substituted at send time.

---

## Hero Carousel

The homepage features a media carousel managed through the admin panel. The `hero_carousel_images` table stores image and video entries with:
- `media_type` — `image` or `video`
- `storage_path` — path in `carousel-media` Supabase storage bucket
- `display_order` — controls sequence
- `is_active` — toggles visibility without deleting
- `title`, `description` — optional overlay text

---

## Blackout System

Admins can block orders from the Blackout tab using three types of restrictions:

### Blackout Dates

Prevent new orders on specified date ranges. Supports:
- `block_type`: `full` (no orders) or `same_day_pickup_only` (allows next-day pickups)
- `recurrence`: `one_time`, `annual`, or `weekly`
- `expires_at`: optional expiration date for temporary blocks

The `check_date_blackout` database function is called by both the client-side quote form and the server-side `stripe-checkout` edge function. The server-side check cannot be bypassed.

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

Branding is loaded by `BusinessContext` and used throughout the app for display and in email templates.

---

## Admin Analytics

### Business Analytics Tab

Revenue and booking performance charts with configurable date ranges:
- Total revenue by month
- Booking count by month
- Average order value
- Average lead time (days between booking and event)
- Top units by booking frequency
- Revenue by unit

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

---

## Admin Settings / Configuration

All runtime configuration is stored in the `admin_settings` key-value table and managed through the admin Settings tabs. Key groups:

| Key Prefix | What It Stores |
|---|---|
| `business_*` | Business name, address, phone, email, website, legal entity, license |
| `branding_*` | Logo URL, favicon URL, brand color |
| `social_*` | Social media URLs |
| `stripe_*` | Stripe secret key, publishable key, webhook secret |
| `twilio_*` | Twilio Account SID, Auth Token, From Number |
| `resend_*` | Resend API key for email |
| `google_*` | Google Maps API key, Google Review URL, Google Calendar credentials |
| `admin_*` | Admin email, admin phone number |

Secret values (Stripe keys, Twilio credentials) are redacted in the `admin_settings_changelog` by a database trigger — the trigger substitutes `[REDACTED]` before logging.

---

## Google Calendar Sync

Confirmed orders can be synced to a Google Calendar. When an order is confirmed:

1. A record is added to the `google_calendar_sync_queue` table
2. The `sync-google-calendar` edge function processes the queue
3. A calendar event is created/updated with order details
4. Sync status is tracked in `google_calendar_sync` per event date

Configuration (Google OAuth credentials) is managed in the admin Google Calendar Settings tab.

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

## Saved Fee and Discount Templates

Admins can save frequently-used fees and discounts as templates:
- `saved_fee_templates` — named fee amounts for quick application (e.g., "Extra cleaning fee: $50")
- `saved_discount_templates` — named discounts with fixed amount or percentage (e.g., "Repeat customer: 10%")

These appear as quick-select options when adding fees/discounts to an order, avoiding manual reentry.

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

## Address Deduplication

Addresses are stored as canonical records in the `addresses` table with a unique `address_key` for deduplication. When the same address is submitted twice, the existing record is returned rather than creating a duplicate. Coordinates (lat/lng) are stored for travel fee and distance calculations.

The `addressService.ts` library provides `upsertCanonicalAddress()` which handles the create-or-find logic.

---

## Menu Preview (`/menu-preview`)

A printable catalog page showing all active units with photos, dimensions, pricing, and capacity. Used for in-person sales or as a PDF handout. Accessible without login.
