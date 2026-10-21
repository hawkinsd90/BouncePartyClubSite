"""Builds the AUTH-16 ledger package: two qualified owner attestations (20251002210020, 20251207160232) and two deliberately-not-executed
Realtime dispositions (20260324051459, 20260324154955). Offline: reads the committed read-only evidence in audit/step4/auth16-work/
(ledger372.lines = per-row digests of the live Development ledger, evidence.json = read-only catalog/data observations) and the four reviewed
migration files. It never connects to a database and never emits any statement of the original migrations.
Usage: python -I build_auth16_package.py"""
import hashlib
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
WORK = os.path.join(REPO, "audit", "step4", "auth16-work")
OUT = os.path.join(REPO, "audit", "step4", "auth16-package")
MIG = os.path.join(REPO, "supabase", "migrations")
PREFIX = "-- BPC-DEV-RECONCILIATION"
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()
md5 = lambda s: hashlib.md5(s.encode("utf-8")).hexdigest()
lit = lambda s: "'" + s.replace("'", "''") + "'"

START_COUNT = 372
START_SHA = "1dd1460ed16934cedba0bfa64e4db15f91268bdd9e87de1c59d0b5b0756b56ed"
ledger_lines = open(os.path.join(WORK, "ledger372.lines"), encoding="utf-8", newline="").read().split("\n")
assert len(ledger_lines) == START_COUNT and sha("\n".join(ledger_lines)) == START_SHA, "ledger snapshot does not match the verified live ledger"
evidence_bytes = open(os.path.join(WORK, "evidence.json"), "rb").read()
EVIDENCE_SHA = sha(evidence_bytes)
ev = json.loads(evidence_bytes)

# the owner's exact qualifications (owner chat message, AUTH-16 request); the text is hashed byte for byte
SCOPE_A = ("The Development database currently contains the admin_settings table with RLS enabled and the admin_notification_phone setting present. "
           "The owner confirms that its existing value is intentional and must be preserved. The historical migration's original ADMIN policies have been "
           "superseded by subsequent policies. Execution of the historical SQL is not proven. This attestation records the observed current-state outcome only "
           "and does not authorize executing the original SQL, recreating superseded policies, or modifying the setting.")
SCOPE_B = ("The Development database currently contains the hero_carousel_images table, RLS and the hero_carousel_updated_at trigger. Three current carousel "
           "records exist: Birthday Parties, School Events and Community Events. The owner confirms these are the intended current slides and should be "
           "preserved. Their images do not match the historical migration's original Pexels seed images, and original seed execution is not proven. Existing "
           "policies have been revised by subsequent migrations. This attestation records the observed current-state outcome only and does not authorize "
           "executing historical SQL, inserting sample slides, changing images or replacing current carousel content.")
NOTE_C = ("Disclosed: the supabase_realtime publication currently contains only public.orders; the publication membership this migration would add "
          "(payments, task_status, order_signatures, order_lot_pictures) is ABSENT, so no effect of this migration is claimed present. Owner disposition: "
          "deliberately not executed; the original SQL is not run and no table is added to the publication by this record. Any future realtime need for "
          "task_status or order_lot_pictures requires a separate, narrowly scoped functional migration.")
NOTE_D = ("Disclosed: order_pictures is NOT in the supabase_realtime publication, so the historical effect is ABSENT and no effect is claimed present. Owner "
          "disposition: deliberately not executed; the original SQL is not run and no table is added to the publication by this record. No current "
          "application subscriber justifies the historical publication change.")

SOURCE = ("owner decision in the Claude Code chat message headed 'TWO QUALIFIED HISTORICAL ATTESTATIONS AND TWO REALTIME DISPOSITIONS' "
          "(owner of Bounce Party Club LLC); no handwritten signature exists or is claimed")
AT = "not recorded by the chat record (execution time is in the operator log entry for this run)"

VERSIONS = [
    {"v": "20251002210020", "file": "20251002210020_008_add_admin_settings.sql", "name": "008_add_admin_settings", "kind": "attest",
     "state": "effects-present-execution-unproven", "scope": SCOPE_A, "pred": ["20251003200318"]},
    {"v": "20251207160232", "file": "20251207160232_add_hero_carousel_system.sql", "name": "add_hero_carousel_system", "kind": "attest",
     "state": "effects-present-execution-unproven", "scope": SCOPE_B, "pred": ["20260324180043"]},
    {"v": "20260324051459", "file": "20260324051459_add_tables_to_realtime_publication.sql", "name": "add_tables_to_realtime_publication", "kind": "not-executed",
     "state": "deliberately-not-executed", "scope": NOTE_C, "pred": []},
    {"v": "20260324154955", "file": "20260324154955_add_order_pictures_to_realtime_publication.sql", "name": "add_order_pictures_to_realtime_publication", "kind": "not-executed",
     "state": "deliberately-not-executed", "scope": NOTE_D, "pred": []},
]
for x in VERSIONS:
    x["file_sha256"] = sha(open(os.path.join(MIG, x["file"]), "rb").read())
    x["scope_sha256"] = sha(x["scope"])
