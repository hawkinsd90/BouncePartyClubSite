"""Stage E2J: builds e2j-default-privilege-analysis.md from the captured Stage B ACL data and the local scratch experiments (e2j-priv-tests.json, e2j-privobj2.json, e2j-privfn.json in the protected scratch folder).
Offline text generation; no database connection. Usage: python -I e2j_build_priv_doc.py"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
EV = os.path.abspath(os.path.join(HERE, ".."))
S = r"C:\Users\vikki\migration-evidence"
t = json.load(open(S + r"\e2j-scratch\e2j-priv-tests.json", encoding="utf-8"))
rels = json.load(open(S + r"\e2j-privobj2.json", encoding="utf-8"))
fns = json.load(open(S + r"\e2j-privfn.json", encoding="utf-8"))

BOOKING = {"inventory_products", "product_pricing", "product_categories", "product_bundles", "product_bundle_components", "package_inflatable_components", "package_inflatable_eligibility", "product_bundle_excluded_categories"}
TARGET = {
    "contact_inquiries": ("keep INSERT, SELECT, UPDATE (explicit, from 20260814113146); no DELETE", "none", "none (no client reads it; an admin console would need SELECT only, with the existing admin policy)"),
    "order_portal_links": ("none until a direct service-role consumer exists (access is through SECURITY DEFINER functions)", "none", "none"),
    "public_menu_groups": ("none until a direct service-role consumer exists", "none (public menu is read through a function)", "keep as captured (admin console, protected by admin policies)"),
    "public_menu_group_categories": ("none until a direct service-role consumer exists", "none", "keep as captured"),
    "payments_ledger_sequence_seq": ("USAGE (as captured)", "USAGE only if a client inserts into payments (as captured); never UPDATE", "USAGE (as captured)"),
    "receipt_number_seq": ("USAGE (as captured)", "USAGE only if required by the column default for the inserting role (as captured); never UPDATE", "USAGE (as captured)"),
}
L = []
w = L.append
w("# E2J: default-privilege analysis (Development versus Production)")
w("")
w("Offline only. Evidence: the hash-verified Stage B captures (Production 2026-10-16 18:54:59 UTC, Development 18:55:20 UTC), the repository SQL, and experiments on disposable local scratch clones (`bpc_replay_e2j_*`, `tools/e2j_priv_tests.py`, results in the protected folder). **No grant, default, migration, application or hosted object was changed.** Production's existing behaviour is the reference; nothing here recommends copying Production's defaults.")
w("")
w("## 1. Answer in brief")
w("- The 14 relations (12 tables, 2 sequences) and 27 functions are **not objects created by the replay**. They already exist in the captured Development database with the ACLs Development gave them. The differences come from **four independent causes**:")
w("  1. **Development has no `public` default privileges** (documented since E1; audit section Q row 20261018120000 and Step 3 item 3.3). Production's defaults (owner `postgres` and owner `supabase_admin`) gave every new table, sequence and function full rights to `anon`, `authenticated` and `service_role` at creation. Development's tables received only what each migration granted explicitly. Result: **11 of the 12 tables give `service_role` no privilege at all** (`contact_inquiries` has SELECT/INSERT/UPDATE from an explicit grant).")
w("  2. **`20261018120000` fixes this only for future objects.** It sets `postgres` defaults in `public` to `service_role` only (and revokes `anon`/`authenticated`); existing tables are untouched. After October the *defaults* of Development and Production's release-final are identical (T1), yet the 12 older tables differ.")
w("  3. **Production's grants are broader than the migrations ask for** (anon/authenticated/service_role on every table and sequence, plus `setval` on two sequences). Where Development is *narrower*, that is mostly a security improvement, not a defect (section 5).")
w("  4. **The 27 functions are all trigger functions.** Production's release-final grants `service_role` EXECUTE on them (retained from Production's original default function grants; October revokes only PUBLIC, `anon` and `authenticated`); Development leaves them owner-only. **This has no runtime effect** (T4: a role without EXECUTE still fires the trigger; PostgreSQL checks EXECUTE on a trigger function only when the trigger is created).")
w("- **One difference matters for compatibility:** `service_role` cannot read the eight catalog tables the `create-booking` Edge Function reads (T3: `permission denied for table product_pricing` in Development-after-October, 2 rows in Production's release-final).")
w("- **A second, larger fact was already known but now measured:** the captured Development `public` schema grants `anon` and `authenticated` **no USAGE at all** and gives `service_role` **CREATE**. That is the documented schema containment (`REVOKE USAGE ON SCHEMA public FROM anon, authenticated`, audit line for refresh #1576). While it stands, every table and function grant to `anon`/`authenticated` is unreachable; its removal (Step 4 item 4.9) is when the object-level grants below start to matter.")
w("")
w("## 2. Mechanics distinguished")
w("| Concept | Production (captured) | Development (captured) | After October (both) |")
w("|---|---|---|---|")
w("| Default ACL owner `postgres`, schema `public`, tables | `postgres`, `anon`, `authenticated`, `service_role`: all table rights | none | `postgres` + `service_role` all rights; `anon`/`authenticated` revoked |")
w("| Default ACL owner `postgres`, `public`, sequences | USAGE/SELECT/UPDATE to the same four | none | `postgres` + `service_role` |")
w("| Default ACL owner `postgres`, `public`, functions | EXECUTE to the same four (and PUBLIC) | none (PostgreSQL built-in: PUBLIC may execute new functions) | `postgres` + `service_role`; PUBLIC revoked |")
w("| Default ACL owner `supabase_admin`, `public` | same full grants to `anon`/`authenticated`/`service_role` | none | **unchanged in Production** (Step 3.3); absent in Development |")
w("| Schema `public` ACL | PUBLIC, `anon`, `authenticated`, `service_role`, `postgres`, `supabase_auth_admin`: USAGE; `pg_database_owner`: CREATE | `postgres`: USAGE+CREATE; `service_role`: USAGE+CREATE; nothing for `anon`/`authenticated`/PUBLIC | unchanged by October |")
w("| RLS | enabled on all 12 tables with policies | enabled with policies | `service_role` has BYPASSRLS but still needs the table privilege (T3) |")
w("")
w("Which role creates the object matters: defaults apply per *creating* role. Migrations run as `postgres`; objects created from the dashboard as `supabase_admin` follow the `supabase_admin` entries, which Development lacks.")
w("")
w("## 3. What a new object receives (T1; created as `postgres` in `public`)")
w("| State | New table | New sequence | New function |")
w("|---|---|---|---|")
for tag, label in (("dev_captured", "Development as captured"), ("dev_after_october", "Development after October"), ("prod_captured", "Production as captured"), ("prod_release_final", "Production release-final")):
    d = t["T1_new_object_defaults"][tag]
    w(f"| {label} | `{d['T']}` | `{d['S']}` | `{d['F']}` |")
w("")
w("Development-as-captured: a new table is owner-only and a new function falls back to PostgreSQL's built-in PUBLIC EXECUTE. Development-after-October and Production-release-final are **identical** for future objects.")
w("")
w("## 4. The 14 relations, object by object")
w("Privilege letters: `r` SELECT, `a` INSERT, `w` UPDATE, `d` DELETE, `D` TRUNCATE, `x` REFERENCES, `t` TRIGGER, `U` USAGE (MAINTAIN omitted as dump noise). Columns: Development as captured / Development after October (these are identical: October does not touch them) / Production release-final.")
w("")
w("| Relation | Kind | Development captured = after October | Production release-final | Cause | Compatibility impact | Proposed minimum target (service_role / anon / authenticated) |")
w("|---|---|---|---|---|---|---|")
for r in rels:
    n = r["name"]
    kind = "sequence" if r["kind"] == "S" else "table"
    assert r["dev_captured"] == r["dev_after_oct"], n
    if n in BOOKING:
        cause = "Development had no default when the table was created; no explicit service_role grant"
        impact = "**High**: `create-booking` (service role) reads it; denied (T3)"
        tgt = ("SELECT", "unchanged (as captured)", "unchanged (as captured)")
    elif kind == "sequence":
        cause = "Older sequence: Development grants USAGE only; Production grants SELECT/UPDATE too (default-derived)"
        impact = "None: USAGE is what `nextval` needs (T5). Production's UPDATE lets `anon` call `setval`"
        tgt = TARGET[n]
    else:
        cause = {"contact_inquiries": "Development: explicit grants only (service_role SELECT/INSERT/UPDATE); Production: defaults add anon SELECT and authenticated/service_role full",
                 "order_portal_links": "No explicit grant for service_role; Production default-derived",
                 "public_menu_groups": "Development: explicit grants for authenticated only; Production default-derived (anon SELECT, service_role)",
                 "public_menu_group_categories": "As public_menu_groups"}[n]
        impact = {"contact_inquiries": "None known: the Edge Function inserts with INSERT held; no client reads the table", "order_portal_links": "None known: no direct reader found; functions are SECURITY DEFINER",
                  "public_menu_groups": "None known: the admin console uses `authenticated`, which Development grants", "public_menu_group_categories": "As public_menu_groups"}[n]
        tgt = TARGET[n]
    w(f"| `{n}` | {kind} | {r['dev_captured']} | {r['prod_release_final']} | {cause} | {impact} | service_role: {tgt[0]}; anon: {tgt[1]}; authenticated: {tgt[2]} |")
w("")
w("## 5. The 27 functions")
w("All 27 are trigger functions (`is_trigger = true` in the scratch catalog). Development after October: `{postgres=X/postgres}` for each. Production release-final: `{postgres=X/postgres,service_role=X/postgres}`.")
w("")
w("| Function | In Development capture | In Production capture | Captured Dev grantees | Captured Prod grantees |")
w("|---|---|---|---|---|")
for f in fns:
    w(f"| `{f['name']}` | {'yes' if f['in_dev'] else 'no (created by October)' if not f['in_dev'] else ''} | {'yes' if f['in_prod'] else 'no'} | {', '.join(f['dev_cap']) or '-'} | {', '.join(f['prod_cap']) or '-'} |")
w("")
w("Before October, Development's captured grantees include PUBLIC (no default existed), Production's include PUBLIC, `anon`, `authenticated`, `service_role`. The October lockdown reduces both to owner (Development) or owner + `service_role` (Production). **Proposed target: owner only**; no `service_role` EXECUTE is needed (T4).")
w("")
w("## 6. Grants that may be inappropriate under Step 3 (reported only; Production is not modified)")
w("1. **Production: `anon` can call `setval` on `receipt_number_seq` and `payments_ledger_sequence_seq`** (T5: `setval` returned the new value for `anon` in the release-final clone; refused in Development). Order/receipt numbering could be reset or advanced by an unauthenticated caller once schema USAGE exists, which it does in Production. Step 3 item to add.")
w("2. Production: `anon` SELECT and `authenticated` DML on `contact_inquiries` (contact data) rely on RLS alone; `service_role` holds TRUNCATE/REFERENCES/TRIGGER on every table (unneeded).")
w("3. Production: the `supabase_admin` default ACLs keep granting new objects to `anon`/`authenticated`/`service_role` (Step 3.3, SEC-E).")
w("4. Development: `service_role` holds CREATE on schema `public` (T0) and, before October, new functions are PUBLIC-executable. Remove the CREATE in Step 3; October closes the function default.")
w("5. Development: `anon` SELECT on the catalog tables is inert wherever the policies admit only admins (the policy names Q30 returns decide which); keep as captured unless the owner tightens it.")
w("")
w("## 7. Proposed minimum-privilege target (a proposal for owner and security review; not applied anywhere)")
w("```sql")
w("-- Needed by the create-booking Edge Function (service role), proven locally (T3/T6):")
for n in sorted(BOOKING):
    w(f"GRANT SELECT ON public.{n} TO service_role;")
w("-- Everything else: unchanged. No GRANT to anon/authenticated. No TRUNCATE/REFERENCES/TRIGGER. No sequence UPDATE.")
w("-- Schema containment removal (gate, Step 4 item 4.9) is a separate decision: GRANT USAGE ON SCHEMA public TO anon, authenticated; REVOKE CREATE ON SCHEMA public FROM service_role;")
w("```")
w("Local application of the eight SELECT grants on a scratch clone (T6): `anon` and `authenticated` privileges unchanged for all 12 tables, `service_role` read of `product_pricing` succeeds. **Alternative B (owner choice):** give `service_role` SELECT/INSERT/UPDATE/DELETE on all application tables, matching what `20261018120000` now gives future tables; this is broader than the minimum and consistent with the future-object policy. The edge functions that write these tables (staff-order-save for catalog writes) have not been traced beyond reads; the hosted Edge Function source and the real traffic decide.")
w("")
w("## 8. Local evidence (all on disposable clones)")
w("| Test | Result |")
w("|---|---|")
w("| T0 schema `public` | Dev: `anon`/`authenticated` no USAGE, `service_role` USAGE+CREATE; Prod: all four roles USAGE, none CREATE |")
w("| T1 new-object defaults | section 3 |")
w(f"| T3 service_role reads `product_pricing` | Dev after October: `{t['T3_service_role_reads_product_pricing']['dev_after_october']['stderr']}`; Production release-final: `{t['T3_service_role_reads_product_pricing']['prod_release_final']['stdout']}` row(s) |")
w(f"| T4 trigger function without EXECUTE | ACL `{t['T4_trigger_fires_without_execute']['acl_of_function']}` (role without EXECUTE): insert result `{t['T4_trigger_fires_without_execute']['insert_result']}` (trigger fired) |")
w(f"| T5 sequences | Dev after October: `anon` nextval `{t['T5_sequence_privileges']['dev_after_october']['anon_nextval']}`, setval `{t['T5_sequence_privileges']['dev_after_october']['anon_setval']}`; Production release-final: nextval `{t['T5_sequence_privileges']['prod_release_final']['anon_nextval']}`, setval `{t['T5_sequence_privileges']['prod_release_final']['anon_setval']}` (schema USAGE was granted to `anon` in the clones to isolate the sequence privilege) |")
w(f"| T6 target applied to a scratch clone | rc {t['T6_target_applied_locally']['rc']}; anon/authenticated unchanged: {t['T6_target_applied_locally']['anon_authenticated_unchanged']}; service_role read afterwards: {t['T6_target_applied_locally']['service_role_read_after']} |")
w("")
w("**Assumptions that need hosted verification (Q29, Q30):** the live Development ACLs still equal the 2026-10-16 capture; the Edge Functions deployed (or to be deployed) read the tables with the service-role key; the Data API settings of the project; whether anything is created by `supabase_admin`; the real traffic on `receipt_number_seq`.")
w("")
w("## 9. Corrections to E2I wording")
w("E2I (`e2i-production-compatibility.md` section 6 and the report) said objects created by the release come out without the privileges and that this \"may be a replay artefact\". Corrected: the 14 relations and 27 functions already exist in the captured Development database; the ACL differences are real captured state, caused by the missing `public` defaults when those objects were created plus Production's broader default grants. The absence of Development `public` defaults was already documented (audit section Q and Step 3.3); E2I's contribution is the object-level measurement, the schema-level finding above and the confirmation that after October the defaults for future objects are identical in both environments.")
open(os.path.join(EV, "e2j-default-privilege-analysis.md"), "w", encoding="utf-8", newline="\n").write("\n".join(L) + "\n")
print(len(L), "lines")
