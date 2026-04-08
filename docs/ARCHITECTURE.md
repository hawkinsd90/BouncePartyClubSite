# Architecture

## Overview

The application is a React single-page app backed entirely by Supabase (Postgres database + Deno edge functions). There is no separate API server. All business logic runs either in the browser or in Supabase edge functions. The frontend communicates with the database through the Supabase JS client and through edge function HTTP calls.

---

## Provider Stack

`App.tsx` wraps the entire application in a nested provider hierarchy. Order matters — inner providers can consume outer ones.

```
ErrorBoundary
  BrowserRouter
    BusinessProvider       — loads admin_settings into context (business name, address, etc.)
      AuthProvider         — manages user session, roles, OAuth, consent draining
        CustomerProfileProvider  — loads customer profile data for logged-in customers
          Routes / Pages
```

---

## Routing

Routes are defined in `App.tsx` using React Router v6. Components are lazy-loaded to minimize initial bundle size.

### Public Routes (no auth required)

| Path | Page |
|---|---|
| `/` | Home |
| `/catalog` | Unit catalog |
| `/units/:id` | Unit detail |
| `/quote` | Quote / booking form |
| `/checkout/:orderId` | Checkout (Stripe payment) |
| `/payment-complete` | Post-payment confirmation |
| `/payment-canceled` | Payment canceled |
| `/invoice/:token` | Customer invoice view |
| `/customer-portal` | Customer self-service portal (uses query params, not auth) |
| `/receipt/:orderId/:paymentId` | Payment receipt |
| `/sign/:orderId` | Electronic waiver signing |
| `/menu-preview` | Unit menu (printable) |
| `/login` | Login |
| `/signup` | Sign up |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset form |
| `/setup` | First-time admin setup |
| `/contact` | Contact page |
| `/about` | About page |

### Protected Routes

| Path | Required Role(s) |
|---|---|
| `/my-orders` | customer, admin, crew, master |
| `/admin` | admin, master |
| `/admin/inventory/*` | admin, master |
| `/crew` | admin, crew, master |
| `/crew/*` | admin, crew, master |

`ProtectedRoute` in `src/components/common/ProtectedRoute.tsx` handles enforcement. Unauthenticated users are redirected to `/login`. Authenticated users without the required role see an "Access Denied" screen.

---

## Database Tables

All 34 tables in the `public` schema:

| Table | Purpose |
|---|---|
| `addresses` | Canonical address records with lat/lng geocoding |
| `admin_settings` | Key-value store for all runtime configuration |
| `admin_settings_changelog` | Audit log of settings changes (secrets redacted) |
| `auth_trigger_logs` | Debugging log for auth trigger execution |
| `consent_records` | SMS marketing and card-on-file consent per customer |
| `contacts` | Phonebook — one record per unique customer across all bookings |
| `crew_location_history` | GPS breadcrumbs from crew members during deliveries |
| `customer_profiles` | Extended profile data linked to auth users |
| `customers` | Customer records linked to orders (name, email, phone) |
| `documents` | General document storage |
| `hero_carousel_images` | Homepage carousel media (images and videos) |
| `invoice_links` | Secure tokenized links for customer invoice access |
| `invoices` | Invoice records with status tracking |
| `messages` | SMS conversation messages |
| `order_changelog` | Full audit trail of order status changes and actions |
| `order_custom_fees` | Admin-added custom line items on an order |
| `order_discounts` | Discount line items applied to an order |
| `order_items` | Units (bounce houses) included in an order |
| `order_notes` | Internal admin notes on an order |
| `order_refunds` | Refund records linked to Stripe refund IDs |
| `order_signatures` | Electronic waiver signature records |
| `order_workflow_events` | Crew workflow events (arrived, setup complete, etc.) |
| `orders` | The central order record — all bookings live here |
| `payments` | Payment records (Stripe, cash, check) |
| `pricing_rules` | Pricing configuration for zones, multipliers, fees |
| `route_stops` | Ordered delivery/pickup stops for a day's route |
| `saved_discount_templates` | Saved discount presets for admin reuse |
| `saved_fee_templates` | Saved custom fee presets for admin reuse |
| `sms_conversations` | Inbound/outbound SMS thread per customer phone |
| `sms_message_templates` | Admin-managed SMS message templates |
| `task_status` | Crew task cards — one per order per day |
| `unit_media` | Images and videos for each rentable unit |
| `units` | Inventory — each bounce house / water slide / combo |
| `user_roles` | Role assignments (master, admin, crew, customer) |

---

## Query Layer

All database calls go through the centralized query layer in `src/lib/queries/`. Direct Supabase client calls in components or hooks are avoided.

### `executeQuery<T>()` — `src/lib/queries/base.ts`

Every query is wrapped in this function:

```typescript
executeQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: any }>,
  context?: string,
  options?: { throws?: boolean }
): Promise<{ data: T | null; error: any }>
```

It standardizes error logging, optional throwing, and returns a consistent `{ data, error }` shape.

### Query Modules

| Module | File | Exports |
|---|---|---|
| Orders | `queries/orders.ts` | `getOrderById`, `getAllOrders`, `getOrdersByStatus`, `updateOrderStatus`, etc. |
| Customers | `queries/customers.ts` | `getCustomerByEmail`, `getOrCreateCustomer`, `updateCustomer`, etc. |
| Contacts | `queries/contacts.ts` | Contact phonebook operations |
| Units | `queries/units.ts` | Inventory queries |
| Pricing | `queries/pricing.ts` | `pricing_rules` table access |
| Payments | `queries/payments.ts` | Payment record queries |
| Invoices | `queries/invoices.ts` | Invoice and invoice link queries |
| Tasks | `queries/tasks.ts` | `task_status` table queries |
| Admin Settings | `queries/admin-settings.ts` | Key-value settings reads/writes |

