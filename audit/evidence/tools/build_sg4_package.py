"""Builds the SG-4 (S8, runbook T3) history-only bookkeeping package: 17 withheld versions (batch S8W) then 24 deferred history-only versions (batch S8H).
Offline. Reads the committed manifests, the derived statement-level evidence, a live read-only atom evaluation (audit/step4/sg4-work/atoms-live.json) and a
read-only snapshot of the Development ledger (audit/step4/sg4-work/ledger333.lines). Writes audit/step4/sg4-package/. It never connects to a database.
Usage: python -I build_sg4_package.py"""
import csv
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rule_atoms as ra  # noqa: E402

EV = os.path.abspath(os.path.join(HERE, ".."))
AUDIT = os.path.abspath(os.path.join(EV, ".."))
REPO = os.path.abspath(os.path.join(AUDIT, ".."))
S4 = os.path.join(AUDIT, "step4")
WORK = os.path.join(S4, "sg4-work")
OUT = os.path.join(S4, "sg4-package")
PREFIX = "-- BPC-DEV-RECONCILIATION"
lit = ra.lit
sha = lambda b: hashlib.sha256(b if isinstance(b, bytes) else b.encode("utf-8")).hexdigest()
md5 = lambda s: hashlib.md5(s.encode("utf-8")).hexdigest()

W = "20251008190000 20251129190013 20251129190039 20251202171808 20251207163822 20251207184549 20251207185927 20251229223230 20251230184228 20251231161729 20260323201502 20260324012349 20260324051459 20260324142355 20260324150838 20260324154955 20260324180043".split()
rows_s2 = list(csv.DictReader(open(os.path.join(S4, "s2-reconciliation-manifest.csv"), encoding="utf-8")))
H = [r["version"] for r in rows_s2 if "deferred history-only (S8)" in r["group"]]
ATT = [r["version"] for r in rows_s2 if "deferred attestation (S8)" in r["group"]]
assert len(W) == 17 and len(H) == 24 and len(ATT) == 2, (len(W), len(H), len(ATT))
# live-evidence exclusions: the effect the migration describes is NOT present on Development today, so a "history-only, effect present" record would be untrue
EXCLUDED = {
    "20260324051459": "supabase_realtime publishes only public.orders today (payments, task_status, order_signatures, order_lot_pictures are not published); the portal refresh uses broadcast signals. Owner decision needed: record as not executed (superseded by the broadcast design) or execute.",
    "20260324154955": "order_pictures is not in the supabase_realtime publication today. Same owner decision as 20260324051459.",
}
W = [v for v in W if v not in EXCLUDED]
man = {r["version"]: r for r in csv.DictReader(open(os.path.join(AUDIT, "development-migration-manifest.csv"), encoding="utf-8"))}
ledger_lines = open(os.path.join(WORK, "ledger333.lines"), encoding="utf-8", newline="").read().split("\n")
assert len(ledger_lines) == 333 and sha("\n".join(ledger_lines)) == "04b1f1bb3b5b0c1a19b0724df544db4e501945010364ff956f77e69dec53eb63"
led = {l.split("|")[0] for l in ledger_lines}
atoms_live = json.load(open(os.path.join(WORK, "atoms-live.json")))
e2a = [r for r in csv.DictReader(open(os.path.join(EV, "derived", "e2a-statements-all.csv"), encoding="utf-8")) if r["environment"] == "Development"]

ELIGIBLE = {"table", "col", "index", "rls", "trigger", "function", "constraint", "bucket"}
# objects whose Stage B 'PRESENT' status was legitimately changed by a LATER, already-recorded migration (never checked as continuity)
SUPERSEDED_LATER = {
    ("20251229223230", "col", "customer_profiles.display_name"): "renamed to first_name/last_name by that very migration; absent by design",
    ("20260323201502", "trigger", "orders.trg_auto_sync_google_calendar"): "dropped by recorded migration 20260323204632 (disabled until credentials are ready)",
}


def atom_for(v, kind, obj):
    if kind == "trigger" and obj.startswith("auth.users."):
        n = obj.split(".", 2)[2]
        return f"EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname={lit(n)} AND NOT tgisinternal)"
    return ra.atom(kind, obj)


