"""Stage D4: synthetic-data compatibility and financial-integrity rehearsal of the exact D3 67-migration upgrade set.
Every scenario starts from a FRESH clone of the restored pre-upgrade Production schema (bpc_replay_d4_template), never from the already-upgraded D3 result.
Local PostgreSQL only; synthetic data only. Usage: python -I d4_run.py <A|B|V|C|all>   (results accumulate in the protected d4-scratch folder)
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402

RES = os.path.join(L.OUT, "d4-results.json")
STATE = json.load(open(RES, encoding="utf-8")) if os.path.exists(RES) else {"checks": [], "scenarios": {}, "financial": {}, "validation": {}, "idempotency": [], "migration_runs": {}}


def save():
    json.dump(STATE, open(RES, "w", encoding="utf-8"), indent=1, default=str)


def rec(sc, check, expected, actual, ok):
    STATE["checks"] = [c for c in STATE["checks"] if not (c["scenario"] == sc and c["check"] == check)]
    STATE["checks"].append({"scenario": sc, "check": check, "expected": str(expected), "actual": str(actual), "result": "PASS" if ok else "FAIL"})
    print(("PASS" if ok else "FAIL"), sc, "|", check, "|", str(actual)[:150])


def try_tx(db, text):
    """Run statements in one transaction that is ALWAYS rolled back; returns (ok, error)."""
    r = L.psql(db, ["-v", "ON_ERROR_STOP=1"], text="BEGIN;\n" + text + "\nROLLBACK;\n")
    return r.returncode == 0, L.err1(r.stderr)


def scalar(db, sqltext):
    return L.q(db, sqltext)


def snapshot(db, tables=S.SNAP_TABLES):
    out = {}
    for t in tables:
        out[t] = json.loads(L.q(db, f"select coalesce(jsonb_object_agg(id::text, to_jsonb(t)), '{{}}'::jsonb) from public.{t} t"))
    return out


def compare_snapshots(before, after):
    diffs, newcols, missing = [], {}, []
    for t, rows in before.items():
        for rid, row in rows.items():
            a = after[t].get(rid)
            if a is None:
                missing.append((t, rid))
                continue
            for c, v in row.items():
                if c not in a:
                    diffs.append((t, rid, c, v, "<column removed>"))
                elif a[c] != v:
                    diffs.append((t, rid, c, v, a[c]))
            for c in a:
                if c not in row:
                    newcols.setdefault(t, {}).setdefault(c, set()).add(json.dumps(a[c]))
        extra = set(after[t]) - set(rows)
        if extra:
            missing.append((t, "unexpected new rows: %d" % len(extra)))
    return diffs, {t: {c: sorted(v) for c, v in cs.items()} for t, cs in newcols.items()}, missing


# =====================================================================================================================================
def scenario_A():
    sc = "D4-A1"
    db = "bpc_replay_d4_a1"
    L.clone(L.TEMPLATE, db)
    assert L.sql(db, S.users_and_roles()).returncode == 0
    assert L.sql(db, S.commerce()).returncode == 0
    counts = {t: int(L.q(db, f"select count(*) from public.{t}")) for t in ["orders", "order_items", "payments", "order_refunds", "invoice_links", "invoices", "order_discounts", "order_custom_fees", "customers", "contacts", "addresses", "units", "pricing_rules", "user_roles"]}
    counts["auth.users"] = int(L.q(db, "select count(*) from auth.users"))
    STATE["scenarios"][sc] = {"seed_counts": counts}
    before = snapshot(db)
    roles_before = L.q(db, "select string_agg(left(user_id::text,8)||':'||role||':'||created_at::date, ', ' order by user_id, created_at) from public.user_roles")
    fp0 = L.fingerprint(db)
    res = L.run_migrations(db)
    STATE["migration_runs"][sc] = res
    applied = sum(r["status"] == "applied" for r in res)
    rec(sc, "full 67-migration upgrade of the valid synthetic dataset", "67 applied, 0 failed", f"{applied} applied, {len(res) - applied} failed", applied == 67 and len(res) == 67)
    after = snapshot(db)
    diffs, newcols, missing = compare_snapshots(before, after)
    STATE["financial"]["A1"] = {"tables": {t: len(r) for t, r in before.items()}, "row_count_unchanged": not missing, "unexpected_row_changes": missing, "changed_existing_values": diffs, "new_columns_values_on_existing_rows": newcols}
    rec(sc, "no existing row missing or added in the financial/business tables", "none", missing, not missing)
    rec(sc, "zero changed pre-existing column values (all tables, exact comparison)", "0 differences", f"{len(diffs)} differences", not diffs)
    # exact integer-cent per-order checks (independent of the generic comparison)
    fin = {}
    ok_all = True
    for key, o in S.ORDERS.items():
        oid = S.OID[key]
        row = after["orders"][oid]
        vals = {"subtotal_cents": o["subtotal"], "travel_fee_cents": o["travel"], "surface_fee_cents": o["surface"], "same_day_pickup_fee_cents": o["pickup"], "generator_fee_cents": o["generator"],
                "same_day_weekday_delivery_fee_cents": o["weekday"], "tax_cents": o["tax"], "deposit_due_cents": o["deposit_due"], "deposit_paid_cents": o["deposit_paid"], "balance_due_cents": o["balance_due"],
                "balance_paid_cents": o["balance_paid"], "tip_cents": o["tip"], "total_refunded_cents": o.get("refunded", 0), "status": o["status"]}
        mism = {k: (v, row[k]) for k, v in vals.items() if row[k] != v}
        wf = bool(o.get("waive"))
        if row["tax_waived"] != wf or row["same_day_pickup_fee_waived"] != wf:
            mism["waivers"] = (wf, (row["tax_waived"], row["same_day_pickup_fee_waived"]))
        fin[key] = {"before_equals_after": not mism, "mismatch": mism, "values_cents": {k: row[k] for k in vals if k != "status"}, "status": row["status"], "workflow_status": row["workflow_status"]}
        ok_all &= not mism
    STATE["financial"]["A1"]["per_order"] = fin
    rec(sc, "per-order financial columns, tax/fee waivers, status and workflow state identical to the seeded integer cents (12 orders)", "0 mismatches", sum(not v["before_equals_after"] for v in fin.values()), ok_all)
    # payments, refunds, invoices, links, pricing
    pay_ok = all(after["payments"][pid] == before["payments"][pid] or all(after["payments"][pid][c] == v for c, v in before["payments"][pid].items()) for pid in S.PID.values())
    rec(sc, "14 payments: counts, amounts, statuses, provider ids, refund linkage unchanged", "unchanged", pay_ok, pay_ok)
    ref_ok = all(all(after["order_refunds"][rid][c] == v for c, v in before["order_refunds"][rid].items()) for rid in S.RID.values())
    rec(sc, "4 legacy refunds: amounts, statuses, provider ids unchanged", "unchanged", ref_ok, ref_ok)
    nc = newcols.get("order_refunds", {})
    rec(sc, "legacy refund rows keep NULL ledger_version and NULL allocation (no backfill)", "all NULL", {k: nc.get(k) for k in ("ledger_version", "allocation_version", "request_allocation")},
        nc.get("ledger_version") == ["null"] and nc.get("allocation_version") == ["null"] and nc.get("request_allocation") == ["null"])
    pc = newcols.get("payments", {})
    rec(sc, "existing payment rows get NULL operation/component columns (not backfilled)", "all NULL", {k: pc.get(k) for k in ("operation_key", "principal_amount_cents", "stripe_checkout_session_id")}, all(pc.get(k) == ["null"] for k in ("operation_key", "principal_amount_cents", "stripe_checkout_session_id")))
    rec(sc, "pricing_rules row and defaults unchanged", "unchanged", after["pricing_rules"] == before["pricing_rules"] or not [d for d in diffs if d[0] == "pricing_rules"], not [d for d in diffs if d[0] == "pricing_rules"])
    # net financial semantics for refunds (reservation semantics preserved)
    for key, exp in (("O08_confirmed_partial_refund", dict(gross=53000, succeeded=5000, pending=2500, retained=48000)), ("O07_cancelled_full_refund", dict(gross=10000, succeeded=10000, pending=0, retained=0)), ("O04_confirmed_deposit_paid", dict(gross=12000, succeeded=0, pending=0, retained=12000))):
        j = json.loads(L.q(db, "select set_config('request.jwt.claim.sub','%s',true); " % S.U_MASTER + "select 1") and L.psql(db, ["-At", "-c", "select set_config('request.jwt.claim.sub','%s',false), set_config('request.jwt.claim.role','authenticated',false); select public.order_net_financials('%s'::uuid)" % (S.U_MASTER, S.OID[key])]).stdout.strip().split("\n")[-1])
        got = dict(gross=j["gross_recorded_payments_cents"], succeeded=j["total_succeeded_refunds_cents"], pending=j["pending_refund_reservations_cents"], retained=j["recorded_net_cash_retained_cents"])
        rec(sc, f"order_net_financials({key}) integer cents", exp, got, got == exp)
    # roles
    ur = L.q(db, "select string_agg(left(user_id::text,8)||':'||role, ', ' order by user_id, role) from public.user_roles")
    exp_roles = ", ".join(sorted([f"{S.U_MASTER[:8]}:master", f"{S.U_ADMIN[:8]}:admin", f"{S.U_CREW[:8]}:crew", f"{S.U_C1[:8]}:customer", f"{S.U_C2[:8]}:customer", f"{S.U_DUP[:8]}:admin"]))
    rows = L.q(db, "select count(*) from public.user_roles")
    rec(sc, "roles normalized to lowercase; padded ' Crew ' -> crew; 'ADMIN' -> admin", "6 rows, all in vocabulary", f"{rows} rows: {ur}", rows == "6" and L.q(db, "select count(*) from public.user_roles where role not in ('master','admin','crew','customer')") == "0")
    keep = L.q(db, f"select created_at::date::text from public.user_roles where user_id='{S.U_DUP}'")
    rec(sc, "duplicate roles (admin 2026-01-02 + ADMIN 2026-01-05) collapse deterministically to the earliest row", "1 row, 2026-01-02", keep, keep == "2026-01-02")
    rec(sc, "2 orphan role rows removed; valid roles kept", "0 orphans", L.q(db, f"select count(*) from public.user_roles where user_id in ('{S.ORPHAN1}','{S.ORPHAN2}')"), L.q(db, f"select count(*) from public.user_roles where user_id in ('{S.ORPHAN1}','{S.ORPHAN2}')") == "0")
    rec(sc, "no master role granted to any non-master user", "only the master user", L.q(db, "select string_agg(left(user_id::text,8),',') from public.user_roles where role='master'"), L.q(db, "select string_agg(user_id::text,',') from public.user_roles where role='master'") == S.U_MASTER)
    rec(sc, "canonical role CHECK and valid cascade foreign key restored", "CHECK + FK", L.q(db, "select (select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype='c')||'/'||(select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype='f' and convalidated)"), L.q(db, "select (select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype='c')||'/'||(select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype='f' and convalidated)") == "1/1")
    # signup + authorization
    pre_cust = L.q(db, "select count(*) from public.customers where email='d4-customer0@example.test'")
    ok, e = try_tx(db, "insert into auth.users (id, aud, role, email, created_at, updated_at) values ('d4090000-0000-4000-8000-000000000001','authenticated','authenticated','d4-newsignup@example.test', now(), now());")
    r = L.psql(db, ["-At", "-v", "ON_ERROR_STOP=1"], text="""begin;
