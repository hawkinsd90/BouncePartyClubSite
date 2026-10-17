"""Stage E2J-B: builds the sanitized E2J-B evidence tables from (a) the repository, (b) the committed E2I/E2J tables and (c) the protected raw capture results
(C:\\Users\\vikki\\migration-evidence\\e2jb-development\\, outside Git, transcribed from the hosted read-only queries). Offline: no database connection.
Usage: python -I e2jb_build.py"""
import csv
import json
import os
import re
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.abspath(os.path.join(HERE, ".."))
MIG = os.path.abspath(os.path.join(HERE, "..", "..", "..", "supabase", "migrations"))
RAW = r"C:\Users\vikki\migration-evidence\e2jb-development"
st = json.load(open(RAW + r"\statements.json", encoding="utf-8"))
r1 = json.load(open(RAW + r"\results_part1.json", encoding="utf-8"))
r2 = json.load(open(RAW + r"\results_part2.json", encoding="utf-8"))
CAPTURE_UTC = "2026-10-17 12:02:50 to 12:1x (Q00_1 first at 12:02:50, prefixed repeat at 12:03:11)"

# ---------------- 1. capture summary ----------------
OUT = {
    "Q00_1": "postgres session; not superuser; bypasses RLS; transaction_read_only=off without prefix, ON with the read-only prefix; can_insert_orders=true (privileged role); server 17.6",
    "Q00_2": "all application tables RLS-enabled, none forced; supabase_migrations.schema_migrations RLS off; planner row estimates only",
    "Q01_1": "58 ledger rows; first 20251001051900; last 20260929161925",
    "Q01_2": "58 versions; identical set to the Stage B Development capture",
    "Q02_1": "15 of 17 queried keys present with non-empty values; absent: twilio_phone_number, business_website",
    "Q03_1": "13 SMS template keys present, all with text",
    "Q04_1": "6 e-mail template names present",
    "Q05_1": "16 units; 0 NULL types; 0 of 3 sample slugs present",
    "Q05_2": "35 unit_media; 0 visibility backfill pending; 12 featured",
    "Q06_1": "3 carousel rows", "Q07_1": "1 review row", "Q08_1": "email and sms operational",
    "Q09_1": "1 pricing rule row; 0 NULLs in the 5 backfilled columns",
    "Q10_1": "0 blank status, 0 payment_pending, 0 NULL deposit_required, 0 NULL event_end_date, 0 NULL payment_lock",
    "Q11_1": "171 orders; 0 NULL balance_due; 0 NULL tax_waived; 0 waived-with-tax; 22 with deposit_due set but customer_selected_payment unset",
    "Q11_2": "0 orders missing last-four where a succeeded payment has one",
    "Q12_1": "0 succeeded without paid_at; 0 failed without failed_at; 0 NULL ledger_sequence",
    "Q13_1": "165 addresses; 0 NULL address_key; 0 duplicate keys",
    "Q14_1": "123 customers; 9 linked to an auth user; 0 linkable-but-unlinked",
    "Q15_1": "95 contacts; 87 differ from the recomputed non-cancelled order count",
    "Q16_1": "0 paid-but-underpaid invoices", "Q17_1": "stripe_webhook_events is empty",
    "Q18_1": "0 secret-like changelog rows not redacted",
    "Q19_1": "0 non-lowercase roles of 9", "Q19_2": "no CHECK constraint on user_roles",
    "Q20_1": "9 buckets; carousel-media and public-assets have no size/MIME limits; public-assets private; signatures/lot-pictures/signed-waivers/physical-waivers private; order-pictures, carousel-media, event-essentials-media, unit-images public",
    "Q21_1": "only public.orders published to supabase_realtime",
    "Q22_1": "28 policies returned; 6 on storage.objects; user_roles still has 'Service role full access' (public ALL true) and 'Users can read own role'; orders has 'Service role full access to orders' (public ALL true)",
    "Q23_1": "6 functions present, update_pricing_rules absent; body hashes equal the Stage B capture",
    "Q23_2": "orders and pricing_rules same_day_weekday_delivery_fee_* NOT NULL (invoices column nullable); defaults 0/false",
    "Q24_1": "pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp; pg_net absent",
    "Q25_1": "no user-defined trigger on auth.users", "Q25_2": "custom_email_hook and claim_order_for_approval absent",
    "Q26_1": "TRUE: the demo admin login exists",
    "Q27_1": "invoice 38; portal_shortlink 247", "Q28_1": "6 profiles; 0 NULL first_name",
    "Q29_1": "no default ACL rows for schema public; postgres/storage and supabase_admin/auth/realtime/graphql defaults only",
    "Q29_2": "public schema ACL {postgres=UC, service_role=UC}; anon/authenticated have no USAGE on public",
    "Q30_1": "14 relations; ACLs identical to the Stage B capture; all owned by postgres, RLS on (tables)",
    "Q30_2": "26 trigger functions returned (invoice_links_enforce_revocation not yet created); proacl empty",
    "Q30_3": "service_role cannot SELECT 11 of the 12 tables (only contact_inquiries); anon SELECT on 8; authenticated SELECT on 10",
    "Q30_4": "policy names for the 12 tables returned (admin and public-view policies; none for sequences)",
}
rows = []
for s in st:
    rows.append({"project_id": "srxunxiytojjsuhcmzjg", "capture_date_utc": "2026-10-17", "query_id": s["id"], "statement_sha256": s["sha256"], "execution_mode": "Supabase plugin execute_sql, prefixed with SET TRANSACTION READ ONLY; SET LOCAL statement_timeout 30s; SET LOCAL lock_timeout 3s",
                 "result_status": "success", "non_sensitive_outcome": OUT[s["id"]], "raw_output": "protected folder only (e2jb-development), not in Git"})
