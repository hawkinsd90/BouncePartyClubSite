"""Stage E2K: offline integrity verification of the E2J-B evidence, final Development disposition table, attestation decision document and Git checkpoint inventory.
Reads only repository files, committed evidence tables and the protected transcribed results (outside Git). No database connection of any kind.
Usage: python -I e2k_build.py verify|disposition|inventory"""
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2a_sql as SQL  # noqa: E402

EV = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MIG = os.path.join(REPO, "supabase", "migrations")
RAW = r"C:\Users\vikki\migration-evidence\e2jb-development"
STB = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
APPROVED = "6f0be43297029950bf672ab0c7edf2610907ffeb8a35b37313b6a38aa63d57a3"
ATT, UNR, XSQL, HIST, WITH, WD, REC = ("Qualified owner-attestation candidate", "Unresolved", "Actual SQL execution required", "Evidence-backed history-only reconciliation candidate",
                                      "Withheld for the October deployment gate", "Withdrawn", "Already recorded")
rd = lambda p: list(csv.DictReader(open(os.path.join(EV, p), encoding="utf-8")))
man = rd("e2jb-updated-development-manifest.csv")
clo = {c["version"]: c for c in rd("e2jb-evidence-closure.csv")}
ver = {v["version"]: v for v in rd("e2i-development-version-verdicts.csv")}
e2i = {m["version"]: m for m in rd("e2i-development-manifest.csv")}
summ = rd("e2jb-development-capture-summary.csv")

# ----- offline resolutions made in E2K (documented in e2k-report.md section 3) -----
E2K_MOVE = {
    "20260311111714": (HIST, "The one statement E2A left unmatched is payments.ledger_sequence (BIGSERIAL): the Stage B captures of Development and Production show the same bigint NOT NULL column with default nextval; the constraints unique_receipt_pi_type and unique_receipt_charge_type are also present in both. The version has no data statement. Schema-only evidence; Q12 shows 0 NULL sequence values."),
    "20260311113547": (ATT, "Constraint webhook_events_status_check and trigger update_webhook_events_updated_at are present and identical in both captures; the only data statement updates stripe_webhook_events rows and the table is empty (Q17), so the data effect is vacuous and unprovable. Low-risk individual attestation."),
}


def jl(p):
    return json.load(open(os.path.join(RAW, p), encoding="utf-8"))


