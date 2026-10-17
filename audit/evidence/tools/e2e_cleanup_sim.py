"""Stage E2E: SIMULATES the proposed repository cleanup on a SCRATCH COPY of the repository (never on the real working tree) so the exact edits can be tested and diffed.
Refuses any target path that is not inside C:\\Users\\vikki\\migration-evidence\\e2e-scratch. Nothing in the real repository is moved, renamed or edited.
Usage: python -I e2e_cleanup_sim.py <cleanup|rename> <scratch-repo-copy>
  cleanup = withdraw Cases 41 and 42 (move to the archive, update the alias document and the pending-set evidence assertions)
  rename  = cleanup plus align 20260814120000 with the Development-recorded 20260814002658 (file rename, alias entry, contact-inquiry test)"""
import hashlib
import json
import os
import shutil
import sys

SAFE = os.path.normcase(r"C:\Users\vikki\migration-evidence\e2e-scratch")
C41, C42, C43 = "20260305203528", "20260407203226", "20260407211122"
ALIAS_OLD, ALIAS_NEW = "20260814120000", "20260814002658"


def sha(b):
    return hashlib.sha256(b).hexdigest()


def edit(path, old, new):
    s = open(path, encoding="utf-8", newline="").read()
    crlf = "\r\n" in s
    if crlf:
        old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
    assert s.count(old) == 1, (os.path.basename(path), old[:70], s.count(old))
    open(path, "w", encoding="utf-8", newline="").write(s.replace(old, new))


