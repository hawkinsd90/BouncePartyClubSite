-- =====================================================================================================================
-- E2I: targeted READ-ONLY evidence plan for the Development project's remaining migration questions.
-- STATUS: NOT RUN. Nothing in this file has been executed against any hosted system. Do not run it until the owner has approved a
-- read-only access method (see the "Execution rules" below). Every statement is a single SELECT (or a catalog function call).
--
-- Execution rules (for the later, separately approved run):
--   * Target: the Development project ONLY. Never run against Production from this file (Production comparisons use the committed Stage B captures).
--   * Minimum role: a read-only database role (for example one granted pg_read_all_data, no write privileges, no BYPASSRLS needed for the
--     catalog queries). The role is named per query; "catalog" = any role that can read pg_catalog/information_schema; "table-read" = SELECT on the
--     named table (the count/boolean forms below never return a row's content); "auth-read" = SELECT on auth.users (service-level read-only).
--   * Run inside BEGIN READ ONLY; ... ROLLBACK; with a statement_timeout, one query at a time, saving the output next to a SHA-256 of this file.
--   * Every result below is a count, boolean, key NAME, definition text, or hash. No query returns customer, payment, address, message or
--     credential values. Do not paste result sets that contain anything else into the repository.
--   * "Verdict effect" says what each result changes. A result NEVER turns a data transformation into proof that the version ran: it can
--     only support or remove the case for a qualified owner attestation, or reveal that SQL is still needed.
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------------
-- Q01  Fresh ledger snapshot
-- Purpose: confirm the Development ledger still holds exactly the 58 captured versions and no row was added since Stage B.
-- Versions: every version in e2i-development-manifest.csv (the baseline for all other results). Role: catalog + SELECT on supabase_migrations.schema_migrations.
-- Returns: counts and the version/name list (no statements).
-- Verdict effect: any difference from the 58 captured rows invalidates every candidate until the captures are refreshed.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS ledger_rows, min(version) AS first_version, max(version) AS last_version
FROM supabase_migrations.schema_migrations;
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q02  Seeded setting keys present (names only)
-- Versions: 20251002210020, 20251003152224, 20251003183947, 20251007210840, 20251008144308, 20251231171420, 20260126184412, 20260126193205,
--           20260203053948, 20260224183629, 20260224184535, 20260325231020, 20251001051901 (settings keys)
-- Role: table-read on admin_settings. Returns key NAMES and a boolean for non-empty value; never the value.
-- Verdict effect: all keys present supports a qualified attestation (seed state exists); a missing key means the seed was never applied or later removed:
--   the owner must decide whether Production's behaviour needs it (then SQL or a settings entry) or the version is history-only.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT key, (value IS NOT NULL AND value <> '') AS has_value
FROM admin_settings
WHERE key IN ('admin_notification_phone','twilio_account_sid','twilio_auth_token','twilio_phone_number','admin_email','stripe_publishable_key','admin_phone',
              'business_name','apply_travel_fee_by_default','home_address_line1','home_address_lat','home_address_lng','instagram_url','facebook_url',
              'business_website','google_review_url','carousel_show_arrows')
ORDER BY key;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q03  Seeded SMS template keys
-- Versions: 20251003182356, 20251008144308, 20251205125907, 20251216201450, 20260126193254, 20260224183629
-- Role: table-read on sms_message_templates. Returns template_key names and whether the template text is non-empty.
-- Verdict effect: as Q02 (presence supports attestation; absence needs an owner decision).
-- ---------------------------------------------------------------------------------------------------------------------
SELECT template_key, (message_template IS NOT NULL AND message_template <> '') AS has_text
FROM sms_message_templates ORDER BY template_key;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q04  Seeded e-mail template names
-- Versions: 20251221225000, 20260224183629.  Role: table-read on email_templates. Returns template names only.
-- Verdict effect: as Q02.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT template_name FROM email_templates ORDER BY template_name;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q05  Catalog seed rows and unit data shape
-- Versions: 20251001052039 (sample units), 20260224165424 (types array), 20260318191352 (water price), 20260224161311 and 20260331151647 (unit_media flags).
-- Role: table-read on units, unit_media. Returns counts and booleans.
-- Verdict effect: the sample units must NOT be re-inserted; if the sample slugs exist or were intentionally replaced the version is an attestation
--   candidate; counts of NULL types / 'dry' visibility_mode show whether the backfill predicates still match.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS units_total,
       count(*) FILTER (WHERE types IS NULL) AS units_types_null,
       count(*) FILTER (WHERE slug IN ('tropical-bounce-house','castle-combo','mega-water-slide')) AS sample_slugs_present
FROM units;
SELECT count(*) AS unit_media_total,
       count(*) FILTER (WHERE visibility_mode = 'dry' AND mode IS NOT NULL AND visibility_mode IS DISTINCT FROM mode) AS visibility_backfill_pending,
       count(*) FILTER (WHERE is_featured) AS featured_rows
FROM unit_media;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q06  Hero carousel seed   | Versions: 20251207160232 | Role: table-read on hero_carousel_images | Returns: count only.
-- Verdict effect: rows exist -> attestation candidate; zero rows -> ask the owner whether the carousel is meant to be empty.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS hero_carousel_rows FROM hero_carousel_images;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q07  Google reviews seed  | Versions: 20260224133344 | Role: table-read on google_reviews | Returns: count only (no review text).
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS google_reviews_rows FROM google_reviews;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q08  Notification status seed | Versions: 20251231174711 | Role: table-read on notification_system_status | Returns: system_type names and flags.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT system_type, is_operational FROM notification_system_status ORDER BY system_type;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q09  Pricing rule row shape (configuration, no customer data)
-- Versions: 20251001051901, 20251001192425, 20251002180149, 20251130231633, 20251222014723, 20251222020729, 20260119195140, 20260311121119
-- Role: table-read on pricing_rules. Returns the row count and, per backfilled column, a boolean "equals the version's literal" plus a NULL count.
-- The result is pricing CONFIGURATION (one row), not personal data; still return booleans, not the values, in saved output.
-- Verdict effect: Production's working behaviour is the reference, so the owner compares these booleans with the Production capture; a mismatch is a
--   configuration decision, not evidence that the version ran or did not.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS pricing_rule_rows,
       count(*) FILTER (WHERE generator_price_cents IS NULL)  AS generator_price_null,
       count(*) FILTER (WHERE deposit_per_unit_cents IS NULL) AS deposit_per_unit_null,
       count(*) FILTER (WHERE deposit_percentage IS NULL)     AS deposit_percentage_null,
       count(*) FILTER (WHERE apply_taxes_by_default IS NULL) AS apply_taxes_null,
       count(*) FILTER (WHERE surface_sandbag_fee_cents IS NULL) AS sandbag_null
FROM pricing_rules;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q10  Order status/flag backfill predicates (counts only; start_date no longer exists after 20251216210332)
-- Versions: 20251007220415, 20251007221227, 20251007221817, 20251001192425, 20251130191333, 20260816221636, 20260928172217
-- Role: table-read on orders. Returns counts of rows still matching each original predicate.
-- Verdict effect: 0 supports an attestation that the state is normalised (it does not prove this version did it); a non-zero count shows the
--   backfill was never applied to those rows and the owner must decide whether to apply a corrective, separately reviewed statement.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) FILTER (WHERE status IS NULL OR status = '')              AS status_blank,
       count(*) FILTER (WHERE status = 'payment_pending')                 AS status_payment_pending,
       count(*) FILTER (WHERE deposit_required IS NULL)                   AS deposit_required_null,
       count(*) FILTER (WHERE event_end_date IS NULL)                     AS event_end_date_null,
       count(*) FILTER (WHERE payment_lock IS NULL)                       AS payment_lock_null
