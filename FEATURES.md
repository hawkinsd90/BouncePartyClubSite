# Features

## Contacts (Phonebook)

The `contacts` table is a deduplicated phonebook of every person who has ever placed an order. It is separate from the `customers` table — `customers` is per-order, `contacts` is per-person across all orders.

A contact record is created or updated automatically whenever a new order is submitted. Matching is done by email address.

Each contact record aggregates:

- `total_bookings` — number of completed orders
- `total_spent_cents` — lifetime spend including custom fees and discounts
- `loyalty_tier` — derived from booking history (bronze, silver, gold, etc.)

Contacts are viewable and searchable from the admin Contacts tab. Clicking a contact shows their full order history and allows sending an SMS directly from the conversation thread.

---

## Invoices and Invoice Links

The `invoices` table tracks the financial state of an order from the admin perspective.

Invoice statuses: `draft`, `sent`, `paid`, `partial`, `void`

When an admin approves an order, an invoice is created automatically with the appropriate status based on what was collected.

**Invoice Links** (`invoice_links` table) provide secure, tokenized public URLs for customers to view their invoice without logging in. Each link contains a signed token and is generated when the invoice is created or sent. The `/invoice/:token` route resolves the token and renders the invoice.

Admins can also use the Invoice Builder to manually construct invoices with custom line items, fees, and discounts, then send them directly to a customer.

---

## Electronic Waiver System

Every order requires a signed waiver before the rental takes place. The waiver is ESIGN/UETA compliant.

### Waiver Content (`src/lib/waiverContent.ts`)

The waiver text is generated dynamically using business settings (name, legal entity, address, phone, email) pulled from the `admin_settings` table. Sections include:

1. Acknowledgment and Assumption of Risk
2. Waiver and Release of Liability
3. Indemnification
4. Renter's Responsibility
5. Equipment Condition and Inspection
6. Cancellations and Refunds (72-hour cancellation policy)

The waiver is versioned (`version: 1.0`) to allow future updates to be tracked per signature.

### Signing Flow (`/sign/:orderId`)

The `/sign/:orderId` route renders the `Sign` page, which uses components in `src/components/waiver/`:

- `RentalTerms` — displays the full waiver text
- `SignaturePad` — canvas-based signature input
- `WaiverTab` — orchestrates the flow

When the customer signs, the `save-signature` edge function is called with:

- Required: `orderId`, `customerId`, `renterName`, `renterPhone`, `renterEmail`, `eventDate`, full event address, `signatureDataUrl`, `waiverVersion`, `waiverText`, `electronicConsentText`
- Optional: `initialsData`, `typedName`, home address, `eventEndDate`

The signature data URL and waiver text are saved to `order_signatures`. A signed PDF is generated and stored in the `signed-waivers` Supabase storage bucket. The order's `waiver_signed_at` timestamp is updated.

---

## Google Maps Integration

Google Maps is used for two purposes:

### Address Autocomplete

The `AddressAutocomplete` component (`src/components/order/AddressAutocomplete.tsx`) uses the Google Places Autocomplete API to help customers enter their event address. The API key is set via `VITE_GOOGLE_MAPS_API_KEY`.

On selection, the address is geocoded and coordinates (lat/lng) are stored on the `addresses` record. These coordinates are used for travel fee calculation.

The Google Maps SDK is loaded lazily using a singleton loader (`src/lib/googleMapsLoader.ts`) to avoid loading it on pages that don't need it.

### Route Optimization

See the Route Optimization section below.

---

## Google Reviews

The admin can configure a Google Review URL in admin settings. This URL is sent to customers in post-pickup SMS messages, prompting them to leave a review. The `sms_message_templates` table stores the template text and the URL is substituted at send time.

---

## Day-of Workflow

### Task Cards (`task_status` table)

When an order moves to `confirmed`, a trigger automatically creates a `task_status` record (a "task card") for that order on the event date. Crew members see these cards in the calendar and day-of views.

Each task card tracks:
- Crew assignment
- Workflow status (independent of order status)
- ETA fields
- Equipment checklist completion

### Route Optimization (`src/lib/routeOptimization.ts`)

Admins and crew can optimize the day's delivery route from the calendar view. The algorithm runs entirely client-side using the Google Maps Distance Matrix API.

**Three-stage pipeline:**

1. **Geographic Sweep** — sorts stops by compass angle from the home base (Wayne, MI) to group nearby stops.
2. **Multi-Start Greedy** — tests up to 8 starting points using a nearest-neighbor algorithm. Picks the route with the lowest total score.
3. **2-Opt Refinement** — iteratively swaps pairs of stops (up to 100 iterations) to reduce total drive time.

**Scoring factors:**
- Drive duration in minutes
- Lateness penalty (100× multiplier for arriving after event start)
- Early event priority bonus (events starting before 9 AM)
- Equipment pickup/dropoff dependency enforcement

**Setup times:** 20 minutes per unit for setup, 15 minutes for pickups.

**Traffic modeling:** Uses a 6:20 AM departure time with Google Maps traffic data.

The optimized route is saved to the `route_stops` table and displayed on the calendar with arrival time estimates and lateness indicators.

### Crew Location Tracking

The `crew_location_history` table stores GPS coordinates submitted by crew members during active deliveries. This provides a live breadcrumb trail for the admin to monitor crew progress.

### Mileage Tracking

After completing the day's route, crew can log total mileage via the Mileage Modal in the calendar. This records gas mileage data for expense tracking.

---

## SMS Conversations

Each customer phone number has a dedicated `sms_conversations` record. Inbound and outbound SMS messages are stored in the `messages` table linked to the conversation.

Admins can view and reply to SMS threads directly from the order detail view. The Twilio webhook (`twilio-webhook` edge function) handles inbound messages and routes them to the correct conversation.

Message templates (`sms_message_templates` table) can be created and managed in the admin Message Templates tab. Templates support variable substitution (order ID, customer name, event date, etc.).

---

## Hero Carousel

The homepage features a media carousel managed through the admin panel. The `hero_carousel_images` table stores image and video entries. Media files are uploaded to the `carousel-media` Supabase storage bucket.

Each carousel entry has:
- `media_url` — public URL of the image or video
- `media_type` — `image` or `video`
- `display_order` — controls sequence
- `is_active` — toggles visibility without deleting

---

## Blackout Dates

Admins can block dates, addresses, or contacts from the Blackout tab.

- **Blackout Dates** — prevent any new orders from being placed on specified dates. Supports recurring patterns (weekly, monthly) and expiration dates.
- **Blackout Addresses** — block specific delivery addresses (e.g., difficult venues or locations with past issues).
- **Blackout Contacts** — block specific customers by email or phone from placing new orders.

Blackout enforcement runs at two levels: client-side during the quote form (prevents date selection) and server-side via RPC (`check_date_blackout`) during order submission.

---

## Customer Portal (`/customer-portal`)

The customer portal is a public-facing, token-authenticated view that does not require login. Customers access it via a unique link sent in their confirmation email.

The portal shows:
- Order status and timeline
- Invoice and pricing breakdown
- Payment options (if balance is due)
- Lot pictures (submitted by crew after setup)
- Delivery tracking (crew ETA and location)
- Waiver signing link
- Order cancellation option

When changes are made to a confirmed order (pricing adjustments, item changes), the order status moves to `awaiting_customer_approval`. The portal shows an approval/rejection interface so the customer can accept or decline the changes without logging in.
