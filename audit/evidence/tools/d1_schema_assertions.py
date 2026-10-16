"""Stage D1: independent final-schema assertions on the scratch database produced by the adjusted strict replay.

Reads the catalog of a LOCAL scratch database only (127.0.0.1:54329, database name must start with bpc_replay_). It does not trust the
replay tool's exit code: every assertion is a catalog query. Status values: PASS, FAIL, STUB (the stub cannot verify this; reported, never
assumed to pass).  Usage: python -I d1_schema_assertions.py <scratch-db> <output-json>
"""
import json
import re
import subprocess
import sys

DB, OUT = sys.argv[1], sys.argv[2]
assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", DB), "refusing a non-scratch database name"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
R = []


def q(sql):
    r = subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-At", "-d", DB, "-c", sql], capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout.strip()


def check(name, cond, detail="", status=None):
    st = status or ("PASS" if cond else "FAIL")
    R.append({"check": name, "status": st, "detail": str(detail)[:300]})
    print(f"{st:5} {name} {('| ' + str(detail)[:160]) if detail != '' else ''}")


def fn_priv(role, proname):
    return q(f"select coalesce(bool_or(has_function_privilege('{role}', p.oid, 'EXECUTE')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='{proname}'") == "t"


def fn_exists(proname):
    return int(q(f"select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='{proname}'")) >= 1


def col(table, column):
    return q(f"select data_type||'/'||is_nullable||'/'||coalesce(column_default,'') from information_schema.columns where table_schema='public' and table_name='{table}' and column_name='{column}'")


# ---- role CHECK, FK, publication, trigger, withdrawn Case 43 ----------------------------------------------------------------------
chk = q("select string_agg(conname||' '||pg_get_constraintdef(oid), ' | ') from pg_constraint where conrelid='public.user_roles'::regclass and contype='c'")
check("user_roles has exactly one CHECK, the canonical lowercase one", chk.count("CHECK") == 1 and chk.startswith("user_roles_role_check") and all(f"'{v}'::text" in chk for v in ("master", "admin", "crew", "customer")) and not re.search(r"'(MASTER|ADMIN|CREW|CUSTOMER)'", chk), chk)
vocab = ",".join(sorted(set(re.findall(r"'([a-z]+)'::text", chk))))
check("CHECK vocabulary is exactly master, admin, crew, customer", sorted(vocab.split(",")) == ["admin", "crew", "customer", "master"], vocab)
fk = q("select conname||' valid='||convalidated||' del='||confdeltype::text||' ref='||confrelid::regclass||' cols='||(select string_agg(attname,',') from pg_attribute where attrelid=conrelid and attnum=any(conkey)) from pg_constraint where conrelid='public.user_roles'::regclass and contype='f'")
check("user_roles.user_id -> auth.users(id) ON DELETE CASCADE, validated", fk == "user_roles_user_id_fkey valid=true del=c ref=auth.users cols=user_id", fk)
check("user_roles keeps UNIQUE (user_id, role)", q("select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype='u' and pg_get_constraintdef(oid)='UNIQUE (user_id, role)'") == "1")
check("orders is in supabase_realtime exactly once", q("select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders'") == "1")
pubs = q("select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname='supabase_realtime'")
check("supabase_realtime membership recorded (no duplicates)", len(pubs.split(",")) == len(set(pubs.split(","))), pubs)
trg = q("select t.tgname||' -> '||p.proname||' tgtype='||t.tgtype::text||' enabled='||t.tgenabled::text from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='auth.users'::regclass and not t.tgisinternal")
check("auth.users has exactly one signup trigger -> auto_assign_customer_role (AFTER INSERT, row, enabled)", trg == "on_auth_user_created -> auto_assign_customer_role tgtype=5 enabled=O", trg)
check("signup function is SECURITY DEFINER with search_path=public and service_role-only EXECUTE", q("select prosecdef::text||'/'||coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='auto_assign_customer_role'") == "true/search_path=public" and not fn_priv("anon", "auto_assign_customer_role") and not fn_priv("authenticated", "auto_assign_customer_role") and fn_priv("service_role", "auto_assign_customer_role"))
check("assign_role_by_email: anon cannot execute; authenticated and service_role can", (not fn_priv("anon", "assign_role_by_email")) and fn_priv("authenticated", "assign_role_by_email") and fn_priv("service_role", "assign_role_by_email"))
check("customer_profiles.first_name / last_name exist", col("customer_profiles", "first_name").startswith("text") and col("customer_profiles", "last_name").startswith("text"))
pol = q("select string_agg(policyname||'/'||cmd||'/'||array_to_string(roles,','), ' ; ' order by policyname) from pg_policies where schemaname='public' and tablename='order_changelog'")
check("order_changelog policies are exactly the two staff-only ones", pol == "Admin and master append order changelog/INSERT/authenticated ; Admin and master read order changelog/SELECT/authenticated", pol)
check("no policy from withdrawn Case 43 and no anon INSERT policy on order_changelog", q("select count(*) from pg_policies where schemaname='public' and tablename='order_changelog' and (policyname ilike '%Anon customers can insert cancellation%' or 'anon'=any(roles) or 'public'=any(roles))") == "0")
check("order_changelog has RLS enabled", q("select relrowsecurity::text from pg_class where oid='public.order_changelog'::regclass") == "true")

