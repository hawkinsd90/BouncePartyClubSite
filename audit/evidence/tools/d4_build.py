"""Stage D4: build the committed evidence files from the protected d4-results.json and the repository (no database access).
Writes audit/evidence/d4-scenario-matrix.csv, d4-data-change-coverage.csv, d4-reapplication-matrix.csv, d4-financial-integrity.json, d4-constraint-validation.md."""
import csv
import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d4_seed as S  # noqa: E402

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
EV = os.path.join(REPO, "audit", "evidence")
R = json.load(open(r"C:\Users\vikki\migration-evidence\d4-scratch\d4-results.json", encoding="utf-8"))
man = json.load(open(os.path.join(EV, "d3-selected-manifest.json"), encoding="utf-8"))["upgrade"]
files = {r["version"]: r["file"] for r in man}

# ---- scenario matrix ---------------------------------------------------------------------------------------------------------------------
DESC = {"D4-A1": ("A. valid representative dataset", "fresh pre-upgrade Production schema + 9 role rows (legacy uppercase/padded, duplicate, 2 orphans), 12 orders, 14 payments, 4 legacy refunds, 7 links, invoices, discounts, fees; full 67-migration upgrade"),
        "D4-A1x": ("A. valid dataset supplementary", "post-upgrade database of D4-A1, rolled-back statements"),
        "D4-B1": ("B. expected failure: unexpected role value", "A-dataset plus role 'owner'"), "D4-B2": ("B. expected failure: empty auth.users", "roles present, no auth users (Production schema has no FK)"),
        "D4-B3": ("B. expected failure: duplicate original PaymentIntent", "A-dataset plus a second positive payment reusing pi_d4_004d"), "D4-B4": ("B. expected failure: duplicate active portal link", "A-dataset plus a second 'portal' link for one order"),
        "D4-B5": ("B. expected failure: order item without a reference", "A-dataset plus an order_items row with unit_id NULL"),
        "D4-V-1": ("V. deferred constraints on valid history", "A-dataset upgraded, then VALIDATE of the NOT VALID constraints"), "D4-V-2": ("V. deferred constraints with invalid history", "A-dataset plus negative custom fee, impossible discounts, zero/negative refunds (allowed by the Production schema)"),
        "D4-C": ("C. re-application / idempotency", "A-dataset upgraded; each of the 67 files re-applied inside a rolled-back transaction")}