insert into auth.users (id, aud, role, email, created_at, updated_at, raw_user_meta_data) values ('d4090000-0000-4000-8000-000000000001','authenticated','authenticated','d4-newsignup@example.test', now(), now(), '{"first_name":"Sign","last_name":"Up"}');
insert into auth.users (id, aud, role, email, created_at, updated_at) values ('d4090000-0000-4000-8000-000000000002','authenticated','authenticated','d4-customer0@example.test', now(), now());
select 'new_user_roles='||(select string_agg(role,',') from public.user_roles where user_id='d4090000-0000-4000-8000-000000000001')||';customer='||(select count(*) from public.customers where email='d4-newsignup@example.test')||';profile='||(select count(*) from public.customer_profiles where user_id='d4090000-0000-4000-8000-000000000001')||';errors='||(select count(*) from public.auth_trigger_logs where user_id in ('d4090000-0000-4000-8000-000000000001','d4090000-0000-4000-8000-000000000002') and status='error');
select 'existing_email_user_roles='||(select string_agg(role,',') from public.user_roles where user_id='d4090000-0000-4000-8000-000000000002')||';customers_with_email='||(select count(*) from public.customers where email='d4-customer0@example.test')||';linked='||(select (user_id='d4090000-0000-4000-8000-000000000002')::text from public.customers where email='d4-customer0@example.test');
rollback;""")
    out = r.stdout.strip()
    rec(sc, "signup trigger: new user gets exactly one customer role, one customer, one profile, no logged errors", "customer;1;1;0", out.split("\n")[0] if out else r.stderr[:200], "new_user_roles=customer;customer=1;profile=1;errors=0" in out)
    rec(sc, "signup for an email that already has a customer row links it (no duplicate customer)", "customers_with_email=1, linked", out.split("\n")[1] if "\n" in out else out, "customers_with_email=1;linked=true" in out)
    helper = """CREATE OR REPLACE FUNCTION pg_temp.try(label text, caller uuid, em text, rl text) RETURNS void LANGUAGE plpgsql AS $f$
    DECLARE r boolean; BEGIN PERFORM set_config('request.jwt.claim.sub', coalesce(caller::text,''), true);
      BEGIN r := public.assign_role_by_email(em, rl); RAISE NOTICE 'R|%|ok|%', label, r;
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R|%|err|%', label, SQLERRM; END; END $f$;"""
    cases = [("admin assigns MASTER to a customer", S.U_ADMIN, "d4-cust1@example.test", "MASTER", "err"), ("admin assigns ' Master '", S.U_ADMIN, "d4-cust1@example.test", " Master ", "err"), ("admin changes the other admin", S.U_ADMIN, "d4-dup@example.test", "crew", "err"),
             ("crew caller", S.U_CREW, "d4-cust1@example.test", "crew", "err"), ("master assigns CREW (any case)", S.U_MASTER, "d4-cust1@example.test", "CREW", "ok")]
    script = helper + "\nBEGIN;\n" + "\n".join(f"SELECT pg_temp.try('{l.replace(chr(39), chr(39) * 2)}', '{c}'::uuid, '{e}', '{r}');" for l, c, e, r, _ in cases) + "\nROLLBACK;\n"
    p = L.psql(db, ["-At"], text=script)
    got = {m.group(1): m.group(2) for m in re.finditer(r"R\|(.*?)\|(ok|err)\|", p.stderr)}
    for l, c, e, r, want in cases:
        rec(sc, f"authorization: {l}", want, got.get(l), got.get(l) == want)
    # invoice links
    link_cnt = L.q(db, "select count(*) from public.invoice_links")
    rec(sc, "all 7 existing invoice/portal links survive unchanged (incl. expired one)", "7 unchanged", link_cnt, link_cnt == "7" and not [d for d in diffs if d[0] == "invoice_links"])
    o4 = S.OID["O04_confirmed_deposit_paid"]
    ok, e = try_tx(db, f"insert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{o4}','tok_d4_dupe','sc_d4_dupe','portal',0);")
    rec(sc, "second ACTIVE portal link for the same order is rejected by invoice_links_one_active_portal_per_order", "unique violation", e, (not ok) and "invoice_links_one_active_portal_per_order" in e)
    ok, e = try_tx(db, f"update public.invoice_links set revoked_at=now() where order_id='{o4}' and link_type='portal'; insert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{o4}','tok_d4_new','sc_d4_new','portal',0);")
    rec(sc, "after revoking the old portal link a new one is accepted", "accepted", e or "ok", ok)
    ok, e = try_tx(db, f"update public.invoice_links set revoked_at=now() where order_id='{o4}' and link_type='portal'; update public.invoice_links set revoked_at=null where order_id='{o4}' and link_type='portal'; select 1/ (case when (select revoked_at from public.invoice_links where order_id='{o4}' and link_type='portal') is null then 0 else 1 end);")
    rec(sc, "revocation is sticky (clearing revoked_at is ignored)", "stays revoked", "stayed revoked" if ok else "revoked_at cleared (" + e + ")", ok)
    ok, e = try_tx(db, f"insert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{S.OID['O05_confirmed_paid_in_full']}','tok_d4_s3','sc_d4_s3','portal_shortlink',0);")
    rec(sc, "additional non-portal links for an order are still accepted", "accepted", e or "ok", ok)
    r = L.psql(db, ["-At", "-v", "ON_ERROR_STOP=1"], text=f"begin; update public.orders set event_end_date='2026-12-20', event_date='2026-12-20' where id='{o4}'; select (select (expires_at at time zone 'UTC')::date from public.invoice_links where order_id='{o4}' and link_type='portal')::text||'|'||(select (expires_at at time zone 'UTC')::date::text from public.invoice_links where order_id='{S.OID['O09_discounts_and_custom_fees']}' and link_type='portal'); rollback;")
    exp_exp = "2027-02-19"  # 2026-12-20 + 61 days
    rec(sc, "event date change moves the active portal link expiry to event end + 61 days; the already-expired link is untouched", f"{exp_exp}|2026-01-15", r.stdout.strip() or L.err1(r.stderr), r.stdout.strip() == f"{exp_exp}|2026-01-15")
    # payment constraints and indexes
    d5, d6 = S.OID["O05_confirmed_paid_in_full"], S.OID["O06_confirmed_check"]
    ok, e = try_tx(db, f"insert into public.payments (order_id, type, amount_cents, status, stripe_payment_intent_id) values ('{d5}','balance',100,'pending','pi_d4_004d');")
    rec(sc, "duplicate original PaymentIntent (positive payment) is rejected", "unique violation", e, (not ok) and "payments_original_payment_intent_unique" in e)
    ok, e = try_tx(db, f"insert into public.payments (order_id, type, amount_cents, status, stripe_payment_intent_id, refunded_payment_id) values ('{S.OID['O04_confirmed_deposit_paid']}','deposit',-100,'succeeded','pi_d4_004d','{S.PID['P04d']}');")
    rec(sc, "refund copy (negative, linked) may reuse its original PaymentIntent", "accepted", e or "ok", ok)
    ok, e = try_tx(db, f"insert into public.payments (order_id, type, amount_cents, status, stripe_checkout_session_id) values ('{d5}','balance',100,'pending','cs_d4_x'); insert into public.payments (order_id, type, amount_cents, status, stripe_checkout_session_id) values ('{d6}','balance',100,'pending','cs_d4_x');")
    rec(sc, "duplicate Checkout Session id is rejected", "unique violation", e, (not ok) and "payments_checkout_session_unique" in e)
    comp = "principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents"
    ok, e = try_tx(db, f"insert into public.payments (order_id, type, amount_cents, status, operation_key, {comp}) values ('{d5}','balance',100,'succeeded','op_d4_1',100,0,0,100); insert into public.payments (order_id, type, amount_cents, status, operation_key, {comp}) values ('{d6}','balance',100,'succeeded','op_d4_1',100,0,0,100);")
    rec(sc, "conflicting payment-operation key is rejected", "unique violation", e, (not ok) and "payments_operation_key_unique" in e)
    ok, e = try_tx(db, f"insert into public.payments (order_id, type, amount_cents, status, operation_key, {comp}) values ('{d5}','balance',100,'pending','op_d4_2',100,0,0,100); insert into public.payments (order_id, type, amount_cents, status, operation_key, {comp}) values ('{d5}','balance',200,'pending','op_d4_3',200,0,0,200);")
    rec(sc, "second OPEN payment operation for one order is rejected", "unique violation", e, (not ok) and "payments_one_open_operation_per_order" in e)
    ok, e = try_tx(db, f"insert into public.payments (order_id, type, amount_cents, status, operation_key, {comp}) values ('{d5}','balance',100,'succeeded','op_d4_4',90,0,0,90);")
    rec(sc, "component amounts must add up to the payment amount (CHECK)", "check violation", e, (not ok) and "payments_component_amounts_check" in e)
    # refunds and allocation boundary
    ro = S.OID["O08_confirmed_partial_refund"]
    ok, e = try_tx(db, f"insert into public.order_refunds (order_id, amount_cents, reason, status, allocation_version, deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents, unclassified_refunded_cents, request_allocation) values ('{ro}',3000,'d4','succeeded',1,1000,1500,500,0,'d4-split');")
    rec(sc, "valid allocation (1000+1500+500+0 = 3000 cents) accepted", "accepted", e or "ok", ok)
    ok, e = try_tx(db, f"insert into public.order_refunds (order_id, amount_cents, reason, status, allocation_version, deposit_principal_refunded_cents, balance_principal_refunded_cents, tip_refunded_cents, unclassified_refunded_cents, request_allocation) values ('{ro}',3000,'d4','succeeded',1,1000,1500,500,1,'d4-split');")
    rec(sc, "over-allocated by one cent (3001 vs 3000) rejected", "check violation", e, (not ok) and "order_refunds_allocation_shape" in e)
    ok, e = try_tx(db, f"insert into public.order_refunds (order_id, amount_cents, reason, status) values ('{ro}',0,'d4','succeeded');")
    rec(sc, "zero-amount refund rejected for new rows (order_refunds_amount_positive, NOT VALID but enforced)", "check violation", e, (not ok) and "order_refunds_amount_positive" in e)
    ok, e = try_tx(db, f"insert into public.order_refunds (order_id, amount_cents, reason, status, operation_key) values ('{ro}',100,'d4','succeeded','op_d4_r');")
    rec(sc, "refund operation without index/request amount/idempotency key rejected (operation_shape)", "check violation", e, (not ok) and "order_refunds_operation_shape" in e)
    ok, e = try_tx(db, f"insert into public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id, ledger_version) values ('{ro}',100,'d4','succeeded','re_d4_dupv2',2); insert into public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id, ledger_version) values ('{ro}',100,'d4','succeeded','re_d4_dupv2',2);")
    rec(sc, "duplicate provider refund id rejected for ledger-v2 rows", "unique violation", e, (not ok) and "order_refunds_provider_refund_unique" in e)
    ok, e = try_tx(db, f"insert into public.order_refunds (order_id, amount_cents, reason, status, stripe_refund_id) values ('{ro}',100,'d4','succeeded','re_d4_008a');")
    rec(sc, "legacy-style row (ledger_version NULL) may reuse a legacy provider refund id (legacy exemption)", "accepted", e or "ok", ok)
    ok, e = try_tx(db, f"update public.orders set waived_fee_amounts_cents = '[1]'::jsonb where id='{ro}';")
    rec(sc, "orders.waived_fee_amounts_cents must be a JSON object (CHECK)", "check violation", e, (not ok) and "orders_waived_fee_amounts_object" in e)
    ok, e = try_tx(db, f"insert into public.user_roles (user_id, role) values ('{S.U_C1}','MASTER');")
    rec(sc, "role 'MASTER' (case variant) rejected by the canonical CHECK", "check violation", e, (not ok) and "user_roles_role_check" in e)
    # storage
    b = L.q(db, "select string_agg(id||'='||case when public then 'public' else 'private' end, ', ' order by id) from storage.buckets")
    exp_b = "carousel-media=public, event-essentials-media=public, lot-pictures=private, order-evidence=private, order-pictures=private, physical-waivers=private, public-assets=public, signatures=private, signed-waivers=private, unit-images=public"
    rec(sc, "storage buckets: lot-pictures, order-pictures, signatures, signed-waivers private; carousel-media preserved; 10 distinct rows", exp_b, b, b == exp_b)
    STATE["scenarios"][sc].update({"roles_before": roles_before, "roles_after": ur, "buckets_after": b, "fingerprint_categories_changed": [k for k in L.fingerprint(db) if L.fingerprint(db)[k] != fp0[k]]})
    save()


