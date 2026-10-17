"""Stage E2D supplementary LOCAL tests for the 58-version candidate (disposable scratch PostgreSQL only; synthetic data only; no hosted system):
  fin   differential invocation of financial functions on the completed D4 A1 database of the 67-version run and of the 58-version run
  sec   per-migration security/permission probes on both paths, including actual anonymous-role INSERT attempts on invoice_links
  hist  a MODEL executor (exact allowlist + sha256, withdrawn/unknown refusal, ledger kinds) with interruption/resumption and history-only recording
Usage: python -I e2d_extra.py <fin|sec|hist>.  Results go to the protected scratch folder C:\\Users\\vikki\\migration-evidence\\e2d-scratch."""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402

OUT = r"C:\Users\vikki\migration-evidence\e2d-scratch"
os.makedirs(OUT, exist_ok=True)
OMIT9 = ["20260715221828", "20260716104333", "20261010110000", "20260716151530", "20260716152823", "20260716173644", "20260717111737", "20260717113131", "20260814114825"]
SUPERSEDERS = {"20260716151530": ["20260716152447"], "20260716152823": ["20260717012112", "20260717110808"], "20260716173644": ["20260820165646"],
               "20260717111737": ["20260717111803"], "20260717113131": ["20260717115647"], "20260814114825": ["20260814120100"]}
