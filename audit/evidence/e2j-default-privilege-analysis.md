# E2J: default-privilege analysis (Development versus Production)

Offline only. Evidence: the hash-verified Stage B captures (Production 2026-10-16 18:54:59 UTC, Development 18:55:20 UTC), the repository SQL, and experiments on disposable local scratch clones (`bpc_replay_e2j_*`, `tools/e2j_priv_tests.py`, results in the protected folder). **No grant, default, migration, application or hosted object was changed.** Production's existing behaviour is the reference; nothing here recommends copying Production's defaults.

## 1. Answer in brief
- The 14 relations (12 tables, 2 sequences) and 27 functions are **not objects created by the replay**. They already exist in the captured Development database with the ACLs Development gave them. The differences come from **four independent causes**:
  1. **Development has no `public` default privileges** (documented since E1; audit section Q row 20261018120000 and Step 3 item 3.3). Production's defaults (owner `postgres` and owner `supabase_admin`) gave every new table, sequence and function full rights to `anon`, `authenticated` and `service_role` at creation. Development's tables received only what each migration granted explicitly. Result: **11 of the 12 tables give `service_role` no privilege at all** (`contact_inquiries` has SELECT/INSERT/UPDATE from an explicit grant).
  2. **`20261018120000` fixes this only for future objects.** It sets `postgres` defaults in `public` to `service_role` only (and revokes `anon`/`authenticated`); existing tables are untouched. After October the *defaults* of Development and Production's release-final are identical (T1), yet the 12 older tables differ.
  3. **Production's grants are broader than the migrations ask for** (anon/authenticated/service_role on every table and sequence, plus `setval` on two sequences). Where Development is *narrower*, that is mostly a security improvement, not a defect (section 5).
  4. **The 27 functions are all trigger functions.** Production's release-final grants `service_role` EXECUTE on them (retained from Production's original default function grants; October revokes only PUBLIC, `anon` and `authenticated`); Development leaves them owner-only. **This has no runtime effect** (T4: a role without EXECUTE still fires the trigger; PostgreSQL checks EXECUTE on a trigger function only when the trigger is created).
