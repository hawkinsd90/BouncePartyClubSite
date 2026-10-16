"""Stage C0: reproduce and document the known migration-replay failures in DISPOSABLE LOCAL databases.

* talks ONLY to the throwaway local cluster on 127.0.0.1:54329 (never a hosted project; no Supabase CLI; no Docker);
* builds scratch databases with the existing guarded tool (scripts/dev/migration-replay.cjs) and then replays further files itself;
* ad-hoc "what if" SQL (the proposed shim steps S1-S5) is injected into SCRATCH databases only, to EVALUATE them. Nothing is added to the
  replay tool and no migration file is read for writing or changed;
* synthetic data only.

Usage: python -I c0_replay_experiments.py <command>
  detail     exact SQL / error / context for each known failure
  matrix     clean strict + diagnostic replay and the S1/S2/... what-if matrix
  scenarios  pending 20261016120000 behaviour on synthetic states
"""
import collections
import json
import os
import re
import subprocess
import sys

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
MIG = os.path.join(REPO, "supabase", "migrations")
OUT = r"C:\Users\vikki\migration-evidence\c0-scratch"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
HOST, PORT, USER = "127.0.0.1", "54329", "postgres"
MARKER = "bpc-migration-replay-scratch:v1"
FILES = sorted(f for f in os.listdir(MIG) if re.match(r"^\d{14}_.*\.sql$", f))


def env():
    e = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    e.update(BPC_REPLAY_CONFIRM_LOCAL="yes", PGPSQL=PSQL, PGCLIENTENCODING="UTF8")
    return e