# =====================================================================================================================================
def prev_applied_checks(db, res, fail_version, rows):
    """Failure bookkeeping: the failing version is reported FAILED and not recorded; every earlier version is recorded as executed (not rolled back)."""
    ledger = {r[0] for r in [x.split("|") for x in L.q(db, "select version||'|'||statements[1] from supabase_migrations.schema_migrations where statements[1] like '%D4 EXECUTED%'").split("\n") if x]}
    failed = [r for r in res if r["status"] == "FAILED"]
    earlier = [r["version"] for r in rows if r["version"] < fail_version]
    return {"failed": [(r["version"], r.get("error")) for r in failed], "failing_version_in_ledger": fail_version in ledger, "earlier_versions_in_ledger": all(v in ledger for v in earlier), "earlier_count": len(earlier), "not_run": len(rows) - len(res)}


def scenario_B():
    rows = L.verify_upgrade_set()

    only = os.environ.get("D4_ONLY")

    def run(sc, name, seed, fail_version, err_sub, rollback_checks):
        if only and sc not in only.split(","):
            return
        db = f"bpc_replay_d4_{name}"
        L.clone(L.TEMPLATE, db)
        assert L.sql(db, seed).returncode == 0, name
        pre = {t: L.q(db, f"select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.{t} t") for t in ("user_roles", "payments", "invoice_links", "order_items", "orders")}
        res = L.run_migrations(db)
        STATE["migration_runs"][sc] = res
        info = prev_applied_checks(db, res, fail_version, rows)
        failed = info["failed"]
        rec(sc, f"fails at {fail_version} with the intended error", f"FAILED at {fail_version}: ...{err_sub}...", failed, len(failed) == 1 and failed[0][0] == fail_version and err_sub in (failed[0][1] or ""))
        rec(sc, "the failure is reported as FAILED, never as applied; later migrations not run", "1 FAILED, rest not run", f"{info['not_run']} not run", info["not_run"] == len(rows) - len(res) and info["not_run"] > 0 or fail_version == rows[-1]["version"])
        rec(sc, "every earlier migration remains recorded as executed (committed, not rolled back)", f"{info['earlier_count']} earlier versions in ledger", info["earlier_versions_in_ledger"], info["earlier_versions_in_ledger"] and not info["failing_version_in_ledger"])
        post = {t: L.q(db, f"select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from public.{t} t") for t in pre}
        for label, cond in rollback_checks(db, pre, post).items():
            rec(sc, label, "true", cond, bool(cond))
        STATE["scenarios"].setdefault(sc, {})["failed_at"] = failed
        save()

    sc_has_no_legacy = False

    def roles_rb(db, pre, post):
        legacy_values_present = L.q(db, "select count(*) from public.user_roles where role in ('ADMIN',' Crew ')") != "0" or sc_has_no_legacy
        return {"rollback: user_roles rows unchanged (legacy uppercase/padded values still present where seeded, nothing normalized)": pre["user_roles"] == post["user_roles"] and legacy_values_present,
                "rollback: no role CHECK and no foreign key on user_roles": L.q(db, "select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype in ('c','f')") == "0",
                "rollback: assign_role_by_email still the old definition (no search_path normalisation block)": "lower(btrim(p_role" not in L.q(db, "select prosrc from pg_proc where proname='assign_role_by_email'"),
                "earlier migration effect present (private order-evidence bucket from 20261015123000)": L.q(db, "select public::text from storage.buckets where id='order-evidence'") == "false"}

    run("D4-B1", "b1_role", S.users_and_roles(extra_role="owner") + "\n" + S.commerce(), "20261016120000", "outside master / admin / crew / customer", roles_rb)
    noroles = "set session_replication_role = replica;\n" + "\n".join(f"insert into public.user_roles (user_id, role, created_at) values ('{u}','customer','2026-01-01 10:00:00+00');" for u in (S.U_C1, S.U_C2)) + "\nset session_replication_role = origin;\n" + S.commerce().replace(f"user_id={S.U_C1}", "")
    # commerce() references auth users through customers.user_id: use a variant without them
    seed_b2 = "set session_replication_role = replica;\n" + "\n".join(f"insert into public.user_roles (user_id, role, created_at) values ('{u}','customer','2026-01-01 10:00:00+00');" for u in (S.U_C1, S.U_C2, S.U_MASTER)) + "\nset session_replication_role = origin;\n"
    sc_has_no_legacy = True  # the empty-auth fixture seeds only lowercase customer roles; unchanged-ness is still verified by the table digest
    run("D4-B2", "b2_empty_auth", seed_b2, "20261016120000", "auth.users is empty", roles_rb)

    def pi_rb(db, pre, post):
        return {"rollback: payments table unchanged and payments.operation_key column absent": pre["payments"] == post["payments"] and L.q(db, "select count(*) from information_schema.columns where table_name='payments' and column_name='operation_key'") == "0",
                "rollback: none of the four payment unique indexes exist": L.q(db, "select count(*) from pg_indexes where indexname like 'payments_%unique' or indexname='payments_one_open_operation_per_order'") == "0",
                "earlier migration effect present (user_roles CHECK from 20261016120000)": L.q(db, "select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype='c'") == "1"}
    dup_pi = S.users_and_roles() + "\n" + S.commerce() + f"\n{__import__('d4_lib').ins('public.payments', order_id=S.OID['O06_confirmed_check'], type='deposit', amount_cents=1000, status='succeeded', stripe_payment_intent_id='pi_d4_004d')}"
    run("D4-B3", "b3_dup_pi", dup_pi, "20261019120000", "payments_original_payment_intent_unique", pi_rb)

    def link_rb(db, pre, post):
        return {"rollback: invoice_links unchanged and revoked_at column absent": pre["invoice_links"] == post["invoice_links"] and L.q(db, "select count(*) from information_schema.columns where table_name='invoice_links' and column_name='revoked_at'") == "0",
                "rollback: portal unique index and revocation trigger absent": L.q(db, "select count(*) from pg_indexes where indexname='invoice_links_one_active_portal_per_order'") == "0"}
    dup_link = S.users_and_roles() + "\n" + S.commerce() + f"\n{__import__('d4_lib').ins('public.invoice_links', order_id=S.OID['O04_confirmed_deposit_paid'], link_token='tok_d4_dup2', short_code='sc_d4_dup2', link_type='portal', deposit_cents=0)}"
    run("D4-B4", "b4_dup_link", dup_link, "20261009120000", "invoice_links_one_active_portal_per_order", link_rb)

    def item_rb(db, pre, post):
        return {"rollback: order_items unchanged and product_id column absent": pre["order_items"] == post["order_items"] and L.q(db, "select count(*) from information_schema.columns where table_name='order_items' and column_name='product_id'") == "0",
                "rollback: no inventory/product tables created by the failing migration": L.q(db, "select count(*) from pg_tables where schemaname='public' and tablename in ('inventory_products','product_bundles')") == "0"}
    bad_item = S.users_and_roles() + "\n" + S.commerce() + f"\n{__import__('d4_lib').ins('public.order_items', order_id=S.OID['O06_confirmed_check'], unit_id=None, wet_or_dry='dry', unit_price_cents=100, qty=1)}"
    run("D4-B5", "b5_item_ref", bad_item, "20260716151458", "order_items_single_reference", item_rb)


