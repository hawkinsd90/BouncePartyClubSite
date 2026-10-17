"""Stage D2 (R-2a), part 3: classify every discrepancy of d2_compare.py (K1-K5), verify each rule's precondition against the data, and
produce the group-level register (audit/evidence/d2-discrepancy-register.csv) plus the row-level register (protected folder).
A row that matches no rule, or whose rule precondition fails, is K5 (unexplained) and makes the stage INCOMPLETE. Nothing is relabelled to pass.
Usage: python -I d2_classify.py
"""
import collections
import csv
import json
import os
import re
import subprocess
import sys

PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
OUT = r"C:\Users\vikki\migration-evidence\d2-scratch"
REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
DB = "bpc_replay_d2_preupgrade"

raw = json.load(open(os.path.join(OUT, "d2-raw-diff.json"), encoding="utf-8"))


def jl(env, c):
    return json.load(open(os.path.join(PROT if env == "prod" else OUT, f"{'prod' if env == 'prod' else 'local'}_catalog_{c}.json"), encoding="utf-8"))


def lq(sql):
    r = subprocess.run([PSQL, "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-X", "-q", "-w", "-At", "-d", DB, "-c", sql], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


# ---- precondition data -------------------------------------------------------------------------------------------------------------
pcol = {(r["schema"], r["tbl"], r["name"]): r for r in jl("prod", "columns")}
lcol = {(r["schema"], r["tbl"], r["name"]): r for r in jl("local", "columns")}
lcon = {(r["schema"], r["tbl"], r["name"]): r for r in jl("local", "constraints")}
pfun = {(r["name"], r["args"]): r for r in jl("prod", "functions")}
lfun = {(r["name"], r["args"]): r for r in jl("local", "functions")}
GROUPS = collections.OrderedDict()
ROWS = []
UNCLASSIFIED = []


def G(gid, cls, title, justification, evidence, d3, impact, blocks):
    GROUPS[gid] = {"id": gid, "class": cls, "title": title, "justification": justification, "evidence": evidence, "reproduce_in_d3": d3, "impact": impact, "blocks_d3": blocks, "count": 0, "precondition_failures": 0, "examples": []}


G("G01", "K1", "Supabase-owned auth/storage platform objects absent from the local stub (tables, columns, constraints, indexes, triggers, sequences)",
  "The local stub defines only the minimal auth/storage objects the migrations reference; Production has the real GoTrue and Storage schemas. No repository migration creates or alters these objects.",
  "Rows only in Production in schemas auth/storage (stage_b catalogs: tables, columns, constraints, indexes, triggers); none in public.", "No (restored Production snapshot already contains them)", "None for the application schema; platform objects are Supabase-managed", "No")
G("G02", "K1", "Stub auth/storage objects defined differently from the real ones (owner, RLS flag, column types/defaults/nullability, extra stub constraints and indexes)",
  "auth.users, auth.identities, storage.buckets and storage.objects are simplified stubs owned by postgres; real ones are owned by supabase_auth_admin / supabase_storage_admin with RLS and richer column definitions.",
  "tables/columns/constraints/indexes rows in schemas auth/storage present on both sides but different, or only local (stub-defined).", "No", "None for migrations that only reference these tables; runtime behaviour is unverifiable locally", "No")
G("G03", "K1", "PostgreSQL 18 explicit NOT NULL constraints (pg_constraint contype 'n') in public",
  "PostgreSQL 18 records NOT NULL as named constraints; hosted PostgreSQL 17.6 does not. Each such constraint corresponds to a column that is NOT NULL on BOTH sides (verified per row).",
  "253 public contype 'n' rows only local; precondition: Production column not_null = true and local column not_null = true.", "No", "None (same nullability)", "No")
G("G04", "K2", "public.user_roles -> auth.users foreign key exists locally but not in Production",
  "Historical migrations create user_roles_user_id_fkey; Production does not have it (out-of-band removal; Stage B drift register). It is the original FK that pending 20261016120000 restores after deleting orphaned role rows.",
  "constraints: public.user_roles.user_roles_user_id_fkey only local; Production has 0 foreign keys from user_roles.", "Yes: D3 must start from the Production shape (no FK, orphaned role rows present)", "Orphan role rows exist in Production until 20261016120000 removes them", "No")
G("G05", "K2", "public.task_status.admin_notes and crew_notes exist in Production but are created by no repository migration",
  "Out-of-band Production columns (Stage B drift register D1, parser-verified); the S3 replay shim was deliberately not implemented so the gap stays visible.",
  "columns: public.task_status.admin_notes / crew_notes only in Production.", "Yes (present in the restored snapshot; code in src/lib/database.types.ts uses admin_notes)", "A rebuild from migrations alone lacks these columns", "No")
G("G06", "K1", "Policy expression deparse differs only by a ::text cast around auth.users.email",
  "Production's auth.users.email is character varying, so PostgreSQL renders a ::text cast; the stub column is text so no cast is rendered. Logic is identical.",
  "3 policies (public.orders, public.payments, storage.objects); precondition: Production auth.users.email type is varchar and the local one is text.", "No", "None", "No")
G("G07", "K1", "Function bodies differ only in whitespace (line endings)",
  "Working-tree migration files contain CRLF line endings, so locally stored function sources contain carriage returns; Production bodies use LF. Every one of the 64 pairs has an identical whitespace-normalized and comment-stripped digest, and all 68 function signatures, owners, SECURITY DEFINER flags, volatility and search_path settings are equal.",
  "functions: src_md5 differs in 64 of 68; src_norm_md5 and src_nocomment_md5 equal in all 64.", "No", "None", "No")
G("G08", "K1", "Table/sequence grants in auth and storage that depend on platform roles and owners",
  "Production grants differ from the stub only through supabase_auth_admin, supabase_storage_admin, dashboard_user and owner differences (postgres vs platform roles). No public-schema grant differs.",
  "grants_relations: all differing rows are in schemas auth/storage; public has 0 differing grants (Production and local public relation grants are identical).", "No", "None", "No")
G("G09", "K1", "Schema-level privileges on auth, storage and public that depend on platform roles",
  "Schema ownership and grants for supabase_admin, dashboard_user, supabase_auth_admin and supabase_storage_admin, plus Production's public schema grants to postgres and supabase_auth_admin; none comes from a repository migration.",
  "grants_schemas differences (22 only Production, 10 only local).", "No", "None for application schema; platform grants unverifiable", "No")
G("G10", "K1", "Default privileges: platform-owned defaults and the postgres defaults' representation",
  "Production holds default ACLs for supabase_admin (public, extensions, graphql, graphql_public, realtime), supabase_auth_admin (auth) and postgres (storage); the stub defines none of them. For postgres in public, the local and Production ACLs grant the same privileges to anon, authenticated and service_role; Production additionally lists the owner's own entry explicitly (equal privileges), verified below.",
  "default_acls: 24 only Production, 3 only local; precondition: for (postgres, public, r/S/f) the grantee/privilege sets are equal once the owner entry is ignored.", "Reproduced by the restored snapshot", "Defaults decide grants of future objects created by the named owner; none of the selected migrations runs as supabase_admin", "No")
G("G11", "K1", "Realtime platform publication, extensions, event triggers and roles that only the hosted platform provides",
  "supabase_realtime_messages_publication, pg_net, pg_stat_statements, supabase_vault, six platform event triggers and ten platform roles do not exist in plain PostgreSQL; pgcrypto is 1.3 in Production (PG17) and 1.4 locally (PG18); stub roles lack the real role attributes. supabase_realtime itself has identical membership on both sides.",
  "publications/extensions/event_triggers/roles diffs. Note: roles include cli_login_postgres, the temporary role recorded earlier (not modified).", "No", "pg_net-dependent migration 20260323201502 stays unverifiable locally", "No")
G("G12", "K2", "Storage bucket carousel-media exists in Production but is inserted by no repository migration",
  "Out-of-band Production bucket (Stage B drift register D1); 20260325231044 only UPDATEs it, which does nothing locally. S4 was deliberately not implemented.",
  "storage_buckets: carousel-media only in Production; the other 7 buckets are identical.", "Yes (present in the restored snapshot)", "A rebuild from migrations alone lacks the bucket although its policies exist", "No")


def add(group, cat, kind, key, field=None, prod=None, local=None, ok=True, note=""):
    g = GROUPS[group]
    g["count"] += 1
    if not ok:
        g["precondition_failures"] += 1
        UNCLASSIFIED.append({"category": cat, "kind": kind, "key": key, "reason": f"precondition failed for {group}: {note}"})
    if len(g["examples"]) < 4:
        g["examples"].append("/".join(str(x) for x in key))
    ROWS.append({"group": group, "class": g["class"] if ok else "K5", "category": cat, "kind": kind, "key": key, "field": field, "production": prod, "local": local, "precondition_ok": ok})


plat = {"auth", "storage"}
for cat in ("tables", "columns", "constraints", "indexes", "triggers"):
    for r in raw[cat]["diffs"]:
        k = tuple(r["key"])
        s = k[0]
        if s in plat:
            add("G01" if r["kind"] == "only_production" else "G02", cat, r["kind"], k, r.get("field"), r.get("production"), r.get("local"))
        elif cat == "constraints" and r["kind"] == "only_local" and lcon[k]["type"] == "n":
            m = re.match(r"NOT NULL (\S+)", lcon[k]["def"])
            col = m.group(1).strip('"') if m else None
            pc, lc_ = pcol.get((k[0], k[1], col)), lcol.get((k[0], k[1], col))
            add("G03", cat, r["kind"], k, ok=bool(pc and lc_ and pc["not_null"] and lc_["not_null"]), note="column not NOT NULL on both sides")
        elif cat == "constraints" and k == ("public", "user_roles", "user_roles_user_id_fkey") and r["kind"] == "only_local":
            fks = [c for c in jl("prod", "constraints") if c["schema"] == "public" and c["tbl"] == "user_roles" and c["type"] == "f"]
            add("G04", cat, r["kind"], k, ok=(len(fks) == 0), note="Production has an FK from user_roles")
        elif cat == "columns" and k in (("public", "task_status", "admin_notes"), ("public", "task_status", "crew_notes")) and r["kind"] == "only_production":
            add("G05", cat, r["kind"], k)
        else:
            UNCLASSIFIED.append({"category": cat, "kind": r["kind"], "key": list(k), "reason": "no rule"})

pusers_email = pcol[("auth", "users", "email")]["type"]
lusers_email = lcol[("auth", "users", "email")]["type"]
ppol = {(r["schema"], r["tbl"], r["name"]): r for r in jl("prod", "policies")}
lpol = {(r["schema"], r["tbl"], r["name"]): r for r in jl("local", "policies")}


def squash(t):
    return re.sub(r"::text", "", re.sub(r"\s+", "", t or "")).replace("(", "").replace(")", "")


for r in raw["policies"]["diffs"]:
    k = tuple(r["key"])
    p, l = ppol[k][r["field"]], lpol[k][r["field"]]  # full text from the catalogs, not the truncated raw diff
    add("G06", "policies", r["kind"], k, r["field"], "(full text compared)", "(full text compared)", ok=(r["field"] == "qual" and squash(p) == squash(l) and "varying" in pusers_email and lusers_email == "text"), note="expressions differ beyond casts/parentheses")

for r in raw["functions"]["diffs"]:
    k = tuple(r["key"])
    pf, lf = pfun[(k[1], k[2])], lfun[(k[1], k[2])]
    add("G07", "functions", r["kind"], k, r["field"], pf["src_md5"], lf["src_md5"], ok=(r["field"] == "src_md5" and pf["src_norm_md5"] == lf["src_norm_md5"] and pf["src_nocomment_md5"] == lf["src_nocomment_md5"]), note="bodies differ beyond whitespace/comments")

for cat, gid in (("grants_relations", "G08"), ("grants_schemas", "G09")):
    for r in raw[cat]["diffs"]:
        k = tuple(r["key"])
        ok = k[0] in plat or (cat == "grants_schemas" and k[0] in ("public", "auth", "storage"))
        add(gid, cat, r["kind"], k, ok=ok, note="differing grant outside auth/storage")

# default ACL precondition: postgres/public sets equal ignoring the owner entry
def acl_set(a):
    s = set()
    for e in a.strip("{}").split(","):
        who = e.split("=")[0]
        if who != "postgres":
            s.add(e)
    return s


dp = {(r["role"], r["schema"], r["objtype"]): acl_set(r["acl"]) for r in jl("prod", "default_acls")}
dl = {(r["role"], r["schema"], r["objtype"]): acl_set(r["acl"]) for r in jl("local", "default_acls")}
for r in raw["default_acls"]["diffs"]:
    k = tuple(r["key"])
    kk = (k[0], k[1], k[2])
    if k[0] == "postgres" and k[1] == "public":
        add("G10", "default_acls", r["kind"], k, ok=(dp.get(kk) == dl.get(kk)), note="postgres/public default privileges differ beyond the owner entry")
    else:
        add("G10", "default_acls", r["kind"], k, ok=(r["kind"] == "only_production"), note="local-only default ACL")

for cat in ("publications", "extensions", "event_triggers", "roles"):
    for r in raw[cat]["diffs"]:
        add("G11", cat, r["kind"], tuple(r["key"]), r.get("field"), r.get("production"), r.get("local"))
for r in raw["storage_buckets"]["diffs"]:
    add("G12", "storage_buckets", r["kind"], tuple(r["key"]), ok=(tuple(r["key"]) == ("carousel-media",)), note="unexpected bucket difference")

# ---- the supabase_realtime row must be identical (no hidden membership difference) -----------------------------------------------
pr = {r["name"]: r for r in jl("prod", "publications")}
lr = {r["name"]: r for r in jl("local", "publications")}
realtime_same = pr["supabase_realtime"] == lr["supabase_realtime"]

# ---- independent pre-upgrade (not post-October) checks ---------------------------------------------------------------------------
checks = []


def chk(name, ok, detail=""):
    checks.append({"check": name, "pass": bool(ok), "detail": detail})


chk("no October-created column invoice_links.revoked_at", lq("select count(*) from information_schema.columns where table_name='invoice_links' and column_name='revoked_at'") == "0")
chk("no October-created table booking_setup_proofs", lq("select count(*) from pg_class where relname='booking_setup_proofs'") == "0")
chk("no payment-operation functions (claim_payment_operation)", lq("select count(*) from pg_proc where proname='claim_payment_operation'") == "0")
chk("no order_refund_overview / reserve_refund_allocation", lq("select count(*) from pg_proc where proname in ('order_refund_overview','reserve_refund_allocation')") == "0")
chk("no order-evidence bucket", lq("select count(*) from storage.buckets where id='order-evidence'") == "0")
chk("no trg_guard_order_pricing_authority / trg_guard_payment_authoritative_order_changes", lq("select count(*) from pg_trigger where tgname in ('trg_guard_order_pricing_authority','trg_guard_payment_authoritative_order_changes')") == "0")
chk("pre-lockdown anonymous policy still present on order_changelog", lq("select count(*) from pg_policies where tablename='order_changelog' and 'anon'=any(roles)") != "0")
chk("no Case 43 policy", lq("select count(*) from pg_policies where policyname ilike '%Anon customers can insert cancellation%'") == "0")
chk("legacy role CHECK absent (S1) and user_roles CHECK count 0", lq("select count(*) from pg_constraint where conrelid='public.user_roles'::regclass and contype='c'") == "0")
_man = json.load(open(os.path.join(OUT, "d2-selected-manifest.json"), encoding="utf-8"))
_sel = [r["version"] for r in _man["selected"]]
chk("selected set is ascending, unique, ends at Production's highest recorded version and contains no October version", _sel == sorted(set(_sel)) and _sel[-1] == max(x["version"] for x in jl("prod", "history")) and _sel[-1] < "20261007000000", _sel[-1])
chk("supabase_realtime membership identical to Production", realtime_same, json.dumps(lr["supabase_realtime"]["tables"]))

# zero-difference categories (explicit)
zero = {c: raw[c]["diffs"] == [] for c in ("grants_functions", "grants_columns", "views", "types")}
pub_diffs = {c: sum(1 for r in raw[c]["diffs"] if r["key"][0] == "public") for c in ("tables", "columns", "constraints", "indexes", "triggers", "policies")}

# ---- totals by category ----------------------------------------------------------------------------------------------------------------
by_cat = collections.OrderedDict()
cls_by_row = collections.Counter()
for r in ROWS:
    by_cat.setdefault(r["category"], collections.Counter())[r["class"]] += 1
    cls_by_row[r["class"]] += 1
totals = {c: {"production_rows_in_scope": raw[c]["production_rows"], "local_rows_in_scope": raw[c]["local_rows"], "discrepancies": len(raw[c]["diffs"]), "by_class": dict(by_cat.get(c, {}))} for c in raw}
summary = {"total_discrepancies": len(ROWS), "by_class": dict(cls_by_row), "unclassified_or_failed_preconditions": UNCLASSIFIED, "groups": GROUPS, "public_schema_differences_by_category": pub_diffs,
           "zero_difference_categories": zero, "pre_upgrade_checks": checks, "totals_by_category": totals}
json.dump({"summary": summary, "rows": ROWS}, open(os.path.join(OUT, "d2-classified-register.json"), "w", encoding="utf-8"), indent=1, default=str)
with open(os.path.join(REPO, "audit", "evidence", "d2-discrepancy-register.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["group", "class", "count", "title", "justification", "evidence_and_precondition", "reproduce_in_D3", "security_or_compatibility_impact", "blocks_D3", "precondition_failures", "examples"])
    for g in GROUPS.values():
        w.writerow([g["id"], g["class"], g["count"], g["title"], g["justification"], g["evidence"], g["reproduce_in_d3"], g["impact"], g["blocks_d3"], g["precondition_failures"], "; ".join(g["examples"])])
print("total discrepancies:", len(ROWS), dict(cls_by_row), "| unclassified/failed preconditions:", len(UNCLASSIFIED))
for g in GROUPS.values():
    print(g["id"], g["class"], g["count"], "precond_fail", g["precondition_failures"], "-", g["title"][:80])
print("public-schema differences by category:", pub_diffs)
print("pre-upgrade checks failing:", [c["check"] for c in checks if not c["pass"]])
if UNCLASSIFIED:
    print(json.dumps(UNCLASSIFIED[:10], indent=1, default=str))
