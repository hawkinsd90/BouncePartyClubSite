# Crew and Operations

## Overview

The crew operations system handles everything that happens on the day of an event: delivery routing, task tracking, location monitoring, mileage logging, lot documentation, and customer communication. Crew members access these features through the `/crew` route.

---

## Crew Access

Users with the `crew` role (or `admin`/`master`) can access the crew page at `/crew`. The crew page does not display financial information — it shows only operational task data.

---

## Task Cards (`task_status` table)

A task card is the fundamental unit of crew work. One task card is created automatically by a database trigger when an order moves to `confirmed`.

### Task Card Fields

| Field | Purpose |
|---|---|
| `order_id` | Which order this task is for |
| `task_type` | `delivery` or `pickup` |
| `task_date` | The event date |
| `status` | Current workflow state |
| `en_route_time` | When crew marked "on the way" |
| `arrived_time` | When crew marked "arrived" |
| `completed_time` | When crew marked "completed" |
| `eta_sent` | Whether an ETA SMS was sent to customer |
| `waiver_reminder_sent` | Whether a waiver reminder was sent |
| `payment_reminder_sent` | Whether a payment reminder was sent |
| `sort_order` | Position in the optimized route |
| `delivery_images` | JSON array of delivery photo URLs |
| `damage_images` | JSON array of damage photo URLs |
| `notes` | Crew notes for this task |
| `gps_lat`, `gps_lng` | Crew GPS coordinates at task completion |
| `calculated_eta_minutes` | Estimated drive time from route optimization |
| `eta_calculation_error` | Error message if ETA calculation failed |

### Task Workflow States

```
pending → on_the_way → arrived → setup_in_progress → setup_completed
        ↘ pickup_scheduled → pickup_in_progress → completed
```

Crew advance the state by tapping status buttons in the day view. Each transition timestamps the event (`en_route_time`, `arrived_time`, etc.).

### Real-Time Updates

Task status changes are broadcast via Supabase Realtime. Both the crew page and the customer portal listen for updates, enabling live tracking without manual refreshes.

---

## Crew Calendar (`/crew` and `/admin` Calendar Tab)

The calendar provides a monthly overview and a day-level detail view.

### Month View

- Displays confirmed order count per day
- Color indicators for days with events
- Click a day to open the Day View

### Day View (`DayViewModal`)

Shows all task cards for the selected date:
- Task cards sorted by `sort_order` (optimized route order)
- Each card shows: customer name, address, units, setup window, workflow status
- Crew can advance task status, add notes, and upload photos
- Admin can see ETA information and crew progress

---

## Route Optimization (`src/lib/routeOptimization.ts`)

### Purpose

Given a day's orders, calculates the most efficient delivery sequence to minimize total drive time and avoid arriving late to any event.

### Algorithm

**Stage 1: Geographic Sweep**
- Calculates compass bearing from home base (Wayne, MI) to each delivery address
- Sorts stops by bearing angle to group geographically nearby stops

**Stage 2: Multi-Start Greedy**
- Starts from up to 8 different initial stops
- For each starting point, uses nearest-neighbor algorithm (always go to closest unvisited stop next)
- Evaluates total score for each candidate route
- Keeps the route with the lowest score

**Stage 3: 2-Opt Refinement**
- Takes the best route from Stage 2
- Iteratively tries all possible pair swaps (reverse a segment of the route)
- Accepts swaps that reduce total score
- Runs up to 100 iterations or until no improvement found

### Scoring Function

Each route is scored by summing across all stops:
- **Drive duration** (minutes from Google Maps)
- **Lateness penalty**: if arrival time > event start time, add `drive_minutes × 100`
- **Early event bonus**: negative score bonus for events starting at 9 AM or earlier (prioritizes early delivery)
- **Equipment dependency**: pickup stops for a unit must come after the delivery stop (enforced as hard constraint)

### Time Modeling

- Fixed departure: **6:20 AM** from home base
- Traffic modeling: Google Maps Distance Matrix with departure time set to 6:20 AM
- Setup time per unit: **20 minutes** (delivery)
- Pickup time: **15 minutes** per stop
- Cumulative arrival times are computed forward from 6:20 AM

### Google Maps Distance Matrix API

- Chunks requests to stay within the 100-element limit (origins × destinations per request)
- Returns driving duration in seconds, converted to minutes
- Also returns distance in meters, converted to miles

### Output

The optimized route is saved to the `route_stops` table. Each stop record has:
- `order_id` — which order
- `type` — `delivery` or `pickup`
- `eta` — computed estimated arrival time
- `sort_order` — position in optimized sequence
- `calculated_eta_minutes` — drive time from previous stop
- `calculated_eta_distance_miles` — distance from previous stop
- `eta_calculated_at` — when this was last computed

---

## Route Management Modal (`RouteManagementModal`)

The admin/crew can view and interact with the day's route:
- Displays stops in optimized order with ETAs
- Shows lateness warnings (red indicator if ETA is after event start)
- Run optimization button triggers the 3-stage algorithm
- Manual reorder (drag-and-drop) overrides the optimized order
- "Send ETA" button sends each customer an SMS with their crew's estimated arrival time

---

## Crew Location Tracking

### GPS Submissions

