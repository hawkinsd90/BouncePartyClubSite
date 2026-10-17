"""Stage E2H: security-state analysis of the 58-version path, driven through the LOCAL executor (--stop-after at every step) on a disposable scratch database with synthetic data, plus an anonymous-role probe of every
anonymous-callable function at selected states, and targeted-containment experiments (documentation-grade SQL generated per state, applied ONLY to scratch databases to prove it narrows the surface, is exactly reversible
and does not change the final state after a resume). No hosted system; no existing migration or policy is modified; the containment SQL is never part of the executor.
Usage: python -I e2h_security.py <states|probe|contain|finish>"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import e2g_executor_tests as T  # noqa: E402
import e2h_tests as H  # noqa: E402
import d4_seed as S  # noqa: E402

SCR = H.SCR
FN_SQL = """select coalesce(json_agg(json_build_object('f', p.oid::regprocedure::text, 'secdef', p.prosecdef,
 'public_grant', exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
 'anon_grant', exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 'anon'::regrole and a.privilege_type = 'EXECUTE')) order by p.oid::regprocedure::text), '[]'::json)
 from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')"""
TB_SQL = """select coalesce(json_agg(json_build_object('t', c.relname, 'rls', c.relrowsecurity,
 'priv', concat_ws(',', case when has_table_privilege('anon', c.oid, 'INSERT') then 'INSERT' end, case when has_table_privilege('anon', c.oid, 'UPDATE') then 'UPDATE' end, case when has_table_privilege('anon', c.oid, 'DELETE') then 'DELETE' end),
 'policy_cmds', (select string_agg(distinct case pol.polcmd when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end, ',') from pg_policy pol where pol.polrelid = c.oid and (0 = any(pol.polroles) or 'anon'::regrole::oid = any(pol.polroles)) and pol.polcmd in ('a', 'w', 'd', '*'))) order by c.relname), '[]'::json)
 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))"""
ACL_SQL = """select json_build_object('f', (select coalesce(json_object_agg(p.oid::regprocedure::text, (select coalesce(array_agg(x::text order by x::text), '{}') from unnest(coalesce(p.proacl, '{}'::aclitem[])) x)::text), '{}'::json) from pg_proc p where p.pronamespace = 'public'::regnamespace),
 't', (select coalesce(json_object_agg(c.relname, (select coalesce(array_agg(x::text order by x::text), '{}') from unnest(coalesce(c.relacl, '{}'::aclitem[])) x)::text), '{}'::json) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'))"""


def surface(db):
    fns = json.loads(T.scalar(db, FN_SQL))
    tbs = json.loads(T.scalar(db, TB_SQL))
    eff = [t for t in tbs if (not t["rls"]) or t["policy_cmds"]]
    return {"fns": fns, "tables": tbs, "effective_tables": eff}


def sizes(s):
    return {"anon_functions": len(s["fns"]), "anon_write_privilege_tables": len(s["tables"]), "effectively_writable_tables": len(s["effective_tables"]), "no_rls_tables": [t["t"] for t in s["tables"] if not t["rls"]]}


