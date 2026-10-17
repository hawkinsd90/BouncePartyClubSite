# E2J-B: verified Development permission findings (hosted, read-only)

Source: Q00, Q22, Q29 and Q30 executed on the Development project (`srxunxiytojjsuhcmzjg`, "Bounce Party Club Dev") on 2026-10-17 through the Supabase integration, each statement unmodified from the approved package and prefixed with `SET TRANSACTION READ ONLY` plus `SET LOCAL` timeouts. **These are verified hosted facts**; the E2J analysis (`e2j-default-privilege-analysis.md`) was derived from the 2026-10-16 snapshot. No GRANT, REVOKE, ALTER DEFAULT PRIVILEGES or other change was made or run. Raw output is in the protected folder `C:\Users\vikki\migration-evidence\e2jb-development\`.

## 1. Do the E2J differences still exist? Yes, all of them
| E2J claim (snapshot) | Live result |
|---|---|
| `public` schema grants `anon`/`authenticated` no USAGE; `service_role` has USAGE and CREATE | Q29_2: `{postgres=UC/postgres,service_role=UC/postgres}`. Confirmed |
| Development has no `public` default privileges | Q29_1: default ACLs exist only for `postgres` in `storage` and for `supabase_admin`/`supabase_auth_admin` in `extensions`, `realtime`, `graphql`, `graphql_public`, `auth`. **No row for schema `public`** (no `postgres`, no `supabase_admin`). Confirmed |
| 14 relations carry the captured ACLs | Q30_1: identical to the Stage B capture, owner `postgres`, RLS enabled on all 12 tables |
| `service_role` has no SELECT on 11 of the 12 tables | Q30_3: `service_role_select = true` only for `contact_inquiries` (and INSERT there); false for the other 11 |
| The eight tables read by `create-booking` are denied to `service_role` | Q30_3: `inventory_products`, `product_pricing`, `product_categories`, `product_bundles`, `product_bundle_components`, `package_inflatable_components`, `package_inflatable_eligibility`, `product_bundle_excluded_categories`: SELECT false for `service_role` |
| 27 functions are trigger functions with PUBLIC EXECUTE by default | Q30_2: 26 returned (`invoice_links_enforce_revocation` does not exist yet), all trigger functions, `proacl` empty (built-in default) |
| Schema and ACL state unchanged since Stage B | Buckets, storage policies, the 6 function body hashes, the realtime membership and the 58 ledger rows all equal the 2026-10-16 capture |

## 2. Explicit grants versus defaults, owner, role, RLS (live)
- **Owner:** all 14 relations are owned by `postgres`; migrations run as `postgres`. With no `public` default ACL, a new object gets owner-only rights; a new function falls back to PostgreSQL's PUBLIC EXECUTE.
- **Explicit grants present:** `anon` SELECT and `authenticated` SELECT/INSERT/UPDATE/DELETE on the eight catalog tables; `authenticated` DML on the two menu tables; `service_role` SELECT/INSERT/UPDATE on `contact_inquiries`; USAGE for `anon`/`authenticated`/`service_role` on both sequences.
- **Missing:** `service_role` on the eleven tables; nothing for `anon` on `contact_inquiries`, the menu tables and `order_portal_links`.
- **RLS:** enabled on every application table, none forced. `service_role` has BYPASSRLS but not the table privilege, so it is denied before RLS is considered.
- **Policies for the 12 tables (Q30_4):** admin policies for `authenticated` on all; "Public can view …" SELECT policies for `anon, authenticated` on the eight catalog tables; `contact_inquiries` has one admin SELECT policy; `order_portal_links` staff policies; the two menu tables admin policies only; none for the sequences.

## 3. Policies that matter for the schema-containment decision (Q22, live)
While `anon`/`authenticated` lack schema USAGE these are unreachable through the API. They become reachable when the containment is lifted, so they are Step 3 prerequisites:
1. `Service role full access to orders` and `Service role full access to user_roles`: role **public**, command ALL, `USING true / WITH CHECK true`. Despite the names they apply to every role that holds table privileges.
2. `Anonymous users can mark booking confirmation sent` (anon UPDATE on `orders`, with a weak check) and `Anonymous can create signatures` (anon INSERT, `true`).
3. Storage: `Anyone can upload lot pictures` (role public INSERT) and the public read policy on `event-essentials-media`. (The October storage migrations replace the storage set; the `orders` and `user_roles` policies must be checked against `20261012120000`/`20261016120000` after the rehearsal.)

## 4. Compatibility impact (verified)
| Area | Impact today |
|---|---|
| `create-booking` / `staff-order-save` catalog reads with the service-role key | **Denied** on the eight tables (permission denied before RLS). Development's Edge Functions are stubs, so it is latent; it becomes a failure when the real functions are deployed |
| `anon`/`authenticated` application access | Blocked entirely by the missing schema USAGE (containment), whatever the table grants say |
| Sequences (`nextval` for `payments.ledger_sequence`, receipts) | USAGE is held by all three roles: sufficient; no `setval` rights (unlike Production, where `anon` can `setval`) |
| Trigger functions | No effect (EXECUTE is not checked when a trigger fires) |
| Future objects after `20261018120000` | `postgres` defaults give `service_role` all rights and remove `anon`/`authenticated`; identical to Production's release-final for new objects; existing tables are not retrofitted |

## 5. Proposed minimum-permission remediation plan (not executed; coordinate with Step 3)
1. **`service_role` SELECT on the eight catalog tables** as a new reviewed migration or a reviewed one-off, applied only after the owner decides (documentation: `GRANT SELECT ON public.<table> TO service_role;` for each of the eight). Write rights only where an Edge Function is shown to write the table.
2. Leave `contact_inquiries` (SELECT/INSERT/UPDATE for `service_role` is sufficient for the intake function), `order_portal_links`, `public_menu_groups`, `public_menu_group_categories` and both sequences as captured; no grants to `anon`.
3. **Do not copy Production's default privileges** (Production's `supabase_admin` defaults and broad grants include the `anon` `setval` exposure). Keep the `20261018120000` default policy for `postgres`; confirm nothing in Development is created as `supabase_admin`.
4. At containment removal only: `GRANT USAGE ON SCHEMA public TO anon, authenticated`, `REVOKE CREATE ON SCHEMA public FROM service_role`; before that, resolve the policies in section 3 and the Step 3 list in `e2j-development-release-gates.md`.
5. Verify afterwards with Q29/Q30 and a service-role read of `product_pricing` in a rehearsal.

## 6. Security findings from this capture (reported, nothing changed)
- **Q26 = true: the demo administrator login exists in Development.** Its migration (`20251003170350`) stays prohibited from execution, and the account needs an owner security review (credential rotation and removal decisions are the owner's; G5b in the audit covers the committed password).
- The broad `public` policies in section 3.
- `Q18 = 0`: no secret-like changelog value is unredacted.
