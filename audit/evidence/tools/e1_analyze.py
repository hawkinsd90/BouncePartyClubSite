"""Stage E1: reconciliation readiness analysis. READ-ONLY analysis of existing local evidence (Stage B captures and CSVs, D3/D4 results); no database, hosted or
local, is contacted and nothing is inserted anywhere. Produces audit/evidence/e1-reconciliation-readiness.csv, e1-evidence-gap-register.csv and a summary JSON
(protected folder). Verdicts come from the Stage B classification; this script adds no new proof, it re-groups the existing proof into the seven E1 categories and
states what is missing. Usage: python -I e1_analyze.py"""
import collections
import csv
import json
import os
import re

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
EV = os.path.join(REPO, "audit", "evidence")
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\e1-scratch"
os.makedirs(OUT, exist_ok=True)

CAT = {1: "1 Recorded and verified as applied", 2: "2 Effects present (catalog-proven)", 3: "3 Effects partially present", 4: "4 Effects absent: SQL execution required",
       5: "5 Effects superseded by an identified later migration", 6: "6 Alias / version-identity discrepancy", 7: "7 Not yet proven"}
matrix = {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "version-matrix-all-387.csv"), encoding="utf-8"))}
matrix.pop("20260407211122", None)  # withdrawn Case 43: not in the repository, never marked applied
assert len(matrix) == 386
raw = json.load(open(os.path.join(PROT, "classification_raw.json"), encoding="utf-8"))
man = json.load(open(os.path.join(EV, "stage-b-manifest.json"), encoding="utf-8"))
fp = {e: man["fingerprints"][e]["catalog_fingerprint_sha256"] for e in ("prod", "dev")}
hist = {e: {x["version"]: x for x in json.load(open(os.path.join(PROT, f"{e}_catalog_history.json"), encoding="utf-8"))} for e in ("prod", "dev")}
hist_csv = {"prod": {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "prod-history-277.csv"), encoding="utf-8"))},
            "dev": {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "dev-history-58.csv"), encoding="utf-8"))}}
pend_csv = {"prod": {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "prod-pending-110.csv"), encoding="utf-8"))},
            "dev": {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "dev-pending-330.csv"), encoding="utf-8"))}}
d3 = {r["version"]: r for r in json.load(open(os.path.join(EV, "d3-execution-report.json"), encoding="utf-8"))["results"]}
ALIAS = {"prod": {"20260305203528": "case 41: Production recorded the related version 20260305205811 (different SQL)", "20260407203226": "case 42: Production recorded the related version 20260408200431 (different SQL)"},
         "dev": {"20260305203528": "case 41 (related version 20260305205811 is recorded on Production only)", "20260407203226": "case 42 (related version 20260408200431 is recorded on Production only)",
                 "20260814120000": "Development recorded this migration as 20260814002658 (version differs from the file)"}}
U5 = "20260722172048"
DEV_MISSING_RECORDED = "20260814002658"
OCT = lambda v: v >= "20261007000000"


def has_data(m):
    return m["data_stmts"] != "ins0/upd0/del0/trunc0" or m["dynamic_sql"] not in ("0", "")


def supers(env, v):
    return sorted({m.group(1) for s in raw[env][v]["super_items"] for m in [re.search(r"->(\d{14})$", s)] if m})


rows, gaps = [], []
status_of = {}  # (env, version) -> (category, recorded)
for env, label in (("prod", "Production"), ("dev", "Development")):
    for v, m in matrix.items():
        rec = v in hist[env]
        verdict = m[f"{env}_verdict"]
        rw = raw[env][v]
        group = "october" if OCT(v) else "baseline" if m["is_baseline"] == "1" else "other"
        flags = []
        if rec:
            c = hist_csv[env].get(v, {}).get("class", "")
            if c == "RECORDED_EFFECT_MISSING":
                cat = 3
                flags.append("recorded but catalog shows missing effects: " + hist_csv[env][v]["missing_items"][:160])
            else:
                cat = 1
                if verdict == "PRESENT_NAME_LEVEL":
                    flags.append("recorded; effect verified at object-name level only")
                if verdict == "NO_CATALOG_EFFECT":
                    flags.append("recorded; data/privilege effect not catalog-verifiable")
        elif v in ALIAS[env]:
            cat = 6
            flags.append(ALIAS[env][v])
        else:
            dat = has_data(m)
            if dat:
                flags.append(f"data statements {m['data_stmts']}, dynamic SQL {m['dynamic_sql']}: data effect not catalog-verifiable")
            if verdict == "PRESENT":
                cat = 7 if dat else 2
            elif verdict == "SUPERSEDED":
                cat = 7 if dat else 5
            elif verdict in ("PRESENT_NAME_LEVEL", "NO_CATALOG_EFFECT"):
                cat = 7
            elif verdict == "PARTIAL":
                cat = 3
            elif verdict in ("ABSENT", "PENDING_CHAIN"):
                cat = 4
            else:
                cat = 7
        status_of[(env, v)] = cat
        rows.append({"env": label, "version": v, "file": m["file"], "group": group, "recorded": rec, "verdict": verdict, "cat": cat, "raw": rw, "m": m, "flags": flags, "e": env})

