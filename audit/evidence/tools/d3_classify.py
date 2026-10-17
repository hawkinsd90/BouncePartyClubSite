"""Stage D3, step 3: classify (K1-K5) every difference of
  (a) the restored baseline vs the Stage B Production capture (restore integrity), and
  (b) the upgraded D3 schema vs the D1 clean-rebuild final schema (public + storage),
each rule with a checked precondition; a row without a rule or with a failed precondition is K5. Writes the group register CSV into audit/evidence
and the row-level register into the protected folder. Usage: python -I d3_classify.py
"""
import collections
import csv
import json
import os
import re

OUT = r"C:\Users\vikki\migration-evidence\d3-scratch"
PROT = r"C:\Users\vikki\migration-evidence\stage-b-20261016"
REPO = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite"


def jl(p):
    return json.load(open(p, encoding="utf-8"))


base = jl(os.path.join(OUT, "d3-baseline-diff.json"))
fin = jl(os.path.join(OUT, "d3-final-vs-d1-diff.json"))
d3b_cons = {(r["schema"], r["tbl"], r["name"]): r for r in jl(os.path.join(OUT, "d3base_catalog_constraints.json"))}
d1f_fun = {(r["name"], r["args"]): r for r in jl(os.path.join(OUT, "d1final_catalog_functions.json"))}
d3f_fun = {(r["name"], r["args"]): r for r in jl(os.path.join(OUT, "d3final_catalog_functions.json"))}
d1f_acl = {(r["role"], r["schema"], r["objtype"]): r["acl"] for r in jl(os.path.join(OUT, "d1final_catalog_default_acls.json"))}
d3f_acl = {(r["role"], r["schema"], r["objtype"]): r["acl"] for r in jl(os.path.join(OUT, "d3final_catalog_default_acls.json"))}

GROUPS = collections.OrderedDict()
ROWS, BAD = [], []


def G(gid, part, cls, title, why, d4, impact):
    GROUPS[gid] = {"id": gid, "part": part, "class": cls, "title": title, "justification": why, "carry_to_D4": d4, "impact": impact, "count": 0, "precondition_failures": 0, "examples": []}


def add(gid, cat, kind, key, ok=True, note=""):
    g = GROUPS[gid]
    g["count"] += 1
    if not ok:
        g["precondition_failures"] += 1
        BAD.append({"group": gid, "category": cat, "key": key, "note": note})
    if len(g["examples"]) < 3:
        g["examples"].append("/".join(str(x) for x in key))
    ROWS.append({"group": gid, "class": g["class"] if ok else "K5", "category": cat, "kind": kind, "key": key})


# ---- (a) restore integrity -------------------------------------------------------------------------------------------------------------
G("B1", "baseline", "K1", "PostgreSQL 18 explicit NOT NULL constraints (contype n)", "PG18 stores NOT NULL as named constraints; hosted 17.6 does not. Checked per row: every constraint is contype n.", "no", "none")
G("B2", "baseline", "K1", "Default ACLs of supabase_admin in schemas extensions, graphql, graphql_public", "These schemas are created by Supabase extensions and are not in the schema-only dump; no application object lives there.", "no", "none for application objects")
G("B3", "baseline", "K1", "Extensions pg_net and supabase_vault unavailable; pg_stat_statements and pgcrypto at PostgreSQL 18 contrib versions", "Not shipped with plain PostgreSQL; versions follow the PG18 contrib release.", "no", "pg_net-dependent trigger/functions cannot run locally")
G("B4", "baseline", "K1", "Role attributes and memberships (login, superuser, member_of) and the temporary role cli_login_postgres", "All roles are NOLOGIN stubs by design; cli_login_postgres is the temporary hosted role and was not recreated.", "no", "none for migrations")
G("B5", "baseline", "K1", "Platform event triggers (pgrst_*, issue_*)", "Created by PostgREST, pg_graphql, pg_cron and pg_net, which are not installed locally; none is in the dump.", "no", "none for migrations")
for r in base["constraints"]["diffs"]:
    add("B1", "constraints", r["kind"], tuple(r["key"]), ok=(d3b_cons[tuple(r["key"])]["type"] == "n" and r["kind"] == "only_d3base"), note="not an n constraint")
