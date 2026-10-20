"""Step 4A.7 (corrected in the review): exercise audit/step4/strategy-a-marker-proposal.sql (a PROPOSAL, never run on any hosted system) on
disposable LOCAL clones and show how the real Supabase CLI interprets the rows.

Local scratch PostgreSQL only (127.0.0.1:54329); databases bpc_replay_m47_* are cloned from bpc_replay_e2i_devbase (Development-shaped, 58-row
ledger) or bpc_replay_prodshape (Production-shaped, 277-row ledger); both are synthetic replays. The proposal's placeholders are filled with
SYNTHETIC values only inside temporary copies for the positive test (no signature, date or authorization id from the owner exists), and the
prerequisite ledger rows (the 28 sealed-package versions and the alias-reconciliation row 20260814120000) are inserted as synthetic rows on the clone.
Nothing in the repository is changed. No hosted system or credential is touched.

  python -I scripts/dev/hosted-executor/marker-proposal-oracle.py --out audit/step4/marker-proposal-oracle-results.json
"""
import argparse, json, os, re, shutil, subprocess, tempfile

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
a = ap.parse_args()

REPO = os.getcwd()
HOST = ["-h", "127.0.0.1", "-p", "54329", "-U", "postgres"]
ENV = {**os.environ, "PGSSLMODE": "disable", "PGPASSWORD": "postgres"}
PROPOSAL = os.path.join(REPO, "audit", "step4", "strategy-a-marker-proposal.sql")
MIG = os.path.join(REPO, "supabase", "migrations")
TEMPLATE = "bpc_replay_e2i_devbase"
ALIAS = "20260814002658"
O2 = "20260814120000"
SEALED = [i["version"] for i in json.load(open(os.path.join(REPO, "audit", "step4", "executor", "dev-package-oct-s3b.sealed.json"), encoding="utf-8"))["items"]]
THIRTEEN = ["20251001051901", "20251001052039", "20251001192425", "20260125173238", "20260126193205", "20260224133344", "20260224161311",
            "20260224183629", "20260224184535", "20260305222010", "20260311113547", "20260315173745", "20260611184401"]
DENY_EXC = ["20251001052039", "20260125173238", "20260305222010", "20260611184401"]
DBS = []
CUR = [None]

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV, **kw)

def psql(db, sql):
    r = run(["psql", *HOST, "-d", db, "-Atc", sql]); return (r.stdout + r.stderr).strip()

