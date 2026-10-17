"""Stage D4: deterministic SYNTHETIC dataset for the pre-upgrade Production-equivalent schema. Nothing here is real: every id is a d4-tagged uuid, every
email ends in @example.test, every provider id starts with pi_d4_/re_d4_/cs_d4_. Reproducible: the same call always produces the same rows."""
from d4_lib import ins, uid

U_MASTER, U_ADMIN, U_CREW, U_C1, U_C2, U_DUP = (uid(i, "01") for i in range(1, 7))
ORPHAN1, ORPHAN2 = uid(901, "01"), uid(902, "01")
CUST = [uid(i, "02") for i in range(1, 5)]
ADDR = [uid(i, "03") for i in range(1, 5)]
UNITS = [uid(i, "04") for i in range(1, 3)]


def users_and_roles(admin_role="ADMIN", crew_role=" Crew ", dup=True, orphans=True, extra_role=None):
    s = ["set session_replication_role = replica;"]
    users = [(U_MASTER, "d4-master"), (U_ADMIN, "d4-admin"), (U_CREW, "d4-crew"), (U_C1, "d4-cust1"), (U_C2, "d4-cust2"), (U_DUP, "d4-dup")]
    for u, nm in users:
        s.append(ins("auth.users", id=u, aud="authenticated", role="authenticated", email=f"{nm}@example.test", created_at="2026-01-01 00:00:00+00", updated_at="2026-01-01 00:00:00+00"))
    rows = [(U_MASTER, "master", "2026-01-01"), (U_ADMIN, admin_role, "2026-01-01"), (U_CREW, crew_role, "2026-01-01"), (U_C1, "customer", "2026-01-01"), (U_C2, "customer", "2026-01-01")]
    if dup:
        rows += [(U_DUP, "admin", "2026-01-02"), (U_DUP, "ADMIN", "2026-01-05")]
    if orphans:
        rows += [(ORPHAN1, "customer", "2026-01-03"), (ORPHAN2, "crew", "2026-01-03")]
    if extra_role:
        rows.append((U_C2, extra_role, "2026-01-06"))
    for u, r, d in rows:
        s.append(ins("public.user_roles", user_id=u, role=r, created_at=f"{d} 10:00:00+00"))
    s.append("set session_replication_role = origin;")
    return "\n".join(s)


