"""Stage E2E: builds the PROPOSED Development-only manifest (e2e-development-manifest.csv) from the captured Development and Production catalogs and histories (Stage B, 2026-10-16),
the E2A/E1 proof files and the E2C/E2D manifests. READ-ONLY and OFFLINE: reads repository evidence and the protected capture folder; contacts no database; writes one CSV and prints counts.
Nothing here is an executable manifest or an approval. Usage: python -I e2e_dev_manifest.py"""
import csv
import json
import os
import re
from collections import Counter

EV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
P = r"C:\Users\vikki\migration-evidence\stage-b-20261016"


def cat(env, f):
    return json.load(open(f"{P}\\{env}_catalog_{f}.json", encoding="utf-8"))


def rd(name):
    return list(csv.DictReader(open(os.path.join(EV, name), encoding="utf-8", newline="")))


C = {e: {f: cat(e, f) for f in ("columns", "policies", "indexes", "constraints", "functions", "grants_functions", "triggers", "extensions")} for e in ("prod", "dev")}
dev_hist = {r["version"]: r for r in cat("dev", "history")}
prod_hist = {r["version"] for r in cat("prod", "history")}
dev_rec58 = {r["version"]: r for r in rd("dev-history-58.csv")}
dev_proof = {r["version"]: r for r in rd("e2a-dev-proof.csv")}
actions = {r["version"]: r for r in rd("e2a-proposed-actions.csv") if r["environment"] == "Development"}
e2c = {r["version"]: r for r in rd("e2c-proposed-execution-manifest.csv")}
WITHDRAWN = {"20260305203528": "Case 41", "20260407203226": "Case 42", "20260407211122": "Case 43"}
OCT = sorted(v for v, r in actions.items() if v >= "20261007120000")
assert len(OCT) == 23


def lookup(env, key):
    c = C[env]
    kind, _, rest = key.partition(":")
    if kind == "policy":
        m = re.match(r"(storage\.objects|[a-z_]+)\.(.*)", rest)
        sch, t = ("storage", "objects") if m.group(1) == "storage.objects" else ("public", m.group(1))
        r = [p for p in c["policies"] if p["schema"] == sch and p["tbl"] == t and p["name"] == m.group(2)[:63]]
        return ("present", json.dumps([r[0]["cmd"], r[0]["roles"], r[0]["qual"], r[0]["with_check"]])) if r else ("absent", "")
    if kind == "col":
        t, col = rest.split(".")
        r = [x for x in c["columns"] if x["schema"] == "public" and x["tbl"] == t and x["name"] == col]
        return ("present", json.dumps([r[0]["type"], r[0]["not_null"], r[0]["default_expr"]])) if r else ("absent", "")
    if kind == "constraint":
        t, n = rest.split(".")
        r = [x for x in c["constraints"] if x["tbl"] == t and x["name"] == n]
        return ("present", r[0]["def"]) if r else ("absent", "")
    if kind == "index":
        r = [x for x in c["indexes"] if x["name"] == rest]
        return ("present", r[0]["def"]) if r else ("absent", "")
    if kind == "trigger":
        m = re.match(r"(auth|storage|public)\.([a-z_]+)\.(.*)", rest)
        r = [x for x in c["triggers"] if x["tbl"] == m.group(2) and x["name"] == m.group(3)]
        return ("present", r[0]["def"]) if r else ("absent", "")
    if kind == "extension":
        r = [x for x in c["extensions"] if x["name"] == rest]
        return ("present", r[0]["version"]) if r else ("absent", "")
    if kind == "function":
        r = [x for x in c["functions"] if x["name"] == rest]
        return ("present", str(len(r))) if r else ("absent", "")
    if kind == "grant":
        _, fn, role, priv = rest.split(":")
        g = [x for x in c["grants_functions"] if x["name"] == fn and x["grantee"] in (role, "PUBLIC") and x["privilege_type"] in (priv, "EXECUTE", "ALL")]
        fx = [x for x in c["functions"] if x["name"] == fn]
        return ("present" if g else "absent" if fx else "absent (function absent)", "")
    return ("not compared", "")