FROM orders;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q11  Financial backfill consistency (aggregate counts, no identifiers)
-- Versions: 20260120203953, 20260125170305, 20260125173238, 20260305205811, 20260305222010, 20260326004004
-- Role: table-read on orders (and payments for the last-four case). Returns counts of rows whose stored balance differs from the formula the later
--   version established, whose tax_waived disagrees with tax_cents, and whose payment-method fields are NULL while a succeeded payment exists.
-- Verdict effect: these are data transformations: a consistent state is not proof they ran. A mismatch count > 0 shows live inconsistent financial
--   rows and moves the version to "Actual SQL execution required" ONLY after the owner reviews each case; the executor must never run these blindly.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) FILTER (WHERE balance_due_cents IS DISTINCT FROM
         (COALESCE(subtotal_cents,0)+COALESCE(tax_cents,0)+COALESCE(travel_fee_cents,0)+COALESCE(surface_fee_cents,0)
          - COALESCE(deposit_paid_cents,0) - COALESCE(balance_paid_cents,0))) AS balance_formula_mismatch_approx,
       count(*) FILTER (WHERE tax_waived IS TRUE AND COALESCE(tax_cents,0) > 0) AS tax_waived_with_tax,
       count(*) FILTER (WHERE customer_selected_payment_cents IS NULL AND deposit_due_cents IS NOT NULL) AS selected_payment_unset
