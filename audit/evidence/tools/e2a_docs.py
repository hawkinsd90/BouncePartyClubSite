"""Stage E2A: generate e2a-unresolved-evidence.md and a reconciliation numbers JSON from the E2A outputs. READ-ONLY (CSV and JSON inputs only)."""
import collections
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
EV = r"C:\Users\vikki\Desktop\Repos\BouncePartyClubSite\audit\evidence"
OUT = r"C:\Users\vikki\migration-evidence\e2a-scratch"
st = list(csv.DictReader(open(os.path.join(OUT, "e2a-statements-all.csv"), encoding="utf-8")))
acts = list(csv.DictReader(open(os.path.join(EV, "e2a-proposed-actions.csv"), encoding="utf-8")))
pend = {(a["environment"], a["version"]): a for a in acts}
L = ["# E2A unresolved evidence and the exact read-only queries that would resolve it", "",
     "Everything below is **prepared, not executed**: E2A contacted no hosted system. Each query is read-only and returns counts, booleans or catalog definitions only; no customer, payment or authentication rows. Run them only in a separately authorized evidence capture and inside the 24 h freshness window, with the approved G1 read-only method (direct `psql`, `default_transaction_read_only=on`, no Supabase CLI).", ""]

# A. unmatched definitions
L += ["## A. Definitions the heuristic could not match (object exists, definition differs from every migration in its chain)", "",
      "These are real differences or limits of token-set matching; they keep the owning version at class P. Query to read the live definition:", ""]
seen = set()
rows = []
for s in st:
    if s["status"] == "UNMATCHED" and s["version"] < "20261007000000" and (s["environment"], s["kind"], s["object"]) not in seen:
        seen.add((s["environment"], s["kind"], s["object"]))
        rows.append(s)
q = {"index": lambda o: f"SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='{o}';",
     "policy": lambda o: "SELECT cmd, roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='%s' AND policyname='%s';" % tuple(o.split(".", 1)),
     "col": lambda o: "SELECT format_type(atttypid, atttypmod), attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.%s'::regclass AND a.attname='%s';" % tuple(o.split(".", 1)),
     "constraint": lambda o: "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.%s'::regclass AND conname='%s';" % tuple(o.split(".", 1))}
L += ["| Environment | Version | Object | Reason | Read-only query |", "|---|---|---|---|---|"]
for s in rows:
    fn = q.get(s["kind"])
    L.append(f"| {s['environment']} | `{s['version']}` | {s['kind']} `{s['object'][:70]}` | {s['detail'][:80]} | `{fn(s['object']) if fn else ''}` |")
L.append("")

# B. effects absent
L += ["## B. Effects absent from the captured catalog that need an owner decision or execution", ""]
byv = collections.defaultdict(list)
for s in st:
    if s["status"] == "ABSENT" and s["version"] < "20261007000000":
        byv[(s["environment"], s["version"])].append(s)
for env in ("Production", "Development"):
    vs = sorted(v for e, v in byv if e == env)
    cls = collections.Counter(pend[(env, v)]["e2a_class"] for v in vs if (env, v) in pend)
    L.append(f"- **{env}:** {len(vs)} unrecorded pre-October versions have at least one absent statement ({dict(cls)}).")
L.append("")
L += ["Development versions with absent statements (the full statement-level rows are in `e2a-dev-proof.csv`, columns `absent_or_unmatched_objects`):", ""]
for (env, v), ss in sorted(byv.items()):
    if env == "Development" and (env, v) in pend:
        a = pend[(env, v)]
        L.append(f"- `{v}` {a['file'][15:]}: class {a['e2a_class']}; " + "; ".join(f"{x['kind']} {x['object'][:50]}" for x in ss[:3]) + (f" (+{len(ss) - 3} more)" if len(ss) > 3 else ""))
L.append("")

# C. data statements
L += ["## C. Data and dynamic statements (cannot be proven from a schema-only capture)", ""]
for env, label in (("Production", "Production baseline (40 files)"), ("Development", "Development pre-October (306 files)")):
    sel = [a for a in acts if a["environment"] == env and int(a["unprovable_data_or_dynamic"]) > 0 and a["version"] < "20261007000000" and (env == "Development" or a["version"] < "20251126190540")]
    n = sum(int(a["unprovable_data_or_dynamic"]) for a in sel)
    L.append(f"- **{label}:** {len(sel)} versions, {n} unprovable statements. The per-statement read-only query is in the `readonly_queries_needed` column of `{'e2a-prod-baseline-proof.csv' if env == 'Production' else 'e2a-dev-proof.csv'}`.")
L += ["", "Typical pattern and how to read the result: a seed `INSERT ... VALUES ('key', ...)` is checked with `SELECT count(*) FROM t WHERE first_column IN (keys...)` and should return the number of keys; a backfill `UPDATE ... WHERE <condition>` is checked with `SELECT count(*) FROM t WHERE <condition>` and a result of 0 supports (but does not prove) that it ran; a `DELETE` is checked the same way. A count never proves the original SQL ran, because the rows could have been created or removed by other means; it only supports a schema-and-data-equivalence reconciliation record.", ""]

# D. recorded SQL
L += ["## D. Recorded SQL texts for statement-level confirmation (optional)", "",
      "Stage B stored digests of each recorded `statements` array, not the text. E2A used digest equality (comment-insensitive) between each recorded row and its repository file, which is strong evidence but not a text diff. To obtain the stored text for the identity cases:", "",
      "```sql", "SELECT version, name, statements FROM supabase_migrations.schema_migrations", " WHERE version IN ('20260305205811','20260408200431');   -- Production", " -- and on Development:", "SELECT version, name, statements FROM supabase_migrations.schema_migrations WHERE version = '20260814002658';", "```", ""]

# E. global
L += ["## E. Global constraints", "",
      "- Every verdict is tied to the 2026-10-16 18:54-18:55 UTC captures; nothing here describes a current hosted state.",
      "- Definition matching is token-set based for policies, constraints, indexes and column defaults; a match is strong evidence but not a byte comparison. Functions are matched by the Stage B body digests.",
      "- PostgreSQL truncates identifiers to 63 bytes; E2A applies that rule when keying objects (this corrected a Stage B misreading of two Development policies).",
      "- Applied-by-whom and when cannot be recovered from catalogs; E2A therefore reports 'schema-equivalent' candidates, never 'the SQL ran'."]
open(os.path.join(EV, "e2a-unresolved-evidence.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("written", len(L), "lines;", len(rows), "unmatched definitions listed")