FILE_SHA_REVIEWED = {"20251002210020": "1be19867dc5ba5e600d5a04c1d372a784d1143722195328581b29327471fe74b",
                     "20251207160232": "42abe93bfa173c9b332a9bf18735e0abffc55c5ba96b67fececb250b3bdc1d86",
                     "20260324051459": "b91664177686fb03c774c0efc07e6c9236a0ceb0bda3c0dbd9b09db7d8415bbd",
                     "20260324154955": "9fed5ab4c75b4441ae28ce3ba473fc574b34a996bc1c0127d5c71c23360d506c"}
for x in VERSIONS:
    assert x["file_sha256"] == FILE_SHA_REVIEWED[x["v"]], ("reviewed file hash differs", x["v"])
assert ev["ledger_count"] == START_COUNT and ev["versions_already_recorded"] == []
assert ev["realtime_publication_supabase_realtime"] == ["public.orders"]
assert ev["hero_carousel_images"]["row_count"] == 3 and not ev["hero_carousel_images"]["pexels_seed_urls_present"]
assert ev["admin_settings"]["rls"] and ev["admin_settings"]["admin_notification_phone_present"]


def marker(x):
    if x["kind"] == "attest":
        return (f"{PREFIX} attestation NOT EXECUTED run=AUTH-16 state={x['state']} version={x['v']} attested_by={SOURCE} attested_at={AT} "
                f"file={x['file']} file_sha256={x['file_sha256']} scope_sha256={x['scope_sha256']} evidence_sha256={EVIDENCE_SHA} "
                f"scope=ledger marker only; original SQL NOT executed by this record; qualified scope: {x['scope']}")
    return (f"{PREFIX} disposition NOT EXECUTED run=AUTH-16 state={x['state']} version={x['v']} decided_by={SOURCE} decided_at={AT} "
            f"file={x['file']} file_sha256={x['file_sha256']} scope_sha256={x['scope_sha256']} evidence_sha256={EVIDENCE_SHA} "
            f"scope=ledger marker only; original SQL NOT executed by this record; {x['scope']}")


MARKERS = {x["v"]: marker(x) for x in VERSIONS}
for m in MARKERS.values():
    assert "\n" not in m and "\r" not in m


def rule(x):
    v = x["v"]
    if v == "20251002210020":
        return ("(to_regclass('public.admin_settings') IS NOT NULL AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.admin_settings'::regclass) "
                "AND (SELECT length(value) FROM public.admin_settings WHERE key = 'admin_notification_phone') = "
                f"{ev['admin_settings']['admin_notification_phone_length']} "
                "AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_settings' AND policyname IN "
                "('Admins can view all settings','Admins can insert settings','Admins can update settings','Admins can delete settings')) = 4)")
    if v == "20251207160232":
        titles = ",".join(lit(r["title"]) for r in ev["hero_carousel_images"]["rows"])
        urlhashes = ",".join(lit(r["image_url_sha256"]) for r in ev["hero_carousel_images"]["rows"])
        return ("(to_regclass('public.hero_carousel_images') IS NOT NULL AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hero_carousel_images'::regclass) "
                "AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.hero_carousel_images'::regclass AND tgname = 'hero_carousel_updated_at' AND NOT tgisinternal) "
                "AND (SELECT count(*) FROM public.hero_carousel_images) = 3 "
                f"AND (SELECT count(*) FROM public.hero_carousel_images WHERE title = ANY(ARRAY[{titles}]) AND is_active) = 3 "
                f"AND (SELECT count(*) FROM public.hero_carousel_images WHERE encode(sha256(convert_to(image_url,'UTF8')),'hex') = ANY(ARRAY[{urlhashes}])) = 3 "
                "AND NOT EXISTS (SELECT 1 FROM public.hero_carousel_images WHERE image_url LIKE '%pexels%'))")
    if v == "20260324051459":
        return ("(EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' "
                "AND schemaname = 'public' AND tablename IN ('payments','task_status','order_signatures','order_lot_pictures')))")
    return ("(EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' "
            "AND schemaname = 'public' AND tablename = 'order_pictures'))")