def psql(db, args, text=None):
    r = subprocess.run([PSQL, "-h", HOST, "-p", PORT, "-U", USER, "-X", "-q", "-w", "-d", db, *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env(), input=text)
    return r


def tool(db, *extra):
    r = subprocess.run(["node", os.path.join(REPO, "scripts", "dev", "migration-replay.cjs"), "--db", db, *extra], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=REPO, env=env())
    return r


def fresh_stub_db(db):
    """A scratch database with only the stub bootstrap (no migration replayed), created by the guarded tool."""
    r = tool(db, "--mode", "diagnostic", "--upto", "20000101000000")
    assert "INFRASTRUCTURE ERROR" not in r.stdout + r.stderr and "REFUSED" not in r.stderr, r.stdout + r.stderr


def clone(src, dst):
    psql("postgres", ["-c", f'drop database if exists "{dst}" with (force)'])
    r = psql("postgres", ["-v", "ON_ERROR_STOP=1", "-c", f'create database "{dst}" template "{src}"'])
    assert r.returncode == 0, r.stderr
    psql("postgres", ["-c", f"comment on database \"{dst}\" is '{MARKER}'"])
    # ALTER DATABASE ... SET is not inherited from a template; mirror what the tool sets
    psql("postgres", ["-c", f'alter database "{dst}" set search_path = public, extensions'])


def run_file(db, path, verbose=True, single_tx=False):
    args = ["-v", "ON_ERROR_STOP=0" if not single_tx else "ON_ERROR_STOP=1"]
    args = ["-v", "ON_ERROR_STOP=1", "-1"] if single_tx else ["-v", "ON_ERROR_STOP=0"]
    if verbose:
        args += ["-v", "VERBOSITY=verbose", "-v", "SHOW_CONTEXT=always"]
    return psql(db, args + ["-f", path])


def errors(stderr):
    out = []
    for m in re.finditer(r"psql:(?:.*?):(\d+): ERROR:\s+(.*)", stderr):
        out.append((int(m.group(1)), m.group(2).strip()[:200]))
    return out


def file_lines(path):
    return open(path, encoding="utf-8", errors="replace", newline="").read().replace("\r\n", "\n").split("\n")


def snippet(path, line, before=0, after=0):
    L = file_lines(path)
    a, b = max(0, line - 1 - before), min(len(L), line + after)
    return "\n".join(f"{i + 1:4d}: {L[i]}" for i in range(a, b))


def replay_rest(db, after_version, before_hooks=None, after_hooks=None, upto=None, log=None):
    """Replay every file with version > after_version in diagnostic mode (statement by statement, continue on error)."""
    before_hooks, after_hooks, res = before_hooks or {}, after_hooks or {}, []
    for f in FILES:
        v = f[:14]
        if v <= after_version:
            continue
        if upto and v > upto:
            break
        if v in before_hooks:
            r = psql(db, ["-v", "ON_ERROR_STOP=1", "-c", before_hooks[v]])
            if log is not None:
                log.append(f"hook before {v}: exit {r.returncode} {r.stderr.strip()[:200]}")
        r = run_file(db, os.path.join(MIG, f), verbose=False)
        errs = errors(r.stderr)
        if errs:
            res.append((f, errs))
        if v in after_hooks:
            r = psql(db, ["-v", "ON_ERROR_STOP=1", "-c", after_hooks[v]])
            if log is not None:
                log.append(f"hook after {v}: exit {r.returncode} {r.stderr.strip()[:200]}")
    return res


# ---------------------------------------------------------------------------------------------------------------------
KNOWN = [
    ("F1", "20260324175546_fix_get_user_role_case_sensitivity_v2.sql", "20260324162302"),
    ("F2", "20260324190039_normalize_remaining_uppercase_roles.sql", "20260324180043"),
    ("F3", "20260615175816_add_orders_to_realtime_publication.sql", "20260615174758"),
    ("F4", "20261016120000_repair_role_assignment_and_signup_provisioning.sql", "20261015123000"),
    ("F5", "20260323201502_add_google_calendar_auto_sync_trigger.sql", "20260323200947"),
]


def cmd_detail():
    out = {}
    for fid, fname, prev in KNOWN:
        db = f"bpc_replay_c0_{fid.lower()}"
        b = tool(db, "--mode", "diagnostic", "--upto", prev)
        path = os.path.join(MIG, fname)
        # clone BEFORE the diagnostic run so the strict-style run starts from the same pre-file state
        clone(db, db + "s")
        r = run_file(db, path, verbose=True)
        e = errors(r.stderr)
        rs = run_file(db + "s", path, verbose=False, single_tx=True)
        out[fid] = {"file": fname, "state_built_up_to": prev, "build_tool_summary": b.stdout.strip().split("\n")[:3],
                    "diagnostic_exit": r.returncode, "errors": e, "stderr_verbose": r.stderr.strip()[:3500],
                    "strict_single_tx_exit": rs.returncode, "strict_first_error": errors(rs.stderr)[:1]}
        if e:
            out[fid]["sql_at_first_error_line"] = snippet(path, e[0][0], before=0, after=0)
    json.dump(out, open(os.path.join(OUT, "c0_detail.json"), "w", encoding="utf-8"), indent=1)
    for fid, d in out.items():
        print(f"== {fid} {d['file']} (state built up to {d['state_built_up_to']})")
        print("   diagnostic errors:", d["errors"])
        print("   strict (single transaction): exit", d["strict_single_tx_exit"], d["strict_first_error"])


def cmd_matrix():
    runs = {}
    r = tool("bpc_replay_c0_strict", "--mode", "strict", "--stub-skips")
    runs["strict_clean_stub_skips"] = r.stdout.strip().split("\n")[:5]
    r = tool("bpc_replay_c0_strict2", "--mode", "strict")
    runs["strict_clean_no_skips"] = r.stdout.strip().split("\n")[:5]
    base = "bpc_replay_c0_empty"
    fresh_stub_db(base)
    S1 = "ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;"
    S2 = "ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;"
    experiments = {
        "X0_clean_diagnostic_no_adjustment": ({}, {}),
        "X1_S1_only": ({}, {"20251207163822": S1}),
        "X2_S2_only": ({"20260615175816": S2}, {}),
        "X3_S1_plus_S2": ({"20260615175816": S2}, {"20251207163822": S1}),
    }
    for name, (before, after) in experiments.items():
        db = "bpc_replay_c0_" + name.split("_")[0].lower()
        clone(base, db)
        log = []
        res = replay_rest(db, "00000000000000", before_hooks=before, after_hooks=after, log=log)
        runs[name] = {"hooks": log, "failing_files": [(f[:14], f[15:], e) for f, e in res]}
        print(name, "->", [(f[:14], e[0][0], e[0][1][:70]) for f, e in res])
    json.dump(runs, open(os.path.join(OUT, "c0_matrix.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(runs["strict_clean_stub_skips"], indent=0))
    print(json.dumps(runs["strict_clean_no_skips"], indent=0))


def cmd_scenarios():
    # synthetic states for pending 20261016120000
    f4 = os.path.join(MIG, KNOWN[3][1])
    base = "bpc_replay_c0_s4base"
    tool(base, "--mode", "diagnostic", "--upto", "20261015123000")  # clean replay state (uppercase CHECK present)
    scen = {}

    def scenario(name, setup_sql, expect=""):
        db = "bpc_replay_c0_sc_" + name.lower()
        clone(base, db)
        if setup_sql:
            r = psql(db, ["-v", "ON_ERROR_STOP=1", "-c", setup_sql])
            assert r.returncode == 0, (name, r.stderr)
        wrapper = (f"\\set ON_ERROR_STOP 0\nBEGIN;\n\\i '{f4.replace(chr(92), '/')}'\n"
                   "SELECT 'roles_after=' || coalesce(string_agg(role||':'||n, ',' ORDER BY role),'none') FROM (SELECT role, count(*) n FROM public.user_roles GROUP BY 1) q;\n"
                   "SELECT 'role_check=' || coalesce((SELECT string_agg(pg_get_constraintdef(oid),';') FROM pg_constraint WHERE conrelid='public.user_roles'::regclass AND contype='c'),'none');\n"
                   "SELECT 'fk_to_auth_users=' || (SELECT count(*) FROM pg_constraint WHERE conrelid='public.user_roles'::regclass AND contype='f' AND confrelid='auth.users'::regclass);\n"
                   "SELECT 'trigger_on_auth_users=' || (SELECT count(*) FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created' AND NOT tgisinternal);\n"
                   "ROLLBACK;\n")
        r = psql(db, ["-v", "VERBOSITY=default", "-A", "-t"], text=wrapper)
        scen[name] = {"setup": setup_sql.strip()[:300], "errors": errors(r.stderr) or [(0, e) for e in re.findall(r"ERROR:\s+(.*)", r.stderr)][:3],
                      "raw_errors": re.findall(r"ERROR:\s+(.*)", r.stderr)[:4], "after_state_inside_tx": [l for l in r.stdout.strip().split("\n") if "=" in l][:6]}
        print(name, "->", scen[name]["raw_errors"], scen[name]["after_state_inside_tx"])

    state = ("SELECT 'users=' || count(*) FROM auth.users;")
    r = psql(base, ["-A", "-t", "-c", state])
    print("clean-replay state:", r.stdout.strip())
    scenario("A_clean_state_as_is", "")
    prod_like = ("ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;"
                 "ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;"
                 "UPDATE public.user_roles SET role = lower(role);"
                 "INSERT INTO public.user_roles (user_id, role) VALUES (gen_random_uuid(),'customer'),(gen_random_uuid(),'customer');")
    scenario("B_prod_like_no_check_no_fk_2_orphans", prod_like)
    scenario("C_prod_like_but_auth_users_empty", prod_like + "DELETE FROM public.user_roles; DELETE FROM auth.identities; DELETE FROM auth.users;"
             "INSERT INTO public.user_roles (user_id, role) VALUES (gen_random_uuid(),'customer');")
    scenario("D_role_outside_vocabulary", prod_like + "INSERT INTO public.user_roles (user_id, role) SELECT id, 'owner' FROM auth.users LIMIT 1;")
    scenario("E_check_dropped_only_uppercase_data", "ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;")
    json.dump(scen, open(os.path.join(OUT, "c0_scenarios.json"), "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    {"detail": cmd_detail, "matrix": cmd_matrix, "scenarios": cmd_scenarios}[sys.argv[1]]()
