"""Stage D3, step 2: select the exact upgrade migration set and execute it, in version order, against the restored Production-schema scratch
database (bpc_replay_d3_snapshot, built by d3_restore.py). Local PostgreSQL only; no hosted system is contacted.
Upgrade set = versions pending in Production's captured history
              - the 40 baseline versions (older than Production's first recorded version; bookkeeping only)
              - the related-version cases 41/42 (bookkeeping only; documented in audit/evidence/version-aliases.json)
            = 44 Development-line files + 23 October files (expected 67).
Excluded from SQL execution: all 277 Production-recorded versions, the 42 reconciliation-only versions, withdrawn Case 43.
Usage: python -I d3_upgrade.py manifest | run
"""
import csv
import hashlib
import json
import os
import re
import subprocess
import sys

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
MIG = os.path.join(REPO, "supabase", "migrations")
EVID = os.path.join(REPO, "audit", "evidence")
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\d3-scratch"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
DB = "bpc_replay_d3_snapshot"
assert re.match(r"^bpc_replay_[a-z0-9_]{1,32}$", DB)


def psql(args, text=None, db=DB):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    env.update(PGCLIENTENCODING="UTF8")
    return subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-d", db, *args], capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, input=text)


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def build_manifest():
    files = sorted(f for f in os.listdir(MIG) if re.match(r"^\d{14}_.+\.sql", f))
    local = {f[:14]: f for f in files}
    assert len(local) == len(files) == 386
    prod = {x["version"] for x in json.load(open(os.path.join(PROT, "prod_catalog_history.json"), encoding="utf-8"))}
    assert len(prod) == 277
    pending = sorted(set(local) - prod)
    assert len(pending) == 109
    first = min(prod)
    baseline = [v for v in pending if v < first]
    aliases = json.load(open(os.path.join(EVID, "version-aliases.json"), encoding="utf-8"))
    alias_local = [a["local_version"] for a in aliases["aliases"] if a["env"] == "prod"]
    assert sorted(alias_local) == ["20260305203528", "20260407203226"]
    recon = sorted(set(baseline) | set(alias_local))
    upgrade = [v for v in pending if v not in recon]
    october = [v for v in upgrade if v >= "20261007000000"]
    dev_line = [v for v in upgrade if v < "20261007000000"]
    assert len(baseline) == 40 and len(recon) == 42 and len(upgrade) == 67 and len(october) == 23 and len(dev_line) == 44, (len(baseline), len(recon), len(upgrade), len(october), len(dev_line))
    assert "20260407211122" not in local
    matrix = {r["version"]: r for r in csv.DictReader(open(os.path.join(EVID, "version-matrix-all-387.csv"), encoding="utf-8"))}
    cls = {r["version"]: r for r in csv.DictReader(open(os.path.join(EVID, "prod-pending-110.csv"), encoding="utf-8"))}
    rows = []
    for i, v in enumerate(upgrade):
        m, c = matrix[v], cls[v]
        rows.append({"order": i + 1, "version": v, "file": local[v], "group": "october" if v >= "20261007000000" else "development-line", "sha256": sha(os.path.join(MIG, local[v])),
                     "stage_b_prod_class": c["class"], "data_stmts_ins_upd_del_trunc": m["data_stmts"], "grant_revoke_stmts": m["grant_revoke_stmts"], "dynamic_sql": m["dynamic_sql"],
                     "precedes_production_latest_recorded": v < max(prod)})
    cat = "\n".join(f"{r['version']} {r['file']} {r['sha256']}" for r in rows)
    man = {"derivation": "pending (repository - Production recorded) minus 40 baseline versions minus cases 41/42 = 44 Development-line + 23 October",
           "counts": {"repository": len(local), "production_recorded": len(prod), "technically_pending": len(pending), "reconciliation_only": len(recon), "upgrade_sql": len(upgrade), "development_line": len(dev_line), "october": len(october)},
           "upgrade_manifest_sha256": hashlib.sha256(cat.encode()).hexdigest(), "upgrade_versions_sha256": hashlib.sha256("\n".join(upgrade).encode()).hexdigest(),
           "reconciliation_only_versions": [{"version": v, "file": local[v], "kind": "baseline" if v in baseline else "case 41/42 related version"} for v in recon],
           "excluded_notes": "277 Production-recorded versions and withdrawn Case 43 are not part of the SQL set", "upgrade": rows,
           "versions_preceding_production_latest_recorded": sum(r["precedes_production_latest_recorded"] for r in rows), "production_latest_recorded": max(prod)}
    return man, local, recon


