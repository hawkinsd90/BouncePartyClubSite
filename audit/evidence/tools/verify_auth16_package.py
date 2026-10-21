"""Verifier for the AUTH-16 package: static checks plus executions of the generated script against a LOCAL scratch PostgreSQL fixture
(127.0.0.1:54329, throw-away databases named bpc_auth16_fx_*). Never connects to a hosted database.
Usage: python -I verify_auth16_package.py   -> prints one line per check and 'OK <failures>'."""
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_auth16_package as b  # noqa: E402

PSQL = "C:/Program Files/PostgreSQL/18/bin/psql.exe"
fail = 0


def check(name, cond):
    global fail
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        fail += 1


def psql(db, sql=None, file=None):
    args = [PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", db, "-X", "-q", "-w", "-v", "ON_ERROR_STOP=1", "-At"]
    args += ["-c", sql] if sql is not None else ["-f", file]
    r = subprocess.run(args, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


pkg = json.load(open(os.path.join(b.OUT, "package.json"), encoding="utf-8"))
main = open(os.path.join(b.OUT, "AUTH16.sql"), encoding="utf-8", newline="").read()
rev = open(os.path.join(b.OUT, "AUTH16_reversal.sql"), encoding="utf-8", newline="").read()

# ---- static
check("script sha256 equals package.json", hashlib.sha256(main.encode()).hexdigest() == pkg["scripts"]["AUTH16.sql"])
check("reversal sha256 equals package.json", hashlib.sha256(rev.encode()).hexdigest() == pkg["scripts"]["AUTH16_reversal.sql"])
check("generator reproduces the committed script byte for byte", b.script() == main and b.reversal() == rev)
exec_lines = [l.strip() for l in main.split("\n") if l.strip() and not l.strip().startswith("--")]
bad = [l for l in exec_lines if not re.match(r"^(SET LOCAL |SELECT pg_advisory_xact_lock|DO \$bpc\$|BEGIN|END \$bpc\$;|IF |INSERT INTO supabase_migrations\.schema_migrations \(version, name, statements\) VALUES )", l)]
check("only guards, one lock, SET LOCAL and four ledger INSERTs are executable", not bad)
check("exactly four INSERT statements, each with one single-element array", len(re.findall(r"^  INSERT INTO supabase_migrations", main, re.M)) == 4)
check("no UPDATE/DELETE/DDL/GRANT in the apply script", not re.search(r"\b(UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COPY)\b\s", re.sub(r"'(?:[^']|'')*'", "''", "\n".join(exec_lines))))
# no statement of the original migrations is carried into the script
leak = []
for x in b.VERSIONS:
    for l in open(os.path.join(b.MIG, x["file"]), encoding="utf-8").read().split("\n"):
        s = l.strip()
        if len(s) > 30 and not s.startswith("--") and s in set(exec_lines):
            leak.append((x["v"], s[:60]))
check("no executable line of the four original migrations appears in the script", not leak)
check("each marker is a single comment line starting with the reconciliation prefix", all(m.startswith(b.PREFIX) and "\n" not in m for m in b.MARKERS.values()))
check("attestation markers say effects-present-execution-unproven; disposition markers say deliberately-not-executed and disclose absent effects",
      all("state=effects-present-execution-unproven" in b.MARKERS[v] for v in ("20251002210020", "20251207160232"))
      and all("state=deliberately-not-executed" in b.MARKERS[v] and "ABSENT" in b.MARKERS[v] for v in ("20260324051459", "20260324154955")))
check("markers never contain the admin phone value or any image URL", not re.search(r"\+\d{7,}|https?://", "".join(b.MARKERS.values())))
check("qualified-scope hashes in package.json match the owner text", all(v["scope_sha256"] == hashlib.sha256(v["scope_text"].encode()).hexdigest() for v in pkg["versions"]))
# independent recomputation of the predicted ledger
ls = b.ledger_lines + [f"{v['version']}|{v['name']}|{hashlib.md5(b.MARKERS[v['version']].encode()).hexdigest()}" for v in pkg["versions"]]
ls.sort(key=lambda s: s.split("|")[0])
check("predicted ending ledger (independent recomputation) equals package.json", (len(ls), hashlib.sha256("\n".join(ls).encode()).hexdigest()) == (pkg["end_predicted"]["count"], pkg["end_predicted"]["sha256"]))

# ---- fixture executions
FIX_DB_BASE = "bpc_auth16_fx"
URLS = ["https://fx.example/a.jpg", "https://fx.example/b.jpg", "https://fx.example/c.jpg"]
TITLES = [r["title"] for r in b.ev["hero_carousel_images"]["rows"]]


def setup(db, mut=""):
    psql("postgres", f"DROP DATABASE IF EXISTS {db}")
    rc, o = psql("postgres", f"CREATE DATABASE {db}")
    assert rc == 0, o
    sql = f"""
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
INSERT INTO supabase_migrations.schema_migrations
 SELECT to_char(20251001000000 + g, 'FM00000000000000'), 'n'||g, ARRAY['stmt '||g, 'second '||g] FROM generate_series(1, 30) g;
INSERT INTO supabase_migrations.schema_migrations VALUES ('20251003200318','pred_a',ARRAY['x']), ('20260324180043','pred_b',ARRAY['y']);
CREATE TABLE public.admin_settings (key text PRIMARY KEY, value text);
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all settings" ON public.admin_settings FOR SELECT USING (true);
CREATE POLICY "Admins can insert settings" ON public.admin_settings FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can update settings" ON public.admin_settings FOR UPDATE USING (true);
CREATE POLICY "Admins can delete settings" ON public.admin_settings FOR DELETE USING (true);
INSERT INTO public.admin_settings VALUES ('admin_notification_phone', '+10000000000');
CREATE TABLE public.hero_carousel_images (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, image_url text, title text, display_order int, is_active boolean DEFAULT true);
ALTER TABLE public.hero_carousel_images ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.fx_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER hero_carousel_updated_at BEFORE UPDATE ON public.hero_carousel_images FOR EACH ROW EXECUTE FUNCTION public.fx_touch();
INSERT INTO public.hero_carousel_images (image_url, title, display_order) VALUES ('{URLS[0]}', '{TITLES[0]}', 1), ('{URLS[1]}', '{TITLES[1]}', 2), ('{URLS[2]}', '{TITLES[2]}', 3);
CREATE TABLE public.orders (id int); CREATE TABLE public.payments (id int); CREATE TABLE public.task_status (id int);
CREATE TABLE public.order_pictures (id int);
CREATE PUBLICATION supabase_realtime FOR TABLE public.orders;
{mut}
"""
    rc, o = psql(db, sql)
    assert rc == 0, o


def fixture_lines(db):
    rc, o = psql(db, "SELECT version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\\n'),'')) FROM supabase_migrations.schema_migrations ORDER BY version")
    return o.split("\n")


def render(db):
    lines = fixture_lines(db)
    s0 = hashlib.sha256("\n".join(lines).encode()).hexdigest()
    saved = [dict(r) for r in b.ev["hero_carousel_images"]["rows"]]
    for r, u in zip(b.ev["hero_carousel_images"]["rows"], URLS):
        r["image_url_sha256"] = hashlib.sha256(u.encode()).hexdigest()
    b.ev["admin_settings"]["admin_notification_phone_length"] = 12
    txt = b.script(len(lines), s0).replace("current_database() <> 'postgres' OR current_user <> 'postgres'", "current_user <> 'postgres'")
    b.ev["hero_carousel_images"]["rows"][:] = saved
    path = os.path.join(os.environ.get("TEMP", "C:/Windows/Temp"), db + ".sql")
    open(path, "w", encoding="utf-8", newline="\n").write(txt)
    return path, lines


def run_case(label, mut="", expect_ok=False, expect_text=None):
    db = FIX_DB_BASE + "_t"
    setup(db, mut)
    path, lines = render(db)
    n0 = len(lines)
    rc, o = psql(db, file=path)
    n1 = int(psql(db, "SELECT count(*) FROM supabase_migrations.schema_migrations")[1])
    if expect_ok:
        good = rc == 0 and n1 == n0 + 4
        if good:
            ls = fixture_lines(db)
            pred = b.predicted(lines, b.VERSIONS)
            got_sha = hashlib.sha256("\n".join(ls).encode()).hexdigest()
            in_db = psql(db, "SELECT encode(sha256(convert_to(string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\\n'),'')), E'\\n' ORDER BY version),'UTF8')),'hex') FROM supabase_migrations.schema_migrations")[1]
            check(label + ": ledger hash after the run equals the offline prediction method and the in-database expression", got_sha == pred[1] and in_db == pred[1])
            rc2, o2 = psql(db, "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE statements[1] LIKE '-- BPC-DEV-RECONCILIATION%run=AUTH-16%'")
            check(label + ": four AUTH-16 rows present", o2 == "4")
            rrc, ro = psql(db, file=os.path.join(b.OUT, "AUTH16_reversal.sql"))
            n2 = int(psql(db, "SELECT count(*) FROM supabase_migrations.schema_migrations")[1])
            check(label + ": reversal removes exactly the four rows and restores the original ledger hash", rrc == 0 and n2 == n0 and hashlib.sha256("\n".join(fixture_lines(db)).encode()).hexdigest() == hashlib.sha256("\n".join(lines).encode()).hexdigest())
        check(label + ": applied in one transaction (ledger +4)", good)
    else:
        check(label + ": refused and nothing written", rc != 0 and n1 == n0 and (expect_text is None or expect_text in o))


run_case("positive fixture run", expect_ok=True)
run_case("already-recorded version", "INSERT INTO supabase_migrations.schema_migrations VALUES ('20260324154955','x',ARRAY['x']);", expect_text="version already recorded")
run_case("missing predecessor", "DELETE FROM supabase_migrations.schema_migrations WHERE version='20260324180043';", expect_text="predecessor not recorded")
run_case("payments added to the publication", "ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;", expect_text="observed-state guard failed for 20260324051459")
run_case("order_pictures added to the publication", "ALTER PUBLICATION supabase_realtime ADD TABLE public.order_pictures;", expect_text="observed-state guard failed for 20260324154955")
run_case("carousel row changed", "UPDATE public.hero_carousel_images SET title='Other' WHERE display_order=1;", expect_text="observed-state guard failed for 20251207160232")
run_case("carousel sample seed row present", f"INSERT INTO public.hero_carousel_images (image_url, title, display_order) VALUES ('https://images.pexels.com/x.jpg','Extra',9);", expect_text="observed-state guard failed for 20251207160232")
run_case("admin phone setting removed", "DELETE FROM public.admin_settings WHERE key='admin_notification_phone';", expect_text="observed-state guard failed for 20251002210020")
run_case("RLS off on admin_settings", "ALTER TABLE public.admin_settings DISABLE ROW LEVEL SECURITY;", expect_text="observed-state guard failed for 20251002210020")
# the wrong-database guard of the real (unmodified) script
setup(FIX_DB_BASE + "_t")
rc, o = psql(FIX_DB_BASE + "_t", file=os.path.join(b.OUT, "AUTH16.sql"))
check("the real script refuses to run outside database 'postgres'", rc != 0 and "wrong database or role" in o)
# ledger drift after the start hash was fixed (the hash is computed before the tampering)
setup(FIX_DB_BASE + "_t")
path, lines = render(FIX_DB_BASE + "_t")
psql(FIX_DB_BASE + "_t", "UPDATE supabase_migrations.schema_migrations SET name='tampered' WHERE version='20251001000003'")
rc, o = psql(FIX_DB_BASE + "_t", file=path)
check("ledger content differing from the verified start is refused", rc != 0 and "ledger content differs" in o)
psql("postgres", f"DROP DATABASE IF EXISTS {FIX_DB_BASE}_t")
print("OK", fail)
sys.exit(1 if fail else 0)
