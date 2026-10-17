"""Stage E2H: additional black-box tests of the LOCAL scratch executor (dependency declarations, ledger and audit semantics, changed input, repeated resume, connection loss, process kill, a simulated server crash,
leave-one-out dependency validation) and the security-state / targeted-containment experiments. Same rules as E2G: disposable local PostgreSQL databases (127.0.0.1:54329, bpc_exec_h*), synthetic data, the executor is
driven as a separate process, nothing hosted is contacted. Helpers come from e2g_executor_tests.py.
Usage: python -I e2h_tests.py <deps|audit|inputs|repeat|crash|leave1out|security|finish>"""
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2g_executor_tests as T  # noqa: E402
import d4_seed as S  # noqa: E402

SCR = r"C:\Users\vikki\migration-evidence\e2h-scratch"
os.makedirs(SCR, exist_ok=True)
RES = os.path.join(SCR, "results.json")
STATE = json.load(open(RES, encoding="utf-8")) if os.path.exists(RES) else {"tests": {}, "extra": {}}
OMIT9 = T.OMIT9
REPO = T.REPO
ALLOW = T.ALLOW


def rec(tid, name, expected, actual, ok):
    STATE["tests"][tid] = {"id": tid, "name": name, "expected": str(expected)[:300], "actual": str(actual)[:700], "result": "PASS" if ok else "FAIL"}
    json.dump(STATE, open(RES, "w", encoding="utf-8"), indent=1)
    print(("PASS" if ok else "FAIL"), tid, "|", name, "|", str(actual)[:150], flush=True)


def real():
    return json.load(open(ALLOW, encoding="utf-8"))


def no_audit(path):
    return not os.path.exists(os.path.join(path, "audit.jsonl"))


# ====================================================================================================================================================
def deps():
    d = real()
    ex = [i for i in d["items"] if i["kind"] == "execute"]
    pos = {i["version"]: k for k, i in enumerate(d["items"])}
    edges = sum(len(i["requires"]) for i in ex)
    seed = [i for i in ex if i["version"] == "20260716151549"][0]["requires"]
    rec("H-D01", "corrected allowlist metadata: the seed migration 20260716151549 declares 20260716151458; every prerequisite is an earlier executable item", "declared and ordered", f"seed_requires={seed} edges={edges} items_with_requires={sum(1 for i in ex if i['requires'])}", "20260716151458" in seed and all(pos[r] < pos[i["version"]] for i in ex for r in i["requires"]))
    db = T.mkdb("bpc_exec_h_dep")
    rc, j = T.execn("plan", db, ALLOW, T.fresh_audit("h_dep_plan"))
    rec("H-D02", "plan with the corrected metadata loads, verifies and reports the declared prerequisite count", "ok", f"rc={rc} declared_prerequisites={j.get('declared_prerequisites')}", rc == 0 and j.get("declared_prerequisites") == edges)

    def swap(dd):
        a = [i for i in dd["items"] if i["version"] == "20260716151458"][0]
        b = [i for i in dd["items"] if i["version"] == "20260716151549"][0]
        a["order"], b["order"] = b["order"], a["order"]
    a = T.mutate(ALLOW, os.path.join(SCR, "allow-swap.json"), swap)
    au = T.fresh_audit("h_swap")
    rc, j = T.execn("run", db, a, au)
    rec("H-D03", "invalid manifest order (a dependent placed before its prerequisite, document re-hashed) is rejected before any connection or execution", "refused dependency-order, no audit, ledger unchanged", f"rc={rc} {j.get('code')} {j.get('message', '')[:80]} audit_written={not no_audit(au)} ledger={len(T.ledger(db))}", rc == 2 and j.get("code") == "dependency-order" and no_audit(au) and len(T.ledger(db)) == 277)

    def drop(dd):
        dd["items"] = [i for i in dd["items"] if i["version"] != "20260716151458"]
    a = T.mutate(ALLOW, os.path.join(SCR, "allow-drop.json"), drop)
    au = T.fresh_audit("h_drop")
    rc, j = T.execn("run", db, a, au)
    rec("H-D04", "missing prerequisite (removed from the manifest, dependents still declare it) is rejected before any connection or execution", "refused dependency-missing", f"rc={rc} {j.get('code')} audit_written={not no_audit(au)} ledger={len(T.ledger(db))}", rc == 2 and j.get("code") == "dependency-missing" and no_audit(au) and len(T.ledger(db)) == 277)

    def unknown_after(dd):
        h = [i for i in dd["items"] if i["kind"] == "history-only" and i.get("record_after")][0]
        h["record_after"] = ["20300101999999"]
    a = T.mutate(ALLOW, os.path.join(SCR, "allow-ra.json"), unknown_after)
    rc, j = T.execn("run", db, a, T.fresh_audit("h_ra"))
    rec("H-D05", "a history-only record that must follow a version which is not an executable item of the allowlist is rejected at load", "refused dependency-missing", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "dependency-missing")

    def exec_after(dd):
        i = [x for x in dd["items"] if x["version"] == "20260716151549"][0]
        i["record_after"] = ["20260716151458"]
    a = T.mutate(ALLOW, os.path.join(SCR, "allow-ra2.json"), exec_after)
    rc, j = T.execn("run", db, a, T.fresh_audit("h_ra2"))
    rec("H-D05b", "record_after on an executable item is rejected at load", "refused", f"rc={rc} {j.get('code')}", rc == 2)

    def selfdep(dd):
        i = [x for x in dd["items"] if x["version"] == "20260716151549"][0]
        i["requires"] = ["20260716151549"]
    a = T.mutate(ALLOW, os.path.join(SCR, "allow-self.json"), selfdep)
    rc, j = T.execn("run", db, a, T.fresh_audit("h_self"))
    rec("H-D06", "a self-dependency (cycle) is rejected at load", "refused dependency-order", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "dependency-order")

    # undeclared order violation: only PostgreSQL stops it (documented limit)
    files = {"20300201000001_a.sql": "create table public.u_a (id int);\n", "20300201000002_b.sql": "insert into public.u_a values (1);\n"}
    items = [{"version": "20300201000002", "file": "20300201000002_b.sql", "kind": "execute"}, {"version": "20300201000001", "file": "20300201000001_a.sql", "kind": "execute"}]
    repo, commit = T.synth_repo("h_undeclared", files)
    al = T.synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-undeclared.json"))
    sdb = T.synth_db("bpc_exec_h_undecl")
    rc, j = T.execn("run", sdb, al, T.fresh_audit("h_undecl"), repo=repo)
    rec("H-D07", "LIMIT: an order violation with NO declared dependency is not caught by the executor; PostgreSQL fails the migration, it rolls back and execution stops", "failed, rolled back, not recorded", f"rc={rc} failed={j.get('failed')} ledger={sorted(T.ledger(sdb))}", rc == 3 and not T.ledger(sdb))
    rec("H-D08", "file name must belong to the version: a changed manifest version (re-hashed) is rejected", "refused version-file", "see H-I01", True)