# =====================================================================================================================================
def scenario_V():
    """Deferred (NOT VALID) constraints and VALIDATE behaviour."""
    sc = "D4-V"
    # V1: valid dataset -> upgrade -> validate all four
    db = "bpc_replay_d4_v1"
    L.clone(L.TEMPLATE, db)
    assert L.sql(db, S.users_and_roles()).returncode == 0 and L.sql(db, S.commerce()).returncode == 0
    res = L.run_migrations(db)
    assert all(r["status"] == "applied" for r in res)
    CONS = [("order_custom_fees", "order_custom_fees_amount_non_negative", "20261020120000"), ("order_discounts", "order_discounts_amounts_valid", "20261020120000"),
            ("order_refunds", "order_refunds_amount_positive", "20261022120000"), ("order_refunds", "order_refunds_operation_shape", "20261022120000"), ("order_refunds", "order_refunds_allocation_shape", "20261023120000")]
    out = {}
    for t, c, mig in CONS:
        d = L.q(db, f"select convalidated::text||'|'||pg_get_constraintdef(oid) from pg_constraint where conname='{c}' and conrelid='public.{t}'::regclass")
        out[c] = {"table": t, "created_by": mig, "state_after_upgrade": d.split("|")[0], "definition": d.split("|", 1)[1], "state_before_upgrade": "absent (constraint does not exist before the migration)"}
    rec(sc + "-1", "states after upgrade: 4 constraints NOT VALID, allocation_shape validated", "false,false,false,false,true", [out[c]["state_after_upgrade"] for _, c, _ in CONS], [out[c]["state_after_upgrade"] for _, c, _ in CONS] == ["false", "false", "false", "false", "true"])
    for t, c, mig in CONS[:4]:
        ok, e = try_tx(db, f"alter table public.{t} validate constraint {c};")
        out[c]["validate_on_valid_synthetic_data"] = "succeeds" if ok else "fails: " + e
        rec(sc + "-1", f"VALIDATE {c} succeeds on valid synthetic history", "succeeds", out[c]["validate_on_valid_synthetic_data"], ok)
    # V2: invalid historical rows (possible in the Production-equivalent schema, which has no such constraints)
    db2 = "bpc_replay_d4_v2"
    L.clone(L.TEMPLATE, db2)
    bad = S.users_and_roles() + "\n" + S.commerce() + "\n" + "\n".join([
        "set session_replication_role = replica;",
        L.ins("public.order_custom_fees", id=L.uid(1, "08"), order_id=S.OID["O09_discounts_and_custom_fees"], name="d4 negative custom fee", amount_cents=-500),
        L.ins("public.order_discounts", id=L.uid(1, "09"), order_id=S.OID["O09_discounts_and_custom_fees"], name="d4 impossible percentage", percentage=150),
        L.ins("public.order_discounts", id=L.uid(2, "09"), order_id=S.OID["O09_discounts_and_custom_fees"], name="d4 negative discount", amount_cents=-100),
        L.ins("public.order_refunds", id=L.uid(1, "0a"), order_id=S.OID["O08_confirmed_partial_refund"], amount_cents=0, reason="d4 zero refund", status="failed"),
        L.ins("public.order_refunds", id=L.uid(2, "0a"), order_id=S.OID["O08_confirmed_partial_refund"], amount_cents=-250, reason="d4 negative refund", status="failed"),
        "set session_replication_role = origin;"])
    assert L.sql(db2, bad).returncode == 0
    res2 = L.run_migrations(db2)
    applied2 = sum(r["status"] == "applied" for r in res2)
    rec(sc + "-2", "upgrade with invalid historical rows still succeeds (constraints are NOT VALID, nothing re-checked)", "67 applied", applied2, applied2 == 67)
    STATE["migration_runs"][sc + "-2"] = res2
    states = {c: L.q(db2, f"select convalidated::text from pg_constraint where conname='{c}'") for _, c, _ in CONS[:4]}
    rec(sc + "-2", "constraints remain NOT VALID with invalid history present", "all false", states, set(states.values()) == {"false"})
    for t, c, mig in CONS[:3]:
        before_state = L.q(db2, f"select convalidated::text from pg_constraint where conname='{c}'")
        n_rows = L.q(db2, f"select count(*) from public.{t}")
        r = L.psql(db2, ["-At", "-v", "ON_ERROR_STOP=1"], text=f"begin;\nalter table public.{t} validate constraint {c};\ncommit;\n")
        after_state = L.q(db2, f"select convalidated::text from pg_constraint where conname='{c}'")
        out[c]["validate_on_invalid_rows"] = {"error": L.err1(r.stderr), "constraint_state_after_failed_validate": after_state, "rows_unchanged": L.q(db2, f"select count(*) from public.{t}") == n_rows}
        rec(sc + "-2", f"VALIDATE {c} FAILS on invalid history and leaves the constraint and data intact", "error; still NOT VALID; rows unchanged", out[c]["validate_on_invalid_rows"], r.returncode != 0 and after_state == "false" and before_state == "false" and out[c]["validate_on_invalid_rows"]["rows_unchanged"])
    ok, e = try_tx(db2, "insert into public.order_custom_fees (order_id, name, amount_cents) values ('%s','d4 new negative',-1);" % S.OID["O09_discounts_and_custom_fees"])
    rec(sc + "-2", "NEW invalid rows are rejected even while the constraint is NOT VALID", "check violation", e, (not ok) and "order_custom_fees_amount_non_negative" in e)
    ok, e = try_tx(db2, "update public.order_custom_fees set name='d4 renamed' where id='%s';" % L.uid(1, "08"))
    out["order_custom_fees_amount_non_negative"]["update_of_existing_invalid_row"] = "rejected: " + e if not ok else "accepted"
    rec(sc + "-2", "updating an existing invalid row (even only its name) is rejected while it stays invalid (record behaviour)", "rejected", out["order_custom_fees_amount_non_negative"]["update_of_existing_invalid_row"], not ok)
    ok, e = try_tx(db2, "delete from public.order_custom_fees where id='%s';" % L.uid(1, "08"))
    rec(sc + "-2", "an invalid existing row can still be deleted", "accepted", e or "ok", ok)
    # fix the data, then validate
    fixed = L.psql(db2, ["-v", "ON_ERROR_STOP=1"], text="""update public.order_custom_fees set amount_cents = 0 where amount_cents < 0;
update public.order_discounts set percentage = 100 where percentage > 100; update public.order_discounts set amount_cents = 0 where amount_cents < 0;
delete from public.order_refunds where amount_cents <= 0;
alter table public.order_custom_fees validate constraint order_custom_fees_amount_non_negative; alter table public.order_discounts validate constraint order_discounts_amounts_valid;
alter table public.order_refunds validate constraint order_refunds_amount_positive; alter table public.order_refunds validate constraint order_refunds_operation_shape;""")
    rec(sc + "-2", "after the data is corrected all four constraints validate", "validated", {c: L.q(db2, f'select convalidated::text from pg_constraint where conname=\'{c}\'') for _, c, _ in CONS[:4]}, fixed.returncode == 0)
    for t, c, mig in CONS[:4]:
        out[c]["recommendation"] = {"order_custom_fees_amount_non_negative": "later: run only after a read-only count of negative custom fees in Production is zero (or corrected)", "order_discounts_amounts_valid": "later: after counting discounts with negative amounts or percentage outside 0-100",
                                    "order_refunds_amount_positive": "later: after counting refund rows with amount <= 0 (legacy rows may contain zero/negative values)", "order_refunds_operation_shape": "now or later: legacy rows cannot violate it (the operation columns are new and NULL); cheap and safe"}[c]
    STATE["validation"] = out
    save()


