"""Operational execution manifest for the pre-October Development plan (259 operations): per-item source hash, predecessors, a read-only current-state verification rule (single SELECT returning a boolean),
expected change, post-operation verification, recovery, and batches. Offline; no database connection (rules are generated text; their validation is done by test_execution_scripts.py on a scratch database).
Rule status: DEFINED (catalog identity or an exact data predicate for every statement), WEAK (presence/consistency only; not approvable without the owner accepting that limit), BLOCKED (no safe rule; the operation stays out of every batch).
A rule is evidence that the CURRENT state is consistent with the migration, never proof that the migration ran.
Usage: python -I build_execution_manifest.py"""
import csv
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2a_sql as SQL  # noqa: E402
from step2_paths import derived, workdir  # noqa: E402

EV = os.path.abspath(os.path.join(HERE, ".."))
AUDIT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO = os.path.abspath(os.path.join(AUDIT, ".."))
MIG = os.path.join(REPO, "supabase", "migrations")
SCR = workdir()  # intermediate files; dev-plan-graph.json is produced by build_development_plan.py
E2A = derived("e2a-statements-all.csv")
HIST, ATT, XSQL = "Evidence-backed history-only reconciliation candidate", "Qualified owner-attestation candidate", "Actual SQL execution required"
lit = lambda s: "'" + str(s).replace("'", "''") + "'"
man = {r["version"]: r for r in csv.DictReader(open(os.path.join(AUDIT, "development-migration-manifest.csv"), encoding="utf-8"))}
graph = json.load(open(os.path.join(SCR, "dev-plan-graph.json"), encoding="utf-8"))
plan = graph["plan"]
e2a = defaultdict(list)
for r in csv.DictReader(open(E2A, encoding="utf-8")):
    if r["environment"] == "Development":
        e2a[r["version"]].append(r)
BASE = 58


def sha_lf(fn):
    return hashlib.sha256(open(os.path.join(MIG, fn), "rb").read().replace(b"\r\n", b"\n")).hexdigest()


def text_of(fn):
    return open(os.path.join(MIG, fn), encoding="utf-8", newline="").read().replace("\r\n", "\n")


from rule_atoms import atom, lit  # noqa: E402  (shared with build_production_plan.py)


def catalog_atoms(v):
    out, skipped = [], []
    for r in e2a.get(v, []):
        if r["status"] != "PRESENT" or r["kind"] in ("inline-constraint", "comment"):
            continue
        a = atom(r["kind"], r["object"])
        if a and ("drop reflected" in r["detail"] or "REVOKE reflected" in r["detail"]):
            a = f"NOT ({a})"  # E2A marks a DROP statement PRESENT when the catalog shows the object absent
        (out if a else skipped).append(a or f"{r['kind']}:{r['object']}")
    return sorted(set(out)), skipped


# ------------------------------------------------------------------ data atoms from the migration text
def first_literals(values_text):
    return re.findall(r"\(\s*'([^']+)'\s*[,)]", values_text)


