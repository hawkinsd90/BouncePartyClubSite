# Bounce Party Club

Bounce Party Club is a full-stack bounce house rental management platform built with React, TypeScript, Vite, Supabase, and Stripe. It handles the complete customer journey — from browsing inventory and submitting a quote, through order approval, payment, electronic waiver signing, day-of crew coordination, and post-event follow-up.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Tailwind CSS, Vite |
| Backend / Database | Supabase (Postgres + Edge Functions) |
| Payments | Stripe (Checkout, Charges, Refunds, Webhooks) |
| SMS | Twilio |
| Email | Resend |
| Maps / Routing | Google Maps Platform |
| Hosting | Netlify |

## Local Development

### Prerequisites

- Node 20.17.0 (see `.nvmrc`)
- A Supabase project
- A Stripe account
- A Google Maps API key

### Setup

1. Clone the repo and install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

3. Required environment variables:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOOGLE_MAPS_API_KEY=
VITE_STRIPE_PUBLISHABLE_KEY=
```

4. Backend secrets (Stripe secret key, Twilio credentials, Resend API key) are stored in the `admin_settings` database table — **never** in `.env` or Netlify environment variables. See `docs/DEPLOYMENT_AND_SECURITY.md` for details.

5. Start the dev server:

```bash
npm run dev
```

## Project Structure

```
src/
  App.tsx                  # Root router and provider stack
  pages/                   # Route-level page components
  components/              # Feature-grouped UI components
    admin/                 # Admin dashboard components
    calendar/              # Crew calendar and day-of tools
    checkout/              # Checkout flow
    customer-portal/       # Customer self-service portal
    order-detail/          # Order management modals
    payment/               # Stripe payment components
    quote/                 # Quote/booking form
    waiver/                # E-signature waiver system
    common/                # Shared layout, modals, spinners
    shared/                # Reusable form and display components
  contexts/                # React contexts (Auth, Business, CustomerProfile)
  hooks/                   # Custom React hooks
  lib/                     # Business logic, services, utilities
    queries/               # Centralized Supabase query modules
    constants/             # Shared constants (statuses, home base)
  types/                   # TypeScript interfaces and types

supabase/
  functions/               # Deno edge functions (payments, email, SMS, etc.)
  migrations/              # Ordered SQL migration files
```

## Documentation

| File | Contents |
|---|---|
| `README.md` | This file — project overview and local setup |
| `docs/ARCHITECTURE.md` | Data layer, routing, context stack, edge functions, query patterns |
| `docs/AUTH_AND_ROLES.md` | Role hierarchy, auth flow, OAuth, consent system, protected routes |
| `docs/CREW_AND_OPERATIONS.md` | Task cards, route optimization, GPS tracking, mileage, lot pictures |
| `docs/DEPLOYMENT_AND_SECURITY.md` | Netlify config, environment variables, secrets management, RLS |
| `docs/EMAIL_SYSTEM.md` | Email template system, SMS templates, notification service, Twilio webhook |
| `docs/FEATURES.md` | Full feature reference — catalog, quote, checkout, portal, admin panel |
| `docs/INTEGRATIONS.md` | Stripe, Twilio, Resend, Google Maps, Google Calendar |
| `docs/ORDERS_AND_WORKFLOW.md` | Order lifecycle, approval flow, changelog, invoice system |
| `docs/PAYMENTS_AND_RECEIPTS.md` | Payment types, Stripe webhooks, receipt logging, cash/check flows |

## Build

```bash
npm run build
```

Output is placed in `dist/` and served as a single-page app via Netlify's redirect rule (all paths → `index.html`).
