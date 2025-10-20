# Bounce Party Club - Database Documentation

**Version:** 1.0
**Last Updated:** October 14, 2025
**Database:** PostgreSQL via Supabase

---

## Overview

Complete database schema for the Bounce Party Club party rental management system. This database handles customers, inventory, bookings, payments, crew coordination, and communications.

---

## Core Tables

### customers
**Purpose:** Central customer database for all bookings

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Primary key |
| first_name | text | Yes | Customer first name |
| last_name | text | Yes | Customer last name |
| email | text | Yes | Unique email address |
| phone | text | Yes | Contact phone number |
| created_at | timestamptz | Yes | Account creation date |

**Indexes:** Primary key on `id`, Unique on `email`

---

### addresses
**Purpose:** Delivery and pickup locations with geocoding for distance calculations

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Primary key |
| customer_id | uuid | No | Foreign key to customers |
| line1 | text | Yes | Street address line 1 |
| line2 | text | No | Apartment, suite, etc. |
| city | text | Yes | City name |
| state | text | Yes | State abbreviation |
| zip | text | Yes | ZIP code |
| lat | decimal(10,7) | No | Latitude for distance calculation |
| lng | decimal(10,7) | No | Longitude for distance calculation |
| created_at | timestamptz | Yes | Creation timestamp |

**Relationships:** `customer_id` → `customers.id` (CASCADE DELETE)

---

### units
**Purpose:** Inflatable inventory catalog with specifications and pricing

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Primary key |
| slug | text | Yes | URL-friendly unique identifier |
| name | text | Yes | Display name |
| type | text | Yes | Category (Bounce House, Water Slide, Combo, etc.) |
| is_combo | boolean | Yes | Can operate in wet mode |
| price_dry_cents | integer | Yes | Dry mode price in cents |
| price_water_cents | integer | No | Water mode price in cents (if different) |
| dimensions | text | Yes | Physical dimensions (dry mode) |
| dimensions_water | text | No | Dimensions in water mode (if different) |
| footprint_sqft | integer | Yes | Required space in square feet |
| power_circuits | numeric | Yes | Blower horsepower required |
| capacity | integer | Yes | Maximum number of kids |
| indoor_ok | boolean | Yes | Can be used indoors |
| outdoor_ok | boolean | Yes | Can be used outdoors |
| active | boolean | Yes | Currently available for rental |
| quantity_available | integer | Yes | Number of units in inventory |
| created_at | timestamptz | Yes | Creation timestamp |

**Indexes:** Primary key on `id`, Unique on `slug`

**Notes:**
- Prices stored in cents to avoid floating-point errors
- `dimensions_water` only used for combos with different wet dimensions
- `power_circuits` uses decimal for fractional HP (e.g., 1.5 HP)

---

### unit_media
**Purpose:** Multiple images per unit with separate galleries for dry and wet modes

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Primary key |
| unit_id | uuid | No | Foreign key to units |
| url | text | Yes | Public URL to image (Supabase Storage) |
| alt | text | Yes | Alt text for accessibility |
| mode | text | Yes | Image mode: 'dry' or 'water' |
| sort | integer | Yes | Display order (lower = first) |
| created_at | timestamptz | Yes | Upload timestamp |

**Relationships:** `unit_id` → `units.id` (CASCADE DELETE)

**Notes:**
- `mode` enables separate image galleries for combo units
- `sort` allows manual ordering of images

---

### orders
**Purpose:** Core booking record with complete pricing breakdown and status tracking

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Primary key |
| customer_id | uuid | No | Foreign key to customers |
| status | text | Yes | Order status (draft, pending_review, confirmed, etc.) |
| location_type | text | Yes | 'residential' or 'commercial' |
| surface | text | Yes | 'grass' or 'cement' |
| event_date | date | Yes | Date of event |
| start_window | time | Yes | Delivery window start |
| end_window | time | Yes | Delivery window end |
| address_id | uuid | No | Foreign key to addresses |
| subtotal_cents | integer | Yes | Sum of all items in cents |
| travel_fee_cents | integer | Yes | Distance-based travel fee |
| surface_fee_cents | integer | Yes | Fee for cement surface (sandbags) |
| same_day_pickup_fee_cents | integer | Yes | Fee for same-day pickup |
| tax_cents | integer | Yes | Sales tax amount |
| deposit_due_cents | integer | Yes | Required deposit amount |
| deposit_paid_cents | integer | Yes | Amount of deposit paid |
| balance_due_cents | integer | Yes | Remaining balance |
| payment_method_id | text | No | Stripe payment method ID |
| stripe_payment_intent_id | text | No | Stripe payment intent ID |
| stripe_payment_status | text | No | Stripe payment status |
| deposit_required | boolean | Yes | Whether deposit is required |
| special_instructions | text | No | Customer delivery instructions |
| pets | text | No | Pet information at location |
| is_overnight | boolean | Yes | Overnight rental flag |
| estimated_pickup_date | date | No | Scheduled pickup date |
| sms_consent | boolean | Yes | Customer consented to SMS |
| sms_consent_at | timestamptz | No | SMS consent timestamp |
| quote_expires_at | timestamptz | No | Quote expiration time |
| discount_description | text | No | Description of applied discount |
| discount_amount_cents | integer | Yes | Discount amount in cents |
| created_at | timestamptz | Yes | Order creation timestamp |

