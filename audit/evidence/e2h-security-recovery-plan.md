# E2H security review of the intermediate states and targeted recovery plan

**Documentation and local-scratch evidence only.** No migration SQL, security policy or hosted system was changed. All measurements ran on disposable local PostgreSQL databases cloned from the restored pre-upgrade Production schema, driven through the local executor with synthetic data (`e2h-failure-test-results.json`: H-X01 to H-X08; raw per-step data in the protected scratch folder). The containment SQL below is **documentation only**; the executor never contains it, and it was applied only to scratch databases to prove its properties.

## 1. Context that changes the reading of "broader than the start"
The starting state is the current Production schema, and it is already broad. An anonymous-role probe (`SET LOCAL ROLE anon`, synthetic arguments, every call rolled back) classified every anonymous-executable `public` function at four states:
| State | Anonymous-executable functions | Call succeeded for anon (returned rows or empty) | Refused with an authorization error | Other error (inconclusive) |
|---|---|---|---|---|
| Start (current Production) | 68 | **30** (26 + 4) | 6 | 32 |
| After `20260820165646` (widest by function count, 79) | 79 | 33 | 12 | 34 |
| After `20261008120000` (the state of a failure at `20261009120000`) | 69 | 23 | 14 | 32 |
| Final (after `20261025120000`) | 6 | 4 | 0 | 2 |
"Call succeeded" means the function ran for an anonymous caller with synthetic arguments; it does not by itself prove a data disclosure. The 30 at the start include SECURITY DEFINER financial and administrative functions (for example `apply_balance_payment_financials`, `claim_balance_payment_financials`, `increment_order_refunded_cents`, `update_pricing_rules`, `get_admin_analytics`, `get_admin_users`, `get_user_role`, `is_admin`) that the October migrations remove from `anon`. In addition, 26 `public` tables are effectively writable by anonymous callers at the start (RLS enabled with an anon/public write policy; none has RLS disabled). **The largest exposure is therefore the unfinished state of the current Production, not an increment introduced by the release; an interrupted release leaves the existing exposure in place for longer.** The numbers below describe the increment.

## 2. Exactly what broadens, and which migration is responsible (per-step capture, 58 stops)
| After migration | Anonymous-executable functions added | Tables given anon INSERT/UPDATE/DELETE privilege (RLS on, no anon write policy: inert) |
|---|---|---|
| `20260716151458` | none | `inventory_products`, `product_bundle_components`, `product_bundles`, `product_pricing` |
| `20260716152447` | `check_product_availability` (intended public) | none |
| `20260716231809` | none | `product_categories` |
| `20260717111014` | `reorder_product_categories`, `save_inventory_product`, `save_product_bundle`, `save_product_category` (all refuse anon: "Unauthorized") | none |
| `20260718000744` | none | `package_inflatable_components`, `package_inflatable_eligibility`, `product_bundle_excluded_categories` |
| `20260718000923` | `save_inventory_product_v2`, `save_product_bundle_v2` (refuse anon) | none |
| `20260722211023` | **`create_portal_short_link`** (PUBLIC grant; call succeeds for anon) | none |
| `20260722212750` | **`create_order_short_link`** (anon grant; call succeeds for anon), `update_order_portal_links_updated_at` (trigger function) | `order_portal_links` |
| `20260722215732` | **`resolve_portal_short_link`** (PUBLIC grant; call succeeds for anon) | (one privilege removed) |
| `20260814120000` | none | `contact_inquiries` |
| `20260929145842` | `get_public_nav_menu_groups` (intended public), `update_public_menu_groups_updated_at` | `public_menu_group_categories`, `public_menu_groups` |
| `20260929151836` | `reorder_menu_group`, `save_menu_group` (refuse anon) | none |
| `20261009120000` | `invoice_links_enforce_revocation` (trigger function) | none |
Totals: 16 functions added over the window (peak 83 anonymous-executable functions after `20260929151836`); 14 tables with inert new privileges; **no table became effectively anonymous-writable at any stop** (effective count 26 at the start, never above 26).