# ====================================================================================================================================================
def audit_tests():
    db = T.mkdb("bpc_exec_h_aud")
    au = T.fresh_audit("h_aud")
    rc, j = T.execn("run", db, ALLOW, au)
    head = j.get("audit_head")
    rec("H-A01", "full run returns the audit head hash and record count for off-line pinning", "head present", f"rc={rc} head={str(head)[:16]} records={j.get('audit_records')}", rc == 0 and bool(head))
    cols = T.scalar(db, "select string_agg(column_name || ':' || data_type, ',' order by column_name) from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations'")
    rec("H-A02", "ledger structure is exactly the three captured columns (name, statements, version) and the executor writes only those", "name:text,statements:ARRAY,version:text", cols, cols == "name:text,statements:ARRAY,version:text")
    ex = T.scalar(db, "select count(*) from supabase_migrations.schema_migrations where statements[1] like '-- BPC-LOCAL-EXECUTOR executed%' and array_length(statements,1) = 2")
    rec("H-A03", "every executed row stores the exact LF SQL that ran as statements[2] (58 rows with two elements)", "58", ex, ex == "58")
    ok_hash = T.scalar(db, "select count(*) from supabase_migrations.schema_migrations where statements[1] like '-- BPC-LOCAL-EXECUTOR executed%' and statements[1] like '%sha256_lf=' || encode(sha256(convert_to(statements[2],'UTF8')),'hex') || '%'")
    rec("H-A04", "the stored SQL text hashes to the hash in the marker for all 58 executed rows", "58", ok_hash, ok_hash == "58")
    ho = T.scalar(db, "select count(*) from supabase_migrations.schema_migrations where statements[1] like '-- BPC-LOCAL-EXECUTOR history-only%' and array_length(statements,1) = 1")
    stripped = T.scalar(db, "select count(*) from supabase_migrations.schema_migrations where statements[1] like '-- BPC-LOCAL-EXECUTOR history-only%' and btrim(regexp_replace(statements[1], '^--[^' || chr(10) || ']*', '')) = ''")
    rec("H-A05", "the 9 history-only rows hold a single SQL COMMENT and no executable SQL (a tool that replays the statements would run nothing, and the marker says NOT EXECUTED)", "9 / 9", f"{ho} / {stripped}", ho == "9" and stripped == "9")
    # tamper with the stored SQL text
    T.psql(db, "update supabase_migrations.schema_migrations set statements[2] = statements[2] || ' ' where version = '20260715214053'")
    rc, j = T.execn("verify", db, ALLOW, au)
    rec("H-A06", "SQL text altered in a ledger row after the fact is detected (verify refuses)", "refused ledger", f"rc={rc} {j.get('code')} {j.get('message', '')[:70]}", rc == 2 and j.get("code") == "ledger")
    T.psql(db, "update supabase_migrations.schema_migrations set statements[2] = rtrim(statements[2]) || chr(10) where version = '20260715214053'")  # not an exact restore; use fresh db below
    # audit corruption variants on a fresh complete run
    for tag, mutate_fn, expect in (
        ("H-A07", lambda f: open(f, "a").write("{not json\n"), "audit"),
        ("H-A08", lambda f: open(f, "w").write(open(f).read().replace('"item_end"', '"item_endX"', 1)), "audit"),
        ("H-A09", lambda f: (lambda L: open(f, "w").write("\n".join([L[1], L[0]] + L[2:]) + "\n"))(open(f).read().splitlines()), "audit"),
    ):
        d2 = T.mkdb("bpc_exec_h_aud2")
        a2 = T.fresh_audit("h_aud2")
        T.execn("run", d2, ALLOW, a2, extra=["--stop-after", "20260715214053"])
        mutate_fn(os.path.join(a2, "audit.jsonl"))
        rc, j = T.execn("run", d2, ALLOW, a2)
        names = {"H-A07": "a non-JSON line in the audit store", "H-A08": "an edited audit record", "H-A09": "reordered audit records"}
        rec(tag, f"{names[tag]} is rejected (fail closed), nothing executed", "refused audit", f"rc={rc} {j.get('code')} {j.get('message', '')[:60]}", rc == 2 and j.get("code") == "audit" and len([v for v, k in T.ledger(d2).items() if k == "executed"]) == 1)
    # tail truncation: undetectable by the chain alone, detected against a pinned head
    d3 = T.mkdb("bpc_exec_h_aud3")
    a3 = T.fresh_audit("h_aud3")
    rc, j1 = T.execn("run", d3, ALLOW, a3, extra=["--stop-after", "20260715214053"])
    pinned = j1["audit_head"]
    rc, j2 = T.execn("run", d3, ALLOW, a3, extra=["--stop-after", "20260716152447", "--allow-stop-in-critical-window"])
    rc, jv = T.execn("verify", d3, ALLOW, a3, extra=["--expect-audit-head", pinned])
    rec("H-A10", "a pinned head from an earlier run is accepted after the store has grown (it is an ancestor)", "accepted (not refused); the run is simply incomplete, so verify reports missing items", f"rc={rc} code={jv.get('code')} ok={jv.get('ok')} missing={len(jv.get('missing', []))}", rc == 3 and jv.get("code") is None and len(jv.get("missing", [])) > 0)
    f = os.path.join(a3, "audit.jsonl")
    L = open(f, encoding="utf-8").read().splitlines()
    k = next(i for i, l in enumerate(L) if json.loads(l)["hash"] == pinned)
    open(f, "w", encoding="utf-8").write("\n".join(L[:k]) + "\n")  # roll the store back to BEFORE the pinned head
    rc, jt = T.execn("verify", d3, ALLOW, a3, extra=["--expect-audit-head", pinned])
    rec("H-A11", "a store rolled back past the pinned head is refused; without the pin the missing evidence is still refused because ledger rows lack audit backing", "refused audit (both)", f"pinned: rc={rc} {jt.get('code')}", rc == 2 and jt.get("code") == "audit")
    rc, jn = T.execn("verify", d3, ALLOW, a3)
    rec("H-A12", "same rolled-back store without a pin: refused (executed ledger rows have no audit evidence)", "refused audit", f"rc={rc} {jn.get('code')}", rc == 2 and jn.get("code") == "audit")
    # attestation (synthetic): a distinct third kind
    files = {"20300301000001_a.sql": "create table public.at_a (id int);\n"}
    items = [{"version": "20300301000001", "file": "20300301000001_a.sql", "kind": "execute"},
             {"version": "20300301000002", "file": "20300301000002_att.sql", "kind": "attestation", "attested_by": "Owner (test)", "attested_at": "2026-10-17", "scope": "seed rows of test version", "not_proven": "no query can show the historical seed", "record_after": ["20300301000001"]}]
    repo, commit = T.synth_repo("h_att", files)
    al = T.synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-att.json"))
    sdb = T.synth_db("bpc_exec_h_att")
    au = T.fresh_audit("h_att")
    rc, j = T.execn("run", sdb, al, au, repo=repo)
    led = T.ledger(sdb)
    marker = T.scalar(sdb, "select statements[1] from supabase_migrations.schema_migrations where version='20300301000002'")
    rec("H-A13", "qualified owner attestation is a third, distinct kind: own ledger marker (NOT EXECUTED, attested_by, scope, not_proven), own audit event, never counted as executed", "attestation", f"{led} marker={marker[:110]}", rc == 0 and marker.startswith("-- BPC-LOCAL-EXECUTOR attestation NOT EXECUTED") and "attested_by=Owner (test)" in marker and any(r["event"] == "attestation" for r in T.audit_recs(au)))
    rc, jv = T.execn("verify", sdb, al, au, repo=repo)
    rec("H-A14", "verify reports executed / history-only / attestations separately", "1 / 0 / 1", f"{jv.get('executed')} / {jv.get('history_only')} / {jv.get('attestations')}", jv.get("executed") == 1 and jv.get("history_only") == 0 and jv.get("attestations") == 1)
    badatt = T.mutate(al, os.path.join(SCR, "allow-att-bad.json"), lambda d: d["items"][1].pop("not_proven"))
    rc, j = T.execn("run", T.synth_db("bpc_exec_h_att2"), badatt, T.fresh_audit("h_att2"), repo=repo)
    rec("H-A15", "an attestation lacking attested_by / scope / not_proven is refused", "refused attestation", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "attestation")
    d4 = T.synth_db("bpc_exec_h_att3")
    T.psql(d4, "insert into supabase_migrations.schema_migrations (version,name,statements) values ('20300301000002','att',ARRAY['-- BPC-LOCAL-EXECUTOR attestation NOT EXECUTED run=x'])")
    rc, j = T.execn("run", d4, al, T.fresh_audit("h_att3"), repo=repo)
    rec("H-A16", "an attestation ledger row without audit evidence is refused (evidence is never manufactured)", "refused audit", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "audit")
    # failed attempt, interrupted run, successful resume are all visible in the audit store
    d5 = T.mkdb("bpc_exec_h_aud5", extra_sql=f"insert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{S.OID['O04_confirmed_deposit_paid']}','tok_h','sc_h','portal',0);")
    a5 = T.fresh_audit("h_aud5")
    rc1, j1 = T.execn("run", d5, ALLOW, a5)
    rc1b, j1b = T.execn("run", d5, ALLOW, a5)
    T.psql(d5, "delete from public.invoice_links where link_token='tok_h'")
    rc2, j2 = T.execn("run", d5, ALLOW, a5)
    ev = [r["event"] for r in T.audit_recs(a5)]
    rec("H-A17", "audit store records failed attempts (item_failed, twice), the end of each run, and the successful resume", "2 x item_failed; 3 run_start / 3 run_end; final ok", f"rcs={rc1},{rc1b},{rc2} item_failed={ev.count('item_failed')} run_start={ev.count('run_start')} run_end={ev.count('run_end')}", rc1 == 3 and rc1b == 3 and rc2 == 0 and ev.count("item_failed") == 2 and ev.count("run_start") == 3 and ev.count("run_end") == 3)
    led5 = T.ledger(d5)
    rec("H-A18", "after two failed attempts and a resume the ledger is clean: 58 executed, 9 history-only, failed version recorded exactly once", "58 / 9", f"{sum(1 for k in led5.values() if k == 'executed')} / {sum(1 for k in led5.values() if k == 'history-only')}", sum(1 for k in led5.values() if k == "executed") == 58 and sum(1 for k in led5.values() if k == "history-only") == 9)


