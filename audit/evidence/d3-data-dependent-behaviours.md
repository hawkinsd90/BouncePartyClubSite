# D3 data-dependent behaviours of the 67 upgrade migrations (input for Stage D4)

Static scan of the migration files. A statement listed here changes, rejects or depends on existing rows when the migration runs; the D3 snapshot was schema-only, so none of it was exercised against real data. Line numbers refer to the file. Statements inside function bodies run later, when the function is called, and are only counted.

Totals by kind: CHECK constraint added (validated unless NOT VALID): 10; DELETE: 2; DML inside function bodies (runtime only): 122; FOREIGN KEY added: 1; INSERT: 9; NOT VALID (validation deferred): 5; RAISE EXCEPTION guard (DO block): 3; TRUNCATE: 7; UNIQUE index/constraint (fails on duplicate rows): 9; UPDATE: 6; VALIDATE CONSTRAINT: 1; column default change: 1; storage.buckets change: 4

## 20260716151458 add_tables_chairs_inventory_schema.sql  (development-line, data statements ins0/upd0/del0/trunc0)
- L108 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT order_items_single_reference CHECK (`
- L113 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT order_items_pricing_context_valid CHECK (`

## 20260716151549 seed_tables_chairs_data.sql  (development-line, data statements ins3/upd0/del0/trunc0)
- L9 [INSERT] `INSERT INTO admin_settings (key, value, description)`
- L18 [INSERT] `INSERT INTO inventory_products (slug, name, description, total_quantity, temp_unavailable_qty, active, public_`
- L27 [INSERT] `INSERT INTO product_bundles (slug, name, description, standalone_price_cents, addon_price_cents, standalone_en`
- L42 [INSERT] `INSERT INTO product_bundle_components (bundle_id, product_id, quantity_per_bundle)`
- L57 [INSERT] `INSERT INTO product_pricing (product_id, standalone_price_cents, addon_price_cents, standalone_enabled, addon_`

## 20260716173638 seed_event_essentials_settings.sql  (development-line, data statements ins1/upd0/del0/trunc0)
- L23 [INSERT] `INSERT INTO public.admin_settings (key, value)`

## 20260716231809 add_product_categories_and_pricing.sql  (development-line, data statements ins1/upd5/del0/trunc0)
- L57 [INSERT] `INSERT INTO product_categories (slug, name, sort_order)`
- L67 [UPDATE] `UPDATE inventory_products SET category_id = (`
- L71 [UPDATE] `UPDATE inventory_products SET category_id = (`
- L76 [UPDATE] `UPDATE inventory_products SET description = 'White folding chair'`
- L169 [RAISE EXCEPTION guard (DO block)] `RAISE EXCEPTION`

## 20260717110829 create_event_essentials_media_bucket.sql  (development-line, data statements ins1/upd0/del0/trunc0)
- L37 [INSERT] `INSERT INTO storage.buckets (`
- L37 [storage.buckets change] `INSERT INTO storage.buckets (`

## 20260722215732 correct_order_portal_links_security.sql  (development-line, data statements ins0/upd0/del0/trunc0)
- L25 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS idx_order_portal_links_order_id_unique`

## 20261009120000 secure_customer_portal_links.sql  (october, data statements ins0/upd0/del0/trunc0)
- L56 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS invoice_links_one_active_portal_per_order`

## 20261012120000 core_database_access_lockdown.sql  (october, data statements ins0/upd0/del0/trunc0)
- L471 [TRUNCATE] `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pricing_rules, public.units, publ`
- L474 [TRUNCATE] `REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE`

## 20261013120000 restrict_remaining_public_database_access.sql  (october, data statements ins0/upd0/del0/trunc0)
- L68 [TRUNCATE] `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.stripe_webhook_events FROM authen`
- L80 [TRUNCATE] `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.billing_addresses FROM authentica`
- L97 [TRUNCATE] `EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated', t.relname);`

## 20261014120000 protect_waiver_media_and_restrict_storage_access.sql  (october, data statements ins0/upd1/del0/trunc0)
- L53 [UPDATE] `UPDATE storage.buckets SET public = false WHERE id IN ('signed-waivers', 'signatures', 'physical-waivers');`
- L53 [storage.buckets change] `UPDATE storage.buckets SET public = false WHERE id IN ('signed-waivers', 'signatures', 'physical-waivers');`

## 20261015120000 protect_customer_order_photos.sql  (october, data statements ins0/upd1/del0/trunc0)
- L42 [UPDATE] `UPDATE storage.buckets SET public = false WHERE id IN ('lot-pictures', 'order-pictures');`
- L42 [storage.buckets change] `UPDATE storage.buckets SET public = false WHERE id IN ('lot-pictures', 'order-pictures');`

## 20261015123000 create_private_order_evidence_storage.sql  (october, data statements ins1/upd0/del0/trunc0)
- L33 [INSERT] `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)`
- L33 [storage.buckets change] `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)`

## 20261016120000 repair_role_assignment_and_signup_provisioning.sql  (october, data statements ins0/upd1/del1/trunc0)
- L65 [DELETE] `DELETE FROM public.user_roles a`
- L72 [UPDATE] `UPDATE public.user_roles SET role = lower(btrim(role)) WHERE role <> lower(btrim(role));`
- L75 [RAISE EXCEPTION guard (DO block)] `RAISE EXCEPTION 'user_roles contains a role outside master / admin / crew / customer; review those rows before`
- L81 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT user_roles_role_check CHECK (role IN ('master', 'admin', 'crew', 'customer'));`
- L94 [RAISE EXCEPTION guard (DO block)] `RAISE EXCEPTION 'auth.users is empty; refusing to treat every user_roles row as an orphan';`
- L97 [DELETE] `DELETE FROM public.user_roles ur`
- L101 [FOREIGN KEY added] `ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;`

## 20261018120100 secure_site_event_ingestion.sql  (october, data statements ins0/upd0/del0/trunc0)
- L37 [TRUNCATE] `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.site_events FROM authenticated;`

## 20261018120200 restrict_role_lookup_and_profile_ownership.sql  (october, data statements ins0/upd0/del0/trunc0)
- L88 [TRUNCATE] `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.customer_profiles FROM authentica`

## 20261019120000 add_payment_operations_and_single_financial_application.sql  (october, data statements ins0/upd0/del0/trunc0)
- L82 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT payments_component_amounts_check CHECK (`
- L96 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT payments_operation_requires_components_check CHECK (`
- L105 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS payments_operation_key_unique`
- L109 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_operation_per_order`
- L113 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS payments_original_payment_intent_unique`
- L117 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_session_unique`

## 20261020120000 deposit_catch_up_and_offline_payment_parity.sql  (october, data statements ins0/upd0/del0/trunc0)
- L570 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT order_custom_fees_amount_non_negative CHECK (amount_cents >= 0) NOT VALID;`
- L570 [NOT VALID (validation deferred)] `ADD CONSTRAINT order_custom_fees_amount_non_negative CHECK (amount_cents >= 0) NOT VALID;`
- L574 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT order_discounts_amounts_valid CHECK (COALESCE(amount_cents, 0) >= 0 AND COALESCE(percentage, 0)`
- L574 [NOT VALID (validation deferred)] `ADD CONSTRAINT order_discounts_amounts_valid CHECK (COALESCE(amount_cents, 0) >= 0 AND COALESCE(percentage, 0)`

## 20261021120000 server_authoritative_order_pricing_saves.sql  (october, data statements ins0/upd0/del0/trunc0)
- L49 [CHECK constraint added (validated unless NOT VALID)] `ADD CONSTRAINT orders_waived_fee_amounts_object CHECK (waived_fee_amounts_cents IS NULL OR jsonb_typeof(waived`

## 20261022120000 refund_safety_and_financial_write_authority.sql  (october, data statements ins0/upd0/del0/trunc0)
- L63 [column default change] `ALTER TABLE public.order_refunds ALTER COLUMN ledger_version SET DEFAULT 2;`
- L69 [CHECK constraint added (validated unless NOT VALID)] `ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_amount_positive CHECK (amount_cents > 0) NOT VAL`
- L69 [NOT VALID (validation deferred)] `ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_amount_positive CHECK (amount_cents > 0) NOT VAL`
- L73 [NOT VALID (validation deferred)] `CHECK (operation_key IS NULL OR (operation_index IS NOT NULL AND request_amount_cents IS NOT NULL AND provider`
- L77 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_operation_unique`
- L80 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS order_refunds_provider_refund_unique`
- L87 [UNIQUE index/constraint (fails on duplicate rows)] `CREATE UNIQUE INDEX IF NOT EXISTS payments_refund_event_unique ON public.payments (stripe_refund_id) WHERE str`

## 20261023120000 refund_allocation_schema.sql  (october, data statements ins0/upd0/del0/trunc0)
- L57 [CHECK constraint added (validated unless NOT VALID)] `ALTER TABLE public.order_refunds ADD CONSTRAINT order_refunds_allocation_shape CHECK (`
- L83 [NOT VALID (validation deferred)] `) NOT VALID;`
- L87 [VALIDATE CONSTRAINT] `ALTER TABLE public.order_refunds VALIDATE CONSTRAINT order_refunds_allocation_shape;`