dev_only = {"env": "Development", "version": DEV_MISSING_RECORDED, "file": "(no repository file)", "group": "other", "recorded": True, "verdict": "n/a", "cat": 6, "raw": None, "m": None,
            "flags": ["recorded on Development without a repository file; the repository file is 20260814120000"], "e": "dev"}
rows.append(dev_only)


def action(r):
    env, v, cat, grp = r["e"], r["version"], r["cat"], r["group"]
    if r is dev_only:
        return ("owner decision (N4: leave, add a row for 20260814120000, or rename the file)", "20260814120000 stays pending until the owner chooses; never auto-resolved", "identity discrepancy blocks an exact manifest for 20260814120000", True)
    if r["recorded"]:
        if cat == 1:
            return ("none: already recorded", "stays recorded", "", False)
        return ("investigate: recorded but effects missing; owner decision on whether the effect was intentionally removed", "recorded row stays; no repair without evidence", "recorded-but-missing effect", True)
    if v == U5:
        return ("owner decision U-5 (include / exclude / replace); executes only if included", "pending until decided", "orders.surface NULL for EE-only bookings depends on it (see e1-owner-decisions.md)", True)
    if cat == 6:
        return ("owner decision: identity discrepancy (add alias row, rename file, or keep unreconciled)", "pending until decided; version stays in the exact pending set", "version identity", True)
    if OCT(v):
        return ("execute later (coordinated Step 4 release; rehearsed in D3/D4 on Production-equivalent schema)", "recorded after execution", "deploy-first dependencies (customer-cancel-order, private-bucket consumers)", False)
    if env == "prod" and grp == "other":
        why = "executed OK in D3 and D4" if v in d3 and d3[v]["status"] == "applied" else "not part of the D3 set"
        extra = "net-zero chain: execute with its partner or not at all" if r["verdict"] == "PENDING_CHAIN" else ("partially present: re-applies idempotently" if cat == 3 else "")
        return (f"execute later (Production lacks its effects; {why}) {extra}".strip(), "recorded after execution", "ordering: older than Production's latest recorded version" if v < "20260928172217" else "", False)
    if cat in (2, 5):
        sup = supers(env, v) if cat == 5 else []
        dep = ""
        if sup:
            pend_sup = [s for s in sup if not (s in hist[env]) and status_of.get((env, s), 0) in (4, 3, 7)]
            dep = ("superseding migration(s) not yet recorded/proven here: " + ",".join(pend_sup)) if pend_sup else "superseding migration(s) recorded or catalog-proven: " + ",".join(sup)
        return ("bookkeeping candidate (history row only; SQL must not run) after re-verification inside the freshness window", "recorded by bookkeeping (simulated in D3 as reconciliation rows)", dep, False)
    if cat == 3:
        return ("owner decision: partially present effects (restoring vs accepting the difference)", "pending until decided", "missing: " + (r["raw"]["missing_items"][0] if r["raw"] and r["raw"]["missing_items"] else ""), True)
    if cat == 4 and env == "dev":
        return ("owner decision: effects absent on Development (parity items); execution only if the owner wants them", "pending until decided", "absent: " + (r["raw"]["missing_items"][0] if r["raw"] and r["raw"]["missing_items"] else "see classification"), True)
    if cat == 4:
        return ("execute later (effects absent)", "recorded after execution", "", False)
    return ("investigate: evidence required before any bookkeeping", "pending until proven", "no per-version proof yet", True)


def evid(r):
    if r is dev_only:
        return "stage-b-20261016/dev_catalog_history.json"
    e, v = r["e"], r["version"]
    refs = [f"stage-b-20261016/{e}_catalog_*.json (catalog fingerprint {fp[e][:12]})", f"classification_raw.json[{e}][{v}]", "audit/evidence/version-matrix-all-387.csv"]
    if r["recorded"]:
        refs.append("audit/evidence/" + ("prod-history-277.csv" if e == "prod" else "dev-history-58.csv"))
    else:
        refs.append("audit/evidence/" + ("prod-pending-110.csv" if e == "prod" else "dev-pending-330.csv"))
    if e == "prod" and v in d3:
        refs.append("d3-execution-report.json; d4-data-change-coverage.csv")
    return "; ".join(refs)