FROM orders;
SELECT count(*) AS orders_missing_last_four_with_succeeded_payment
FROM orders o
WHERE o.payment_method_last_four IS NULL
  AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'succeeded' AND p.payment_last4 IS NOT NULL);
-- NOTE: the exact balance formula is the one in 20260305222010 (tips excluded); the approximate formula above is a screening count. Before the run,
-- replace it with the formula text from that file so the count is exact.

-- ---------------------------------------------------------------------------------------------------------------------
-- Q12  Payment timestamp / ledger shape | Versions: 20251209133113, 20260311111714
-- Role: table-read on payments. Returns counts only.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) FILTER (WHERE status = 'succeeded' AND paid_at IS NULL) AS succeeded_without_paid_at,
       count(*) FILTER (WHERE status = 'failed' AND failed_at IS NULL)  AS failed_without_failed_at,
       count(*) FILTER (WHERE ledger_sequence IS NULL)                  AS ledger_sequence_null
FROM payments;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q13  Address de-duplication | Versions: 20260314213726, 20260314215031 | Role: table-read on addresses | Returns: counts only.
-- Verdict effect: zero duplicates and a populated address_key are consistent with the merges having run, or with there never having been duplicates;
--   the version stays unresolved unless the owner will attest. Destructive merges must never be executed from the ledger.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS addresses_total,
       count(*) FILTER (WHERE address_key IS NULL) AS address_key_null,
       (SELECT count(*) FROM (SELECT address_key FROM addresses WHERE address_key IS NOT NULL GROUP BY address_key HAVING count(*) > 1) d) AS duplicate_keys
FROM addresses;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q14  Customer-to-auth link | Versions: 20260302131311 | Role: table-read on customers (auth-read on auth.users for the match count) | Returns: counts only.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS customers_total, count(*) FILTER (WHERE user_id IS NOT NULL) AS customers_linked,
       (SELECT count(*) FROM customers c JOIN auth.users u ON lower(c.email) = lower(u.email) WHERE c.user_id IS NULL) AS linkable_but_unlinked
FROM customers;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q15  Contact counters | Versions: 20251008153245, 20260323155222, 20260323163432, 20260323164559
-- Role: table-read on contacts, orders. Returns the number of contacts whose stored booking count differs from the count of their non-cancelled orders.
-- Verdict effect: these are derived counters; a non-zero mismatch is a recomputation question (a separately reviewed corrective), not a history question.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS contacts_total,
       count(*) FILTER (WHERE total_bookings IS DISTINCT FROM (SELECT count(*) FROM orders o WHERE o.customer_id = contacts.customer_id AND o.status NOT IN ('cancelled','draft'))) AS booking_count_differs_from_orders
FROM contacts;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q16  Invoice partial status | Versions: 20260311191611 | Role: table-read on invoices | Returns: counts only.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) FILTER (WHERE status = 'paid' AND paid_amount_cents < total_cents) AS paid_but_underpaid FROM invoices;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q17  Webhook event records | Versions: 20260311113547 | Role: table-read on stripe_webhook_events | Returns: counts by status. No payload.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT status, count(*) AS n FROM stripe_webhook_events GROUP BY status ORDER BY status;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q18  Changelog redaction (security) | Versions: 20260323175236 | Role: table-read on admin_settings_changelog | Returns: counts only.
-- Verdict effect: a non-zero count means secrets are still readable in the changelog: that is a live exposure to fix by a reviewed statement, not a
--   reason to record anything. The query counts rows whose key is secret-like and whose value is not the redaction marker.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS secret_like_rows_not_redacted
FROM admin_settings_changelog
WHERE setting_key ~* '(secret|token|auth|password|private)' AND (old_value IS DISTINCT FROM '[REDACTED]' OR new_value IS DISTINCT FROM '[REDACTED]');

-- ---------------------------------------------------------------------------------------------------------------------
-- Q19  Role names and role constraint | Versions: 20251207163822, 20260324175546, 20260324190039
-- Role: table-read on user_roles; catalog for the constraint. Returns counts and the constraint definition.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) FILTER (WHERE role <> lower(role)) AS non_lowercase_roles, count(*) AS role_rows FROM user_roles;
SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.user_roles'::regclass AND contype = 'c';