def run(mode, root):
    root = os.path.abspath(root)
    assert os.path.normcase(root).startswith(SAFE + os.sep), "target must be inside the e2e scratch folder"
    assert mode in ("cleanup", "rename")
    mig = os.path.join(root, "supabase", "migrations")
    arc = os.path.join(root, "audit", "evidence", "withdrawn-migrations")
    os.makedirs(arc, exist_ok=True)
    index = []
    for ver, why, retained in (
        (C41, "Case 41: backfill differs from recorded 20260305205811 (always 'deposit' versus CASE 'full'/'deposit'); executing it can overwrite customer_selected_payment_type on real orders", "20260305205811_add_customer_selected_payment_tracking.sql (recorded in Production)"),
        (C42, "Case 42: executable SQL digest-identical (23fa13edf474228c...) to recorded 20260408200431; only the header comment differs", "20260408200431_add_refund_requested_to_orders.sql (recorded in Production)"),
    ):
        f = [x for x in os.listdir(mig) if x.startswith(ver + "_")][0]
        b = open(os.path.join(mig, f), "rb").read()
        shutil.move(os.path.join(mig, f), os.path.join(arc, f))
        index.append({"version": ver, "file": f, "sha256_working_copy_bytes": sha(b), "sha256_lf_normalized": sha(b.replace(b"\r\n", b"\n")), "bytes": len(b), "reason": why, "retained_counterpart": retained, "never_record_in_any_history": True})
    c43 = [x for x in os.listdir(arc) if x.startswith(C43 + "_")][0]
    b43 = open(os.path.join(arc, c43), "rb").read()
    index.append({"version": C43, "file": c43, "sha256_working_copy_bytes": sha(b43), "sha256_lf_normalized": sha(b43.replace(b"\r\n", b"\n")), "bytes": len(b43), "reason": "Case 43 (Stage C3): obsolete anonymous cancellation policy", "retained_counterpart": "none", "never_record_in_any_history": True})
    json.dump({"purpose": "Withdrawn migrations: preserved verbatim next to this file. They are NOT in supabase/migrations and must never be executed or recorded in any migration history. This list is also the executor deny list.", "withdrawn": index},
              open(os.path.join(arc, "withdrawn-index.json"), "w", encoding="utf-8"), indent=1)

    al = os.path.join(root, "audit", "evidence", "version-aliases.json")
    doc = json.load(open(al, encoding="utf-8"))
    drop = {C41, C42} | ({ALIAS_OLD} if mode == "rename" else set())
    doc["aliases"] = [a for a in doc["aliases"] if a["local_version"] not in drop]
    doc["withdrawn"] += [{"version": C41, "note": "Case 41, withdrawn (D-3); SQL preserved in audit/evidence/withdrawn-migrations/. Must not be in the repository and must not be recorded in any history."},
                         {"version": C42, "note": "Case 42, withdrawn (D-4); executable SQL identical to recorded 20260408200431; preserved in audit/evidence/withdrawn-migrations/. Must not be in the repository and must not be recorded in any history."}]
    json.dump(doc, open(al, "w", encoding="utf-8"), indent=2)

    t = os.path.join(root, "src", "lib", "tests", "security", "migrationPendingSet.test.ts")
    dev_pending = 326 if mode == "rename" else 327
    edit(t, "ok('evidence: 386 repository versions', loc.versions.length === 386);", "ok('evidence: 384 repository versions (Cases 41 and 42 withdrawn)', loc.versions.length === 384);")
    edit(t, "ok('evidence: Production pending 109, Development pending 329', P.pending_count === 109 && D.pending_count === 329);",
         f"ok('evidence: Production pending 107, Development pending {dev_pending}', P.pending_count === 107 && D.pending_count === {dev_pending});")
    edit(t, "ok('evidence: cases 41 and 42 stay pending on Production (annotated, not removed)', P.pending_versions.includes('20260305203528') && P.pending_versions.includes('20260407203226') && P.alias_annotations.length === 2);",
         "ok('evidence: cases 41 and 42 are withdrawn: not in the repository, not pending anywhere, no alias annotation', ['20260305203528', '20260407203226'].every((v: string) => !loc.versions.includes(v) && !P.pending_versions.includes(v) && !D.pending_versions.includes(v)) && P.alias_annotations.length === 0);")
    if mode == "rename":
        edit(t, "ok('evidence: Development 20260814120000 stays pending; 20260814002658 is recorded without a local file', D.pending_versions.includes('20260814120000') && same(D.recorded_without_local_file, ['20260814002658']));",
             "ok('evidence: Development 20260814002658 is recorded and has a repository file; 20260814120000 no longer exists', loc.versions.includes('20260814002658') && !loc.versions.includes('20260814120000') && D.recorded_without_local_file.length === 0 && D.alias_annotations.length === 0);")
        f = [x for x in os.listdir(mig) if x.startswith(ALIAS_OLD + "_")][0]
        os.rename(os.path.join(mig, f), os.path.join(mig, ALIAS_NEW + f[len(ALIAS_OLD):]))
        c = os.path.join(root, "src", "lib", "tests", "security", "contactInquiryMigrations.test.ts")
        edit(c, "const CREATE = '20260814120000_create_contact_inquiries.sql';", "const CREATE = '20260814002658_create_contact_inquiries.sql';")
        edit(c, "// versioned BEFORE the one that creates the table, because the hosted Development database received them in that order. Their\n// versions cannot change, so they must be safe on a database that has no table yet, and a later corrective migration must\n// guarantee the same end state everywhere.",
             "// versioned AFTER the one that creates the table (20260814002658), which is the order the hosted Development database applied them. They\n// stay guarded so they are also safe on a database that has no table yet (the legacy order is still tested), and a later corrective\n// migration must guarantee the same end state everywhere.")
        edit(c, "ok('static: the historical versions are unchanged (grant < upgrade < create)', order(GRANT) < order(UPGRADE) && order(UPGRADE) < order(CREATE));",
             "ok('static: the table is created first (create < grant < upgrade), the order Development applied them', order(CREATE) < order(GRANT) && order(GRANT) < order(UPGRADE));")
        edit(c, "    const db1 = fresh('empty');\n    for (const f of [GRANT, UPGRADE, CREATE, ENSURE]) {",
             "    const db1 = fresh('empty');\n    for (const f of [CREATE, GRANT, UPGRADE, ENSURE]) {")
        edit(c, "    // 2. Development-like:",
             "    // 1b. Legacy order (guards): the grant and upgrade files before the table exists must still apply strictly.\n    const dbL = fresh('legacy');\n    for (const f of [GRANT, UPGRADE, CREATE, ENSURE]) ok(`executed/legacy-order: ${f} applies strictly`, apply(dbL, read(DIR + f)).status === 0);\n    finalOk('executed/legacy-order', state(dbL));\n\n    // 2. Development-like:")
    return len(os.listdir(mig))


if __name__ == "__main__":
    print("migration files after simulation:", run(sys.argv[1], sys.argv[2]))
