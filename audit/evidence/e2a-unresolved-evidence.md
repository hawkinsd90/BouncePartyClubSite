# E2A unresolved evidence and the exact read-only queries that would resolve it

Everything below is **prepared, not executed**: E2A contacted no hosted system. Each query is read-only and returns counts, booleans or catalog definitions only; no customer, payment or authentication rows. Run them only in a separately authorized evidence capture and inside the 24 h freshness window, with the approved G1 read-only method (direct `psql`, `default_transaction_read_only=on`, no Supabase CLI).

## A. Definitions the heuristic could not match (object exists, definition differs from every migration in its chain)

These are real differences or limits of token-set matching; they keep the owning version at class P. Query to read the live definition:

| Environment | Version | Object | Reason | Read-only query |
|---|---|---|---|---|
| Production | `20251202171808` | col `order_signatures.signer_phone` | notnull differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.order_signatures'::regclass AND a.attname='signer_phone';` |
| Production | `20251215015109` | policy `orders.Anonymous users can mark booking confirmation sent` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='Anonymous users can mark booking confirmation sent';` |
| Production | `20251231161729` | policy `storage.objects.Customers can view own order pictures storage` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='storage' AND policyname='objects.Customers can view own order pictures storage';` |
| Production | `20260311111714` | col `payments.ledger_sequence` | default differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.payments'::regclass AND a.attname='ledger_sequence';` |
| Production | `20260314213726` | index `addresses_address_key_unique` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='addresses_address_key_unique';` |
| Production | `20260317201616` | policy `pending_signups_consent.Anon can insert for freshly created user` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='pending_signups_consent' AND policyname='Anon can insert for freshly created user';` |
| Production | `20260722172048` | constraint `orders.orders_surface_check` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND conname='orders_surface_check';` |
| Development | `20251001051901` | col `order_items.wet_or_dry` | notnull differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.order_items'::regclass AND a.attname='wet_or_dry';` |
| Development | `20251202171808` | col `order_signatures.signer_phone` | notnull differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.order_signatures'::regclass AND a.attname='signer_phone';` |
| Development | `20251215015109` | policy `orders.Anonymous users can mark booking confirmation sent` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname='Anonymous users can mark booking confirmation sent';` |
| Development | `20260311111714` | col `payments.ledger_sequence` | default differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.payments'::regclass AND a.attname='ledger_sequence';` |
| Development | `20260314213726` | index `addresses_address_key_unique` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='addresses_address_key_unique';` |
| Development | `20260317201616` | policy `pending_signups_consent.Anon can insert for freshly created user` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='pending_signups_consent' AND policyname='Anon can insert for freshly created user';` |
| Development | `20260611153900` | col `pricing_rules.same_day_weekday_delivery_fee_cents` | notnull differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.pricing_rules'::regclass AND a.attname='same_day_weekday_delivery_fee_cents';` |
| Development | `20260611153900` | col `orders.same_day_weekday_delivery_fee_cents` | notnull differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.orders'::regclass AND a.attname='same_day_weekday_delivery_fee_cents';` |
| Development | `20260611153900` | col `orders.same_day_weekday_delivery_fee_waived` | notnull differs from every definition in the chain | `SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.orders'::regclass AND a.attname='same_day_weekday_delivery_fee_waived';` |
| Development | `20260716151458` | policy `inventory_products.Public can view active visible products` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='inventory_products' AND policyname='Public can view active visible products';` |
| Development | `20260716151458` | policy `product_pricing.Public can view pricing of active visible products` | object exists but matches no definition in the chain (drift or heuristic limit) | `SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='product_pricing' AND policyname='Public can view pricing of active visible products';` |

## B. Effects absent from the captured catalog that need an owner decision or execution

- **Production:** 48 unrecorded pre-October versions have at least one absent statement ({'P': 22, 'X': 18}).
- **Development:** 21 unrecorded pre-October versions have at least one absent statement ({'P': 15, 'X': 4}).

Development versions with absent statements (the full statement-level rows are in `e2a-dev-proof.csv`, columns `absent_or_unmatched_objects`):

- `20251008190000` 037_setup_unit_images_storage.sql: class P; policy storage.objects.Public can view unit images
- `20251129190013` setup_public_assets_storage.sql: class P; policy storage.objects.Public assets are publicly accessi; policy storage.objects.Authenticated users can update pub; policy storage.objects.Authenticated users can delete pub
- `20251129190039` allow_anon_upload_public_assets.sql: class P; policy storage.objects.Anyone can upload public assets
- `20251202171808` 20251202000000_create_order_signatures_system.sql: class P; policy storage.objects.Authenticated users can upload sig; policy storage.objects.Anonymous users can upload signatu; policy storage.objects.Users can view own signatures (+5 more)
- `20251207163822` add_role_hierarchy_and_oauth.sql: class P; constraint user_roles.user_roles_role_check
- `20251207184549` fix_circular_rls_dependency.sql: class P; policy user_roles.Users can read own role; policy user_roles.Service role full access to user_roles
- `20251229223230` update_customer_profiles_names.sql: class P; trigger auth.users.on_auth_user_created
- `20251230184228` fix_carousel_storage_policies.sql: class P; policy storage.objects.Anyone can view carousel media
- `20251231161729` create_order_pictures_system.sql: class P; policy storage.objects.Customers can view own order pictu; policy storage.objects.Anyone can upload order pictures s
- `20260315190615` add_branded_signup_confirmation_hook.sql: class X; grant FUNCTION:custom_email_hook:supabase_auth_admin:EXE
- `20260315202232` fix_email_hook_direct_resend_call.sql: class X; grant FUNCTION:custom_email_hook:supabase_auth_admin:EXE
- `20260316174421` restore_postgres_custom_email_hook.sql: class X; function custom_email_hook; grant FUNCTION:custom_email_hook:supabase_auth_admin:EXE
- `20260323201502` add_google_calendar_auto_sync_trigger.sql: class P; extension pg_net
- `20260324012349` create_signed_waivers_storage_bucket.sql: class P; policy storage.objects.Signed waivers are publicly readab; policy storage.objects.Admins can upload signed waivers
- `20260324180043` fix_all_rls_policies_lowercase_roles.sql: class P; policy storage.objects.Admins can upload carousel media; policy storage.objects.Admins can update carousel media; policy storage.objects.Admins can delete carousel media (+6 more)
- `20260324191543` add_atomic_approve_order_rpc.sql: class P; grant FUNCTION:claim_order_for_approval:authenticated:EX
- `20260324193222` add_assign_role_by_email_and_get_all_role_users.sql: class P; grant FUNCTION:assign_role_by_email:public:ALL; grant FUNCTION:get_all_role_users:public:ALL
- `20260501173826` add_billing_addresses_table.sql: class P; inline-constraint billing_addresses.source:CHECK
- `20260611184401` create_update_pricing_rules_rpc.sql: class X; function update_pricing_rules

## C. Data and dynamic statements (cannot be proven from a schema-only capture)

- **Production baseline (40 files):** 15 versions, 25 unprovable statements. The per-statement read-only query is in the `readonly_queries_needed` column of `e2a-prod-baseline-proof.csv`.
- **Development pre-October (306 files):** 73 versions, 95 unprovable statements. The per-statement read-only query is in the `readonly_queries_needed` column of `e2a-dev-proof.csv`.

Typical pattern and how to read the result: a seed `INSERT ... VALUES ('key', ...)` is checked with `SELECT count(*) FROM t WHERE first_column IN (keys...)` and should return the number of keys; a backfill `UPDATE ... WHERE <condition>` is checked with `SELECT count(*) FROM t WHERE <condition>` and a result of 0 supports (but does not prove) that it ran; a `DELETE` is checked the same way. A count never proves the original SQL ran, because the rows could have been created or removed by other means; it only supports a schema-and-data-equivalence reconciliation record.

## D. Recorded SQL texts for statement-level confirmation (optional)

Stage B stored digests of each recorded `statements` array, not the text. E2A used digest equality (comment-insensitive) between each recorded row and its repository file, which is strong evidence but not a text diff. To obtain the stored text for the identity cases:

```sql
SELECT version, name, statements FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260305205811','20260408200431');   -- Production
 -- and on Development:
SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version = '20260814002658';
```

## E. Global constraints

- Every verdict is tied to the 2026-10-16 18:54-18:55 UTC captures; nothing here describes a current hosted state.
- Definition matching is token-set based for policies, constraints, indexes and column defaults; a match is strong evidence but not a byte comparison. Functions are matched by the Stage B body digests.
- PostgreSQL truncates identifiers to 63 bytes; E2A applies that rule when keying objects (this corrected a Stage B misreading of two Development policies).
- Applied-by-whom and when cannot be recovered from catalogs; E2A therefore reports 'schema-equivalent' candidates, never 'the SQL ran'.