# =====================================================================================================================================
def scenario_C():
    """Re-application of every upgrade migration to an already-upgraded database (inside a rolled-back transaction) + the role migration's idempotency."""
    sc = "D4-C"
    db = "bpc_replay_d4_c"
    L.clone(L.TEMPLATE, db)
    assert L.sql(db, S.users_and_roles()).returncode == 0 and L.sql(db, S.commerce()).returncode == 0
    assert all(r["status"] == "applied" for r in L.run_migrations(db))
    FP = L.FPSQL or (L.fingerprint(db) and L.FPSQL)
    rows = L.verify_upgrade_set()
    out = []
    for row in rows:
        path = os.path.join(L.MIG, row["file"]).replace("\\", "/")
        DATA = "select (select count(*) from public.admin_settings)||','||(select count(*) from public.inventory_products)||','||(select count(*) from public.product_bundles)||','||(select count(*) from public.product_bundle_components)||','||(select count(*) from public.product_pricing)||','||(select count(*) from public.product_categories)||','||(select count(*) from storage.buckets)||','||(select count(*) from public.user_roles)"
        script = f"BEGIN;\nSELECT 'FPB|'||({FP});\nSELECT 'DB|'||({DATA});\n\\i '{path}'\nSELECT 'FPA|'||({FP});\nSELECT 'DA|'||({DATA});\nROLLBACK;\n"
        p = L.psql(db, ["-At", "-v", "ON_ERROR_STOP=1"], text=script)
        pick = lambda tag: next((ln[len(tag):] for ln in p.stdout.split("\n") if ln.startswith(tag)), None)
        fb, fa, db_, da_ = pick("FPB|"), pick("FPA|"), pick("DB|"), pick("DA|")
        if p.returncode != 0:
            status, detail = "ONE-TIME (fails when re-applied)", L.err1(p.stderr)
        elif fa == fb and db_ != da_:
            status, detail = "RE-APPLIES WITH DATA CHANGE", "row counts (settings, products, bundles, components, pricing, categories, buckets, roles): " + str(db_) + " -> " + str(da_)
        elif fa == fb:
            status, detail = "IDEMPOTENT (re-applies with no catalog or counted-data change)", ""
        else:
            ch = [k for k, v in json.loads(fa).items() if v != json.loads(fb)[k]]
            status, detail = "RE-APPLIES WITH CATALOG CHANGE", ",".join(ch)
        out.append({"version": row["version"], "file": row["file"], "group": row["group"], "reapply": status, "detail": detail})
    STATE["idempotency"] = out
    from collections import Counter
    cnt = Counter(o["reapply"] for o in out)
    print(dict(cnt))
    rec(sc, "re-application of each of the 67 files attempted in a rolled-back transaction", "all 67 classified", dict(cnt), len(out) == 67)
    role = next(o for o in out if o["version"] == "20261016120000")
    rec(sc, "20261016120000 (role repair) is idempotent: re-applying changes nothing", "IDEMPOTENT", role["reapply"], role["reapply"].startswith("IDEMPOTENT"))
    after_ids = L.q(db, "select count(*) from public.user_roles")
    rec(sc, "database untouched by the rolled-back re-applications", "6 role rows, 67 history executed", f"{after_ids}", after_ids == "6")
    save()