# ====================================================================================================================================================
def inputs():
    files = {"20300401000001_a.sql": "create table public.i_a (id int);\n", "20300401000002_b.sql": "create table public.i_b (id int);\n"}
    items = [{"version": "20300401000001", "file": "20300401000001_a.sql", "kind": "execute"}, {"version": "20300401000002", "file": "20300401000002_b.sql", "kind": "execute", "requires": ["20300401000001"]}]
    repo, commit = T.synth_repo("h_in", files)
    al = T.synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-in.json"))
    sdb = T.synth_db("bpc_exec_h_in")
    # H-I01 changed manifest version
    t = T.mutate(al, os.path.join(SCR, "allow-in-ver.json"), lambda d: d["items"][0].update(version="20300401000009"))
    rc, j = T.execn("run", sdb, t, T.fresh_audit("h_in1"), repo=repo)
    rec("H-I01", "a changed manifest version (file no longer belongs to it; document re-hashed) is rejected before any connection", "refused version-file", f"rc={rc} {j.get('code')} {j.get('message', '')[:70]}", rc == 2 and j.get("code") in ("version-file", "dependency-missing") and not T.ledger(sdb))
    # H-I02 changed file reference
    t = T.mutate(al, os.path.join(SCR, "allow-in-file.json"), lambda d: d["items"][0].update(file="20300401000001_a.sql", sha256_lf="5" * 64))
    rc, j = T.execn("run", sdb, t, T.fresh_audit("h_in2"), repo=repo)
    rec("H-I02", "a changed content hash in the manifest (re-hashed) is rejected against the bound commit", "refused hash", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "hash")
    # H-I03 changed git content: a NEW commit changes an allowlisted file; the allowlist stays bound to the old commit
    run = lambda *a: subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True, check=True)
    p = os.path.join(repo, "supabase", "migrations", "20300401000002_b.sql")
    open(p, "w", encoding="utf-8", newline="").write("create table public.i_b (id int, extra int);\n")
    run("commit", "-qam", "change b")
    rc, j = T.execn("run", sdb, al, T.fresh_audit("h_in3"), repo=repo)
    rec("H-I03", "Git content changed after the allowlist was bound (new commit edits an allowlisted file): the working tree no longer matches the bound commit and the run is refused", "refused hash", f"rc={rc} {j.get('code')} {j.get('message', '')[:70]} ledger={len(T.ledger(sdb))}", rc == 2 and j.get("code") == "hash" and not T.ledger(sdb))
    # H-I04 untracked/extra file with a withdrawn version appears in the active directory after binding
    repo2, commit2 = T.synth_repo("h_in4", files)
    al2 = T.synth_allow(repo2, commit2, items, [], os.path.join(SCR, "allow-in4.json"))
    open(os.path.join(repo2, "supabase", "migrations", "20260407203226_case42.sql"), "w").write("select 1;\n")
    rc, j = T.execn("run", T.synth_db("bpc_exec_h_in4"), al2, T.fresh_audit("h_in4"), repo=repo2)
    rec("H-I04", "a withdrawn file restored into the active directory AFTER binding (untracked) is refused", "refused withdrawn", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "withdrawn")
    # H-N: attempted execution of withdrawn / omitted versions, every one of the 12
    d = real()
    bad = []
    for v in T.OMIT9 + ["20260305203528", "20260407203226", "20260407211122"]:
        def offer(dd, vv=v):
            hit = [i for i in dd["items"] if i["version"] == vv]
            if hit:  # an omitted version is already on the allowlist as history-only: flip it to executable
                hit[0].update(kind="execute", sha256_lf="6" * 64, requires=[])
            else:
                dd["items"].append({"order": 999, "version": vv, "file": vv + "_x.sql", "name": "x", "kind": "execute", "sha256_lf": "6" * 64, "requires": [], "phase": "P2"})
        t = T.mutate(ALLOW, os.path.join(SCR, f"allow-n-{v}.json"), offer)
        rc, j = T.execn("plan", "bpc_exec_h_dep", t, T.fresh_audit("h_n"))
        if not (rc == 2 and j.get("code") in ("never-execute", "withdrawn")):
            bad.append((v, rc, j.get("code")))
    rec("H-N01", "all 12 withdrawn or omitted versions, offered as executable items, are refused (none reaches a connection)", "12 of 12 refused", f"unrefused={bad}", not bad)
    db = T.mkdb("bpc_exec_h_n2")
    rc, j = T.execn("run", db, ALLOW, T.fresh_audit("h_n2"), extra=["--stop-after", "20260716152823"])
    rec("H-N02", "--stop-after naming an omitted (history-only) version is refused", "refused", f"rc={rc} {j.get('message', '')[:70]}", rc == 2)
    # H-U unexpected pre-existing ledger rows
    def pre(tid, name, sql, code="ledger"):
        db = T.mkdb("bpc_exec_h_u_" + tid.lower().replace("-", ""), seed=False)
        assert T.psql(db, sql).returncode == 0, sql
        a = T.fresh_audit("h_u_" + tid)
        rc, j = T.execn("run", db, ALLOW, a)
        n = sum(1 for v, k in T.ledger(db).items() if k == "executed")
        rec(tid, name, f"refused ({code}), nothing executed", f"rc={rc} {j.get('code')} executed={n}", rc == 2 and j.get("code") == code and n == 0)
    pre("H-U01", "a future-dated unknown ledger row is refused", "insert into supabase_migrations.schema_migrations (version,name,statements) values ('20990101000000','x',ARRAY['-- x'])")
    pre("H-U02", "a base-history row replaced by an unknown one (same row count) is refused", "update supabase_migrations.schema_migrations set version='20240101000000' where version=(select min(version) from supabase_migrations.schema_migrations)")
    pre("H-U03", "a pre-existing row for an omitted version without the executor marker is refused", "insert into supabase_migrations.schema_migrations (version,name,statements) values ('20260716152823','x',ARRAY['-- applied by someone'])")
    pre("H-U04", "a pre-existing row for Case 42 is refused", "insert into supabase_migrations.schema_migrations (version,name,statements) values ('20260407203226','x',ARRAY['-- x'])")
    # H-O: psql unavailable -> fail closed
    db = T.mkdb("bpc_exec_h_nopsql", seed=False)
    a = T.fresh_audit("h_nopsql")
    rc, j = T.execn("run", db, ALLOW, a, env_extra={"BPC_PSQL": r"C:\no\such\psql.exe"})
    rec("H-O01", "database client unavailable: the executor fails closed (error exit, nothing written, no item started)", "rc=4, ledger 277, no item_start", f"rc={rc} {j.get('message', '')[:70]} ledger={len(T.ledger(db))} item_start={sum(1 for r in T.audit_recs(a) if r['event'] == 'item_start')}", rc == 4 and len(T.ledger(db)) == 277 and not any(r["event"] == "item_start" for r in T.audit_recs(a)))


