# Documentation index

The files in this folder describe the application **as deployed in Production today** (branch `main`, Supabase project `qaagfafagdpgzcijnfbw`) and nothing else. They do not describe work that exists only on the Development branch.

These files change **only after** a change has been manually tested on Development and the release is ready to push to Production.

## Read in this order

| File | What it gives you |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system is built: providers, routing, tables, order status model, edge functions, pricing, availability, realtime, caches |
| [DIAGRAMS.md](DIAGRAMS.md) | Architecture charts: system context, deployment, layers, state machines, sequence diagrams for every major flow, data models, security boundaries |
| [FEATURES.md](FEATURES.md) | Every user-facing feature and admin screen, with a feature-to-screen map and a roles-to-capabilities matrix |
| [ORDERS_AND_WORKFLOW.md](ORDERS_AND_WORKFLOW.md) | Quote, cart, checkout, approval, edits, cancellation, availability, pricing with worked examples, the customer portal |
| [PAYMENTS_AND_RECEIPTS.md](PAYMENTS_AND_RECEIPTS.md) | Deposits, balances, tips, cash and check, refunds, receipts, invoices, webhooks, the money-flow chart |
| [AUTH_AND_ROLES.md](AUTH_AND_ROLES.md) | Sign-up, sign-in, roles, consent, route and policy checks |
| [CREW_AND_OPERATIONS.md](CREW_AND_OPERATIONS.md) | Calendar, task cards, status buttons, photos, mileage, equipment checklist, crew day flow |
| [EMAIL_SYSTEM.md](EMAIL_SYSTEM.md) | Every email and SMS, when it is sent, templates, relays, failure handling |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Stripe, Twilio, Resend, Google, Netlify: what each is used for and how |
| [DEPLOYMENT_AND_SECURITY.md](DEPLOYMENT_AND_SECURITY.md) | Hosting, build, environment variables, security model, function settings |

## Reference documents (complete inventories)

| File | What it lists |
|---|---|
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | Every table, column, constraint, index, policy, function, trigger, bucket, setting key and data-model diagram |
| [API_REFERENCE.md](API_REFERENCE.md) | Every deployed edge function: caller rules, request, response, errors, side effects |
| [FRONTEND_REFERENCE.md](FRONTEND_REFERENCE.md) | Every route, page, component, hook and library module |
| [DESIGN_INTENT.md](DESIGN_INTENT.md) | Things that are deliberately the way they are. Check it before "fixing" something that looks odd |

## Source baseline and verification status

**Source baseline.** Application source in these documents is `main` at commit `b79ca480` (2026-09-28, "Update index.html"), which is also the commit of Production's current Netlify deploy.

**Checked against the `main` source:**
- Every source path the documents cite resolves in `main` (234 paths checked; the one exception, `docs/testing.md`, is a Development-branch file named in `DEPLOYMENT_AND_SECURITY.md`).
- `API_REFERENCE.md` documents 44 functions: the 39 that have source in `main` (all 39 `verify_jwt` values equal `supabase/config.toml` on `main`) and 5 that exist only in Production.
- File counts in `FRONTEND_REFERENCE.md` (25 pages, 165 component-folder files, 28 hooks) match `main`.

**Not verifiable from source** (read from the live Production project and hosted services on 2026-10-24 by the earlier documentation audit, and not re-read when this index was last revised). Treat as unverified until re-checked:
- Everything in `DATABASE_SCHEMA.md` that comes from the live catalog: tables, columns, policies, functions, triggers, buckets and setting values, and the counts built from them (for example 55 tables and 68 functions in `public`).
- The 5 functions whose source is deployed only in Production (`backfill-card-details`, `create-order-short-link`, `get-streetview-heading`, `submit-contact-inquiry`, `verify-payment`) and their deployed `verify_jwt` flags.
- The migration ledger (277 rows) and whether the 305 migration files in `main` rebuild the live schema.
- Hosted configuration: Supabase Auth settings, Stripe, Twilio, Resend, Netlify and Google settings and environment values.
