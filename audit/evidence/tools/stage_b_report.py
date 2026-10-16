"""Stage B: per-version classification reports (277 Prod history / 110 Prod-pending / 330 Dev-pending) + summary.

Reads audit/evidence/version-matrix-all-387.csv, classification_raw.json (protected folder) and the repo. Writes CSVs and summary.json
to audit/evidence/. Verdicts, object names and versions only.
"""
import collections
import csv
import json
import os

EVID_REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite\audit\evidence"
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
CASE43 = "20260407211122"
TWINS = {"20260305203528": "recorded on Prod as 20260305205811 add_customer_selected_payment_tracking (different SQL)",
         "20260407203226": "recorded on Prod as 20260408200431 add_refund_requested_to_orders (different SQL)",
         CASE43: "case 43: effect absent on both databases; see case-43-impact-analysis.md"}
NOTES = {
    "20251207163822": "Role CHECK recorded as applied but absent on Prod and Dev (out-of-band removal, drift D2). Do not edit the file; replay shim S1 (Stage C).",
    "20260324175546": "Recovered file (hash-pinned). Clean-replay failure #1 (role CHECK).",
    "20260324190039": "Clean-replay failure #2 (role CHECK).",
    "20260615175816": "Clean-replay failure #4 (orders already published); recorded SQL identical to file.",
    "20260316162524": "Recorded SQL differs from the file in COMMENTS ONLY (file header edited after application).",
    "20260814113146": "Dev recorded the ORIGINAL SQL; the repo file was edited after application (commit 84cdc3e: ordering guard).",
    "20260814114825": "Dev recorded the ORIGINAL SQL; the repo file was edited after application (commit 84cdc3e: ordering guard).",
    "20260814120000": "Dev recorded this migration as 20260814002658 (version differs from the file).",
    "20260611184401": "update_pricing_rules: Prod only; no consumer found (audit section T).",
    "20260323201502": "Needs pg_net: extension absent on Dev.",
    "20251229223230": "Contains the auth.users signup trigger: absent on Dev.",
    "20260324051459": "Realtime publication: Dev lacks 4 of these tables (portal does not use table Realtime).",
    "20260324154955": "Realtime publication: order_pictures absent on Dev.",
    "20260718000744": "Two public-read policies exist on Dev under DIFFERENT names than the file creates (out-of-band rename).",
    "20260723174017": "Dev lacks 'Public can view lot pictures' (storage containment by the media workstream after application).",
    "20261016120000": "Role-CHECK ordering defect: data normalisation precedes CHECK replacement (Stage C correction).",
    "20260928172217": "Parks acknowledgment: columns exist on Dev through the refresh thread's direct change (no history row on Dev).",
}


def load_matrix():
    return list(csv.DictReader(open(os.path.join(EVID_REPO, "version-matrix-all-387.csv"), encoding="utf-8")))


def group_of(r, env):
    v = r["version"]
    if r["is_october"] == "1":
        return "october"
    if r["is_baseline"] == "1":
        return "baseline"
    if v in TWINS:
        return "alias-or-case43"
    if r["in_prod_history"] == "1" and env == "prod":
        return "prod-recorded"
    if env == "dev" and r["in_prod_history"] == "1":
        return "prod-recorded"
    return "dev-line"


def klass(env, r, g, raw):
    v, verdict = r["version"], r[f"{env}_verdict"]
    recorded = r[f"in_{env}_history"] == "1"
    if recorded:
        if verdict in ("PRESENT", "SUPERSEDED", "PRESENT_NAME_LEVEL"):
            return "RECORDED_CONSISTENT"
        if verdict == "NO_CATALOG_EFFECT":
            return "RECORDED_NO_CATALOG_EFFECT"
        return "RECORDED_EFFECT_MISSING"
    if v == CASE43:
        return "PENDING_EFFECT_ABSENT_WITHDRAWAL_CANDIDATE"
    if g == "october":
        return "PENDING_EXPECTED" if verdict in ("ABSENT", "PARTIAL") else ("PENDING_NO_NEW_EFFECT_ALREADY_PRESENT" if verdict == "PRESENT" else "PENDING_DATA_OR_PRIVILEGE_ONLY")
    if env == "prod" and g == "dev-line":
        # Dev-line files were written after Prod's last tracked state: never applied on Prod, whatever the catalog says
        if verdict == "NO_CATALOG_EFFECT":
            return "PENDING_DATA_OR_PRIVILEGE_ONLY"
        if verdict == "PRESENT_NAME_LEVEL":
            return "PENDING_REDEFINITION_DEFINITION_UNVERIFIED"
        if verdict in ("PRESENT", "SUPERSEDED"):
            return "PENDING_NO_NEW_EFFECT_ALREADY_PRESENT"
        if verdict == "PENDING_CHAIN":
            return "PENDING_NET_ZERO_CHAIN"
        return "GENUINELY_PENDING_EXPECTED"
    if verdict in ("PRESENT", "SUPERSEDED"):
        return "HISTORY_ONLY_EFFECTS_PRESENT"
    if verdict == "PRESENT_NAME_LEVEL":
        return "HISTORY_ONLY_NAME_LEVEL_DEFINITION_UNVERIFIED"
    if verdict == "NO_CATALOG_EFFECT":
        return "HISTORY_ONLY_NOT_CATALOG_VERIFIABLE"
    if verdict == "PENDING_CHAIN":
        return "PENDING_NET_ZERO_CHAIN"
    return "UNEXPECTED_MISSING_EFFECT"