# ---- the 23 October migrations: at least one intended effect each -----------------------------------------------------------------
oct_ = {}
oct_["20261007120000"] = ("is_admin() lowercase-safe, find_order_id_by_prefix exists, record_cash_payment not executable by anon/authenticated",
                          "lower" in q("select prosrc from pg_proc where proname='is_admin' and pronamespace='public'::regnamespace").lower() and fn_exists("find_order_id_by_prefix") and not fn_priv("anon", "record_cash_payment") and not fn_priv("authenticated", "record_cash_payment"))
oct_["20261008120000"] = ("get_admin_analytics + get_admin_analytics_impl exist; check_expiring_cards not executable by anon/authenticated",
                          fn_exists("get_admin_analytics") and fn_exists("get_admin_analytics_impl") and not fn_priv("anon", "check_expiring_cards") and not fn_priv("authenticated", "check_expiring_cards"))
oct_["20261009120000"] = ("invoice_links.revoked_at; revocation trigger on invoice_links and expiry-sync trigger on orders; one-active-portal unique index",
                          col("invoice_links", "revoked_at").startswith("timestamp with time zone") and q("select string_agg(tgrelid::regclass::text||'.'||tgname, ',' order by tgname) from pg_trigger where tgname in ('trg_invoice_links_enforce_revocation','trg_sync_invoice_links_expires_at') and not tgisinternal") == "invoice_links.trg_invoice_links_enforce_revocation,orders.trg_sync_invoice_links_expires_at" and q("select count(*) from pg_indexes where indexname='invoice_links_one_active_portal_per_order'") == "1")
oct_["20261010110000"] = ("orders.customer_approved_at timestamptz, nullable, no default", col("orders", "customer_approved_at") == "timestamp with time zone/YES/")
oct_["20261010120000"] = ("booking_setup_proofs exists with RLS; create_booking_request exists",
                          q("select relrowsecurity::text from pg_class where oid='public.booking_setup_proofs'::regclass") == "true" and fn_exists("create_booking_request"))
oct_["20261011120000"] = ("orders.event_address_line2 text", col("orders", "event_address_line2").startswith("text"))
oct_["20261012120000"] = ("RLS on every owned table; helper functions exist; admin-and-master policies present",
                          q("select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in ('customers','addresses','orders','order_items','payments','invoice_links','contacts','order_changelog','messages','documents') and not c.relrowsecurity") == "0" and all(fn_exists(f) for f in ("current_customer_ids", "get_my_orders", "get_my_last_order_address", "is_crew_or_admin")) and int(q("select count(*) from pg_policies where schemaname='public' and policyname like 'Admin and master%'")) >= 20)