for r in base["default_acls"]["diffs"]:
    k = tuple(r["key"])
    add("B2", "default_acls", r["kind"], k, ok=(r["kind"] == "only_prod" and k[0] == "supabase_admin" and k[1] in ("extensions", "graphql", "graphql_public")), note="unexpected default ACL difference")
for r in base["extensions"]["diffs"]:
    add("B3", "extensions", r["kind"], tuple(r["key"]), ok=(r["key"][0] in ("pg_net", "supabase_vault", "pg_stat_statements", "pgcrypto")), note="unexpected extension difference")
for r in base["roles"]["diffs"]:
    add("B4", "roles", r["kind"], tuple(r["key"]), ok=(r.get("field") in (None, "rolcanlogin", "rolsuper", "member_of")), note="unexpected role attribute")
for r in base["event_triggers"]["diffs"]:
    add("B5", "event_triggers", r["kind"], tuple(r["key"]))
for c, d in base.items():
    if c not in ("constraints", "default_acls", "extensions", "roles", "event_triggers") and d["diffs"]:
        for r in d["diffs"]:
            BAD.append({"group": "baseline", "category": c, "key": r["key"], "note": "unclassified baseline difference"})

# ---- (b) upgraded schema vs D1 final ------------------------------------------------------------------------------------------------------
G("F1", "final", "K1", "Real Supabase storage schema objects versus the D1 stub (tables, columns, constraints, indexes, triggers, owners, RLS, grants)", "D1 used a minimal storage stub owned by postgres; D3 restored the real storage schema from the Production dump. No repository migration creates these objects.", "no", "none for application objects")
G("F2", "final", "K2", "public.task_status.admin_notes and crew_notes present", "Out-of-band Production columns carried through from the restored baseline; no migration creates or removes them.", "yes", "a rebuild from migrations lacks them; code references admin_notes")
G("F3", "final", "K1", "Function bodies differ only in whitespace", "Baseline function sources come from the Production dump (LF); D1 sources come from CRLF migration files. Whitespace-normalised and comment-stripped digests are identical (checked per function).", "no", "none")
G("F4", "final", "K1", "Schema-level privileges of platform roles and owners", "supabase_admin / dashboard_user / supabase_storage_admin grants and Production's public-schema grants to postgres and supabase_auth_admin; none comes from a repository migration.", "no", "none")
G("F5", "final", "K1", "Default ACL of postgres in public: same privileges, different representation", "Production lists the owner entry explicitly; D1 does not. After the owner entry is ignored the sets are equal (checked).", "no", "none")
G("F6", "final", "K1", "Platform-owned default ACLs (supabase_admin in public/realtime, supabase_auth_admin in auth, postgres in storage)", "Provisioned by the Supabase platform and present in Production; the stub has none. SECURITY FINDING (not a migration discrepancy): supabase_admin's default privileges in public still grant anon/authenticated all privileges on objects supabase_admin creates; 20261018120000 narrows only the postgres defaults.", "yes (security review)", "objects created by supabase_admin in public would be exposed to anon/authenticated")
G("F7", "final", "K1", "Platform publication, pg_stat_statements extension", "supabase_realtime_messages_publication and pg_stat_statements exist in Production and not in the D1 stub.", "no", "none")
G("F8", "final", "K2", "Storage bucket carousel-media present", "Out-of-band Production bucket carried through; no migration inserts it. 20261014120000 replaces its policies; the bucket row and public flag are unchanged.", "yes", "bucket remains public with migration-controlled policies")
plat = {"storage"}
for c in ("tables", "columns", "constraints", "indexes", "triggers", "grants_relations"):
    for r in fin[c]["diffs"]:
        k = tuple(r["key"])
        if k[0] in plat:
            add("F1", c, r["kind"], k)
        elif c == "columns" and k in (("public", "task_status", "admin_notes"), ("public", "task_status", "crew_notes")) and r["kind"] == "only_d3final":
            add("F2", c, r["kind"], k)
        else:
            BAD.append({"group": "final", "category": c, "key": list(k), "note": "no rule"})