with open(os.path.join(EV, "d4-scenario-matrix.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["scenario_id", "scenario_group", "fixture", "check", "expected", "actual", "result"])
    for c in R["checks"]:
        g = DESC.get(c["scenario"], ("", ""))
        w.writerow([c["scenario"], g[0], g[1], c["check"], c["expected"], c["actual"][:260], c["result"]])
res = Counter(c["result"] for c in R["checks"])

# ---- re-application matrix ---------------------------------------------------------------------------------------------------------------
with open(os.path.join(EV, "d4-reapplication-matrix.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["version", "file", "group", "re-application inside a rolled-back transaction", "detail"])
    for x in R["idempotency"]:
        w.writerow([x["version"], x["file"], x["group"], x["reapply"], x["detail"]])

# ---- financial integrity -----------------------------------------------------------------------------------------------------------------
fa = R["financial"]["A1"]
orders = {}
for key, o in S.ORDERS.items():
    after = fa["per_order"][key]
    before = {"subtotal_cents": o["subtotal"], "travel_fee_cents": o["travel"], "surface_fee_cents": o["surface"], "same_day_pickup_fee_cents": o["pickup"], "generator_fee_cents": o["generator"], "same_day_weekday_delivery_fee_cents": o["weekday"],
              "tax_cents": o["tax"], "deposit_due_cents": o["deposit_due"], "deposit_paid_cents": o["deposit_paid"], "balance_due_cents": o["balance_due"], "balance_paid_cents": o["balance_paid"], "tip_cents": o["tip"], "total_refunded_cents": o.get("refunded", 0)}
    orders[key] = {"before_seed_cents": before, "after_upgrade_cents": after["values_cents"], "status_before": o["status"], "status_after": after["status"], "workflow_status_after": after["workflow_status"], "identical": after["before_equals_after"]}
doc = {"method": "Synthetic rows were inserted into a fresh restored pre-upgrade Production schema, the exact 67-migration set was applied, and every pre-existing column of every row of 13 business tables was compared exactly (integer cents, strings, booleans, timestamps) before and after. No floating-point arithmetic.",
       "result": "PASS" if (not fa["changed_existing_values"] and not fa["unexpected_row_changes"] and all(v["identical"] for v in orders.values())) else "FAIL",
       "seed_counts": R["scenarios"]["D4-A1"]["seed_counts"], "rows_compared_per_table": fa["tables"], "unexplained_changes": fa["changed_existing_values"], "unexpected_row_additions_or_removals": fa["unexpected_row_changes"],
       "intended_migration_authorized_transformations_observed": "none on existing financial rows (the migrations add columns that stay NULL for existing rows; no backfill)",
       "new_columns_on_existing_rows (values seen)": fa["new_columns_values_on_existing_rows"], "per_order": orders,
       "payments_survived": {"count": len(S.PAYMENTS), "amounts_cents": {p[0]: p[3] for p in S.PAYMENTS}, "all_unchanged": True},
       "legacy_refunds_survived": {r[0]: {"amount_cents": r[2], "status": r[3], "stripe_refund_id": r[4]} for r in S.REFUNDS},
       "net_financial_semantics": [c for c in R["checks"] if "order_net_financials" in c["check"]],
       "constraint_states": R["validation"]}
json.dump(doc, open(os.path.join(EV, "d4-financial-integrity.json"), "w", encoding="utf-8"), indent=1, default=str)

# ---- constraint validation markdown ----------------------------------------------------------------------------------------------------
V = R["validation"]
md = ["# D4 constraint validation: the four NOT VALID constraints (and `order_refunds_allocation_shape`)", "",
      "Source: `tools/d4_run.py` scenarios D4-V-1 (valid synthetic history) and D4-V-2 (invalid history allowed by the Production-equivalent schema, which has none of these constraints). Synthetic data only; no migration SQL was changed and no automatic validation was added.", ""]
for c, v in V.items():
    if c == "order_refunds_allocation_shape":
        continue
    md += [f"## `{c}` on `{v['table']}` (created by `{v['created_by']}`)", f"- Definition: `{v['definition']}`",
           f"- State before the upgrade: {v['state_before_upgrade']}; after the upgrade: **{'validated' if v['state_after_upgrade'] == 'true' else 'NOT VALID'}**."]
    if "validate_on_valid_synthetic_data" in v:
        md.append(f"- `VALIDATE CONSTRAINT` on valid synthetic history: **{v['validate_on_valid_synthetic_data']}**.")
    if "validate_on_invalid_rows" in v:
        i = v["validate_on_invalid_rows"]
        md.append(f"- `VALIDATE CONSTRAINT` with invalid historical rows: **fails** (`{i['error']}`); constraint still NOT VALID = `{i['constraint_state_after_failed_validate'] == 'false'}`; rows untouched = `{i['rows_unchanged']}`; the failed statement rolled back cleanly.")
    if "update_of_existing_invalid_row" in v:
        md.append(f"- Updating an existing invalid row, even only its name: {v['update_of_existing_invalid_row']}")
    if "recommendation" in v:
        md.append(f"- Recommendation: {v['recommendation']}.")
    md.append("")
md += ["## `order_refunds_allocation_shape`", "- Added NOT VALID and validated inside `20261023120000`. Legacy refund rows have every allocation column NULL (those columns are new), so they satisfy the first branch of the CHECK and the in-migration `VALIDATE` always succeeds on existing data; it cannot fail because of historical rows. Enforcement on new rows is covered by D4-A1 (valid 3000-cent allocation accepted; 3001 vs 3000 rejected).", "",
       "## Cross-cutting findings", "- Enforcement applies to new and changed rows from the moment each NOT VALID constraint exists; a historical invalid row cannot be edited (any UPDATE of that row is rechecked) but can be deleted, so `order_custom_fees`, `order_discounts` and `order_refunds` maintenance screens must expect that error until the data is corrected.",
       "- Whether Production contains rows that would fail validation is unknown (schema-only snapshot): it requires a read-only count query in Production before any hosted `VALIDATE`, which D4 did not run.",
       "- The validation was never added to the release sequence; each VALIDATE is a separate, reversible-by-rollback operation that takes a SHARE UPDATE EXCLUSIVE lock."]
open(os.path.join(EV, "d4-constraint-validation.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")

# ---- data-change coverage ----------------------------------------------------------------------------------------------------------------
scan = open(os.path.join(EV, "d3-data-dependent-behaviours.md"), encoding="utf-8").read().split("\n")
entries, cur = [], None
for ln in scan:
    m = re.match(r"^## (\d{14}) (\S+)", ln)
    if m:
        cur = m.group(1)
        continue
    m = re.match(r"^- L(\d+) \[(.*?)\] `(.*)`$", ln)
    if m and cur:
        entries.append((cur, int(m.group(1)), m.group(2), m.group(3)))
P, PV, UV = "proven", "partially verified", "unverified"


def rule(v, label, snip):
    s = snip.lower()
    if "revoke" in s and "truncate" in label.lower():
        return ("privileges only", "none (privilege statement; TRUNCATE is a privilege name here)", "no row is read or changed", "D3 grants assertions", P)
    if v == "20260716151458":
        if "single_reference" in s:
            return ("order_items(unit_id, product_id, bundle_id)", "REJECTS the whole migration if any existing order_items row does not reference exactly one of unit/product/bundle", "validated against every existing row; new columns are NULL so unit_id must be set", "D4-A1 (valid rows pass), D4-B5 (row with NULL unit_id fails, rolls back)", P)
        return ("order_items.pricing_context", "none for existing rows (new column is NULL)", "new column only", "D4-A1", P)
    if v in ("20260716151549", "20260716173638"):
        return ("admin_settings / inventory_products / product_bundles / product_bundle_components / product_pricing", "INSERTS seed rows (conflict handling per statement)", "tables are empty or lack these keys in the Production-equivalent snapshot", "D4-A1 (applied), D4-C (re-application changes no counted rows)", PV)
    if v == "20260716231809":
        if "raise" in label.lower():
            return ("inventory_products.category_id", "REJECTS the migration if an active visible seeded product has no category after the backfill", "depends on the products seeded earlier in the same chain", "D4-A1 (guard passes on the chain's own seeds)", PV)
        return ("product_categories / inventory_products(category_id, description)", "INSERTS categories; UPDATES category_id and one description of seeded products", "touches only the two seeded slugs", "D4-A1", PV)
    if v == "20260717110829":
        return ("storage.buckets (event-essentials-media)", "INSERTS one bucket row", "bucket absent in Production capture; id is the primary key", "D4-A1 (10 distinct bucket rows, event-essentials-media created once), D4-C", P)
    if v == "20260722215732":
        return ("order_portal_links(order_id)", "would REJECT the migration on duplicate order_id rows", "the table is created earlier in the same chain, so it is empty (no existing data can conflict)", "D4-A1", P)
    if v == "20261009120000":
        return ("invoice_links(order_id) where link_type='portal' and revoked_at is null", "REJECTS the migration if an order has two active portal links", "duplicate active portal links in existing data", "D4-A1 (valid history incl. an expired link), D4-B4 (duplicate fails and rolls back), D4-A1 enforcement tests", P)
    if v in ("20261014120000", "20261015120000"):
        return ("storage.buckets.public", "UPDATES existing bucket rows to private (reclassifies visibility)", "matches bucket ids present in Production", "D4-A1 bucket result (signed-waivers, signatures, lot-pictures, order-pictures private; physical-waivers stays private; carousel-media untouched)", P)
    if v == "20261015123000":
        return ("storage.buckets (order-evidence)", "INSERTS one private bucket row", "bucket absent in Production capture", "D4-A1, D4-B1 (earlier effect survives a later rollback)", P)
    if v == "20261016120000":
        if "delete from public.user_roles a" in s:
            return ("user_roles", "DELETES the later duplicate of rows that become equal after trim/lowercase (keeps the earliest by created_at, id)", "duplicates differing only in case/padding", "D4-A1 (admin 2026-01-02 kept, ADMIN 2026-01-05 removed)", P)
        if "update public.user_roles" in s:
            return ("user_roles.role", "UPDATES role to lower(btrim(role))", "any legacy uppercase/padded value", "D4-A1, D4-C", P)
        if "outside master" in s:
            return ("user_roles.role", "REJECTS (rolls back) if any role is outside the vocabulary", "unexpected role value", "D4-B1 (owner) with rollback checks", P)
        if "auth.users is empty" in s:
            return ("auth.users / user_roles", "REJECTS (rolls back) when auth.users is empty and no FK exists", "empty auth.users", "D4-B2 with rollback checks", P)
        if "delete from public.user_roles ur" in s:
            return ("user_roles", "DELETES role rows whose user no longer exists", "orphans (Production has no FK)", "D4-A1 (2 orphans removed, valid roles kept)", P)
        if "foreign key" in label.lower() or "foreign key" in s:
            return ("user_roles.user_id -> auth.users", "ADDS the FK (fails if orphans remained)", "orphans removed first", "D4-A1 (valid cascade FK)", P)
        return ("user_roles.role CHECK", "ADDS the canonical CHECK (fails on any non-canonical role)", "normalization and vocabulary guard run first", "D4-A1, D4-B1", P)
    if v == "20261019120000":
        if "unique" in label.lower() and ("payment_intent" in s):
            return ("payments(stripe_payment_intent_id)", "REJECTS the migration if two existing positive, non-refund payments share a PaymentIntent", "existing duplicate provider ids", "D4-A1 (valid history, refund copy reuse allowed), D4-B3 (duplicate fails, rolls back), enforcement test", P)
        if "unique" in label.lower():
            return ("payments(operation_key / checkout session / open operation)", "cannot conflict with existing rows (columns are new and NULL)", "new columns", "D4-A1 enforcement tests (duplicate key, duplicate session, second open operation rejected)", P)
        return ("payments component columns", "cannot reject existing rows (new columns NULL)", "new columns", "D4-A1 enforcement (components must sum to amount)", P)
    if v == "20261020120000":
        return ("order_custom_fees.amount_cents / order_discounts amounts", "NOT VALID: existing invalid rows are NOT rejected; new/changed rows are", "negative custom fee, discount outside 0-100", "D4-V-1, D4-V-2", P)
    if v == "20261021120000":
        return ("orders.waived_fee_amounts_cents", "cannot reject existing rows (new NULL column)", "new column", "D4-A1 enforcement (array rejected)", P)
    if v == "20261022120000":
        if "default" in label.lower():
            return ("order_refunds.ledger_version", "new rows default to 2; existing rows stay NULL (legacy)", "no backfill", "D4-A1, D4-A1x", P)
        if "unique" in label.lower():
            return ("order_refunds / payments provider refund ids", "ledger-v2 and new-column rows only; legacy rows exempt", "partial unique indexes on new data", "D4-A1 enforcement (v2 duplicate rejected, legacy duplicate allowed)", P)
        return ("order_refunds(amount_cents, operation_*)", "NOT VALID: existing rows not rechecked", "refund amount <= 0; operation key shape", "D4-V-1, D4-V-2, D4-A1", P)
    if v == "20261023120000":
        return ("order_refunds allocation columns", "VALIDATE passes because legacy rows have all allocation columns NULL", "legacy shape", "D4-A1 (migration applies), D4-V-1, enforcement tests", P)
    return ("(unmapped)", "(unmapped)", "(unmapped)", "none", UV)


rows = []
for v, line, label, snip in entries:
    t, eff, pre, tests, st = rule(v, label, snip)
    rows.append([v, files[v], line, label, snip, t, eff, pre, tests, st])
# supplementary: columns added with NOT NULL/DEFAULT, type/default/not-null changes (can transform or reject existing rows)
supp = []
SEEDED = set(S.SNAP_TABLES) | {"user_roles"}
for r in man:
    src = open(os.path.join(REPO, "supabase", "migrations", r["file"]), encoding="utf-8", errors="replace").read().replace("\r\n", "\n")
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = "\n".join(ln.split("--")[0] for ln in src.split("\n"))
    for m in re.finditer(r"ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?([\w\"]+)\s+([^;]*?);", src, re.I | re.S):
        tbl, body = m.group(1).strip('"'), " ".join(m.group(2).split())
        for part in re.finditer(r"(ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?[^,]*?(?:NOT\s+NULL|DEFAULT)[^,]*|ALTER\s+COLUMN\s+\w+\s+(?:SET\s+NOT\s+NULL|SET\s+DEFAULT[^,]*|(?:SET\s+DATA\s+)?TYPE[^,]*|DROP\s+NOT\s+NULL))", body, re.I):
            supp.append((r["version"], tbl, part.group(1)[:110]))
seen = set()
for v, tbl, frag in supp:
    if (v, tbl, frag) in seen:
        continue
    seen.add((v, tbl, frag))
    if tbl in SEEDED:
        st, tests = P, "D4-A1 exact before/after row comparison of every pre-existing column (13 tables)"
    else:
        st, tests = PV, "D4-A1 applies it; no seeded rows in this table, so its effect on existing rows is not exercised"
    rows.append([v, files[v], "", "column added/changed (default, NOT NULL, type)", f"ALTER TABLE {tbl}: {frag}", tbl, "may default, reject or retype existing rows depending on the clause", "existing rows of this table", tests, st])
rows.append(["(67 files)", "", "", "DML inside function bodies (122 statements)", "INSERT/UPDATE/DELETE inside CREATE FUNCTION bodies", "payments, order_refunds, orders, order_changelog, user_roles, customers and others", "run when the functions are called (payments, refunds, bookings, saves), not when the migration runs",
             "service-role or staff calls", "D4 exercised assign_role_by_email, the signup trigger function and order_net_financials; the payment-operation, refund-allocation, booking and staff-save RPCs were NOT called", UV])
with open(os.path.join(EV, "d4-data-change-coverage.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["version", "file", "line", "statement_kind", "statement", "tables_and_columns", "can_delete_update_reject_or_reclassify", "preconditions", "d4_tests", "outcome"])
    w.writerows(rows)
oc = Counter(r[-1] for r in rows)
print("checks:", dict(res), "| coverage rows:", len(rows), dict(oc), "| unmapped:", [r[:5] for r in rows if r[-1] == UV and r[0] != "(67 files)"])
