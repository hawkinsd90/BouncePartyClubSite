# Authentication and Roles

## Overview

Authentication is handled by Supabase Auth. The app uses email/password as the primary method with Google OAuth as an optional alternative. Role-based access control is implemented through a custom `user_roles` table — Supabase's built-in JWT claims are not used for role enforcement.

---

## Role Hierarchy

There are four roles, stored as lowercase strings in the `user_roles` table:

| Role | Access Level |
|---|---|
| `master` | Full access — all admin capabilities plus role management and system settings |
| `admin` | Full admin access — order management, settings, crew, analytics |
| `crew` | Crew-only access — calendar, task cards, day-of operations |
| `customer` | Customer access — order history, portal, waiver signing |

A user may hold multiple roles simultaneously. The `AuthContext` loads all assigned roles into a `roles[]` array.

Helper flags available from `useAuth()`:
- `isAdmin` — true if user has `admin` or `master` role
- `isMaster` — true if user has `master` role
- `hasRole(role)` — checks for a specific role in the roles array

---

## Auth Context (`src/contexts/AuthContext.tsx`)

The `AuthProvider` wraps the entire app and exposes:

```typescript
{
  user: User | null
  role: string | null        // primary role (first found in user_roles)
  roles: string[]            // all assigned roles
  loading: boolean
  isAdmin: boolean
  isMaster: boolean
  signIn(email, password): Promise<void>
  signInWithGoogle(): Promise<void>
  signInWithApple(): Promise<void>
  signUp(email, password, metadata): Promise<void>
  signOut(): Promise<void>
  hasRole(role): boolean
}
```

On session load and on every auth state change, `AuthContext` fetches the user's roles from `user_roles` using the authenticated user's ID.

**Important:** `onAuthStateChange` callbacks use an async IIFE pattern to avoid deadlocking the Supabase client:
```typescript
supabase.auth.onAuthStateChange((event, session) => {
  (async () => {
    // async work here
  })();
});
```

---

## Sign Up Flow

1. Customer fills out `/signup` with name, email, password, and optionally a home address.
2. `signUp()` is called with user metadata (first name, last name, phone, address fields).
3. A Postgres trigger (`handle_new_user`) runs on `auth.users` insert and:
   - Creates a `customers` record (using metadata name/email; Google name is overridden by form name if both exist)
   - Creates a `user_roles` entry with `role: 'customer'`
   - Links the new user to any existing orders matching their email address
   - Creates a `customer_profiles` record
4. Home address (if provided) is saved via the `save-signup-address` edge function after successful auth.

Trigger execution is logged to `auth_trigger_logs` for debugging.

---

## Consent Draining System

### Overview

Consent for SMS marketing and card-on-file authorization must be collected before the customer has an account (during the quote/booking flow). The consent draining system bridges pre-signup consent into a permanent post-signup record.

### Step 1: Pre-Signup Consent (`save-pending-consent` edge function)

When a customer checks consent boxes on the quote or checkout form before having an account:
1. A unique `batch_id` (UUID) is generated on the client
2. The `save-pending-consent` edge function stores the consents in `pending_signups_consent`:
   - `user_id` — the user's future auth ID (set during account creation)
   - `batch_id` — groups all consents from this session
   - `consents` — JSON array of consent types and values
   - `user_agent_hint` — browser info for audit trail

### Step 2: Account Creation

The customer signs up via `/signup`. The Postgres trigger creates their account records.

### Step 3: Consent Drain (`record-consent` edge function with `action=drain-pending`)

Immediately after `SIGNED_IN` auth event, `AuthContext` calls `drainPendingConsent()`:
1. An **in-tab guard** (a `Set<userId>`) prevents the drain from firing twice in the same browser tab
2. The `record-consent` edge function is called with `action=drain-pending` and the `batch_id`
3. The function moves records from `pending_signups_consent` to `user_consent_log`:
   - Each consent type is inserted with `(user_id, consent_batch_id, consent_type)` unique index
   - This prevents duplicate logging even if the drain fires from multiple tabs
4. The `pending_signups_consent` row is deleted after successful drain

### Consent Types

| Type | Meaning |
|---|---|
| `sms_marketing` | Customer consents to receive SMS messages |
| `card_on_file` | Customer consents to save card for future charges |

### `record-consent` Edge Function Actions

| Action | What It Does |
|---|---|
| `drain-pending` | Moves pending consent from staging to permanent log |
| `record` | Directly records a consent (for post-auth flows) |
| `revoke` | Removes a previously given consent |

### Permanent Consent Log (`user_consent_log`)