WITHDRAWN = ["20260305203528", "20260407203226", "20260407211122"]
SEED_MASTER = S.U_MASTER
UUID = re.compile(r"\b(?!d4[0-9a-f]{6}-)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
TS = re.compile(r"\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d(:\d\d)?)?")


def all_rows():
    return L.verify_upgrade_set()


def rows58():
    return [r for r in all_rows() if r["version"] not in OMIT9]


def norm(s):
    return TS.sub("<ts>", UUID.sub("<uuid>", s or ""))


def prep(db):
    L.clone(L.TEMPLATE, db)
    assert L.sql(db, S.users_and_roles()).returncode == 0
    assert L.sql(db, S.commerce()).returncode == 0


# --------------------------------------------------------------------------------------------------------------------------------------------
def fin():
    M = SEED_MASTER
    calls = []
    for key, oid in S.OID.items():
        calls.append((f"order_net_financials({key})", f"select public.order_net_financials('{oid}')::text"))
        calls.append((f"order_refund_overview({key})", f"select public.order_refund_overview('{oid}')::text"))
        calls.append((f"payment_deposit_principal_state({key})", f"select public.payment_deposit_principal_state('{oid}')::text"))
    o4, o5, o6, o8, o12 = (S.OID[k] for k in ("O04_confirmed_deposit_paid", "O05_confirmed_paid_in_full", "O06_confirmed_check", "O08_confirmed_partial_refund", "O12_failed_then_retry"))
    calls += [
        ("record_cash_payment(O06, 1000)", f"select public.record_cash_payment('{o6}', 1000, 0, '{M}')::text"),
        ("record_cash_payment(O06, 1000, tip 250)", f"select public.record_cash_payment('{o6}', 1000, 250, '{M}')::text"),
        ("record_cash_payment(O04, exceeds balance)", f"select public.record_cash_payment('{o4}', 99999999, 0, '{M}')::text"),
        ("record_check_payment(O06, 1000)", f"select public.record_check_payment('{o6}', 1000, 0, '{M}', 'chk-e2d-1')::text"),
        ("record_offline_payment(O04, cash 2000)", f"select public.record_offline_payment('{o4}', 2000, 0, '{M}', 'cash', null)::text"),
        ("record_offline_payment(O05 paid in full, 1000)", f"select public.record_offline_payment('{o5}', 1000, 0, '{M}', 'cash', null)::text"),
        ("claim_payment_operation(O04 balance 1000)", f"select public.claim_payment_operation('{o4}','balance','admin','{S.uid(77, '09')}',false,1000,0,null,300)::text"),
        ("claim_payment_operation(O12 deposit)", f"select public.claim_payment_operation('{o12}','deposit','admin','{S.uid(78, '09')}',true,null,0,null,300)::text"),
        ("reserve_refund_operation(O08 500)", f"select public.reserve_refund_operation('{o8}','op-e2d-1',500,'e2d test','{M}')::text"),
        ("reserve_refund_operation(O05 500)", f"select public.reserve_refund_operation('{o5}','op-e2d-2',500,'e2d test','{M}')::text"),
        ("increment_order_refunded_cents(O08, 100)", f"select public.increment_order_refunded_cents('{o8}', 100)::text"),
    ]
    results = {}
    for name, db in (("v67", "bpc_replay_d4_a1"), ("v58", "bpc_replay_e2d_a1")):
        res = {}
        for label, sql in calls:
            t = f"begin;\nselect set_config('request.jwt.claim.sub','{M}',true);\n{sql};\nrollback;\n"
            r = L.psql(db, ["-At", "-v", "ON_ERROR_STOP=1"], text=t)
            lines = [ln for ln in r.stdout.splitlines() if ln.strip() and ln.strip() not in ("BEGIN", "ROLLBACK", M)]
            res[label] = {"ok": r.returncode == 0, "output": norm(lines[-1] if lines else ""), "error": norm(L.err1(r.stderr))}
        results[name] = res
        print(name, "invoked", len(res), "ok", sum(1 for v in res.values() if v["ok"]), flush=True)
    diffs = [k for k in results["v67"] if results["v67"][k] != results["v58"][k]]
    out = {"calls": [c[0] for c in calls], "invoked": len(calls), "succeeded_67": sum(v["ok"] for v in results["v67"].values()), "succeeded_58": sum(v["ok"] for v in results["v58"].values()),
           "identical_outcomes": len(calls) - len(diffs), "differences": diffs, "results": results,
           "note": "functions not listed here (for example finalize_payment_operation, apply_provider_refund_event, reserve_refund_allocation, apply_balance_payment_financials) were NOT invoked"}
    json.dump(out, open(os.path.join(OUT, "e2d-financial-rpcs.json"), "w", encoding="utf-8"), indent=1)
    print("identical", out["identical_outcomes"], "of", len(calls), "differences", diffs)


# --------------------------------------------------------------------------------------------------------------------------------------------
PROBE = """select json_build_object(
 'anon_exec_public_functions', (select coalesce(json_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]'::json) from pg_proc p where p.pronamespace='public'::regnamespace and has_function_privilege('anon',p.oid,'EXECUTE')),
 'anon_write_tables', (select coalesce(json_agg(c.relname||case when c.relrowsecurity then ':rls' else ':NO-RLS' end order by c.relname),'[]'::json) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE') or has_table_privilege('anon',c.oid,'DELETE'))),
 'anon_or_public_policies', (select coalesce(json_agg(p.tablename||'.'||p.policyname||':'||p.cmd order by p.tablename,p.policyname),'[]'::json) from pg_policies p where p.schemaname='public' and (p.roles && array['anon','public']::name[])),
 'default_acls', (select coalesce(json_agg(d.defaclrole::regrole::text||':'||d.defaclobjtype::text||':'||d.defaclacl::text order by d.defaclrole::regrole::text,d.defaclobjtype::text),'[]'::json) from pg_default_acl d where d.defaclnamespace in (0,'public'::regnamespace)),
 'security_definer_anon_exec', (select coalesce(json_agg(p.proname order by p.proname),'[]'::json) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE')))"""


def anon_insert(db, tag):
    oid = S.OID["O04_confirmed_deposit_paid"]
    t = f"begin;\nset local role anon;\ninsert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{oid}', 'tok_e2d_{tag}', 'sc_e2d_{tag}', 'portal_shortlink', 0);\nrollback;\n"
    r = L.psql(db, ["-v", "ON_ERROR_STOP=1"], text=t)
    return "ACCEPTED" if r.returncode == 0 else "REJECTED"


def sec():
    paths = {"p58": rows58(), "p67": all_rows()}
    data = {}
    for name, rows in paths.items():
        db = f"bpc_replay_e2d_sec_{name}"
        prep(db)
        steps = {}
        steps["(start)"] = {"probe": json.loads(L.q(db, PROBE)), "anon_insert_invoice_links": anon_insert(db, "s0")}
        for r in rows:
            res = L.run_migrations(db, rows=[r])
            assert res[0]["status"] == "applied", res
            steps[r["version"]] = {"probe": json.loads(L.q(db, PROBE)), "anon_insert_invoice_links": anon_insert(db, r["version"][-6:])}
        data[name] = steps
        accepted = [v for v, s in steps.items() if s["anon_insert_invoice_links"] == "ACCEPTED"]
        print(name, "steps", len(steps), "anon insert ACCEPTED at:", accepted, flush=True)
    shared = [v for v in data["p58"] if v in data["p67"]]
    diffs = []
    for v in shared:
        a, b = data["p58"][v]["probe"], data["p67"][v]["probe"]
        keys = [k for k in a if a[k] != b[k]]
        if keys or data["p58"][v]["anon_insert_invoice_links"] != data["p67"][v]["anon_insert_invoice_links"]:
            diffs.append({"after": v, "differing_probe_keys": keys, "detail": {k: {"p58_only": sorted(set(a[k]) - set(b[k])), "p67_only": sorted(set(b[k]) - set(a[k]))} for k in keys}})
    fin58, fin67 = data["p58"]["20261025120000"]["probe"], data["p67"]["20261025120000"]["probe"]
    summary = {"steps_p58": len(data["p58"]) - 1, "steps_p67": len(data["p67"]) - 1,
               "anon_insert_accepted_p58": [v for v, s in data["p58"].items() if s["anon_insert_invoice_links"] == "ACCEPTED"],
               "anon_insert_accepted_p67": [v for v, s in data["p67"].items() if s["anon_insert_invoice_links"] == "ACCEPTED"],
               "shared_stop_points_compared": len(shared), "shared_stop_points_with_security_probe_differences": diffs, "final_probes_equal": fin58 == fin67,
               "final_state": fin58}
    json.dump({"summary": summary, "steps": data}, open(os.path.join(OUT, "e2d-security.json"), "w", encoding="utf-8"), indent=1)
    print("shared", len(shared), "with differences", len(diffs), "final equal", fin58 == fin67)
    for d in diffs:
        print(" ", d["after"], d["differing_probe_keys"], json.dumps(d["detail"])[:300])


# --------------------------------------------------------------------------------------------------------------------------------------------
class Executor:
    """MODEL of the future migration executor (requirements in e2d-executor-requirements.md). It runs only against a local scratch database."""

    def __init__(self, db, allow):
        self.db, self.allow = db, allow  # allow: ordered list of {version,file,sha256}
        self.by_version = {a["version"]: a for a in allow}

    def ledger(self):
        out = {}
        for ln in L.q(self.db, "select version||'|'||coalesce(statements[1],'') from supabase_migrations.schema_migrations").splitlines():
            v, _, m = ln.partition("|")
            out[v] = m
        return out

    @staticmethod
    def kind(marker):
        if marker.startswith("-- E2D EXECUTED"):
            return "executed"
        if marker.startswith("-- E2D HISTORY-ONLY"):
            return "history-only"
        return "other"

    def refuse(self, requested):
        for v in requested:
            if v in WITHDRAWN:
                return f"refused: {v} is withdrawn"
            if v not in self.by_version and v not in OMIT9:
                return f"refused: {v} is not on the allowlist"
        return None

    def check_hash(self, a, data=None):
        data = data if data is not None else open(os.path.join(L.MIG, a["file"]), "rb").read()
        return hashlib.sha256(data).hexdigest() == a["sha256"]

    def record_exec(self, a):
        L.q(self.db, "insert into supabase_migrations.schema_migrations (version,name,statements) values ('%s','%s',ARRAY['-- E2D EXECUTED (local scratch); allowlist sha256 %s'])" % (a["version"], a["file"][15:-4].replace("'", "''"), a["sha256"]))

    def eligible_records(self, led):
        """Omitted versions whose recording is TRUE now (precondition checked against the ledger and the catalog)."""
        out = []
        for v in OMIT9:
            if v in led:
                continue
            if v in SUPERSEDERS:
                if all(s in led and self.kind(led[s]) == "executed" for s in SUPERSEDERS[v]):
                    out.append((v, "superseded by " + ", ".join(SUPERSEDERS[v])))
            elif v == "20260715221828" or v == "20260716104333":
                absent = L.q(self.db, "select count(*) from pg_policy where polrelid='public.invoice_links'::regclass and polname='Anon can insert portal shortlinks'") == "0"
                if absent:
                    out.append((v, "net-zero pair: policy absent in this database"))
            elif v == "20261010110000":
                if L.q(self.db, "select count(*) from information_schema.columns where table_schema='public' and table_name='orders' and column_name='customer_approved_at'") == "1":
                    out.append((v, "column orders.customer_approved_at already exists"))
        return out

    def record_hist(self, v, basis):
        name = {r["version"]: r["file"] for r in all_rows()}[v][15:-4]
        L.q(self.db, "insert into supabase_migrations.schema_migrations (version,name,statements) values ('%s','%s',ARRAY['-- E2D HISTORY-ONLY (local scratch): NOT EXECUTED; basis=%s'])" % (v, name.replace("'", "''"), basis))

    def validate(self, led):
        """Ledger consistency against the allowlist: an execute item may only be 'executed', an omitted item only 'history-only', nothing withdrawn or unknown may carry an E2D marker."""
        for v, m in led.items():
            k = self.kind(m)
            if k == "other":
                continue
            if v in WITHDRAWN:
                raise RuntimeError(f"ledger has a row for withdrawn version {v}")
            if v in self.by_version and k != "executed":
                raise RuntimeError(f"ledger marks executable version {v} as {k}")
            if v in OMIT9 and k != "history-only":
                raise RuntimeError(f"ledger marks omitted version {v} as {k}")
            if v not in self.by_version and v not in OMIT9:
                raise RuntimeError(f"ledger has an E2D row for unknown version {v}")

    def run(self, until=None, crash_before_record=False):
        log = []
        while True:
            led = self.ledger()
            self.validate(led)
            if not crash_before_record:
                for v, basis in self.eligible_records(led):
                    self.record_hist(v, basis)
                    log.append(("history-only", v))
                led = self.ledger()
            nxt = next((a for a in self.allow if a["version"] not in led), None)
            if nxt is None or (until and nxt["version"] > until):
                return log
            assert self.check_hash(nxt), "hash mismatch " + nxt["version"]
            res = L.run_migrations(self.db, rows=[nxt], record_history=False)
            if res[0]["status"] != "applied":
                log.append(("FAILED", nxt["version"], res[0].get("error")))
                return log
            self.record_exec(nxt)
            log.append(("executed", nxt["version"]))


def hist():
    allow = rows58()
    ref = {}
    # reference: uninterrupted executor run
    db = "bpc_replay_e2d_h_ref"
    prep(db)
    ex = Executor(db, allow)
    log = ex.run()
    ref["fp"] = L.fingerprint(db)
    led = ex.ledger()
    kinds = {}
    for v, m in led.items():
        kinds[Executor.kind(m)] = kinds.get(Executor.kind(m), 0) + 1
    ref["ledger_kinds"] = kinds
    ref["executed_by_executor"] = sum(1 for e in log if e[0] == "executed")
    ref["history_only_by_executor"] = [e[1] for e in log if e[0] == "history-only"]
    ref["omitted_never_executed"] = all(Executor.kind(led.get(v, "")) != "executed" for v in OMIT9)
    ref["all_omitted_recorded_history_only"] = all(Executor.kind(led.get(v, "")) == "history-only" for v in OMIT9)
    ref["order_of_history_only_records"] = ref["history_only_by_executor"]
    print("reference run:", ref["ledger_kinds"], "omitted never executed:", ref["omitted_never_executed"], flush=True)
    results = []
    stops = ["20260716151549", "20260716152447", "20260717012112", "20260717110808", "20260717111803", "20260717115647", "20260814120100", "20260820165646", "20261010120000"]
    for stop in stops:
        for crash in (False, True):
            db = "bpc_replay_e2d_h_run"
            prep(db)
            ex = Executor(db, allow)
            ex.run(until=stop)
            if crash:
                # simulate a crash right after the last executed migration, before any history-only record for it is written
                pass
            ex2 = Executor(db, allow)
            led_mid = ex2.ledger()
            # a record that claims "superseded by X" must never exist before X is executed
            premature = [v for v, m in led_mid.items() if v in SUPERSEDERS and Executor.kind(m) == "history-only" and not all(s in led_mid and Executor.kind(led_mid[s]) == "executed" for s in SUPERSEDERS[v])]
            if crash:
                # crash model: drop the history-only rows written after the last execution, then resume with a FRESH executor
                L.q(db, "delete from supabase_migrations.schema_migrations where statements[1] like '-- E2D HISTORY-ONLY%%' and version = any (array['%s'])" % "','".join(v for v in SUPERSEDERS))
            log2 = Executor(db, allow).run()
            fp = L.fingerprint(db)
            led = Executor(db, allow).ledger()
            executed = sorted(v for v, m in led.items() if Executor.kind(m) == "executed")
            rec = {"stop_after": stop, "history_rows_dropped_to_simulate_crash": crash, "premature_superseded_records": premature, "final_equals_uninterrupted_58": fp == ref["fp"],
                   "executed_by_resume": sum(1 for e in log2 if e[0] == "executed"), "omitted_executed_by_resume": [e[1] for e in log2 if e[0] == "executed" and e[1] in OMIT9], "failed": [e for e in log2 if e[0] == "FAILED"],
                   "ledger_executed_rows": len(executed), "ledger_history_only_rows": sum(1 for m in led.values() if Executor.kind(m) == "history-only")}
            results.append(rec)
            print(json.dumps(rec), flush=True)
    # refusals (pure logic)
    ex = Executor("bpc_replay_e2d_h_ref", allow)
    ref_logic = {"refuse_withdrawn_case41": ex.refuse(["20260305203528"]), "refuse_withdrawn_case42": ex.refuse(["20260407203226"]), "refuse_withdrawn_case43": ex.refuse(["20260407211122"]),
                 "refuse_unknown_version": ex.refuse(["20260101000000"]), "accept_allowlisted": ex.refuse(["20260722172048"]),
                 "hash_mismatch_detected": not ex.check_hash(allow[0], open(os.path.join(L.MIG, allow[0]["file"]), "rb").read() + b" "),
                 "hash_match_ok": ex.check_hash(allow[0]),
                 "older_than_latest_recorded_not_blocked": sum(1 for a in allow if a["version"] < "20260928172217")}
    # recorded-but-not-executed distinguishability
    audit = L.q("bpc_replay_e2d_h_ref", "select version, case when statements[1] like '-- E2D EXECUTED%' then 'executed' when statements[1] like '-- E2D HISTORY-ONLY%' then 'history-only' else 'captured/simulated' end from supabase_migrations.schema_migrations where version = any(array['20260715221828','20260716152823','20260716151530','20260722172048','20261025120000','20260814114825'])")
    json.dump({"reference": ref, "resume_tests": results, "refusal_logic": ref_logic, "audit_sample": audit.splitlines()}, open(os.path.join(OUT, "e2d-history.json"), "w", encoding="utf-8"), indent=1)
    print("refusal logic:", json.dumps(ref_logic))
    print("audit sample:", audit.replace("\n", " ; "))


def txscan():
    """Static scan of the 58 allowlisted files for top-level transaction control and non-transactional statements (comments and dollar-quoted bodies removed)."""
    out = {"files": 0, "top_level_transaction_control": [], "non_transactional_statements": [], "create_extension": []}
    for r in rows58():
        t = open(os.path.join(L.MIG, r["file"]), encoding="utf-8").read()
        t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
        t = re.sub(r"--[^\n]*", "", t)
        t = re.sub(r"\$([A-Za-z_]*)\$.*?\$\1\$", "$$X$$", t, flags=re.S)
        out["files"] += 1
        if re.search(r"(?im)^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END)\s*;", t):
            out["top_level_transaction_control"].append(r["version"])
        if re.search(r"(?i)CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY|VACUUM|ALTER\s+SYSTEM|CREATE\s+DATABASE|DROP\s+DATABASE", t):
            out["non_transactional_statements"].append(r["version"])
        if re.search(r"(?i)CREATE\s+EXTENSION", t):
            out["create_extension"].append(r["version"])
    json.dump(out, open(os.path.join(OUT, "e2d-txscan.json"), "w", encoding="utf-8"), indent=1)
    print(out)


def guards():
    """The executor model refuses an inconsistent ledger instead of silently skipping work."""
    allow = rows58()
    out = {}
    cases = {
        "history_only_row_for_executable_version_20260722172048": ("20260722172048", "-- E2D HISTORY-ONLY (local scratch): NOT EXECUTED; basis=tamper"),
        "executed_row_for_omitted_version_20260716152823": ("20260716152823", "-- E2D EXECUTED (local scratch); allowlist sha256 x"),
        "row_for_withdrawn_case41": ("20260305203528", "-- E2D HISTORY-ONLY (local scratch): NOT EXECUTED; basis=tamper"),
        "row_for_unknown_version": ("20260101000000", "-- E2D EXECUTED (local scratch); allowlist sha256 x"),
    }
    for label, (v, marker) in cases.items():
        db = "bpc_replay_e2d_guard"
        prep(db)
        L.q(db, "insert into supabase_migrations.schema_migrations (version,name,statements) values ('%s','tamper',ARRAY['%s']) on conflict (version) do update set statements = excluded.statements" % (v, marker))
        try:
            Executor(db, allow).run(until="20260716151458")
            out[label] = "NOT REFUSED"
        except RuntimeError as e:
            out[label] = "refused: " + str(e)
        print(label, "=>", out[label], flush=True)
    json.dump(out, open(os.path.join(OUT, "e2d-guards.json"), "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    {"fin": fin, "sec": sec, "hist": hist, "txscan": txscan, "guards": guards}[sys.argv[1]]()