## 3. Intended temporary schema state versus actual exploitable access
- **Intended and inert (no action needed):** the new table privileges (RLS blocks anonymous writers: no anon/public write policy), the guarded product and menu RPCs (refuse anon with an authorization error), trigger functions (cannot be called as functions), and the two functions meant to be public at the end (`check_product_availability`, `get_public_nav_menu_groups`).
- **Actually callable by an anonymous caller and new in the window (3 functions):** `create_portal_short_link(text)`, `create_order_short_link(uuid)` and `resolve_portal_short_link(text)`. In the probe each succeeded for anon with a synthetic order id/code. They are the whole incremental *callable* exposure of the release: from `20260722211023` until `20261012120000` (the first two portal functions are removed there) and `20261013120000` (`create_order_short_link` is removed there). The probe does not show what an attacker could mint or read beyond "the call is accepted"; treat them as exploitable until proven otherwise.
- The anonymous INSERT into `invoice_links` was rejected at every stop and failure point (no open policy: the omitted pair is never created).

## 4. The exact points where the October restrictions close the exposure
| Migration | Anonymous access removed |
|---|---|
| `20261007120000` | 9 functions: `apply_balance_payment_financials`, `claim_balance_payment_financials`, `find_order_id_by_prefix`, `get_signature_status`, `increment_order_refunded_cents`, `order_has_valid_signature`, `record_cash_payment`, `record_check_payment`, `update_pricing_rules` |
| `20261008120000` | 5 functions: `check_expiring_cards`, `cleanup_old_rate_limits`, `get_admin_analytics`, `get_admin_users`, `get_user_creation_logs` |
| `20261010120000` | `upsert_contact_from_checkout` |
| `20261012120000` | 8 functions (`approve_order_changes`, `archive_old_orders`, **`create_portal_short_link`**, `get_order_by_token`, `get_order_with_relations_by_token`, `get_user_order_prefill`, **`resolve_portal_short_link`**, `save_lot_picture_to_address`) and anonymous write access on 22 of the 26 effectively writable tables (26 to 4; tables carrying the privilege 65 to 39) |
| `20261013120000` | 55 functions (61 to the final 6), including **`create_order_short_link`**, the guarded product/menu RPCs, `assign_role_by_email`, `get_user_role`, `is_admin`, `check_rate_limit`, `record_notification_*`; effectively writable tables 4 to 2, tables carrying the privilege 39 to 2 |
| `20261018120100` | `site_events` (effectively writable tables 2 to the final 1) |
So the release-introduced callable exposure (the three portal functions) closes at `20261012120000` / `20261013120000`; the start-state exposure is tightened progressively from `20261007120000`.

## 5. Which privileges can be restricted safely during a failure, and which cannot
- **Safe without disrupting migration operations:** the migrations run as the owning role and never call functions as `anon`, so revoking `anon` (or `PUBLIC`, with explicit grants to `authenticated` and `service_role`) on the three new portal functions changes nothing the remaining migrations need. Tested: containing them and then resuming produced a final catalog and final function/table ACLs **identical to an uncontained run** (H-X08C1, H-X08C2).
- **Not to be restricted by a recovery script:** start-state functions the live site may use before the October coordination (their removal is the job of the October migrations, in the required deployment order); the two intended-public functions; any table privilege (inert).
- **No blanket REVOKE:** the experiments touched exactly 3 functions and 0 tables (H-X06C1, H-X06C2: "changed set equals targets").

## 6. Edge Function and application coordination (static search of `src` and `supabase/functions`; call sites found, anon-versus-authenticated usage not determined)
Functions that lose anonymous access and still have callers: `record_cash_payment`, `record_check_payment` (Edge Functions `record-cash-payment`, `record-check-payment`; service-role path expected), `find_order_id_by_prefix` (`SingleOrderView.tsx`), `get_admin_analytics` (`useAdminAnalytics.ts`), `archive_old_orders` (`OrdersManager.tsx`), `get_user_order_prefill` (`useCheckoutData.ts`), `save_lot_picture_to_address` (`PhotoDetailModal.tsx`); at `20261013120000`: `assign_role_by_email`/`get_all_role_users` (`PermissionsTab.tsx`), `generate_invoice_number` (`InvoicesList.tsx`, `orderApprovalService.ts`), `get_unresolved_failures_count`/`record_notification_*` (`notificationFailures.ts`, Edge Functions `send-email`, `send-sms-notification`, `submit-contact-inquiry`), `check_rate_limit` (`_shared/rate-limit.ts`), `get_user_role` (`promote-media`, `upload-physical-waiver`), `save_*`/`reorder_*` product and menu RPCs (`products.ts`, `useMenuGroupsData.ts`), `get_booking_source_analytics`, `get_delivery_timing_analytics`. **Each caller must be confirmed to use an authenticated or service-role client before the migration that removes `anon` runs**; a caller using the anonymous client breaks at that migration. `customer-cancel-order` (service-role client) must ship with or before `20261012120000`; signed-URL consumers before `20261014120000`/`20261015120000`. These are deployment gates, not part of the executor.

