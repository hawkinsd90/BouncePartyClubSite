"""Builds the AUTH-18 package: applies the four reviewed 20261027* migrations to Development, one guarded transaction per migration, each followed by
its ledger row (statements = [marker, exact file SQL], the same convention as the SG-3 executor). Offline: reads supabase/migrations and the verified
ledger snapshot audit/step4/auth18-work/ledger376.lines. Never connects to a database.
Usage: python -I build_auth18_package.py"""
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WORK = os.path.join(REPO, "audit", "step4", "auth18-work")
OUT = os.path.join(REPO, "audit", "step4", "auth18-package")
MIG = os.path.join(REPO, "supabase", "migrations")
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()
md5 = lambda s: hashlib.md5(s.encode("utf-8")).hexdigest()
lit = lambda s: "'" + s.replace("'", "''") + "'"
START_COUNT = 376
START_SHA = "eea22f7960f9a2478e99a652afcb12db08a386af6af3b741181ee49dc860f4d0"
lines = open(os.path.join(WORK, "ledger376.lines"), encoding="utf-8", newline="").read().split("\n")
assert len(lines) == START_COUNT and sha("\n".join(lines)) == START_SHA, "ledger snapshot does not match the verified Development ledger"

LEDGER_SHA_EXPR = ("(SELECT encode(sha256(convert_to(string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\\n'),'')), "
                   "E'\\n' ORDER BY version),'UTF8')),'hex') FROM supabase_migrations.schema_migrations)")
ANON_FN_COUNT = ("(SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE') "
                 "AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'))")
ANON_TBL_COUNT = ("(SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m') "
                  "AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE')))")