- **One difference matters for compatibility:** `service_role` cannot read the eight catalog tables the `create-booking` Edge Function reads (T3: `permission denied for table product_pricing` in Development-after-October, 2 rows in Production's release-final).
- **A second, larger fact was already known but now measured:** the captured Development `public` schema grants `anon` and `authenticated` **no USAGE at all** and gives `service_role` **CREATE**. That is the documented schema containment (`REVOKE USAGE ON SCHEMA public FROM anon, authenticated`, audit line for refresh #1576). While it stands, every table and function grant to `anon`/`authenticated` is unreachable; its removal (Step 4 item 4.9) is when the object-level grants below start to matter.

## 2. Mechanics distinguished
| Concept | Production (captured) | Development (captured) | After October (both) |
|---|---|---|---|
| Default ACL owner `postgres`, schema `public`, tables | `postgres`, `anon`, `authenticated`, `service_role`: all table rights | none | `postgres` + `service_role` all rights; `anon`/`authenticated` revoked |
| Default ACL owner `postgres`, `public`, sequences | USAGE/SELECT/UPDATE to the same four | none | `postgres` + `service_role` |
| Default ACL owner `postgres`, `public`, functions | EXECUTE to the same four (and PUBLIC) | none (PostgreSQL built-in: PUBLIC may execute new functions) | `postgres` + `service_role`; PUBLIC revoked |
| Default ACL owner `supabase_admin`, `public` | same full grants to `anon`/`authenticated`/`service_role` | none | **unchanged in Production** (Step 3.3); absent in Development |
| Schema `public` ACL | PUBLIC, `anon`, `authenticated`, `service_role`, `postgres`, `supabase_auth_admin`: USAGE; `pg_database_owner`: CREATE | `postgres`: USAGE+CREATE; `service_role`: USAGE+CREATE; nothing for `anon`/`authenticated`/PUBLIC | unchanged by October |
| RLS | enabled on all 12 tables with policies | enabled with policies | `service_role` has BYPASSRLS but still needs the table privilege (T3) |

Which role creates the object matters: defaults apply per *creating* role. Migrations run as `postgres`; objects created from the dashboard as `supabase_admin` follow the `supabase_admin` entries, which Development lacks.

## 3. What a new object receives (T1; created as `postgres` in `public`)
| State | New table | New sequence | New function |
|---|---|---|---|
| Development as captured | `(null)` | `(null)` | `(null)` |
| Development after October | `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` | `{postgres=rwU/postgres,service_role=rwU/postgres}` | `{postgres=X/postgres,service_role=X/postgres}` |
| Production as captured | `{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` | `{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}` | `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |
| Production release-final | `{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}` | `{postgres=rwU/postgres,service_role=rwU/postgres}` | `{postgres=X/postgres,service_role=X/postgres}` |

Development-as-captured: a new table is owner-only and a new function falls back to PostgreSQL's built-in PUBLIC EXECUTE. Development-after-October and Production-release-final are **identical** for future objects.

## 4. The 14 relations, object by object
Privilege letters: `r` SELECT, `a` INSERT, `w` UPDATE, `d` DELETE, `D` TRUNCATE, `x` REFERENCES, `t` TRIGGER, `U` USAGE (MAINTAIN omitted as dump noise). Columns: Development as captured / Development after October (these are identical: October does not touch them) / Production release-final.

| Relation | Kind | Development captured = after October | Production release-final | Cause | Compatibility impact | Proposed minimum target (service_role / anon / authenticated) |
|---|---|---|---|---|---|---|
| `contact_inquiries` | table | postgres=Dadrtwx service_role=arw | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development: explicit grants only (service_role SELECT/INSERT/UPDATE); Production: defaults add anon SELECT and authenticated/service_role full | None known: the Edge Function inserts with INSERT held; no client reads the table | service_role: keep INSERT, SELECT, UPDATE (explicit, from 20260814113146); no DELETE; anon: none; authenticated: none (no client reads it; an admin console would need SELECT only, with the existing admin policy) |
| `inventory_products` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `order_portal_links` | table | postgres=Dadrtwx | postgres=Dadrtwx service_role=Dadrtwx | No explicit grant for service_role; Production default-derived | None known: no direct reader found; functions are SECURITY DEFINER | service_role: none until a direct service-role consumer exists (access is through SECURITY DEFINER functions); anon: none; authenticated: none |
| `package_inflatable_components` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `package_inflatable_eligibility` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `payments_ledger_sequence_seq` | sequence | anon=U authenticated=U postgres=Urw service_role=U | anon=Urw authenticated=Urw postgres=Urw service_role=Urw | Older sequence: Development grants USAGE only; Production grants SELECT/UPDATE too (default-derived) | None: USAGE is what `nextval` needs (T5). Production's UPDATE lets `anon` call `setval` | service_role: USAGE (as captured); anon: USAGE only if a client inserts into payments (as captured); never UPDATE; authenticated: USAGE (as captured) |
| `product_bundle_components` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `product_bundle_excluded_categories` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `product_bundles` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `product_categories` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `product_pricing` | table | anon=r authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development had no default when the table was created; no explicit service_role grant | **High**: `create-booking` (service role) reads it; denied (T3) | service_role: SELECT; anon: unchanged (as captured); authenticated: unchanged (as captured) |
| `public_menu_group_categories` | table | authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | As public_menu_groups | As public_menu_groups | service_role: none until a direct service-role consumer exists; anon: none; authenticated: keep as captured |
| `public_menu_groups` | table | authenticated=adrw postgres=Dadrtwx | anon=r authenticated=adrw postgres=Dadrtwx service_role=Dadrtwx | Development: explicit grants for authenticated only; Production default-derived (anon SELECT, service_role) | None known: the admin console uses `authenticated`, which Development grants | service_role: none until a direct service-role consumer exists; anon: none (public menu is read through a function); authenticated: keep as captured (admin console, protected by admin policies) |
| `receipt_number_seq` | sequence | anon=U authenticated=U postgres=Urw service_role=U | anon=Urw authenticated=Urw postgres=Urw service_role=Urw | Older sequence: Development grants USAGE only; Production grants SELECT/UPDATE too (default-derived) | None: USAGE is what `nextval` needs (T5). Production's UPDATE lets `anon` call `setval` | service_role: USAGE (as captured); anon: USAGE only if required by the column default for the inserting role (as captured); never UPDATE; authenticated: USAGE (as captured) |

## 5. The 27 functions
All 27 are trigger functions (`is_trigger = true` in the scratch catalog). Development after October: `{postgres=X/postgres}` for each. Production release-final: `{postgres=X/postgres,service_role=X/postgres}`.

| Function | In Development capture | In Production capture | Captured Dev grantees | Captured Prod grantees |
|---|---|---|---|---|
| `auto_create_task_status` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `auto_sync_google_calendar` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `auto_update_order_status` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `invoice_links_enforce_revocation` | no (created by October) | no | - | - |
| `log_admin_settings_change` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `log_permission_change` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `redact_sensitive_changelog_values` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `sync_invoice_links_expires_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_blackout_addresses_timestamp` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_blackout_contacts_timestamp` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_blackout_dates_timestamp` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_contact_booking_stats` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_contact_stats` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_daily_mileage_logs_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_email_template_timestamp` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_google_reviews_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_hero_carousel_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_invoice_links_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_order_portal_links_updated_at` | yes | no | PUBLIC, postgres | - |
| `update_payment_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_payments_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_public_menu_groups_updated_at` | yes | no | PUBLIC, postgres | - |
| `update_sms_template_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_transaction_receipts_updated_at` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_updated_at_column` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `update_webhook_event_timestamp` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |
| `validate_order_status_transition` | yes | yes | PUBLIC, postgres | PUBLIC, anon, authenticated, postgres, service_role |

Before October, Development's captured grantees include PUBLIC (no default existed), Production's include PUBLIC, `anon`, `authenticated`, `service_role`. The October lockdown reduces both to owner (Development) or owner + `service_role` (Production). **Proposed target: owner only**; no `service_role` EXECUTE is needed (T4).

## 6. Grants that may be inappropriate under Step 3 (reported only; Production is not modified)
1. **Production: `anon` can call `setval` on `receipt_number_seq` and `payments_ledger_sequence_seq`** (T5: `setval` returned the new value for `anon` in the release-final clone; refused in Development). Order/receipt numbering could be reset or advanced by an unauthenticated caller once schema USAGE exists, which it does in Production. Step 3 item to add.
2. Production: `anon` SELECT and `authenticated` DML on `contact_inquiries` (contact data) rely on RLS alone; `service_role` holds TRUNCATE/REFERENCES/TRIGGER on every table (unneeded).
3. Production: the `supabase_admin` default ACLs keep granting new objects to `anon`/`authenticated`/`service_role` (Step 3.3, SEC-E).
4. Development: `service_role` holds CREATE on schema `public` (T0) and, before October, new functions are PUBLIC-executable. Remove the CREATE in Step 3; October closes the function default.
5. Development: `anon` SELECT on the catalog tables is inert wherever the policies admit only admins (the policy names Q30 returns decide which); keep as captured unless the owner tightens it.

## 7. Proposed minimum-privilege target (a proposal for owner and security review; not applied anywhere)
```sql
-- Needed by the create-booking Edge Function (service role), proven locally (T3/T6):
GRANT SELECT ON public.inventory_products TO service_role;
GRANT SELECT ON public.package_inflatable_components TO service_role;
GRANT SELECT ON public.package_inflatable_eligibility TO service_role;
GRANT SELECT ON public.product_bundle_components TO service_role;
GRANT SELECT ON public.product_bundle_excluded_categories TO service_role;
GRANT SELECT ON public.product_bundles TO service_role;
GRANT SELECT ON public.product_categories TO service_role;
GRANT SELECT ON public.product_pricing TO service_role;
-- Everything else: unchanged. No GRANT to anon/authenticated. No TRUNCATE/REFERENCES/TRIGGER. No sequence UPDATE.
-- Schema containment removal (gate, Step 4 item 4.9) is a separate decision: GRANT USAGE ON SCHEMA public TO anon, authenticated; REVOKE CREATE ON SCHEMA public FROM service_role;
```
Local application of the eight SELECT grants on a scratch clone (T6): `anon` and `authenticated` privileges unchanged for all 12 tables, `service_role` read of `product_pricing` succeeds. **Alternative B (owner choice):** give `service_role` SELECT/INSERT/UPDATE/DELETE on all application tables, matching what `20261018120000` now gives future tables; this is broader than the minimum and consistent with the future-object policy. The edge functions that write these tables (staff-order-save for catalog writes) have not been traced beyond reads; the hosted Edge Function source and the real traffic decide.

## 8. Local evidence (all on disposable clones)
| Test | Result |
|---|---|
| T0 schema `public` | Dev: `anon`/`authenticated` no USAGE, `service_role` USAGE+CREATE; Prod: all four roles USAGE, none CREATE |
| T1 new-object defaults | section 3 |
| T3 service_role reads `product_pricing` | Dev after October: `ERROR:  permission denied for table product_pricing`; Production release-final: `2` row(s) |
| T4 trigger function without EXECUTE | ACL `{postgres=X/postgres,service_role=X/postgres}` (role without EXECUTE): insert result `2` (trigger fired) |
| T5 sequences | Dev after October: `anon` nextval `t`, setval `ERROR:  permission denied for sequence receipt_number_seq`; Production release-final: nextval `t`, setval `1000000` (schema USAGE was granted to `anon` in the clones to isolate the sequence privilege) |
| T6 target applied to a scratch clone | rc 0; anon/authenticated unchanged: True; service_role read afterwards: 0 |

**Assumptions that need hosted verification (Q29, Q30):** the live Development ACLs still equal the 2026-10-16 capture; the Edge Functions deployed (or to be deployed) read the tables with the service-role key; the Data API settings of the project; whether anything is created by `supabase_admin`; the real traffic on `receipt_number_seq`.

## 9. Corrections to E2I wording
E2I (`e2i-production-compatibility.md` section 6 and the report) said objects created by the release come out without the privileges and that this "may be a replay artefact". Corrected: the 14 relations and 27 functions already exist in the captured Development database; the ACL differences are real captured state, caused by the missing `public` defaults when those objects were created plus Production's broader default grants. The absence of Development `public` defaults was already documented (audit section Q and Step 3.3); E2I's contribution is the object-level measurement, the schema-level finding above and the confirmation that after October the defaults for future objects are identical in both environments.