out = []
for r in rows:
    act, final, risk, blocker = action(r)
    flags = "; ".join(r["flags"])
    risk_all = "; ".join(x for x in (risk, flags) if x)
    out.append([r["env"], r["version"], r["file"], "recorded" if r["recorded"] else "not recorded", r["verdict"], CAT[r["cat"]], evid(r), act, risk_all, final, "BLOCKER" if blocker else ""])
    # evidence gap register
    if r["recorded"] and r["cat"] == 1 and not any("name level" in f or "not catalog-verifiable" in f for f in r["flags"]):
        continue
    if r["cat"] in (3, 6, 7) or (r["cat"] == 5 and "not yet recorded/proven" in risk) or (r["recorded"] and r["flags"]):
        if r["cat"] == 7 and r["raw"] and r["raw"]["unverified_items"]:
            need = "definition-level comparison (function body hash, policy expression, constraint definition) for: " + "; ".join(r["raw"]["unverified_items"][:3])
            how = "read-only diff of the captured definitions against the file's definitions (no new hosted query needed)"
        elif r["cat"] == 7 and r["raw"] is not None and r["verdict"] == "NO_CATALOG_EFFECT":
            need = f"non-catalog evidence for data/privilege/dynamic effects ({r['m']['data_stmts']}, grants {r['m']['grant_revoke_stmts']}, dynamic {r['m']['dynamic_sql']}): per-statement read-only checks or owner attestation"
            how = "read-only aggregate queries (row counts, privilege queries) or recorded attestation; never copy rows"
        elif r["cat"] == 7 and r["flags"]:
            need = r["flags"][0]
            how = "per-statement verification of the data effect (read-only aggregates) or owner attestation"
        elif r["cat"] == 3 and r["raw"] is not None:
            need = "decision/evidence on missing objects: " + "; ".join((r["raw"]["missing_items"] or ["see classification"])[:3])
            how = "owner confirmation that each missing object was intentionally removed (e.g. containment) or must be restored; no restoration is assumed"
        elif r["cat"] == 5:
            need = "confirm the superseding migration(s) are recorded or proven before bookkeeping: " + risk
            how = "order the manifest so superseding versions are reconciled first"
        elif r["cat"] == 6:
            need = "owner decision on version identity and, for cases 41/42, a comparison of the recorded SQL with the file's SQL"
            how = "recorded statements exist in the capture; run an exact diff (read-only, local)"
        else:
            need = "; ".join(r["flags"]) or "see classification"
            how = "read-only"
        gaps.append([f"GAP-{r['e']}-{r['version']}", r["env"], r["version"], CAT[r["cat"]], need, how, ("bookkeeping" if not r["recorded"] else ("history integrity (decision)" if r["cat"] != 1 else "informational (already recorded; verification note only)"))])

# global gaps
G = [("GAP-GLOBAL-1", "Both", "(all)", "freshness", "Every verdict is tied to the 2026-10-16 18:54-18:55 UTC captures; any hosted action needs a re-capture within the 24 hour window and re-verification of every bookkeeping candidate", "read-only re-capture with the approved G1 method", "bookkeeping and execution"),
     ("GAP-GLOBAL-2", "Both", "(all)", "per-version proof identifiers", "Stage B produced per-version verdicts and event lists (classification_raw.json) but no signed per-version proof table; E1 references them by artifact path, not by new IDs", "owner sign-off on the manifest at Stage E", "bookkeeping"),
     ("GAP-GLOBAL-3", "Production", "(all)", "data preconditions", "Schema-only evidence says nothing about Production rows; the 24-check read-only preflight (e1-production-preflight-queries.sql) has been written but NOT executed", "run the preflight in the release window", "execution"),
     ("GAP-GLOBAL-4", "Both", "(all)", "runtime behaviour", "Function-level payment, refund, booking and staff-save behaviour is unverified (D4 unverified row)", "see e1-financial-rpc-test-plan.md", "release confidence")]
gaps = [list(g) for g in G] + gaps
with open(os.path.join(EV, "e1-reconciliation-readiness.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["environment", "version", "filename", "recorded_history_status", "schema_effect_verdict", "e1_category", "evidence_references", "proposed_action", "risk_or_dependency", "expected_final_pending_state_treatment", "blocker"])
    w.writerows(out)
    for e, label in (("prod", "Production"), ("dev", "Development")):
        w.writerow([label, "20260407211122", "(withdrawn; not in the repository)", "not recorded", "ABSENT", "excluded", "audit/evidence/case-43-impact-analysis.md; withdrawn-migrations/", "excluded: must never be marked applied", "none", "no row; file withdrawn", ""])
with open(os.path.join(EV, "e1-evidence-gap-register.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["gap_id", "environment", "version", "category", "gap", "evidence_required_and_how_to_obtain", "blocks"])
    w.writerows(gaps)

# summaries
summ = {}
for env, label in (("prod", "Production"), ("dev", "Development")):
    c = collections.Counter()
    pend = collections.Counter()
    for r in rows:
        if r["e"] != env:
            continue
        c[CAT[r["cat"]]] += 1
        if not r["recorded"]:
            pend[CAT[r["cat"]]] += 1
    summ[label] = {"all_rows": dict(c), "pending_only": dict(pend), "blockers": sum(1 for o in out if o[0] == label and o[-1] == "BLOCKER"),
                   "actions": dict(collections.Counter(re.sub(r" \(.*", "", o[7]) for o in out if o[0] == label))}
# group x category for pending sets
for env, label in (("prod", "Production"), ("dev", "Development")):
    g = collections.Counter()
    for r in rows:
        if r["e"] == env and not r["recorded"]:
            g[(r["group"], CAT[r["cat"]])] += 1
    summ[label]["pending_group_by_category"] = {f"{k[0]} | {k[1]}": n for k, n in sorted(g.items())}
json.dump(summ, open(os.path.join(OUT, "e1-summary.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps(summ, indent=1))
print("readiness rows:", len(out) + 2, "| gap rows:", len(gaps))