oct_["20261013120000"] = ("generate_invoice_number / generate_receipt_number not executable by anon",
                          fn_exists("generate_invoice_number") and not fn_priv("anon", "generate_invoice_number") and not fn_priv("anon", "generate_receipt_number"))
oct_["20261014120000"] = ("Storage policies 'Public read marketing media' and 'Admin and master manage marketing media' on storage.objects",
                          q("select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('Public read marketing media','Admin and master manage marketing media')") == "2")
oct_["20261015120000"] = ("Storage policy 'Staff read order pictures' on storage.objects", q("select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='Staff read order pictures'") == "1")
oct_["20261015123000"] = ("private bucket order-evidence exists and is not public", q("select public::text from storage.buckets where id='order-evidence'") == "false")
oct_["20261016120000"] = ("role CHECK, FK and signup trigger (asserted above); assign_role_by_email present", fn_exists("assign_role_by_email") and chk.startswith("user_roles_role_check"))
oct_["20261017120000"] = ("claim/finalize/release_booking_confirmation exist", all(fn_exists(f) for f in ("claim_booking_confirmation", "finalize_booking_confirmation", "release_booking_confirmation")))
acl = q("select coalesce(string_agg(defaclobjtype::text||':'||coalesce(defaclacl::text,''), ' ; ' order by defaclobjtype), '') from pg_default_acl d where d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace")
oct_["20261018120000"] = ("default privileges for postgres in public no longer grant anon/authenticated; PUBLIC function default revoked (owner-wide)",
                          "anon" not in acl and "authenticated" not in acl and q("select count(*) from pg_default_acl where defaclrole='postgres'::regrole and defaclnamespace=0 and defaclobjtype='f'") == "1")
oct_["20261018120100"] = ("site_events: no INSERT/ALL policies; anon no privileges; authenticated SELECT only",
                          q("select count(*) from pg_policies where schemaname='public' and tablename='site_events' and cmd in ('INSERT','ALL','UPDATE','DELETE')") == "0" and q("select has_table_privilege('anon','public.site_events','SELECT')::text||has_table_privilege('authenticated','public.site_events','INSERT')::text||has_table_privilege('authenticated','public.site_events','SELECT')::text||has_table_privilege('service_role','public.site_events','INSERT')::text") == "falsefalsetruetrue")
oct_["20261018120200"] = ("get_user_role exists and is not executable by anon", fn_exists("get_user_role") and not fn_priv("anon", "get_user_role"))
oct_["20261019120000"] = ("payment-operation functions, trigger, unique indexes",
                          all(fn_exists(f) for f in ("claim_payment_operation", "finalize_payment_operation", "release_payment_operation", "record_payment_operation_provider", "mark_payment_operation_provider_attempt", "guard_payment_authoritative_order_changes"))
                          and q("select count(*) from pg_trigger where tgname='trg_guard_payment_authoritative_order_changes' and not tgisinternal") == "1"
                          and q("select count(*) from pg_indexes where indexname in ('payments_checkout_session_unique','payments_one_open_operation_per_order','payments_operation_key_unique','payments_original_payment_intent_unique')") == "4")
oct_["20261020120000"] = ("record_offline_payment, payment_deposit_principal_state, record_cash/check_payment exist", all(fn_exists(f) for f in ("record_offline_payment", "payment_deposit_principal_state", "record_cash_payment", "record_check_payment")))
oct_["20261021120000"] = ("pricing-authority trigger and server-save functions", q("select count(*) from pg_trigger where tgname='trg_guard_order_pricing_authority' and not tgisinternal") == "1" and fn_exists("apply_staff_order_save") and fn_exists("create_staff_invoice_order"))
oct_["20261022120000"] = ("order_refunds.ledger_version default 2, payments.stripe_refund_id, refund indexes and functions",
                          "2" in col("order_refunds", "ledger_version") and col("payments", "stripe_refund_id").startswith("text") and q("select count(*) from pg_indexes where indexname in ('idx_order_refunds_payment_id','idx_order_refunds_stripe_refund_id')") == "2"
                          and all(fn_exists(f) for f in ("reserve_refund_operation", "record_refund_provider_result", "apply_provider_refund_event", "mark_refund_provider_attempt")))
