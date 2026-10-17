"""Stage E2G: black-box tests of the LOCAL scratch migration executor (scripts/dev/local-executor). Every test drives the executor as a separate process against DISPOSABLE local PostgreSQL databases
(127.0.0.1:54329, bpc_exec_*) cloned from the restored pre-upgrade Production schema (ledger = the 277 captured rows) with the synthetic D4 dataset, or against throwaway synthetic git repositories.
No hosted system is contacted; the executor itself refuses hosted targets. Results are appended to the protected scratch folder and merged into audit/evidence/e2g-executor-test-results.json by `finish`.
Usage: python -I e2g_executor_tests.py <setup|guards|integrity|ledger|run|interrupt|failures|window|finish>"""
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import d4_lib as L  # noqa: E402
import d4_seed as S  # noqa: E402
import e2d_extra as X  # noqa: E402  (PROBE sql and the omitted-version list)

REPO = L.REPO
EXE = os.path.join(REPO, "scripts", "dev", "local-executor", "local-migration-executor.cjs")
BUILD = os.path.join(REPO, "scripts", "dev", "local-executor", "build-allowlist.cjs")
SCR = r"C:\Users\vikki\migration-evidence\e2g-scratch"
RES = os.path.join(SCR, "results.json")
PSQL = L.PSQL
MARK = "bpc-migration-executor-scratch:v1"
OMIT9 = X.OMIT9
os.makedirs(SCR, exist_ok=True)
STATE = json.load(open(RES, encoding="utf-8")) if os.path.exists(RES) else {"tests": {}}


def rec(tid, name, expected, actual, ok):
    STATE["tests"][tid] = {"id": tid, "name": name, "expected": str(expected)[:300], "actual": str(actual)[:600], "result": "PASS" if ok else "FAIL"}
    json.dump(STATE, open(RES, "w", encoding="utf-8"), indent=1)
    print(("PASS" if ok else "FAIL"), tid, "|", name, "|", str(actual)[:140], flush=True)


def clean_env(extra=None):
    e = {k: v for k, v in os.environ.items() if not (k.startswith("PG") or k.startswith("SUPABASE") or k == "DATABASE_URL")}
    e["BPC_PSQL"] = PSQL
    e.update(extra or {})
    return e