## 7. Targeted recovery plan for a failure or pause before the restrictions are reached
| Where the run stops | State | Plan |
|---|---|---|
| Before `20260716151458` | no widening (start state) | resume or stop; nothing to contain |
| `20260716151458` to `20260722172048` | inert table privileges, guarded RPCs, `check_product_availability`; **no new callable exposure** | resume when the cause is fixed; containment unnecessary |
| `20260722211023` to `20261011120000` | **three new callable portal functions** until their removal at `20261012120000`/`20261013120000`; start-state exposure still partly open until `20261007120000` | (1) fix the cause and resume (preferred); (2) if the pause will be long, apply the targeted containment below, then resume; (3) last resort: restore from the verified backup |
| After `20261012120000` | not broader than the start for the new functions; remaining start-state exposure closes at `20261013120000` | resume; no containment |
Before any containment, take the ACL snapshot of the objects (the generator below derives both scripts from the snapshot). After the run is complete, no restore is needed: the later migrations leave the same final ACLs (tested). The restore script exists for the case that the run is abandoned and the original state must be reinstated.
Preventive step: run the prepared Production data preflight before the window; the three failure causes tested (duplicate active portal link, role outside the vocabulary, order item without exactly one reference) each correspond to a preflight check.

## 8. Containment SQL (DOCUMENTATION ONLY; generated from the scratch state "interrupted after 20260820165646", which is also the state of a lock-timeout failure at `20260925151621`)
```sql
-- CONTAIN (3 functions; no table, policy or other function is touched)
REVOKE EXECUTE ON FUNCTION public.create_order_short_link(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_portal_short_link(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_portal_short_link(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.create_portal_short_link(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_portal_short_link(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_portal_short_link(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_portal_short_link(text) FROM anon;

-- RESTORE (exact original privileges of the same three functions, from the pre-containment ACL snapshot)
REVOKE EXECUTE ON FUNCTION public.create_order_short_link(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_order_short_link(uuid) TO anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.create_portal_short_link(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_portal_short_link(text) TO PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_portal_short_link(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_portal_short_link(text) TO PUBLIC, anon, authenticated, service_role;
```
Properties shown on scratch databases (H-X05 to H-X08, states C1 = failure at `20261009120000`, C2 = pause after `20260820165646`): anonymous-callable functions go from 33 to 30 (C2; the start has 30) and from 23 to 20 (C1); the generated RESTORE returns function and table ACLs to the identical pre-containment snapshot; contain, fix the cause, resume gives a final catalog and final ACLs equal to an uncontained run. **The script is regenerated from a fresh ACL snapshot at the moment of use; the one above is an example, not an approved script.** Applying it to any hosted database is a hosted write needing its own approval.

## 9. Unresolved prerequisites
1. Owner choice of the recovery order (resume, targeted containment, restore) and who may execute containment (U-E2E-5).
2. Confirmation that no anonymous client depends on the three portal functions between `20260722211023` and `20261012120000` (the live site's use of `create_portal_short_link`, `create_order_short_link`, `resolve_portal_short_link` was not traced; revoking them in a pause could break a customer-portal flow that currently works).
3. Anonymous-versus-authenticated usage of every caller in section 6, and the deployment order for the October restrictions.
4. Real-traffic behavior: locks and retries on a busy database; hosted role privileges to run grants on the platform schemas.
5. Production start-state exposure (30 anonymous-callable functions, 26 effectively writable tables) remains until the October migrations run; that is a standing finding independent of the executor.