RESOLUTION = {
    "RECORDED_CONSISTENT": "None. Recorded and consistent with the catalog.",
    "RECORDED_NO_CATALOG_EFFECT": "None. Effect is data/privilege-only and not catalog-verifiable; covered by grants posture (H.1) and owner attestation.",
    "RECORDED_EFFECT_MISSING": "Out-of-band drift. Register it; handle with a replay-tool shim in Stage C; never edit the applied file.",
    "PENDING_EFFECT_ABSENT_WITHDRAWAL_CANDIDATE": "Do NOT mark applied. Withdrawal-before-application candidate; see case-43-impact-analysis.md (no removal without review).",
    "PENDING_EXPECTED": "Genuinely pending. Execute only through the rehearsed, authorised release path (Step 4). Never bookkeeping.",
    "PENDING_NO_NEW_EFFECT_ALREADY_PRESENT": "Idempotent: its effect already exists. Still pending by version; runs as a no-op in the release path.",
    "PENDING_DATA_OR_PRIVILEGE_ONLY": "Pending; grants/privilege-only. Execute in the release path; verify by privilege queries.",
    "HISTORY_ONLY_EFFECTS_PRESENT": "History-only discrepancy. Candidate for history bookkeeping (Stage E/F) after per-file proof. Never execute the file.",
    "HISTORY_ONLY_NOT_CATALOG_VERIFIABLE": "History-only if the owner accepts non-catalog evidence; data statements must never be replayed. Needs per-file decision.",
    "PENDING_REDEFINITION_DEFINITION_UNVERIFIED": "Pending. The file drops and re-creates an existing name with a new definition (name present, definition NOT verified). Execute through the release path; confirm definitions in the Stage D catalog diff.",
    "HISTORY_ONLY_NAME_LEVEL_DEFINITION_UNVERIFIED": "History-only discrepancy at NAME level only; the file redefines existing names, so definitions must be confirmed by the Stage D catalog diff before any bookkeeping.",
    "PENDING_NET_ZERO_CHAIN": "Net-zero chain with a later pending version (creates then removes). Execute both in order or neither. Not a bookkeeping candidate.",
    "GENUINELY_PENDING_EXPECTED": "Genuinely pending (Dev-line). Execute through the rehearsed release path. Never bookkeeping.",
    "UNEXPECTED_MISSING_EFFECT": "UNRESOLVED. Effect missing without an explanation in the repo. Blocks bookkeeping for this version until classified (Dev gap vs out-of-band change).",
}


def rows_for(env, which):
    out = []
    raw = json.load(open(os.path.join(PROT, "classification_raw.json"), encoding="utf-8"))[env]
    for r in load_matrix():
        v = r["version"]
        recorded = r[f"in_{env}_history"] == "1"
        if which == "recorded" and not recorded:
            continue
        if which == "pending" and recorded:
            continue
        g = group_of(r, env)
        k = klass(env, r, g, raw)
        rr = raw[v]
        note = []
        if v in NOTES:
            note.append(NOTES[v])
        if v in TWINS:
            note.append(TWINS[v])
        if rr.get("comment_only_functions"):
            note.append("function body differs from the live one only by comments: " + ",".join(rr["comment_only_functions"]))
        if rr["chain_items"]:
            note.append("net-zero chain: " + "; ".join(rr["chain_items"][:2]))
        if rr.get("unverified_items"):
            note.append("same-name redefinition, definition unverified: " + "; ".join(rr["unverified_items"][:3]))
        if v == "20260722172048":
            note.append("FILE HEADER SAYS: 'Dev only - do not apply to production' (unresolved release question U-5)")
        if recorded and r[f"{env}_sql_vs_file"] not in ("", "IDENTICAL"):
            note.append("recorded SQL vs file: " + r[f"{env}_sql_vs_file"])
        out.append({
            "version": v, "file": r["file"], "group": g, "history_name": r[f"{env}_history_name"],
            "recorded_sql_vs_file": r[f"{env}_sql_vs_file"], "catalog_verdict": r[f"{env}_verdict"],
            "events_present": rr["present"], "events_superseded": rr["superseded"] + rr["chain"], "events_missing": rr["missing"],
            "missing_items": "; ".join(rr["missing_items"][:4]) + (" ..." if len(rr["missing_items"]) > 4 else ""),
            "data_stmts(ins/upd/del/trunc)": r["data_stmts"], "grant_revoke_stmts": r["grant_revoke_stmts"], "dynamic_sql": r["dynamic_sql"],
            "class": k, "recommended_resolution": RESOLUTION[k], "notes": " | ".join(note)})
    return out


def write(name, rows):
    with open(os.path.join(EVID_REPO, name), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    prod_rec = rows_for("prod", "recorded")
    prod_pend = rows_for("prod", "pending")
    dev_pend = rows_for("dev", "pending")
    dev_rec = rows_for("dev", "recorded")
    write("prod-history-277.csv", prod_rec)
    write("prod-pending-110.csv", prod_pend)
    write("dev-pending-330.csv", dev_pend)
    write("dev-history-58.csv", dev_rec)
    summ = {}
    for name, rows in (("prod_history", prod_rec), ("prod_pending", prod_pend), ("dev_pending", dev_pend), ("dev_history", dev_rec)):
        summ[name] = {"total": len(rows), "by_class": dict(collections.Counter(r["class"] for r in rows)),
                      "by_group_class": {f"{g}|{k}": c for (g, k), c in sorted(collections.Counter((r["group"], r["class"]) for r in rows).items())}}
    json.dump(summ, open(os.path.join(EVID_REPO, "stage-b-summary.json"), "w", encoding="utf-8"), indent=1)
    for k, v in summ.items():
        print(k, v["total"], v["by_class"])


if __name__ == "__main__":
    main()
