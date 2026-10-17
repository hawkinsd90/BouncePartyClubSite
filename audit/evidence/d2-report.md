# Stage D2 report: R-2a, Production's recorded history rebuilt locally and compared with the Production baseline

Branch `Dev`, HEAD `63672cd221b4cc11fb436fd7ad65444d29746960`. Environment: throwaway local PostgreSQL 18.4 (`127.0.0.1:54329`, plain PostgreSQL + the replay tool's Supabase stubs). Production side: the hash-verified Stage B read-only capture (PostgreSQL 17.6). **No hosted system was contacted in D2** (the baseline was fresh enough, so no refresh was needed). Protected artifacts (row-level register, raw diffs, local catalogs): `C:\Users\vikki\migration-evidence\d2-scratch\`.

**Result: D2 complete. 1,829 discrepancies, all classified: K1 1,825, K2 4, K3 0, K4 0, K5 0. No blocker for D3.** This is a local-stub comparison; it does not prove hosted Supabase behaviour.

## 1. Baseline freshness and integrity
- Stage B Production capture: `2026-10-16T18:54:59Z`, PostgreSQL 17.6, read-only session; at D2 start it was about 3 h 35 min old (limit 24 h), so no refresh was needed.
- All 24 files in the Production manifest re-hashed: 24 verified, 0 mismatches. History: 277 rows, 277 unique versions.
- Preflight: branch `Dev`, HEAD `63672cd`, 386 migration files, Case 43 absent, recovered-migration hash tests 63/63, replay-safety 144/144, pending-set 54/54. Status was clean except an uncommitted `.gitignore` line (adds the `.pyc` of the C4 fingerprint script) that I did not make and did not touch.

## 2. Pre-upgrade migration selection (exact, unambiguous)
- **Rule:** baseline = repository versions earlier than Production's first recorded version (`20251126190540`): **40 files** (`20251001051900` to `20251019141249`); recorded = the **277** Production versions, matched by exact version (every one has a repository file); union ascending = **317 files**, ending at `20260928172217`.
- **Excluded (69):** 23 October migrations, and 46 Development-line files not recorded in Production (44 plus cases 41/42 `20260305203528` and `20260407203226`, whose versions are not recorded in Production; the related recorded versions `20260305205811` and `20260408200431` are included). Case 43 is not in the repository. No aliasing was applied; no filename or history record changed.
- No duplicates; selected-manifest SHA-256 `82d8797b18b08c6baabd4f3c0a201a6165ff3fee99e69713bb1c881cf7509499` (file name, version and content hash per line); selected-versions SHA-256 `2edb3714b2e4aa17715ddbec62aecdbf33bbeb939c9286156f9b6ce0844e09fd`. Full list: `d2-selected-manifest.json`.

## 3. Local execution
Scratch database `bpc_replay_d2_preupgrade` (name `prod` is refused by the tool's guard, so a neutral name was used), created and bootstrapped by the guarded replay tool, then each selected file replayed as one transaction with stop-on-error by `tools/d2_rebuild.py` (the replay utility itself was not modified).
- **316 files executed, 0 SQL failures, 1 skipped** (`20260323201502`, needs `pg_net`). Result `COMPLETED` (`d2-rebuild-result.json`).
- S1 applied after `20251207163822` (legacy uppercase CHECK present before = 1, after = 0). S2 applied before `20260615175816` (`orders` already published, removed so the original SQL re-adds it). No other adjustment. No Production data imported.
- **Independent pre-upgrade checks (11, all pass):** none of the October objects exist (`invoice_links.revoked_at`, `booking_setup_proofs`, payment-operation functions, refund functions, `order-evidence` bucket, the two guard triggers); the pre-lockdown anonymous policy on `order_changelog` is still present; no Case 43 policy; no role CHECK; selected set ascending, unique, ending at Production's highest recorded version; `supabase_realtime` membership identical to Production.

## 4. Discrepancy register (K1-K5)
Group-level register with justification, evidence and preconditions: `d2-discrepancy-register.csv`. Every row was classified by a rule whose precondition was checked against the data; a failed precondition would have been K5 (none failed). Row-level register: protected folder.

| Group | Class | Rows | What | D3 reproduce? | Impact | Blocks D3 |
|---|---|---|---|---|---|---|
| G01 | K1 | 590 | Supabase-owned auth/storage objects absent from the stub | no | none for the app schema | no |
| G02 | K1 | 37 | Stub auth/storage objects defined differently (owner, RLS, types, extra stub constraints/indexes) | no | none; runtime unverifiable | no |
| G03 | K1 | 253 | PostgreSQL 18 explicit NOT NULL constraints (each column is NOT NULL on both sides, verified per row) | no | none | no |
| G04 | **K2** | 1 | `user_roles_user_id_fkey` exists locally, **not in Production** | **yes** (start without FK; orphaned role rows present) | orphan role rows persist until `20261016120000` | no |
| G05 | **K2** | 2 | `task_status.admin_notes` / `crew_notes` exist in Production, created by no migration | yes (in the snapshot) | rebuild-from-migrations lacks them | no |
| G06 | K1 | 3 | Policy deparse `::text` cast (Production `auth.users.email` is varchar; stub is text) | no | none | no |
| G07 | K1 | 64 | Function bodies differ only in line endings (347 of 386 migration files use CRLF); whitespace- and comment-normalized digests identical for all 64 | no | none | no |
| G08 | K1 | 785 | auth/storage table grants via platform roles/owners; **public: 0 differences** | no | none | no |
| G09 | K1 | 32 | schema-level grants for platform roles | no | none | no |
| G10 | K1 | 27 | default ACLs: supabase_admin / auth / storage defaults absent locally; postgres/public defaults equal ignoring the owner entry | snapshot has them | none for migrations run as postgres | no |
| G11 | K1 | 34 | platform publication, extensions (`pg_net`, `pg_stat_statements`, `supabase_vault`; pgcrypto 1.3 vs 1.4), 6 event triggers, 10 platform roles | no | `pg_net` migration unverifiable locally | no |
| G12 | **K2** | 1 | storage bucket `carousel-media` exists in Production, inserted by no migration | yes (in the snapshot) | rebuild lacks the bucket although its policies exist | no |

## 5. Totals by object category (rows in scope: public, storage, auth)
| Category | Production | Local | Discrepancies | By class |
|---|---|---|---|---|
| tables/sequences | 93 | 61 | 39 | K1 39 |
| columns | 1,035 | 731 | 328 | K1 326, K2 2 |
| constraints | 310 | 443 | 385 | K1 384, K2 1 |
| indexes | 331 | 209 | 124 | K1 124 |
| triggers | 32 | 25 | 7 | K1 7 |
| functions | 68 | 68 | 64 | K1 64 |
| policies | 199 | 199 | 3 | K1 3 |
| relation grants | 2,580 | 1,865 | 785 | K1 785 |
| column grants | 0 | 0 | 0 | none |
| function grants | 338 | 338 | 0 | none |
| schema grants | 28 | 16 | 32 | K1 32 |
| default ACLs | 24 | 3 | 27 | K1 27 |
| publications | 2 | 1 | 1 | K1 1 |
| extensions | 6 | 3 | 4 | K1 4 |
| roles | 17 | 7 | 23 | K1 23 |
| event triggers | 6 | 0 | 6 | K1 6 |
| views / types | 0 / 0 | 0 / 0 | 0 | none |
| storage buckets | 8 | 7 | 1 | K2 1 |

In the **public schema**: 0 table, index, trigger, grant or function-grant differences; the only differences are the FK, the two `task_status` columns, the 253 PG18 NOT NULL constraints, and 2 policy cast renderings. All 68 function signatures, owners, SECURITY DEFINER flags, volatility and `search_path` settings match.

## 6. Known drift cases
- `user_roles_role_check`: absent in Production and, after S1, absent locally: **no difference** (confirms the historical file recorded the CHECK but it is not in Production; drift D2).
- `user_roles` FK to `auth.users`: absent in Production, present locally: **K2** (G04).
- `orders` in `supabase_realtime`: the publication rows are **identical** (`order_lot_pictures, order_pictures, order_signatures, orders, payments, task_status`); S2's pre-state confirmed the historical double add.
- Default privileges: see G10; no public-schema default-privilege difference beyond the owner-entry representation.
- `update_pricing_rules`: present with identical signature, owner and grants on both sides (recorded in Production by `20260611184401`); no application consumer is known, unchanged by D2.
- Storage: 7 of 8 buckets identical; `carousel-media` is K2 (G12). Storage policies: identical except one `::text` cast rendering (G06).
- Migrations whose effects were later superseded: no unexplained difference in the public schema.

## 7. D1 anonymous SELECT grants (24 tables)
- **Not a stub artifact.** In the pre-upgrade comparison the public-schema relation grants are identical to Production. In Production today `anon` holds **all** privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on **all 55** public tables, with RLS enabled on all 55 and 26 tables carrying an anon/public write-capable policy. These come from the `postgres` default privileges (which the stub mirrors), not from explicit grants in the selected migrations.
- Of the 24 tables, 21 exist pre-upgrade (each with the full anon privilege set in Production and locally); `contact_inquiries`, `public_menu_groups` and `public_menu_group_categories` are created by Development-line files not in Production.
- October migration `20261013120000` revokes INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES from `anon` on every public table, leaving SELECT. The remaining 24 SELECT grants therefore come from Production's default privileges, narrowed by October, and are inert under RLS because those tables have no anon SELECT policy. Hardening them (revoke SELECT where no anon policy exists) is a Step 3 decision, not a migration discrepancy.

## 8. Unverifiable (stub) differences
Real Supabase Auth and Storage schemas and runtime, `pg_net` and the skipped `20260323201502`, `supabase_vault`, Realtime delivery and its messages publication, platform event triggers and role attributes, request-time RLS under PostgREST, and PostgreSQL 17 versus 18 behaviour differences beyond the catalog comparison.

## 9. Blockers for D3
None. D3 must start from the Production shape (no FK, orphaned roles, `task_status` notes columns, `carousel-media` bucket) via the restored schema snapshot, which G04, G05 and G12 require. Qualifications: this stage covers catalog structure, not data; K3 (data-dependent) differences cannot appear because no Production data was loaded, so data-dependent behaviour (e.g. the orphan-role deletion count, auth.users non-empty guard) must be rehearsed in D3 against a representative dataset.

## 10. Files
Created: `audit/evidence/d2-report.md`, `d2-discrepancy-register.csv`, `d2-selected-manifest.json`, `d2-rebuild-result.json`, `tools/d2_rebuild.py`, `tools/d2_compare.py`, `tools/d2_classify.py`. Modified: `audit/step2-migration-audit.md` (section AD). Nothing else changed.

Production and Development were not contacted or modified. No Supabase CLI, Docker, WSL, deployment, staging or commit.
