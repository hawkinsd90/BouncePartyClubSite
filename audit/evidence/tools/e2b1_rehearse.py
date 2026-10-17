"""Stage E2B-1: local rehearsal of shortened Production upgrade sequences and of the case 41 backfill. LOCAL scratch PostgreSQL only (127.0.0.1:54329, bpc_replay_*),
cloned from the restored pre-upgrade Production schema (bpc_replay_d4_template, built from the hash-verified Stage B dump). Synthetic data only (one master user so the
role-repair guard can run; the case 41 test uses the D4 synthetic dataset). No hosted system is contacted. The approved 67-version baseline is NOT replaced by any result here.
Usage: python -I e2b1_rehearse.py <seq|case41>"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402

OUT = r"C:\Users\vikki\migration-evidence\e2b1-scratch"
D3OUT = r"C:\Users\vikki\migration-evidence\d3-scratch"
REPO = L.REPO
SEED = "set session_replication_role = replica;\n" + L.ins("auth.users", id=S.U_MASTER, aud="authenticated", role="authenticated", email="e2b1-master@example.test") + "\n" + L.ins("public.user_roles", user_id=S.U_MASTER, role="master")
NETZERO = ["20260715221828", "20260716104333"]
NOOP_OCT = ["20261010110000"]
FULLY_REPLACED = ["20260716151530", "20260716152823", "20260716173644", "20260717111737", "20260717113131", "20260814114825"]
DATA_SQL = """select coalesce(jsonb_object_agg(t, jsonb_build_object('rows', n, 'digest', d)), '{}'::jsonb) from (
  select relname as t, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', relname), false, true, '')))[1]::text::int as n,
         (xpath('/row/d/text()', query_to_xml(format($q$select coalesce(md5(string_agg(m, ',' order by m)), '') as d from (select md5((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(to_jsonb(x)) e(k, v)
            where v::text !~ '^"[0-9a-f]{8}-[0-9a-f]{4}-' and v::text !~ '^"[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:')::text) as m from public.%I x) s$q$, relname), false, true, '')))[1]::text as d
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') z where n > 0"""


def run_seq(name, omit):
    db = f"bpc_replay_e2b1_{name}"
    L.clone(L.TEMPLATE, db)
    assert L.sql(db, SEED).returncode == 0
    rows = [r for r in L.verify_upgrade_set() if r["version"] not in omit]
    res = L.run_migrations(db, rows=rows)
    failed = [(r["version"], r.get("error")) for r in res if r["status"] != "applied"]
    data = json.loads(L.q(db, DATA_SQL))
    cap = subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "d3_catalog.py"), "capture", db, f"e2b1{name}"], capture_output=True, text=True)
    return {"name": name, "database": db, "omitted": sorted(omit), "versions_run": len(res), "applied": sum(r["status"] == "applied" for r in res), "failed": failed, "data": data, "capture_ok": cap.returncode == 0}


def diff(a, b):
    out = os.path.join(OUT, f"diff-{a}-{b}.json")
    r = subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "d3_catalog.py"), "diff", f"e2b1{a}", f"e2b1{b}", out, "public,storage,auth"], capture_output=True, text=True)
    d = json.load(open(out, encoding="utf-8"))
    cats = {c: len(x["diffs"]) for c, x in d.items() if x["diffs"]}
    return {"differing_categories": cats, "details": {c: [(r_["kind"], r_["key"], r_.get("field")) for r_ in x["diffs"][:6]] for c, x in d.items() if x["diffs"]}}


def seq():
    results = {}
    exps = {"full": [], "s1": NETZERO + NOOP_OCT, "s2": NETZERO + NOOP_OCT + FULLY_REPLACED}
    for fn in FULLY_REPLACED:
        exps["only_" + fn[-6:]] = [fn]
    for name, omit in exps.items():
        results[name] = run_seq(name, omit)
        print(name, "omit", len(omit), "| applied", results[name]["applied"], "| failed", results[name]["failed"])
    cmp = {}
    for name in exps:
        if name != "full" and results[name]["capture_ok"] and results["full"]["capture_ok"] and not results[name]["failed"]:
            cmp[name] = diff("full", name)
            cmp[name]["data_differences"] = {t: {"full": results["full"]["data"].get(t), name: results[name]["data"].get(t)} for t in sorted(set(results["full"]["data"]) | set(results[name]["data"])) if results["full"]["data"].get(t) != results[name]["data"].get(t)}
            print(name, "catalog diffs:", cmp[name]["differing_categories"] or "none", "| data diffs:", list(cmp[name]["data_differences"]) or "none")
    json.dump({"results": results, "comparison": cmp}, open(os.path.join(OUT, "e2b1-sequences.json"), "w", encoding="utf-8"), indent=1, default=str)