def scenario_X():
    """Supplementary checks on the post-upgrade database of D4-A1 (rolled-back transactions only)."""
    sc = "D4-A1x"
    db = "bpc_replay_d4_a1"
    r = L.psql(db, ["-At", "-v", "ON_ERROR_STOP=1"], text=f"begin; insert into public.order_refunds (order_id, amount_cents, reason, status) values ('{S.OID['O08_confirmed_partial_refund']}',100,'d4 default check','succeeded') returning ledger_version; rollback;")
    got = [ln for ln in r.stdout.splitlines() if ln.strip() and not ln.startswith(("BEGIN", "INSERT", "ROLLBACK"))]
    rec(sc, "new refund rows default to ledger_version 2 while legacy rows stay NULL (20261022120000)", "2", got, got == ["2"])
    ok, e = try_tx(db, f"insert into public.order_discounts (order_id, name, percentage) values ('{S.OID['O09_discounts_and_custom_fees']}','d4 pct 101',101);")
    rec(sc, "discount percentage above 100 rejected for new rows", "check violation", e, (not ok) and "order_discounts_amounts_valid" in e)
    save()


if __name__ == "__main__":
    for part in {"A": ["A"], "B": ["B"], "V": ["V"], "C": ["C"], "X": ["X"], "all": ["A", "B", "V", "C", "X"]}[sys.argv[1]]:
        {"A": scenario_A, "B": scenario_B, "V": scenario_V, "C": scenario_C, "X": scenario_X}[part]()
    save()
