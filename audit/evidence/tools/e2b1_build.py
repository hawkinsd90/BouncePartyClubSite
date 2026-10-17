"""Stage E2B-1: build the crosswalk, the execution-dependency CSV and the count reconciliation from existing evidence plus the local rehearsal results.
READ-ONLY (CSV/JSON inputs only). Usage: python -I e2b1_build.py"""
import collections
import csv
import json
import os
import sys

EV = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite\audit\evidence"
SC = r"C:\Users\vikki\migration-evidence\e2b1-scratch"
man = json.load(open(os.path.join(EV, "d3-selected-manifest.json"), encoding="utf-8"))["upgrade"]
SET = [r["version"] for r in man]
mf = {r["version"]: r for r in man}
d3 = {r["version"]: r for r in json.load(open(os.path.join(EV, "d3-execution-report.json"), encoding="utf-8"))["results"]}
e2a = {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "e2a-proposed-actions.csv"), encoding="utf-8")) if r["environment"] == "Production"}
e1 = {r["version"]: r for r in csv.DictReader(open(os.path.join(EV, "e1-reconciliation-readiness.csv"), encoding="utf-8")) if r["environment"] == "Production"}
d4 = collections.defaultdict(list)
for r in csv.DictReader(open(os.path.join(EV, "d4-data-change-coverage.csv"), encoding="utf-8")):
    d4[r["version"]].append(r)
an = json.load(open(os.path.join(SC, "e2b1-analysis.json"), encoding="utf-8"))
facts, edges = an["facts"], an["edges"]
seq = json.load(open(os.path.join(SC, "e2b1-sequences.json"), encoding="utf-8")) if os.path.exists(os.path.join(SC, "e2b1-sequences.json")) else None
NETZERO = {"20260715221828", "20260716104333"}
NOOP_OCT = {"20261010110000"}
FULLY = {"20260716151530", "20260716152823", "20260716173638" if False else "20260716173644", "20260717111737", "20260717113131", "20260814114825"}
U5 = "20260722172048"


def omit_result(v):
    """individually omitted result from the local rehearsal (only for the six fully-replaced candidates)"""
    if not seq:
        return None
    k = "only_" + v[-6:]
    c = seq["comparison"].get(k)
    r = seq["results"].get(k)
    if not r:
        return None
    if r["failed"]:
        return f"omission FAILS at {r['failed'][0][0]}: {str(r['failed'][0][1])[:90]}"
    if c is None:
        return "not compared"
    cat, dat = c["differing_categories"], c["data_differences"]
    return "final catalog identical to the full 67-version result" + ("" if not dat else f"; data differs in {sorted(dat)}") if not cat else f"final catalog differs: {cat}"