def compare(objs):
    out = []
    for o in [x for x in objs.split("; ") if x]:
        if o.startswith("inline-constraint"):
            out.append(f"{o}: not compared (inline)")
            continue
        p, d = lookup("prod", o), lookup("dev", o)
        rel = "identical" if p == d else "differs"
        out.append(f"{o}: Production {p[0]}, Development {d[0]}, {rel}")
    return out


# versions whose refined handling is decided by object-level comparison with the Production reference (E2E refinement of the E2A class)
NET_ZERO_CHAINS = {  # version -> the later versions that drop what it creates
    "20260315190615": ("20260316162524", "20260316234814"), "20260315202232": ("20260316162524", "20260316234814"), "20260316174421": ("20260316234814",),
    "20260324191543": ("20260324191556",),
}


def classify(v, dp, act):
    """Returns (category, subcategory, evidence, action, gate)."""
    if v in WITHDRAWN:
        return ("Explicitly withdrawn or excluded", "withdrawn by owner decision (D-3/D-4); not yet moved", f"{WITHDRAWN[v]}; see e2c-version-identity-impact.md", "none: stays out of every history and every execution list", "repository withdrawal needs separate authorization")
    if v == "20260814120000":
        return ("Already recorded", "recorded in Development as 20260814002658 (identity alias)", "recorded SQL digests equal the file (e2a-recorded-exceptions.md item 4)", "none for history; repository rename or alias annotation is a separate decision (D-5)", "see e2e-repository-cleanup-plan.md section 4")
    if v in OCT:
        return ("Withheld until security or containment prerequisites", "October migration behind the deployment gate", f"E2A class {act['e2a_class']}; absent in Development and Production", "SQL execution after the gate opens (not before)", "Edge Function stubs/containment, signed-URL consumers, customer-cancel-order, F-2, local Development rehearsal")
    cls = dp["e2a_class"]
    objs = dp["absent_or_unmatched_objects"]
    cmp_ = compare(objs)
    ev = f"E2A {cls}: {dp['basis']}"
    if cmp_:
        ev += " | " + " ; ".join(cmp_)
    if cls == "H":
        return ("History-only reconciliation candidate", "all material statements present, superseded or no-op in Development", ev, "history-only record after fresh re-verification (D-6); never executed", "fresh capture; marker wording")
    if v in NET_ZERO_CHAINS:
        later = ", ".join(NET_ZERO_CHAINS[v])
        return ("History-only reconciliation candidate", "net-zero chain: creates what a later version drops; object absent in both Production and Development", ev + f" | later drop in {later}; Production recorded the whole chain and lacks the object", "history-only record only together with its dropping version(s); NEVER execute (a transient SECURITY DEFINER function/grant would be created)", "dropping version(s) must be recorded or proven first")
    if any("storage.objects" in o for o in objs.split("; ")):
        return ("Withheld until security or containment prerequisites", "storage.objects policy absent in Development, present in Production (consistent with containment removal, unverified)", ev, "do not restore by default; final storage policy set is defined by the October migrations", "containment decision; October storage migrations")
    if "extension:pg_net" in objs:
        return ("Withheld until security or containment prerequisites", "pg_net extension present in Production, absent in Development; the calendar-sync trigger path calls Edge Functions", ev, "no action until Edge Functions are restored and the owner decides", "Edge Function deployment dependency")
    if "trigger:auth.users.on_auth_user_created" in objs:
        return ("Withheld until security or containment prerequisites", "signup trigger present in Production, absent in Development; the October role repair (20261016120000) recreates it", ev, "do not replay the historical definition; covered by the October gate", "October gate; role/signup provisioning tests")
    if cls == "P" and not objs:
        return ("Requires additional evidence", "data or dynamic statement not provable from a schema capture", ev, "read-only count queries (readonly_queries_needed in e2a-dev-proof.csv) or a labelled owner attestation", "fresh read-only access; attestation wording")
    return ("Requires additional evidence", "object definition differs from the version's chain or from the Production reference", ev, "compare the live definition with Production's, then decide: history-only, targeted alignment, or accept drift", "read-only definition queries (e2a-unresolved-evidence.md A); owner review")