M = [
    {"v": "20261027120000", "file": "20261027120000_same_day_delivery_fee_days.sql", "name": "same_day_delivery_fee_days",
     "post": ["EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pricing_rules' AND column_name='same_day_delivery_fee_days')",
              "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.pricing_rules'::regclass AND conname='pricing_rules_same_day_delivery_fee_days_valid')",
              "NOT EXISTS (SELECT 1 FROM public.pricing_rules WHERE same_day_delivery_fee_days IS DISTINCT FROM '{1,2,3,4,5}'::smallint[])"],
     "pre": ["NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pricing_rules' AND column_name='same_day_delivery_fee_days')"],
     "rollback": ["ALTER TABLE public.pricing_rules DROP CONSTRAINT IF EXISTS pricing_rules_same_day_delivery_fee_days_valid;",
                  "ALTER TABLE public.pricing_rules DROP COLUMN IF EXISTS same_day_delivery_fee_days;"]},
    {"v": "20261027130000", "file": "20261027130000_payment_post_completion.sql", "name": "payment_post_completion",
     "pre": ["NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='post_completed_at')",
             "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.transaction_receipts'::regclass AND conname='unique_receipt_pi_type')",
             "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.transaction_receipts'::regclass AND conname='unique_receipt_charge_type')"],
     "post": ["EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='post_completed_at')",
              "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='post_claim_until')",
              "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invoices' AND column_name='setup_fee_cents')",
              "(SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname IN ('uq_transaction_receipts_pi_type','uq_transaction_receipts_charge_type','uq_transaction_receipts_payment_type')) = 3",
              "NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.transaction_receipts'::regclass AND conname IN ('unique_receipt_pi_type','unique_receipt_charge_type'))",
              "to_regprocedure('public.claim_post_payment_completion(uuid,integer)') IS NOT NULL AND to_regprocedure('public.finish_post_payment_completion(uuid)') IS NOT NULL AND to_regprocedure('public.release_post_payment_claim(uuid)') IS NOT NULL",
              "NOT has_function_privilege('anon','public.claim_post_payment_completion(uuid,integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.claim_post_payment_completion(uuid,integer)','EXECUTE') AND has_function_privilege('service_role','public.claim_post_payment_completion(uuid,integer)','EXECUTE')"],
     "rollback": ["DROP FUNCTION IF EXISTS public.claim_post_payment_completion(uuid, integer);", "DROP FUNCTION IF EXISTS public.finish_post_payment_completion(uuid);",
                  "DROP FUNCTION IF EXISTS public.release_post_payment_claim(uuid);",
                  "DROP INDEX IF EXISTS public.uq_transaction_receipts_pi_type;", "DROP INDEX IF EXISTS public.uq_transaction_receipts_charge_type;", "DROP INDEX IF EXISTS public.uq_transaction_receipts_payment_type;",
                  "-- the two original NULLS NOT DISTINCT constraints are restored only while no receipt without a Stripe id has been written since the migration:",
                  "ALTER TABLE public.transaction_receipts ADD CONSTRAINT unique_receipt_pi_type UNIQUE NULLS NOT DISTINCT (stripe_payment_intent_id, transaction_type);",
                  "ALTER TABLE public.transaction_receipts ADD CONSTRAINT unique_receipt_charge_type UNIQUE NULLS NOT DISTINCT (stripe_charge_id, transaction_type);",
                  "ALTER TABLE public.invoices DROP COLUMN IF EXISTS setup_fee_cents;", "ALTER TABLE public.payments DROP COLUMN IF EXISTS post_claim_until;", "ALTER TABLE public.payments DROP COLUMN IF EXISTS post_completed_at;"]},
    {"v": "20261027150000", "file": "20261027150000_require_start_mileage_setting.sql", "name": "require_start_mileage_setting",
     "pre": ["NOT EXISTS (SELECT 1 FROM public.admin_settings WHERE key = 'require_start_mileage')"],
     "post": ["(SELECT count(*) FROM public.admin_settings WHERE key IN ('require_start_mileage','require_delivery_photo','require_pickup_photo')) = 3",
              "jsonb_exists(public.get_public_business_settings(), 'require_start_mileage')",
              "has_function_privilege('anon','public.get_public_business_settings()','EXECUTE') AND has_function_privilege('authenticated','public.get_public_business_settings()','EXECUTE')",
              "NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = 'public.get_public_business_settings()'::regprocedure AND a.grantee = 0)"],
     "rollback": ["DELETE FROM public.admin_settings WHERE key IN ('require_start_mileage','require_delivery_photo','require_pickup_photo');",
                  "-- the previous get_public_business_settings() body is the one in supabase/migrations/20260820165646_add_how_did_you_hear_enabled_setting.sql (re-run its CREATE OR REPLACE FUNCTION block)"]},
    {"v": "20261027160000", "file": "20261027160000_task_evidence_required.sql", "name": "task_evidence_required",
     "pre": ["to_regclass('public.task_evidence_overrides') IS NULL"],
     "post": ["to_regclass('public.task_evidence_overrides') IS NOT NULL AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.task_evidence_overrides'::regclass)",
              "EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.task_status'::regclass AND tgname='trg_enforce_task_evidence' AND NOT tgisinternal AND tgenabled <> 'D')",
              "to_regprocedure('public.get_task_evidence_state(uuid)') IS NOT NULL AND NOT has_function_privilege('anon','public.get_task_evidence_state(uuid)','EXECUTE')",
              "NOT has_table_privilege('anon','public.task_evidence_overrides','SELECT')"],
     "rollback": ["DROP TRIGGER IF EXISTS trg_enforce_task_evidence ON public.task_status;", "DROP FUNCTION IF EXISTS public.enforce_task_evidence();",
                  "DROP FUNCTION IF EXISTS public.get_task_evidence_state(uuid);", "DROP FUNCTION IF EXISTS public.task_evidence_photo_count(jsonb);", "DROP FUNCTION IF EXISTS public.task_evidence_required(text);",
                  "-- the overrides table (and its rows) is dropped last; export it first if any override has been written:",
                  "DROP TABLE IF EXISTS public.task_evidence_overrides;"]},
]
for m in M:
    raw = open(os.path.join(MIG, m["file"]), "rb").read()
    m["bytes"] = raw
    m["sql"] = raw.decode("utf-8")
    m["file_sha256"] = sha(raw)
    assert "$bpcsql$" not in m["sql"] and "$bpcm$" not in m["sql"] and "$bpc$" not in m["sql"]
    m["marker"] = (f"-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18); version={m['v']}; file={m['file']}; file_sha256={m['file_sha256']}; "
                   "the exact file text follows as statements[2]")


def predicted(cur_lines, m):
    row = f"{m['v']}|{m['name']}|{md5(m['marker'] + chr(10) + m['sql'])}"
    nl = sorted(cur_lines + [row], key=lambda s: s.split("|")[0])
    return nl, len(nl), sha("\n".join(nl))