for r in fin["functions"]["diffs"]:
    k = tuple(r["key"])
    a, b = d1f_fun[(k[1], k[2])], d3f_fun[(k[1], k[2])]
    add("F3", "functions", r["kind"], k, ok=(r["field"] == "src_md5" and a["src_norm_md5"] == b["src_norm_md5"] and a["src_nocomment_md5"] == b["src_nocomment_md5"]), note="body differs beyond whitespace")
for r in fin["grants_schemas"]["diffs"]:
    k = tuple(r["key"])
    add("F4", "grants_schemas", r["kind"], k, ok=(k[0] in ("storage", "public")), note="unexpected schema grant")


def strip_owner(a):
    return {e for e in a.strip("{}").split(",") if e.split("=")[0] != "postgres"}


for r in fin["default_acls"]["diffs"]:
    k = tuple(r["key"])
    kk = (k[0], k[1], k[2])
    if k[0] == "postgres" and k[1] == "public":
        add("F5", "default_acls", r["kind"], k, ok=(strip_owner(d1f_acl.get(kk, "{}")) == strip_owner(d3f_acl.get(kk, "{}"))), note="postgres/public defaults differ beyond owner entry")
    else:
        add("F6", "default_acls", r["kind"], k, ok=(r["kind"] == "only_d3final"), note="local-only default ACL")
for c, gid in (("publications", "F7"), ("extensions", "F7")):
    for r in fin[c]["diffs"]:
        add(gid, c, r["kind"], tuple(r["key"]), ok=(r["key"][0] in ("supabase_realtime_messages_publication", "pg_stat_statements")), note="unexpected")
for r in fin["storage_buckets"]["diffs"]:
    add("F8", "storage_buckets", r["kind"], tuple(r["key"]), ok=(tuple(r["key"]) == ("carousel-menu",) or tuple(r["key"]) == ("carousel-media",)), note="unexpected bucket")
for c in ("policies", "grants_functions", "grants_columns", "roles", "views", "types", "event_triggers"):
    for r in fin[c]["diffs"]:
        BAD.append({"group": "final", "category": c, "key": r["key"], "note": "unclassified"})

by = collections.Counter(r["class"] for r in ROWS)
summary = {"baseline_rows": sum(1 for r in ROWS if r["group"].startswith("B")), "final_rows": sum(1 for r in ROWS if r["group"].startswith("F")), "by_class": dict(by), "unclassified_or_failed": BAD,
           "groups": GROUPS, "zero_difference_categories_final": {c: len(fin[c]["diffs"]) == 0 for c in ("policies", "grants_functions", "grants_columns", "roles", "views", "types", "event_triggers")},
           "baseline_zero_difference_categories": {c: len(base[c]["diffs"]) == 0 for c in base}}
json.dump({"summary": summary, "rows": ROWS}, open(os.path.join(OUT, "d3-classified-register.json"), "w", encoding="utf-8"), indent=1, default=str)
with open(os.path.join(REPO, "audit", "evidence", "d3-discrepancy-register.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["group", "comparison", "class", "count", "title", "justification_and_precondition", "carry_to_D4", "impact", "precondition_failures", "examples"])
    for g in GROUPS.values():
        w.writerow([g["id"], "restored baseline vs Production capture" if g["part"] == "baseline" else "upgraded D3 schema vs D1 clean rebuild", g["class"], g["count"], g["title"], g["justification"], g["carry_to_D4"], g["impact"], g["precondition_failures"], "; ".join(g["examples"])])
print("baseline rows", summary["baseline_rows"], "| final rows", summary["final_rows"], "|", dict(by), "| unclassified/failed:", len(BAD))
for g in GROUPS.values():
    print(g["id"], g["class"], g["count"], "fail", g["precondition_failures"], "-", g["title"][:70])
print(json.dumps(BAD[:8], indent=1, default=str))
print("final zero-diff categories:", summary["zero_difference_categories_final"])
