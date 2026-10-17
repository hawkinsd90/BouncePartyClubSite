"""Stage E2E: does the line-ending form of the migration bytes change what the 58-version sequence produces? The D3 manifest hashes are of the Windows working-copy bytes (CRLF in 45 of the 67 files,
git stores LF). This test runs the 58 files twice on local scratch clones with the same synthetic dataset: once as checked out (CRLF where present) and once LF-normalized, then compares every catalog
category, the function bodies with and without carriage returns, and the row digests. Local scratch PostgreSQL only; no repository file is modified (LF copies go to the scratch folder).
Usage: python -I e2e_lf_test.py"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402
import e2d_extra as X  # noqa: E402

OUT = r"C:\Users\vikki\migration-evidence\e2e-scratch"
LF = os.path.join(OUT, "lf-files")
DATA_SQL = open(os.path.join(HERE, "e2b1_rehearse.py"), encoding="utf-8").read().split('DATA_SQL = """')[1].split('"""')[0]


def run(db, rows, lf):
    X.prep(db)
    for r in rows:
        src = os.path.join(L.MIG, r["file"])
        path = src
        if lf:
            os.makedirs(LF, exist_ok=True)
            path = os.path.join(LF, r["file"])
            open(path, "wb").write(open(src, "rb").read().replace(b"\r\n", b"\n"))
        p = L.psql(db, ["-v", "ON_ERROR_STOP=1", "-1", "-f", path])
        assert p.returncode == 0, (r["version"], L.err1(p.stderr))


rows = X.rows58()
run("bpc_replay_e2e_crlf", rows, False)
run("bpc_replay_e2e_lf", rows, True)
a, b = "bpc_replay_e2e_crlf", "bpc_replay_e2e_lf"
fa, fb = L.fingerprint(a), L.fingerprint(b)
fn_sql = "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace"
res = {"files": len(rows), "files_with_crlf": sum(1 for r in rows if b"\r\n" in open(os.path.join(L.MIG, r["file"]), "rb").read()),
       "categories_equal": {k: fa[k] == fb[k] for k in fa},
       "public_functions": int(L.q(a, fn_sql)),
       "function_bodies_raw_equal": int(L.q(a, "select 1")) and None,
       "data_digest_equal": json.loads(L.q(a, DATA_SQL)) == json.loads(L.q(b, DATA_SQL))}
bodies = lambda db, strip: json.loads(L.q(db, "select jsonb_object_agg(p.oid::regprocedure::text, md5(%s)) from pg_proc p where p.pronamespace='public'::regnamespace" % ("replace(p.prosrc, chr(13), '')" if strip else "p.prosrc")))
ba, bb = bodies(a, False), bodies(b, False)
sa, sb = bodies(a, True), bodies(b, True)
res["function_bodies_raw_equal"] = ba == bb
res["function_bodies_raw_differing"] = sorted(k for k in ba if ba[k] != bb.get(k))
res["function_bodies_equal_after_removing_carriage_returns"] = sa == sb
json.dump(res, open(os.path.join(OUT, "e2e-lf-test.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "function_bodies_raw_differing"}, indent=1), "raw-differing functions:", len(res["function_bodies_raw_differing"]))
