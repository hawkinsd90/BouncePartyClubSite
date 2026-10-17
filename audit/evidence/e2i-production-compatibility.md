# E2I: Development compatibility with Production's working baseline

Everything below was produced offline on **disposable local PostgreSQL databases** (`127.0.0.1:54329`, `bpc_replay_e2i_*`) restored from the protected Stage B captures (Production 2026-10-16 18:54:59 UTC; Development 18:55:20 UTC) with **synthetic** data. No hosted system was contacted. Tools: `tools/e2i_dev_restore.py`, `tools/e2i_dev_october.py`, `tools/e2i_compat.py`, `tools/d3_catalog.py`. Production's existing working schema and behaviour are the reference; no migration history was copied from Production.

## 1. How the comparison was made
| Step | Scratch database | What it is |
|---|---|---|
| A | `bpc_replay_e2i_devbase` | The unmodified Development schema-only dump, hash-verified against `dev_manifest.json`, plus the captured extensions, publications, bucket rows and the 58 captured history rows. |
| B | `bpc_replay_e2i_asis` | A: seeded with synthetic users/commerce rows, then **the 23 October migration files applied as they are, one transaction each**. |
| C | `bpc_replay_e2i_relfinal` | The D4 "release final" state: Production's restored baseline after the 58-version Production plan (the reference). |
| D | `bpc_replay_e2i_aligned` | B with three optional pre-October files applied first (two bucket-settings UPDATEs and `update_pricing_rules`). |

Catalogs (19 categories) were captured from each and diffed for the `public` and `storage` schemas (`d3_catalog.py diff … public,storage`); the roles, extensions, event triggers, views and types categories had no differences.

## 2. Result in one paragraph
**The 23 October migrations apply to Development's restored catalog exactly as written (23 of 23, no failure), with no change to any migration file and no pre-October SQL.** After them Development differs from Production's release-final state only in documented classes (section 4). The pre-October work Development needs is therefore a *ledger* question (which of the 303 unrecorded pre-October versions may be recorded and on what evidence), not a schema-construction question; the only pre-October SQL with a behavioural effect is the optional alignment of section 5.

## 3. Development as captured versus Production as captured (before any migration)
`e2i-compat-current.json` (scratch, outside Git) classifies the 1,017 differences found:
| Class | Count | Meaning |
|---|---|---|
| Objects created by a Production-pending migration (Development has them, Production does not yet) | 367 | Expected: tables, columns, constraints, indexes, policies and triggers of the release |
| Privilege representation (`MAINTAIN` right of newer PostgreSQL dumps) | 177 | Noise of the two dump formats |
| Storage policies absent in Development | 30 | Containment (documented); replaced wholesale by the October storage migrations |
| Platform/project default privileges | 18 | Project-level, not migration-driven |
| Bucket settings differ | 9 | Containment / project configuration (section 4) |
| `auth.users` indexes only in Development | 4 | Platform |
| Realtime publication membership | 2 | Documented containment |
| Signup trigger absent / `update_pricing_rules` absent | 1 + 1 | Containment (`20261016120000` recreates the trigger) / E2A (`20260611184401`) |
| Remaining raw rows | 408 | 388 privilege rows on the objects above and on the platform default ACLs (closed or reduced by the October lockdown), 5 NOT NULL differences, 7 function bodies (whitespace/CR only, section 4), 5 Development-only storage policies (event-essentials, lot pictures; dropped by the October storage migrations), 3 constraint rows |

## 4. After the October block: what still differs from Production's release-final state
(diff `e2i-diff-asis.json`; with the section 5 alignment `e2i-diff-aligned.json`)
| Category | As-is | Aligned | Classification |
|---|---|---|---|
| Tables, triggers, views, types, extensions, roles, event triggers | 0 | 0 | Identical. The signup trigger on `auth.users` is recreated by `20261016120000`. |
| Columns / constraints | 3 / 3 | 3 / 3 | `same_day_weekday_delivery_fee_cents` / `_waived` on `orders` and `pricing_rules` are `NOT NULL` in Development, nullable in Production (Development stricter; the defaults are equal). Order-line `wet_or_dry` and `orders.surface` NOT NULL, different **before** October, are equal after it. No data is affected. |
| Indexes | 4 | 0 in `public` | `auth.users` indexes only in Development (platform). |
| Policies | 1 | 1 | `public.user_roles` "Users can read own role": a harmless duplicate of "Users can read own roles" (same `auth.uid() = user_id` rule). The Development-only public `ALL` policy "Service role full access to user_roles" is **removed by the October block** (no longer in the diff). |
| Functions | 24 | 23 | **22 differ only in line endings, 1 (`save_product_bundle_v2`) only in whitespace and comments** (identical after stripping comments and whitespace, verified on the two scratch databases: 14,668 characters each). `update_pricing_rules` exists only in Production (cleared by the optional alignment). No function logic differs. |
| Function grants | 29 | 27 | `service_role` EXECUTE on 27 trigger functions in the replay (platform default privileges, section 6). |
| Relation grants | 271 | 271 | 14 relations (12 tables, 2 sequences) lack `service_role`/`anon`/`authenticated` privileges in the replay that Production's release-final has. See section 6. |
| Schema grants / default ACLs | 12 / 9 | 12 / 9 | Project default privileges differ (platform). |
| Publications | 2 | 2 | Realtime membership: Development publishes fewer tables (containment; partition names are date-dependent). |
| Storage buckets | 5 | 2 | `public-assets` is private in Development (containment) and has no size/MIME limit until `20260517221038`; `carousel-media` has no limit/MIME list until `20260325231044` (and the MIME list is not set by any repository migration alone). |
| Storage policies | 0 | 0 | The October storage migrations drop every `storage.objects` policy and recreate the fixed set, so the final policy set is identical. |