PUB5 = "('orders','payments','task_status','order_signatures','order_lot_pictures')"
USAGE = "has_schema_privilege('anon','public','USAGE') AND has_schema_privilege('authenticated','public','USAGE')"
EVIDENCE = {
    "20251129190039": [("policy 'Anyone can upload public assets' no longer exists on storage.objects; October 20261014120000 (recorded) resets every storage policy on public-assets",
                        "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Anyone can upload public assets')", ["20261014120000"])],
    "20260324142355": [("signatures bucket is private today; October 20261014120000 (recorded) sets it private", "EXISTS (SELECT 1 FROM storage.buckets WHERE id='signatures' AND public = false)", ["20261014120000"])],
    "20260324150838": [("order-pictures bucket is private today; October 20261015120000 (recorded) sets it private", "EXISTS (SELECT 1 FROM storage.buckets WHERE id='order-pictures' AND public = false)", ["20261015120000"])],
    "20251207185927": [("policy 'Master and admin can manage all roles' does not exist on user_roles", "NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Master and admin can manage all roles')", []),
                       ("anon and authenticated hold USAGE on schema public (true only after the S11 end state)", USAGE, [])],
    "20251207163822": [("anon and authenticated hold USAGE on schema public (true only after the S11 end state)", USAGE, [])],
}
DEFER_ROOTS = {"20251207185927", "20251207163822"}  # their GRANT USAGE effect exists only after S11: recorded in batch S8B

live_ok = {(a["v"], a["k"], a["o"]): a["ok"] for a in atoms_live}
rules = {}
report = {}
for v in W + H:
    atoms, noted, skipped = [], [], {"policy": 0, "grant": 0}
    for r in e2a:
        if r["version"] != v:
            continue
        k, o, st = r["kind"], r["object"], r["status"]
        if st != "PRESENT":
            continue
        if k in ("policy", "grant"):
            skipped[k] += 1
            continue
        if k not in ELIGIBLE:
            continue
        if (v, k, o) in SUPERSEDED_LATER:
            noted.append(f"{k} {o}: {SUPERSEDED_LATER[(v, k, o)]}")
            continue
        a = atom_for(v, k, o)
        if not a:
            continue
        ok = True if o.startswith("auth.users.") else live_ok.get((v, k, o))
        assert ok in (True,), f"live atom not true for {v} {k} {o}: {ok}"
        atoms.append(a)
    n_live = len(atoms)
    for desc, sqlx, needs in EVIDENCE.get(v, []):
        atoms.append(sqlx + (f" AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{','.join(lit(x) for x in needs)}])) = {len(needs)}" if needs else ""))
        noted.append("specific evidence rule: " + desc)
    sup = {b.strip() for r in e2a if r["version"] == v for b in (r["by"] or "").split(";") if b.strip() and b.strip() != v}
    recorded_sup = sorted(x for x in sup if x in led)
    if recorded_sup:
        atoms.append(f"(SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{','.join(lit(x) for x in recorded_sup)}])) = {len(recorded_sup)}")
        noted.append("superseding versions already recorded: " + ",".join(recorded_sup))
    if n_live == 0 and v not in EVIDENCE:
        tabs = sorted({r["object"].split(".", 1)[0] for r in e2a if r["version"] == v and r["kind"] == "policy" and not r["object"].startswith("storage.") and r["status"] in ("PRESENT", "SUPERSEDED")})
        for tb in tabs:
            atoms.append(f"to_regclass('public.{tb}') IS NOT NULL AND " + ra.atom("rls", tb))
        if tabs:
            noted.append("tables whose policies this version set still exist with RLS on: " + ",".join(tabs))
    expr = "(" + " AND ".join(f"({a})" for a in atoms) + ")" if atoms else "(true)"
    rules[v] = expr
    stat = {}
    for r in e2a:
        if r["version"] == v:
            stat[r["status"]] = stat.get(r["status"], 0) + 1
    report[v] = {"atoms_checked": len(atoms), "policies_skipped_reset_by_october": skipped["policy"], "grants_skipped_revoked_by_october": skipped["grant"], "stage_b_status_counts": stat, "exceptions": noted}