Crew can submit their current GPS location from the crew page. Submissions are stored in `crew_location_history`:
- `latitude`, `longitude` — GPS coordinates
- `accuracy` — GPS accuracy in meters
- `speed` — speed in m/s
- `heading` — compass heading
- `checkpoint` — label for this submission (e.g., "en_route", "arrived")
- `order_id` — which order (if applicable)
- `stop_id` — which route stop

### ETA Calculation

When a crew member marks "on the way," the system can calculate a real-time ETA using their current GPS location and the Google Maps Distance Matrix API. This ETA is stored on the `task_status` record and can be sent to the customer via SMS.

---

## Mileage Tracking

### Daily Mileage Logs (`daily_mileage_logs`)

Each crew member can log odometer readings for a day's work:
- `date` — the work date
- `user_id` — which crew member
- `start_mileage` — odometer at start of shift
- `end_mileage` — odometer at end of shift
- `start_time`, `end_time` — shift times
- `notes` — optional notes

### Route Mileage Calculation

The `calculate-route-mileage` edge function computes the theoretical total miles for the day's route based on the `route_stops` sequence. This can be compared against actual odometer readings.

Accessed via the Mileage Modal in the calendar day view.

---

## Equipment Checklist (`EquipmentChecklistModal`)

Crew access the checklist from the task card in the day view. The checklist covers:
- Inflatable condition (no holes, seams intact, clean)
- Blower status (working, connections tight)
- Stakes available (if applicable)
- Sandbags available (for hard surfaces)
- Water connections (for water slides)

Checklist state is tracked per task. Incomplete checklists can trigger warnings before a task is marked complete.

---

## Lot Pictures

### Uploading

Crew upload lot photos from the task card or via the `LotPicturesTab` in the customer portal section:
- Photos are uploaded to the `lot-pictures` Supabase storage bucket
- Each photo creates a record in `order_lot_pictures`:
  - `file_path` — path in storage bucket
  - `file_name` — original filename
  - `notes` — optional caption
  - `uploaded_by` — crew member user ID
  - `uploaded_at` — timestamp

### Customer Visibility

Customers can view lot pictures in the Customer Portal's "Lot Pictures" tab. Pictures are displayed after crew uploads them.

### Admin Requesting Lot Pictures

Admins can request lot pictures from the Order Detail Modal Workflow tab. This sets:
- `lot_pictures_requested = true` on the order
- `lot_pictures_requested_at` timestamp

The request can trigger a reminder SMS to the crew.

---

## Crew SMS Communications

### ETA Messages

When crew marks "en route," an ETA SMS is sent to the customer using the `eta_customer` SMS template. The message includes the estimated arrival time. The `eta_sent` flag on `task_status` prevents duplicate sends.

### Checkpoint Messages

Certain task status transitions trigger automatic SMS to the customer:
- "On the way" → ETA message
- "Arrived" → Arrival notification
- "Setup complete" → Setup confirmation

Templates are managed in the admin Message Templates tab.

### Post-Pickup Google Review Request

After pickup is complete, an SMS is sent to the customer requesting a Google Review. The template includes the `google_review_url` from admin settings. The `add_google_review_to_pickup` setting controls whether this message is sent.

---

## Task Detail Order Management

From the Task Detail Modal, admins have direct order management controls without leaving the calendar view. The Order Management section (`TaskDetailOrderManagement`) surfaces actions that are relevant on the day of the event:

| Action | When Available | What It Does |
|---|---|---|
| **Record Cash Payment** | Balance due > $0 | Calls `record-cash-payment` edge function; atomically creates payment record, updates `balance_paid_cents`, logs to changelog, sends receipt email |
| **Record Check Payment** | Balance due > $0 | Calls `record-check-payment` edge function; requires check number; same atomic flow as cash |
| **Charge Card on File** | Balance due > $0 AND Stripe card saved | Calls `charge-deposit` edge function with `selectedPaymentType: 'balance'`; charges off-session, sends receipt, updates `balance_due_cents` |
| **Mark Waiver Signed (Paper)** | Waiver not yet signed | Creates `order_signatures` record marking it as paper-signed; sets `waiver_signed_at` on order |
| **Cancel Order** | Order not in terminal state | Opens reason form → refund-intent confirmation modal ("Yes, Refund Needed" / "No Refund") → calls cancellation flow; refund flag is informational only, no automatic charge |

The card details (brand and last four digits) displayed on the "Charge Card on File" button come from `payment_method_brand` and `payment_method_last_four` on the order, populated from the `Task` object's `paymentMethodBrand` and `paymentMethodLastFour` fields.

---

## Crew Invoice Builder (`CrewInvoiceBuilder`)

Crew members can generate simplified invoices for on-site payment collection. Accessible from the crew task detail view. Provides a stripped-down invoice interface focused on collecting balance payments without exposing full admin functionality.

---

## Real-Time Subscriptions

The crew page uses Supabase Realtime to subscribe to changes in:
- `task_status` — task card updates (status, photos, notes)
- `route_stops` — route and ETA updates
- `order_pictures` — new photo uploads

Changes broadcast instantly to all connected crew devices without requiring a page refresh.

---

## Admin Floating Order Header (`AdminFloatingOrderHeader`)

When viewing task details from the admin calendar, a floating header shows:
- Order ID and status badge
- Customer name and phone
- Quick links to the full order detail modal
- Payment status indicator

This allows admins to quickly navigate between the operational calendar view and the financial order management view.