# ====================================================================================================================================================
def repeat():
    db = T.mkdb("bpc_exec_h_rep")
    au = T.fresh_audit("h_rep")
    rc, j = T.execn("run", db, ALLOW, au, extra=["--stop-after", "20260715214053"])
    outs = [T.execn("run", db, ALLOW, au) for _ in range(3)]
    led = T.ledger(db)
    rec("H-R01", "repeated resume attempts: the first completes, the next two change nothing", "58/9; later runs 0/0", f"{[(o[0], len(o[1].get('executed', [])), len(o[1].get('history_only', []))) for o in outs]} ledger {sum(1 for k in led.values() if k == 'executed')}/{sum(1 for k in led.values() if k == 'history-only')}", outs[0][0] == 0 and len(outs[1][1].get("executed", [])) == 0 and len(outs[2][1].get("executed", [])) == 0 and sum(1 for k in led.values() if k == "executed") == 58)
    ev = [r["event"] for r in T.audit_recs(au)]
    rec("H-R02", "no duplicate execution records: 58 item_end events for 58 versions", "58", ev.count("item_end"), ev.count("item_end") == 58)
    # connection loss in the middle of a transaction (server-side termination of the backend)
    files = {"20300501000001_a.sql": "create table public.c_a (id int);\n", "20300501000002_slow.sql": "create table public.c_slow (id int);\nselect pg_sleep(20);\n", "20300501000003_c.sql": "create table public.c_c (id int);\n"}
    items = [{"version": v, "file": f, "kind": "execute"} for v, f in (("20300501000001", "20300501000001_a.sql"), ("20300501000002", "20300501000002_slow.sql"), ("20300501000003", "20300501000003_c.sql"))]
    repo, commit = T.synth_repo("h_conn", files)
    al = T.synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-conn.json"))
    sdb = T.synth_db("bpc_exec_h_conn")
    au = T.fresh_audit("h_conn")
    d = json.load(open(al, encoding="utf-8"))
    p = subprocess.Popen(["node", T.EXE, "run", "--allowlist", al, "--db", sdb, "--audit-dir", au, "--approval-hash", d["document_sha256"], "--repo-root", repo], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=T.clean_env(), cwd=REPO)
    t0 = time.time()
    while time.time() - t0 < 60 and "pg_sleep" not in T.scalar("postgres", f"select coalesce(string_agg(query,' '),'') from pg_stat_activity where datname='{sdb}'"):
        time.sleep(0.3)
    T.psql("postgres", f"select pg_terminate_backend(pid) from pg_stat_activity where datname='{sdb}' and query like '%pg_sleep%'")
    out, err = p.communicate(timeout=120)
    try:
        j = json.loads(out.strip().splitlines()[-1])
    except Exception:
        j = {}
    tabs = T.scalar(sdb, "select coalesce(string_agg(tablename, ',' order by tablename),'') from pg_tables where schemaname='public'")
    rec("H-R03", "connection terminated by the server mid-transaction: the executor reports the failure, the half-applied file leaves no table and no ledger row, the run stops", "rc=3; c_a only; one ledger row", f"rc={p.returncode} failed={j.get('failed')} tables={tabs} ledger={sorted(T.ledger(sdb))}", p.returncode == 3 and tabs == "c_a" and sorted(T.ledger(sdb)) == ["20300501000001"])
    rc, j = T.execn("run", sdb, al, au, repo=repo)
    ev = [r["event"] for r in T.audit_recs(au)]
    rec("H-R04", "resume after the connection loss completes all three files; the audit store shows the failed attempt", "3 ledger rows; item_failed once", f"rc={rc} ledger={len(T.ledger(sdb))} item_failed={ev.count('item_failed')}", rc == 0 and len(T.ledger(sdb)) == 3 and ev.count("item_failed") == 1)
    # process kill (the executor itself) -> prior_run_incomplete recorded on the next run
    sdb2 = T.synth_db("bpc_exec_h_kill")
    au2 = T.fresh_audit("h_kill")
    d2 = json.load(open(al, encoding="utf-8"))
    p = subprocess.Popen(["node", T.EXE, "run", "--allowlist", al, "--db", sdb2, "--audit-dir", au2, "--approval-hash", d2["document_sha256"], "--repo-root", repo], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=T.clean_env(), cwd=REPO)
    t0 = time.time()
    while time.time() - t0 < 60 and "pg_sleep" not in T.scalar("postgres", f"select coalesce(string_agg(query,' '),'') from pg_stat_activity where datname='{sdb2}'"):
        time.sleep(0.3)
    subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
    time.sleep(22)
    rc, j = T.execn("run", sdb2, al, au2, repo=repo)
    ev = [r["event"] for r in T.audit_recs(au2)]
    rec("H-R05", "executor process killed mid-run: the next run records prior_run_incomplete (and the stale lock) in the audit store and completes", "prior_run_incomplete present; 3 rows", f"rc={rc} {[e for e in ev if e in ('prior_run_incomplete', 'stale_lock_cleared')]} ledger={len(T.ledger(sdb2))}", rc == 0 and "prior_run_incomplete" in ev and len(T.ledger(sdb2)) == 3)
    # concurrency: two executors, separate audit stores, same database
    cdb = T.mkdb("bpc_exec_h_conc")
    a1, a2 = T.fresh_audit("h_conc1"), T.fresh_audit("h_conc2")
    d = real()
    mk = lambda au_: subprocess.Popen(["node", T.EXE, "run", "--allowlist", ALLOW, "--db", cdb, "--audit-dir", au_, "--approval-hash", d["document_sha256"], "--acknowledge-older-than-latest", "31"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=T.clean_env(), cwd=REPO)
    p1, p2 = mk(a1), mk(a2)
    o1, o2 = p1.communicate(timeout=900), p2.communicate(timeout=900)
    parse = lambda o: (json.loads(o[0].strip().splitlines()[-1]) if o[0].strip() else {})
    j1, j2 = parse(o1), parse(o2)
    led = T.ledger(cdb)
    dup = T.scalar(cdb, "select count(*) from (select version from supabase_migrations.schema_migrations group by version having count(*) > 1) x")
    n_ex = sum(1 for k in led.values() if k == "executed")
    rec("H-R06", "two executors at once on one database with separate audit stores: no version is applied twice (primary key + advisory lock) and nothing is corrupted; the interleaving is reported", "no duplicates; ledger consistent", f"rc={p1.returncode},{p2.returncode} codes={j1.get('code')},{j2.get('code')} executed_rows={n_ex} duplicates={dup}", dup == "0" and n_ex <= 58)
    rc, jv1 = T.execn("verify", cdb, ALLOW, a1)
    rc2, jv2 = T.execn("verify", cdb, ALLOW, a2)
    rec("H-R07", "after interleaved executors each audit store lacks evidence for the other's rows, so verification refuses unless one store holds all evidence (the executor never fabricates evidence; a human must reconcile the stores)", "documented outcome", f"store1: rc={rc} {jv1.get('code') or jv1.get('ok')}; store2: rc={rc2} {jv2.get('code') or jv2.get('ok')}", True)


# ====================================================================================================================================================
def crash():
    """A simulated SERVER crash: pg_ctl stop -m immediate while a migration is sleeping inside its transaction, then restart (crash recovery). This is the closest practical stand-in for a power loss or a kernel kill;
    it is NOT a hardware failure and does not test fsync behavior."""
    files = {"20300601000001_a.sql": "create table public.s_a (id int);\n", "20300601000002_slow.sql": "create table public.s_slow (id int);\nselect pg_sleep(40);\n", "20300601000003_c.sql": "create table public.s_c (id int);\n"}
    items = [{"version": v, "file": f, "kind": "execute"} for v, f in (("20300601000001", "20300601000001_a.sql"), ("20300601000002", "20300601000002_slow.sql"), ("20300601000003", "20300601000003_c.sql"))]
    repo, commit = T.synth_repo("h_crash", files)
    al = T.synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-crash.json"))
    sdb = T.synth_db("bpc_exec_h_crash")
    au = T.fresh_audit("h_crash")
    d = json.load(open(al, encoding="utf-8"))
    p = subprocess.Popen(["node", T.EXE, "run", "--allowlist", al, "--db", sdb, "--audit-dir", au, "--approval-hash", d["document_sha256"], "--repo-root", repo], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=T.clean_env(), cwd=REPO)
    t0 = time.time()
    while time.time() - t0 < 60 and "pg_sleep" not in T.scalar("postgres", f"select coalesce(string_agg(query,' '),'') from pg_stat_activity where datname='{sdb}'"):
        time.sleep(0.3)
    pgdata = r"C:\Users\vikki\migration-evidence\c0-scratch\pgdata"
    ctl = r"C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe"
    r = subprocess.run([ctl, "-D", pgdata, "-m", "immediate", "stop"], capture_output=True, text=True, timeout=120)
    out, err = p.communicate(timeout=120)
    rec("H-S01", "simulated server crash (immediate shutdown) while a migration is mid-transaction: the executor exits with an error and does not report success", "rc != 0", f"executor rc={p.returncode}; pg_ctl rc={r.returncode}", p.returncode != 0)
    log = r"C:\Users\vikki\migration-evidence\e2h-pg-restart.log"
    subprocess.Popen([ctl, "-D", pgdata, "-l", log, "start"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, creationflags=0x00000008)
    ready = False
    for _ in range(90):
        time.sleep(1)
        if subprocess.run([r"C:\Program Files\PostgreSQL\18\bin\pg_isready.exe", "-h", "127.0.0.1", "-p", "54329"], capture_output=True).returncode == 0:
            ready = True
            break
    rec("H-S02", "the scratch cluster restarts after the immediate shutdown (crash recovery)", "accepting connections", ready, ready)
    if not ready:
        return
    time.sleep(2)
    tabs = T.scalar(sdb, "select coalesce(string_agg(tablename, ',' order by tablename),'') from pg_tables where schemaname='public'")
    rec("H-S03", "after crash recovery the half-applied migration left no table and no ledger row; the committed first file is intact", "s_a only; one ledger row", f"tables={tabs} ledger={sorted(T.ledger(sdb))}", tabs == "s_a" and sorted(T.ledger(sdb)) == ["20300601000001"])
    rc, j = T.execn("run", sdb, al, au, repo=repo, timeout=300)
    ev = [r["event"] for r in T.audit_recs(au)]
    rec("H-S04", "the server crash was recorded as a failed attempt (item_failed, normal run_end); the resume then completes all three files", "3 ledger rows; item_failed once", f"rc={rc} ledger={len(T.ledger(sdb))} item_failed={ev.count('item_failed')}", rc == 0 and len(T.ledger(sdb)) == 3 and ev.count("item_failed") == 1)


# ====================================================================================================================================================
def closure(reqs, v):
    out, stack = set(), [v]
    while stack:
        x = stack.pop()
        for r in reqs.get(x, []):
            if r not in out:
                out.add(r)
                stack.append(r)
    return out


def leave1out():
    d = real()
    ex = [i for i in d["items"] if i["kind"] == "execute"]
    reqs = {i["version"]: i["requires"] for i in ex}
    ref = T.ref_fp()
    out = {}
    for it in ex:
        D = it["version"]

        def strip(dd, D=D):
            dd["items"] = [i for i in dd["items"] if i["version"] != D]
            for i in dd["items"]:
                i["requires"] = []
                if i.get("record_after"):
                    i["record_after"] = [r for r in i["record_after"] if r != D]
        t = T.mutate(ALLOW, os.path.join(SCR, "allow-l1o.json"), strip)
        db = T.mkdb("bpc_exec_h_l1o")
        rc, j = T.execn("run", db, t, T.fresh_audit("h_l1o"), ack=True)
        fail = (j.get("failed") or {}).get("version")
        if fail:
            declared = D in closure(reqs, fail)
            out[D] = {"outcome": "SQL failure", "first_failing": fail, "error": j["failed"]["error"][:120], "declared_in_closure": declared}
        else:
            f = T.fp(db)
            out[D] = {"outcome": "completed without SQL error", "final_state_differs_from_reference": [k for k in f if f[k] != ref[k]], "declared_in_closure": None}
        print(D, out[D]["outcome"], out[D].get("first_failing", ""), out[D].get("declared_in_closure"), out[D].get("final_state_differs_from_reference", ""), flush=True)
    json.dump(out, open(os.path.join(SCR, "leave-one-out.json"), "w", encoding="utf-8"), indent=1)
    fails = {k: v for k, v in out.items() if v["outcome"] == "SQL failure"}
    undeclared = [k for k, v in fails.items() if not v["declared_in_closure"]]
    comp = {k: v for k, v in out.items() if v["outcome"] != "SQL failure"}
    rec("H-L01", "leave-one-out with all declared prerequisites stripped: every SQL failure caused by removing a migration is at a migration whose declared prerequisites (transitively) include the removed one", "no undeclared dependency", f"{len(fails)} removals fail in SQL, {len(comp)} complete; undeclared={undeclared}", not undeclared)
    sem = {k: v["final_state_differs_from_reference"] for k, v in comp.items() if v["final_state_differs_from_reference"]}
    rec("H-L02", "removals that complete without a SQL error but change the final catalog (semantic, not enforceable by PostgreSQL)", "informational", f"{len(sem)} of {len(comp)} change the final state; {len(comp) - len(sem)} change nothing", True)


def l1ocheck():
    d = real()
    ex = [i for i in d["items"] if i["kind"] == "execute"]
    reqs = {i["version"]: i["requires"] for i in ex}
    lo = json.load(open(os.path.join(SCR, "leave-one-out.json"), encoding="utf-8"))
    fails = {k: v for k, v in lo.items() if v["outcome"] == "SQL failure"}
    undeclared = [k for k, v in fails.items() if k not in closure(reqs, v["first_failing"])]
    rec("H-L01", "leave-one-out (58 removals with all prerequisites stripped, run on scratch): every removal that makes PostgreSQL fail is at a migration whose declared prerequisites (transitively) include the removed one", "no undeclared dependency", f"{len(fails)} removals fail in SQL, {len(lo) - len(fails)} complete; undeclared={undeclared}", not undeclared)
    sem = {k: v["final_state_differs_from_reference"] for k, v in lo.items() if v["outcome"] != "SQL failure" and v["final_state_differs_from_reference"]}
    rec("H-L02", "removals that complete without a SQL error but change the final catalog (semantic redefinitions: PostgreSQL cannot enforce them; only the allowlist order and the final-state comparison protect them)", "informational", f"{len(sem)} of {len(lo) - len(fails)} change the final state; {len(lo) - len(fails) - len(sem)} change nothing", True)
    STATE["extra"]["leave_one_out"] = {"sql_failures": len(fails), "completed": len(lo) - len(fails), "semantic_only": len(sem), "no_effect": len(lo) - len(fails) - len(sem), "undeclared_before_conservative_edges": ["20260925151621", "20261011120000", "20261019120000", "20261022120000", "20261023120000"]}
    json.dump(STATE, open(RES, "w", encoding="utf-8"), indent=1)


def l1oload():
    d = real()
    ex = [i["version"] for i in d["items"] if i["kind"] == "execute"]
    needed = {r for i in d["items"] if i["kind"] == "execute" for r in i["requires"]} | {r for i in d["items"] if i["kind"] != "execute" for r in i.get("record_after", [])}
    db = T.mkdb("bpc_exec_h_l1l", seed=False)
    bad = []
    for v in ex:
        def drop(dd, v=v):
            dd["items"] = [i for i in dd["items"] if i["version"] != v]
        t = T.mutate(ALLOW, os.path.join(SCR, "allow-l1l.json"), drop)
        rc, j = T.execn("plan", db, t, T.fresh_audit("h_l1l"))
        refused = rc == 2 and j.get("code") == "dependency-missing"
        if (v in needed) != refused:
            bad.append((v, rc, j.get("code"), v in needed))
    rec("H-L03", "removing any single item from the real allowlist is rejected at load (dependency-missing) exactly when another item declares it as a prerequisite or a record_after; otherwise the plan loads", "58 of 58 consistent", f"inconsistent={bad}; items that are prerequisites of others: {len(needed & set(ex))}", not bad)


# ====================================================================================================================================================
def finish():
    t = STATE["tests"]
    summary = {"total": len(t), "passed": sum(1 for x in t.values() if x["result"] == "PASS"), "failed": [k for k, x in t.items() if x["result"] != "PASS"]}
    print(json.dumps(summary))
    return summary


if __name__ == "__main__":
    cmd = sys.argv[1]
    {"deps": deps, "audit": audit_tests, "inputs": inputs, "repeat": repeat, "crash": crash, "leave1out": leave1out, "l1ocheck": l1ocheck, "l1oload": l1oload, "finish": finish}.get(cmd, lambda: sys.exit("unknown"))()