# --- order: predecessors must be in the ledger or earlier in the plan
pred = {v: [p for p in man[v]["required_predecessor_versions"].split(";") if p] for v in W + H}


def topo(vs, base):
    out, left = [], list(sorted(vs))
    done = set(base)
    while left:
        ready = [v for v in left if all(p in done or p not in vs for p in pred[v])]
        assert ready, ("cycle or unresolved", left)
        out.append(ready[0])
        done.add(ready[0])
        left.remove(ready[0])
    return out


order = topo(W + H, led)
for v in order:
    for p in pred[v]:
        assert p in led or order.index(p) < order.index(v), (v, p)
assert not any(p in ATT for v in W + H for p in pred[v]), "a recorded version depends on an attestation version"


def name_of(v):
    fn = man[v]["filename_or_archived_source"]
    return re.sub(r"\.sql(\.sql)?$", "", fn[15:])


def marker(v, batch):
    base = f"{PREFIX} history-only NOT EXECUTED; batch={batch}; version={v}; rule_sha256={sha(rules[v])}"
    b = ("continuity check of the objects of this migration that exist today, evaluated read-only immediately before recording; policies and grants it set were replaced or "
         "revoked by the October block and are not checked; schema-equivalence evidence, not proof that the historical SQL ran")
    return base + f"; basis={b}"


def block(v, n, batch):
    L = [f"  -- op {n}: {v} (history-only)",
         f"  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = {lit(v)}) THEN RAISE EXCEPTION 'version already recorded: {v}'; END IF;"]
    if pred[v]:
        arr = ",".join(lit(p) for p in pred[v])
        L.append(f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}])) <> {len(pred[v])} THEN RAISE EXCEPTION 'predecessor not recorded for {v}'; END IF;")
    L.append(f"  IF NOT COALESCE(({rules[v]}), false) THEN RAISE EXCEPTION 'verification rule failed for {v}'; END IF;")
    L.append(f"  INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ({lit(v)}, {lit(name_of(v))}, ARRAY[{lit(marker(v, batch))}]);")
    return L


LEDGER_SHA_EXPR = "(SELECT encode(sha256(convert_to(string_agg(version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\\n'),'')), E'\\n' ORDER BY version),'UTF8')),'hex') FROM supabase_migrations.schema_migrations)"


def predicted(rows_added, batch_of):
    ls = list(ledger_lines)
    for v in rows_added:
        ls.append(f"{v}|{name_of(v)}|{md5(marker(v, batch_of[v]))}")
    ls.sort(key=lambda s: s.split("|")[0])
    return len(ls), sha("\n".join(ls))


DEFER = {v for v in order if v in DEFER_ROOTS or any(q in DEFER_ROOTS for q in pred[v])}
changed = True
while changed:
    changed = False
    for v in order:
        if v not in DEFER and any(q in DEFER for q in pred[v]):
            DEFER.add(v)
            changed = True
orderA = [v for v in order if v not in DEFER]
orderB = [v for v in order if v in DEFER]
for v in orderA:
    assert not any(q in DEFER for q in pred[v])
batch_of = {**{v: "S8A" for v in orderA}, **{v: "S8B" for v in orderB}}
cntMid, shaMid = predicted(orderA, batch_of)
cntA, shaA = predicted(orderA + orderB, batch_of)
start = {"S8A": (333, "04b1f1bb3b5b0c1a19b0724df544db4e501945010364ff956f77e69dec53eb63"), "S8B": (cntMid, shaMid)}