def data_atoms(v, fn):
    """returns (atoms, notes, unhandled) for INSERT/UPDATE/DELETE/DO statements."""
    atoms, notes, unhandled = [], [], []
    for s in SQL.strip_and_split(text_of(fn)):
        flat = re.sub(r"\s+", " ", s).strip()
        u = flat.upper()
        m = re.match(r"INSERT INTO (?:PUBLIC\.)?(\w+)", flat, re.I)
        if m:
            t = m.group(1).lower()
            vals = flat[flat.upper().index("VALUES") + 6:] if "VALUES" in u else ""
            keys = sorted(set(first_literals(vals)))
            col = {"admin_settings": "key", "sms_message_templates": "template_key", "email_templates": "template_name", "notification_system_status": "system_type"}.get(t)
            if col and keys:
                atoms.append(f"(SELECT count(*) FROM {t} WHERE {col} IN ({','.join(lit(k) for k in keys)})) = {len(keys)}")
                notes.append(f"{t}: {len(keys)} natural keys must exist")
                continue
            if t == "pricing_rules":
                atoms.append("EXISTS (SELECT 1 FROM pricing_rules)")
                notes.append("pricing_rules: a row exists (presence only)")
                unhandled.append("pricing_rules seed values not compared")
                continue
            unhandled.append(f"INSERT INTO {t} without a natural key")
            continue
        m = re.match(r"UPDATE (?:PUBLIC\.)?(\w+) SET (.*?)(?: WHERE (.*))?$", flat, re.I)
        if m:
            t, setc, w = m.group(1).lower(), m.group(2), m.group(3)
            if w is None:
                unhandled.append(f"UPDATE {t} without WHERE (recompute of all rows)")
            elif re.search(r"\bFROM\b|\bSELECT\b", w, re.I) or re.search(r"\bFROM\b", setc, re.I):
                unhandled.append(f"UPDATE {t} with a subquery or join")
            elif re.search(r"\b(key|id|slug|template_key|name)\s*=\s*'", w, re.I) and t in ("admin_settings", "sms_message_templates", "units", "storage.buckets"):
                kk = re.findall(r"=\s*'([^']+)'", w)
                col = "key" if t == "admin_settings" else "template_key" if t == "sms_message_templates" else None
                if col and kk:
                    atoms.append(f"(SELECT count(*) FROM {t} WHERE {col} IN ({','.join(lit(k) for k in sorted(set(kk)))})) = {len(set(kk))}")
                    notes.append(f"{t}: targeted row(s) exist; the value written is NOT compared")
                    unhandled.append(f"{t}: written value not verifiable")
                else:
                    unhandled.append(f"targeted UPDATE on {t}")
            else:
                atoms.append(f"EXISTS (SELECT 1 FROM {t}) AND NOT EXISTS (SELECT 1 FROM {t} WHERE {w})")
                notes.append(f"{t}: no row still matches the UPDATE predicate ({w[:70]}); table non-empty")
            continue
        m = re.match(r"DELETE FROM (?:PUBLIC\.)?(\w+) WHERE (\w+) = '([^']+)'$", flat, re.I)
        if m:
            atoms.append(f"NOT EXISTS (SELECT 1 FROM {m.group(1)} WHERE {m.group(2)} = {lit(m.group(3))})")
            notes.append(f"{m.group(1)}: deleted row {m.group(3)} must be absent")
            continue
        if u.startswith("DO"):
            if re.search(r"\b(UPDATE|INSERT|DELETE)\b", u):
                unhandled.append("DO block with data statements")
            else:
                for tm, cm in re.findall(r"ALTER TABLE (?:IF EXISTS )?(?:public\.)?(\w+)\s+ADD COLUMN (?:IF NOT EXISTS )?(\w+)", flat, re.I):
                    atoms.append(atom("col", f"{tm}.{cm}"))
                notes.append("DO block with schema statements only (covered by catalog atoms)")
            continue
        if u.startswith(("NOTIFY", "SELECT", "COMMENT", "BEGIN", "COMMIT")) or flat == "":
            continue
    return atoms, notes, unhandled


def text_schema_atoms(fn):
    t = re.sub(r"--[^\n]*", "", text_of(fn))
    out = []
    for tm, cm in re.findall(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?\"?(\w+)\"?\s+ADD COLUMN (?:IF NOT EXISTS )?\"?(\w+)\"?", t, re.I):
        out.append(atom("col", f"{tm}.{cm}"))
    for n in re.findall(r"CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+)", t, re.I):
        out.append(atom("index", n))
    for n in re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)", t, re.I):
        out.append(atom("table", n))
    for tm, pn in [(b, a) for a, b in re.findall(r"CREATE POLICY \"([^\"]+)\"\s+ON\s+(?:public\.)?(\w+)", t, re.I)]:
        out.append(atom("policy", f"{tm}.{pn}"))
    for n in re.findall(r"CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?(\w+)", t, re.I):
        out.append(atom("function", n))
    for tn, n in [(b, a) for a, b in re.findall(r"CREATE TRIGGER (\w+)[^;]*? ON (?:public\.)?(\w+)", t, re.I | re.S)]:
        out.append(atom("trigger", f"{tn}.{n}"))
    return sorted(set(o for o in out if o))