**Status Values:**
- `draft` - Customer creating quote
- `pending_review` - Awaiting admin approval
- `payment_pending` - Awaiting payment
- `confirmed` - Paid and confirmed
- `completed` - Event completed
- `cancelled` - Order cancelled
- `void` - Order voided (no charge)

---

### order_items
**Purpose:** Line items for each order (which units and quantities)

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Primary key |
| order_id | uuid | No | Foreign key to orders |
| unit_id | uuid | No | Foreign key to units |
| wet_or_dry | text | Yes | Mode: 'dry' or 'water' |
| unit_price_cents | integer | Yes | Price per unit in cents |
| qty | integer | Yes | Quantity ordered |
| notes | text | No | Special notes for this item |

**Relationships:**
- `order_id` → `orders.id` (CASCADE DELETE)
- `unit_id` → `units.id`

---

### payments
**Purpose:** Payment transaction records (deposits, balances, incidentals)

| Column | Type | Required | Description |
|--------|------|----------|-------------|
| id | uuid | Yes | Primary key |
| order_id | uuid | No | Foreign key to orders |
| type | text | Yes | 'deposit', 'balance', or 'incidental' |
| amount_cents | integer | Yes | Payment amount in cents |
| stripe_payment_intent_id | text | No | Stripe payment intent ID |
| status | text | Yes | Payment status |
| created_at | timestamptz | Yes | Payment timestamp |

**Relationships:** `order_id` → `orders.id` (CASCADE DELETE)

---

## Supporting Tables

### contacts
**Purpose:** CRM database for marketing and customer relationship management

Tracks leads, repeat customers, booking history, revenue, tags, and notes.

---

### invoices
**Purpose:** Generated invoices (linked to orders or standalone)

Supports custom invoice creation with line items, tax calculation, and payment tracking.

---

### documents
**Purpose:** File storage references (waivers, delivery photos, pickup photos)

Tracks all order-related documents with categorization by type.

---

### messages
**Purpose:** Outbound message queue for SMS and email

Tracks all communications sent to customers with template support.

---

### route_stops
**Purpose:** Delivery and pickup schedule for crew coordination

Enables route planning, GPS tracking, and checkpoint reporting (arrived, setup, departed).

---

### pricing_rules
**Purpose:** Global pricing configuration

Centralized pricing rules including base radius, per-mile fees, zone overrides, surface fees, and date-based multipliers.

---

### admin_settings
**Purpose:** Key-value store for admin configuration

Stores API credentials (Twilio, Stripe), admin email, and other system settings.

---

### sms_message_templates
**Purpose:** Reusable SMS message templates with variable substitution

Templates for booking confirmations, delivery ETAs, pickup reminders, etc.

---

### sms_conversations
**Purpose:** Bi-directional SMS conversation log

Tracks both inbound and outbound SMS for customer service.

---

### order_changelog
**Purpose:** Audit log of all order changes

Tracks who changed what and when for accountability (status changes, payment processing, field updates).

---

### user_roles
**Purpose:** Role-based access control

Distinguishes between customers, admins, and crew members.

---

## Security: Row Level Security (RLS)

All tables have RLS enabled with policies controlling access based on:
- User authentication status (JWT tokens)
- User role (admin, crew, customer)
- Ownership (customers can only see their data)

### Key Security Principles

1. **Public Read for Catalog** - Units and pricing are publicly viewable
2. **Authenticated Write** - Most write operations require authentication
3. **Ownership Model** - Customers can only access their own orders/data
4. **Admin Override** - Admins have full access to all records
5. **Secure Secrets** - API keys only accessible to admins

---

## Database Functions

### is_admin()
Checks if current user has admin role. Returns boolean.

### check_unit_availability()
Checks if enough units are available for a date range.

Parameters:
- `unit_id_param` - Unit to check
- `start_date_param` - Start date
- `end_date_param` - End date
- `quantity_param` - Quantity needed

Returns: boolean (true if available)

---

## Storage Buckets

### unit-images
- **Purpose:** Public storage for inflatable unit photos
- **Access:** Public read, authenticated upload
- **Path Structure:** `{unit-id}/{timestamp}-{random}.jpg`
- **File Limit:** 10MB per image

---

## Key Relationships

```
customers (1) → (many) addresses
customers (1) → (many) orders
orders (1) → (many) order_items
orders (1) → (many) payments
orders (1) → (many) documents
orders (1) → (many) route_stops
units (1) → (many) unit_media
units (1) → (many) order_items
```

---

## Migration History

41 migrations tracking all schema changes from initial setup through the latest wet mode images feature.

Key migrations:
- 001: Core schema (customers, addresses, units, orders)
- 006: Unit inventory tracking
- 007: Availability check function
- 021: Stripe payments integration
- 032: Order workflow features
- 038: Wet mode images and dimensions

---

## Best Practices

1. **Always use transactions** for operations affecting multiple tables
2. **Store currency in cents** (integer) to avoid floating-point errors
3. **Use timestamptz** for all timestamps (timezone aware)
4. **Add indexes** on foreign keys and frequently queried columns
5. **Validate inputs** on both client and server
6. **Use RLS policies** for all tables - never bypass security

---

## Performance Considerations

### Indexes Created
- All primary keys and foreign keys
- Unique indexes on email, slug
- Status and date fields for filtering

### Query Optimization
- Use specific column selection, not `SELECT *`
- Add `.limit()` to large result sets
- Use `.maybeSingle()` for 0-1 results
- Batch queries to avoid N+1 problems

---

**For detailed technical implementation, see SYSTEM_ARCHITECTURE.md**
