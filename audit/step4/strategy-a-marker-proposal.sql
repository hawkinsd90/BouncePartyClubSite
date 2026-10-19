-- ============================================================================================================================
-- PROPOSAL ONLY. DO NOT RUN. Step 4A.7 (local, unapproved, corrected in the Step 4A.7 review).  Nothing here has been executed anywhere.
--
-- Strategy A marker rows for the 13 unresolved historical migrations of the Development ledger. Every row says NOT EXECUTED.
-- It is a template: the placeholders {{RUN_ID}}, {{ATTESTED_BY}}, {{ATTESTED_AT}}, {{AUTHORIZATION_ID}}, {{DENYLIST_EXCEPTION_APPROVAL_ID}},
-- {{EXPECTED_BASE_COUNT}} and {{BASE_LEDGER_SHA256}} are deliberately unfilled and no signature, date or authorization id exists. While any
-- placeholder remains the block below raises an exception before it writes anything, so running this file by mistake changes nothing.
-- TRANSPORT: this file is plain PostgreSQL and ONE statement (a DO block, atomic by itself). It contains no psql meta-command (no line starts
-- with a backslash), no BEGIN/COMMIT and no client variable, so it runs unchanged through any channel that can send SQL: psql (-f file, or -f - on
-- stdin as the Step 4 executor does) or an SQL API call that sends the text as one query. The placeholders are replaced BEFORE sending (the
-- filled text is what the owner's authorization hashes). Recommended invocation:  psql -X -v ON_ERROR_STOP=1 -1 -f <filled file>
-- The -v flag only makes the exit code non-zero on failure; the safety does not depend on it, because a failing DO block writes nothing.
--
-- IMPORTANT LIMITATION (read before approving): the Supabase CLI and the GitHub integration decide "applied or pending" from the
-- presence of a ROW with the file's version in supabase_migrations.schema_migrations. They do not read the marker text. After these rows
-- exist the CLI treats all 13 files as applied, even though the marker says NOT EXECUTED. The wording protects humans and audits only.
-- A DATABASE BUILT FROM THE FILES (no ledger) STILL EXECUTES ALL 13 FILES.
--
-- WHICH DATABASE THIS MAY RUN ON. A Supabase database cannot tell SQL which project it belongs to (a read-only check of the Development
-- project found no setting that exposes the project reference), so the project is bound OUTSIDE this file by the hosted authorization
-- document, which names project srxunxiytojjsuhcmzjg and the connection used. Inside the database the block verifies Development-only
-- facts instead of trusting the database name: (1) the ledger holds the remote-only alias row 20260814002658, which Production does not;
-- (2) none of the 13 versions has a row (Production already records 10 of them, so this block refuses to run there); (3) the exact row
-- count and a SHA-256 of the whole sorted ledger equal the values the owner approved; (4) the database is named postgres.
--
-- REQUIRED ORDER (the block refuses to run out of order). Already in the ledger: the Step 2 bookkeeping, the 28 sealed-package versions
-- (executor, S2-S7), the alias-reconciliation row for 20260814120000 (O2) and the remote-only alias row 20260814002658. After this block:
-- the compatibility versions 20260324175545 and 20260615175815. The base count and hash approved for this block must be taken AFTER the
-- alias rows exist, because any ledger write before it changes them.
--
-- DENY-LIST EXCEPTIONS: 20251001052039, 20260125173238, 20260305222010 (blocked_no_safe_rule) and 20260611184401 (excluded_pending_owner)
-- may be recorded only with a SEPARATE owner approval id in {{DENYLIST_EXCEPTION_APPROVAL_ID}}; the other nine markers must not carry it.
-- The deny list itself (audit/development-execution-deny.json) is not changed.
--
-- Rollback: delete the row of one version inside a transaction (rows are never edited). Deleting a row makes that file pending again;
-- for the dangerous versions that exposes it to a standard push, so only do it while Deploy to production is OFF.
-- ============================================================================================================================
DO $proposal$
DECLARE
  v_expected_base   int  := NULLIF('{{EXPECTED_BASE_COUNT}}', '{{' || 'EXPECTED_BASE_COUNT}}')::int;
  v_base_sha256     text := '{{BASE_LEDGER_SHA256}}';
  v_allow           text[] := ARRAY['20251001051901', '20251001052039', '20251001192425', '20260125173238', '20260126193205', '20260224133344', '20260224161311', '20260224183629', '20260224184535', '20260305222010', '20260311113547', '20260315173745', '20260611184401'];
  v_deny_exception  text[] := ARRAY['20251001052039', '20260125173238', '20260305222010', '20260611184401'];
  v_deny            text[] := ARRAY['20260305203528','20260407203226','20260407211122','20251003170350'];
  v_prereq          text[] := ARRAY['20261007120000', '20261008120000', '20261009120000', '20261010110000', '20261010120000', '20261011120000', '20261012120000', '20261013120000', '20261014120000', '20261015120000', '20261015123000', '20261016120000', '20261017120000', '20261018120000', '20261018120100', '20261018120200', '20261019120000', '20261020120000', '20261021120000', '20261022120000', '20261023120000', '20261024120000', '20261025120000', '20261026120000', '20261026120100', '20261026120200', '20261026120300', '20261026120400', '20260814002658', '20260814120000'];
  v_prefix constant text := '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED';
  r                 record;
  v_actual_base     int;
  v_actual_sha      text;
  v_seen            text[] := ARRAY[]::text[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));
  -- 1. fail closed while anything is unfilled
  IF v_base_sha256 LIKE '%{{%' OR v_expected_base IS NULL THEN
    RAISE EXCEPTION 'PROPOSAL ONLY: placeholders are unfilled; no row was written';
  END IF;
  -- 2. identity of the target (see the header: the project reference is bound by the hosted authorization, not by this SQL)
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'unexpected database %', current_database(); END IF;
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260814002658') THEN
    RAISE EXCEPTION 'the Development-only alias row 20260814002658 is missing: wrong database or alias reconciliation not done';
  END IF;
  IF array_length(v_allow, 1) <> 13 THEN RAISE EXCEPTION 'allowlist must hold exactly 13 versions'; END IF;
  IF v_allow && v_deny THEN RAISE EXCEPTION 'a denied or withdrawn version is on the allowlist'; END IF;
  -- 3. order: every prerequisite is already in the ledger (sealed package, alias rows)
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY (v_prereq)) <> array_length(v_prereq, 1) THEN
    RAISE EXCEPTION 'prerequisite ledger rows are missing: the sealed package and the alias rows must be recorded first';
  END IF;
  -- 4. the ledger is exactly what the owner approved (no broad backfill, no drift)
  SELECT count(*), encode(sha256(convert_to(string_agg(version || '|' || coalesce(name,'') || '|' || md5(coalesce(array_to_string(statements, E'\n'),'')), E'\n' ORDER BY version), 'UTF8')), 'hex')
    INTO v_actual_base, v_actual_sha FROM supabase_migrations.schema_migrations;
  IF v_actual_base <> v_expected_base OR v_actual_sha <> v_base_sha256 THEN
    RAISE EXCEPTION 'ledger differs from the approved base (count % / hash %)', v_actual_base, v_actual_sha;
  END IF;
  -- 5. no allowlisted version already has a row (no duplicate or conflicting entry; Production records 10 of them)
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ANY (v_allow)) THEN
    RAISE EXCEPTION 'an allowlisted version already has a ledger row';
  END IF;
  -- 6. the rows
  FOR r IN SELECT * FROM (VALUES
    ('20251001051901', '001_create_core_schema', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20251001051901 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001051901_001_create_core_schema.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects'),
    ('20251001052039', '002_seed_sample_units', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20251001052039 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001052039_002_seed_sample_units.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist'),
    ('20251001192425', '004_add_new_order_fields', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20251001192425 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20251001192425_004_add_new_order_fields.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist'),
    ('20260125173238', 'fix_incorrect_balance_due_calculations', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260125173238 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260125173238_fix_incorrect_balance_due_calculations.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist'),
    ('20260126193205', 'fix_home_address_default_to_woodward_st', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260126193205 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260126193205_fix_home_address_default_to_woodward_st.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects'),
    ('20260224133344', 'create_google_reviews_system', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224133344 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224133344_create_google_reviews_system.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects'),
    ('20260224161311', 'add_featured_image_to_unit_media', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224161311 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224161311_add_featured_image_to_unit_media.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects'),
    ('20260224183629', 'add_google_review_to_pickup_messages', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224183629 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224183629_add_google_review_to_pickup_messages.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects'),
    ('20260224184535', 'update_google_review_url', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260224184535 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260224184535_update_google_review_url.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects'),
    ('20260305222010', 'fix_balance_exclude_tip', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260305222010 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260305222010_fix_balance_exclude_tip.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist'),
    ('20260311113547', 'fix_webhook_idempotency_and_receipt_deduplication', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=effects-present-execution-unproven version=20260311113547 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260311113547_fix_webhook_idempotency_and_receipt_deduplication.sql was NOT executed by this record, equivalent effects were observed on Development on 2026-10-19 not_proven=that the original SQL ever ran on this database, which statement produced the observed effects'),
    ('20260315173745', 'fix_trigger_customer_profile_columns', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260315173745 attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260315173745_fix_trigger_customer_profile_columns.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist'),
    ('20260611184401', 'create_update_pricing_rules_rpc', '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run={{RUN_ID}} state=deliberately-not-executed version=20260611184401 deny_exception_approval={{DENYLIST_EXCEPTION_APPROVAL_ID}} attested_by={{ATTESTED_BY}} attested_at={{ATTESTED_AT}} scope=ledger marker only, original SQL 20260611184401_create_update_pricing_rules_rpc.sql was deliberately NOT executed and must not be executed on this database not_proven=original SQL execution is not being certified, no claim is made that its effects exist')
  ) AS t(version, name, marker) ORDER BY version
  LOOP
    IF NOT (r.version = ANY (v_allow)) OR r.version = ANY (v_seen) THEN RAISE EXCEPTION 'unexpected or repeated version %', r.version; END IF;
    v_seen := v_seen || r.version;
    IF left(r.marker, length(v_prefix)) <> v_prefix OR r.marker NOT LIKE '%version=' || r.version || ' %' THEN RAISE EXCEPTION 'malformed marker for %', r.version; END IF;
    IF r.marker LIKE '%{{%' THEN RAISE EXCEPTION 'placeholder left in the marker for %', r.version; END IF;
    IF (r.version = ANY (v_deny_exception)) <> (r.marker LIKE '% deny_exception_approval=%') THEN
      RAISE EXCEPTION 'the deny-list exception approval id must be present on exactly the four deny-listed versions (%)', r.version;
    END IF;
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES (r.version, r.name, ARRAY[r.marker]);
  END LOOP;
  IF NOT (v_seen @> v_allow AND v_seen <@ v_allow) THEN RAISE EXCEPTION 'the rows written are not exactly the allowlist'; END IF;
  -- 7. postconditions
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> v_expected_base + 13 THEN RAISE EXCEPTION 'unexpected ledger size after the batch'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY (v_allow) AND array_length(statements, 1) = 1 AND statements[1] LIKE v_prefix || '%') <> 13 THEN
    RAISE EXCEPTION 'marker rows are not in the expected form';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY (v_deny)) <> 0 THEN RAISE EXCEPTION 'a denied version was recorded'; END IF;
END
$proposal$;
