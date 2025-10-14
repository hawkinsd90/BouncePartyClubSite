# Bounce Party Club - System Architecture

**Version:** 1.0
**Last Updated:** October 14, 2025

---

## Technology Stack

### Frontend
- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **TailwindCSS** - Utility-first styling
- **React Router 6** - Client-side routing
- **Lucide React** - Icon library
- **date-fns** - Date manipulation

### Backend
- **Supabase** - Backend-as-a-Service
  - PostgreSQL database
  - Authentication (JWT)
  - Storage (images)
  - Edge Functions (webhooks)
  - Row Level Security

### Third-Party Integrations
- **Stripe** - Payment processing
- **Twilio** - SMS notifications
- **Google Maps API** - Geocoding and distance calculation

---

## System Architecture

```
┌────────────────────────────────────────────────────┐
│              Customer Browser                       │
│                                                     │
│         React SPA (TypeScript + Vite)              │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Public  │  │  Admin   │  │   Crew   │        │
│  │  Pages   │  │  Portal  │  │  Portal  │        │
│  └──────────┘  └──────────┘  └──────────┘        │
└────────────────────────────────────────────────────┘
                     │
                     │ HTTPS / WebSocket
                     ▼
┌────────────────────────────────────────────────────┐
│                 Supabase Platform                   │
│                                                     │
│  ┌─────────────────────────────────────────────┐  │
│  │  Auth (JWT + RLS)                           │  │
│  ├─────────────────────────────────────────────┤  │
│  │  PostgreSQL Database (18+ tables)           │  │
│  ├─────────────────────────────────────────────┤  │
│  │  Storage (unit-images bucket)               │  │
│  ├─────────────────────────────────────────────┤  │
│  │  Edge Functions (payment webhooks)          │  │
│  └─────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
                     │
                     │ API Calls
                     ▼
┌────────────────────────────────────────────────────┐
│            External Services                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Stripe  │  │  Twilio  │  │  Google  │        │
│  │ Payments │  │   SMS    │  │   Maps   │        │
│  └──────────┘  └──────────┘  └──────────┘        │
└────────────────────────────────────────────────────┘
```

---

## Application Structure

```
src/
├── components/              # Reusable UI components
│   ├── ContactsList.tsx     # CRM contact management
│   ├── InvoiceBuilder.tsx   # Custom invoice creation
│   ├── InvoicesList.tsx     # Invoice management
│   ├── OrdersManager.tsx    # Order list and actions
│   ├── PendingOrderCard.tsx # Quick order approval
│   └── ...
├── lib/                     # Utility libraries
│   ├── supabase.ts         # Supabase client setup
│   ├── pricing.ts          # Pricing calculations
│   ├── orderCreation.ts    # Order creation helpers
│   └── constants.ts        # App constants
├── pages/                   # Page components (routes)
│   ├── Home.tsx            # Landing page
│   ├── Catalog.tsx         # Browse inflatables
│   ├── UnitDetail.tsx      # Unit details
│   ├── Quote.tsx           # Quote builder
│   ├── Checkout.tsx        # Payment flow
│   ├── Admin.tsx           # Admin dashboard
│   ├── UnitForm.tsx        # Unit management
│   ├── Crew.tsx            # Crew portal
│   └── Login.tsx           # Authentication
├── types/                   # TypeScript definitions
│   └── database.types.ts   # Database types
├── App.tsx                  # Root component
└── main.tsx                 # Entry point
```

---

## Feature Modules

### 1. Public Catalog & Browsing
**Components:** Home, Catalog, UnitDetail

**Features:**
- Browse inflatables with type filters
- Search functionality
- Responsive image galleries (separate for dry/wet modes)
- Real-time availability checking
- Price display with mode options
- SEO-friendly URLs

**User Flow:**
```
Landing Page → Browse Catalog → View Unit Details → Get Quote
```

---

### 2. Quote Builder
**Component:** Quote

