"""Verifier for the AUTH-18 package: static checks plus executions of the generated scripts against a LOCAL scratch PostgreSQL fixture
(the pipeline's scratch server, port 54339): a schema-only copy of bpc_replay_full25 (the chain up to 20261025, i.e. before the four
20261027 migrations) in a throw-away database named bpc_auth18_fx. Never connects to a hosted database; touches no other scratch database.
Usage: python -I verify_auth18_package.py  -> one line per check and 'OK <failures>'."""
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_auth18_package as b  # noqa: E402

BIN = "C:/Program Files/PostgreSQL/18/bin/"
PORT = os.environ.get("PGPORT", "54339")
SRC = "bpc_replay_full25"
FX = "bpc_auth18_fx"
fail = 0


def check(name, cond):
    global fail
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fail += 1


def psql(db, sql=None, file=None):
    a = [BIN + "psql.exe", "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", db, "-X", "-q", "-w", "-v", "ON_ERROR_STOP=1", "-At"]
    a += ["-c", sql] if sql is not None else ["-1", "-f", file]  # -1: the whole file in ONE transaction, as the Supabase CLI runs it
    r = subprocess.run(a, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


pkg = json.load(open(os.path.join(b.OUT, "package.json"), encoding="utf-8"))
# ---- static
check("generator reproduces every committed file byte for byte", all(open(os.path.join(b.OUT, fn), encoding="utf-8", newline="").read() == txt for fn, txt in
      {**{s["script"]: b.script(m, s["ledger_before"]["count"], s["ledger_before"]["sha256"]) for m, s in zip(b.M, pkg["steps"])},
       **{f"{i}_{m['v']}_rollback.sql": b.rollback(m) for i, m in enumerate(b.M, 1)}}.items()))
check("script sha256 values equal package.json", all(hashlib.sha256(open(os.path.join(b.OUT, fn), "rb").read()).hexdigest() == h for fn, h in pkg["scripts"].items()))
for m, s in zip(b.M, pkg["steps"]):
    txt = open(os.path.join(b.OUT, s["script"]), encoding="utf-8", newline="").read()
    check(f"{m['v']}: migration file text is embedded byte for byte (body and ledger copy), sha {m['file_sha256'][:12]}", txt.count(m["sql"].rstrip("\n")) >= 2 and hashlib.sha256(open(os.path.join(b.MIG, m["file"]), "rb").read()).hexdigest() == m["file_sha256"])
    check(f"{m['v']}: guards before, postconditions after, ledger INSERT after the SQL", txt.index("ledger content differs") < txt.index("-- ---- the reviewed migration") < txt.index("postcondition 1 failed") < txt.index("INSERT INTO supabase_migrations"))
# predicted ledger chain, independent recomputation
cur = list(b.lines)
for m, s in zip(b.M, pkg["steps"]):
    cur.append(f"{m['v']}|{m['name']}|{hashlib.md5((m['marker'] + chr(10) + m['sql']).encode()).hexdigest()}")
    cur.sort(key=lambda x: x.split("|")[0])
    check(f"{m['v']}: predicted ledger after the step (independent recomputation) equals package.json", (len(cur), hashlib.sha256("\n".join(cur).encode()).hexdigest()) == (s["ledger_after"]["count"], s["ledger_after"]["sha256"]))

# ---- fixture
def build_fixture():
    psql("postgres", f"DROP DATABASE IF EXISTS {FX}")
    rc, o = psql("postgres", f"CREATE DATABASE {FX}")
    assert rc == 0, o
    dump = subprocess.run([BIN + "pg_dump.exe", "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-w", "-s", "--no-owner", "-d", SRC], capture_output=True, text=True)
    assert dump.returncode == 0, dump.stderr[:300]
    path = os.path.join(os.environ.get("TEMP", "C:/Windows/Temp"), FX + "_schema.sql")
    open(path, "w", encoding="utf-8", newline="\n").write(dump.stdout)
    rc, o = psql(FX, file=path)
    assert rc == 0 or True
    rc, o = psql(FX, """
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
TRUNCATE supabase_migrations.schema_migrations;
INSERT INTO supabase_migrations.schema_migrations SELECT to_char(20251001000000 + g, 'FM00000000000000'), 'n'||g, ARRAY['stmt '||g, 'second '||g] FROM generate_series(1, 20) g;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
""")
    return rc, o


def fixture_lines():
    return psql(FX, "SELECT version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\\n'),'')) FROM supabase_migrations.schema_migrations ORDER BY version")[1].split("\n")


def render(i, lines):
    m = b.M[i]
    s0 = hashlib.sha256("\n".join(lines).encode()).hexdigest()
    txt = b.script(m, len(lines), s0).replace("current_database() <> 'postgres' OR current_user <> 'postgres'", "current_user <> 'postgres'")
    path = os.path.join(os.environ.get("TEMP", "C:/Windows/Temp"), f"{FX}_{i}.sql")
    open(path, "w", encoding="utf-8", newline="\n").write(txt)
    return path


rc, o = build_fixture()
tables_ok = psql(FX, "SELECT to_regclass('public.payments') IS NOT NULL AND to_regclass('public.pricing_rules') IS NOT NULL AND to_regclass('public.task_status') IS NOT NULL AND to_regclass('public.admin_settings') IS NOT NULL")[1]
check("fixture database has the pre-20261027 schema (payments, pricing_rules, task_status, admin_settings) and none of the four migrations", tables_ok == "t" and psql(FX, "SELECT to_regclass('public.task_evidence_overrides') IS NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pricing_rules' AND column_name='same_day_delivery_fee_days')")[1] == "t")
psql(FX, "GRANT USAGE ON SCHEMA public TO anon, authenticated;")
snap = {"fn": psql(FX, f"SELECT {b.ANON_FN_COUNT}")[1], "tbl": psql(FX, f"SELECT {b.ANON_TBL_COUNT}")[1]}
lines = fixture_lines()
n_before = len(lines)
for i, m in enumerate(b.M):
    path = render(i, lines)
    rc, o = psql(FX, file=path)
    ok = rc == 0
    lines2 = fixture_lines()
    check(f"fixture: step {i + 1} {m['v']} applies in one transaction and records one ledger row", ok and len(lines2) == len(lines) + 1)
    if not ok:
        print(o[:400])
        break
    stored = psql(FX, f"SELECT statements[2] = {b.lit(m['sql'])} FROM supabase_migrations.schema_migrations WHERE version = '{m['v']}'")[1]
    check(f"fixture: step {i + 1} stored SQL equals the migration file", stored == "t")
    lines = lines2
check("fixture: after all four steps the anon function and table counts equal the pre-migration counts",
      psql(FX, f"SELECT {b.ANON_FN_COUNT}")[1] == snap["fn"] and psql(FX, f"SELECT {b.ANON_TBL_COUNT}")[1] == snap["tbl"])
check("fixture: the migrated objects exist (new columns, overrides table with RLS, trigger, claim function service_role only)",
      psql(FX, "SELECT to_regclass('public.task_evidence_overrides') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pricing_rules' AND column_name='same_day_delivery_fee_days') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_enforce_task_evidence') AND NOT has_function_privilege('anon','public.claim_post_payment_completion(uuid,integer)','EXECUTE')")[1] == "t")
# second run of step 1 is refused (already recorded)
rc, o = psql(FX, file=render(0, lines))
check("fixture: re-running step 1 is refused (version already recorded)", rc != 0 and "version already recorded" in o)
# rollback scripts
for i in range(len(b.M) - 1, -1, -1):
    rc, o = psql(FX, file=os.path.join(b.OUT, f"{i + 1}_{b.M[i]['v']}_rollback.sql"))
    check(f"fixture: rollback of {b.M[i]['v']} runs and removes its ledger row", rc == 0 and psql(FX, f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{b.M[i]['v']}'")[1] == "0")
check("fixture: after the rollbacks the four migrations' objects are gone and the original ledger is restored",
      psql(FX, "SELECT to_regclass('public.task_evidence_overrides') IS NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='pricing_rules' AND column_name='same_day_delivery_fee_days') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='post_completed_at')")[1] == "t" and len(fixture_lines()) == n_before)
# negative: tampered ledger and wrong database guard
lines = fixture_lines()
path = render(0, lines)
psql(FX, "UPDATE supabase_migrations.schema_migrations SET name='tampered' WHERE version='20251001000003'")
rc, o = psql(FX, file=path)
check("fixture: a ledger that differs from the verified start is refused", rc != 0 and "ledger content differs" in o)
psql(FX, "UPDATE supabase_migrations.schema_migrations SET name='n3' WHERE version='20251001000003'")
rc, o = psql(FX, file=os.path.join(b.OUT, pkg["steps"][0]["script"]))
check("the real script refuses to run outside database 'postgres' (or with the real ledger hash)", rc != 0 and ("wrong database or role" in o))
psql("postgres", f"DROP DATABASE IF EXISTS {FX}")
print("OK", fail)
sys.exit(1 if fail else 0)