# (key, status, fields) ; all amounts in integer cents. total = subtotal + fees + tax - discounts + custom fees
ORDERS = {
    "O01_draft": dict(status="draft", subtotal=25000, travel=0, surface=0, pickup=0, generator=0, weekday=0, tax=0, deposit_due=0, deposit_paid=0, balance_due=25000, balance_paid=0, tip=0),
    "O02_pending_review": dict(status="pending_review", subtotal=30000, travel=1500, surface=2000, pickup=0, generator=0, weekday=0, tax=2640, deposit_due=10000, deposit_paid=0, balance_due=36140, balance_paid=0, tip=0),
    "O03_awaiting_approval": dict(status="awaiting_customer_approval", subtotal=42000, travel=2500, surface=0, pickup=3500, generator=0, weekday=0, tax=3500, deposit_due=15000, deposit_paid=0, balance_due=51500, balance_paid=0, tip=0),
    "O04_confirmed_deposit_paid": dict(status="confirmed", subtotal=36000, travel=1800, surface=2000, pickup=0, generator=7500, weekday=0, tax=3275, deposit_due=12000, deposit_paid=12000, balance_due=38575, balance_paid=0, tip=0),
    "O05_confirmed_paid_in_full": dict(status="confirmed", subtotal=28000, travel=1000, surface=0, pickup=0, generator=0, weekday=0, tax=2350, deposit_due=10000, deposit_paid=10000, balance_due=21350, balance_paid=21350, tip=2000),
    "O06_confirmed_check": dict(status="confirmed", subtotal=50000, travel=3000, surface=2000, pickup=3500, generator=0, weekday=4500, tax=5200, deposit_due=20000, deposit_paid=20000, balance_due=48200, balance_paid=0, tip=0),
    "O07_cancelled_full_refund": dict(status="cancelled", subtotal=32000, travel=1500, surface=0, pickup=0, generator=0, weekday=0, tax=2700, deposit_due=10000, deposit_paid=10000, balance_due=26200, balance_paid=0, tip=0, refunded=10000),
    "O08_confirmed_partial_refund": dict(status="confirmed", subtotal=45000, travel=2000, surface=2000, pickup=0, generator=0, weekday=0, tax=4000, deposit_due=15000, deposit_paid=15000, balance_due=38000, balance_paid=38000, tip=0, refunded=5000),
    "O09_discounts_and_custom_fees": dict(status="confirmed", subtotal=60000, travel=2000, surface=2000, pickup=0, generator=0, weekday=0, tax=5800, deposit_due=20000, deposit_paid=20000, balance_due=52100, balance_paid=0, tip=0),
    "O10_tax_and_fee_waivers": dict(status="confirmed", subtotal=24000, travel=1500, surface=0, pickup=3500, generator=0, weekday=0, tax=0, deposit_due=8000, deposit_paid=8000, balance_due=19000, balance_paid=0, tip=0, waive=True),
    "O11_same_day_weekday_generator": dict(status="pending_review", subtotal=38000, travel=2200, surface=2000, pickup=3500, generator=7500, weekday=4500, tax=4800, deposit_due=14000, deposit_paid=0, balance_due=62500, balance_paid=0, tip=0),
    "O12_failed_then_retry": dict(status="confirmed", subtotal=33000, travel=1800, surface=0, pickup=0, generator=0, weekday=0, tax=2900, deposit_due=11000, deposit_paid=11000, balance_due=26700, balance_paid=0, tip=0),
}
OID = {k: uid(i + 1, "05") for i, k in enumerate(ORDERS)}
# payments: (key, order, type, amount, status, method, pi, paid, refunded_payment)
PAYMENTS = [
    ("P04d", "O04_confirmed_deposit_paid", "deposit", 12000, "succeeded", "card", "pi_d4_004d", True, None),
    ("P05d", "O05_confirmed_paid_in_full", "deposit", 10000, "succeeded", "card", "pi_d4_005d", True, None),
    ("P05b", "O05_confirmed_paid_in_full", "balance", 23350, "succeeded", "cash", None, True, None),
    ("P06d", "O06_confirmed_check", "deposit", 20000, "succeeded", "check", None, True, None),
    ("P07d", "O07_cancelled_full_refund", "deposit", 10000, "succeeded", "card", "pi_d4_007d", True, None),
    ("P07r", "O07_cancelled_full_refund", "deposit", -10000, "succeeded", "card", "pi_d4_007d", True, "P07d"),
    ("P08d", "O08_confirmed_partial_refund", "deposit", 15000, "succeeded", "card", "pi_d4_008d", True, None),
    ("P08b", "O08_confirmed_partial_refund", "balance", 38000, "succeeded", "card", "pi_d4_008b", True, None),
    ("P08r", "O08_confirmed_partial_refund", "balance", -5000, "succeeded", "card", "pi_d4_008b", True, "P08b"),
    ("P09d", "O09_discounts_and_custom_fees", "deposit", 20000, "succeeded", "card", "pi_d4_009d", True, None),
    ("P10d", "O10_tax_and_fee_waivers", "deposit", 8000, "succeeded", "card", "pi_d4_010d", True, None),
    ("P12f", "O12_failed_then_retry", "deposit", 11000, "failed", "card", "pi_d4_012f", False, None),
    ("P12d", "O12_failed_then_retry", "deposit", 11000, "succeeded", "card", "pi_d4_012d", True, None),
    ("P03p", "O03_awaiting_approval", "deposit", 15000, "pending", "card", None, False, None),
]
PID = {p[0]: uid(i + 1, "06") for i, p in enumerate(PAYMENTS)}
# legacy refunds: (key, order, amount, status, stripe_refund_id)
REFUNDS = [("R07", "O07_cancelled_full_refund", 10000, "succeeded", "re_d4_007"), ("R08a", "O08_confirmed_partial_refund", 5000, "succeeded", "re_d4_008a"),
           ("R08b", "O08_confirmed_partial_refund", 2500, "pending", "re_d4_008b"), ("R08c", "O08_confirmed_partial_refund", 1000, "failed", None)]
RID = {r[0]: uid(i + 1, "07") for i, r in enumerate(REFUNDS)}