def verify():
    out = {}
    st = jl("statements.json")
    t = open(os.path.join(EV, "e2j-development-readonly-queries.sql"), "rb").read().replace(b"\r\n", b"\n")
    out["package_sha256_matches_approved"] = hashlib.sha256(t).hexdigest() == APPROVED
    blocks = [(m.group(1) + "_" + m.group(2), m.group(3).strip()) for m in re.finditer(r"(?m)^-- @query (Q\d\d) (\d+)\n(.*?);\n", t.decode("utf-8"), re.S)]
    out["statements_in_file"] = len(blocks)
    out["statement_hashes_match_saved"] = all(hashlib.sha256(s.encode()).hexdigest() == x["sha256"] and i == x["id"] for (i, s), x in zip(blocks, st))
    ids = [r["query_id"] for r in summ]
    out["capture_summary_ids_unique_and_complete"] = len(ids) == 42 and len(set(ids)) == 42 and set(ids) == {i for i, _ in blocks}
    out["capture_summary_all_success"] = all(r["result_status"] == "success" for r in summ)
    hist = {r["version"] for r in json.load(open(STB + r"\dev_catalog_history.json", encoding="utf-8"))}
    live = set(open(os.path.join(RAW, "q01_2_versions.txt")).read().split())
    out["ledger_live_equals_stage_b_58"] = (live == hist and len(live) == 58)
    files = {f[:14]: f for f in os.listdir(MIG) if f.endswith(".sql")}
    out["recorded_versions_with_same_version_repo_file"] = sum(1 for v in live if v in files)
    out["recorded_versions_without_same_version_file"] = sorted(v for v in live if v not in files)
    out["manifest_rows"] = len(man)
    cat = Counter(m["e2jb_category"] for m in man)
    out["manifest_counts"] = dict(cat)
    withdrawn = {f[:14] for f in os.listdir(os.path.join(EV, "withdrawn-migrations")) if f.endswith(".sql")}
    out["manifest_files_resolve"] = all((m["filename"][:14] in files) or (m["filename"][:14] in withdrawn) or m["version"] in live for m in man)
    out["active_file_versions_not_in_manifest"] = sorted(set(files) - {m["version"] for m in man})
    out["e2i_counts_reproduced"] = dict(Counter(m["e2i_category"] for m in man))
    ch = [m for m in man if m["changed"] == "yes"]
    out["changed_rows"] = len(ch)
    out["changed_rows_traceable"] = all(m["version"] in clo and clo[m["version"]]["recommended_class"] == m["e2jb_category"] and clo[m["version"]]["live_result"] for m in ch)
    out["unchanged_rows_agree_with_e2i"] = all(m["e2jb_category"] == e2i[m["version"]]["e2i_category"] for m in man if m["changed"] == "no")
    out["closure_rows"] = len(clo)
    out["closure_by_e2i_class"] = dict(Counter(c["e2i_class"] for c in clo.values()))
    out["unsupported_execution_claims"] = [c["version"] for c in clo.values() if "execut" in c["proof_of_historical_execution"].lower() and not c["proof_of_historical_execution"].lower().startswith(("no", "not"))]
    # aggregate consistency (planner estimates versus exact counts)
    p1 = jl("results_part1.json")
    out["exact_vs_estimate"] = {"orders": (171, p1["Q11_1"]["orders_total"]), "customers": (123, p1["Q14_1"]["customers_total"]), "addresses": (165, p1["Q13_1"]["addresses_total"]), "contacts": (95, p1["Q15_1"]["contacts_total"]),
                               "units": (12, p1["Q05_1"]["units_total"]), "schema_migrations": (37, p1["Q01_1"]["ledger_rows"]), "user_roles": (9, jl("results_part2.json")["Q19_1"]["role_rows"])}
    out["estimates_stale"] = sorted(k for k, (e, x) in out["exact_vs_estimate"].items() if e != x)
    json.dump(out, open(os.path.join(RAW, "e2k-integrity.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(out, indent=1))


# ---------------------------------------------------------------- disposition
GROUPS = {
    "G1 Admin settings seeds": ["20251002210020", "20251003152224", "20251003183947", "20251007210840", "20251231171420", "20260126184412", "20260126193205", "20260203053948", "20260224184535", "20260325231020"],
    "G2 Message and e-mail template seeds": ["20251008144308", "20251205125907", "20251216201450", "20260126193254", "20251221225000", "20260224183629"],
    "G3 Pricing configuration": ["20251001051901", "20251001192425", "20251002180149", "20251130231633", "20251222014723", "20251222020729", "20260119195140", "20260311121119"],
    "G4 Order status and flag normalizations": ["20251007220415", "20251007221227", "20251007221817", "20251130191333", "20260816221636", "20260928172217"],
    "G5 Catalog, content and link backfills": ["20251001052039", "20251207160232", "20251231174711", "20260224133344", "20260224161311", "20260224165424", "20260318191352", "20260331151647", "20260415234700"],
    "G6 Role normalization": ["20260324175546", "20260324190039"],
    "G7 Payment, financial, identity and webhook data": ["20251209133113", "20260120203953", "20260125170305", "20260125173238", "20260305222010", "20260326004004", "20260302131311", "20260311191611", "20260314213726", "20260314215031", "20260315173745", "20260323175236", "20260311113547"],
}
GRISK = {
    "G1 Admin settings seeds": ("Low if keys are idempotent seeds; MEDIUM where the version overwrites a value (UPDATE of a setting)", "Row existence is not proof the seed ran; values were not compared with the file or with Production"),
    "G2 Message and e-mail template seeds": ("Low: seeds use ON CONFLICT DO NOTHING; a re-run would not overwrite edited text", "Templates may have been edited or created by hand; text was never read"),
    "G3 Pricing configuration": ("Medium where the version UPDATEs the single pricing row: a re-run would overwrite today's business values", "Only NULL counts were read; values were not compared with the file or with Production"),
    "G4 Order status and flag normalizations": ("Low: guarded by a predicate that matches no row today", "Zero matching rows is also the state of a database that never had such rows"),
    "G5 Catalog, content and link backfills": ("Low to medium; the sample-unit seed would insert sample inventory", "Content is edited by the business; presence is not provenance"),
    "G6 Role normalization": ("Low: lower-casing only; no row matches today", "Zero mixed-case roles of 9 does not show the UPDATE ran"),
    "G7 Payment, financial, identity and webhook data": ("HIGH for balance/tax recomputes and address merges: a re-run recalculates or merges live records", "Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since"),
}
RERUN_NOTE = {
    "20251001052039": "re-run would insert sample units", "20260126193205": "re-run overwrites the home-address settings with constants", "20260224184535": "re-run overwrites the review URL",
    "20260125173238": "re-run recalculates balance_due on every order", "20260305222010": "re-run recalculates balance_due on every order (tips excluded)", "20260120203953": "re-run sets tax_waived on historic orders",
    "20260125170305": "re-run resets tax_waived on historic orders", "20260314213726": "re-run computes address keys and merges duplicate addresses", "20260314215031": "re-run merges duplicate addresses again",
    "20260302131311": "re-run links customers to auth users by e-mail", "20260326004004": "re-run copies payment method fields onto orders", "20251209133113": "re-run backfills payment timestamps",
    "20260415234700": "re-run converts invoice links to portal short links", "20260315173745": "re-run backfills profile names",
}
SPECIAL = {
    "20251001052039": ("DO NOT ATTEST AS APPLIED; owner decides", "The 3 sample units are absent and the catalog holds 16 other units; the seed was either replaced or never applied. Recording as applied would claim an effect that is not visible. Recommended: owner attests 'obsolete seed, never re-run' (not 'executed'), or leave pending."),
    "20260318191352": ("Query first, or leave pending", "The water-slide price predicate is not covered by any captured query."),
    "20260415234700": ("Query first, or leave pending", "38 invoice-type links remain; the backfill's full predicate was not captured."),
    "20260928172217": ("Query first, or leave pending", "No captured query covers the parks-acknowledgment backfill."),
    "20251001192425": ("Attest only the schema/pricing part", "The orders.start_date column the backfill targeted no longer exists."),
    "20251222020729": ("Attest the fee column; query the cities update", "included_cities update not covered."),
    "20260323175236": ("Attest (security state verified safe)", "Q18 = 0 secret-like changelog rows unredacted; this is a safe-state check, the strongest evidence in the group."),
}


def title_of(fn):
    p = os.path.join(MIG, fn)
    if not os.path.exists(p):
        return ""
    t = open(p, encoding="utf-8", errors="replace").read()
    m = re.search(r"#\s*(.+)", t[:600])
    return (m.group(1).strip() if m else fn[15:].replace("_", " ").replace(".sql", ""))[:90]


def rerun_kind(fn):
    p = os.path.join(MIG, fn)
    if not os.path.exists(p):
        return ""
    sts = SQL.strip_and_split(open(p, encoding="utf-8", newline="").read().replace("\r\n", "\n"))
    kinds = set()
    for s in sts:
        u = s.upper()
        if re.search(r"\bDELETE\s+FROM\b", u):
            kinds.add("deletes rows")
        if "ON CONFLICT" in u and "DO NOTHING" in u:
            kinds.add("idempotent insert")
        if u.lstrip().startswith("UPDATE"):
            kinds.add("conditional update" if " WHERE " in u else "unconditional update")
        if "AUTH.USERS" in u:
            kinds.add("touches auth.users")
    return ", ".join(sorted(kinds)) or "schema/DO only"


def disposition():
    final = {}
    for m in man:
        final[m["version"]] = [m["e2jb_category"], m["e2jb_evidence"]]
    for v, (cat, why) in E2K_MOVE.items():
        final[v] = [cat, why]
    cnt = Counter(c[0] for c in final.values())
    PATH = {REC: ("none (already recorded)", "none"),
            HIST: ("history-only ledger row after fresh re-verification (batch)", "ledger insert only"),
            ATT: ("individually signed qualified attestation, then ledger row with the attestation marker", "ledger insert only"),
            XSQL: ("owner-approved SQL, rehearsed on a scratch restore, then executed row", "schema change (storage.buckets settings) + ledger insert"),
            WITH: ("not before its gate; October files execute as SQL, the rest become history-only after the gate", "per gate"),
            WD: ("never recorded or executed", "none"),
            UNR: ("owner decision or one narrowly scoped read-only query first", "none until decided")}
    APPR = {REC: "none", HIST: "owner approval of the batch after fresh Q00/Q01 and re-verification", ATT: "owner signature per version (no blanket attestation)", XSQL: "owner approval of the exact SQL (U-E2I-3) and rehearsal",
            WITH: "gate owner decisions (see e2j-development-release-gates.md)", WD: "none", UNR: "owner decision per version"}
    rows = []
    for m in man:
        v = m["version"]
        cat, ev = final[v]
        pre = ""
        if cat == UNR:
            pre = {"20251003170350": "Step 3 security review of the existing demo admin login; execution prohibited", "20251003182356": "owner confirms removal of the test template",
                   "20251008153245": "corrected read-only query Q31 (e-mail-keyed counters)", "20260323155222": "Q31", "20260323163432": "Q31", "20260323164559": "Q31",
                   "20260305205811": "read-only query Q32 (when the 22 orders were created) and owner decision", "20260611184401": "owner decision U-E2I-4 (Production-only function, no caller)"}.get(v, "")
        elif cat == WITH:
            pre = "October gate" if v >= "20261007000000" else "containment decision / October storage and role migrations"
        elif cat == XSQL:
            pre = "Q20 shows the limits still absent (verified live); owner approval"
        elif cat == HIST:
            pre = "fresh Q00/Q01 and per-version re-verification at run time; net-zero chains only after their droppers are recorded" if ver.get(v, {}).get("risk_group") == "net-zero" or v in ("20260315190615", "20260315202232", "20260316174421", "20260324191543") else "fresh Q00/Q01 and per-version re-verification at run time"
        rows.append({"version": v, "filename": m["filename"], "final_category": cat, "evidence_basis": ev[:300], "reconciliation_path": PATH[cat][0], "hosted_write_if_applied_later": PATH[cat][1],
                     "approvals_required": APPR[cat], "prerequisites": pre, "approved": "no (proposal only)", "e2k_change_from_e2jb": "yes" if cat != m["e2jb_category"] else "no"})
    with open(os.path.join(EV, "e2k-final-development-disposition.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print("disposition", len(rows), dict(cnt))
    # attestation decisions document
    att = [v for v, c in final.items() if c[0] == ATT]
    covered = {v for g in GROUPS.values() for v in g}
    assert set(att) == covered, (sorted(set(att) - covered), sorted(covered - set(att)))
    L = ["# E2K: owner attestation decisions (54 individually listed versions)", "",
         "Nothing here is an attestation or an approval. **No blanket attestation is requested.** Each version below needs its own signature; versions are grouped only where they share the same independently supported evidence and risk, and each group carries its own recommended disposition. Current-state evidence comes from the E2J-B hosted read-only capture (2026-10-17; the results were transcribed from the Supabase integration, see `e2k-report.md`). **Current-state equivalence is not proof that the historical SQL ran**; a qualified attestation would state exactly that: \"the database is in the state this version describes; I do not claim this migration executed\".", "",
         "How to read the risk columns. *Risk if bookkeeping is performed*: the ledger would show the version as handled while its effect is only inferred. *Risk if left pending*: any tool that applies pending migrations would re-run the SQL against live data; the re-run effect column states what that would do.", ""]
    for gname, vs in GROUPS.items():
        r1, r2 = GRISK[gname]
        L += [f"## {gname} ({len(vs)} versions)", "", f"- Shared unproven effect: {r2}.", f"- Risk if left pending (group): {r1}.", ""]
        L += ["| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |", "|---|---|---|---|---|---|---|"]
        for v in vs:
            c = clo[v]
            fn = ver[v]["filename"]
            sp = SPECIAL.get(v)
            disp = sp[0] if sp else ("Attest individually after the owner confirms the content is intended" if c["evidence_status"].startswith("supported") else "Query first, or leave pending")
            note = RERUN_NOTE.get(v) or rerun_kind(fn)
            ev = c["live_result"] if v in clo else E2K_MOVE[v][1]
            if ev.startswith("0 named keys"):
                ev = "the version only UPDATEs existing settings; the related keys exist (Q02: home_address_* / google_review_url present with values) but the values were not compared with the file or Production"
            if v in E2K_MOVE:
                ev = E2K_MOVE[v][1]
            L.append(f"| `{v}` | {title_of(fn)} | {ev} | {note} | {c['evidence_status'] if v in clo else 'supported (schema identity; data vacuous)'} | {disp}{(': ' + sp[1]) if sp else ''} | Yes, signed for this version only |")
        L.append("")
    L += ["## What the owner is asked", "", "1. Decide group by group whether the recommended disposition is acceptable; sign **per version**, naming the observed state and the date. The executor already supports a qualified-attestation record (version, observation, author, date).",
          "2. For versions marked *Query first*, either approve a narrowly scoped read-only query (`e2k-additional-readonly-queries.sql`, not run) or choose to leave them pending.",
          "3. Versions the owner will not attest remain pending; nothing may be recorded for them by default.", "",
          "## Not attestable or not in this list", "", "The eight unresolved versions (`e2k-report.md` section 3) are not offered for attestation. The 221+ history-only candidates are bookkeeping candidates re-verified at run time, not owner attestations."]
    open(os.path.join(EV, "e2k-attestation-decisions.md"), "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
    print("attestation doc", len(att))


# ---------------------------------------------------------------- inventory
def inventory():
    out = subprocess.run(["git", "status", "--short", "-uall"], capture_output=True, text=True, cwd=REPO).stdout.splitlines()
    ent = [(l[:2], l[3:].strip().strip('"')) for l in out]
    excl = [p for _, p in ent if p == ".gitignore" or "__pycache__" in p]
    ent = [(s, p) for s, p in ent if p not in excl]

    def grp(p):
        b = os.path.basename(p)
        if p.startswith("supabase/migrations/") or "withdrawn-migrations" in p or p.endswith("version-aliases.json") or p.endswith("migrationPendingSet.test.ts") or b.startswith("e2f-"):
            return 4
        if p in ("audit/development-migration-manifest.csv", "audit/step2-completion.md", "audit/evidence/development-plan-rehearsal-results.json", "src/lib/tests/security/developmentManifest.test.ts") or b in ("build_development_plan.py", "rehearse_development_plan.py", "build_execution_manifest.py", "build_execution_package.py", "render_approval_package.py", "test_execution_scripts.py") or p.startswith("audit/development-") or p == "audit/evidence/development-execution-test-results.json" or b in ("developmentExecutionManifest.test.ts",):
            return 9
        if p.startswith("scripts/dev/local-executor") or re.match(r"(tools/)?(e2g|e2h)", p.replace("audit/evidence/", "")):
            return 5
        key = re.sub(r"^audit/evidence/(tools/)?", "", p)
        for pref, g in (("e2c", 1), ("e2d", 2), ("e2e", 3), ("e2ja", 7), ("e2jb", 8), ("e2j", 7), ("e2i", 6), ("e2k", 9)):
            if key.startswith(pref):
                return g
        return 10 if p == "audit/step2-migration-audit.md" else 11
    TITLE = {1: ("A", "E2C: owner decisions, 67-versus-58 comparison, omission and resumption tests"), 2: ("B", "E2D: final 58-migration synthetic data and financial safety validation"), 3: ("C", "E2E: repository cleanup plan, Development manifest and executor design"),
             4: ("D", "E2F: withdraw Cases 41 and 42 (repository change)"), 5: ("E", "E2G/E2H: local-only allowlist executor, dependency data, tests and evidence"), 6: ("F", "E2I: Development evidence closure and manifest readiness"),
             7: ("G", "E2J and E2J-A: read-only evidence preparation and capture authorization"), 8: ("H", "E2J-B: hosted Development read-only capture results (sanitized)"), 9: ("I", "E2K: final Step 2 audit, dispositions and handoff"),
             10: ("J", "audit/step2-migration-audit.md: sections AK to the E2K closing assessment")}
    by = defaultdict(list)
    for s, p in ent:
        by[grp(p)].append((s, p))
    L = ["# E2K commit inventory (proposal only; nothing is staged or committed)", "", f"Taken from `git status --short -uall` at the end of E2K (branch `Dev`, HEAD `efda4177433258c4b2c469e5aa381bc2545f36ba`). Supersedes `e2h-commit-inventory.md`. Re-run `git status` before committing. Commit messages below are suggestions; none has been created. Attribution lines follow the session's instruction at commit time.", "",
         "## Suggested local checkpoint commits, in this order", ""]
    total = 0
    DESC = {1: "Evidence and scratch-test tools for the Production 58-version candidate. No dependency on later commits.",
            2: "Synthetic-data and financial-safety evidence for the final 58-migration set; tools import the committed D4 harness.",
            3: "Repository cleanup plan, Development manifest, executor design; cleanup simulation writes only to the scratch folder.",
            4: "The only commit that changes `supabase/` and a test: two migration files leave the active directory (stage with `git add -A -- <old paths> <new paths>` so the moves are renames), the archive and index are added, the alias document and three pending-set assertions change.",
            5: "Executor, builder, README, audited dependency data, tests and the executor evidence. Depends on commit D (tests assume 384 active migrations and the archive deny list). Local-only: loopback, `bpc_exec_` names, no credentials.",
            6: "Development restore, October dry run, per-version verdicts, 388-row manifest, evidence plan and compatibility analysis.",
            7: "Query review, hosted-ready package (hash `6f0be432...`), closure rules, privilege analysis, release gates, authorization (Authorization A/B) and the local validation tools.",
            8: "Sanitized summary tables and findings only. **Raw transcribed results stay in `C:\\Users\\vikki\\migration-evidence\\e2jb-development\\` and are never committed.**",
            9: "Integrity verification, final dispositions, attestation decisions, security handoff, closure checklist, this inventory, the canonical Development manifest (`audit/development-migration-manifest.csv`), `audit/step2-completion.md`, its generator, the local rehearsal and results, and the manifest test.",
            10: "Commit last so the audit narrative describes everything before it."}
    for g in sorted(by):
        if g == 11:
            continue
        files = sorted(by[g], key=lambda x: x[1])
        total += len(files)
        L += [f"### Commit {TITLE[g][0]} - {TITLE[g][1]} ({len(files)} files)", DESC[g], ""]
        for s, p in files:
            L.append(f"- `{p}` ({ {'??': 'new', ' M': 'modified', ' D': 'deleted (moved to the archive)'}.get(s, s) })")
        L.append("")
    if 11 in by:
        L += ["### Unclassified (review before committing)", ""] + [f"- `{p}` ({s})" for s, p in by[11]] + [""]
    L += ["## Excluded", ""] + [f"- `{p}`: " + ("unrelated change belonging to another workstream" if p == ".gitignore" else "compiled Python cache") for p in excl]
    L += ["- `C:\\Users\\vikki\\migration-evidence\\` (outside the repository): protected Stage B captures, restored dumps, scratch databases, audit stores, test outputs and the transcribed E2J-B results. Sensitive; never enters Git.",
          "- Anything under `node_modules` or `.git`.", "",
          "## Checks behind the list", f"- {total} eligible files in {len([g for g in by if g != 11])} commits, none staged. Raw captures, credentials and personal data are not in any listed file. The Development project reference appears in the E2J-B/E2K evidence as an identifier (it is not a credential); the Production reference appears only in the executor's blocklist patterns and its tests. The demo-admin address appears only inside the proposed Q26/Q34 query text, where it already appears in a committed migration.",
          "- Dependencies: D before E (executor tests); E before F-I only for narrative order (no code dependency); J last. A, B and C are independent of D.",
          "- Before committing: run `recoveredMigrationFiles`, `migrationReplaySafety`, `migrationPendingSet` (63 / 144 / 54: `node node_modules/jiti/bin/jiti.js src/lib/tests/security/<name>.test.ts`). The two pre-existing failing assertions (`coreDatabaseAccess`, `databaseFunctionAccessClassification`) are not part of any commit.",
          "- The Development alias `20260814120000` file and every executable migration remain byte-identical to HEAD apart from the two archived files."]
    open(os.path.join(EV, "e2k-commit-inventory.md"), "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
    print("inventory", total, {g: len(v) for g, v in by.items()})


if __name__ == "__main__":
    {"verify": verify, "disposition": disposition, "inventory": inventory}[sys.argv[1]]()
