"""Stage B out-of-band drift register (static + catalog).

Reads: supabase/migrations/*.sql, protected catalog snapshots. Writes: audit/evidence/drift-register.csv + drift-register.md.
Categories (per environment):
  D1  object exists in the database but NO repo file ever creates it            (out-of-band creation or parser limit)
  D2  object a version applied there should have created is missing, unsuperseded (out-of-band removal/change)
  D3  Dev-versus-Prod object difference, classified by whether a Dev-line file explains it
Names and versions only; no bodies, no values.
"""
import collections
import csv
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import stage_b_classify as C  # noqa: E402

AUTO = re.compile(r"(_pkey|_fkey|_key|_check|_excl|_not_null|_seq)$")


def created_sets(parsed):
    S = collections.defaultdict(set)
    for v, (ev, _cnt) in parsed.items():
        for k, key, _c, _x in ev:
            S[k].add(key)
    return S


def main():
    files = sorted(f for f in os.listdir(C.MIG) if re.match(r"^\d{14}_.*\.sql", f))
    parsed, names = {}, {}
    for f in files:
        ev, cnt, _raw = C.parse_file(os.path.join(C.MIG, f), f[:14])
        parsed[f[:14]] = (ev, cnt)
        names[f[:14]] = f
    S = created_sets(parsed)
    tables_created = {k[0] for k in S["table_create"]}
    cols_created = {k for k in S["column_add"]}
    pol_created = {k for k in S["policy_create"]}
    trg_created = {k for k in S["trigger_create"]}
    idx_created = {k[0] for k in S["index_create"]}
    fn_created = {k[0] for k in S["function_create"]}
    con_created = {k for k in S["constraint_add"]}
    buckets_created = {k[0] for k in S["bucket_insert"]}
    pub_created = {k for k in S["publication_add"]}
    first_version = {}
    for v in sorted(parsed):
        for k, key, _c, _x in parsed[v][0]:
            first_version.setdefault((k, key), v)

    rows = []

    def add(env, cat, kind, obj, detail, treatment):
        rows.append({"env": env, "category": cat, "object_kind": kind, "object": obj, "detail": detail, "suggested_treatment": treatment})

    snaps = {"prod": C.Snapshot("prod"), "dev": C.Snapshot("dev")}
    for env, snap in snaps.items():
        # D1 : exists in DB, never created by a file
        for t in sorted(snap.tables - tables_created):
            add(env, "D1", "table", t, "no CREATE TABLE in any repo file", "register; confirm origin before any rebuild comparison")
        for (t, c) in sorted(snap.cols):
            if t in tables_created and (t, c) not in cols_created:
                add(env, "D1", "column", f"{t}.{c}", "no CREATE TABLE column / ADD COLUMN names it", "parser-limited or out-of-band; verify against dump")
        for k in sorted(snap.pol - pol_created):
            add(env, "D1", "policy", ".".join(k), "no CREATE POLICY in any repo file", "register; origin unknown")
        for k in sorted(snap.trg - trg_created):
            if k[0] in tables_created or k[0] == "users":  # skip Supabase-managed storage/realtime triggers
                add(env, "D1", "trigger", ".".join(k), "no CREATE TRIGGER in any repo file", "register; origin unknown")
        con_names = {k[1] for k in con_created}
        for ix in C.load(env, "indexes"):
            i = ix["name"]
            if ix["schema"] != "public" or i in idx_created or i in con_names or AUTO.search(i):
                continue  # public schema only; constraint-backed and auto-named indexes are explained elsewhere
            add(env, "D1", "index", i, "no CREATE INDEX or named constraint in any repo file", "register; origin unknown")
        for f in sorted(set(snap.fn) - fn_created):
            add(env, "D1", "function", f, "no CREATE FUNCTION in any repo file", "register; origin unknown")
        for k in sorted(snap.cons - con_created):
            if not AUTO.search(k[1]) and k[0] in tables_created:
                add(env, "D1", "constraint", ".".join(k), "named constraint not created by any repo file", "register; origin unknown")
        for b in sorted(snap.buckets - buckets_created):
            add(env, "D1", "bucket", b, "no INSERT INTO storage.buckets in any repo file", "register; origin unknown (may be platform-created)")
    # D2 : recorded/applied versions whose objects are missing
    raw = __import__("json").load(open(os.path.join(C.EVID, "classification_raw.json"), encoding="utf-8"))
    baseline = {v for v in parsed if v < "20251126190540"}
    twins12 = {"20260305203528", "20260407203226"}
    prod_applied = set(snaps["prod"].hist) | baseline | twins12
    dev_applied = {v for v in parsed if v < "20261007000000"} - {"20260407211122"}
    for env, applied in (("prod", prod_applied), ("dev", dev_applied)):
        for v in sorted(applied):
            r = raw[env][v]
            for item in r["missing_items"]:
                add(env, "D2", "expected-object-missing", f"{v}:{item}", f"{names[v]} is treated as applied but the object is missing and no later applied file removes it",
                    "classify as out-of-band removal/change; shim or pending-fix candidate")
    # D3 : Dev vs Prod object differences
    P, D = snaps["prod"], snaps["dev"]

    def explain(kind, key):
        v = first_version.get((kind, key))
        if v and v >= "20260715000000":
            return f"created by Dev-line file {v}" + (" (October)" if v >= "20261007000000" else "")
        return "NOT explained by a Dev-line file" + (f" (first created by {v})" if v else " (no file creates it)")
    for t in sorted(D.tables - P.tables):
        add("dev-vs-prod", "D3", "table only on Dev", t, explain("table_create", (t,)), "expected until Dev-line is applied to Prod" if "Dev-line" in explain("table_create", (t,)) else "investigate")
    for t in sorted(P.tables - D.tables):
        add("dev-vs-prod", "D3", "table only on Prod", t, explain("table_create", (t,)), "investigate")
    for f in sorted(set(D.fn) - set(P.fn)):
        add("dev-vs-prod", "D3", "function only on Dev", f, explain("function_create", (f,)), "expected until Dev-line is applied to Prod" if "Dev-line" in explain("function_create", (f,)) else "investigate")
    for f in sorted(set(P.fn) - set(D.fn)):
        add("dev-vs-prod", "D3", "function only on Prod", f, explain("function_create", (f,)), "owner decision (update_pricing_rules): no consumer found")
    for k in sorted(D.pol - P.pol):
        add("dev-vs-prod", "D3", "policy only on Dev", ".".join(k), explain("policy_create", k), "expected until Dev-line is applied to Prod" if "Dev-line" in explain("policy_create", k) else "investigate")
    for k in sorted(P.pol - D.pol):
        add("dev-vs-prod", "D3", "policy only on Prod", ".".join(k), explain("policy_create", k), "Dev lacks it; release target replaces the storage set (October 1014/1015)" if k[0] == "objects" else "investigate")
    for k in sorted(D.cols - P.cols):
        if k[0] in P.tables:
            add("dev-vs-prod", "D3", "column only on Dev", ".".join(k), explain("column_add", k), "expected until Dev-line is applied to Prod" if "Dev-line" in explain("column_add", k) else "investigate")
    for k in sorted(P.cols - D.cols):
        if k[0] in D.tables:
            add("dev-vs-prod", "D3", "column only on Prod", ".".join(k), explain("column_add", k), "investigate")
    for k in sorted(D.trg ^ P.trg):
        add("dev-vs-prod", "D3", "trigger on Dev only" if k in D.trg else "trigger on Prod only", ".".join(k), explain("trigger_create", k), "investigate")
    for k in sorted(set(P.pub) | set(D.pub)):
        if P.pub.get(k, set()) != D.pub.get(k, set()):
            add("dev-vs-prod", "D3", "publication membership", k, f"Prod-only={sorted(P.pub.get(k, set()) - D.pub.get(k, set()))} Dev-only={sorted(D.pub.get(k, set()) - P.pub.get(k, set()))}", "decide parity from application dependency (portal uses polling)")
    for e in sorted(P.ext ^ D.ext):
        add("dev-vs-prod", "D3", "extension", e, "present on Prod only" if e in P.ext else "present on Dev only", "pg_net absence on Dev blocks 20260323201502 effect")

    os.makedirs(C.OUTDIR, exist_ok=True)
    with open(os.path.join(C.OUTDIR, "drift-register.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["env", "category", "object_kind", "object", "detail", "suggested_treatment"])
        w.writeheader()
        w.writerows(rows)
    cnt = collections.Counter((r["env"], r["category"], r["object_kind"]) for r in rows)
    for k, v in sorted(cnt.items()):
        print(k, v)
    print("total rows", len(rows))


if __name__ == "__main__":
    main()