**Features:**
- Multi-step quote creation
- Date and location selection
- Address autocomplete (Google Places)
- Real-time pricing calculation:
  - Base unit prices (dry or wet mode)
  - Distance-based travel fees
  - Surface fees (cement requires sandbags)
  - Date-based surcharges (same-day booking)
  - Tax calculation
- Multiple units per quote
- Availability validation
- Quote expiration timer

**Pricing Logic:**
```typescript
subtotal = sum of (unit_price × quantity)
distance = calculateDistance(homeBase, deliveryAddress)
travelFee = distance > baseRadius ? (distance - baseRadius) × perMileRate : 0
surfaceFee = surface === 'cement' ? sandbagFee : 0
dateSurcharge = isSameDay(eventDate) ? sameDayFee : 0
total = subtotal + travelFee + surfaceFee + dateSurcharge
tax = total × taxRate
grandTotal = total + tax
```

---

### 3. Checkout & Payments
**Component:** Checkout

**Features:**
- Customer information capture
- Stripe Payment Element integration
- Split payment options:
  - Pay deposit only
  - Pay full amount
- Card-on-file with explicit consent
- Payment confirmation
- Automated SMS/Email notifications
- Order status tracking

**Payment Flow:**
```
Quote → Customer Info → Payment Method → Process Payment → Confirmation
```

**Stripe Integration:**
- PCI-compliant (no card storage)
- Payment intents for secure processing
- Webhook handling for payment status
- Refund capabilities

---

### 4. Admin Dashboard
**Component:** Admin (with 9 tabs)

#### Tab 1: Overview
- Revenue metrics (total, deposit, balance)
- Order count by status
- Recent activity feed
- Quick stats dashboard

#### Tab 2: Pending Review
- New orders requiring approval
- Quick approve/reject actions
- Order details modal
- Payment status indicators
- Notification badge

#### Tab 3: Inventory
- Complete unit list
- Add/edit unit actions
- Active/inactive toggle
- Availability status
- Quick search and filters
- Bulk export to PDF menu

#### Tab 4: Orders
- Filterable order list (by status, date, customer)
- Order detail view
- Status management workflow
- Payment tracking
- SMS/Email communication
- Route assignment
- Discount application

#### Tab 5: Contacts
- Customer database (CRM)
- Contact tagging system
- Booking history per contact
- Revenue tracking per customer
- Notes and communication log
- Export to CSV

#### Tab 6: Invoices
- Invoice list with status
- Custom invoice builder
- Line item management
- PDF generation
- Email invoices directly
- Payment tracking

#### Tab 7: Settings
- Pricing rules configuration:
  - Base delivery radius
  - Per-mile fees
  - Surface fees
  - Zone overrides
- API credentials management:
  - Twilio (Account SID, Auth Token, From Number)
  - Stripe (Secret Key, Publishable Key)
- SMS template editor
- Admin email notification settings

#### Tab 8: Changelog
- Complete order modification history
- Who changed what and when
- Field-level change tracking
- Audit trail for compliance

#### Tab 9: Calculator
- Quick pricing calculator
- Distance estimator
- Date-based pricing preview
- No order creation required

**Admin Features:**
- Multi-tab navigation with URL state persistence
- Returns to last active tab after actions
- Real-time order notifications
- Bulk operations support

---

### 5. Unit Management
**Component:** UnitForm

**Features:**
- Add new units
- Edit existing units
- Complete specifications:
  - Name, type, dimensions
  - Capacity, power requirements
  - Indoor/outdoor suitability
  - Quantity available
- Pricing configuration:
  - Dry mode price
  - Water mode price (optional)
- **Separate dimensions for dry vs wet modes**
- **Multi-image upload system:**
  - **Dry mode images** (required, grey styling)
  - **Wet mode images** (optional, blue styling)
  - **"Same as dry mode" checkbox** - toggles wet section
  - Multiple images per mode
  - Drag-and-drop upload
  - Image preview and delete
- SEO-friendly URL slug generation
- Active/inactive status

**Image Management:**
- Upload to Supabase Storage bucket
- Public CDN URLs
- Mode-based organization (dry/water)
- Sort order control

