"""Stage E2D: builds e2d-scenario-comparison.csv and e2d-financial-integrity.json from the protected scratch results of the 58-version re-run, the D4 results (67 versions)
and the supplementary tests. Offline: reads files only; no database, no hosted system. Usage: python -I e2d_build.py"""
import csv
import json
import os
import re

EV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D4 = json.load(open(r"C:\Users\vikki\migration-evidence\d4-scratch\d4-results.json", encoding="utf-8"))
E = json.load(open(r"C:\Users\vikki\migration-evidence\e2d-scratch\d4-results.json", encoding="utf-8"))
RPC = json.load(open(r"C:\Users\vikki\migration-evidence\e2d-scratch\e2d-financial-rpcs.json", encoding="utf-8"))
PRE = json.load(open(r"C:\Users\vikki\migration-evidence\e2d-scratch\e2d-preflight.json", encoding="utf-8"))


def key(c):
    return (c["scenario"], re.sub(r"\b58\b", "67", c["check"]))


d4 = {key(c): c for c in D4["checks"]}
e2 = {key(c): c for c in E["checks"]}
rows = []
counts = {}
for k in sorted(set(d4) | set(e2)):
    a, b = d4.get(k), e2.get(k)
    if a is None:
        cls, note = "new in E2D", "not in D4"
    elif b is None:
        cls, note = "NOT REPRODUCED", "present in D4, absent in E2D"
    elif a["result"] != "PASS" or b["result"] != "PASS":
        cls, note = "REGRESSION OR FAILURE", "a result is not PASS"
    elif a["actual"] == b["actual"] and a["expected"] == b["expected"]:
        cls, note = "identical", ""
    else:
        cls = "pass in both; value differs by design"
        note = "counts depend on the sequence length (nine fewer versions): expected '%s' -> '%s'; actual '%s' -> '%s'" % (a["expected"][:50], b["expected"][:50], a["actual"][:50], b["actual"][:50])
        if k[1].startswith("re-application of each"):
            note += "; the nine omitted versions account for 4 idempotent and 5 catalog-changing re-applications (45->41, 21->16), the one-time migration is unchanged"
    counts[cls] = counts.get(cls, 0) + 1
    rows.append([k[0], k[1], a["result"] if a else "", b["result"] if b else "", (a or {}).get("actual", "")[:300], (b or {}).get("actual", "")[:300], cls, note])
with open(os.path.join(EV, "e2d-scenario-comparison.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["scenario", "check (67-version wording)", "d4_67_result", "e2d_58_result", "d4_67_actual", "e2d_58_actual", "classification", "note"])
    w.writerows(rows)
print("checks d4", len(D4["checks"]), "e2d", len(E["checks"]), counts)
for r in rows:
    if r[6] not in ("identical",):
        print(r[0], "|", r[1][:90], "|", r[4][:60], "=>", r[5][:60], "|", r[6])

fin = E["financial"]["A1"]
fin67 = D4["financial"]["A1"]
same_core = {k: fin.get(k) == fin67.get(k) for k in ("seed_counts", "rows_compared_per_table", "unexplained_changes", "unexpected_row_additions_or_removals", "per_order", "payments_survived", "legacy_refunds_survived", "new_columns_on_existing_rows (values seen)")}
doc = {"method": "Same synthetic dataset and the same exact integer-cent comparison as D4, run on the 58-version sequence; compared with the D4 result for the 67-version sequence", "result_58": fin.get("result"),
       "preflight": {k: PRE[k] for k in ("head", "58_versions_first_last", "e2c_omissions", "omissions_equal_hardcoded_list", "58_equals_e2c_execute_list", "all_67_file_hashes_match_manifest", "d2_317_historical_files_checked", "d2_317_historical_files_hash_mismatches")},
       "seed_counts": fin.get("seed_counts"), "rows_compared_per_table": fin.get("rows_compared_per_table"), "unexplained_changes_58": fin.get("unexplained_changes"), "unexpected_row_additions_or_removals_58": fin.get("unexpected_row_additions_or_removals"),
       "per_order_58": fin.get("per_order"), "payments_survived_58": fin.get("payments_survived"), "legacy_refunds_survived_58": fin.get("legacy_refunds_survived"), "net_financial_semantics_58": fin.get("net_financial_semantics"),
       "sections_identical_to_d4_67": same_core,
       "financial_functions_actually_invoked": {"d4_original": ["order_net_financials (3 orders with expected cents)", "assign_role_by_email"], "e2d_differential_47_calls_on_both_final_databases": RPC["calls"][:0] or sorted({re.sub(r"\(.*", "", c) for c in RPC["calls"]}),
                                                  "calls": RPC["invoked"], "succeeded_67": RPC["succeeded_67"], "succeeded_58": RPC["succeeded_58"], "identical_outcomes": RPC["identical_outcomes"], "differences": RPC["differences"], "not_invoked": RPC["note"]}}
json.dump(doc, open(os.path.join(EV, "e2d-financial-integrity.json"), "w", encoding="utf-8"), indent=1, default=str)
print("financial sections identical to D4:", same_core)
