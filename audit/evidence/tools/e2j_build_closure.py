"""Stage E2J: builds e2j-manifest-closure-rules.csv (how read-only results would update the Development manifest). Offline text generation from e2i-development-version-verdicts.csv; no database connection.
Usage: python -I e2j_build_closure.py"""
import csv
import os
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.abspath(os.path.join(HERE, ".."))
v = list(csv.DictReader(open(os.path.join(EV, "e2i-development-version-verdicts.csv"), encoding="utf-8")))
ATT, UNR, XSQL, HIST = "Qualified owner-attestation candidate", "Unresolved", "Actual SQL execution required", "Evidence-backed history-only reconciliation candidate"
VALID = "Q00 valid (session bypasses RLS, read-only default on) AND Q01 confirms the version is still absent from the Development ledger"
EMPTY = "An empty or zero result is NEVER proof that the historical SQL executed: it is accepted only when Q00 shows the table is non-empty (estimated_rows > 0) and RLS cannot be hiding rows; otherwise the item is inconclusive and stays in its current class."

TPL = {
    "seed": dict(
        acceptable="Every key/name/row that the migration inserts is present (names/counts match the migration file).",
        conflicting="Any named key/row absent; or Q00 invalid; or a table unexpectedly empty.",
        ok=ATT + " (evidence complete; awaiting the signed attestation)", bad=UNR + " (owner decision: accept the absence, or approve a NEW reviewed data change; the historical file is never run from the ledger)",
        sql="Only as a new, separately reviewed data statement if the owner wants a missing row; never the original migration.", owner="Yes: signed qualified attestation naming the version and what was observed."),
    "backfill": dict(
        acceptable="The predicate-count query returns 0 rows still matching AND the table is non-empty.",
        conflicting="Count > 0 (backfill never applied to those rows, or data changed since); or table empty (inconclusive).",
        ok=ATT + " (evidence complete; awaiting the signed attestation)", bad=UNR + " (corrective data change to be designed and reviewed separately; the historical UPDATE is not re-run as is)",
        sql="Possible as a new reviewed corrective statement if count > 0.", owner="Yes."),
    "financial": dict(
        acceptable="Coverage/consistency counts show no inconsistent rows AND the owner accepts that the counts are weak evidence (a historical formula cannot be re-proved on live, since-edited orders).",
        conflicting="Any inconsistent row, NULL in the backfilled column, or conflicting owner statement.",
        ok=ATT + " only if the owner signs; otherwise stays " + UNR, bad=UNR + " (corrective SQL to be reviewed per case; never executed from the ledger)",
        sql="Possible only as a new reviewed corrective for the specific inconsistent rows.", owner="Yes, always (financial/identity/payment data)."),
    "unresolved": dict(
        acceptable="Definitions/states match what the version established (see notes) and the owner accepts any documented harmless difference.",
        conflicting="Definition differs materially, or a security-relevant object remains.",
        ok=ATT + " or " + HIST + " as stated in the notes", bad=UNR, sql="Only as stated in the notes.", owner="Yes."),
}
OVR = {
    "20251003170350": dict(ev="Q26 (boolean) + Q00", acceptable="Execution is PROHIBITED whatever the result. Q26 = false: effect absent; Q26 = true: a privileged demo login exists (owner security review, independent of the ledger).", conflicting="Any proposal to execute the file.", ok=UNR + " (execution prohibited; ledger treatment decided by the owner: leave unrecorded or sign an 'obsolete, never to be applied' attestation)", bad="Prohibited", sql="Never.", owner="Yes (security review and ledger decision).", note="Creates an admin login in auth.users; the committed demo password is a separate Step 3/G5b item."),
    "20260323175236": dict(ev="Q18 + Q00", acceptable="Q18 = 0 secret-like changelog rows not redacted (state is safe).", conflicting="Q18 > 0: secrets readable in the changelog.", ok=ATT + " (security state verified safe; still data, so attestation)", bad="Security remediation first (urgent owner review); corrective redaction reviewed separately", sql="Possible: a reviewed redaction statement if Q18 > 0.", owner="Yes.", note="Security finding, not a history question."),
    "20251207163822": dict(ev="Q22 + Q19 + Q00", acceptable="Role constraint and policies match the captured Production definitions after allowing the documented duplicate policy; no public ALL policy remains after October.", conflicting="Constraint or policy materially different.", ok=ATT + " (data part: admin-role assignment); schema part verified", bad=UNR, sql="No: October role repair 20261016120000 supersedes the schema effects.", owner="Yes.", note="Record after the October role repair, not before."),
    "20251207184549": dict(ev="Q22", acceptable="Policy set on user_roles equals the post-October target plus the harmless duplicate.", conflicting="Any extra non-duplicate policy.", ok=HIST + " (after 20261016120000 has run)", bad=UNR, sql="No.", owner="Yes (confirm the duplicate-policy decision).", note="Extra Development policy 'Users can read own role' is equivalent to 'Users can read own roles'."),
    "20251207185927": dict(ev="Q22", acceptable="As 20251207184549.", conflicting="As 20251207184549.", ok=HIST + " (after 20261016120000 has run)", bad=UNR, sql="No.", owner="Yes.", note="The version only drops a policy that is superseded."),
    "20260611153900": dict(ev="Q23 (columns) + Q00", acceptable="Columns exist with the same defaults as Production; NOT NULL difference accepted by the owner (U-E2I-9).", conflicting="Column missing or default differs; or the owner wants Production's nullability.", ok=HIST + " (columns verified)", bad=UNR + " (a reviewed ALTER to relax NOT NULL, if the owner wants parity)", sql="Only the optional relaxation as a new reviewed change.", owner="Yes (accept stricter columns).", note="Development is stricter than Production; no function fails."),
    "20260611184401": dict(ev="Q23 (function list)", acceptable="Owner decision U-E2I-4: parity wanted AND function absent.", conflicting="Function absent and the owner declines.", ok=XSQL + " (owner chose parity)", bad="Not recorded (owner declined); never history-only while the function is absent", sql="Yes if parity is chosen (the file as written).", owner="Yes.", note="Production-only function with no caller; October 20261007120000 guards its absence."),
    "20260311111714": dict(ev="Q23 + Q12 + Q00", acceptable="The statement E2A reported unmatched is confirmed present (columns/constraints equal Production) and ledger coverage counts are 0.", conflicting="Missing object or uncovered rows.", ok=HIST + " (schema part) with attestation for the data part", bad=UNR, sql="Only if an object is missing.", owner="Yes.", note=""),
    "20260314213726": dict(ev="Q13 + Q00", acceptable="No NULL address keys and no duplicate keys; the unique index exists.", conflicting="Duplicates or NULL keys.", ok=ATT, bad=UNR, sql="Never the historical merge; corrective only after review.", owner="Yes.", note="Destructive merge; counts cannot show who was merged."),
    "20260314215031": dict(ev="Q13 + Q00", acceptable="As 20260314213726.", conflicting="As 20260314213726.", ok=ATT, bad=UNR, sql="Never the historical merge.", owner="Yes.", note="Destructive merge."),
}
rows = []
for r in v:
    if r["e2i_verdict"] not in (ATT, UNR, XSQL):
        continue
    ver = r["version"]
    g = r["risk_group"] if "risk_group" in r else None
    qs = r["read_only_queries"].replace(";", ", ")
    if r["e2i_verdict"] == XSQL:
        rows.append(dict(version=ver, filename=r["filename"], current_class=r["e2i_verdict"], evidence_required="Q20 + Q00 (bucket settings)", acceptable_result="Bucket limits/MIME list still NULL (Development) while Production's are set: execution remains required.",
                         conflicting_or_unacceptable_result="Settings already equal to Production's values (e.g. carousel-media limit 524288000).", class_if_acceptable=XSQL + " (idempotent bucket UPDATE; owner approval U-E2I-3)", class_if_conflicting=HIST + " (effect verified in the catalog)",
                         empty_result_rule="n/a (a missing bucket row is a different finding: stop and report)", owner_approval_required="Yes", actual_sql_may_be_required="Yes", notes="Kept as an execution candidate unless fresh Q20 shows the effect already present."))
        continue
    o = OVR.get(ver)
    # template group from the E2I risk group column when available, else from text
    grp = "seed" if "seed/configuration" in r["justification"] else "backfill" if "non-financial backfill" in r["justification"] else "financial" if r["e2i_verdict"] == UNR and any(k in r["justification"] for k in ("financ", "balance", "tax", "payment", "identity", "address", "counters", "webhook")) else "unresolved"
    t = TPL[grp]
    if o:
        rows.append(dict(version=ver, filename=r["filename"], current_class=r["e2i_verdict"], evidence_required=o["ev"] + "; " + VALID, acceptable_result=o["acceptable"], conflicting_or_unacceptable_result=o["conflicting"], class_if_acceptable=o["ok"], class_if_conflicting=o["bad"],
                         empty_result_rule=EMPTY, owner_approval_required=o["owner"], actual_sql_may_be_required=o["sql"], notes=o["note"] or r["justification"][:200]))
    else:
        rows.append(dict(version=ver, filename=r["filename"], current_class=r["e2i_verdict"], evidence_required=f"{qs}; {VALID}", acceptable_result=t["acceptable"], conflicting_or_unacceptable_result=t["conflicting"], class_if_acceptable=t["ok"], class_if_conflicting=t["bad"],
                         empty_result_rule=EMPTY, owner_approval_required=t["owner"], actual_sql_may_be_required=t["sql"], notes=r["justification"][:220]))