rows, deps = [], []
for v in SET:
    a, f, r3 = e2a[v], facts[v], d3[v]
    grp = "October" if v >= "20261007000000" else "Development-line"
    st = f["statuses"]
    evid = f"present {st.get('PRESENT', 0)}, superseded {st.get('SUPERSEDED', 0)}, no-op {st.get('NOOP', 0)}, absent {st.get('ABSENT', 0)}, unmatched {st.get('UNMATCHED', 0)}, unprovable {st.get('UNPROVABLE', 0)}"
    absent = f["absent"]
    data = f["data"]
    req = sorted({e[1] for e in edges if e[0] == v and e[2].startswith(("requires", "touches-"))})
    reqby = sorted({e[0] for e in edges if e[1] == v and e[2].startswith(("requires", "touches-"))})
    replaced = sorted({e[1] for e in edges if e[0] == v and e[2] == "intermediate-effect-replaced-by"})
    d4s = sorted({r["outcome"] for r in d4.get(v, [])})
    om = omit_result(v)
    if v == U5:
        action, necessary, cons, conf = "owner decision", "yes, if Event-Essentials-only bookings must work (booking code sends NULL surface)", "Production keeps orders.surface NOT NULL and the old CHECK; EE-only bookings are rejected (local test: NOT NULL violation); other 66 migrations still apply", "high (code and local test)"
    elif v in NETZERO:
        action, necessary = "history-only reconciliation (schema-equivalent) or execute; either is harmless", "no (create-then-drop pair: Production already holds the end state)"
        cons = "omitting both leaves the final catalog unchanged" + (f"; rehearsal: {seq['comparison']['s1']['differing_categories'] or 'identical catalog'}" if seq and 's1' in seq['comparison'] else "")
        conf = "high"
    elif v in NOOP_OCT:
        action, necessary = "history-only reconciliation (no-op: the column already exists in Production)", "no (orders.customer_approved_at exists; created by recorded 20251126190624)"
        cons, conf = "omitting it changes nothing in the schema; its version must still be recorded", "high"
    elif v in FULLY:
        action, necessary = "execute (baseline); omission candidate only after owner approval", "no for the final catalog (every effect is replaced by a later selected version), yes as an ordering/data-neutral step until tested" if not om else f"catalog-necessary: no ({om})"
        cons = f"effects are intermediate; replaced by {', '.join(replaced) or 'later versions'}; the SQL is dependency-safe to omit only if the rehearsal below says so: {om or 'not tested'}"
        conf = "medium"
    elif absent or data:
        action = "execute"
        necessary = "yes: owns effects absent from Production" + (" and data statements" if data else "")
        cons = "missing in the final schema: " + "; ".join(absent[:3]) + (f" (+{len(absent) - 3} more)" if len(absent) > 3 else "") if absent else "seed/data/grant effects would be missing: " + "; ".join(data[:2])
        conf = "high" if absent and not data else "medium (data effect cannot be proven from a schema snapshot)"
    else:
        action, necessary, cons, conf = "investigate", "unknown", "unknown", "low"
    exec_note = "SQL execution needed" if action.startswith(("execute", "owner")) else "version record only"
    rows.append([v, mf[v]["file"], grp, f"{r3['status']} (executed in D3: yes); Stage B class {mf[v]['stage_b_prod_class']}", a["e2a_class"], a["basis"][:150], evid, "yes: " + "; ".join(absent[:3]) if absent else "no", "; ".join(data[:3]) if data else "none",
                 ", ".join(req) or "none", ", ".join(reqby) or "none", ", ".join(replaced) or "none", necessary, cons, action, exec_note, conf,
                 f"e2a-proposed-actions.csv; e1-reconciliation-readiness.csv (E1 {e1[v]['e1_category'][:1]}); d3-execution-report.json; d4-data-change-coverage.csv ({'/'.join(d4s) or 'no data statements'}); Stage B Production capture (fingerprint c180056c)"])
H = ["version", "filename", "group", "d3_result", "e2a_class", "e2a_reason", "production_evidence_counts", "effect_absent_from_production", "data_dependent_or_unprovable", "depends_on_selected_versions", "depended_on_by_selected_versions",
     "intermediate_effects_replaced_by", "necessary_for_release_schema", "consequence_of_omission", "proposed_action", "execution_vs_record", "confidence", "evidence_references"]
with open(os.path.join(EV, "e2b1-production-execution-crosswalk.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(H)
    w.writerows(rows)
with open(os.path.join(EV, "e2b1-execution-dependencies.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["version", "related_version", "edge_kind", "objects", "object_list", "reading"])
    reading = {"intermediate-effect-replaced-by": "this version's effect is replaced by the related later version (do not omit merely because it is replaced; test the shortened sequence)",
               "requires-table-created-by": "must run after the related version, which creates a table it uses",
               "requires-function-created-by": "must run after the related version, which creates a function it uses",
               "touches-table-created-LATER-by": "runs BEFORE the version that creates the table (ordering defect; effect is a guarded no-op in Production)",
               "touches-function-created-LATER-by": "touches a function that exists in Production and is re-created later (REVOKE/GRANT on an existing function)"}
    for e in sorted(edges):
        w.writerow(e[:5] + [reading.get(e[2], "")])
c = collections.Counter(r[14].split(" (")[0].split(";")[0] for r in rows)
print("proposed actions:", dict(c))
print("e2a class x action:", collections.Counter((r[4], r[14].split(" (")[0].split(";")[0]) for r in rows))
print("rows:", len(rows), "edges:", len(edges))
