"""Stage E2C: disposable LOCAL tests of the 67-version baseline against the 58-version candidate (and the Development alias ordering), at the level of
intermediate states, anonymous-policy exposure, interruption/resumption and late application of omitted versions.
Local scratch PostgreSQL only (127.0.0.1:54329, databases bpc_replay_e2c_*), cloned from the restored pre-upgrade Production schema (bpc_replay_d4_template).
Synthetic D4 data only. No hosted system is contacted; nothing here approves any sequence.
Usage: python -I e2c_rehearse.py <steps|exposure|resume|late|atomic|aliasfx>"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402

OUT = r"C:\Users\vikki\migration-evidence\e2c-scratch"
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
OMIT9 = ["20260715221828", "20260716104333", "20261010110000", "20260716151530", "20260716152823", "20260716173644", "20260717111737", "20260717113131", "20260814114825"]
ALIAS = "20260814120000"
PAIR = ["20260715221828", "20260716104333"]
FUNCS = ["check_product_availability", "get_public_business_settings", "reorder_product_categories", "save_product_bundle"]
TABLES = ["inventory_products", "product_bundles", "product_bundle_components", "product_pricing", "product_categories", "invoice_links", "contact_inquiries"]
PROBE = """select json_build_object(
 'invoice_links_policies', (select coalesce(json_agg(polname||':'||polcmd::text order by polname),'[]'::json) from pg_policy where polrelid='public.invoice_links'::regclass),
 'anon_insert_on_invoice_links', has_table_privilege('anon','public.invoice_links','INSERT'),
 'funcs', (select coalesce(json_object_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(p.prosrc)||'|'||coalesce(p.proacl::text,'')),'{}'::json) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('check_product_availability','get_public_business_settings','reorder_product_categories','save_product_bundle')),
 'table_acls', (select coalesce(json_object_agg(c.relname, coalesce(c.relacl::text,'')),'{}'::json) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('inventory_products','product_bundles','product_bundle_components','product_pricing','product_categories','invoice_links','contact_inquiries')),
 'contact_inquiries_columns', (select count(*) from information_schema.columns where table_schema='public' and table_name='contact_inquiries'))"""
DATA_SQL = open(os.path.join(HERE, "e2b1_rehearse.py"), encoding="utf-8").read().split('DATA_SQL = """')[1].split('"""')[0]


def rows_for(omit=(), alias_early=False):
    rows = [r for r in L.verify_upgrade_set() if r["version"] not in omit]
    if alias_early:
        mv = next(r for r in rows if r["version"] == ALIAS)
        rows = [r for r in rows if r is not mv]
        i = next(k for k, r in enumerate(rows) if r["version"] == "20260814113146")
        rows.insert(i, mv)
    return rows


def prep(db, template=None):
    L.clone(template or L.TEMPLATE, db)
    if not template:
        assert L.sql(db, S.users_and_roles()).returncode == 0
        assert L.sql(db, S.commerce()).returncode == 0


def apply(db, rows, capture=False):
    """Apply rows in the given order, one transaction per file, recording the local ledger; optionally capture catalog fingerprint and probes after each."""
    steps = {}
    for r in rows:
        res = L.run_migrations(db, rows=[r])
        if res[0]["status"] != "applied":
            return steps, res[0]
        if capture:
            steps[r["version"]] = {"fp": L.fingerprint(db), "probe": json.loads(L.q(db, PROBE))}
    return steps, None


def capture_final(db, tag):
    cap = subprocess.run([sys.executable, "-I", os.path.join(HERE, "d3_catalog.py"), "capture", db, tag], capture_output=True, text=True)
    return cap.returncode == 0


def catalog_diff(a, b):
    out = os.path.join(OUT, f"diff-{a}-{b}.json")
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, "d3_catalog.py"), "diff", a, b, out, "public,storage,auth"], capture_output=True, text=True)
    d = json.load(open(out, encoding="utf-8"))
    return {c: len(x["diffs"]) for c, x in d.items() if x["diffs"]}


def data_digest(db):
    return json.loads(L.q(db, DATA_SQL))


def steps_cmd():
    seqs = {"full67": rows_for(), "c58": rows_for(OMIT9), "full67_alias": rows_for(alias_early=True), "c58_alias": rows_for(OMIT9, alias_early=True)}
    res = {}
    for name, rows in seqs.items():
        db = f"bpc_replay_e2c_{name}"
        prep(db)
        steps, fail = apply(db, rows, capture=True)
        res[name] = {"database": db, "count": len(rows), "failed": fail, "steps": steps, "final_fp": L.fingerprint(db), "data": data_digest(db), "captured": capture_final(db, f"e2c{name}")}
        print(name, len(rows), "failed" if fail else "ok", flush=True)
    cmp = {}
    for name in ("c58", "full67_alias", "c58_alias"):
        cmp[name] = {"catalog_diff_vs_full67": catalog_diff("e2cfull67", f"e2c{name}"), "final_fp_equal": res[name]["final_fp"] == res["full67"]["final_fp"], "data_equal": res[name]["data"] == res["full67"]["data"]}
        print(name, cmp[name], flush=True)
    # per-step comparison of the 58 path against the 67 path at every shared version
    shared = [v for v in res["c58"]["steps"] if v in res["full67"]["steps"]]
    diffs = []
    for v in shared:
        a, b = res["full67"]["steps"][v], res["c58"]["steps"][v]
        cats = [k for k in a["fp"] if a["fp"][k] != b["fp"][k]]
        pr = [k for k in a["probe"] if a["probe"][k] != b["probe"][k]]
        if cats or pr:
            diffs.append({"after_version": v, "fingerprint_categories": cats, "probe_keys": pr})
    # per-omitted-step effect inside the 67 path
    order = list(res["full67"]["steps"])
    prev = None
    effects = {}
    for v in order:
        cur = res["full67"]["steps"][v]
        if v in OMIT9 and prev is not None:
            effects[v] = [k for k in cur["fp"] if cur["fp"][k] != prev["fp"][k]] + ["probe:" + k for k in cur["probe"] if cur["probe"][k] != prev["probe"][k]]
        prev = cur
    json.dump({"results": {k: {kk: vv for kk, vv in v.items() if kk != "steps"} for k, v in res.items()}, "comparison": cmp, "per_step_divergences_58_vs_67": diffs, "omitted_step_effects_in_67_path": effects,
               "probes": {n: {v: s["probe"] for v, s in res[n]["steps"].items()} for n in ("full67", "c58")}},
              open(os.path.join(OUT, "e2c-steps.json"), "w", encoding="utf-8"), indent=1, default=str)
    print("divergent shared steps:", len(diffs), "of", len(shared))
    for d in diffs:
        print(" ", d)
    print("omitted step effects:", json.dumps(effects, indent=1))


def anon_insert(db, tag):
    """Try an anonymous INSERT of a portal shortlink into invoice_links with synthetic ids; return the outcome, roll back."""
    oid = S.OID["O04_confirmed_deposit_paid"]
    t = f"begin;\nset local role anon;\ninsert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{oid}', 'tok_e2c_{tag}', 'sc_e2c_{tag}', 'portal_shortlink', 0);\nrollback;\n"
    r = L.psql(db, ["-v", "ON_ERROR_STOP=1"], text=t)
    return "ACCEPTED" if r.returncode == 0 else "REJECTED: " + L.err1(r.stderr)


def exposure_cmd():
    out = {}
    for name, omit in (("full67", []), ("c58", OMIT9)):
        rows = rows_for(omit)
        db = f"bpc_replay_e2c_expo_{name}"
        prep(db)
        pre = [r for r in rows if r["version"] < "20260715221828"]
        apply(db, pre)
        out[name] = {"before_pair": anon_insert(db, "a")}
        r1 = next((r for r in rows if r["version"] == PAIR[0]), None)
        if r1:
            apply(db, [r1])
            out[name]["after_20260715221828"] = anon_insert(db, "b")
            out[name]["policies_after_20260715221828"] = json.loads(L.q(db, PROBE))["invoice_links_policies"]
        r2 = next((r for r in rows if r["version"] == PAIR[1]), None)
        if r2:
            apply(db, [r2])
            out[name]["after_20260716104333"] = anon_insert(db, "c")
        else:
            nxt = [r for r in rows if r["version"] > "20260716104333"][:1]
            apply(db, nxt)
            out[name]["after_next_selected_version_" + nxt[0]["version"]] = anon_insert(db, "d")
        out[name]["policies_now"] = json.loads(L.q(db, PROBE))["invoice_links_policies"]
        print(name, json.dumps(out[name]), flush=True)
    json.dump(out, open(os.path.join(OUT, "e2c-exposure.json"), "w", encoding="utf-8"), indent=1)


STOPS = ["20260715214053", "20260716151458", "20260716151549", "20260716173638", "20260717110829", "20260717115647", "20260814113146", "20260814120000", "20260925171210", "20261010120000", "20261016120000"]


def resume_cmd():
    ref = json.load(open(os.path.join(OUT, "e2c-steps.json"), encoding="utf-8"))["results"]
    full_fp, c58_fp = ref["full67"]["final_fp"], ref["c58"]["final_fp"]
    c58 = rows_for(OMIT9)
    full = rows_for()
    allrows = {r["version"]: r for r in full}
    cur = "bpc_replay_e2c_run"
    prep(cur)
    done = 0
    out = []
    for stop in STOPS:
        seg = [r for r in c58[done:] if r["version"] <= stop]
        done += len(seg)
        _, fail = apply(cur, seg)
        assert not fail, fail
        state = L.fingerprint(cur)
        rec = {"stop_after": stop, "executed": done}
        # (a) proper resume: omitted versions recorded as history-only first, then remaining approved versions
        a = f"bpc_replay_e2c_ra"
        L.clone(cur, a)
        for v in OMIT9:
            r = allrows[v]
            L.q(a, "insert into supabase_migrations.schema_migrations (version,name,statements) values ('%s','%s',ARRAY['-- E2C HISTORY-ONLY (local scratch)'])" % (v, r["file"][15:-4].replace("'", "''")))
        _, fa = apply(a, c58[done:])
        rec["proper_resume"] = {"failed": bool(fa), "final_equals_uninterrupted_58": L.fingerprint(a) == c58_fp, "final_equals_full67": L.fingerprint(a) == full_fp,
                                "ledger_rows": int(L.q(a, "select count(*) from supabase_migrations.schema_migrations"))}
        # (b) naive resume: everything of the 67 not in the ledger, in version order (omitted versions run late where they sort before the stop point)
        b = "bpc_replay_e2c_rb"
        L.clone(cur, b)
        recorded = set(L.q(b, "select version from supabase_migrations.schema_migrations").split())
        pending = [r for r in full if r["version"] not in recorded]
        _, fb = apply(b, pending)
        late = [r["version"] for r in pending if r["version"] in OMIT9 and r["version"] <= stop]
        rec["naive_resume"] = {"pending_run": len(pending), "omitted_run_after_their_position": late, "failed": bool(fb), "final_equals_full67": L.fingerprint(b) == full_fp,
                               "differing_categories_vs_full67": [k for k, v in L.fingerprint(b).items() if v != full_fp[k]]}
        out.append(rec)
        print(json.dumps(rec), flush=True)
        L.psql("postgres", ["-c", 'drop database if exists "bpc_replay_e2c_ra" with (force)'])
        L.psql("postgres", ["-c", 'drop database if exists "bpc_replay_e2c_rb" with (force)'])
    json.dump(out, open(os.path.join(OUT, "e2c-resume.json"), "w", encoding="utf-8"), indent=1)


def late_cmd():
    ref = json.load(open(os.path.join(OUT, "e2c-steps.json"), encoding="utf-8"))["results"]
    c58_fp, full = ref["c58"]["final_fp"], rows_for()
    allrows = {r["version"]: r for r in full}
    out = {}
    for v in OMIT9:
        db = "bpc_replay_e2c_late"
        L.clone("bpc_replay_e2c_c58", db)
        _, fail = apply(db, [allrows[v]])
        fp = L.fingerprint(db)
        out[v] = {"failed": bool(fail), "regresses_final_state": fp != c58_fp, "changed_categories": [k for k in fp if fp[k] != c58_fp[k]]}
        print(v, out[v], flush=True)
    db = "bpc_replay_e2c_late"
    L.clone("bpc_replay_e2c_c58", db)
    _, fail = apply(db, sorted((allrows[v] for v in OMIT9), key=lambda r: r["version"]))
    fp = L.fingerprint(db)
    out["all_nine_in_version_order"] = {"failed": bool(fail), "regresses_final_state": fp != c58_fp, "changed_categories": [k for k in fp if fp[k] != c58_fp[k]]}
    print("all nine", out["all_nine_in_version_order"], flush=True)
    json.dump(out, open(os.path.join(OUT, "e2c-late.json"), "w", encoding="utf-8"), indent=1)


def atomic_cmd():
    """A migration file that fails midway leaves no partial effect (one transaction per file). Appends an invalid statement to a COPY of the file in the scratch folder."""
    out = {}
    rows = {r["version"]: r for r in rows_for()}
    for v in ("20260716151549", "20260716231809", "20260820165646", "20261012120000"):
        db = "bpc_replay_e2c_atomic"
        prep(db)
        _, fail = apply(db, [r for r in rows_for(OMIT9) if r["version"] < v])
        assert not fail, fail
        before, bdata = L.fingerprint(db), data_digest(db)
        src = open(os.path.join(L.MIG, rows[v]["file"]), encoding="utf-8").read()
        tmp = os.path.join(OUT, f"atomic_{v}.sql")
        open(tmp, "w", encoding="utf-8", newline="").write(src + "\n;\nSELECT 1/0;\n")
        p = L.psql(db, ["-v", "ON_ERROR_STOP=1", "-1", "-f", tmp])
        out[v] = {"statement_failed": p.returncode != 0, "error": L.err1(p.stderr), "catalog_unchanged": L.fingerprint(db) == before, "data_unchanged": data_digest(db) == bdata}
        print(v, out[v], flush=True)
    json.dump(out, open(os.path.join(OUT, "e2c-atomic.json"), "w", encoding="utf-8"), indent=1)


def aliasfx_cmd():
    """What the contact_inquiries migrations do in the current order versus with 20260814120000 moved to its recorded position (D-5)."""
    out = {}
    for name, early in (("current_order", False), ("alias_order", True)):
        rows = [r for r in rows_for(alias_early=early) if r["version"] <= "20260814120100"]
        db = f"bpc_replay_e2c_afx_{name[:5]}"
        prep(db)
        steps, fail = apply(db, rows, capture=True)
        assert not fail, fail
        out[name] = {"order_of_the_four": [r["version"] for r in rows if r["version"] in ("20260814113146", "20260814114825", "20260814120000", "20260814120100")]}
        prev = None
        for r in rows:
            v = r["version"]
            if v in ("20260814113146", "20260814114825", "20260814120000", "20260814120100"):
                pr = steps[v]["probe"]
                out[name][v] = {"contact_inquiries_columns": pr["contact_inquiries_columns"], "acl": pr["table_acls"].get("contact_inquiries"), "changed_vs_previous_step": prev is not None and (steps[v]["fp"] != prev["fp"])}
            prev = steps[v]
        print(name, json.dumps(out[name]), flush=True)
    json.dump(out, open(os.path.join(OUT, "e2c-aliasfx.json"), "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    {"steps": steps_cmd, "exposure": exposure_cmd, "resume": resume_cmd, "late": late_cmd, "atomic": atomic_cmd, "aliasfx": aliasfx_cmd}[sys.argv[1]]()
