# E2K: Step 3 / Step 4 security and application handoff

Nothing below was fixed in E2K. Provenance tags: **[LIVE]** verified on hosted Development by the E2J-B read-only capture (2026-10-17, transcribed results); **[SNAP]** Stage B catalog snapshot (2026-10-16) or earlier audit sections, not re-verified live; **[LOCAL]** observed on disposable local replays; **[REPO]** read from repository SQL or code. Production was not queried in E2J-B; every statement about Production is [SNAP] or [LOCAL] and is not a current verification.

## 1. Development schema containment
- [LIVE] `public` schema ACL is `{postgres=UC, service_role=UC}`: `anon` and `authenticated` have no USAGE, and `service_role` can CREATE. Table grants to `anon`/`authenticated` are therefore unreachable through the API.
- [SNAP] This is the deliberate `REVOKE USAGE ON SCHEMA public FROM anon, authenticated` of the earlier containment (audit section on refresh #1576); Step 4 item 4.9 removes it only after the release is verified.
- Handoff (Step 3 decides the end state; Step 4 executes): remove only after sections 2 to 6 below are closed. End state proposal: `GRANT USAGE ON SCHEMA public TO anon, authenticated`; `REVOKE CREATE ON SCHEMA public FROM service_role`. Reversible by the opposite statements.

## 2. Broad `orders` and `user_roles` policies (and other open policies)
| Policy | Evidence | Disposition path |
|---|---|---|
| `Service role full access to user_roles` (role public, ALL, true/true) | [LIVE] present | [REPO] dropped by `20261008120000`; verify after the October rehearsal |
| `Service role full access to orders` (role public, ALL, true/true) | [LIVE] present | [REPO] explicitly left untouched by `20260421025937` ("used by edge functions"); **no October file drops it**. Because the role is *public*, it applies to any role holding table privileges. Step 3 decision: restrict to `service_role` (a new migration, not an edit of history) or prove it unreachable |
| `Anonymous users can mark booking confirmation sent` (anon UPDATE on orders, weak WITH CHECK) | [LIVE] present | [REPO] left in place "for now" by `20260421025937`; Step 3 |
| `Anonymous can create signatures` (anon INSERT, true) | [LIVE] present | Step 3 (the signature flow may need it; confirm with the real function) |
| `Anon can insert for freshly created user` (`pending_signups_consent`) | [LIVE] present | existing Step 3.4 acceptance |
| `Anyone can upload lot pictures` (public INSERT on storage) | [LIVE] present | replaced by the October storage set [REPO]; verify with Q22 after |
| `Users can read own role` duplicate | [LIVE] present | harmless duplicate [LOCAL] |
Note: whether Production carries the same `orders` policy is [SNAP]/[LOCAL] only and is out of scope for any Production change here; it should be raised as a Step 3 finding for the owner.

## 3. `service_role` SELECT on eight catalog tables
[LIVE] `has_table_privilege('service_role', …, 'SELECT')` is false for `inventory_products`, `product_pricing`, `product_categories`, `product_bundles`, `product_bundle_components`, `package_inflatable_components`, `package_inflatable_eligibility`, `product_bundle_excluded_categories`; true only for `contact_inquiries` among the twelve checked. [REPO] `create-booking` (service-role client) selects the first four directly and the others through the bundle select.
Handoff: a new reviewed migration (Step 3 or 4) with `GRANT SELECT ON public.<table> TO service_role;` for the eight tables; no write grants unless a function that writes them is identified; no grants to `anon`/`authenticated`. [LOCAL] the grant restores a service-role read and leaves `anon`/`authenticated` unchanged. Validate with a service-role read in a rehearsal and with Q30 afterwards.

## 4. Default privileges
- [LIVE] No default ACL rows for schema `public`; defaults exist only for `postgres` in `storage` and for `supabase_admin`/`supabase_auth_admin` in other platform schemas. New objects are owner-only; new functions fall back to PUBLIC EXECUTE.
- [REPO] `20261018120000` sets `postgres` defaults in `public` (revoke `anon`/`authenticated`, grant `service_role`); [LOCAL] after it, Development and Production's release-final give identical defaults to new objects; existing objects are not retrofitted.
- Do not copy Production's `supabase_admin` defaults (existing Step 3.3). Confirm that nothing in Development is created as `supabase_admin` (SQL editor/dashboard objects).

## 5. Demo-admin account
[LIVE] The login exists (Q26 = true). [REPO] `20251003170350` creates it and embeds a committed demo password (G5b). The migration stays prohibited from execution. Step 3: confirm rotation, decide removal or restriction, and run the proposed Q34 (booleans: ever signed in, signed in within 90 days, roles) to learn whether it is in use. Do not use the committed credential for any login.

## 6. Remaining anonymous-function and sequence privileges
- Functions: [LIVE] the 26 trigger functions have no explicit ACL (PUBLIC EXECUTE by default; no runtime effect, unreachable while the schema is contained). [SNAP] the wider anon-executable function inventory (Development 75/82 in Step 3.2) was **not** re-queried in E2J-B; Step 3 must refresh it before the schema is reopened.
- Sequences: [LIVE] `payments_ledger_sequence_seq` and `receipt_number_seq` give `anon`/`authenticated`/`service_role` USAGE only (no `setval`). [LOCAL] Production's release-final lets `anon` call `setval` on both (a Production finding; Production not queried or changed).

## 7. Private Storage bucket behavior
[LIVE] Public: `carousel-media`, `event-essentials-media`, `order-pictures`, `unit-images`. Private: `lot-pictures`, `physical-waivers`, `public-assets`, `signatures`, `signed-waivers`. `carousel-media` and `public-assets` have no size/MIME limits (the two execution candidates). Six storage policies exist, matching the capture. [REPO] October flips `order-pictures` and `lot-pictures` to private and replaces the policy set. Application consequence (Step 4/6): anything that reads private buckets by public URL breaks; the portal and crew flows must use signed URLs through the Edge Functions listed in section 8. `public-assets` is private in Development but public in Production [SNAP]: decide which behaviour Development should test.

## 8. Edge Function deployment order
[REPO] (audit R.2 4.1 to 4.3, 4.7): deploy-first set before the October files that need it: waiver functions (before `20261014120000`), `customer-portal-*` and `task-evidence` (before `20261015120000`/`20261015123000`), `record-site-event` (before `20261018120100`), `staff-order-save` (with `20261021…`), `complete-booking` and `create-booking` (with `20261010120000`, `20261017…`), `stripe-refund` (with `20261022…`/`20261024…`); replace the 14 stubs; JWT-setting changes for `save-payment-method-from-session`, `stripe-checkout`, `save-signature`; retire `send-booking-confirmation`; identify the caller of `get_admin_users` before `20261008120000`. None was changed in E2K and the live deployment state was not queried.

## 9. Financial RPC and booking workflow validation (Step 4 rehearsal, Step 6 acceptance)
Use synthetic data only: (a) the E2D financial-safety harness (`e2d-financial-integrity.json`) re-run against the Development schema after October; (b) a `create-booking` read of the eight catalog tables with a service-role client after the grant; (c) payment-lock and balance RPCs (`apply_balance_payment_financials`, refund increments) with authorization checks from `20261007120000`; (d) the three portal short-link functions (containment SQL prepared per `e2h-security-recovery-plan.md`); (e) browser acceptance (Step 6). No payment provider is called in any rehearsal.

## 10. What is verified versus inferred
Verified live: sections 1 (ACL), 2 (policy presence), 3, 4 (absence of defaults), 5 (existence), 7 (bucket states). Inferred or older: the effect of October files, the anon-executable function inventory, every Production statement, Edge Function state.