-- ---------------------------------------------------------------------------------------------------------------------
-- Q20  Storage buckets (settings, no objects) | Versions: 20260325231044, 20260517221038, 20260324142355, 20260324150838 and the storage group
-- Role: table-read on storage.buckets (no storage.objects access). Returns bucket id, public flag, size limit, mime list.
-- Verdict effect: confirms the two bucket-settings UPDATEs are still absent (candidates for execution) and that the public/private state matches the
--   containment decision before the October bucket changes.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q21  Realtime publication membership | Versions: 20260324051459, 20260324154955 | Role: catalog | Returns: published tables.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pubname, schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY schemaname, tablename;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q22  Policy definitions for the open questions | Versions: user_roles chain (20251207163822, 20251207184549, 20251207185927), orders/storage policies
-- Role: catalog | Returns: policy names, roles, command, expressions (no row data).
-- Verdict effect: resolves whether Development's extra user_roles policies ('Users can read own role', 'Service role full access to user_roles' with
--   role public) still exist at the time of the run and whether October removes them; settles the user_roles chain verdicts and the storage group.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE (schemaname = 'public' AND tablename IN ('user_roles','orders','pending_signups_consent','order_signatures'))
   OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q23  Function and column definitions that differ from the Production capture
-- Versions: 20260611153900, 20260611184401, 20260311111714: the definition-difference items and the function bodies in e2i-production-compatibility.md
-- Role: catalog. Returns the hash of each function body (md5 of prosrc with CR removed) and the column nullability/default for the same_day_weekday_* columns.
-- Verdict effect: compare the hashes with the Production capture's src_norm_md5 to separate line-ending noise from real divergence.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, md5(replace(p.prosrc, E'\r', '')) AS body_md5_no_cr, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('find_order_id_by_prefix','get_admin_analytics','get_delivery_timing_analytics','get_public_business_settings','increment_order_refunded_cents','save_product_bundle_v2','update_pricing_rules')
ORDER BY 1, 2;
SELECT table_name, column_name, is_nullable, column_default FROM information_schema.columns
WHERE table_schema = 'public' AND column_name LIKE 'same_day_weekday_delivery_fee%' ORDER BY 1, 2;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q24  Extensions | Versions: 20260323201502 | Role: catalog | Returns: installed extensions and schemas.
-- Verdict effect: pg_net absent confirms the containment premise; if present, the calendar-sync trigger path is live and the version moves to the gate.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT extname, extnamespace::regnamespace AS schema, extversion FROM pg_extension ORDER BY extname;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q25  Auth triggers and event triggers | Versions: 20251229223230 (signup trigger), 20260315190615, 20260315202232, 20260316174421 | Role: catalog
-- Returns: user-defined triggers on auth.users and the existence of custom_email_hook / claim_order_for_approval.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('custom_email_hook','claim_order_for_approval');

-- ---------------------------------------------------------------------------------------------------------------------
-- Q26  Demo admin login present? | Versions: 20251003170350 | Role: auth-read | Returns: a boolean only (no e-mail, no row).
-- Verdict effect: true means a privileged demo login exists and must be reviewed by the owner (a security finding independent of the ledger);
--   false means the version's effect is absent and it must never be executed.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@bouncepartyclub.com') AS demo_admin_login_exists;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q27  Invoice-link types | Versions: 20260415234700 | Role: table-read on invoice_links | Returns: counts by link_type.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT link_type, count(*) AS n FROM invoice_links GROUP BY link_type ORDER BY link_type;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q28  Customer profile name backfill | Versions: 20251229223230, 20260315173745 | Role: table-read on customer_profiles | Returns: counts only.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT count(*) AS profiles_total, count(*) FILTER (WHERE first_name IS NULL) AS first_name_null FROM customer_profiles;

-- ---------------------------------------------------------------------------------------------------------------------
-- Q29  Default privileges and schema grants (platform behaviour for NEW objects)
-- Versions: every Production-pending creator that relies on default privileges instead of explicit GRANTs (14 relations in the local replay showed
--   missing anon/authenticated/service_role privileges; the local replay runs as a different owner, so the hosted behaviour must be read, not inferred).
-- Role: catalog. Returns default-ACL entries and schema USAGE/CREATE grants (role names and privilege letters only).
-- Verdict effect: decides whether the pre-October or October migrations need explicit GRANT statements for the new Development tables and sequences
--   (a separately reviewed change), or whether Development's hosted default privileges already match Production's.
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_get_userbyid(defaclrole) AS owner_role, defaclnamespace::regnamespace AS schema, defaclobjtype AS object_type, defaclacl::text AS acl
FROM pg_default_acl ORDER BY 1, 2, 3;
SELECT nspname, nspacl::text AS acl FROM pg_namespace WHERE nspname IN ('public','storage','auth','realtime') ORDER BY 1;
