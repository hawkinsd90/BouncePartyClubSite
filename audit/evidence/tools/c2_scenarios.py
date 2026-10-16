"""Stage C2: synthetic-data scenarios for supabase/migrations/20261016120000_repair_role_assignment_and_signup_provisioning.sql.

Disposable local PostgreSQL only (127.0.0.1:54329); no hosted project, no Supabase CLI, no Docker. Every scenario clones a scratch base database
(built beforehand by scripts/dev/migration-replay.cjs up to 20261015123000) and runs the migration as ONE transaction (psql -1, ON_ERROR_STOP=1),
the way a real apply behaves. Bases:
  bpc_replay_c2_legacy   unadjusted replay: legacy uppercase-only CHECK present, FK present, uppercase rows
  bpc_replay_c2_nocheck  replay with S1+S2: CHECK absent (the shape of hosted Production/Development), lowercase rows
Usage: python -I c2_scenarios.py [path-to-migration]   (default: the repo file)
"""
import hashlib
import json
import os
import re
import subprocess
import sys

REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
MIG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "supabase", "migrations", "20261016120000_repair_role_assignment_and_signup_provisioning.sql")
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
MARK = "bpc-migration-replay-scratch:v1"
RESULTS = []


def q(db, sql=None, f=None, tx=False, quiet=True):
    a = [PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-At", "-d", db]
    a += ["-v", "ON_ERROR_STOP=1"] + (["-1"] if tx else [])
    a += ["-f", f] if f else ["-c", sql]
    r = subprocess.run(a, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def clone(base, name):
    q("postgres", f'drop database if exists "{name}" with (force)')
    assert q("postgres", f'create database "{name}" template "{base}"')[0] == 0
    q("postgres", f"comment on database \"{name}\" is '{MARK}'")
    q("postgres", f'alter database "{name}" set search_path = public, extensions')


def err1(stderr):
    m = re.search(r"ERROR:\s+(.*)", stderr)
    return m.group(1)[:160] if m else ""


def snapshot(db):
    code, out, _ = q(db, """select md5(coalesce((select string_agg(user_id::text||'|'||role||'|'||id::text, ';' order by id) from public.user_roles),'')
        || coalesce((select string_agg(conname||pg_get_constraintdef(oid), ';' order by conname) from pg_constraint where conrelid='public.user_roles'::regclass),'')
        || coalesce((select string_agg(md5(prosrc), ';' order by proname) from pg_proc where proname in ('assign_role_by_email','auto_assign_customer_role')),'')
        || coalesce((select string_agg(tgname, ';' order by tgname) from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal),''))""")
    return out


def state(db):
    _, roles, _ = q(db, "select coalesce(string_agg(left(user_id::text,4)||':'||role, ', ' order by role, user_id),'(none)') from public.user_roles")
    _, chk, _ = q(db, "select coalesce(string_agg(conname||' '||pg_get_constraintdef(oid),' | '),'none') from pg_constraint where conrelid='public.user_roles'::regclass and contype='c'")
    _, fk, _ = q(db, "select coalesce(string_agg(conname||' valid='||convalidated||' del='||confdeltype,' | '),'none') from pg_constraint where conrelid='public.user_roles'::regclass and contype='f'")
    return {"roles": roles, "check": chk, "fk": fk}


def add_users(db, spec, disable_trigger=True):
    """spec: list of (tag, email, [(role, created_at)])"""
    sql = ["ALTER TABLE auth.users DISABLE TRIGGER USER;"] if disable_trigger else []
    for tag, email, roles in spec:
        sql.append(f"INSERT INTO auth.users (id,email) VALUES ('{tag}','{email}');")
        for role, ts in roles:
            sql.append(f"INSERT INTO public.user_roles (user_id, role, created_at) VALUES ('{tag}','{role}','{ts}');")
    if disable_trigger:
        sql.append("ALTER TABLE auth.users ENABLE TRIGGER USER;")
    c, o, e = q(db, "\n".join(sql))
    assert c == 0, e


U = lambda n: f"00000000-0000-0000-0000-{n:012d}"
CK_OFF = "ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;"
FK_OFF = "ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_fkey;"


def scenario(name, base, setup, expect_ok, expect_msg=None, checks=None, describe=""):
    db = "bpc_replay_c2_" + re.sub(r"[^a-z0-9]", "_", name.lower())[:20]
    clone(base, db)
    if setup:
        setup(db)
    before = state(db)
    code, out, err = q(db, f=MIG, tx=True)
    after = state(db)
    ok = (code == 0) == expect_ok and (expect_msg is None or (expect_msg in err))
    extra = checks(db) if checks and code == 0 else {}
    ok = ok and all(v for k, v in extra.items() if isinstance(v, bool))
    RESULTS.append({"scenario": name, "describe": describe, "migration_exit": code, "error": err1(err), "pass": ok, "before": before, "after": after, "checks": extra})
    print(("PASS" if ok else "FAIL"), name, "| exit", code, "|", err1(err) or "ok", "|", {k: v for k, v in extra.items()})
    return db


def default_checks(db):
    _, n, _ = q(db, "select count(*) from public.user_roles where role not in ('master','admin','crew','customer')")
    _, chk, _ = q(db, "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.user_roles'::regclass and contype='c'")
    _, fk, _ = q(db, "select convalidated::text||'/'||confdeltype::text from pg_constraint where conrelid='public.user_roles'::regclass and contype='f' and confrelid='auth.users'::regclass")
    _, trg, _ = q(db, "select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='auth.users'::regclass and not t.tgisinternal and t.tgname='on_auth_user_created' and p.proname='auto_assign_customer_role' and t.tgtype & 4 = 4 and t.tgtype & 1 = 1")
    _, trg_n, _ = q(db, "select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='auth.users'::regclass and not t.tgisinternal and p.proname='auto_assign_customer_role'")
    return {"all_roles_in_vocabulary": n == "0", "only_lowercase_check": "'master'::text, 'admin'::text, 'crew'::text, 'customer'::text" in chk and chk.count("CHECK") == 1,
            "fk_valid_cascade": fk == "true/c", "signup_trigger_AFTER_INSERT_ROW_to_function": trg == "1", "exactly_one_signup_trigger": trg_n == "1"}


def main():
    legacy, nocheck = "bpc_replay_c2_legacy", "bpc_replay_c2_nocheck"
    ts = lambda d: f"2026-01-{d:02d} 10:00:00+00"
    # 1 legacy uppercase-only CHECK present, uppercase rows (the historical replay shape)
    scenario("T1 legacy CHECK + uppercase rows", legacy, lambda d: add_users(d, [(U(1), "a1@example.test", [("ADMIN", ts(1))]), (U(2), "c1@example.test", [("CREW", ts(1))]), (U(3), "u1@example.test", [("CUSTOMER", ts(1))])]),
             True, checks=default_checks, describe="CHECK accepted only uppercase")
    # 2 CHECK absent, lowercase rows (hosted shape)
    scenario("T2 CHECK absent + lowercase rows", nocheck, lambda d: add_users(d, [(U(1), "a1@example.test", [("admin", ts(1))]), (U(3), "u1@example.test", [("customer", ts(1))])]), True, checks=default_checks)
    # 3 CHECK absent but uppercase data remains
    scenario("T3 CHECK absent + uppercase data", nocheck, lambda d: (add_users(d, [(U(1), "a1@example.test", [("ADMIN", ts(1))]), (U(2), "c1@example.test", [("Crew", ts(1))]), (U(3), "u1@example.test", [(" CUSTOMER ", ts(1))])])), True, checks=default_checks)

    # 4 duplicates normalise to one value; earliest row is kept
    def dup(d):
        add_users(d, [(U(1), "d1@example.test", [("ADMIN", ts(5)), ("admin", ts(2)), (" Admin ", ts(9))])])
    db = scenario("T4 duplicate role rows", nocheck, dup, True, checks=default_checks)
    _, rows, _ = q(db, f"select count(*)||':'||min(role)||':'||min(created_at::date) from public.user_roles where user_id='{U(1)}'")
    RESULTS[-1]["checks"]["rows_for_user"] = rows
    RESULTS[-1]["pass"] = RESULTS[-1]["pass"] and rows == "1:admin:2026-01-02"
    print("   duplicate result (count:role:kept created_at):", rows)

    # 5 unsupported role -> fails safely, nothing changed (transaction rolled back, legacy CHECK still present)
    def bad(d):
        q(d, CK_OFF)
        add_users(d, [(U(1), "o1@example.test", [("owner", ts(1))]), (U(2), "a1@example.test", [("ADMIN", ts(1))])])
        q(d, "ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check CHECK (role IN ('MASTER','ADMIN','CREW','CUSTOMER','owner')) NOT VALID")
    db = scenario("T5 unsupported role value", legacy, bad, False, expect_msg="outside master / admin / crew / customer")
    RESULTS[-1]["pass"] = RESULTS[-1]["pass"] and RESULTS[-1]["before"] == RESULTS[-1]["after"]
    print("   state unchanged after failed apply:", RESULTS[-1]["before"] == RESULTS[-1]["after"])
    # 6 empty auth.users -> existing protection
    def empty(d):
        add_users(d, [(U(1), "a1@example.test", [("admin", ts(1))])])
        q(d, FK_OFF + "ALTER TABLE auth.users DISABLE TRIGGER USER; DELETE FROM auth.identities; DELETE FROM auth.users;")
    scenario("T6 empty auth.users", nocheck, empty, False, expect_msg="auth.users is empty")
    RESULTS[-1]["pass"] = RESULTS[-1]["pass"] and RESULTS[-1]["before"] == RESULTS[-1]["after"]

    # 7 orphaned roles (hosted shape: no FK) are removed, valid kept, FK created and valid
    def orph(d):
        q(d, FK_OFF)
        add_users(d, [(U(1), "k1@example.test", [("customer", ts(1))])])
        q(d, f"INSERT INTO public.user_roles (user_id, role) VALUES ('{U(900)}','admin'),('{U(901)}','customer');")
    db = scenario("T7 orphaned roles + no FK", nocheck, orph, True, checks=default_checks)
    _, o, _ = q(db, f"select count(*) filter (where user_id in ('{U(900)}','{U(901)}'))||':'||count(*) filter (where user_id='{U(1)}') from public.user_roles")
    RESULTS[-1]["checks"]["orphans_left:kept"] = o
    RESULTS[-1]["pass"] = RESULTS[-1]["pass"] and o == "0:1"
    print("   orphans left : synthetic user kept =", o)

    # 8 idempotence: apply again to an already-correct schema
    for nm, base, setup in (("T8a re-apply after T2 shape", nocheck, lambda d: add_users(d, [(U(1), "a1@example.test", [("admin", ts(1))])])),
                            ("T8b re-apply after T1 shape", legacy, lambda d: add_users(d, [(U(1), "a1@example.test", [("ADMIN", ts(1))])]))):
        db = scenario(nm, base, setup, True, checks=default_checks)
        s1 = snapshot(db)
        code, _, err = q(db, f=MIG, tx=True)
        s2 = snapshot(db)
        good = code == 0 and s1 == s2
        RESULTS.append({"scenario": nm + " (second apply)", "pass": good, "migration_exit": code, "error": err1(err), "checks": {"state_identical": s1 == s2}})
        print(("PASS" if good else "FAIL"), nm, "second apply | exit", code, "| snapshot identical:", s1 == s2)

    # 9 signup behaviour (trigger enabled) and 10 authorization, on a migrated hosted-shape database
    def base_users(d):
        add_users(d, [(U(10), "master@example.test", [("master", ts(1))]), (U(11), "admin@example.test", [("admin", ts(1))]), (U(12), "admin2@example.test", [("admin", ts(1))]),
                      (U(13), "crew@example.test", [("crew", ts(1))]), (U(14), "cust@example.test", [("customer", ts(1))]), (U(15), "plain@example.test", [("customer", ts(1))])])
    db = scenario("T9 migrated database for behaviour tests", nocheck, base_users, True, checks=default_checks)
    # signup: new user gets exactly one customer role + customer + contact + profile
    q(db, "INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES ('" + U(20) + "','new.signup@example.test','{\"first_name\":\"Test\",\"last_name\":\"Signup\"}');")
    _, sg, _ = q(db, f"""select (select string_agg(role,',') from public.user_roles where user_id='{U(20)}')||'/'||
        (select count(*) from public.customers where user_id='{U(20)}')||'/'||(select count(*) from public.customer_profiles where user_id='{U(20)}')||'/'||
        (select count(*) from public.contacts where email='new.signup@example.test')||'/'||(select coalesce(string_agg(status,','),'') from public.auth_trigger_logs where user_id='{U(20)}' and status='error')""")
    good = sg == "customer/1/1/1/"
    RESULTS.append({"scenario": "T9a signup provisioning (role/customer/profile/contact/errors)", "pass": good, "checks": {"result": sg}})
    print(("PASS" if good else "FAIL"), "T9a signup creates customer role + customer + profile + contact, no logged errors:", sg)

    helper = """CREATE OR REPLACE FUNCTION pg_temp.try(label text, caller uuid, em text, rl text) RETURNS void LANGUAGE plpgsql AS $f$
    DECLARE r boolean; BEGIN
      PERFORM set_config('request.jwt.claim.sub', coalesce(caller::text,''), true);
      BEGIN r := public.assign_role_by_email(em, rl); RAISE NOTICE 'R|%|ok|%', label, r;
      EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'R|%|err|%', label, SQLERRM; END;
    END $f$;"""
    cases = [("admin->customer 'MASTER'", U(11), "plain@example.test", "MASTER", "err"), ("admin->customer ' Master '", U(11), "plain@example.test", " Master ", "err"),
             ("admin->customer 'ADMIN'", U(11), "plain@example.test", "ADMIN", "err"), ("admin->admin-user 'crew'", U(11), "admin2@example.test", "crew", "err"),
             ("crew caller", U(13), "plain@example.test", "crew", "err"), ("customer caller", U(14), "plain@example.test", "crew", "err"), ("no caller", None, "plain@example.test", "crew", "err"),
             ("invalid role 'customer'", U(10), "plain@example.test", "customer", "err"), ("invalid role 'owner'", U(10), "plain@example.test", "owner", "err"),
             ("unknown email", U(10), "nobody@example.test", "crew", "ok"), ("admin->customer 'CREW'", U(11), "plain@example.test", "CREW", "ok"),
             ("master->customer 'MASTER'", U(10), "cust@example.test", "MASTER", "ok")]
    script = helper + "\nBEGIN;\n" + "\n".join(f"SELECT pg_temp.try('{l.replace(chr(39), chr(39) * 2)}', {('NULL' if c is None else repr(c) + '::uuid')}, '{e}', '{r}');" for l, c, e, r, _ in cases) + "\nCOMMIT;\n"
    p = subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-At", "-d", db], input=script, capture_output=True, text=True, encoding="utf-8")
    if 'R|' not in p.stderr:
        print('   DEBUG helper output:', p.returncode, p.stderr[:600])
    got = {m.group(1): (m.group(2), m.group(3)) for m in re.finditer(r"R\|(.*?)\|(ok|err)\|(.*)", p.stderr)}
    allgood = True
    for l, c, e, r, want in cases:
        g = got.get(l, ("?", "?"))
        good = g[0] == want
        allgood &= good
        print(("PASS" if good else "FAIL"), "  authorization:", l, "->", g[0], g[1][:70])
        RESULTS.append({"scenario": "T10 authorization: " + l, "pass": good, "checks": {"result": g[0], "message": g[1][:100]}})
    _, fin, _ = q(db, "select string_agg(left(user_id::text,18)||':'||role, ', ' order by user_id) from public.user_roles where user_id in ('" + "','".join([U(15), U(14)]) + "')")
    print("   plain user after admin assigns 'CREW' / master-assigned user:", fin)
    # after the test session: the master-assigned user has exactly one lowercase master row; plain user exactly one lowercase crew row
    _, m1, _ = q(db, f"select count(*)||':'||min(role) from public.user_roles where user_id='{U(14)}'")
    _, m2, _ = q(db, f"select count(*)||':'||min(role) from public.user_roles where user_id='{U(15)}'")
    good = m1 == "1:master" and m2 == "1:crew"
    RESULTS.append({"scenario": "T10 stored values are lowercase and replace the old role", "pass": good, "checks": {"master_assigned": m1, "admin_assigned_crew": m2}})
    print(("PASS" if good else "FAIL"), "T10 stored:", m1, m2)
    # the CHECK itself refuses case variants, privileges
    c, _, e = q(db, f"INSERT INTO public.user_roles (user_id, role) VALUES ('{U(13)}','MASTER')")
    good = c != 0 and "user_roles_role_check" in e
    RESULTS.append({"scenario": "T10 CHECK rejects 'MASTER' written directly", "pass": good, "checks": {"error": err1(e)}})
    print(("PASS" if good else "FAIL"), "T10 direct insert of 'MASTER' rejected by the CHECK:", err1(e)[:80])
    _, pr, _ = q(db, "select has_function_privilege('anon','public.assign_role_by_email(text,text)','EXECUTE')||'/'||has_function_privilege('authenticated','public.assign_role_by_email(text,text)','EXECUTE')||'/'||has_function_privilege('service_role','public.assign_role_by_email(text,text)','EXECUTE')||'/'||has_function_privilege('authenticated','public.auto_assign_customer_role()','EXECUTE')||'/'||has_function_privilege('service_role','public.auto_assign_customer_role()','EXECUTE')")
    good = pr == "false/true/true/false/true"
    RESULTS.append({"scenario": "T10 function privileges (anon/auth/service on assign; auth/service on signup fn)", "pass": good, "checks": {"result": pr}})
    print(("PASS" if good else "FAIL"), "T10 execute privileges anon/authenticated/service_role (assign), authenticated/service_role (signup fn):", pr)

    out = os.path.join(r"C:\Users\vikki\migration-evidence\c2-scratch", "c2_results_" + hashlib.md5(MIG.encode()).hexdigest()[:6] + ".json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"migration": MIG, "sha256": hashlib.sha256(open(MIG, "rb").read()).hexdigest(), "results": RESULTS}, open(out, "w", encoding="utf-8"), indent=1)
    print(f"\n{sum(1 for r in RESULTS if r['pass'])}/{len(RESULTS)} checks passed; results -> {out}")


main()