cols = list(rows[0].keys())
GATE = "Gate unchanged: no query result lifts it."
groups = [
    ("GROUP: 23 October migrations", "Withheld for the October deployment gate", "Gate (R.2 4.1 to 4.9 and G7): deploy-first Edge Functions, owner decisions, default-privilege decision, snapshot before 20261016120000, containment kept until verified"),
    ("GROUP: 8 storage-policy versions", "Withheld for the October deployment gate", "Recorded history-only only after 20261014120000, 20261015120000 and 20261015123000 have run and Q22 matches the target policy set"),
    ("GROUP: 6 containment versions (pg_net, signup trigger path, public buckets, Realtime membership)", "Withheld for the October deployment gate", "Owner containment decisions U-E2I-5/6; Q20/21/24/25 only confirm the starting state"),
]
for name, cur, note in groups:
    rows.append(dict(version=name, filename="", current_class=cur, evidence_required="Q00 + the queries named in the note", acceptable_result="Any result leaves the class unchanged.", conflicting_or_unacceptable_result="Any proposal to treat a result as lifting the gate.",
                     class_if_acceptable=cur + " (unchanged)", class_if_conflicting=cur + " (unchanged)", empty_result_rule=EMPTY, owner_approval_required="Yes (gate owner decisions)", actual_sql_may_be_required="October files: yes, as real SQL after the gate; others: no", notes=note + ". " + GATE))
with open(os.path.join(EV, "e2j-manifest-closure-rules.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
print(len(rows), Counter(r["current_class"] for r in rows))