Permanent record with idempotency enforced by unique index on `(user_id, consent_batch_id, consent_type)`:
- `user_id`, `customer_id` — who gave consent
- `consent_type` — type of consent
- `consented` — whether they agreed or declined
- `policy_version` — version of the consent text shown
- `source` — where consent was given (`signup`, `checkout`, etc.)
- `consent_batch_id` — idempotency key
- `ip_hint`, `user_agent_hint` — audit trail

---

## Customer Profile Context (`src/contexts/CustomerProfileContext.tsx`)

Loaded for all authenticated users. Provides customer data to the quote and checkout forms.

### Profile Loading with Retry Logic

On mount, the provider fetches the `customers` record linked to `user_id`. Because the Postgres trigger creating the customer record runs asynchronously after signup, a retry strategy is used:
- Up to **6 attempts**
- **800ms** between attempts
- Prevents "profile not found" errors immediately after account creation

### Session Data

The provider maintains ephemeral `sessionData` that persists across the quote → checkout journey:
```typescript
{
  firstName, lastName, email, phone, businessName,
  addressLine1, addressLine2, city, state, zip
}
```

`updateSessionData(partial)` merges new values into the existing session. This data is used to prefill forms and is written to the database on order submission.

### Default Address

If the customer has a `default_address_id` set, that address is loaded and offered as a prefill in the quote form, speeding up repeat bookings.

---

## Google OAuth

Google OAuth is triggered via `signInWithGoogle()`:

1. Supabase redirects to Google for authentication
2. On return, if the user is new, the Postgres trigger runs (creates customer record, assigns `customer` role)
3. Profile data is merged: form-submitted name takes priority over Google's display name
4. OAuth provider and profile data are stored on the `customers` record (`oauth_provider`, `oauth_profile_data`)
5. An optional `?next=` query parameter on the redirect URL is honored for post-login navigation

---

## Protected Routes (`src/components/common/ProtectedRoute.tsx`)

```tsx
<ProtectedRoute roles={['admin', 'master']}>
  <AdminPage />
</ProtectedRoute>
```

Behavior:
- Shows a loading spinner while auth state is resolving
- Redirects unauthenticated users to `/login` (with `location.state` for redirect-back after login)
- Shows an "Access Denied" screen for authenticated users lacking the required role
- `master` and `admin` share access via `isAdmin` — treated identically for route protection

---

## Role Management

Roles are assigned and revoked through the admin Permissions tab. Two database RPCs handle this:

- `assign_role_by_email(email, role)` — grants a role to a user by email
- `get_all_role_users()` — returns all users with non-customer roles (excludes `customer` role)

### Permissions Audit Log

The `log_permission_change` trigger fires on every insert/delete in `user_roles` and writes to `user_permissions_changelog`:
- `target_user_id` — who the role was assigned to
- `changed_by_user_id` — who made the change
- `action` — `granted` or `revoked`
- `old_role`, `new_role`
- `notes` — optional reason

The actor's email is embedded at trigger time. This provides an immutable audit trail of all permission changes.

---

## Business Context and Admin Settings

Business-wide configuration is loaded by `BusinessProvider` (`src/contexts/BusinessContext.tsx`) from the `admin_settings` table on app mount:

- `business_name`, `business_name_short`, `business_legal_entity`
- `business_address`, `business_phone`, `business_email`, `business_website`
- `business_license_number`
- `logo_url`, `favicon_url`, `brand_primary_color`
- Social media URLs
- `google_review_url`, `google_maps_url`

This data is used for display, email template branding, and the dynamic waiver text.

---

## Session Persistence

The Supabase client is configured with:
- `persistSession: true` — session stored in `localStorage`
- `autoRefreshToken: true` — tokens silently refreshed before expiry
- `detectSessionInUrl: true` — handles OAuth callback URL fragments

---

## First-Time Setup

The `/setup` route renders `Setup.tsx`, which calls the `create-admin-user` edge function to bootstrap the first master user. This route is accessible without authentication and is intended to be used once during initial deployment.

---

## Branded Auth Emails (`auth-email-hook`)

Supabase's default auth emails (signup confirmation, password reset) are replaced with branded versions via the `auth-email-hook` edge function. This hook is registered in Supabase as a custom auth email handler and:

1. Receives the auth event (signup, password reset, etc.) from Supabase
2. Generates a branded HTML email using `emailTemplateBase.ts` (business logo, colors, footer)
3. Sends via Resend

This ensures all auth emails match the business branding rather than using Supabase's generic templates.

---

## Password Reset Flow

1. Customer visits `/forgot-password` and submits their email
2. Supabase sends a password reset email via the `auth-email-hook` (branded)
3. The reset link redirects to `/reset-password`
4. Customer enters a new password
5. Supabase updates the credential and signs the user in