rows = []
# 1. recorded in Development (58)
for v in sorted(dev_hist):
    r = dev_rec58.get(v)
    alias = v == "20260814002658"
    pr = "recorded in Production" if v in prod_hist else "not recorded in Production"
    if v in e2c:
        rel = "in the 58-version Production candidate (execute)" if e2c[v]["proposed_action"] == "execute" else "omitted from the Production 58 (history-only candidate there)"
    else:
        rel = "not in the Production 67 (baseline or recorded in Production)"
    note = ""
    if v == "20260722172048":
        note = "recorded in Development with its effect present; D-2 includes it in the Production release; no Development action"
    if alias:
        note = "recorded SQL identical to repository file 20260814120000; no repository file has this version (D-5)"
    if r and r["class"] != "RECORDED_CONSISTENT":
        note = (note + " | " if note else "") + f"recorded but {r['class']}: {r['recommended_resolution'][:140]}"
    rows.append([v, (dev_hist[v]["name"] if alias else (r["file"] if r else dev_hist[v]["name"])), "recorded in Development", "Already recorded", "recorded row consistent" if (r and r["class"] == "RECORDED_CONSISTENT") else "see note", f"Development history row; catalog verdict {(r or {}).get('catalog_verdict', '')}", pr + "; " + rel, "none", "none", note])

# 2. pending in Development (329) plus the excluded Case 43
pend = set(dev_proof) | set(OCT)
assert len(pend) == 329, len(pend)
files = {r["version"]: r["file"] for r in rd("e2a-proposed-actions.csv") if r["environment"] == "Development"}
for v in sorted(pend):
    act = actions[v]
    dp = dev_proof.get(v)
    cat_, sub, ev, action, gate = classify(v, dp, act) if dp or v in OCT else None
    if v in prod_hist:
        pr = "recorded in Production"
    elif v in e2c:
        pr = "Production 67: " + ("execute in the 58 candidate" if e2c[v]["proposed_action"] == "execute" else "omitted from the 58 (history-only candidate)")
    elif v in WITHDRAWN:
        pr = "Production: identity case"
    else:
        pr = "Production baseline version (not in the 67)"
    rows.append([v, files[v], "pending in Development", cat_, sub, ev, pr, action, gate, ""])
rows.append(["20260407211122", "20260407211122_add_anon_insert_policy_order_changelog_cancellation.sql", "no repository file (withdrawn in Stage C3)", "Explicitly withdrawn or excluded", "Case 43 withdrawn before application", "audit/evidence/withdrawn-migrations/; case-43-impact-analysis.md", "not recorded anywhere", "none: must never be recorded or executed", "none", ""])

PHASE = {"Already recorded": "none", "Explicitly withdrawn or excluded": "none", "Requires additional evidence": "E0 read-only evidence, then owner decision",
         "History-only reconciliation candidate": "E1 history-only records after fresh re-verification", "Withheld until security or containment prerequisites": "E3 only after the gate"}


def sql_expected(r):
    if r[3] == "Withheld until security or containment prerequisites":
        return "yes, after the gate (October)" if r[0] in OCT else "unknown: decided after the gate; never by replaying the historical file"
    if r[3] == "Requires additional evidence":
        return "possible targeted alignment only if the evidence shows Development behind Production; not the historical file"
    return "no"


with open(os.path.join(EV, "e2e-development-manifest.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["version", "filename", "development_state_now", "proposed_category", "subcategory", "evidence", "production_reference_and_58_relation", "proposed_development_action", "gate_or_prerequisite", "note", "proposed_phase", "sql_execution_expected"])
    for r in rows:
        w.writerow(r + [PHASE[r[3]], sql_expected(r)])

cnt = Counter(r[3] for r in rows)
sub = Counter((r[3], r[4][:60]) for r in rows)
print("rows", len(rows), dict(cnt))
for k, n in sorted(sub.items()):
    print(" ", n, k)