# compact fingerprints per catalog category (public, storage, auth, realtime); used to show which categories each migration changed
FP = """select json_build_object(
 'tables',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select n.nspname||'.'||c.relname||c.relkind::text||c.relrowsecurity||c.relforcerowsecurity||pg_get_userbyid(c.relowner)||coalesce(c.relacl::text,'') x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage','auth','realtime') and c.relkind in ('r','p','v','m','S')) s),
 'columns',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select c.relnamespace::regnamespace||'.'||c.relname||'.'||a.attname||format_type(a.atttypid,a.atttypmod)||a.attnotnull||coalesce(pg_get_expr(d.adbin,d.adrelid),'')||a.attidentity::text||a.attgenerated::text||coalesce(a.attacl::text,'') x from pg_attribute a join pg_class c on c.oid=a.attrelid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m') and c.relnamespace::regnamespace::text in ('public','storage','auth','realtime')) s),
 'constraints',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select c.conrelid::regclass||'.'||c.conname||pg_get_constraintdef(c.oid)||c.convalidated x from pg_constraint c where c.connamespace::regnamespace::text in ('public','storage','auth','realtime')) s),
 'indexes',(select md5(coalesce(string_agg(indexdef,'|' order by indexdef),''))||':'||count(*) from pg_indexes where schemaname in ('public','storage','auth','realtime')),
 'triggers',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select pg_get_triggerdef(t.oid)||t.tgenabled::text x from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace::regnamespace::text in ('public','storage','auth','realtime')) s),
 'functions',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select p.oid::regprocedure::text||md5(p.prosrc)||p.prosecdef::text||coalesce(p.proconfig::text,'')||pg_get_userbyid(p.proowner)||coalesce(p.proacl::text,'')||p.provolatile::text x from pg_proc p where p.pronamespace::regnamespace::text in ('public','storage','auth','realtime')) s),
 'policies',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select schemaname||tablename||policyname||permissive||roles::text||cmd||coalesce(qual,'')||coalesce(with_check,'') x from pg_policies) s),
 'default_acls',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select defaclrole::regrole::text||defaclnamespace::text||defaclobjtype::text||defaclacl::text x from pg_default_acl) s),
 'publications',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select pubname||schemaname||tablename x from pg_publication_tables) s),
 'storage_buckets',(select md5(coalesce(string_agg(x,'|' order by x),''))||':'||count(*) from (select id||public||coalesce(file_size_limit::text,'')||coalesce(allowed_mime_types::text,'') x from storage.buckets) s)
 )"""


def fingerprint():
    r = psql(["-At", "-v", "ON_ERROR_STOP=1", "-c", FP])
    assert r.returncode == 0, r.stderr[:300]
    return json.loads(r.stdout.strip())


def main():
    os.makedirs(OUT, exist_ok=True)
    man, local, recon = build_manifest()
    json.dump(man, open(os.path.join(OUT, "d3-upgrade-manifest.json"), "w", encoding="utf-8"), indent=1)
    print(man["counts"], "| manifest sha256", man["upgrade_manifest_sha256"], "| preceding Prod latest:", man["versions_preceding_production_latest_recorded"])
    if sys.argv[1] == "manifest":
        return
    # simulated history reconciliation (local scratch ledger only; marker rows, no SQL executed)
    vals = ",".join("('%s','%s',ARRAY['-- D3 SIMULATED RECONCILIATION (local scratch only): no SQL was executed for this version'])" % (v, local[v][15:-4].replace("'", "''")) for v in recon)
    r = psql(["-v", "ON_ERROR_STOP=1"], text=f"insert into supabase_migrations.schema_migrations (version, name, statements) values {vals};")
    assert r.returncode == 0, r.stderr[:300]
    # minimum synthetic precondition data (clearly marked; NOT Production data): one auth user holding the master role, so the empty-auth guard can be evaluated
    seed = """set session_replication_role = replica;
insert into auth.users (id, aud, role, email, created_at, updated_at) values ('00000000-0000-0000-0000-00000000d300','authenticated','authenticated','d3-synthetic-master@example.test', now(), now());
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000d300','master');"""
    r = psql(["-v", "ON_ERROR_STOP=1"], text=seed)
    assert r.returncode == 0, "seed failed: " + r.stderr[:300]
    results, stop = [], False
    before_all = fingerprint()
    for row in man["upgrade"]:
        v = row["version"]
        before = fingerprint()
        p = psql(["-v", "ON_ERROR_STOP=1", "-1", "-f", os.path.join(MIG, row["file"])])
        after = fingerprint()
        notices = [re.sub(r"^psql:.*?:\d+: ", "", ln)[:200] for ln in p.stderr.split("\n") if re.search(r"NOTICE|WARNING", ln)]
        res = {"order": row["order"], "version": v, "file": row["file"], "sha256": row["sha256"], "group": row["group"], "status": "applied" if p.returncode == 0 else "FAILED",
               "categories_changed": [k for k in after if after[k] != before[k]], "counts_after": {k: int(x.split(":")[1]) for k, x in after.items()}, "notices": notices[:6], "notice_count": len(notices),
               "data_stmts": row["data_stmts_ins_upd_del_trunc"], "stage_b_prod_class": row["stage_b_prod_class"]}
        if p.returncode != 0:
            m = re.search(r"ERROR:\s+(.*)", p.stderr)
            res["error"] = (m.group(1) if m else p.stderr)[:400]
            res["error_line"] = (re.search(r":(\d+): ERROR", p.stderr) or [None, None])[1]
            res["context"] = "\n".join([ln for ln in p.stderr.split("\n") if ln.startswith(("CONTEXT", "DETAIL", "HINT"))])[:400]
            results.append(res)
            stop = True
            break
        ins = psql(["-v", "ON_ERROR_STOP=1"], text="insert into supabase_migrations.schema_migrations (version, name, statements) values ('%s','%s',ARRAY['-- D3 EXECUTED LOCALLY (scratch only); file sha256 %s']);" % (v, row["file"][15:-4].replace("'", "''"), row["sha256"]))
        assert ins.returncode == 0, ins.stderr[:300]
        results.append(res)
    executed = [r for r in results if r["status"] == "applied"]
    rep = {"database": DB, "selected": len(man["upgrade"]), "applied": len(executed), "failed": [r for r in results if r["status"] == "FAILED"], "not_run": len(man["upgrade"]) - len(results),
           "result": "STOPPED AT FIRST FAILURE" if stop else "ALL SELECTED MIGRATIONS APPLIED", "results": results,
           "history_rows_after": int(psql(["-At", "-c", "select count(*) from supabase_migrations.schema_migrations"]).stdout.strip())}
    json.dump(rep, open(os.path.join(OUT, "d3-execution-report.json"), "w", encoding="utf-8"), indent=1)
    print(rep["result"], "| applied", rep["applied"], "of", rep["selected"], "| failed:", [(f["version"], f.get("error")) for f in rep["failed"]], "| history rows", rep["history_rows_after"])


main()