# ------------------------------------------------------------------ overrides (each one justified)
NETZERO_FN = {"20260315190615": "custom_email_hook", "20260315202232": "custom_email_hook", "20260316174421": "custom_email_hook", "20260316234814": "custom_email_hook", "20260324191543": "claim_order_for_approval"}
OVERRIDE = {}
for v, fnm in NETZERO_FN.items():
    OVERRIDE[v] = ("DEFINED", "net-zero/absence", f"NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname={lit(fnm)})",
                   f"function {fnm} must be ABSENT (created and dropped by the chain); grants on it are not checked")
OVERRIDE["20260305004845"] = ("DEFINED", "absence", "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='order_lot_pictures' AND policyname IN ('Anon can delete lot pictures','Anon can update lot pictures'))",
                              "policies dropped by the version must be absent (names read from the file at generation time)")
OVERRIDE["20260322"] = None
LIVEONLY = {  # data rules whose truth is established only live
}
SPECIAL_Q = {
    "20251001192425": ("WEAK", "consistency only", "EXISTS (SELECT 1 FROM pricing_rules) AND NOT EXISTS (SELECT 1 FROM pricing_rules WHERE surface_sandbag_fee_cents IS NULL)", "sandbag fee present; the orders.start_date backfill is moot (the column no longer exists); fee value not compared"),
    "20251001052039": ("BLOCKED", "sample units seed", None, "none of the 3 sample slugs exists and 16 other units exist: no rule can show the seed's effect; attest-only as 'obsolete seed, never re-run' or leave pending"),
    "20260125173238": ("BLOCKED", "recompute of all rows", None, "balance_due recompute without WHERE; the historical formula cannot be re-proved on orders edited since"),
    "20260305222010": ("BLOCKED", "recompute of all rows", None, "balance_due recompute without WHERE; the formula cannot be re-proved"),
    "20260120203953": ("DEFINED", "successor predicate", "EXISTS (SELECT 1 FROM orders) AND NOT EXISTS (SELECT 1 FROM orders WHERE tax_cents > 0 AND tax_waived = true AND tax_waive_reason = 'Auto-adjusted for compatibility with tax settings (order created before tax control feature)')",
                       "this version's waiver is reversed by 20260125170305; the combined end state is: no order still carries the auto-adjust waiver reason"),
    "20260125170305": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM orders) AND NOT EXISTS (SELECT 1 FROM orders WHERE tax_cents > 0 AND tax_waived = true AND tax_waive_reason = 'Auto-adjusted for compatibility with tax settings (order created before tax control feature)')",
                       "no order still carries the auto-adjust waiver reason"),
    "20260326004004": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM orders) AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.payment_method_last_four IS NULL AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'succeeded' AND p.payment_last4 IS NOT NULL))",
                       "no order lacks last-four where a succeeded payment has one"),
    "20260302131311": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM customers) AND NOT EXISTS (SELECT 1 FROM customers c JOIN auth.users u ON lower(c.email) = lower(u.email) WHERE c.user_id IS NULL)",
                       "no customer with a matching auth user is left unlinked (reads auth.users: count only)"),
    "20260314213726": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM addresses) AND NOT EXISTS (SELECT 1 FROM addresses WHERE address_key IS NULL AND line1 IS NOT NULL AND city IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM addresses WHERE address_key IS NOT NULL GROUP BY address_key HAVING count(*) > 1) AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='addresses_address_key_unique')",
                       "no NULL keys, no duplicate keys, unique index present; the merges themselves cannot be proved"),
    "20260314215031": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM addresses) AND NOT EXISTS (SELECT 1 FROM addresses WHERE address_key IS NOT NULL GROUP BY address_key HAVING count(*) > 1)", "no duplicate address keys"),
    "20260315173745": ("WEAK", "consistency only", "EXISTS (SELECT 1 FROM customer_profiles) AND NOT EXISTS (SELECT 1 FROM customer_profiles WHERE first_name IS NULL)", "profile names present; the backfill from auth users cannot be reproduced"),
    "20260224161311": ("WEAK", "consistency only", "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='unit_media' AND column_name='is_featured') AND EXISTS (SELECT 1 FROM unit_media WHERE is_featured)", "column exists and some media is featured; later edits make the exact backfill unverifiable"),
    "20251207160232": ("WEAK", "presence only", "EXISTS (SELECT 1 FROM hero_carousel_images)", "seed rows have no natural key; later edits are expected"),
    "20260224133344": ("WEAK", "presence only", "EXISTS (SELECT 1 FROM google_reviews)", "seed rows have no natural key"),
    "20251209133113": None,
    "20260415234700": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM invoice_links) AND NOT EXISTS (SELECT 1 FROM invoice_links WHERE link_type = 'invoice' AND deposit_cents = 0 AND customer_filled = true AND short_code IS NOT NULL)", "no row still matches the migration's three-field fingerprint"),
    "20260928172217": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='parks_acknowledgment_required') AND NOT EXISTS (SELECT 1 FROM orders WHERE id = '4ae9723c-936f-4155-ad93-2e47ef844feb' AND NOT (parks_acknowledgment_required AND parks_acknowledgment_county = 'Wayne'))",
                       "columns exist and the one hard-coded order (if present) carries the backfilled values"),
    "20260318191352": ("DEFINED", "exact predicate", "EXISTS (SELECT 1 FROM units) AND NOT EXISTS (SELECT 1 FROM units WHERE 'Water Slide' = ANY(types) AND price_water_cents = 0 AND price_dry_cents > 0)", "no water-slide unit still matches the migration's predicate"),
    "20260311113547": ("WEAK", "schema only; data vacuous", "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.stripe_webhook_events') AND conname = 'webhook_events_status_check') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.stripe_webhook_events') AND tgname = 'update_webhook_events_updated_at' AND NOT tgisinternal) AND NOT EXISTS (SELECT 1 FROM stripe_webhook_events)",
                       "constraint and trigger exist; the table is empty so the data update is vacuous (the attestation must say so)"),
    "20260203053948": None,
    "20251003182356": ("DEFINED", "natural keys minus the removed test row", None, "5 of 6 templates must exist; 'test_message' is expected ABSENT and the owner must confirm its deliberate removal in the attestation"),
    "20251003170350": ("DEFINED", "effect-present", "EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@bouncepartyclub.com')", "the account exists (reads auth.users: boolean only). The SQL must never be run; the attestation prevents a blind re-apply"),
    "20260323164559": ("DEFINED", "function identity", "EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='update_contact_booking_stats' AND md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\\r', ''), E'--[^\\n]*', '', 'g'), E'\\\\s+', '', 'g')) = '7c7137283b93eb4771425e9b139eab40')",
                       "live function body equals the file's; the all-contacts backfill is not proven and 25 counters are stale"),
}
SUPERSEDED_BY_ONLY = {"20251008153245": "20260323164559", "20260323155222": "20260323164559", "20260323163432": "20260323164559"}
NOEFFECT = {"20260611174321": "COMMENT ON TABLE only: no structural effect", "20260611172855": "NOTIFY pgrst reload only: no persistent effect", "20260415235903": "comment-only file documenting a historical gap: no executable statement"}
REPLICA = {"20260324043743", "20260324160956"}


