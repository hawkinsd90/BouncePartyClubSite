"""Per-item local rehearsal of the PRODUCTION 58-execute / 9-history-only plan with the unmodified local executor on a scratch clone of the restored pre-upgrade Production schema (synthetic data; loopback 127.0.0.1:54329).
For every executable item, in allowlist order: evaluate the candidate pre-state atoms, run the executor with --stop-after that item, evaluate the post-state atoms, fingerprint the financial columns that existed at the start,
and probe the anonymous surface. Atoms that behave as expected become that item's pre/post rules (production-verification-rules.json is built from them).
Prerequisites: scratch PostgreSQL running; e2g_executor_tests.py setup already run (bpc_exec_template, allowlist-prod58.json); build_production_plan.py candidates already run.
Usage: python -I rehearse_production_plan.py"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import e2d_extra as X  # noqa: E402
import e2g_executor_tests as G  # noqa: E402
from step2_paths import derived, workdir  # noqa: E402

SCR = workdir()
OUT = os.path.join(G.REPO, "audit", "evidence", "production-plan-rehearsal-results.json")
cand = json.load(open(os.path.join(SCR, "prod-candidates.json"), encoding="utf-8"))
allow = json.load(open(G.ALLOW, encoding="utf-8"))
order = [i["version"] for i in allow["items"] if i["kind"] == "execute"]
assert len(order) == 58 and sum(1 for i in allow["items"] if i["kind"] == "history-only") == 9
db = G.mkdb("bpc_exec_prodstep")
au = G.fresh_audit("prodstep")
q = lambda sql: G.scalar(db, sql)
FIN = ["orders", "payments", "order_items", "invoices", "transaction_receipts", "order_discounts", "order_custom_fees"]
fin_cols = {}
for t in FIN:
    cols = q(f"select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='{t}' and (column_name like '%cents%' or column_name in ('id','status','order_id','payment_id','type','paid_at'))")
    if cols:
        fin_cols[t] = cols.split(",")


def fin_fp():
    out = {}
    for t, cols in fin_cols.items():
        sel = ",".join(f'"{c}"' for c in cols)
        out[t] = q(f'select count(*)||\':\'||md5(coalesce(string_agg(r::text, \'|\' order by r::text), \'\')) from (select {sel} from public."{t}") r')
    return out


def ev(atom):
    r = G.psql(db, f"select ({atom})", True)
    return r.stdout.strip() == "t" if r.returncode == 0 else None


def probe():
    p = json.loads(q(X.PROBE))
    return {"anon_exec_functions": len(p["anon_exec_public_functions"]), "anon_write_tables": len(p["anon_write_tables"]), "anon_policies": len(p["anon_or_public_policies"]), "security_definer_anon": len(p["security_definer_anon_exec"])}


res = {"items": {}, "financial_changes": {}, "anon_increases": {}}
fp0 = fin_fp()
prev_fp, prev_probe = fp0, probe()
res["start_probe"] = prev_probe
for v in order:
    c = cand.get(v, [])
    pre = [(a["atom"], a["pre"], ev(a["atom"])) for a in c]
    rc, j = G.execn("run", db, G.ALLOW, au, extra=["--stop-after", v, "--allow-stop-in-critical-window"])
    ok_run = rc == 0 and v in (j.get("executed") or [])
    post = [(a["atom"], a["post"], ev(a["atom"])) for a in c]
    fp1 = fin_fp()
    pr1 = probe()
    ch = [t for t in fp1 if fp1[t] != prev_fp[t]]
    if ch:
        res["financial_changes"][v] = ch
    inc = {k: [prev_probe[k], pr1[k]] for k in pr1 if pr1[k] > prev_probe[k]}
    if inc:
        res["anon_increases"][v] = inc
    valid = [a for (a, exp_pre, got_pre), (_, exp_post, got_post) in zip(pre, post) if got_pre == exp_pre and got_post == exp_post]
    res["items"][v] = {"run_ok": ok_run, "candidates": len(c), "validated": len(valid), "rejected": len(c) - len(valid), "valid_atoms": valid}
    prev_fp, prev_probe = fp1, pr1
    print(v, "run", ok_run, "atoms", len(valid), "/", len(c), "fin", ch, "anon+", inc, flush=True)
rc, j = G.execn("run", db, G.ALLOW, au)
rc2, jv = G.execn("verify", db, G.ALLOW, au)
led = G.ledger(db)
res["final"] = {"run_rc": rc, "verify_ok": rc2 == 0 and jv.get("executed") == 58 and jv.get("history_only") == 9 and jv.get("missing") == [], "ledger": {k: sum(1 for x in led.values() if x == k) for k in ("executed", "history-only", "other")}}
f, ref = G.fp(db), G.ref_fp()
res["final"]["catalog_equals_reference"] = f == ref
res["final"]["catalog_differs_in"] = [k for k in f if f[k] != ref[k]]
res["final"]["anon_probe_start"] = res["start_probe"]
res["final"]["anon_probe_end"] = prev_probe
res["summary"] = {"items": len(order), "all_runs_ok": all(i["run_ok"] for i in res["items"].values()), "items_with_validated_rules": sum(1 for i in res["items"].values() if i["validated"]),
                  "items_without_rules": [v for v, i in res["items"].items() if not i["validated"]], "versions_changing_financial_columns": res["financial_changes"], "versions_raising_anonymous_surface": res["anon_increases"]}
json.dump(res, open(OUT, "w", encoding="utf-8", newline="\n"), indent=1)
json.dump({v: i["valid_atoms"] for v, i in res["items"].items()}, open(os.path.join(SCR, "prod-validated.json"), "w", encoding="utf-8", newline="\n"))
print(json.dumps(res["summary"], indent=1)[:1500])
print(res["final"])
G.psql("postgres", 'drop database if exists "bpc_exec_prodstep" with (force)')