def states():
    d = H.real()
    ex = [i["version"] for i in d["items"] if i["kind"] == "execute"]
    db = T.mkdb("bpc_exec_h_sec")
    au = T.fresh_audit("h_sec")
    steps = {"(start)": surface(db)}
    for v in ex:
        rc, j = T.execn("run", db, T.ALLOW, au, extra=["--stop-after", v, "--allow-stop-in-critical-window"])
        assert rc == 0, (v, j)
        steps[v] = surface(db)
        print(v, sizes(steps[v])["anon_functions"], sizes(steps[v])["anon_write_privilege_tables"], sizes(steps[v])["effectively_writable_tables"], flush=True)
    json.dump(steps, open(os.path.join(SCR, "security-steps.json"), "w", encoding="utf-8"), indent=1)
    rows, prev = [], steps["(start)"]
    for v, s in steps.items():
        if v == "(start)":
            continue
        pf, cf = {x["f"] for x in prev["fns"]}, {x["f"] for x in s["fns"]}
        pt, ct = {x["t"] for x in prev["effective_tables"]}, {x["t"] for x in s["effective_tables"]}
        ptp, ctp = {x["t"] for x in prev["tables"]}, {x["t"] for x in s["tables"]}
        if pf != cf or pt != ct or ptp != ctp:
            rows.append({"after": v, "functions_added": sorted(cf - pf), "functions_removed": sorted(pf - cf), "priv_tables_added": sorted(ctp - ptp), "priv_tables_removed": sorted(ptp - ctp), "effective_added": sorted(ct - pt), "effective_removed": sorted(pt - ct)})
        prev = s
    json.dump(rows, open(os.path.join(SCR, "security-changes.json"), "w", encoding="utf-8"), indent=1)
    st = sizes(steps["(start)"])
    wider = [v for v, s in steps.items() if v != "(start)" and (sizes(s)["anon_functions"] > st["anon_functions"] or sizes(s)["effectively_writable_tables"] > st["effectively_writable_tables"])]
    wider_priv = [v for v, s in steps.items() if v != "(start)" and (sizes(s)["anon_functions"] > st["anon_functions"] or sizes(s)["anon_write_privilege_tables"] > st["anon_write_privilege_tables"])]
    H.STATE["extra"]["states"] = {"start": st, "final": sizes(steps[ex[-1]]), "changed_steps": len(rows), "stops_wider_by_functions_or_effective_tables": len(wider), "stops_wider_by_functions_or_privilege_tables": len(wider_priv),
                                  "first_wider": wider[0] if wider else None, "last_wider": wider[-1] if wider else None, "peak_functions": max(sizes(s)["anon_functions"] for s in steps.values()), "peak_effective_tables": max(sizes(s)["effectively_writable_tables"] for s in steps.values())}
    json.dump(H.STATE, open(H.RES, "w", encoding="utf-8"), indent=1)
    print(json.dumps(H.STATE["extra"]["states"]))
    H.rec("H-X01", "per-step anonymous surface captured through the executor for all 58 stops (functions, privilege tables, effectively writable tables = RLS disabled or an anon/public write policy exists)", "58 stops", len(steps) - 1, len(steps) - 1 == 58)
    H.rec("H-X02", "no table with anonymous write privilege had row-level security disabled at any stop", "none", [v for v, s in steps.items() if sizes(s)["no_rls_tables"]], not [v for v, s in steps.items() if sizes(s)["no_rls_tables"]])


ARG = {"uuid": "'%s'::uuid", "text": "'x'::text", "character varying": "'x'::varchar", "integer": "1", "bigint": "1", "smallint": "1", "numeric": "1", "real": "1", "double precision": "1", "boolean": "false", "date": "current_date",
       "timestamp with time zone": "now()", "timestamp without time zone": "now()::timestamp", "time without time zone": "'10:00'::time", "jsonb": "'{}'::jsonb", "json": "'{}'::json", "text[]": "ARRAY['x']::text[]", "uuid[]": "ARRAY[]::uuid[]",
       "jsonb[]": "ARRAY[]::jsonb[]", "integer[]": "ARRAY[1]::integer[]"}
DENY = re.compile(r"permission denied|not authori[sz]ed|unauthori[sz]ed|forbidden|must be (an )?(admin|authenticated|logged|master)|access denied|not allowed|requires (an? )?(admin|authenticated|service)|insufficient|authentication required|unauthenticated|only (admin|staff|service)", re.I)