### Standard Select Shapes

Two reusable select strings are defined in `base.ts`:

- **`STANDARD_ORDER_SELECT`** — Full nested join: customers, addresses, order_items with units, payments, discounts, custom_fees. Used wherever a complete order object is needed.
- **`COMPACT_ORDER_SELECT`** — Minimal join: customers and addresses only. Used in list views.

---

## Order Status Model

Orders move through two independent status dimensions:

### Order Status (`src/lib/constants/statuses.ts`)

```
draft → pending_review → awaiting_customer_approval → confirmed → in_progress → completed
                                                                              → cancelled
                                                                              → void
```

| Status | Meaning |
|---|---|
| `draft` | Created by admin or customer, not yet submitted |
| `pending_review` | Customer submitted, awaiting admin action |
| `awaiting_customer_approval` | Admin sent back changes for customer review |
| `confirmed` | Admin approved, deposit charged or waived |
| `in_progress` | Crew is actively delivering/setting up |
| `completed` | Event finished, pickup done |
| `cancelled` | Cancelled by admin or customer |
| `void` | Administratively voided (no charge) |

### Workflow Status (crew operations)

```
pending → on_the_way → arrived → setup_in_progress → setup_completed
        → pickup_scheduled → pickup_in_progress → completed
```

This tracks the crew's physical progress on event day, independent of the order lifecycle status.

### Payment Status (derived)

Computed from order amounts, not stored directly:

- `payment_due` — No deposit collected
- `deposit_paid` — Deposit collected, balance remaining
- `paid_in_full` — Full balance collected

---

## All-Cents Convention

Every monetary value in the database and throughout the codebase is stored in **cents** (integer). There are no decimal dollar amounts in the data layer. Display formatting is handled at the UI layer only.

---

## Database Migrations

Migrations live in `supabase/migrations/` and are ordered by timestamp prefix. They are applied sequentially. Each migration file begins with a multi-line comment block summarizing the change in plain English.

When adding a new migration:

1. Create a file named `YYYYMMDDHHMMSS_short_description.sql`
2. Begin the file with a `/* */` comment block describing: what changed, why, new tables/columns, security notes
3. Use `IF EXISTS` / `IF NOT EXISTS` guards on all DDL statements
4. Every new table must have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` immediately after creation
5. Never use `DROP` on columns or tables — add nullable columns or use soft-delete patterns
6. Never use `BEGIN` / `COMMIT` / `ROLLBACK` — Supabase migrations run in auto-commit mode (PL/pgSQL `DO $$ BEGIN ... END $$` blocks are fine)

---

## Edge Functions

Edge functions live in `supabase/functions/`. Each function is a standalone Deno module. Shared utilities live in `supabase/functions/_shared/`.

### Shared Utilities (`_shared/`)

| File | Purpose |
|---|---|
| `cors.ts` | Standard CORS headers for all responses |
| `admin-settings.ts` | Helper to read `admin_settings` key-value table |
| `format-order-id.ts` | Canonical order ID formatting |
| `payment-validation.ts` | Shared payment amount validation |
| `rate-limit.ts` | Per-identifier rate limiting |
| `transaction-logger.ts` | Transaction receipt logging |
| `webhook-idempotency.ts` | Stripe webhook deduplication |

All edge functions handle CORS preflight (`OPTIONS`) requests and include CORS headers on every response.

---

## Pricing Calculation

Pricing is computed in `src/lib/pricing.ts` using rules fetched from the `pricing_rules` table.

**Calculation order:**

1. Day 1 subtotal (sum of unit prices × location multiplier)
2. Extra day charges (additional days × `extra_day_pct` % of day 1 rate)
3. Travel fee (see `travelFeeCalculator.ts`)
4. Surface fee (cement or unstaked grass)
5. Same-day pickup fee (commercial bookings or non-overnight returns)
6. Generator fee (single unit vs. multiple unit rate)
7. Tax (6% of subtotal + travel + surface + generator, if enabled)
8. Deposit / balance split

### Travel Fee Zones (`src/lib/travelFeeCalculator.ts`)

Three-tier lookup, evaluated in order:

1. **ZIP code zone override** — flat fee for specific ZIP codes
2. **Free cities list** — zero travel fee for listed cities (case-insensitive)
3. **Distance-based** — per-mile charge beyond the base radius from home base (Wayne, MI)

---

## Availability Checking

`src/lib/availability.ts` provides:

- `checkDateBlackout(startDate, endDate)` — RPC call to check admin-defined blackout dates
- `checkUnitAvailability(unitId, startDate, endDate, excludeOrderId?)` — checks for conflicting orders
- `checkMultipleUnitsAvailability(...)` — batched version with RPC deduplication

Orders in these statuses block availability: `pending_review`, `awaiting_customer_approval`, `confirmed`, `in_progress`, `completed`.

---

## Error Handling

`src/lib/errorHandling.ts` provides a centralized error layer:

- `AppError` — custom error class with `code` and `statusCode`
- `handleError(error, context)` — logs, reports to error reporter, shows user toast notification
- `withErrorHandling(fn)` — try/catch wrapper returning `T | null`
- `queryWithErrorHandling(query, options)` — wraps Supabase queries with optional silent mode

Supabase-specific error codes are mapped to user-friendly messages (e.g., PGRST116 → "No data found", 23505 → "Record already exists").