---

### 6. Crew Portal
**Component:** Crew

**Features:**
- Daily route view
- Stop list with customer details
- GPS navigation integration
- Checkpoint system:
  - Start day
  - Arrived at location
  - Setup complete
  - Departed location
- Order details and special instructions
- Photo upload (delivery/pickup verification)
- Customer contact information
- Pet warnings
- Time tracking per stop

**Checkpoint Flow:**
```
None → Start Day → Arrived → Setup Complete → Departed
```

---

### 7. Communication System

**Features:**
- Automated SMS via Twilio
- Email notifications
- Template-based messaging with variables
- Message scheduling
- Conversation history (inbound/outbound)
- SMS consent tracking

**Message Templates:**
- Booking confirmation
- Payment received
- Delivery ETA notification
- Setup complete
- Pickup reminder
- Review/feedback request
- Admin notifications

**Variable Substitution:**
```
Hi {{customer_name}}!
Your rental for {{event_date}} is confirmed.
We'll arrive between {{start_time}} and {{end_time}}.
Order #{{order_number}} | Total: {{total_amount}}
```

---

## Key Routes

```typescript
// Public Routes
'/'                          Landing page
'/catalog'                   Browse units
'/units/:slug'               Unit details
'/quote'                     Quote builder
'/checkout'                  Payment flow

// Auth Routes
'/login'                     Authentication
'/signup'                    Registration

// Protected Routes (Admin)
'/admin'                     Dashboard (with tabs)
'/admin/units/new'           Add unit
'/admin/units/:id/edit'      Edit unit

// Protected Routes (Crew)
'/crew'                      Crew portal
```

**Tab Navigation:**
- Uses URL query parameters: `/admin?tab=inventory`
- Preserves tab state on refresh
- Returns to active tab after actions
- Browser back/forward support

---

## Security Architecture

### Multi-Layer Security

1. **Transport Security**
   - HTTPS everywhere
   - Secure WebSocket connections

2. **Authentication**
   - JWT-based (Supabase Auth)
   - Secure session management
   - Password hashing (bcrypt)

3. **Authorization**
   - Row Level Security (RLS) on all tables
   - Role-based access control (admin/crew/customer)
   - Policy-based permissions

4. **Payment Security**
   - PCI-compliant via Stripe
   - No card number storage
   - Tokenized payments only
   - Secure webhook verification

5. **Data Protection**
   - SQL injection prevention (parameterized queries)
   - XSS protection (React auto-escaping)
   - CSRF tokens (SameSite cookies)
   - Input validation (client + server)

### RLS Policy Examples

```sql
-- Customers can only view their own orders
CREATE POLICY "Users can view own orders"
  ON orders FOR SELECT
  TO authenticated
  USING (customer_id IN (
    SELECT id FROM customers WHERE email = auth.jwt()->>'email'
  ));

-- Admins can view all orders
CREATE POLICY "Admins can view all orders"
  ON orders FOR SELECT
  TO authenticated
  USING (is_admin());
```

---

## Data Flow: Creating an Order

```
1. Customer builds quote
   ↓
2. Select units and date → React state
   ↓
3. Enter customer info → Form validation
   ↓
4. Submit payment → Stripe integration
   ↓
5. Create customer record (upsert)
   ↓
6. Geocode address → Google Maps API
   ↓
7. Create address record
   ↓
8. Create order with pricing breakdown
   ↓
9. Create order_items (line items)
   ↓
10. Process payment → Stripe API
    ↓
11. Update order status → 'confirmed'
    ↓
12. Send confirmations → Twilio SMS + Email
    ↓
13. Create route_stop → For crew
    ↓
14. Redirect to confirmation page
```

---

## API Integration Patterns

### Supabase Query Pattern
```typescript
const { data, error } = await supabase
  .from('units')
  .select('*, unit_media(*)')
  .eq('active', true)
  .order('name');

if (error) throw error;
return data;
```