def rename_order():
    """Owner option N4 (rename 20260814120000 to the recorded 20260814002658): same SQL, earlier position. Compared with the full 67-version result."""
    db = "bpc_replay_e2b1_rename"
    L.clone(L.TEMPLATE, db)
    assert L.sql(db, SEED).returncode == 0
    rows = L.verify_upgrade_set()
    mv = next(r for r in rows if r["version"] == "20260814120000")
    rows = [r for r in rows if r is not mv]
    i = next(k for k, r in enumerate(rows) if r["version"] == "20260814113146")
    rows.insert(i, mv)
    res = L.run_migrations(db, rows=rows)
    failed = [(r["version"], r.get("error")) for r in res if r["status"] != "applied"]
    data = json.loads(L.q(db, DATA_SQL))
    cap = subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "d3_catalog.py"), "capture", db, "e2b1rename"], capture_output=True, text=True)
    full = json.load(open(os.path.join(OUT, "e2b1-sequences.json"), encoding="utf-8"))["results"]["full"]["data"]
    out = {"applied": sum(r["status"] == "applied" for r in res), "failed": failed, "capture_ok": cap.returncode == 0}
    if cap.returncode == 0 and not failed:
        out["comparison"] = diff("full", "rename")
        out["data_differences"] = {t: {"full": full.get(t), "rename": data.get(t)} for t in sorted(set(full) | set(data)) if full.get(t) != data.get(t)}
    json.dump(out, open(os.path.join(OUT, "e2b1-rename.json"), "w", encoding="utf-8"), indent=1, default=str)
    print(json.dumps({k: v for k, v in out.items() if k != "data_differences"}, indent=1, default=str)[:1500], "| data diffs:", list(out.get("data_differences", {})))


def case41():
    db = "bpc_replay_e2b1_c41"
    L.clone(L.TEMPLATE, db)
    assert L.sql(db, S.users_and_roles()).returncode == 0 and L.sql(db, S.commerce()).returncode == 0
    extra = "set session_replication_role = replica;\n" + L.ins("public.orders", id=L.uid(99, "05"), customer_id=S.CUST[0], address_id=S.ADDR[0], status="confirmed", location_type="residential", surface="grass", event_date="2026-12-01", event_end_date="2026-12-01",
                                                         start_window="10:00", end_window="12:00", pickup_preference="same_day", subtotal_cents=10000, travel_fee_cents=0, surface_fee_cents=0, tax_cents=0, deposit_due_cents=50000, balance_due_cents=0)
    assert L.sql(db, extra).returncode == 0
    mig = L.MIG.replace("\\", "/")
    f1 = [x for x in os.listdir(L.MIG) if x.startswith("20260305203528")][0]
    f2 = [x for x in os.listdir(L.MIG) if x.startswith("20260305205811")][0]
    out = {}
    # state: column exists and the order rows have a NULL selection (as new orders legitimately may)
    out["orders_total"] = int(L.q(db, "select count(*) from public.orders"))
    out["orders_with_null_selection_before"] = int(L.q(db, "select count(*) from public.orders where customer_selected_payment_cents is null"))
    for nm, f in (("20260305203528", f1), ("20260305205811", f2)):
        r = L.psql(db, ["-At", "-v", "ON_ERROR_STOP=1"], text=f"BEGIN;\n\\i '{mig}/{f}'\nSELECT count(*) filter (where customer_selected_payment_type='deposit') || '/' || count(*) filter (where customer_selected_payment_type='full') || '/' || count(*) filter (where customer_selected_payment_cents is not null) FROM public.orders;\nROLLBACK;\n")
        out[nm] = {"stderr": L.err1(r.stderr), "deposit_full_rowsset_after": r.stdout.strip().split("\n")[-1] if r.stdout.strip() else "", "update_tag": [l for l in r.stdout.split("\n") if l.startswith("UPDATE")]}
    out["after_rollback_null_selection"] = int(L.q(db, "select count(*) from public.orders where customer_selected_payment_cents is null"))
    json.dump(out, open(os.path.join(OUT, "e2b1-case41.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    {"seq": seq, "case41": case41, "rename": rename_order}[sys.argv[1]]()
