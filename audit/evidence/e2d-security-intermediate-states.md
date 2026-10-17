# E2D security and intermediate-state verification (58-version candidate versus the 67-version baseline)

Local disposable PostgreSQL 18.4 only (databases `bpc_replay_e2d_sec_p58` and `bpc_replay_e2d_sec_p67`, each cloned from the restored pre-upgrade Production schema with the D4 synthetic valid dataset). Tool: `tools/e2d_extra.py sec`; raw JSON `e2d-scratch/e2d-security.json` (protected scratch folder, not in Git). No hosted system was contacted. Nothing here approves a sequence.

## 1. Method
After the start state and after **every** migration of each path (58 and 67 steps) the test recorded:
1. the **catalog**: anonymous-executable `public` functions; `public` tables on which `anon` holds INSERT, UPDATE or DELETE (with whether row-level security is enabled); policies that apply to `anon` or `public`; default ACLs for `public`; SECURITY DEFINER functions executable by `anon`;
2. **actual behavior**: a real `SET LOCAL ROLE anon; INSERT INTO public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) VALUES (<synthetic order>, ..., 'portal_shortlink', 0)` in a transaction that is always rolled back.
Both paths were compared at the 58 shared stop points plus the start state.

## 2. The temporary anonymous invoice-link INSERT policy
| Path | Policy `Anon can insert portal shortlinks` present at any stop | Anonymous INSERT accepted at any stop |
|---|---|---|
| 58 versions | **never** (checked in the policy catalog after all 58 migrations and the start state) | **never** (59 attempts, all rejected by row-level security) |
| 67 versions | only after `20260715221828` | **accepted exactly once**, after `20260715221828`; rejected before and after `20260716104333` (reproduces the E2C result) |
Conclusion: the 58-version path never introduces the exposure, in the catalog or in actual anonymous-role behavior. The final state of both paths has no such policy.

## 3. Differences between the two paths at shared stop points
Of 59 shared stop points (including the start), **one** differs in the security probes: after `20260716151549` the 67 path exposes `check_product_availability(jsonb,date,date,uuid)` to `anon` (the earlier variant created by `20260716151530`), and the 58 path does not have the function yet; it appears in both after `20260716152447` with identical privileges. Nothing else differs: anonymous-executable functions, anonymous-writable tables, anonymous/public policies, default ACLs and SECURITY DEFINER exposure are identical at all other stops, and the final probes of the two paths are equal. (The earlier E2C difference in the function body of `get_public_business_settings` is a behavior difference, not a privilege difference: the privileges on it are the same in both paths.)

## 4. Interim exposure that is the same in both paths (not caused by the shortening)
- **Anonymous-executable functions** rise from 68 at the start to 83 before `20261007120000` and fall to 6 only at `20261013120000`; newly created functions are executable by `anon` through the default function privileges until the October lockdown migrations run (`20261007120000` 83 to 74, `20261008120000` to 69, `20261012120000` to 61, `20261013120000` to 6).
- **Anonymous-writable tables** (INSERT/UPDATE/DELETE privilege, guarded by row-level security) number 55 at the start (current Production state), peak at 66, and fall to 39 at `20261012120000`, 2 at `20261013120000` and 1 at `20261018120100`. **No table with anonymous write privileges had row-level security disabled at any step in either path.**
Consequence: whichever sequence is chosen, **a release that stops before `20261013120000` leaves a wider anonymous surface than the finished release** (it is no wider than the starting state for tables, but wider for functions). The release plan must not be paused between the Development-line migrations and the October lockdown without a deliberate decision.

## 5. Final state (identical in both paths)
- Anonymous-executable `public` functions: 6 (`check_date_blackout`, `check_product_availability`, two `check_unit_availability`, `get_public_business_settings`, `get_public_nav_menu_groups`), all SECURITY DEFINER; whether each is intended public is a Step 3 review item, not tested here.
- Anonymous-writable table: `pending_signups_consent` (RLS enabled; INSERT policy `Anon can insert for freshly created user`, `WITH CHECK` that a row's `user_id` is an `auth.users` row created within the last minute). This is the policy whose definition E2A could not match to a chain definition in Production.
- Default ACLs: `postgres` defaults are narrowed (service_role only), but **`supabase_admin` defaults still grant `anon`, `authenticated` and `service_role` full privileges** on future tables, sequences and functions created by `supabase_admin` (finding F-2).

## 6. Security findings unresolved regardless of sequence
1. F-2: platform-owned `supabase_admin` default privileges remain permissive (Step 3).
2. The interim anonymous function/table exposure until `20261013120000` (section 4): an interrupted release is wider than a completed one.
3. `pending_signups_consent` anonymous INSERT policy: intended by its migration, definition unmatched in E2A; needs the live Production definition compared (query in `e2a-unresolved-evidence.md`).
4. Local PostgreSQL behavior is not Supabase runtime behavior: PostgREST, Auth, Storage API, signed URLs and request-time JWT claims were not exercised.
5. Master-account password rotation (SEC-A) and the temporary `cli_login_postgres` role: outside the migration sequence.
6. The omitted-version late-application risk of E2C (section 4 of `e2c-omission-and-resumption-tests.md`) is a security matter only if the application method can run an omitted version; it is addressed by the executor requirements in `e2d-executor-requirements.md`.

## 7. Verdict for the security question
On the tested state the 58-version path is **at least as safe as the 67**: it removes the open-policy window and one early anonymous-callable function, and introduces no new privilege at any step. It does not reduce any of the findings in section 6.