oct_["20261023120000"] = ("order_refunds_allocation_shape constraint validated; order_net_financials exists", q("select convalidated::text from pg_constraint where conname='order_refunds_allocation_shape'") == "true" and fn_exists("order_net_financials"))
oct_["20261024120000"] = ("reserve_refund_allocation exists", fn_exists("reserve_refund_allocation"))
oct_["20261025120000"] = ("order_refund_overview exists", fn_exists("order_refund_overview"))
for v, (what, cond) in sorted(oct_.items()):
    check(f"October {v}: {what}", cond)
check("all 23 October migrations have an assertion", len(oct_) == 23, len(oct_))

# ---- general inventory (informational, written to the JSON) -------------------------------------------------------------------------
inv = {
    "tables": q("select count(*) from pg_tables where schemaname='public'"),
    "columns": q("select count(*) from information_schema.columns where table_schema='public'"),
    "constraints": q("select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'"),
    "indexes": q("select count(*) from pg_indexes where schemaname='public'"),
    "triggers": q("select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal"),
    "functions": q("select count(*) from pg_proc where pronamespace='public'::regnamespace"),
    "policies_public": q("select count(*) from pg_policies where schemaname='public'"),
    "policies_storage_objects": q("select count(*) from pg_policies where schemaname='storage'"),
    "public_tables_without_rls": q("select coalesce(string_agg(relname,','),'') from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity"),
    "anon_table_privileges_public": q("select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon'"),
    "public_functions_executable_by_PUBLIC_or_anon": q("select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and (has_function_privilege('anon', p.oid, 'EXECUTE'))"),
    "default_acl_postgres": acl,
}
print("inventory:", json.dumps(inv))

# ---- things the local stub cannot verify -------------------------------------------------------------------------------------------
check("20260323201502 (google calendar auto-sync trigger, needs pg_net): skipped, trigger absent as expected", q("select count(*) from pg_trigger where tgname='trg_auto_sync_google_calendar'") == "0", "skipped by design", status="STUB")
check("pg_net extension / outbound HTTP triggers", False, "plain PostgreSQL has no pg_net; behaviour NOT verified", status="STUB")
check("real Supabase Auth schema (auth.users columns, GoTrue-owned triggers, auth.uid() from real JWTs)", False, "auth objects are stubs; trigger/function wiring verified, runtime auth NOT verified", status="STUB")
check("Supabase Storage service (bucket API, real storage.objects columns, policies evaluated by Storage API)", False, "storage.buckets/objects are stubs; policy objects verified, enforcement NOT verified", status="STUB")
check("Supabase Realtime service delivery", False, "publication membership verified only; replication delivery NOT verified", status="STUB")
check("platform-owned roles and ownership (supabase_admin, supabase_auth_admin) and pg_cron", False, "roles are NOLOGIN stubs; ownership/privilege parity with a real project NOT verified", status="STUB")
check("row-level security behaviour under real PostgREST roles and JWT claims", False, "policy catalog verified; request-time enforcement NOT verified", status="STUB")

summary = {"database": DB, "pass": sum(r["status"] == "PASS" for r in R), "fail": sum(r["status"] == "FAIL" for r in R), "stub_unverifiable": sum(r["status"] == "STUB" for r in R)}
json.dump({"summary": summary, "inventory": inv, "checks": R}, open(OUT, "w", encoding="utf-8"), indent=1)
print(summary)