def script(m, n0, sha0):
    G = [f"-- BPC-DEV-MIGRATION AUTH-18 {m['v']} {m['file']}; bound by the owner authorization that quotes this file's SHA-256",
         "SET LOCAL lock_timeout = '3s';", "SET LOCAL statement_timeout = '120s';", "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));",
         "DO $bpc$", "BEGIN",
         "  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'wrong database or role'; END IF;",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {n0} THEN RAISE EXCEPTION 'ledger count differs from the verified ledger'; END IF;",
         f"  IF {LEDGER_SHA_EXPR} <> {lit(sha0)} THEN RAISE EXCEPTION 'ledger content differs from the verified ledger'; END IF;",
         f"  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = {lit(m['v'])}) THEN RAISE EXCEPTION 'version already recorded'; END IF;",
         "  IF NOT (has_schema_privilege('anon', 'public', 'USAGE') AND has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'S11 end state is not in force'; END IF;"]
    for i, p in enumerate(m["pre"], 1):
        G.append(f"  IF NOT COALESCE(({p}), false) THEN RAISE EXCEPTION 'precondition {i} failed'; END IF;")
    G += [f"  PERFORM set_config('bpc.anon_fn_before', ({ANON_FN_COUNT})::text, true);", f"  PERFORM set_config('bpc.anon_tbl_before', ({ANON_TBL_COUNT})::text, true);", "END $bpc$;",
          "-- ---- the reviewed migration, byte for byte ----", m["sql"].rstrip("\n"), "-- ---- end of the reviewed migration ----",
          "DO $bpc$", "BEGIN"]
    for i, p in enumerate(m["post"], 1):
        G.append(f"  IF NOT COALESCE(({p}), false) THEN RAISE EXCEPTION 'postcondition {i} failed'; END IF;")
    G += [f"  IF ({ANON_FN_COUNT})::text <> current_setting('bpc.anon_fn_before') THEN RAISE EXCEPTION 'the set of functions anon can execute changed'; END IF;",
          f"  IF ({ANON_TBL_COUNT})::text <> current_setting('bpc.anon_tbl_before') THEN RAISE EXCEPTION 'the set of tables anon can touch changed'; END IF;",
          "END $bpc$;",
          f"INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ({lit(m['v'])}, {lit(m['name'])}, ARRAY[$bpcm${m['marker']}$bpcm$, $bpcsql${m['sql']}$bpcsql$]);",
          "DO $bpc$", "BEGIN",
          f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {n0 + 1} THEN RAISE EXCEPTION 'unexpected ledger count after the migration'; END IF;",
          f"  IF (SELECT statements[2] FROM supabase_migrations.schema_migrations WHERE version = {lit(m['v'])}) <> $bpcsql${m['sql']}$bpcsql$ THEN RAISE EXCEPTION 'stored SQL differs from the file'; END IF;",
          "END $bpc$;"]
    return "\n".join(G) + "\n"


def rollback(m):
    L = [f"-- BPC-DEV-MIGRATION AUTH-18 ROLLBACK for {m['v']} (owner-approved use only; run only if a post-check fails or the owner decides to revert)",
         "SET LOCAL lock_timeout = '3s';", "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-migration'));"] + m["rollback"] + [
        f"DELETE FROM supabase_migrations.schema_migrations WHERE version = {lit(m['v'])} AND statements[1] LIKE '-- BPC-DEV-MIGRATION applied by the guarded executor (AUTH-18)%';"]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        os.remove(os.path.join(OUT, old))
    cur, n0, s0 = list(lines), START_COUNT, START_SHA
    files, steps = {}, []
    for i, m in enumerate(M, 1):
        fn = f"{i}_{m['v']}.sql"
        files[fn] = script(m, n0, s0)
        files[f"{i}_{m['v']}_rollback.sql"] = rollback(m)
        cur, n1, s1 = predicted(cur, m)
        steps.append({"step": i, "version": m["v"], "file": m["file"], "file_sha256": m["file_sha256"], "script": fn,
                      "ledger_before": {"count": n0, "sha256": s0}, "ledger_after": {"count": n1, "sha256": s1}})
        n0, s0 = n1, s1
    for fn, txt in files.items():
        open(os.path.join(OUT, fn), "w", encoding="utf-8", newline=chr(10)).write(txt)
    pkg = {"stage": "AUTH-18", "channel": "supabase db query --linked -f <absolute path>, one transaction per file, in order, stop on any failure",
           "start": {"count": START_COUNT, "sha256": START_SHA}, "end_predicted": {"count": n0, "sha256": s0}, "steps": steps,
           "scripts": {fn: sha(t.encode()) for fn, t in sorted(files.items())}}
    for st in steps:
        st["script_sha256"] = pkg["scripts"][st["script"]]
    open(os.path.join(OUT, "package.json"), "w", encoding="utf-8", newline=chr(10)).write(json.dumps(pkg, indent=1) + chr(10))
    print("end", n0, s0)
    for st in steps:
        print(st["step"], st["version"], st["script_sha256"][:16], st["ledger_after"]["count"], st["ledger_after"]["sha256"][:16])