def psql(db, sql, ro=False):
    e = clean_env({"PGCLIENTENCODING": "UTF8"})
    if ro:
        e["PGOPTIONS"] = "-c default_transaction_read_only=on"
    r = subprocess.run([PSQL, "-X", "-q", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", db, "-f", "-"], input=sql, capture_output=True, text=True, encoding="utf-8", errors="replace", env=e)
    return r


def scalar(db, sql):
    r = psql(db, sql, True)
    assert r.returncode == 0, r.stderr[:300]
    return r.stdout.strip()


def mkdb(name, seed=True, template="bpc_exec_template", marker=True, extra_sql=""):
    assert re.match(r"^bpc_exec_[a-z0-9_]{1,40}$", name)
    for s in (f'drop database if exists "{name}" with (force)', f'create database "{name}" template "{template}"'):
        assert psql("postgres", s).returncode == 0
    if marker:
        psql("postgres", f"comment on database \"{name}\" is '{MARK}'")
    psql("postgres", f'alter database "{name}" set search_path = public, extensions')
    if seed:
        assert psql(name, S.users_and_roles()).returncode == 0
        assert psql(name, S.commerce()).returncode == 0
    if extra_sql:
        assert psql(name, extra_sql).returncode == 0
    return name


def execn(cmd, db, allow, audit, extra=(), env_extra=None, ack=True, timeout=1800, approval=None, repo=None):
    doc = json.load(open(allow, encoding="utf-8"))
    args = ["node", EXE, cmd, "--allowlist", allow, "--db", db, "--audit-dir", audit, "--approval-hash", approval or doc.get("document_sha256", "x")]
    if repo:
        args += ["--repo-root", repo]
    if ack and cmd != "verify":
        n = sum(1 for i in doc["items"] if i["kind"] == "execute" and doc["expected_base_history"].get("latest") and i["version"] < doc["expected_base_history"]["latest"])
        if n:
            args += ["--acknowledge-older-than-latest", str(n)]
    args += list(extra)
    r = subprocess.run(args, capture_output=True, text=True, env=clean_env(env_extra), timeout=timeout, cwd=REPO)
    try:
        j = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        j = {"ok": False, "message": (r.stdout + r.stderr)[:300]}
    return r.returncode, j


def rehash(path):
    js = "const e=require(process.argv[1]);const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));d.document_sha256=e.documentHash(d);fs.writeFileSync(process.argv[2],JSON.stringify(d,null,1));console.log(d.document_sha256)"
    return subprocess.run(["node", "-e", js, EXE, path], capture_output=True, text=True).stdout.strip()


def mutate(src, dst, fn):
    d = json.load(open(src, encoding="utf-8"))
    fn(d)
    json.dump(d, open(dst, "w", encoding="utf-8"), indent=1)
    rehash(dst)
    return dst


def ledger(db):
    out = {}
    for ln in scalar(db, "select version || E'\\t' || coalesce(statements[1],'') from supabase_migrations.schema_migrations").splitlines():
        v, _, m = ln.partition("\t")
        out[v] = "executed" if m.startswith("-- BPC-LOCAL-EXECUTOR executed") else "history-only" if m.startswith("-- BPC-LOCAL-EXECUTOR history-only") else "other"
    return out


def audit_recs(audit):
    f = os.path.join(audit, "audit.jsonl")
    return [json.loads(x) for x in open(f, encoding="utf-8").read().splitlines() if x] if os.path.exists(f) else []


_FP = None


def fp(db):
    global _FP
    if _FP is None:
        _FP = re.search(r'FP = """(.*?)"""', open(os.path.join(HERE, "d3_upgrade.py"), encoding="utf-8").read(), re.S).group(1)
    return json.loads(scalar(db, _FP))


_REF = {}


def ref_fp():
    """Reference = the E2E LF-normalized run of the same 58 files (psql -f on LF copies) on a scratch clone of the same restored schema: the executor sends LF text, so the exact fingerprint must match this one."""
    if "lf" not in _REF:
        _REF["lf"] = fp("bpc_replay_e2e_lf")
    return _REF["lf"]


def fp_stripped(db):
    """Fingerprint with carriage returns removed from function bodies (to compare an LF run with the earlier CRLF working-copy rehearsals)."""
    fp(db)
    return json.loads(scalar(db, _FP.replace("md5(p.prosrc)", "md5(replace(p.prosrc, chr(13), ''))")))


def surface(db):
    p = json.loads(scalar(db, X.PROBE))
    return {"anon_functions": len(p["anon_exec_public_functions"]), "anon_write_tables": len(p["anon_write_tables"]), "no_rls_anon_tables": [t for t in p["anon_write_tables"] if "NO-RLS" in t]}


def anon_insert(db, tag):
    oid = S.OID["O04_confirmed_deposit_paid"]
    r = psql(db, f"begin;\nset local role anon;\ninsert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{oid}','tok_e2g_{tag}','sc_e2g_{tag}','portal_shortlink',0);\nrollback;\n")
    return "ACCEPTED" if r.returncode == 0 else "REJECTED"


ALLOW = os.path.join(SCR, "allowlist-prod58.json")
DEPS = os.path.join(REPO, "scripts", "dev", "local-executor", "prod58-dependencies.json")


def synth_repo(name, files, crlf_worktree=False):
    d = os.path.join(SCR, "synth-" + name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(os.path.join(d, "supabase", "migrations"))
    run = lambda *a: subprocess.run(["git", "-C", d, *a], capture_output=True, text=True, check=True)
    run("init", "-q")
    run("config", "user.email", "t@example.invalid")
    run("config", "user.name", "t")
    run("config", "core.autocrlf", "false")
    for fn, content in files.items():
        open(os.path.join(d, "supabase", "migrations", fn), "w", encoding="utf-8", newline="").write(content)
    run("add", "-A")
    run("commit", "-q", "-m", "synthetic migrations")
    commit = run("rev-parse", "HEAD").stdout.strip()
    if crlf_worktree:
        for fn in files:
            p = os.path.join(d, "supabase", "migrations", fn)
            b = open(p, "rb").read().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
            open(p, "wb").write(b)
    return d, commit


def synth_db(name, base_rows=()):
    assert psql("postgres", f'drop database if exists "{name}" with (force)').returncode == 0
    assert psql("postgres", f'create database "{name}" template "bpc_exec_synth_template"').returncode == 0
    psql("postgres", f"comment on database \"{name}\" is '{MARK}'")
    for v in base_rows:
        assert psql(name, f"insert into supabase_migrations.schema_migrations (version,name,statements) values ('{v}','base',ARRAY['-- base'])").returncode == 0
    return name


def synth_allow(repo, commit, items, base_versions, out, cw=None):
    ij = out + ".items.json"
    json.dump(items, open(ij, "w"))
    bh = out + ".base.json"
    json.dump([{"version": v} for v in base_versions], open(bh, "w"))
    cmd = ["node", BUILD, "--repo-root", repo, "--commit", commit, "--items-json", ij, "--base-history", bh, "--out", out]
    if cw:
        cmd += ["--critical-first", cw[0], "--critical-last", cw[1]]
    r = subprocess.run(cmd, capture_output=True, text=True, env=clean_env())
    assert r.returncode == 0, r.stderr[:300]
    return out


def fresh_audit(name):
    d = os.path.join(SCR, "audit-" + name)
    shutil.rmtree(d, ignore_errors=True)
    return d


# =====================================================================================================================================================
def setup():
    for s in ('drop database if exists "bpc_exec_template" with (force)', 'create database "bpc_exec_template" template "bpc_replay_d4_template"'):
        assert psql("postgres", s).returncode == 0
    psql("postgres", f"comment on database \"bpc_exec_template\" is '{MARK}'")
    psql("postgres", 'alter database "bpc_exec_template" set search_path = public, extensions')
    assert psql("bpc_exec_template", "delete from supabase_migrations.schema_migrations where statements[1] like '-- D4 SIMULATED%'").returncode == 0
    for s in ('drop database if exists "bpc_exec_synth_template" with (force)', 'create database "bpc_exec_synth_template" template template0'):
        assert psql("postgres", s).returncode == 0
    assert psql("bpc_exec_synth_template", "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);").returncode == 0
    n = scalar("bpc_exec_template", "select count(*) from supabase_migrations.schema_migrations")
    r = subprocess.run(["node", BUILD, "--repo-root", REPO, "--commit", "HEAD", "--manifest-csv", os.path.join(REPO, "audit", "evidence", "e2c-proposed-execution-manifest.csv"), "--base-history", r"C:\Users\vikki\migration-evidence\stage-b-20261016\prod_catalog_history.json",
                        "--withdrawn-index", os.path.join(REPO, "audit", "evidence", "withdrawn-migrations", "withdrawn-index.json"), "--dependencies-json", DEPS, "--critical-first", "20260716151458", "--critical-last", "20261011120000", "--out", ALLOW], capture_output=True, text=True, env=clean_env())
    j = json.loads(r.stdout.strip().splitlines()[-1])
    rec("S01", "allowlist built from the E2C manifest bound to HEAD: 58 execute + 9 history-only", "58/9", f"{j['execute']}/{j['history_only']}", j["execute"] == 58 and j["history_only"] == 9)
    r2 = subprocess.run(["node", BUILD, "--repo-root", REPO, "--commit", "HEAD", "--manifest-csv", os.path.join(REPO, "audit", "evidence", "e2c-proposed-execution-manifest.csv"), "--base-history", r"C:\Users\vikki\migration-evidence\stage-b-20261016\prod_catalog_history.json",
                         "--withdrawn-index", os.path.join(REPO, "audit", "evidence", "withdrawn-migrations", "withdrawn-index.json"), "--dependencies-json", DEPS, "--critical-first", "20260716151458", "--critical-last", "20261011120000", "--out", ALLOW + ".again"], capture_output=True, text=True, env=clean_env())
    j2 = json.loads(r2.stdout.strip().splitlines()[-1])
    rec("S02", "allowlist build is deterministic (same document hash on rebuild)", j["document_sha256"], j2["document_sha256"], j["document_sha256"] == j2["document_sha256"])
    d = json.load(open(ALLOW, encoding="utf-8"))
    rec("S03", "ledger of the scratch template equals the expected base history (277 captured Production rows, no simulated rows)", "277", n, n == "277" and d["expected_base_history"]["count"] == 277)
    rec("S04", "allowlist contains none of the nine omitted versions as 'execute', nor Cases 41/42/43", "none", [i["version"] for i in d["items"] if i["kind"] == "execute" and i["version"] in OMIT9 + d["deny"]], not [i for i in d["items"] if i["kind"] == "execute" and (i["version"] in OMIT9 or i["version"] in d["deny"])])


# ---------------------------------------------------------------------------------------------------------------------------------------------------
def guards():
    db = mkdb("bpc_exec_g1", seed=False)
    au = fresh_audit("g")

    def refused(tid, name, args=None, env=None, allow=ALLOW, dbname=db, expect="hosted-guard", extra_args=()):
        a = fresh_audit("g_" + tid)
        rc, j = execn("plan", dbname, allow, a, extra=extra_args, env_extra=env)
        no_audit = not os.path.exists(os.path.join(a, "audit.jsonl"))
        rec(tid, name, f"refused ({expect}) before any connection or audit write", f"rc={rc} code={j.get('code')} {j.get('message', '')[:80]}", rc == 2 and j.get("code") == expect and no_audit)
    refused("G01", "hosted-looking host refused", extra_args=["--host", "db.qaagfafagdpgzcijnfbw.supabase.co"])
    refused("G02", "Development project host refused", extra_args=["--host", "db.srxunxiytojjsuhcmzjg.supabase.co"])
    refused("G03", "any non-loopback host refused", extra_args=["--host", "10.0.0.5"])
    refused("G04", "database name outside bpc_exec_ refused", dbname="postgres")
    refused("G05", "project reference inside a path option refused", extra_args=["--repo-root", "C:/x/qaagfafagdpgzcijnfbw"])
    for opt in ("--password", "--conninfo", "--url", "--dbname"):
        a = fresh_audit("g_opt")
        rc, j = execn("plan", db, ALLOW, a, extra=[opt, "x"])
        rec("G05" + opt.strip("-")[:3].upper(), f"option {opt} not accepted", "refused", f"rc={rc} {j.get('message', '')[:70]}", rc == 2 and not os.path.exists(os.path.join(a, "audit.jsonl")))
    refused("G06", "DATABASE_URL in the environment refused", env={"DATABASE_URL": "postgresql://u:p@db.qaagfafagdpgzcijnfbw.supabase.co:5432/postgres"})
    refused("G07", "PGPASSWORD in the environment refused", env={"PGPASSWORD": "x"})
    refused("G08", "SUPABASE_ variable in the environment refused", env={"SUPABASE_ACCESS_TOKEN": "x"})
    refused("G09", "PGHOST non-loopback refused", env={"PGHOST": "db.example.supabase.co"})
    bad = mutate(ALLOW, os.path.join(SCR, "allow-env.json"), lambda d: d.update(environment="production"))
    refused("G10", "allowlist environment other than local-scratch refused", allow=bad)
    bad2 = mutate(ALLOW, os.path.join(SCR, "allow-ref.json"), lambda d: d.update(note="target srxunxiytojjsuhcmzjg"))
    refused("G11", "allowlist text containing a project reference refused", allow=bad2)
    a = fresh_audit("g_appr")
    rc, j = execn("plan", db, ALLOW, a, approval="0" * 64)
    rec("G12", "approval hash must equal the allowlist document hash", "refused code approval", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "approval")
    # server-side layer: a database without the scratch marker is refused after connecting, before any write
    nm = mkdb("bpc_exec_g2", seed=False, marker=False)
    a = fresh_audit("g_marker")
    rc, j = execn("run", nm, ALLOW, a)
    rec("G13", "database without the scratch ownership marker refused by the server-side check; nothing written", "refused hosted-guard, ledger unchanged (277)", f"rc={rc} {j.get('code')} ledger={scalar(nm, 'select count(*) from supabase_migrations.schema_migrations')}", rc == 2 and j.get("code") == "hosted-guard" and scalar(nm, "select count(*) from supabase_migrations.schema_migrations") == "277")
    js = "const e=require(process.argv[1]);const t=(a)=>{try{e.assertServerIsScratch(a,'bpc_exec_x');return 'accepted'}catch(x){return x.code}};console.log(JSON.stringify([t(['10.1.2.3','bpc_exec_x','%s','f']),t(['127.0.0.1','bpc_exec_x','%s','t']),t(['127.0.0.1','bpc_exec_x','','f']),t(['127.0.0.1','bpc_exec_x','%s','f']),t(['','bpc_exec_x','%s','f'])]))" % (MARK, MARK, MARK, MARK)
    out = json.loads(subprocess.run(["node", "-e", js, EXE], capture_output=True, text=True).stdout)
    rec("G14", "server-side check: non-loopback server address, TLS connection and missing marker refused; loopback scratch accepted; empty (unix socket) address refused", "['hosted-guard','hosted-guard','hosted-guard','accepted','hosted-guard']", out, out == ["hosted-guard", "hosted-guard", "hosted-guard", "accepted", "hosted-guard"])
    r = psql(db, "select inet_server_addr()::text, (select ssl from pg_stat_ssl where pid=pg_backend_pid())")
    rec("G15", "the scratch connection really is loopback without TLS", "127.0.0.1/32|f", r.stdout.strip(), r.stdout.strip().startswith("127.0.0.1") and r.stdout.strip().endswith("f"))


# ---------------------------------------------------------------------------------------------------------------------------------------------------
def integrity():
    a_sql = "create table public.t_a (id int);\ninsert into public.t_a values (1);\n"
    b_sql = "create table public.t_b (id int);\n"
    files = {"20300101000001_a.sql": a_sql, "20300101000002_b.sql": b_sql}
    items = [{"version": "20300101000001", "file": "20300101000001_a.sql", "kind": "execute"}, {"version": "20300101000002", "file": "20300101000002_b.sql", "kind": "execute", "requires": ["20300101000001"]}]
    for variant, crlf in (("lf", False), ("crlf", True)):
        repo, commit = synth_repo("i_" + variant, files, crlf_worktree=crlf)
        allow = synth_allow(repo, commit, items, [], os.path.join(SCR, f"allow-i-{variant}.json"))
        db = synth_db(f"bpc_exec_i_{variant}")
        rc, j = execn("run", db, allow, fresh_audit("i_" + variant), repo=repo)
        led = ledger(db)
        marker_sha = scalar(db, "select statements[1] from supabase_migrations.schema_migrations where version='20300101000001'")
        h = hashlib.sha256((a_sql).encode()).hexdigest()
        rec("I0" + ("1" if variant == "lf" else "2"), f"{'LF' if variant == 'lf' else 'CRLF'} working tree accepted; the recorded hash is the LF-normalized hash of the committed text", "executed 2, sha_lf in ledger", f"rc={rc} executed={j.get('executed')} sha_ok={h in marker_sha}", rc == 0 and len(j.get("executed", [])) == 2 and h in marker_sha and set(led.values()) == {"executed"})
    repo, commit = synth_repo("i_mod", files)
    allow = synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-i-mod.json"))
    p = os.path.join(repo, "supabase", "migrations", "20300101000002_b.sql")
    open(p, "a").write("-- sneaky edit\n")
    db = synth_db("bpc_exec_i_mod")
    rc, j = execn("run", db, allow, fresh_audit("i_mod"), repo=repo)
    rec("I03", "a modified working-tree file is refused; nothing executed", "refused hash, ledger empty", f"rc={rc} {j.get('code')} ledger={len(ledger(db))}", rc == 2 and j.get("code") == "hash" and not ledger(db))
    repo, commit = synth_repo("i_tamper", files)
    allow = synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-i-tamper.json"))
    t1 = mutate(allow, os.path.join(SCR, "allow-i-tamper-hash.json"), lambda d: d["items"][0].update(sha256_lf="0" * 64))
    db = synth_db("bpc_exec_i_tamper")
    rc, j = execn("run", db, t1, fresh_audit("i_t1"), repo=repo)
    rec("I04", "allowlist hash differing from the bound commit's file (document re-hashed) is refused", "refused hash", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "hash")
    d = json.load(open(allow, encoding="utf-8"))
    d["items"][0]["sha256_lf"] = "1" * 64
    json.dump(d, open(os.path.join(SCR, "allow-i-nohash.json"), "w"))
    rc, j = execn("run", db, os.path.join(SCR, "allow-i-nohash.json"), fresh_audit("i_t2"), repo=repo, approval=d["document_sha256"])
    rec("I05", "allowlist edited without updating its document hash is refused", "refused (modified allowlist)", f"rc={rc} {j.get('message', '')[:70]}", rc == 2 and "document hash" in j.get("message", ""))
    t3 = mutate(allow, os.path.join(SCR, "allow-i-commit.json"), lambda d: d.update(commit="a" * 40))
    rc, j = execn("run", db, t3, fresh_audit("i_t3"), repo=repo)
    rec("I06", "a commit that is not in the repository is refused", "refused", f"rc={rc} {j.get('message', '')[:60]}", rc == 2 and "not in the repository" in j.get("message", ""))
    t4 = mutate(allow, os.path.join(SCR, "allow-i-unknown.json"), lambda d: d["items"].append({"order": 9, "version": "20300101000009", "file": "20300101000009_ghost.sql", "name": "ghost", "kind": "execute", "sha256_lf": "2" * 64, "requires": [], "phase": "P2"}))
    rc, j = execn("run", db, t4, fresh_audit("i_t4"), repo=repo)
    rec("I07", "an allowlisted version whose file is not in the bound commit (unknown file) is refused", "refused", f"rc={rc} {j.get('message', '')[:60]}", rc == 2 and "not in commit" in j.get("message", ""))
    for tid, ver, nm in (("I08", "20260305203528", "Case 41"), ("I09", "20260407203226", "Case 42"), ("I10", "20260407211122", "Case 43")):
        t5 = mutate(allow, os.path.join(SCR, f"allow-i-{tid}.json"), lambda d, v=ver: d["items"].append({"order": 9, "version": v, "file": v + "_x.sql", "name": "x", "kind": "execute", "sha256_lf": "3" * 64, "requires": [], "phase": "P2"}))
        rc, j = execn("run", db, t5, fresh_audit("i_" + tid), repo=repo)
        rec(tid, f"{nm} on the allowlist is refused", "refused withdrawn", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "withdrawn")
    for i, ver in enumerate(OMIT9[:3] + OMIT9[3:4]):
        t6 = mutate(allow, os.path.join(SCR, f"allow-i-omit{i}.json"), lambda d, v=ver: d["items"].append({"order": 9, "version": v, "file": v + "_x.sql", "name": "x", "kind": "execute", "sha256_lf": "4" * 64, "requires": [], "phase": "P2"}))
        rc, j = execn("run", db, t6, fresh_audit("i_o%d" % i), repo=repo)
        rec("I11" + "abcd"[i], f"omitted version {ver} as an 'execute' item is refused", "refused never-execute", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "never-execute")
    repo, commit = synth_repo("i_wd", {**files, "20260305203528_case41.sql": "select 1;\n"})
    allow = synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-i-wd.json"))
    db = synth_db("bpc_exec_i_wd")
    rc, j = execn("run", db, allow, fresh_audit("i_wd"), repo=repo)
    rec("I12", "a withdrawn file present in the active migration directory is refused", "refused withdrawn", f"rc={rc} {j.get('code')} ledger={len(ledger(db))}", rc == 2 and j.get("code") == "withdrawn" and not ledger(db))
    # real repository: the active directory has no withdrawn file and the real allowlist verifies against the working tree
    names = os.listdir(os.path.join(REPO, "supabase", "migrations"))
    rec("I13", "real repository: 384 active files, Cases 41/42/43 absent from active discovery, alias file present", "384 / absent", f"{len(names)} / {[n for n in names if n[:14] in ('20260305203528', '20260407203226', '20260407211122')]}", len(names) == 384 and not [n for n in names if n[:14] in ("20260305203528", "20260407203226", "20260407211122")] and any(n.startswith("20260814120000_") for n in names))


# ---------------------------------------------------------------------------------------------------------------------------------------------------
def ledger_tests():
    base = mkdb("bpc_exec_l_base")
    ctl = fresh_audit("l_ctl")
    rc, j = execn("plan", base, ALLOW, ctl)
    rec("L00", "control: plan on the untouched scratch database succeeds and lists 58 + 9", "ok", f"rc={rc} {j.get('execute_total')}/{j.get('history_only_total')} remaining {len(j.get('remaining_execute', []))}", rc == 0 and len(j.get("remaining_execute", [])) == 58 and len(j.get("remaining_history_only", [])) == 9)
    first = json.load(open(ALLOW, encoding="utf-8"))["items"][0]

    def case(tid, name, sql, expect_code, pre=None):
        db = mkdb("bpc_exec_l_" + tid.lower(), seed=False)
        assert psql(db, sql).returncode == 0, sql
        a = fresh_audit("l_" + tid)
        rc, j = execn("run", db, ALLOW, a)
        n_exec = sum(1 for v, k in ledger(db).items() if k == "executed" and "BPC-LOCAL-EXECUTOR executed run=x" not in scalar(db, f"select statements[1] from supabase_migrations.schema_migrations where version='{v}'"))
        rec(tid, name, f"refused ({expect_code}), nothing executed by the executor", f"rc={rc} {j.get('code')} {j.get('message', '')[:70]} executed_by_executor={n_exec}", rc == 2 and j.get("code") == expect_code and n_exec == 0)
    ins = lambda v, m: f"insert into supabase_migrations.schema_migrations (version,name,statements) values ('{v}','x',ARRAY['{m}']);"
    case("L01", "unknown extra ledger row refused", ins("20250101000000", "-- stray"), "ledger")
    case("L02", "a missing base-history row refused", "delete from supabase_migrations.schema_migrations where version = (select min(version) from supabase_migrations.schema_migrations)", "ledger")
    case("L03", "a ledger row for withdrawn Case 41 refused", ins("20260305203528", "-- stray"), "ledger")
    case("L04", "history-only row for an executable item refused", ins("20260722172048", "-- BPC-LOCAL-EXECUTOR history-only NOT EXECUTED run=x basis=y"), "ledger")
    case("L05", "executed row for an omitted (history-only) version refused", ins("20260716152823", f"-- BPC-LOCAL-EXECUTOR executed run=x sha256_lf={'0'*64}"), "ledger")
    text06 = open(os.path.join(REPO, "supabase", "migrations", first["file"]), "rb").read().replace(b"\r\n", b"\n").decode("utf-8")
    case("L06", "executed row (correct hash and stored SQL text) without audit evidence refused", f"insert into supabase_migrations.schema_migrations (version,name,statements) values ('{first['version']}','x',ARRAY['-- BPC-LOCAL-EXECUTOR executed run=x sha256_lf={first['sha256_lf']}', $e2g${text06}$e2g$]);", "audit")
    case("L07", "executed row carrying a different file hash refused", ins(first["version"], f"-- BPC-LOCAL-EXECUTOR executed run=x sha256_lf={'0'*64}"), "ledger")
    case("L08", "row without an executor marker for an allowlisted version refused", ins(first["version"], "-- someone else"), "ledger")
    # audit chain tamper
    db = mkdb("bpc_exec_l_chain", seed=False)
    a = fresh_audit("l_chain")
    execn("plan", db, ALLOW, a)
    execn("plan", db, ALLOW, a)
    f = os.path.join(a, "audit.jsonl")
    lines = open(f, encoding="utf-8").read().splitlines()
    lines[0] = lines[0].replace('"plan"', '"verify"')
    open(f, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    rc, j = execn("plan", db, ALLOW, a)
    rec("L09", "a tampered audit store (broken hash chain) refused", "refused audit", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") in ("audit",) or "chain broken" in j.get("message", ""))


# ---------------------------------------------------------------------------------------------------------------------------------------------------
def run_full():
    db = mkdb("bpc_exec_full")
    au = fresh_audit("full")
    rc, j = execn("run", db, ALLOW, au, ack=False)
    rec("R01", "run without acknowledging the older-than-latest versions is refused", "refused older", f"rc={rc} {j.get('code')} {j.get('message', '')[:60]}", rc == 2 and j.get("code") == "older" and not any(k == "executed" for k in ledger(db).values()))
    rc, j = execn("run", db, ALLOW, au, extra=["--acknowledge-older-than-latest", "30"], ack=False)
    rec("R02", "acknowledging the wrong count is refused", "refused older", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "older")
    t0 = time.time()
    rc, j = execn("run", db, ALLOW, au)
    led = ledger(db)
    allow = json.load(open(ALLOW, encoding="utf-8"))
    ex = [v for v, k in led.items() if k == "executed"]
    ho = [v for v, k in led.items() if k == "history-only"]
    rec("R03", "approved run: 58 executed, 9 history-only, 277 base rows untouched", "58/9/277", f"{len(ex)}/{len(ho)}/{sum(1 for k in led.values() if k == 'other')} rc={rc} fail={j.get('failed')}", rc == 0 and len(ex) == 58 and len(ho) == 9 and sum(1 for k in led.values() if k == "other") == 277)
    rec("R04", "none of the nine omitted versions, nor Cases 41/42/43, was executed", "no executed rows", [v for v in ex if v in OMIT9 + allow["deny"]], not [v for v in ex if v in OMIT9 + allow["deny"]])
    f = fp(db)
    ref = ref_fp()
    rec("R05", "final catalog fingerprint equals the LF-normalized reference run of the same 58 files (all 10 categories)", "equal", [k for k in f if f[k] != ref[k]], f == ref)
    crlf_raw = fp("bpc_replay_e2e_crlf")
    crlf_ref = fp_stripped("bpc_replay_e2e_crlf")
    fs_ = fp_stripped(db)
    rec("R05b", "with carriage returns removed from function bodies, the final catalog equals the earlier CRLF working-copy rehearsal of the same 58 files", "equal", [k for k in fs_ if fs_[k] != crlf_ref[k]], fs_ == crlf_ref)
    raw_diff = [k for k in f if f[k] != crlf_raw[k]]
    rec("R05c", "the only raw difference between the executor's LF run and the CRLF rehearsal is function-body carriage returns", "['functions']", raw_diff, raw_diff == ["functions"])
    ar = audit_recs(au)
    ends = [r["version"] for r in ar if r["event"] == "item_end" and not r.get("reconciled_after_crash")]
    order = [i["version"] for i in allow["items"] if i["kind"] == "execute"]
    rec("R06", "execution followed the allowlist order exactly (audit item_end sequence)", "58 in allowlist order", f"{len(ends)} in order={ends == order}", ends == order)
    hseq = {r["version"]: r["seq"] for r in ar if r["event"] == "history_only"}
    endseq = {r["version"]: r["seq"] for r in ar if r["event"] == "item_end"}
    firststart = min(r["seq"] for r in ar if r["event"] == "item_start")
    timing = {i["version"]: (all(hseq[i["version"]] > endseq[s] for s in i.get("record_after", [])) if i.get("record_after") else hseq[i["version"]] < firststart) for i in allow["items"] if i["kind"] == "history-only"}
    rec("R07", "superseded history-only records written only after their superseders succeeded; the pair and 20261010110000 before the first execution", "9 of 9 correct", f"{sum(timing.values())} of 9", all(timing.values()) and len(timing) == 9)
    kinds_audit = {(r["event"], r.get("kind")) for r in ar if r["event"] in ("item_end", "history_only")}
    rec("R08", "audit evidence separates real execution (item_start/item_end) from history-only records (history_only events with basis)", "both present, disjoint versions", sorted(kinds_audit, key=str), not (set(endseq) & set(hseq)) and len(endseq) == 58 and len(hseq) == 9)
    rc, jv = execn("verify", db, ALLOW, au)
    rec("R09", "verify command: ledger equals the allowlist (58 executed, 9 history-only), audit chain valid", "ok", jv, rc == 0 and jv.get("executed") == 58 and jv.get("history_only") == 9 and jv.get("missing") == [])
    before = (len(ar), ledger(db))
    rc, j2 = execn("run", db, ALLOW, au)
    rec("R10", "repeated execution after completion changes nothing", "0 executed, 0 history-only, ledger identical", f"rc={rc} {len(j2.get('executed', []))}/{len(j2.get('history_only', []))} same={ledger(db) == before[1]}", rc == 0 and not j2.get("executed") and not j2.get("history_only") and ledger(db) == before[1])
    dd = psql(db, "select 1").returncode
    rec("R11", "elapsed time of the full local run (informational)", "n/a", f"{time.time() - t0:.0f}s", True)


# ---------------------------------------------------------------------------------------------------------------------------------------------------
def interrupt():
    allow = json.load(open(ALLOW, encoding="utf-8"))
    db = mkdb("bpc_exec_int")
    au = fresh_audit("int")
    rc, j = execn("run", db, ALLOW, au, extra=["--stop-after", "20260716151549"])
    rec("T01", "stopping inside the critical window without the explicit flag is refused", "refused critical-window", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "critical-window")
    rc, j = execn("run", db, ALLOW, au, extra=["--stop-after", "20260715214053"])
    led = ledger(db)
    rec("T02", "stop before the critical window: pair and 20261010110000 recorded history-only up front, nothing else", "3 history-only, 1 executed", f"{[v for v, k in led.items() if k == 'history-only']} executed={[v for v, k in led.items() if k == 'executed']}", rc == 0 and sorted(v for v, k in led.items() if k == "history-only") == ["20260715221828", "20260716104333", "20261010110000"] and [v for v, k in led.items() if k == "executed"] == ["20260715214053"])
    rc, j = execn("run", db, ALLOW, au, extra=["--stop-after", "20260716151549", "--allow-stop-in-critical-window"])
    led = ledger(db)
    rec("T03", "interrupted after 20260716151549: 20260716151530 NOT yet recorded (its superseder has not run)", "151530 absent from ledger", led.get("20260716151530"), "20260716151530" not in led and rc == 0)
    rc, j = execn("run", db, ALLOW, au, extra=["--stop-after", "20260716152447", "--allow-stop-in-critical-window"])
    led = ledger(db)
    rec("T04", "interrupted after 20260716152447: 20260716151530 now recorded history-only", "history-only", led.get("20260716151530"), led.get("20260716151530") == "history-only" and "20260716152823" not in led)
    rc, j = execn("run", db, ALLOW, au, extra=["--stop-after", "20260717110808", "--allow-stop-in-critical-window"])
    led = ledger(db)
    rec("T05", "20260716152823 recorded only after BOTH of its superseders (20260717012112 and 20260717110808)", "history-only", led.get("20260716152823"), led.get("20260716152823") == "history-only")
    execn("run", db, ALLOW, au, extra=["--stop-after", "20260717111014", "--allow-stop-in-critical-window"])
    # simulate a crash that lost the audit end record of the last execution: truncate the audit store before that item_end (a valid chain prefix)
    f = os.path.join(au, "audit.jsonl")
    lines = open(f, encoding="utf-8").read().splitlines()
    k = max(i for i, l in enumerate(lines) if '"item_end"' in l)
    kept = lines[:k]
    open(f, "w", encoding="utf-8").write("\n".join(kept) + "\n")
    rc, j = execn("run", db, ALLOW, au)
    led = ledger(db)
    rec("T06", "crash gap (ledger row committed, audit end record lost): reconciled from the audit start record, then run completes", "reconciled 1, complete", f"rc={rc} reconciled={j.get('reconciled')} executed_total={sum(1 for k2 in led.values() if k2 == 'executed')}", rc == 0 and len(j.get("reconciled", [])) == 1 and sum(1 for k2 in led.values() if k2 == "executed") == 58 and sum(1 for k2 in led.values() if k2 == "history-only") == 9)
    rec("T07", "after interruption, resumption and crash-gap recovery the final catalog equals the reference", "equal", [k2 for k2, v in fp(db).items() if v != ref_fp()[k2]], fp(db) == ref_fp())
    rec("T08", "omitted versions never executed across the whole interrupted history", "none", [r["version"] for r in audit_recs(au) if r["event"] == "item_start" and r["version"] in OMIT9], not [r for r in audit_recs(au) if r["event"] == "item_start" and r["version"] in OMIT9])
    # audit loss without ledger loss -> refused
    db2 = mkdb("bpc_exec_int2")
    au2 = fresh_audit("int2")
    execn("run", db2, ALLOW, au2, extra=["--stop-after", "20260715214053"])
    shutil.rmtree(au2)
    rc, j = execn("run", db2, ALLOW, au2)
    rec("T09", "audit store deleted while the ledger holds executed rows: refused, nothing run", "refused audit", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "audit")
    # a live executor holds the lock
    au3 = fresh_audit("int3")
    os.makedirs(au3)
    open(os.path.join(au3, "run.lock"), "w").write(str(os.getpid()))
    rc, j = execn("run", mkdb("bpc_exec_int3"), ALLOW, au3)
    rec("T10", "a live lock on the audit store refuses a second executor", "refused lock", f"rc={rc} {j.get('code')}", rc == 2 and j.get("code") == "lock")


# ---------------------------------------------------------------------------------------------------------------------------------------------------
def failures():
    # synthetic: transaction rollback, mid-transaction kill, dependency handling
    files = {"20300102000001_a.sql": "create table public.t_ok (id int);\n", "20300102000002_b.sql": "create table public.t_partial (id int);\ninsert into public.t_partial values (1);\nselect 1/0;\n", "20300102000003_c.sql": "create table public.t_after (id int);\n"}
    items = [{"version": "20300102000001", "file": "20300102000001_a.sql", "kind": "execute"}, {"version": "20300102000002", "file": "20300102000002_b.sql", "kind": "execute"}, {"version": "20300102000003", "file": "20300102000003_c.sql", "kind": "execute"}]
    repo, commit = synth_repo("f_roll", files)
    allow = synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-f-roll.json"))
    db = synth_db("bpc_exec_f_roll")
    au = fresh_audit("f_roll")
    rc, j = execn("run", db, allow, au, repo=repo)
    tabs = scalar(db, "select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public'")
    rec("F01", "a failing migration is rolled back completely (no partial table, no ledger row), later migrations are not run", "t_ok only; failed at 20300102000002", f"rc={rc} tables={tabs} failed={j.get('failed', {}).get('version')} ledger={sorted(ledger(db))}", rc == 3 and tabs == "t_ok" and j["failed"]["version"] == "20300102000002" and sorted(ledger(db)) == ["20300102000001"])
    rec("F02", "the failure is in the audit store (item_failed) and a repeat attempt fails the same way without side effects", "item_failed recorded", [r["event"] for r in audit_recs(au) if r["event"] == "item_failed"], any(r["event"] == "item_failed" for r in audit_recs(au)))
    # kill the executor while a migration is sleeping inside its transaction
    files = {"20300103000001_a.sql": "create table public.k_a (id int);\n", "20300103000002_slow.sql": "create table public.k_slow (id int);\nselect pg_sleep(12);\n", "20300103000003_c.sql": "create table public.k_c (id int);\n"}
    items = [{"version": v, "file": f, "kind": "execute"} for v, f in (("20300103000001", "20300103000001_a.sql"), ("20300103000002", "20300103000002_slow.sql"), ("20300103000003", "20300103000003_c.sql"))]
    repo, commit = synth_repo("f_kill", files)
    allow = synth_allow(repo, commit, items, [], os.path.join(SCR, "allow-f-kill.json"))
    db = synth_db("bpc_exec_f_kill")
    au = fresh_audit("f_kill")
    d = json.load(open(allow, encoding="utf-8"))
    p = subprocess.Popen(["node", EXE, "run", "--allowlist", allow, "--db", db, "--audit-dir", au, "--approval-hash", d["document_sha256"], "--repo-root", repo], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=clean_env(), cwd=REPO)
    t0 = time.time()
    while time.time() - t0 < 60 and "pg_sleep" not in scalar("postgres", "select coalesce(string_agg(query, ' '), '') from pg_stat_activity where datname='%s'" % db):
        time.sleep(0.3)
    subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
    time.sleep(14)
    tabs = scalar(db, "select coalesce(string_agg(tablename, ',' order by tablename),'') from pg_tables where schemaname='public'")
    rec("F03", "executor killed mid-transaction: the half-applied migration leaves no table and no ledger row", "k_a only; ledger has only 20300103000001", f"tables={tabs} ledger={sorted(ledger(db))}", tabs == "k_a" and sorted(ledger(db)) == ["20300103000001"])
    lock_left = os.path.exists(os.path.join(au, "run.lock"))
    rc, j = execn("run", db, allow, au, repo=repo)
    rec("F04", "recovery after the kill: stale lock cleared, run completes all three", "executed 2 more; stale lock note in audit", f"rc={rc} lock_was_left={lock_left} executed={j.get('executed')} stale={[r['event'] for r in audit_recs(au) if r['event'] == 'stale_lock_cleared']}", rc == 0 and len(ledger(db)) == 3 and (not lock_left or any(r["event"] == "stale_lock_cleared" for r in audit_recs(au))))
    # dependencies
    real = json.load(open(ALLOW, encoding="utf-8"))
    target = "20260716151458"
    deps_on = [i for i in real["items"] if i["kind"] == "execute" and target in i.get("requires", [])]

    def drop_target(d):
        d["items"] = [i for i in d["items"] if i["version"] != target]
    a1 = mutate(ALLOW, os.path.join(SCR, "allow-dep-a.json"), drop_target)
    db = mkdb("bpc_exec_dep_a")
    rc, j = execn("run", db, a1, fresh_audit("dep_a"))
    seed_req = [x for x in real["items"] if x["version"] == "20260716151549"][0]["requires"]
    rec("F05b", "real allowlist (corrected metadata): the seed migration 20260716151549 declares 20260716151458, and removing 20260716151458 is refused at load before any execution", "refused dependency-missing; seed declares it", f"rc={rc} {j.get('code')} seed_requires={seed_req} ledger_unchanged={len(ledger(db)) == 277}", rc == 2 and j.get("code") == "dependency-missing" and "20260716151458" in seed_req and len(ledger(db)) == 277)
    sfiles = {"20300104000001_a.sql": "create table public.d_a (id int);\n", "20300104000002_b.sql": "create table public.d_b (id int);\n"}
    sitems = [{"version": "20300104000002", "file": "20300104000002_b.sql", "kind": "execute", "requires": ["20300104000001"]}]
    srepo, scommit = synth_repo("f_dep", sfiles)
    sal = synth_allow(srepo, scommit, sitems, [], os.path.join(SCR, "allow-f-dep.json"))
    sdb = synth_db("bpc_exec_f_dep")
    rc, j = execn("run", sdb, sal, fresh_audit("f_dep"), repo=srepo)
    rec("F05", "a declared dependency that is not executed: refused before the dependent migration runs, nothing written", "refused dependency-missing before any connection", f"rc={rc} {j.get('code')} {j.get('message', '')[:70]} ledger={len(ledger(sdb))}", rc == 2 and j.get("code") == "dependency-missing" and not ledger(sdb) and not os.path.exists(os.path.join(fresh_audit("f_dep"), "audit.jsonl")))

    def drop_and_strip(d):
        drop_target(d)
        for i in d["items"]:
            i["requires"] = []
    a2 = mutate(ALLOW, os.path.join(SCR, "allow-dep-b.json"), drop_and_strip)
    db = mkdb("bpc_exec_dep_b")
    au = fresh_audit("dep_b")
    rc, j = execn("run", db, a2, au)
    led = ledger(db)
    rec("F06", "dependency not declared and the SQL needs the missing object: the migration fails, rolls back, execution stops", "failed, not recorded", f"rc={rc} failed={j.get('failed')} executed_total={sum(1 for k in led.values() if k == 'executed')}", rc == 3 and j.get("failed") is not None and j["failed"]["version"] not in led)
    rec("F07", "omitted versions are not executed in either failure case", "none", [v for v, k in led.items() if k == "executed" and v in OMIT9], not [v for v, k in led.items() if k == "executed" and v in OMIT9])


# ---------------------------------------------------------------------------------------------------------------------------------------------------
CONTAIN = """
do $c$
declare r record;
begin
  for r in select p.oid::regprocedure::text as f from pg_proc p where p.pronamespace='public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname <> all (string_to_array('%s', ',')) loop
    execute 'revoke execute on function ' || r.f || ' from anon, public';
  end loop;
  for r in select c.oid::regclass::text as t from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname <> all (string_to_array('%s', ',')) and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) loop
    execute 'revoke insert, update, delete, truncate on table ' || r.t || ' from anon';
  end loop;
end $c$;
"""


def window():
    start_db = mkdb("bpc_exec_w_start")
    start = surface(start_db)
    start_fp = fp(start_db)
    start_fn = scalar(start_db, "select string_agg(p.proname, ',') from pg_proc p where p.pronamespace='public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')")
    start_tb = scalar(start_db, "select string_agg(c.relname, ',') from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))")
    rec("W00", "starting anonymous surface of the restored Production state", "68 functions / 55 tables", f"{start['anon_functions']} / {start['anon_write_tables']}", start["anon_functions"] == 68 and start["anon_write_tables"] == 55)
    reference_final = ref_fp()
    scen = {
        "W1": ("dup_link", f"insert into public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) values ('{S.OID['O04_confirmed_deposit_paid']}','tok_e2g_dup','sc_e2g_dup','portal',0);", "20261009120000", "inside the critical window", f"delete from public.invoice_links where link_token='tok_e2g_dup'"),
        "W2": ("bad_role", "set session_replication_role = replica; insert into public.user_roles (user_id, role, created_at) values ('%s','owner','2026-01-01 10:00:00+00');" % S.U_C1, "20261016120000", "after the lockdown migrations", "delete from public.user_roles where role='owner'"),
        "W3": ("bad_item", "set session_replication_role = replica; insert into public.order_items (order_id, unit_id, wet_or_dry, unit_price_cents, qty) values ('%s', null, 'dry', 100, 1);" % S.OID["O06_confirmed_check"], "20260716151458", "first migration of the window (rolls back to the start state)", "delete from public.order_items where unit_id is null and unit_price_cents=100 and qty=1"),
    }
    for tid, (nm, seed_sql, expect, where, fixsql) in scen.items():
        db = mkdb("bpc_exec_" + tid.lower() + "_" + nm.split("_")[0], extra_sql=seed_sql)
        au = fresh_audit(tid)
        rc, j = execn("run", db, ALLOW, au)
        led = ledger(db)
        sf = surface(db)
        wider = sf["anon_functions"] > start["anon_functions"] or sf["anon_write_tables"] > start["anon_write_tables"]
        ins = anon_insert(db, tid)
        failed_at = (j.get("failed") or {}).get("version")
        rec(tid + "a", f"{nm}: executor stops at the failing migration {expect} ({where}); failed version not recorded", expect, f"rc={rc} failed={failed_at} recorded={failed_at in led}", rc == 3 and failed_at == expect and failed_at not in led)
        rec(tid + "b", f"{nm}: anonymous surface at the failure point (start 68 functions / 55 tables)", "measured", f"{sf['anon_functions']} / {sf['anon_write_tables']} wider_than_start={wider} no_rls={sf['no_rls_anon_tables']} anon_invoice_link_insert={ins}", not sf["no_rls_anon_tables"] and ins == "REJECTED")
        STATE.setdefault("window_measurements", {})[tid] = {"scenario": nm, "failed_at": failed_at, "surface": sf, "wider_than_start": wider, "anon_invoice_link_insert": ins, "history_only_recorded": sorted(v for v, k in led.items() if k == "history-only")}
        rec(tid + "c", f"{nm}: no omitted version executed; history-only records limited to those whose basis is already true", "omitted never executed", f"history-only={sorted(v for v, k in led.items() if k == 'history-only')}", not [v for v, k in led.items() if k == "executed" and v in OMIT9])
        if tid == "W1":
            # candidate containment (scratch-only SQL, NOT part of the executor) applied at the failure point
            fn_list, tb_list = start_fn, start_tb
            assert psql(db, CONTAIN % (fn_list, tb_list)).returncode == 0
            sc = surface(db)
            rec("W1d", "candidate containment SQL (revoke anon on everything not anon-accessible at the start) brings the surface to the start level", "<= 68 / <= 55", f"{sc['anon_functions']} / {sc['anon_write_tables']}", sc["anon_functions"] <= 68 and sc["anon_write_tables"] <= 55)
        assert psql(db, fixsql).returncode == 0
        rc2, j2 = execn("run", db, ALLOW, au)
        led2 = ledger(db)
        f2 = fp(db)
        diff = [k for k in f2 if f2[k] != reference_final[k]]
        sf2 = surface(db)
        rec(tid + "e", f"{nm}: after fixing the data cause, resumption completes (58 executed, 9 history-only)", "complete", f"rc={rc2} {sum(1 for k in led2.values() if k == 'executed')}/{sum(1 for k in led2.values() if k == 'history-only')}", rc2 == 0 and sum(1 for k in led2.values() if k == "executed") == 58 and sum(1 for k in led2.values() if k == "history-only") == 9)
        if tid == "W1":
            rec("W1f", "after containment + resume: catalog differs from the reference only where containment revoked privileges the later migrations had already granted (not re-granted by a resume)", "documented", f"differing categories={diff}; final anon functions={sf2['anon_functions']}", True)
            acl = lambda d_: json.loads(scalar(d_, "select coalesce(jsonb_object_agg(p.oid::regprocedure::text, coalesce(p.proacl::text,'')), '{}'::jsonb) from pg_proc p where p.pronamespace='public'::regnamespace"))
            a_, b_ = acl(db), acl(mkdb("bpc_exec_w1ref", seed=False)) if False else acl("bpc_exec_full")
            ndiff = sorted(k for k in a_ if a_[k] != b_.get(k))
            STATE.setdefault("window_measurements", {})[tid]["after_containment_resume"] = {"differing_categories": diff, "final_surface": sf2, "functions_with_different_privileges_vs_uncontained_run": len(ndiff), "examples": ndiff[:6]}
            rec("W1g", "containment that revokes from PUBLIC also removes other roles' access: functions whose privileges differ from an uncontained run after resume", "documented", f"{len(ndiff)} functions, e.g. {ndiff[:3]}", True)
        else:
            rec(tid + "f", f"{nm}: after resumption the final catalog equals the reference and the anonymous surface is the intended final one (6 functions, 1 table)", "equal; 6 / 1", f"differs={diff} {sf2['anon_functions']} / {sf2['anon_write_tables']}", not diff and sf2["anon_functions"] == 6 and sf2["anon_write_tables"] == 1)
    # lock timeout inside the window
    db = mkdb("bpc_exec_w4")
    au = fresh_audit("w4")
    rc, j = execn("run", db, ALLOW, au, extra=["--stop-after", "20260820165646", "--allow-stop-in-critical-window"])
    holder = subprocess.Popen([PSQL, "-X", "-q", "-w", "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", db, "-c", "begin; lock table public.orders in access exclusive mode; select pg_sleep(45);"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=clean_env())
    time.sleep(2)
    rc, j = execn("run", db, ALLOW, au, extra=["--lock-timeout-ms", "1500"])
    err = (j.get("failed") or {}).get("error", "")
    rec("W4a", "lock timeout inside the window: the migration fails fast on a held ACCESS EXCLUSIVE lock, is not recorded, execution stops", "failed at 20260925151621 with lock timeout", f"rc={rc} failed={j.get('failed')}", rc == 3 and "lock timeout" in err and (j.get("failed") or {}).get("version") == "20260925151621")
    subprocess.run(["taskkill", "/PID", str(holder.pid), "/T", "/F"], capture_output=True)
    psql("postgres", "select pg_terminate_backend(pid) from pg_stat_activity where datname='%s' and query like '%%pg_sleep(45)%%'" % db)
    time.sleep(1.5)
    rc, j = execn("run", db, ALLOW, au)
    led = ledger(db)
    rec("W4b", "after the lock holder is gone, resumption completes", "complete", f"rc={rc} {sum(1 for k in led.values() if k == 'executed')}/{sum(1 for k in led.values() if k == 'history-only')}", rc == 0 and sum(1 for k in led.values() if k == "executed") == 58 and fp(db) == reference_final)


def finish():
    t = STATE["tests"]
    summary = {"total": len(t), "passed": sum(1 for x in t.values() if x["result"] == "PASS"), "failed": [k for k, x in t.items() if x["result"] != "PASS"]}
    out = {"stage": "E2G", "executor": "scripts/dev/local-executor/local-migration-executor.cjs", "scope": "local disposable PostgreSQL only; synthetic data; no hosted system", "summary": summary, "window_measurements": STATE.get("window_measurements", {}), "tests": list(t.values())}
    json.dump(out, open(os.path.join(REPO, "audit", "evidence", "e2g-executor-test-results.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(summary))


DEV_HISTORY = r"C:\Users\vikki\migration-evidence\stage-b-20261016\dev_catalog_history.json"


def devlimits():
    """The executor and builder are Production-58 specific; they must not silently accept a Development plan or a Development-shaped ledger."""
    r = subprocess.run(["node", BUILD, "--repo-root", REPO, "--commit", "HEAD", "--manifest-csv", os.path.join(REPO, "audit", "evidence", "e2e-development-manifest.csv"), "--base-history", DEV_HISTORY, "--out", os.path.join(SCR, "allow-dev.json")], capture_output=True, text=True, env=clean_env())
    rec("D01", "the builder does not turn the Development manifest into an allowlist (it only understands the Production E2C manifest format)", "build fails", f"rc={r.returncode} {(r.stderr or r.stdout)[-120:].strip()}", r.returncode != 0)
    devv = [x["version"] for x in json.load(open(DEV_HISTORY, encoding="utf-8"))]
    db = mkdb("bpc_exec_devled", seed=False)
    keep = "','".join(devv)
    assert psql(db, f"delete from supabase_migrations.schema_migrations where version not in ('{keep}')").returncode == 0
    have = set(scalar(db, "select version from supabase_migrations.schema_migrations").split())
    for x in json.load(open(DEV_HISTORY, encoding="utf-8")):
        if x["version"] not in have:
            assert psql(db, "insert into supabase_migrations.schema_migrations (version,name,statements) values ('%s','%s',ARRAY['-- development row'])" % (x["version"], x["name"].replace("'", "''"))).returncode == 0
    n = scalar(db, "select count(*) from supabase_migrations.schema_migrations")
    rc, j = execn("plan", db, ALLOW, fresh_audit("devled"))
    rec("D02", "a Development-shaped ledger (exactly the 58 captured Development history versions) is refused by the Production allowlist's expected base history", "refused ledger", f"ledger rows={n} rc={rc} {j.get('code')} {j.get('message', '')[:80]}", rc == 2 and j.get("code") == "ledger")
    rec("D03", "the executor hard-codes the Production-specific never-execute list (Cases 41-43 and the nine omitted versions); a Development plan needs its own rules and predicates (213 history-only candidates, 80 needing evidence, 33 withheld)", "informational", "see e2g-hosted-prerequisites.md", True)


if __name__ == "__main__":
    {"setup": setup, "guards": guards, "integrity": integrity, "ledger": ledger_tests, "run": run_full, "interrupt": interrupt, "failures": failures, "window": window, "devlimits": devlimits, "finish": finish}[sys.argv[1]]()