LEDGER_SHA_EXPR = ("(SELECT encode(sha256(convert_to(string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\\n'),'')), "
                   "E'\\n' ORDER BY version),'UTF8')),'hex') FROM supabase_migrations.schema_migrations)")


def predicted(lines, adds):
    ls = list(lines)
    for x in adds:
        ls.append(f"{x['v']}|{x['name']}|{md5(MARKERS[x['v']])}")
    ls.sort(key=lambda s: s.split("|")[0])
    return len(ls), sha("\n".join(ls))


def script(start_count=START_COUNT, start_sha=START_SHA):
    L = [f"{PREFIX} script AUTH-16: 2 qualified attestations + 2 deliberately-not-executed dispositions (ledger markers only); bound by the owner authorization that quotes this file's SHA-256",
         "SET LOCAL lock_timeout = '3s';", "SET LOCAL statement_timeout = '60s';", "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));",
         "DO $bpc$", "BEGIN",
         "  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'wrong database or role'; END IF;",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {start_count} THEN RAISE EXCEPTION 'ledger count differs from the verified pre-batch ledger'; END IF;",
         f"  IF {LEDGER_SHA_EXPR} <> {lit(start_sha)} THEN RAISE EXCEPTION 'ledger content differs from the verified pre-batch ledger'; END IF;"]
    for i, x in enumerate(VERSIONS, 1):
        v = x["v"]
        L.append(f"  -- op {i}: {v} ({x['state']})")
        L.append(f"  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = {lit(v)}) THEN RAISE EXCEPTION 'version already recorded: {v}'; END IF;")
        if x["pred"]:
            arr = ",".join(lit(p) for p in x["pred"])
            L.append(f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}])) <> {len(x['pred'])} THEN RAISE EXCEPTION 'predecessor not recorded for {v}'; END IF;")
        L.append(f"  IF NOT COALESCE({rule(x)}, false) THEN RAISE EXCEPTION 'observed-state guard failed for {v}'; END IF;")
        L.append(f"  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ({lit(v)}, {lit(x['name'])}, ARRAY[{lit(MARKERS[v])}]);")
    L += [f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {start_count} + {len(VERSIONS)} THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;", "END $bpc$;"]
    return "\n".join(L) + "\n"


def reversal(start_count=START_COUNT):
    arr = ",".join(lit(x["v"]) for x in VERSIONS)
    like = lit(PREFIX + "%run=AUTH-16%")
    L = [f"{PREFIX} REVERSAL for AUTH-16 (owner-approved use only): deletes exactly the four AUTH-16 rows", "SET LOCAL lock_timeout = '3s';",
         "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));", "DO $bpc$", "DECLARE before_n bigint;", "BEGIN",
         "  SELECT count(*) INTO before_n FROM supabase_migrations.schema_migrations;",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}]) AND statements[1] LIKE {like}) <> {len(VERSIONS)} THEN RAISE EXCEPTION 'AUTH-16 rows not exactly as expected'; END IF;",
         f"  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}]) AND statements[1] LIKE {like};",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> before_n - {len(VERSIONS)} THEN RAISE EXCEPTION 'ledger count after reversal is not the pre-reversal count minus 4'; END IF;",
         "END $bpc$;"]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        os.remove(os.path.join(OUT, old))
    files = {"AUTH16.sql": script(), "AUTH16_reversal.sql": reversal()}
    for fn, txt in files.items():
        open(os.path.join(OUT, fn), "w", encoding="utf-8", newline=chr(10)).write(txt)
    cnt, end_sha = predicted(ledger_lines, VERSIONS)
    pkg = {
        "stage": "AUTH-16 (ledger markers: 2 qualified attestations, 2 deliberately-not-executed dispositions)",
        "channel": "supabase db query --linked -f <absolute path> (byte-exact, one transaction)",
        "start": {"count": START_COUNT, "sha256": START_SHA},
        "end_predicted": {"count": cnt, "sha256": end_sha},
        "evidence_sha256": EVIDENCE_SHA,
        "scripts": {fn: sha(txt.encode()) for fn, txt in sorted(files.items())},
        "versions": [{"version": x["v"], "name": x["name"], "state": x["state"], "file": x["file"], "file_sha256": x["file_sha256"],
                      "scope_sha256": x["scope_sha256"], "marker_sha256": sha(MARKERS[x["v"]]), "predecessors": x["pred"], "scope_text": x["scope"]} for x in VERSIONS],
        "source_of_decision": SOURCE, "attested_at": AT,
    }
    open(os.path.join(OUT, "package.json"), "w", encoding="utf-8", newline=chr(10)).write(json.dumps(pkg, indent=1) + chr(10))
    print("end", cnt, end_sha, "\n", json.dumps(pkg["scripts"], indent=1))
