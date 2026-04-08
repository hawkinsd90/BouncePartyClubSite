# Authentication and Roles

## Overview

Authentication is handled by Supabase Auth. The app uses email/password as the primary method with Google OAuth as an optional alternative. Role-based access control is implemented through a custom `user_roles` table — Supabase's built-in claims are not used for role enforcement.

---

## Role Hierarchy

There are four roles, stored as strings in the `user_roles` table:

| Role | Access Level |
|---|---|
| `master` | Full access — all admin capabilities plus role management and system settings |
| `admin` | Full admin access — order management, settings, crew, analytics |
| `crew` | Crew-only access — calendar, task cards, day-of operations |
| `customer` | Customer access — order history, portal, waiver signing |

A user may hold multiple roles simultaneously. The `AuthContext` loads all assigned roles into a `roles[]` array.

Helper flags available from `useAuth()`:

- `isAdmin` — true if user has `admin` or `master` role
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

On session load and on every auth state change, `AuthContext` fetches the user's roles from the `user_roles` table using the authenticated user's ID.

---

## Sign Up Flow

1. Customer fills out the signup form (`/signup`) with name, email, password, and optionally a home address.
2. `signUp()` is called with user metadata (first name, last name, phone, address fields).
3. A Postgres trigger runs on `auth.users` insert — it creates a `customers` record and a `user_roles` entry with `role: 'customer'`, and links the new user to any existing orders matching the email address.
4. Home address (if provided) is saved via the `save-signup-address` edge function after successful auth.

### Consent Draining

If the customer accepted SMS/card consent before signing up (e.g., during the quote flow), that consent is stored in `pending_signups_consent`. After auth, `AuthContext` calls the `record-consent` edge function to permanently store the consent and clears the pending record. A guard prevents this from firing more than once per session.

---

## Google OAuth

Google OAuth is triggered via `signInWithGoogle()`. The auth flow:

1. Supabase redirects to Google.
2. On return, if the user is new, the same Postgres trigger runs (creates customer record, assigns `customer` role).
3. Profile data from Google (name, avatar) is merged — form-submitted name takes priority over Google's name if both exist.
4. An optional `?next=` query parameter on the redirect URL is honored for post-login navigation.

---

## Protected Routes (`src/components/common/ProtectedRoute.tsx`)

```tsx
<ProtectedRoute roles={['admin', 'master']}>
  <AdminPage />
</ProtectedRoute>
```

Behavior:
- Shows a loading spinner while auth state is resolving.
- Redirects unauthenticated users to `/login` (with `location.state` to redirect back after login).
- Shows an "Access Denied" screen for authenticated users who lack the required role.
- `master` and `admin` share access via the `isAdmin` flag — they are treated identically for route protection.

---

## Role Management

Roles are assigned and revoked through the admin Permissions tab. Two database RPCs handle this:

- `assign_role_by_email(email, role)` — grants a role to a user by email
- `get_all_role_users()` — returns all users with non-customer roles

The `log_permission_change` trigger fires on every insert/delete in `user_roles` and writes to `admin_settings_changelog`. The actor's email is embedded in the log entry at trigger time.

---

## Admin Settings (Business Context)

Business-wide configuration is loaded by `BusinessProvider` (`src/contexts/BusinessContext.tsx`) from the `admin_settings` table on app mount. This includes:

- `business_name`, `business_name_short`, `business_legal_entity`
- `business_address`, `business_phone`, `business_email`, `business_website`
- `business_license_number`

This data is used throughout the app for display, email templates, and the dynamic waiver text.

---

## Session Persistence

The Supabase client is configured with:

- `persistSession: true` — session stored in localStorage
- `autoRefreshToken: true` — tokens silently refreshed before expiry
- `detectSessionInUrl: true` — handles OAuth callback URL fragments

---

## First-Time Setup

The `/setup` route renders `Setup.tsx`, which calls the `create-admin-user` edge function to bootstrap the first master/admin user. This route is accessible without authentication and is intended to be used once during initial deployment.