## 5. Targeted pre-October alignment tested locally (not proposed for approval)
Applied to the scratch Development restore before the October block, all in one transaction each: `20260325231044` (carousel-media limit), `20260517221038` (public-assets limit and MIME list) and `20260611184401` (`update_pricing_rules`). Result: October still applies 23/23; the diff to release-final loses the `update_pricing_rules` function and its two grants and two of the five bucket differences. These three files are **owner decisions**, not requirements: the function has no caller (20261007120000's own comment) and the two bucket files only adjust limits. Other pre-October versions need no SQL to reach this state.

## 6. The one difference that needs a hosted-side read
In the replay, objects created by the Production-pending migrations (12 tables, 2 sequences, 27 trigger functions) end up **without the privileges Production's release-final has** for `service_role` (all 14 relations and 27 functions), and for `anon`/`authenticated` on 3 tables and the 2 sequences. The captured **default privileges** explain it and are a real difference, not a replay artefact: **Production has `public`-schema default ACLs (from both `postgres` and `supabase_admin`) granting `anon`, `authenticated` and `service_role` on new tables, sequences and functions; the Development capture has none for the `public` schema** (it keeps only the `storage`, `extensions`, `graphql`, `realtime` and `auth` defaults). In Development a table or function created by a migration therefore receives only what the migration itself grants. Migrations written for Production often rely on the defaults. Whether this is deliberate hardening of Development or drift, and whether the hosted run needs explicit GRANTs for the 14 relations and 27 functions (a security-relevant change, none proposed here), cannot be settled offline. **Query Q29 of `e2i-development-readonly-evidence-plan.sql`** reads the current state; the decision is owner decision U-E2I-7.

**Correction (E2J):** the sentence above that these objects "end up" without privileges "in the replay", and the earlier remark that this might be a replay artefact, were inaccurate. The 14 relations and 27 functions already exist in the captured Development database; their ACLs are captured state. The absence of Development `public` default privileges was already documented, and the captured Development `public` schema also grants `anon`/`authenticated` no USAGE (schema containment). See `e2j-default-privilege-analysis.md`.

## 7. Production's working behaviours checked
| Behaviour | Evidence | Status |
|---|---|---|
| Development alias `20260814120000` ↔ recorded `20260814002658` | alias file unchanged (`9ef0fe6e…`), D4 alias test | Treated as already recorded; no action |
| Custom e-mail hook create/drop chains and the atomic-approve RPC chain | four net-zero versions: objects absent in both captures | History-only candidates; never executed |
| Staff/admin permissions, role repair, `user_roles` policies | `20261016120000` applies; post-October policy diff is the single harmless duplicate | Equivalent |
| Financial functions and booking RPCs (RPC authorization hardening, payment functions) | 23 body differences are whitespace/CR only; October hardening applies | Equivalent in logic |
| Pricing rules | `pricing_rules` table equal; `update_pricing_rules` absent (optional) | Owner decision |
| Containment (14 Edge Function stubs, removed storage policies, signup trigger absent, pg_net absent, private `public-assets`, missing Realtime tables) | none removed by this analysis; the October block recreates the signup trigger and storage policy set; pg_net, stubs, Realtime membership and `public-assets` privacy are untouched | Preserved |
| Storage buckets and RLS | post-October bucket list matches except the two rows above; storage policies identical | Equivalent apart from containment |

## 8. Limits
Synthetic data only: the data transformations of the 94 evidence-set versions cannot be tested against real records. The catalogs do not include row data, Edge Function code or project settings. The hosted run of October is still gated on the owner decisions in `e2i-unresolved-blockers.md`.
