"""Step 4A.7: exercise the two LOCAL-PROPOSAL compatibility migrations with real SQL on disposable local databases and the real Supabase CLI.

  supabase/migrations/20260324175545_compat_replace_legacy_user_roles_check.sql      (A)
  supabase/migrations/20260615175815_compat_orders_realtime_before_duplicate_add.sql (B)

Local scratch PostgreSQL only (127.0.0.1:54329). Databases are named bpc_replay_c47_* and are created by scripts/dev/migration-replay.cjs
or cloned from the existing local templates (bpc_replay_e2i_devbase = Development-shaped, 58-row ledger; bpc_replay_prodshape = Production-shaped,
277-row ledger). The CLI runs in a throwaway folder that holds COPIES of the migration files; the single stub-limited file 20260323201502 (needs
pg_net, which a plain PostgreSQL cannot install) is left out of the copy. Nothing in the repository is changed, no hosted system is contacted,
no credential is used, and no customer data is involved (the templates are synthetic replays).

  python -I scripts/dev/hosted-executor/compat-migrations-oracle.py --out audit/step4/compat-migrations-oracle-results.json
"""
import argparse, hashlib, json, os, re, shutil, subprocess, tempfile

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
a = ap.parse_args()

REPO = os.getcwd()
HOST = ["-h", "127.0.0.1", "-p", "54329", "-U", "postgres"]
ENV = {**os.environ, "PGSSLMODE": "disable", "PGPASSWORD": "postgres", "BPC_REPLAY_CONFIRM_LOCAL": "yes"}
MIG = os.path.join(REPO, "supabase", "migrations")
A_FILE = "20260324175545_compat_replace_legacy_user_roles_check.sql"
B_FILE = "20260615175815_compat_orders_realtime_before_duplicate_add.sql"
STUB = "20260323201502"
DBS = []

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV, **kw)

def psql(db, sql):
    r = run(["psql", *HOST, "-d", db, "-Atc", sql])
    return (r.stdout + r.stderr).strip()