assert len(rows) == 42
with open(os.path.join(EV, "e2jb-development-capture-summary.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(rows)

# ---------------- 2. evidence closure for the 42 + 25 (+2 SQL candidates) ----------------
ver = list(csv.DictReader(open(os.path.join(EV, "e2i-development-version-verdicts.csv"), encoding="utf-8")))
ATT, UNR, XSQL, HIST, WITH = "Qualified owner-attestation candidate", "Unresolved", "Actual SQL execution required", "Evidence-backed history-only reconciliation candidate", "Withheld for the October deployment gate"
live_admin = set(r1["Q02_1_keys_present_with_value"])
queried_admin = live_admin | set(r1["Q02_1_keys_absent"])
live_sms, live_email = set(r1["Q03_1"]), set(r1["Q04_1"])


def file_keys(fn, table):
    t = open(os.path.join(MIG, fn), encoding="utf-8", newline="").read().replace("\r\n", "\n")
    keys = []
    for m in re.finditer(r"INSERT\s+INTO\s+(?:public\.)?" + table + r"\b(.*?)(?:ON CONFLICT|;)", t, re.S | re.I):
        keys += re.findall(r"\(\s*'([a-z0-9_]+)'\s*,", m.group(1))
    return sorted(set(keys))


SUP, PAR, INC, CON = "supported (consistent, not proof)", "partial", "inconclusive", "conflicting"
O = {  # version: (status, effect state, evidence text, next class)
    "20251001051901": (SUP, "present", "Q09: the single pricing_rules row exists with no NULLs; the wet_or_dry/surface NOT NULL gap is closed by the October chain", ATT),
    "20251001052039": (PAR, "absent as written", "Q05: 16 units exist but none of the 3 seed slugs; the catalog was replaced or edited since. Never re-insert", ATT),
    "20251001192425": (PAR, "partly present", "Q09 sandbag fee set; the orders.start_date column the backfill targeted no longer exists (Q10 not applicable)", ATT),
    "20251002180149": (SUP, "present", "Q09: pricing row populated (values not compared with Production here)", ATT),
    "20251007220415": (SUP, "present", "Q10: 0 blank statuses in 171 orders", ATT),
    "20251007221227": (SUP, "present", "Q10: 0 payment_pending in 171 orders", ATT),
    "20251007221817": (SUP, "present", "Q10: 0 NULL deposit_required in 171 orders", ATT),
    "20251130191333": (SUP, "present", "Q10: 0 NULL event_end_date; pickup_preference part not queried", ATT),
    "20251130231633": (SUP, "present", "Q09: generator price set; Q10 clean", ATT),
    "20251207160232": (SUP, "present", "Q06: 3 carousel rows", ATT),
    "20251222014723": (SUP, "present", "Q09: deposit_per_unit set", ATT),
    "20251222020729": (PAR, "partly present", "Q09 covers the fee column; the included_cities update is not queried", ATT),
    "20251231174711": (SUP, "present", "Q08: email and sms status rows", ATT),
    "20260119195140": (SUP, "present", "Q09: apply_taxes_by_default set", ATT),
    "20260224133344": (SUP, "present", "Q07: 1 review row", ATT),
    "20260224161311": (SUP, "present", "Q05: 12 featured media rows of 35", ATT),
    "20260224165424": (SUP, "present", "Q05: 0 units with NULL types", ATT),
    "20260311121119": (SUP, "present", "Q09: deposit_percentage set", ATT),
    "20260318191352": (INC, "uncertain", "Q05 does not test the water-slide price predicate; units exist", ATT),
    "20260324175546": (SUP, "present", "Q19: 0 non-lowercase roles of 9", ATT),
    "20260324190039": (SUP, "present", "Q19: 0 non-lowercase roles of 9", ATT),
    "20260331151647": (SUP, "present", "Q05: 0 media rows pending the visibility backfill", ATT),
    "20260415234700": (INC, "uncertain", "Q27: 38 invoice-type and 247 portal_shortlink links; the backfill's full predicate was not captured", ATT),
    "20260816221636": (SUP, "present", "Q10: 0 NULL payment_lock", ATT),
    "20260928172217": (INC, "uncertain", "no captured query covers the parks-acknowledgment backfill", ATT),
    # the 25 previously unresolved
    "20251003170350": (CON, "present (security finding)", "Q26: the demo admin login EXISTS. Execution remains prohibited; owner security review", UNR),
    "20251008153245": (CON, "uncertain", "Q15: 87 of 95 contacts differ from the recomputed non-cancelled order count; counters look unmaintained or defined differently", UNR),
    "20260323155222": (CON, "uncertain", "Q15 as above", UNR),
    "20260323163432": (CON, "uncertain", "Q15 as above", UNR),
    "20260323164559": (CON, "uncertain", "Q15 as above", UNR),
    "20251207163822": (CON, "schema absent until October", "Q19: no CHECK constraint on user_roles today; the role constraint arrives with 20261016120000; the admin-assignment data part is not provable", WITH),
    "20251207184549": (PAR, "present with differences", "Q22: 'Users can read own role' (equivalent duplicate) and the public ALL 'Service role full access' policy still exist; October removes the latter", WITH),
    "20251207185927": (PAR, "present with differences", "Q22 as above", WITH),
    "20251209133113": (SUP, "present", "Q12: 0 succeeded without paid_at, 0 failed without failed_at among 185 payments", ATT),
    "20260120203953": (SUP, "present", "Q11: 0 NULL tax_waived, 0 waived-with-tax in 171 orders", ATT),
    "20260125170305": (SUP, "present", "Q11 as above", ATT),
    "20260125173238": (SUP, "present", "Q11: 0 NULL balance_due (the formula itself cannot be re-proved on edited orders)", ATT),
    "20260305222010": (SUP, "present", "Q11: 0 NULL balance_due (formula not re-provable)", ATT),
    "20260326004004": (SUP, "present", "Q11_2: 0 orders missing last-four where a succeeded payment has one", ATT),
    "20260302131311": (SUP, "present", "Q14: 9 customers linked, 0 linkable-but-unlinked of 123", ATT),
    "20260311191611": (SUP, "present", "Q16: 0 paid-but-underpaid invoices", ATT),
    "20260314213726": (SUP, "present", "Q13: 0 NULL keys, 0 duplicates in 165 addresses (the merges cannot be proved)", ATT),
    "20260314215031": (SUP, "present", "Q13 as above", ATT),
    "20260315173745": (SUP, "present", "Q28: 0 NULL first_name in 6 profiles", ATT),
    "20260323175236": (SUP, "present (safe)", "Q18: 0 secret-like changelog rows not redacted", ATT),
    "20260305205811": (CON, "uncertain", "Q11: 22 orders have deposit_due set but customer_selected_payment unset; the backfill predicate still matches", UNR),
    "20260311111714": (PAR, "partly present", "Q12: 0 NULL ledger_sequence; the statement E2A left unmatched is not individually verified", UNR),
    "20260311113547": (INC, "uncertain", "Q17: stripe_webhook_events is empty, so any state is vacuous", UNR),
    "20260611153900": (SUP, "present (stricter)", "Q23: columns exist with the same defaults; NOT NULL on orders and pricing_rules (Production nullable); invoices column nullable", HIST),
    "20260611184401": (CON, "absent", "Q23: update_pricing_rules does not exist; owner decision U-E2I-4", UNR),
}
# seed keys: derive from the files and compare with Q02/Q03/Q04
SEEDS = {"20251002210020": ("admin_settings", None), "20251003152224": ("admin_settings", None), "20251003183947": ("admin_settings", None), "20251007210840": ("admin_settings", None),
         "20251231171420": ("admin_settings", None), "20260126184412": ("admin_settings", None), "20260126193205": ("admin_settings", None), "20260203053948": ("admin_settings", None),
         "20260224184535": ("admin_settings", None), "20260325231020": ("admin_settings", None), "20251008144308": ("both", None), "20260224183629": ("all", None),
         "20251003182356": ("sms_message_templates", None), "20251205125907": ("sms_message_templates", None), "20251216201450": ("sms_message_templates", None), "20260126193254": ("sms_message_templates", None),
         "20251221225000": ("email_templates", None)}
byfile = {r["version"]: r["filename"] for r in ver}
for v_, (kind, _) in SEEDS.items():
    fn = byfile[v_]
    tabs = ["admin_settings", "sms_message_templates", "email_templates"] if kind in ("all",) else ["admin_settings", "sms_message_templates"] if kind == "both" else [kind]
    miss, ok, unq = [], [], []
    for t in tabs:
        for k in file_keys(fn, t):
            if t == "admin_settings":
                (ok if k in live_admin else miss if k in queried_admin else unq).append(k)
            elif t == "sms_message_templates":
                (ok if k in live_sms else miss).append(k)
            else:
                (ok if k in live_email else miss).append(k)
    # known intentional removals: a later version deletes business_website (20260203053948)
    intentional = [k for k in miss if k == "business_website"]
    miss2 = [k for k in miss if k not in intentional]
    if miss2:
        O[v_] = (CON, "partly absent", f"{len(ok)} named keys present; absent: {', '.join(miss2)}", UNR)
    else:
        extra = f"; not covered by the query: {', '.join(unq)}" if unq else ""
        extra += "; business_website intentionally deleted by 20260203053948" if intentional else ""
        O[v_] = (SUP, "present", f"{len(ok)} named keys/templates present{extra}", ATT)
closure = []
cls_before = {}
for r in ver:
    if r["e2i_verdict"] not in (ATT, UNR, XSQL):
        continue
    v_ = r["version"]
    if r["e2i_verdict"] == XSQL:
        closure.append({"version": v_, "filename": r["filename"], "e2i_class": XSQL, "queries": "Q20", "live_result": "carousel-media/public-assets limits (and MIME lists) still NULL on Development", "evidence_status": SUP, "effect_state_now": "absent",
                        "proof_of_historical_execution": "not applicable (effect absent)", "owner_attestation_needed": "no; owner approval of the SQL (U-E2I-3)", "recommended_class": XSQL, "rationale": "Q20 confirms the effect is still absent; stays an execution candidate"})
        continue
    st_, eff, txt, nxt = O[v_]
    cls_before[v_] = r["e2i_verdict"]
    closure.append({"version": v_, "filename": r["filename"], "e2i_class": r["e2i_verdict"], "queries": r["read_only_queries"].replace(";", ", "), "live_result": txt, "evidence_status": st_, "effect_state_now": eff,
                    "proof_of_historical_execution": "no: current-state equivalence only", "owner_attestation_needed": "yes" if nxt in (ATT, UNR) else "yes (and record only after the October condition)" if nxt == WITH else "yes (accept documented difference)",
                    "recommended_class": nxt, "rationale": ("evidence consistent; attestation still required" if nxt == ATT else "evidence conflicting, inconclusive or owner-dependent; stays unresolved" if nxt == UNR else "depends on the October block" if nxt == WITH else "schema effect verified in the catalog")})
with open(os.path.join(EV, "e2jb-evidence-closure.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(closure[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(closure)
print("closure rows", len(closure), Counter((c["e2i_class"][:12], c["recommended_class"][:14]) for c in closure))

# ---------------- 3. updated manifest ----------------
man = list(csv.DictReader(open(os.path.join(EV, "e2i-development-manifest.csv"), encoding="utf-8")))
newc = {c["version"]: c["recommended_class"] for c in closure}
out = []
for m in man:
    v_ = m["version"]
    nc = newc.get(v_, m["e2i_category"])
    if nc == XSQL and m["e2i_category"] != XSQL:
        nc = m["e2i_category"]
    out.append({"version": v_, "filename": m["filename"], "e2i_category": m["e2i_category"], "e2jb_category": nc, "changed": "yes" if nc != m["e2i_category"] else "no",
                "e2jb_evidence": (next(c for c in closure if c["version"] == v_)["live_result"] if v_ in newc else ("E2J-B: recorded set re-verified (Q01); no change" if m["e2i_category"] == "Already recorded" else "E2J-B: not covered by a data query; schema state unchanged since Stage B (Q20-Q25, Q29, Q30 identical)")),
                "approved": "no (proposal only)"})
with open(os.path.join(EV, "e2jb-updated-development-manifest.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()), lineterminator="\n")
    w.writeheader()
    w.writerows(out)
print("manifest", len(out), dict(Counter(o["e2jb_category"] for o in out)), "changed", sum(o["changed"] == "yes" for o in out))
print("by e2jb status", dict(Counter(c["evidence_status"] for c in closure)))
