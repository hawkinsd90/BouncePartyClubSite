"""Stage E2H: assembles audit/evidence/e2h-failure-test-results.json from the protected scratch results (E2H tests, E2G regression run on the E2H executor, security-state experiments, dependency audit).
Offline: reads files only. Usage: python -I e2h_build_results.py"""
import csv
import json
import os
import collections

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
EV = os.path.join(REPO, "audit", "evidence")
H = json.load(open(r"C:\Users\vikki\migration-evidence\e2h-scratch\results.json", encoding="utf-8"))
G = json.load(open(r"C:\Users\vikki\migration-evidence\e2h-scratch\e2g-regression-results.json", encoding="utf-8"))
dep = list(csv.DictReader(open(os.path.join(EV, "e2h-dependency-audit.csv"), encoding="utf-8", newline="")))
tests = list(H["tests"].values())
sec = collections.Counter(t["id"].split("-")[1][0] for t in tests)
out = {
    "stage": "E2H",
    "scope": "local disposable PostgreSQL only (127.0.0.1:54329, bpc_exec_*), synthetic data, no hosted system; the local executor was driven as a separate process",
    "summary": {"e2h_tests": len(tests), "passed": sum(1 for t in tests if t["result"] == "PASS"), "failed": [t["id"] for t in tests if t["result"] != "PASS"], "by_series": dict(sec),
                "e2g_regression_on_the_e2h_executor": G["summary"]},
    "dependency_audit": {"rows": len(dep), "by_certainty": dict(collections.Counter(r["certainty"] for r in dep)), "files_with_dynamic_sql_uncertain": [r["version"] for r in dep if r["certainty"] == "uncertain"]},
    "leave_one_out": H["extra"].get("leave_one_out"),
    "security_states": H["extra"].get("states"),
    "anonymous_probe": H["extra"].get("probe_summary"),
    "reference_sets": H["extra"].get("reference_sets"),
    "containment_experiments": H["extra"].get("containment"),
    "containment_probe": H["extra"].get("containment_probe"),
    "not_run_or_limited": [
        "a real hardware or operating-system crash / power loss (a PostgreSQL immediate shutdown was used instead; fsync behavior is not tested)",
        "concurrent application traffic against the database during a run",
        "network failure between executor and database (loopback only; server-side backend termination and process kill were used)",
        "hosted Supabase platform behavior (TLS, pooler, platform-owned schemas, hosted role privileges)",
        "the Development executor (does not exist; the Production-58 executor refuses Development inputs)",
    ],
    "tests": tests,
}
json.dump(out, open(os.path.join(EV, "e2h-failure-test-results.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps(out["summary"]))