def psql_file(db, path):
    r = run(["psql", *HOST, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-f", path])
    return r.returncode, (r.stdout + r.stderr).strip()

def drop(db):
    run(["psql", *HOST, "-d", "postgres", "-Atc", "drop database if exists %s with (force)" % db])

def newdb(name):
    DBS.append(name); drop(name)
    return name

def stub(name, upto="20000101000000", skips=True, adjust=""):
    newdb(name)
    cmd = ["node", "scripts/dev/migration-replay.cjs", "--db", name, "--mode", "strict", "--upto", upto]
    if skips: cmd.append("--stub-skips")
    if adjust: cmd += ["--adjust", adjust]
    r = run(cmd, cwd=REPO)
    if "files replayed" not in r.stdout:
        raise SystemExit("stub replay failed: " + r.stdout[-300:])
    return name

def clone(template, name):
    newdb(name)
    r = run(["psql", *HOST, "-d", "postgres", "-Atc", "create database %s template %s" % (name, template)])
    if r.returncode != 0: raise SystemExit("clone failed: " + r.stderr)

def schema_hash(db):
    r = run(["pg_dump", *HOST, "-s", "-N", "supabase_migrations", "-d", db])
    text = "\n".join(l for l in r.stdout.splitlines() if not l.startswith("\\restrict") and not l.startswith("\\unrestrict"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def state(db):
    return {
        "user_roles_checks": psql(db, "select coalesce(string_agg(conname||' '||pg_get_constraintdef(oid), ' ; ' order by conname),'none') from pg_constraint where conrelid='public.user_roles'::regclass and contype='c'"),
        "orders_in_publication": psql(db, "select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders'"),
        "orders_replica_identity": psql(db, "select relreplident::text from pg_class where oid='public.orders'::regclass"),
        "publication_members": psql(db, "select coalesce(string_agg(tablename, ',' order by tablename),'') from pg_publication_tables where pubname='supabase_realtime'"),
        "schema_sha256": schema_hash(db)}

def try_insert(db, role):
    r = run(["psql", *HOST, "-d", db, "-Atc", "set session_replication_role = replica; begin; insert into public.user_roles(user_id, role) values (gen_random_uuid(), '%s'); rollback;" % role])
    t = (r.stdout + r.stderr)
    return "rejected" if "violates check constraint" in t else ("accepted" if "ROLLBACK" in t or r.returncode == 0 else "error: " + t[-120:])

def project(name, include_compat):
    work = tempfile.mkdtemp(prefix=name + "_", dir=os.path.join(os.environ["LOCALAPPDATA"], "Temp"))
    mig = os.path.join(work, "supabase", "migrations"); os.makedirs(mig)
    shutil.copy(os.path.join(REPO, "supabase", "config.toml"), os.path.join(work, "supabase", "config.toml"))
    for f in os.listdir(MIG):
        if not f.endswith(".sql"): continue
        if f.startswith(STUB + "_"): continue
        if not include_compat and f in (A_FILE, B_FILE): continue
        shutil.copy(os.path.join(MIG, f), os.path.join(mig, f))
    return work, mig

def cli(work, db, *args):
    url = "postgresql://postgres:postgres@127.0.0.1:54329/" + db
    return run(["supabase", *args, "--db-url", url], cwd=work)

def applied(out): return re.findall(r"Applying migration (\d{14})_", out.stdout + out.stderr)

res = {"generated_by": "scripts/dev/hosted-executor/compat-migrations-oracle.py", "local_only": True,
       "cli_version": run(["supabase", "--version"]).stdout.strip(), "compat_files": [A_FILE, B_FILE],
       "compat_sha256": {f: hashlib.sha256(open(os.path.join(MIG, f), "rb").read().replace(b"\r\n", b"\n")).hexdigest() for f in (A_FILE, B_FILE)},
       "scenarios": {}}
S = res["scenarios"]
pa, pb = os.path.join(MIG, A_FILE), os.path.join(MIG, B_FILE)

# C1: current repository history WITHOUT the compatibility files (real CLI, fresh stub)
db = stub("bpc_replay_c47_c1")
work, mig = project("c47c1", include_compat=False)
o = cli(work, db, "db", "push")
S["C1_without_compat_files"] = {"files": len([f for f in os.listdir(mig) if f.endswith('.sql')]), "applied": len(applied(o)),
    "ledger_rows": int(psql(db, "select count(*) from supabase_migrations.schema_migrations")),
    "stopped_after": psql(db, "select max(version) from supabase_migrations.schema_migrations"),
    "error": next((l.strip() for l in (o.stdout + o.stderr).splitlines() if "violates check constraint" in l), "")}
shutil.rmtree(work, ignore_errors=True)

# C2: with both files, real CLI, fresh stub; then a normal future file
db = stub("bpc_replay_c47_c2")
work, mig = project("c47c2", include_compat=True)
o = cli(work, db, "db", "push")
c2 = {"files": len([f for f in os.listdir(mig) if f.endswith('.sql')]), "applied": len(applied(o)), "completed": "Finished supabase db push" in (o.stdout + o.stderr),
      "ledger_rows": int(psql(db, "select count(*) from supabase_migrations.schema_migrations")),
      "compat_rows_recorded": psql(db, "select string_agg(version,',' order by version) from supabase_migrations.schema_migrations where version in ('20260324175545','20260615175815')"),
      "dry_run_after": next((l.strip() for l in (cli(work, db, 'db', 'push', '--dry-run').stdout).splitlines() if 'up to date' in l), "")}
c2["final_state"] = state(db)
open(os.path.join(mig, "20261201120000_future_synthetic.sql"), "w", encoding="utf-8").write("select 1;" + chr(10))
c2["future_file_applied"] = applied(cli(work, db, "db", "push"))
S["C2_with_both_compat_files"] = c2
shutil.rmtree(work, ignore_errors=True)

# C3: the same final schema as the tool-adjusted replay of the history WITHOUT the compatibility files (a copy of the replay tool and of the
# migration files in a throwaway folder; the two adjustments apply the same two actions out of band)
tmp = tempfile.mkdtemp(prefix="c47adj_", dir=os.path.join(os.environ["LOCALAPPDATA"], "Temp"))
os.makedirs(os.path.join(tmp, "scripts", "dev")); os.makedirs(os.path.join(tmp, "supabase", "migrations"))
shutil.copy(os.path.join(REPO, "scripts", "dev", "migration-replay.cjs"), os.path.join(tmp, "scripts", "dev", "migration-replay.cjs"))
for f in os.listdir(MIG):
    if f.endswith(".sql") and f not in (A_FILE, B_FILE):
        shutil.copy(os.path.join(MIG, f), os.path.join(tmp, "supabase", "migrations", f))
adj = newdb("bpc_replay_c47_adj")
radj = run(["node", "scripts/dev/migration-replay.cjs", "--db", adj, "--mode", "strict", "--stub-skips", "--adjust", "s1,s2"], cwd=tmp)
shutil.rmtree(tmp, ignore_errors=True)
sadj = state(adj)
S["C3_equals_tool_adjusted_replay"] = {"adjusted_replay_without_compat_completed": "ADJUSTED REPLAY COMPLETED" in radj.stdout,
    "adjusted_state": sadj, "cli_with_compat_state": c2["final_state"], "schema_sha256_equal": sadj["schema_sha256"] == c2["final_state"]["schema_sha256"],
    "all_state_fields_equal": sadj == c2["final_state"]}

# C4: rerun both files on the finished database (idempotent, no-op)
before = state(db)
rc_a, out_a = psql_file(db, pa); rc_b, out_b = psql_file(db, pb)
S["C4_rerun_on_finished_database"] = {"exit_a": rc_a, "exit_b": rc_b, "state_unchanged": state(db) == before}

# C5/C6: existing-database shapes (A and B must be no-ops; ledger head is later than B)
for tag, tpl in (("C5_development_shape", "bpc_replay_e2i_devbase"), ("C6_production_shape", "bpc_replay_prodshape")):
    name = "bpc_replay_c47_" + tag[:2].lower()
    clone(tpl, name); b4 = state(name)
    ra, _ = psql_file(name, pa); rb, _ = psql_file(name, pb)
    S[tag] = {"template": tpl, "ledger": psql(name, "select count(*)||' rows, max '||max(version) from supabase_migrations.schema_migrations"),
              "before": {k: b4[k] for k in ("user_roles_checks", "orders_in_publication", "orders_replica_identity")}, "exit_a": ra, "exit_b": rb, "state_unchanged": state(name) == b4}

# C7: legacy state (stop just before the file that needs A): A replaces it, a rerun is a no-op, vocabulary stays closed
leg = "bpc_replay_c47_leg"
stub(leg, upto="20260324175544")
st0 = state(leg); legacy_before = {r: try_insert(leg, r) for r in ("MASTER", "master", "superuser")}
ra, _ = psql_file(leg, pa); st1 = state(leg); rr, _ = psql_file(leg, pa); st2 = state(leg)
S["C7_legacy_constraint_state"] = {"before": st0["user_roles_checks"], "after_a": st1["user_roles_checks"], "exit": ra, "rerun_unchanged": st1 == st2,
    "insert_before_a": legacy_before, "insert_after_a": {r: try_insert(leg, r) for r in ("MASTER", "master", "superuser", "Admin ")}}

# C8: A leaves a missing constraint missing and never touches the canonical lower-case one (clones of the finished build)
c8 = "bpc_replay_c47_c8"; clone(db, c8)
canon = state(c8); psql_file(c8, pa)
psql(c8, "alter table public.user_roles drop constraint user_roles_role_check"); absent = state(c8); psql_file(c8, pa)
S["C8_absent_and_canonical_constraints"] = {"canonical_before": canon["user_roles_checks"], "canonical_untouched": True, "absent_stays_absent": state(c8) == absent}
S["C8_absent_and_canonical_constraints"]["canonical_untouched"] = (canon == state(db))

# C9: B in order (orders member, no ledger yet): acts, rerun no-op, then the protected 20260615175816 adds it back; membership equals the full build
ord_db = "bpc_replay_c47_ord"
stub(ord_db, upto="20260615175814")
o0 = state(ord_db); rb1, _ = psql_file(ord_db, pb); o1 = state(ord_db); rb2, _ = psql_file(ord_db, pb); o2 = state(ord_db)
rc_p, _ = psql_file(ord_db, os.path.join(MIG, "20260615175816_add_orders_to_realtime_publication.sql")); o3 = state(ord_db)
S["C9_publication_in_order"] = {"orders_member_before": o0["orders_in_publication"], "after_b": o1["orders_in_publication"], "rerun_unchanged": o1 == o2,
    "replica_identity_before_after": [o0["orders_replica_identity"], o1["orders_replica_identity"]],
    "other_members_unchanged": o0["publication_members"].replace("orders,", "").replace(",orders", "") == o1["publication_members"],
    "protected_file_then_succeeds": rc_p == 0, "orders_member_after_protected_file": o3["orders_in_publication"],
    "membership_equals_full_build": o3["publication_members"] == c2["final_state"]["publication_members"]}

# C10: B skips when the publication is absent
c10 = "bpc_replay_c47_c10"; clone(db, c10)
psql(c10, "drop publication supabase_realtime"); rb10, _ = psql_file(c10, pb)
S["C10_publication_absent"] = {"exit": rb10, "publication_created_by_file": psql(c10, "select count(*) from pg_publication where pubname='supabase_realtime'")}

# C11 (Step 4A.7 review): B must never remove orders from an existing database, whatever the ledger says. Every case starts from a schema
# in which orders IS a publication member; "stays" means it is still a member afterwards and the schema hash is unchanged.
def stays(name, label, setup, runner=None):
    setup(name); before = state(name)
    rc, out = (runner(name) if runner else psql_file(name, pb))
    after = state(name)
    return {"description": label, "exit": rc, "orders_still_member": after["orders_in_publication"] == "1", "state_unchanged": after == before,
            "notice": next((l.strip() for l in out.splitlines() if "did nothing" in l), "")}
def mkclone(tpl, name):
    clone(tpl, name)
S11 = {}
nm = "bpc_replay_c47_c11a"; mkclone("bpc_replay_prodshape", nm)
S11["a_ledger_lacks_later_versions"] = stays(nm, "Production shape, ledger rows >= 20260615175816 deleted (the former C11)", lambda n: psql(n, "delete from supabase_migrations.schema_migrations where version >= '20260615175816'"))
nm = "bpc_replay_c47_c11b"; mkclone("bpc_replay_prodshape", nm)
S11["b_no_ledger_at_all"] = stays(nm, "Production shape, the whole ledger schema removed", lambda n: psql(n, "drop schema supabase_migrations cascade"))
nm = "bpc_replay_c47_c11b2"; mkclone("bpc_replay_e2i_devbase", nm)
S11["b2_development_shape_empty_ledger"] = stays(nm, "Development shape, ledger emptied", lambda n: psql(n, "delete from supabase_migrations.schema_migrations"))
base_inorder = stub("bpc_replay_c47_inorder", upto="20260615175814")
def make_orders_row(n):
    # scratch-only relaxation so that a synthetic row can exist: drop NOT NULLs (where allowed) and CHECKs on orders, then insert one default row
    psql(n, "DO $$ DECLARE c record; BEGIN FOR c IN select column_name from information_schema.columns where table_schema='public' and table_name='orders' and is_nullable='NO' LOOP BEGIN EXECUTE format('alter table public.orders alter column %I drop not null', c.column_name); EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP; "
              "FOR c IN select conname from pg_constraint where conrelid='public.orders'::regclass and contype='c' LOOP EXECUTE format('alter table public.orders drop constraint %I', c.conname); END LOOP; END $$;")
    psql(n, "set session_replication_role = replica; insert into public.orders default values")
nm = "bpc_replay_c47_c11c"; clone(base_inorder, nm)
S11["c_in_order_but_orders_has_a_row"] = stays(nm, "in-order build with no ledger and no later tables but one synthetic order row", make_orders_row)
S11["c_in_order_but_orders_has_a_row"]["orders_rows"] = psql(nm, "select count(*) from public.orders")
assert S11["c_in_order_but_orders_has_a_row"]["orders_rows"] == "1", "the synthetic order row could not be created"
nm = "bpc_replay_c47_c11d"; clone(base_inorder, nm)
S11["d_force_rls_cannot_prove_empty"] = stays(nm, "in-order build, orders uses FORCE ROW LEVEL SECURITY", lambda n: psql(n, "alter table public.orders force row level security"))
for idx, tbl in enumerate(("inventory_products", "order_portal_links", "package_inflatable_eligibility", "public_menu_groups")):
    nm = "bpc_replay_c47_c11e%d" % idx; clone(base_inorder, nm)
    S11["e_single_later_table_" + tbl] = stays(nm, "in-order build plus only public." + tbl, lambda n, t=tbl: psql(n, "create table public.%s (id int)" % t))
nm = "bpc_replay_c47_c11f"; clone(base_inorder, nm)
def role_runner(n):
    r = run(["psql", *HOST, "-d", n, "-v", "ON_ERROR_STOP=1", "-c", "set role authenticated", "-f", pb]); return r.returncode, (r.stdout + r.stderr).strip()
S11["f_unexpected_error_does_nothing"] = stays(nm, "in-order build, run by a role that cannot alter the publication", lambda n: None, role_runner)
S["C11_existing_database_conditions"] = S11
# the in-order case must still act (so a fresh build keeps working)
nm = "bpc_replay_c47_c11g"; clone(base_inorder, nm); rg, _ = psql_file(nm, pb)
S["C11_in_order_still_acts"] = {"exit": rg, "orders_removed_from_publication": psql(nm, "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='orders'") == "0"}
# documented residual: truly mid-history, no ledger, empty orders, no later tables
nm = "bpc_replay_c47_c11h"; stub(nm, upto="20260615175816")
rh, _ = psql_file(nm, pb)
S["C11_documented_residual"] = {"description": "empty database built up to and including 20260615175816, no ledger: indistinguishable from a fresh build, so the file acts (no customer data can exist in this state)",
    "exit": rh, "orders_removed_from_publication": psql(nm, "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename='orders'") == "0"}

# C12 (Step 4A.7 review): file A must not widen who can write user_roles. Actors try to insert role rows before and after A, at the state just
# before 20260324175546, in rolled-back transactions. "accepted" would be a privilege path.
def attempt(dbn, actor, role):
    uid = "22222222-2222-2222-2222-222222222222"
    pre = "begin; "
    if actor == "authenticated_customer":
        pre += "set session_replication_role = replica; insert into public.user_roles(user_id, role) values ('%s','CUSTOMER'); set session_replication_role = origin; set local role authenticated; set local request.jwt.claim.sub = '%s'; " % (uid, uid)
    elif actor == "authenticated_no_role_row":
        pre += "set local role authenticated; set local request.jwt.claim.sub = '%s'; " % uid
    else:
        pre += "set local role anon; "
    r = run(["psql", *HOST, "-d", dbn, "-Atc", pre + "insert into public.user_roles(user_id, role) values ('%s','%s'); rollback;" % (uid, role)])
    t = r.stdout + r.stderr
    return "accepted" if ("ERROR" not in t and "INSERT 0 1" in t) else ("rls" if "row-level security" in t else ("check" if "check constraint" in t else "other:" + t[-80:]))
c12 = "bpc_replay_c47_c12"; stub(c12, upto="20260324175544")
roles = ("MASTER", "master", "ADMIN", "admin", "crew", "CUSTOMER", "customer", "superuser")
actors = ("anon", "authenticated_no_role_row", "authenticated_customer")
before12 = {a_: {r: attempt(c12, a_, r) for r in roles} for a_ in actors}
psql_file(c12, pa)
after12 = {a_: {r: attempt(c12, a_, r) for r in roles} for a_ in actors}
S["C12_role_writes_by_non_privileged_actors"] = {"before_a": before12, "after_a": after12,
    "any_accepted_before": any(v == "accepted" for d in before12.values() for v in d.values()),
    "any_accepted_after": any(v == "accepted" for d in after12.values() for v in d.values()),
    "policies": psql(c12, "select string_agg(policyname || ' ' || cmd, ' ; ' order by policyname) from pg_policies where tablename='user_roles' and cmd in ('INSERT','ALL')")}


# C13/C14 (finalization): how A and B are treated on EXISTING databases. Both treatments are tested on the Development shape and the Production shape,
# each made "post-recovery" (synthetic rows for every other repository version, so that A and B are the only pending files).
A_V, B_V = A_FILE[:14], B_FILE[:14]
RECORD_MARKER = ("-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED run={{RUN_ID}} basis=compat migration for fresh-database replay only; its guards make it a no-op on this "
                 "database; recorded so that standard tooling does not treat it as pending; its SQL was not run here")
res["record_marker_template"] = RECORD_MARKER
RECORD_NAMES = {A_V: "compat_replace_legacy_user_roles_check", B_V: "compat_orders_realtime_before_duplicate_add"}

def recovered_clone(tpl, name):
    clone(tpl, name)
    vs = [f[:14] for f in os.listdir(MIG) if f.endswith(".sql") and f[:14] not in (A_V, B_V) and not f.startswith(STUB + "_")]
    psql(name, "insert into supabase_migrations.schema_migrations(version,name,statements) values " + ",".join("('%s','synthetic','{synthetic recovered row}')" % v for v in vs) + " on conflict do nothing")
    return name

def cli_project(name_prefix, db):
    """throwaway project with the repository files (stub-limited file left out) plus a comment-only placeholder for every ledger version that has no file"""
    work, mig = project(name_prefix, include_compat=True)
    have = {f[:14] for f in os.listdir(mig) if f.endswith(".sql")}
    for v in psql(db, "select version from supabase_migrations.schema_migrations order by version").split():
        if v not in have:
            open(os.path.join(mig, v + "_ledger_only_placeholder.sql"), "w", encoding="utf-8").write("-- comment-only placeholder (test copy only)" + chr(10))
    return work

def pending_files(out):
    return sorted(set(re.findall(r"^ . (\d{14})_", out.stdout + out.stderr, flags=re.M)))

S13 = {}
for shape, tpl in (("development_shape", "bpc_replay_e2i_devbase"), ("production_shape", "bpc_replay_prodshape")):
    r13 = {"template": tpl}
    # C13: record without executing
    d1 = recovered_clone(tpl, "bpc_replay_c47_r%s" % shape[0]); w1 = cli_project("c47r", d1)
    pend0 = pending_files(cli(w1, d1, "db", "push", "--dry-run", "--include-all")); st0 = state(d1)
    for v in (A_V, B_V):
        psql(d1, "insert into supabase_migrations.schema_migrations(version,name,statements) values ('%s','%s',ARRAY['%s'])" % (v, RECORD_NAMES[v], RECORD_MARKER.replace("{{RUN_ID}}", "synthetic-run")))
    out1 = cli(w1, d1, "db", "push", "--dry-run", "--include-all")
    st1 = state(d1)
    r13["record_without_executing"] = {"pending_before": pend0, "pending_after": pending_files(out1), "up_to_date": "up to date" in (out1.stdout + out1.stderr),
        "state_unchanged": st1 == st0, "orders_still_member": st1["orders_in_publication"] == "1", "rows_are_single_element_not_executed_markers":
        psql(d1, "select count(*) from supabase_migrations.schema_migrations where version in ('%s','%s') and array_length(statements,1)=1 and statements[1] like '-- BPC-DEV-RECONCILIATION history-only NOT EXECUTED%%'" % (A_V, B_V)) == "2"}
    shutil.rmtree(w1, ignore_errors=True)
    # C14: an ordinary push with --include-all would execute the two files as guarded no-ops (the fallback path)
    d2 = recovered_clone(tpl, "bpc_replay_c47_p%s" % shape[0]); w2 = cli_project("c47p", d2)
    pend2 = pending_files(cli(w2, d2, "db", "push", "--dry-run", "--include-all")); st2 = state(d2); n2 = int(psql(d2, "select count(*) from supabase_migrations.schema_migrations"))
    o2 = cli(w2, d2, "db", "push", "--include-all")
    st3 = state(d2)
    r13["ordinary_push_include_all"] = {"pending_before": pend2, "applied": applied(o2), "ledger_rows_added": int(psql(d2, "select count(*) from supabase_migrations.schema_migrations")) - n2,
        "state_unchanged": st3 == st2, "orders_still_member": st3["orders_in_publication"] == "1", "user_roles_checks_unchanged": st3["user_roles_checks"] == st2["user_roles_checks"],
        "up_to_date_afterwards": "up to date" in (cli(w2, d2, "db", "push", "--dry-run", "--include-all").stdout)}
    shutil.rmtree(w2, ignore_errors=True)
    S13[shape] = r13
S["C13_C14_treatment_on_existing_databases"] = S13

for d in DBS: drop(d)
with open(a.out, "w", encoding="utf-8") as fh:
    json.dump(res, fh, indent=1)
print(json.dumps(res, indent=1)[:6000])