def probe_state(db):
    fns = json.loads(T.scalar(db, FN_SQL))
    res = []
    oid = S.OID["O04_confirmed_deposit_paid"]
    for f in fns:
        sig = f["f"]
        name = sig.split("(")[0]
        types = T.scalar(db, f"select coalesce(string_agg(format_type(t, null), '|' order by o), '') from unnest((select proargtypes from pg_proc where oid = '{sig}'::regprocedure)) with ordinality as x(t, o)").split("|") if "(" in sig and not sig.endswith("()") else []
        args, first_uuid = [], True
        for t in types:
            if t == "uuid":
                args.append(("'%s'::uuid" % oid) if first_uuid else "'d4ffffff-0000-4000-8000-000000000001'::uuid")
                first_uuid = False
            else:
                args.append(ARG.get(t, f"NULL::{t}"))
        r = T.psql(db, f"begin;\nset local role anon;\nselect count(*) from (select * from public.{name}({', '.join(args)})) _x;\nrollback;\n")
        err = T.err1(r.stderr) if hasattr(T, "err1") else (re.search(r"ERROR:\s+(.*)", r.stderr or "") or [None, ""])[1]
        if r.returncode == 0:
            cnt = (r.stdout.strip().splitlines() or ["0"])[-1].strip()
            cls = "callable (returned rows)" if cnt not in ("", "0") else "callable (empty/void result)"
        elif DENY.search(err or ""):
            cls = "guarded (authorization error)"
        else:
            cls = "error (inconclusive)"
        res.append({"f": sig, "secdef": f["secdef"], "via_public": f["public_grant"], "direct_anon": f["anon_grant"], "result": cls, "error": (err or "")[:100]})
    return res


def probe():
    d = H.real()
    out = {}
    for label, stop in (("start", None), ("after_20260820165646", "20260820165646"), ("after_20261008120000", "20261008120000"), ("final", "20261025120000")):
        db = T.mkdb("bpc_exec_h_probe_" + label[:12].replace("_", ""))
        if stop:
            rc, j = T.execn("run", db, T.ALLOW, T.fresh_audit("h_probe_" + label[:8]), extra=["--stop-after", stop, "--allow-stop-in-critical-window"])
            assert rc == 0, j
        out[label] = probe_state(db)
        c = {}
        for r in out[label]:
            c[r["result"]] = c.get(r["result"], 0) + 1
        print(label, len(out[label]), c, flush=True)
    json.dump(out, open(os.path.join(SCR, "anon-probe.json"), "w", encoding="utf-8"), indent=1)
    H.STATE["extra"]["probe_summary"] = {k: {"functions": len(v), **{r2: sum(1 for r in v if r["result"] == r2) for r2 in sorted({r["result"] for r in v})}} for k, v in out.items()}
    json.dump(H.STATE, open(H.RES, "w", encoding="utf-8"), indent=1)
    H.rec("H-X03", "anonymous-role probe with synthetic arguments run at 4 states (start, widest-by-functions, the W1 failure state, final); every anonymous-callable function classified (rolled back)", "classified", {k: len(v) for k, v in out.items()}, all(out.values()))


def acl_snapshot(db):
    return json.loads(T.scalar(db, ACL_SQL))


def make_sql(db, fn_targets, tb_targets):
    """Targeted containment + exact restore for specific functions/tables, generated from the ACL snapshot of THIS state."""
    contain, restore = [], []
    for sig in sorted(fn_targets):
        rows = T.scalar(db, f"select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ',') from aclexplode(coalesce((select proacl from pg_proc where oid = '{sig}'::regprocedure), acldefault('f', (select proowner from pg_proc where oid = '{sig}'::regprocedure)))) a where a.privilege_type = 'EXECUTE'")
        grantees = [g for g in (rows or "").split(",") if g]
        owner = T.scalar(db, f"select proowner::regrole::text from pg_proc where oid = '{sig}'::regprocedure")
        if "PUBLIC" in grantees:
            contain.append(f"REVOKE EXECUTE ON FUNCTION public.{sig} FROM PUBLIC;")
            contain.append(f"GRANT EXECUTE ON FUNCTION public.{sig} TO authenticated, service_role;")
        if "anon" in grantees:
            contain.append(f"REVOKE EXECUTE ON FUNCTION public.{sig} FROM anon;")
        restore.append(f"REVOKE EXECUTE ON FUNCTION public.{sig} FROM PUBLIC, anon, authenticated, service_role;")
        for g in grantees:
            if g != owner:
                restore.append(f"GRANT EXECUTE ON FUNCTION public.{sig} TO {g};")
    for t in sorted(tb_targets):
        privs = T.scalar(db, f"select concat_ws(',', case when has_table_privilege('anon', 'public.{t}', 'INSERT') then 'INSERT' end, case when has_table_privilege('anon', 'public.{t}', 'UPDATE') then 'UPDATE' end, case when has_table_privilege('anon', 'public.{t}', 'DELETE') then 'DELETE' end)")
        contain.append(f"REVOKE INSERT, UPDATE, DELETE ON TABLE public.{t} FROM anon;")
        restore.append(f"GRANT {privs} ON TABLE public.{t} TO anon;")
    return "\n".join(contain), "\n".join(restore)


