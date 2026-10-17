"""Stage E2B-2: offline cross-check of the E2B-1 crosswalk against earlier evidence, and generation of e2b2-reconciliation-blockers.csv.
Reads repository evidence files only. No hosted system, no database. Usage: python -I e2b2_build.py"""
import csv
import json
import os
import sys

EV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def rd(name):
    with open(os.path.join(EV, name), encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


cw = rd("e2b1-production-execution-crosswalk.csv")
man = json.load(open(os.path.join(EV, "d3-selected-manifest.json"), encoding="utf-8"))
pa = {r["version"]: r for r in rd("e2a-proposed-actions.csv")}
ready = {r["version"]: r for r in rd("e1-reconciliation-readiness.csv")}
vs = [r["version"] for r in cw]
assert len(vs) == 67 and len(set(vs)) == 67, "crosswalk must hold 67 unique versions"
assert vs == sorted(vs), "crosswalk must be in version order"
assert all(v in pa and v in ready for v in vs), "every crosswalk version must exist in the E2A and E1 files"
assert man["counts"]["upgrade_sql"] == 67 and man["counts"]["technically_pending"] == 109
kinds = {}
for r in cw:
    a = r["proposed_action"]
    k = "history-only" if a.startswith("history-only") else "owner decision" if a.startswith("owner") else "execute (omission-tested)" if "omission candidate" in a else "execute"
    kinds[k] = kinds.get(k, 0) + 1
print("proposed actions:", kinds)
assert kinds == {"execute": 57, "execute (omission-tested)": 6, "history-only": 3, "owner decision": 1}, kinds
latest = "20260928172217"
older = [v for v in vs if v < latest]
assert len(older) == 39
print("older than", latest, ":", len(older))

COLS = ["id", "scope", "blocker", "affected_versions", "evidence_gap", "minimum_resolution", "decision_ref", "blocks", "status"]
B = [
    ("B-01", "Production", "Owner approval of the execution-set basis", "all 67 (D3/D4 baseline)", "none: the crosswalk is complete", "Owner chooses A (67), B (64) or C (58); only A is the rehearsed baseline", "D-1", "manifest", "OPEN: owner decision"),
    ("B-02", "Production", "Treatment of the Dev-only designation of the surface migration", "20260722172048", "Header says Dev only; author intent not recorded in the repository", "Owner confirms include (recommended); documentation-only header correction separately authorized", "D-2", "manifest and execution", "OPEN: owner decision"),
    ("B-03", "Production", "Case 41 cannot be reconciled by execution", "20260305203528", "Backfill differs from recorded 20260305205811 (13-order local test); Development provenance of the two columns unknown", "Owner chooses withdraw or annotated record; optional read-only count of NULL customer_selected_payment_cents on Production", "D-3", "bookkeeping", "OPEN: owner decision"),
    ("B-04", "Production", "Case 42 duplicate", "20260407203226", "COMMENT ON COLUMN text of recorded row not captured (digest equality only)", "Owner chooses annotated record or withdraw; optional read of recorded statements text (see e2a-unresolved-evidence.md D)", "D-4", "bookkeeping", "OPEN: owner decision"),
    ("B-05", "Development", "Version alias", "20260814002658 (recorded) / 20260814120000 (file)", "None for content (digest-identical); identity is a choice", "Owner chooses rename, alias record or leave", "D-5", "Development manifest", "OPEN: owner decision"),
    ("B-06", "Both", "How non-executed versions are recorded", "20260715221828, 20260716104333, 20261010110000 (and any approved omissions)", "No agreed marker for a history-only row; the statements column must not imply execution", "Owner approves marker convention and wording", "D-6", "bookkeeping", "OPEN: owner decision"),
    ("B-07", "Both", "Timing and scope of bookkeeping", "all", "Evidence valid only inside the 24 h freshness window of a fresh read-only capture", "Owner fixes release window and whether Development is reconciled before or after Production", "D-7", "bookkeeping", "OPEN: owner decision"),
    ("B-08", "Production", "Baseline versions with unprovable data statements", "15 versions: 20251001051901, 20251001052039, 20251001192425, 20251002180149, 20251002210020, 20251003152224, 20251003170350, 20251003182356, 20251003183947, 20251007210840, 20251007220415, 20251007221227, 20251007221817, 20251008144308, 20251008153245 (25 statements)", "Schema capture cannot show seed, backfill or DELETE effects", "Run the per-statement read-only queries (e2a-prod-baseline-proof.csv, readonly_queries_needed), or the owner signs a qualified attestation; never claim executed", "see D-6", "baseline bookkeeping", "OPEN: evidence or attestation"),
    ("B-09", "Production", "Baseline version with absent constraints", "20251001051900", "Inline user_roles FK and CHECK absent in Production; later versions supersede or drift explains", "Accept as out-of-band drift (see e2a-recorded-exceptions.md item 1) or capture the DDL audit trail", "D-6", "baseline bookkeeping", "OPEN: owner acceptance"),
    ("B-10", "Production", "Unmatched definitions inside the baseline chain", "20251202171808, 20251215015109, 20251231161729, 20260311111714, 20260314213726, 20260317201616", "Object exists but definition differs from every chain definition (drift or heuristic limit)", "Read-only definition queries in e2a-unresolved-evidence.md section A", "D-6", "bookkeeping", "OPEN: evidence"),
    ("B-11", "Production", "Data statements inside the 67 whose real-row effect is unknown", "16 versions with data or dynamic statements (see crosswalk column data_dependent_or_unprovable)", "Schema-only snapshot has no rows; D4 covered 57 proven, 12 partial, 1 unverified", "Run the 24 read-only preflight checks (e1-production-preflight-queries.sql) inside the freshness window before execution", "D-1", "execution", "OPEN: evidence (not yet run)"),
    ("B-12", "Production", "39 of the 67 versions are older than Production's latest recorded version", "39 versions up to 20260925171210", "Supabase CLI refuses older pending versions without --include-all, which is forbidden; no approved hosted application path exists", "Step 4 design of a per-version application method that preserves file versions; not tested", "D-7", "execution", "OPEN: design"),
    ("B-13", "Production", "Out-of-band drift missing from Production", "20251207163822 (role CHECK)", "Who removed it and when is not in any catalog", "Optional: Production DDL audit trail; otherwise accept as documented drift", "D-6", "none (informational)", "OPEN: optional evidence"),
    ("B-14", "Development", "Development baseline and pre-October versions not proven", "306 pre-October files: 209 H, 89 P, 5 X, 3 I; 26 have absent or unmatched effects; 73 have 95 unprovable statements", "See e2a-dev-proof.csv; storage policies removed by containment, update_pricing_rules, pg_net trigger and the custom_email_hook grants are absent on Development", "Do not restore removed policies by default; run Development read-only queries or attest; decide scope", "D-7", "Development manifest", "OPEN: owner decision and evidence"),
    ("B-15", "Development", "Development scope and the October migrations", "23 October versions", "Edge Functions are stubs; October migrations must not run on hosted Development while stubs and containment stand", "Keep containment; decide Development parity after the Production path is approved", "D-7", "Development execution", "OPEN: owner decision"),
    ("B-16", "Both", "Security prerequisites outside Step 2", "n/a", "supabase_admin default privileges (F-2), SEC-A master-account rotation, temporary cli_login_postgres role, deploy-first order for customer-cancel-order", "Step 3 and Step 4 items; owner action", "D-7", "release", "OPEN: outside Step 2"),
    ("B-17", "Both", "Case 43 stays withdrawn", "case 43", "None", "Never mark applied", "none", "none", "CLOSED: withdrawn"),
]
with open(os.path.join(EV, "e2b2-reconciliation-blockers.csv"), "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(COLS)
    w.writerows(B)
print("blockers written:", len(B))
sys.exit(0)