def batch_script(batch, order):
    n0, sha0 = start[batch]
    L = [f"{PREFIX} script for batch {batch}: {len(order)} history-only operation(s); SG-4 (runbook S8/T3); bound by the owner authorization statement that quotes this file's SHA-256",
         "SET LOCAL lock_timeout = '3s';", "SET LOCAL statement_timeout = '60s';", "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));",
         "DO $bpc$", "BEGIN",
         "  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN RAISE EXCEPTION 'wrong database or role'; END IF;",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {n0} THEN RAISE EXCEPTION 'ledger count differs from the pre-batch export'; END IF;",
         f"  IF {LEDGER_SHA_EXPR} <> {lit(sha0)} THEN RAISE EXCEPTION 'ledger content differs from the pre-batch export'; END IF;",
         ("  IF has_schema_privilege('anon', 'public', 'USAGE') OR has_schema_privilege('authenticated', 'public', 'USAGE') THEN RAISE EXCEPTION 'schema containment is not in force'; END IF;" if batch == "S8A"
          else "  IF NOT (has_schema_privilege('anon', 'public', 'USAGE') AND has_schema_privilege('authenticated', 'public', 'USAGE')) THEN RAISE EXCEPTION 'S11 end state is not in force (USAGE on public expected)'; END IF;")]
    for i, v in enumerate(order, 1):
        L += block(v, i, batch)
    L += [f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> {n0} + {len(order)} THEN RAISE EXCEPTION 'unexpected ledger count after the batch'; END IF;", "END $bpc$;"]
    return "\n".join(L) + "\n"


def reversal(batch, order):
    n0 = start[batch][0]
    arr = ",".join(lit(v) for v in order)
    L = [f"{PREFIX} REVERSAL for batch {batch} (owner-approved use only)", "SET LOCAL lock_timeout = '3s';", "SELECT pg_advisory_xact_lock(hashtext('bpc-dev-reconciliation'));", "DO $bpc$", "DECLARE before_n bigint;", "BEGIN",
         "  SELECT count(*) INTO before_n FROM supabase_migrations.schema_migrations;",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}]) AND statements[1] LIKE {lit(PREFIX + '%batch=' + batch + ';%')}) <> {len(order)} THEN RAISE EXCEPTION 'batch rows not exactly as expected'; END IF;",
         f"  DELETE FROM supabase_migrations.schema_migrations WHERE version = ANY(ARRAY[{arr}]) AND statements[1] LIKE {lit(PREFIX + '%batch=' + batch + ';%')};",
         f"  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> before_n - {len(order)} THEN RAISE EXCEPTION 'ledger count after reversal is not the pre-reversal count minus the batch'; END IF;",
         "END $bpc$;"]
    return "\n".join(L) + "\n"


os.makedirs(OUT, exist_ok=True)
for old in os.listdir(OUT):
    os.remove(os.path.join(OUT, old))
files = {}
for b, od in (("S8A", orderA), ("S8B", orderB)):
    files[b + ".sql"] = batch_script(b, od)
    files[b + "_reversal.sql"] = reversal(b, od)
for fn, txt in files.items():
    open(os.path.join(OUT, fn), "w", encoding="utf-8", newline=chr(10)).write(txt)
pkg = {
    "stage": "SG-4 (runbook S8 / recovery plan T3)",
    "channel": "supabase db query --linked -f <absolute path> (byte-exact, one transaction per file, verified for SG-3 steps 26-28)",
    "start": {"count": 333, "sha256": start["S8A"][1]},
    "after_S8A": {"count": cntMid, "sha256": shaMid},
    "end": {"count": cntA, "sha256": shaA},
    "order_S8A": orderA, "order_S8B": orderB,
    "S8B_runs_after": "S11 (USAGE on schema public held by anon and authenticated)",
    "excluded_attestations_need_owner_decision": ATT,
    "excluded_by_live_evidence": EXCLUDED,
    "scripts": {fn: sha(txt.encode()) for fn, txt in sorted(files.items())},
    "per_version": {v: {**report[v], "batch": batch_of[v], "name": name_of(v), "rule_sha256": sha(rules[v]), "predecessors": pred[v], "group": "withheld" if v in W else "deferred"} for v in orderA + orderB},
}
open(os.path.join(OUT, "package.json"), "w", encoding="utf-8", newline=chr(10)).write(json.dumps(pkg, indent=1) + chr(10))
print("S8A", len(orderA), "S8B", len(orderB), "mid", cntMid, shaMid[:8], "end", cntA, shaA[:8])