def contain():
    d = H.real()
    start_db = T.mkdb("bpc_exec_h_cstart")
    start = surface(start_db)
    start_probe = probe_state(start_db)
    final_db = T.mkdb("bpc_exec_h_cfinal")
    rc, j = T.execn("run", final_db, T.ALLOW, T.fresh_audit("h_cfinal"))
    assert rc == 0
    final = surface(final_db)
    final_fp = T.fp(final_db)
    final_acl = acl_snapshot(final_db)
    sf, ff = {x["f"] for x in start["fns"]}, {x["f"] for x in final["fns"]}
    st, ft = {x["t"] for x in start["effective_tables"]}, {x["t"] for x in final["effective_tables"]}
    H.STATE["extra"]["reference_sets"] = {"start_functions": len(sf), "final_functions": sorted(ff), "start_effective_tables": len(st), "final_effective_tables": sorted(ft)}
    cases = {
        "C1": ("failure at 20261009120000 (duplicate active portal link)", f"insert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{S.OID['O04_confirmed_deposit_paid']}','tok_h_dup','sc_h_dup','portal',0);", [], "delete from public.invoice_links where link_token='tok_h_dup'", "20261009120000"),
        "C2": ("interrupted after 20260820165646 (widest-by-functions stop; also the state of a lock-timeout failure at 20260925151621)", "", ["--stop-after", "20260820165646", "--allow-stop-in-critical-window"], "", None),
    }
    for cid, (desc, seed_sql, extra, fixsql, fail_at) in cases.items():
        db = T.mkdb(f"bpc_exec_h_{cid.lower()}", extra_sql=seed_sql)
        au = T.fresh_audit(f"h_{cid}")
        rc, j = T.execn("run", db, T.ALLOW, au, extra=extra)
        ok_state = (rc == 3 and (j.get("failed") or {}).get("version") == fail_at) if fail_at else rc == 0
        s0 = surface(db)
        cf, ct = {x["f"] for x in s0["fns"]}, {x["t"] for x in s0["effective_tables"]}
        new_fns = cf - sf - ff
        probed = {r["f"]: r["result"] for r in probe_state(db)}
        # targeted: only the NEW anonymous-callable functions that actually let an anonymous caller through; functions that refuse anon with an authorization error are left alone
        fn_targets = {f for f in new_fns if probed.get(f, "").startswith("callable")}
        tb_targets = ct - st - ft
        H.STATE["extra"].setdefault("containment_probe", {})[cid] = {f.split("(")[0]: probed.get(f) for f in sorted(new_fns)}
        keep_final_intended = sorted((cf - sf) & ff)
        contain_sql, restore_sql = make_sql(db, fn_targets, tb_targets)
        open(os.path.join(SCR, f"containment-{cid}.sql"), "w", encoding="utf-8").write("-- DOCUMENTATION ONLY (E2H). Generated for a scratch state; never executed by the executor.\n-- CONTAIN\n" + contain_sql + "\n\n-- RESTORE (exact original privileges of the targeted objects)\n" + restore_sql + "\n")
        before_acl = acl_snapshot(db)
        assert T.psql(db, contain_sql).returncode == 0
        s1 = surface(db)
        after_acl = acl_snapshot(db)
        changed_fn = [k for k in before_acl["f"] if before_acl["f"][k] != after_acl["f"].get(k)]
        changed_tb = [k for k in before_acl["t"] if before_acl["t"][k] != after_acl["t"].get(k)]
        H.rec(f"H-X04{cid}", f"{cid} {desc}: state reached as expected", "reached", f"rc={rc} failed={(j.get('failed') or {}).get('version')}", ok_state)
        callable_start = sum(1 for r in start_probe if r["result"].startswith("callable"))
        callable_before = sum(1 for r in probed.values() if r.startswith("callable"))
        callable_after = sum(1 for r in probe_state(db) if r["result"].startswith("callable"))
        H.rec(f"H-X05{cid}", f"{cid}: anonymous-CALLABLE functions (probe) at the state / after targeted containment; start was {callable_start}; effectively writable tables start {len(st)}", "after <= start", f"state {callable_before} -> after containment {callable_after}; effectively writable tables {len(ct)} -> {len(s1['effective_tables'])}; targets {sorted(f.split('(')[0] for f in fn_targets)}; kept (intended at the end) {keep_final_intended}",
              callable_after <= callable_start and len(s1["effective_tables"]) <= len(st))
        H.rec(f"H-X06{cid}", f"{cid}: containment changed privileges only on the targeted objects (not a blanket revoke)", "changed set == targets", f"{len(changed_fn)} functions, {len(changed_tb)} tables changed; targets {len(fn_targets)} / {len(tb_targets)}", set(changed_fn) <= fn_targets and set(changed_tb) <= tb_targets and len(changed_fn) > 0)
        assert T.psql(db, restore_sql).returncode == 0
        restored = acl_snapshot(db)
        H.rec(f"H-X07{cid}", f"{cid}: running the generated RESTORE script returns the targeted objects' privileges exactly to the pre-containment state", "identical ACL snapshot", f"function ACLs equal={restored['f'] == before_acl['f']} table ACLs equal={restored['t'] == before_acl['t']}", restored["f"] == before_acl["f"] and restored["t"] == before_acl["t"])
        # containment, then resume WITHOUT restore: does the final state still equal the uncontained reference?
        assert T.psql(db, contain_sql).returncode == 0
        if fixsql:
            assert T.psql(db, fixsql).returncode == 0
        rc2, j2 = T.execn("run", db, T.ALLOW, au)
        f2, acl2 = T.fp(db), acl_snapshot(db)
        diff_f = [k for k in final_acl["f"] if final_acl["f"][k] != acl2["f"].get(k)]
        diff_t = [k for k in final_acl["t"] if final_acl["t"][k] != acl2["t"].get(k)]
        H.rec(f"H-X08{cid}", f"{cid}: contain, fix the cause, resume: the run completes and the final catalog / function and table ACLs equal an uncontained run", "equal", f"rc={rc2} fingerprint_differs={[k for k in f2 if f2[k] != final_fp[k]]} function_acl_diffs={diff_f[:4]} table_acl_diffs={diff_t[:4]}", rc2 == 0 and f2 == final_fp and not diff_f and not diff_t)
        H.STATE["extra"].setdefault("containment", {})[cid] = {"description": desc, "start": [len(sf), len(st)], "at_state": [len(cf), len(ct)], "after_containment": [len(s1["fns"]), len(s1["effective_tables"])], "function_targets": sorted(fn_targets), "table_targets": sorted(tb_targets), "kept_because_intended_at_the_end": keep_final_intended,
                                                                 "contain_sql_file": f"containment-{cid}.sql (scratch folder; excerpts in e2h-security-recovery-plan.md)"}
        json.dump(H.STATE, open(H.RES, "w", encoding="utf-8"), indent=1)


def finish():
    H.finish()


if __name__ == "__main__":
    {"states": states, "probe": probe, "contain": contain, "finish": finish}[sys.argv[1]]()