def commerce(extra=""):
    s = []
    s.append("set session_replication_role = replica;")  # row-level seeding only: keeps trigger side effects out of the starting dataset
    for i, (c, a) in enumerate(zip(CUST, ADDR)):
        s.append(ins("public.customers", id=c, first_name=f"D4Test{i}", last_name="Synthetic", email=f"d4-customer{i}@example.test", phone=f"555010{i:04d}", user_id=[U_C1, U_C2, None, None][i]))
        s.append(ins("public.addresses", id=a, customer_id=c, line1=f"{100 + i} Synthetic Way", city="Testville", state="ZZ", zip=f"0000{i}"))
        s.append(ins("public.contacts", customer_id=c, first_name=f"D4Test{i}", last_name="Synthetic", email=f"d4-customer{i}@example.test"))
    for i, u in enumerate(UNITS):
        s.append(ins("public.units", id=u, slug=f"d4-unit-{i}", name=f"D4 Test Unit {i}", price_dry_cents=15000 + 2500 * i, dimensions="10x10", footprint_sqft=100, capacity=8, types=["bouncehouse"]))
    for i, (key, o) in enumerate(ORDERS.items()):
        s.append(ins("public.orders", id=OID[key], customer_id=CUST[i % 4], address_id=ADDR[i % 4], status=o["status"], location_type="residential", surface="grass",
                     event_date=f"2026-11-{10 + i:02d}", event_end_date=f"2026-11-{10 + i:02d}", start_window="10:00", end_window="12:00", pickup_preference="same_day",
                     subtotal_cents=o["subtotal"], travel_fee_cents=o["travel"], surface_fee_cents=o["surface"], same_day_pickup_fee_cents=o["pickup"], generator_fee_cents=o["generator"],
                     same_day_weekday_delivery_fee_cents=o["weekday"], tax_cents=o["tax"], deposit_due_cents=o["deposit_due"], deposit_paid_cents=o["deposit_paid"], balance_due_cents=o["balance_due"],
                     balance_paid_cents=o["balance_paid"], tip_cents=o["tip"], total_refunded_cents=o.get("refunded", 0), deposit_required=o["deposit_due"] > 0,
                     tax_waived=bool(o.get("waive")), tax_waive_reason="d4 synthetic waiver" if o.get("waive") else None, same_day_pickup_fee_waived=bool(o.get("waive")),
                     same_day_pickup_fee_waive_reason="d4 synthetic waiver" if o.get("waive") else None, created_at=f"2026-10-{1 + i:02d} 09:00:00+00"))
        s.append(ins("public.order_items", order_id=OID[key], unit_id=UNITS[i % 2], wet_or_dry="dry", unit_price_cents=o["subtotal"], qty=1))
    s.append(ins("public.order_discounts", order_id=OID["O09_discounts_and_custom_fees"], name="d4 fixed discount", amount_cents=2000))
    s.append(ins("public.order_discounts", order_id=OID["O09_discounts_and_custom_fees"], name="d4 percent discount", percentage=10))
    s.append(ins("public.order_custom_fees", order_id=OID["O09_discounts_and_custom_fees"], name="d4 custom fee", amount_cents=1500))
    for key, o, t, amt, st, meth, pi, paid, ref in PAYMENTS:
        s.append(ins("public.payments", id=PID[key], order_id=OID[o], type=t, amount_cents=amt, status=st, payment_method=meth, stripe_payment_intent_id=pi,
                     paid_at="2026-10-20 12:00:00+00" if paid else None, refunded_payment_id=PID[ref] if ref else None, created_at="2026-10-20 11:00:00+00"))
    for key, o, amt, st, sid in REFUNDS:
        s.append(ins("public.order_refunds", id=RID[key], order_id=OID[o], amount_cents=amt, reason="d4 synthetic refund", status=st, stripe_refund_id=sid, refunded_by=U_ADMIN, created_at="2026-10-22 08:00:00+00"))
    links = [("L04i", "O04_confirmed_deposit_paid", "invoice", "tok_d4_004i", "sc_d4_004i", "2026-12-01"), ("L04p", "O04_confirmed_deposit_paid", "portal", "tok_d4_004p", "sc_d4_004p", "2027-01-20"),
             ("L05a", "O05_confirmed_paid_in_full", "invoice", "tok_d4_005a", "sc_d4_005a", "2026-12-01"), ("L05b", "O05_confirmed_paid_in_full", "invoice", "tok_d4_005b", "sc_d4_005b", "2026-12-02"),
             ("L05s1", "O05_confirmed_paid_in_full", "portal_shortlink", "tok_d4_005s1", "sc_d4_005s1", "2027-01-20"), ("L05s2", "O05_confirmed_paid_in_full", "portal_shortlink", "tok_d4_005s2", "sc_d4_005s2", "2027-01-20"),
             ("L09e", "O09_discounts_and_custom_fees", "portal", "tok_d4_009e", "sc_d4_009e", "2026-01-15")]
    for key, o, lt, tok, sc, exp in links:
        s.append(ins("public.invoice_links", order_id=OID[o], link_token=tok, short_code=sc, link_type=lt, deposit_cents=0, expires_at=f"{exp} 00:00:00+00"))
    s.append(ins("public.invoices", invoice_number="D4-INV-0001", order_id=OID["O05_confirmed_paid_in_full"], customer_id=CUST[0], subtotal_cents=28000, total_cents=33350, tax_cents=2350, paid_amount_cents=33350, status="paid"))
    s.append(ins("public.invoices", invoice_number="D4-INV-0002", order_id=OID["O04_confirmed_deposit_paid"], customer_id=CUST[3], subtotal_cents=36000, total_cents=50575, tax_cents=3275, paid_amount_cents=12000, status="sent"))
    s.append("insert into public.pricing_rules default values;")
    s.append("set session_replication_role = origin;")
    return "\n".join(s) + "\n" + extra


# tables compared before/after (pre-upgrade column sets only)
SNAP_TABLES = ["customers", "addresses", "contacts", "units", "orders", "order_items", "order_discounts", "order_custom_fees", "payments", "order_refunds", "invoice_links", "invoices", "pricing_rules"]