def psql_file(db, path):
    r = run(["psql", *HOST, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-f", path]); return r.returncode, (r.stdout + r.stderr).strip()

def clone(name, template=TEMPLATE):
    DBS.append(name); CUR[0] = name
    run(["psql", *HOST, "-d", "postgres", "-Atc", "drop database if exists %s with (force)" % name])
    r = run(["psql", *HOST, "-d", "postgres", "-Atc", "create database %s template %s" % (name, template)])
    if r.returncode != 0: raise SystemExit(r.stderr)
    return name

def prep(db):
    """the prerequisite rows the proposal demands (synthetic stand-ins for the executor and alias-reconciliation rows)"""
    vals = ",".join("('%s','synthetic','{synthetic prerequisite row}')" % v for v in SEALED + [O2])
    psql(db, "insert into supabase_migrations.schema_migrations(version,name,statements) values " + vals + " on conflict do nothing")

BASE_EXPR = ("select count(*)||'|'||encode(sha256(convert_to(string_agg(version || '|' || coalesce(name,'') || '|' || md5(coalesce(array_to_string(statements, E'\\n'),'')), E'\\n' ORDER BY version), 'UTF8')), 'hex') "
             "from supabase_migrations.schema_migrations")

def base(db):
    c, h = psql(db, BASE_EXPR).split("|"); return int(c), h

def fill(text, count, sha, **over):
    vals = {"RUN_ID": "synthetic-run", "ATTESTED_BY": "SYNTHETIC-TEST-ONLY", "ATTESTED_AT": "1970-01-01", "AUTHORIZATION_ID": "SYNTHETIC",
            "DENYLIST_EXCEPTION_APPROVAL_ID": "SYNTHETIC-DENY", "EXPECTED_BASE_COUNT": str(count), "BASE_LEDGER_SHA256": sha}
    vals.update(over)
    for k, v in vals.items(): text = text.replace("{{" + k + "}}", v)
    # test-only substitution: hosted Development is the database 'postgres'; the scratch clone has another name
    return text.replace("current_database() <> 'postgres'", "current_database() <> '%s'" % CUR[0])

def tmpfile(text):
    fd, p = tempfile.mkstemp(suffix=".sql", dir=os.path.join(os.environ["LOCALAPPDATA"], "Temp")); os.close(fd)
    open(p, "w", encoding="utf-8", newline="\n").write(text); return p

def cli_pending(db):
    work = tempfile.mkdtemp(prefix="m47_", dir=os.path.join(os.environ["LOCALAPPDATA"], "Temp"))
    mig = os.path.join(work, "supabase", "migrations"); os.makedirs(mig)
    shutil.copy(os.path.join(REPO, "supabase", "config.toml"), os.path.join(work, "supabase", "config.toml"))
    for f in os.listdir(MIG):
        if f.endswith(".sql") and not f.startswith(("20260324175545_", "20260615175815_")): shutil.copy(os.path.join(MIG, f), os.path.join(mig, f))
    if not any(f.startswith(ALIAS + "_") for f in os.listdir(mig)):
        open(os.path.join(mig, ALIAS + "_ledger_alias_of_20260814120000.sql"), "w", encoding="utf-8").write("-- comment-only alias file (test copy only)" + chr(10))
    url = "postgresql://postgres:postgres@127.0.0.1:54329/" + db
    r = run(["supabase", "db", "push", "--dry-run", "--include-all", "--db-url", url], cwd=work)
    shutil.rmtree(work, ignore_errors=True)
    out = r.stdout + r.stderr
    return sorted(set(re.findall(r"^ . (\d{14})_", out, flags=re.M)))

text = open(PROPOSAL, encoding="utf-8").read()
res = {"generated_by": "scripts/dev/hosted-executor/marker-proposal-oracle.py", "local_only": True, "template": TEMPLATE, "scenarios": {}}
S = res["scenarios"]

# static properties of the committed file
CODE = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith("--")]
S["static"] = {"first_statement_is_a_single_do_block": CODE[0].startswith("DO $proposal$") and CODE[-1] == "$proposal$;" and sum(1 for l in CODE if l.startswith("DO ")) == 1, "no_psql_meta_commands": not any(l.startswith(chr(92)) for l in text.splitlines()), "no_transaction_control": not any(l.strip().upper() in ("BEGIN;", "COMMIT;", "ROLLBACK;", "START TRANSACTION;") for l in text.splitlines()), "thirteen_versions_allowlisted": all("'" + v + "'" in text.split("v_allow")[1].split(";")[0] for v in THIRTEEN),
               "deny_exception_versions_listed": all(v in text.split("v_deny_exception")[1].split(";")[0] for v in DENY_EXC),
               "prerequisite_versions_listed": all(("'" + v + "'") in text.split("v_prereq")[1].split(";")[0] for v in SEALED + [ALIAS, O2]),
               "insert_statements": len(re.findall(r"INSERT INTO supabase_migrations", text)), "writes_only_via_one_insert": len(re.findall(r"\b(UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b", re.sub(r"--.*", "", text))) == 0}

# M1: exactly as committed, it does nothing (fails closed)
db = clone("bpc_replay_m47_a"); prep(db); c0, h0 = base(db)
rc, out = psql_file(db, PROPOSAL)
S["M1_as_committed"] = {"exit_nonzero": rc != 0, "message": next((l.strip() for l in out.splitlines() if "PROPOSAL ONLY" in l), out[-160:]), "ledger_unchanged": base(db) == (c0, h0)}
rc0, out0 = run(["psql", *HOST, "-d", db, "-Atc", "select 1"]).returncode, ""
# even with ON_ERROR_STOP off, the aborted transaction writes nothing
r = run(["psql", *HOST, "-d", db, "-q", "-f", PROPOSAL]); S["M1_as_committed"]["without_on_error_stop_still_unchanged"] = base(db) == (c0, h0)

# M2: synthetic fill-in on a clone: 13 rows, exact form, CLI interpretation, rerun refused
pend_before = cli_pending(db)
rc, out = psql_file(db, tmpfile(fill(text, c0, h0)))
rows = psql(db, "select count(*) from supabase_migrations.schema_migrations")
forms = psql(db, "select count(*) from supabase_migrations.schema_migrations where version = any(string_to_array('%s', ',')) and array_length(statements,1)=1 and statements[1] like '-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run=synthetic-run state=%%'" % ",".join(THIRTEEN))
denyf = psql(db, "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations where statements[1] like '%deny_exception_approval=SYNTHETIC-DENY%'")
pend_after = cli_pending(db)
S["M2_synthetic_fill_in"] = {"exit": rc, "ledger_rows_after": int(rows), "ledger_rows_before": c0, "rows_in_expected_form": int(forms),
    "base_rows_unchanged": psql(db, "select count(*) from supabase_migrations.schema_migrations where version <> all(string_to_array('%s', ','))" % ",".join(THIRTEEN)) == str(c0),
    "deny_exception_rows": denyf.split(",") if denyf else [], "cli_pending_13_before": [v for v in THIRTEEN if v in pend_before], "cli_pending_13_after": [v for v in THIRTEEN if v in pend_after],
    "states": psql(db, "select string_agg(distinct substring(statements[1] from 'state=([a-z-]+)'), ',') from supabase_migrations.schema_migrations where version = any(string_to_array('%s', ','))" % ",".join(THIRTEEN))}
c1, h1 = base(db)
rc2, out2 = psql_file(db, tmpfile(fill(text, c1, h1)))
S["M2_synthetic_fill_in"]["second_run_refused"] = rc2 != 0 and "already has a ledger row" in out2

# M3: negative controls on fresh clones (each must raise FOR ITS OWN REASON and leave the ledger untouched)
def neg(tag, mutate, reason, prepare=True, template=TEMPLATE, tweak=None):
    d = clone("bpc_replay_m47_" + tag, template)
    if prepare: prep(d)
    if tweak: tweak(d)
    c, h = base(d)
    rc, out = psql_file(d, tmpfile(mutate(c, h)))
    return {"raised": rc != 0, "expected_reason_seen": reason in out, "message": next((l.strip() for l in out.splitlines() if "ERROR" in l), out[-140:]), "ledger_unchanged": base(d) == (c, h)}
S["M3_wrong_expected_count"] = neg("n1", lambda c, h: fill(text, c + 1, h), "ledger differs from the approved base")
S["M3_wrong_base_hash"] = neg("n2", lambda c, h: fill(text, c, "0" * 64), "ledger differs from the approved base")
S["M3_marker_placeholder_left"] = neg("n3", lambda c, h: fill(text, c, h, RUN_ID="{{RUN_ID}}"), "placeholder left in the marker")
S["M3_denied_version_on_allowlist"] = neg("n4", lambda c, h: fill(text, c, h).replace("'20251001051901', ", "'20260305203528', ", 1), "denied or withdrawn version")
S["M3_marker_wrong_form"] = neg("n6", lambda c, h: fill(text, c, h).replace("-- BPC-DEV-RECONCILIATION attestation NOT EXECUTED run=synthetic-run state=deliberately-not-executed version=20251001052039", "-- looks-like-executed run=synthetic-run state=x version=20251001052039", 1), "malformed marker")
S["M3_missing_prerequisites_sealed_package_and_alias_rows"] = neg("n7", lambda c, h: fill(text, c, h), "prerequisite ledger rows are missing", prepare=False)
S["M3_missing_development_alias_row"] = neg("n8", lambda c, h: fill(text, c, h), "alias row 20260814002658 is missing", tweak=lambda d: psql(d, "delete from supabase_migrations.schema_migrations where version = '%s'" % ALIAS))
S["M3_deny_exception_approval_absent_on_a_denied_version"] = neg("n9", lambda c, h: fill(text, c, h).replace(" deny_exception_approval=SYNTHETIC-DENY attested_by=", " attested_by=", 1), "deny-list exception approval id must be present")
S["M3_deny_exception_approval_unfilled"] = neg("n10", lambda c, h: fill(text, c, h, DENYLIST_EXCEPTION_APPROVAL_ID="{{DENYLIST_EXCEPTION_APPROVAL_ID}}"), "placeholder left in the marker")
S["M3_deny_exception_approval_on_a_non_denied_version"] = neg("n11", lambda c, h: fill(text, c, h).replace("state=effects-present-execution-unproven version=20251001051901 attested_by=", "state=effects-present-execution-unproven version=20251001051901 deny_exception_approval=SYNTHETIC-DENY attested_by=", 1), "must be present on exactly the four")
S["M3_database_name_not_postgres"] = neg("n12", lambda c, h: fill(text, c, h).replace("current_database() <> '%s'" % CUR[0], "current_database() <> 'postgres'"), "unexpected database")
d5 = clone("bpc_replay_m47_n5"); prep(d5); psql(d5, "insert into supabase_migrations.schema_migrations(version,name,statements) values ('20251001051901','x',ARRAY['pre-existing'])")
c5, h5 = base(d5); rc5, out5 = psql_file(d5, tmpfile(fill(text, c5, h5)))
S["M3_version_already_present"] = {"raised": rc5 != 0, "expected_reason_seen": "already has a ledger row" in out5, "message": next((l.strip() for l in out5.splitlines() if "ERROR" in l), ""), "ledger_unchanged": base(d5) == (c5, h5)}
# Production-shaped ledger: refuses (no Development-only alias row; ten of the thirteen are already recorded)
dp = clone("bpc_replay_m47_prod", "bpc_replay_prodshape"); cp, hp = base(dp)
rcp, outp = psql_file(dp, tmpfile(fill(text, cp, hp)))
S["M3_production_shaped_ledger_refused"] = {"raised": rcp != 0, "expected_reason_seen": "alias row 20260814002658 is missing" in outp, "message": next((l.strip() for l in outp.splitlines() if "ERROR" in l), ""), "ledger_unchanged": base(dp) == (cp, hp),
    "ten_of_thirteen_already_recorded": psql(dp, "select count(*) from supabase_migrations.schema_migrations where version = any(string_to_array('%s', ','))" % ",".join(THIRTEEN))}


# M4 (finalization): the exact transports. The file is one plain-PostgreSQL statement, so every channel that can send SQL can run it without alteration.
# Each variant runs the SAME synthetic fill-in on its own fresh clone; success must write 13 rows, failure (placeholders unfilled) must write nothing.
def transport(tag, runner):
    d = clone("bpc_replay_m47_t" + tag); prep(d); c, h = base(d)
    filled = fill(text, c, h); fpath = tmpfile(filled); upath = tmpfile(text)
    rc, out = runner(d, filled, fpath)
    ok_rows = int(psql(d, "select count(*) from supabase_migrations.schema_migrations")) - c
    d2 = clone("bpc_replay_m47_u" + tag); prep(d2); c2, h2 = base(d2)
    rc2, out2 = runner(d2, text, upath)
    return {"success_exit": rc, "rows_written": ok_rows, "unfilled_exit_nonzero": rc2 != 0, "unfilled_ledger_unchanged": base(d2) == (c2, h2),
            "unfilled_message": next((l.strip() for l in out2.splitlines() if "PROPOSAL ONLY" in l), out2[-120:])}
def run_psql_f_single_transaction(d, content, path):
    r = run(["psql", *HOST, "-X", "-d", d, "-v", "ON_ERROR_STOP=1", "-1", "-f", path]); return r.returncode, r.stdout + r.stderr
def run_psql_stdin_executor_style(d, content, path):
    r = subprocess.run(["psql", "-X", "-q", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", d, "-f", "-"],
                       input=content, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV); return r.returncode, r.stdout + r.stderr
def run_psql_c_one_query(d, content, path):
    r = run(["psql", *HOST, "-X", "-d", d, "-v", "ON_ERROR_STOP=1", "-c", content]); return r.returncode, r.stdout + r.stderr
def run_psql_f_no_flags(d, content, path):
    r = run(["psql", *HOST, "-X", "-d", d, "-f", path]); return r.returncode, r.stdout + r.stderr
S["M4_transports"] = {
    "psql_f_single_transaction": transport("1", run_psql_f_single_transaction),
    "psql_stdin_executor_style": transport("2", run_psql_stdin_executor_style),
    "psql_c_one_query_as_an_sql_api_would_send_it": transport("3", run_psql_c_one_query),
    "psql_f_without_any_flag": transport("4", run_psql_f_no_flags)}
S["M4_transports"]["note"] = ("The file has no psql meta-command and no BEGIN/COMMIT; the invocation flags -v ON_ERROR_STOP=1 and -1 are client options, not file content. "
    "Without ON_ERROR_STOP psql exits 0 after a failed statement but the DO block has written nothing (unfilled_ledger_unchanged).")

for d in DBS: run(["psql", *HOST, "-d", "postgres", "-Atc", "drop database if exists %s with (force)" % d])
json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1)
print(json.dumps(res, indent=1))