### Image Upload Pattern
```typescript
const fileName = `${unitId}/${Date.now()}-${file.name}`;
const { error } = await supabase.storage
  .from('unit-images')
  .upload(fileName, file);

const { data } = supabase.storage
  .from('unit-images')
  .getPublicUrl(fileName);

return data.publicUrl;
```

### Real-time Subscription
```typescript
const subscription = supabase
  .channel('orders')
  .on('postgres_changes',
    { event: '*', schema: 'public', table: 'orders' },
    (payload) => {
      console.log('Order changed:', payload);
      refreshOrders();
    }
  )
  .subscribe();
```

---

## Performance Optimizations

### Frontend
- **Code Splitting:** Lazy load routes with `React.lazy()`
- **Image Optimization:** WebP format, lazy loading, CDN delivery
- **Caching:** LocalStorage for catalog data
- **Memoization:** `React.memo()` and `useMemo()` for expensive calculations
- **Debouncing:** Search inputs and autocomplete

### Backend
- **Database Indexes:** All foreign keys and frequently queried columns
- **Query Optimization:** Select specific columns, use pagination
- **Batch Operations:** Combine multiple queries when possible
- **Connection Pooling:** Supabase handles automatically

### Assets
- **Static CDN:** All assets served from CDN
- **Compression:** Gzip/Brotli for text assets
- **HTTP/2:** Multiplexing support
- **Edge Caching:** Cached at CDN edge nodes

---

## Deployment

### Build Process
```bash
npm run build        # Production build
npm run preview      # Preview build locally
```

### Environment Variables
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx...
VITE_STRIPE_PUBLISHABLE_KEY=pk_xxx
VITE_GOOGLE_MAPS_KEY=AIzaSyxxx
```

### Hosting
- **Platform:** Vercel / Netlify
- **Build:** Vite static output
- **Deploy:** Automatic on git push
- **CDN:** Global edge network

---

## Complete Feature List

### Customer-Facing (15+ features)
- Browse catalog with type filters
- Search units
- View unit details with image galleries
- Separate dry/wet mode images for combos
- Build custom quotes with multiple units
- Real-time pricing with all fees
- Address autocomplete
- Distance-based pricing
- Online payment (Stripe)
- Split payment (deposit/full)
- Card-on-file option
- Order tracking
- SMS notifications
- Email confirmations
- Quote expiration timer

### Admin Features (30+ features)
- Dashboard with revenue metrics
- Order management
- Pending order review queue
- Quick approve/reject
- Inventory management
- Add/edit units
- Multi-image upload (dry/wet modes)
- "Same as dry" checkbox for combos
- Separate dimensions for dry vs wet
- URL-preserved tab navigation
- Return to active tab after actions
- CRM/Contact database
- Contact tagging
- Booking history tracking
- Revenue per customer
- Invoice builder
- Custom invoices
- PDF generation
- Email invoices
- Payment tracking
- SMS template management
- Pricing rules configuration
- API credentials management
- Audit logs (changelog)
- Discount management
- Route assignment
- Bulk export to PDF
- Real-time notifications
- Quick calculator tool
- Multi-user support

### Crew Features (8+ features)
- Daily route view
- Stop list with details
- GPS navigation
- Checkpoint system
- Photo uploads
- Customer contact access
- Special instructions view
- Time tracking

### Technical Features
- Row-level security (RLS)
- JWT authentication
- Role-based access control
- Real-time subscriptions
- Geospatial calculations
- Multi-mode pricing
- Stripe integration
- Twilio SMS
- Google Maps integration
- Responsive design
- Form validation
- Error handling
- Loading states
- TypeScript type safety
- Optimistic UI updates

---

## Future Enhancements

### Phase 2
- Calendar view for bookings
- Automated route optimization
- Customer reviews and ratings
- Referral program
- Gift cards
- Package deals
- Seasonal promotions

### Phase 3
- Mobile app (React Native)
- AI-powered demand forecasting
- Dynamic pricing
- Multi-vendor marketplace
- Equipment maintenance tracking
- Advanced analytics dashboard

---

**For detailed database schema, see DATABASE_DOCUMENTATION.md**