def replica_rule(fn):
    tabs = re.findall(r"ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(?:public\.)?(\w+)\s+REPLICA IDENTITY FULL", text_of(fn), re.I)
    return tabs, " AND ".join(f"COALESCE((SELECT relreplident = 'f' FROM pg_class WHERE oid = to_regclass('public.{t}')), false)" for t in sorted(set(tabs)))


# ------------------------------------------------------------------ build rules
rules, rows = {}, []
ATOMS_OUT = {}
VALID_FILE = derived("atom-validation.json")
AV = json.load(open(VALID_FILE, encoding="utf-8"))
for v in plan:
    m = man[v]
    fn = m["filename_or_archived_source"]
    cat = m["proposed_disposition"]
    preds = [p for p in m["required_predecessor_versions"].split(";") if p]
    atoms, skipped = catalog_atoms(v)
    status, kind, note = None, "", ""
    sql_parts = []
    if cat == XSQL:
        status, kind, note = "DEFINED", "effect-absent", "Q20: the bucket limits are still NULL (verified live in E2J-B); re-check immediately before"
        bn = "carousel-media" if v == "20260325231044" else "public-assets"
        sql_parts = [f"EXISTS (SELECT 1 FROM storage.buckets WHERE id = {lit(bn)} AND file_size_limit IS NULL)"]
    elif v in OVERRIDE and OVERRIDE[v]:
        status, kind, sql, note = OVERRIDE[v]
        sql_parts = [sql]
    elif v in SPECIAL_Q and SPECIAL_Q[v]:
        status, kind, sql, note = SPECIAL_Q[v]
        if v == "20251003182356":
            keys = sorted(set(first_literals(text_of(fn)[text_of(fn).upper().index("VALUES"):])) - {"test_message"})
            sql = f"(SELECT count(*) FROM sms_message_templates WHERE template_key IN ({','.join(lit(k) for k in keys)})) = {len(keys)}"
        if sql:
            sql_parts = [sql]
    elif v in NOEFFECT:
        status, kind, note = "DEFINED", "vacuous (no persistent effect)", NOEFFECT[v]
        sql_parts = ["true"]
    elif v in REPLICA:
        tabs, rr = replica_rule(fn)
        status, kind, note = ("DEFINED", "catalog", f"replica identity FULL on {', '.join(sorted(set(tabs)))}") if rr else ("BLOCKED", "none", "no table parsed")
        sql_parts = [rr] if rr else []
    elif v in SUPERSEDED_BY_ONLY:
        status, kind, note = "DEFINED", "supersession", f"superseded by {SUPERSEDED_BY_ONLY[v]}; its function body identity is verified by that version's rule; this item needs the predecessor recorded"
        sql_parts = ["true"]
    else:
        d_atoms, d_notes, unhandled = data_atoms(v, fn)
        text_derived = False
        if cat == HIST and not atoms:
            atoms = text_schema_atoms(fn)
            text_derived = bool(atoms)
        dropped = []
        if text_derived and AV:
            dropped = [a for a in atoms if AV.get(a) is False]
            atoms = [a for a in atoms if AV.get(a) is not False]
        ATOMS_OUT[v] = list(atoms)
        sql_parts = atoms + [a for a in d_atoms if a]
        if dropped:
            d_notes = d_notes + [f"{len(dropped)} text-derived object(s) no longer exist on the captured schema (superseded/dropped later) and are not checked"]
        if cat == HIST and unhandled and sql_parts:
            status, kind = "DEFINED", "catalog" + ("(text-derived, pruned locally)" if text_derived else "")
            note = "; ".join(d_notes + ["data/DO statements covered by the E2A supersession evidence, not re-checked: " + "; ".join(sorted(set(unhandled)))])
        elif unhandled:
            status, kind = ("WEAK" if sql_parts and cat == ATT else "BLOCKED"), "partial"
            note = "; ".join(d_notes + ["UNVERIFIED: " + "; ".join(sorted(set(unhandled)))])
        elif sql_parts:
            status, kind = "DEFINED", ("catalog" + ("+data" if d_atoms else "")) + ("(text-derived, pruned locally)" if text_derived else "")
            note = "; ".join(d_notes) or f"{len(atoms)} catalog objects must exist"
        elif preds:
            status, kind, note = "DEFINED", "supersession", "every statement is superseded by a predecessor (recorded first) or is a no-op; no catalog object of its own remains to check"
            sql_parts = ["true"]
        else:
            status, kind, note = "BLOCKED", "none", "no verifiable object or predicate could be derived"
    if v in ("20251003182356",):
        pass
    if AV and any(AV.get(a) is False for a in (ATOMS_OUT.get(v) or [])):
        status = "BLOCKED"
        note += " | a catalog atom is FALSE on the captured schema: investigate before use"
    if skipped:
        note += f" | not checked: {', '.join(skipped[:3])}{'...' if len(skipped) > 3 else ''}"
    sql = " AND ".join(f"({p})" for p in sql_parts) if sql_parts else ""
    rules[v] = {"status": status, "kind": kind, "sql": ("SELECT " + sql + " AS rule_ok") if sql else "", "note": note, "predecessors": preds, "atoms": len(sql_parts)}
json.dump(rules, open(os.path.join(AUDIT, "development-verification-rules.json"), "w", encoding="utf-8", newline="\n"), indent=1)
print("rule status", dict(Counter(r["status"] for r in rules.values())), "by disposition", dict(Counter((man[v]["proposed_disposition"][:4], rules[v]["status"]) for v in plan)))
json.dump({"plan": plan}, open(os.path.join(SCR, "rules-plan.json"), "w", newline="\n"))
json.dump(ATOMS_OUT, open(os.path.join(SCR, "atoms.json"), "w", newline="\n"))
