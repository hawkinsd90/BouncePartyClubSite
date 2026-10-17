# Stage D3 restore-integrity report: Production schema snapshot restored locally

Source: `prod_schema_only.sql` from the Stage B read-only capture (`2026-10-16T18:54:59Z`, PostgreSQL 17.6, pg_dump 18.4). SHA-256 `d64fd3b464de02039a3f017a1c9d77cd0a3dd2ea77a5e1b5d7a9a58b281d552d`, equal to the value in the Production manifest before and after the restore (the export was replayed byte-for-byte, never edited). The capture was about 4 hours old when D3 started (limit 24 h), so no refresh was needed. Target: scratch database `bpc_replay_d3_snapshot` on the local PostgreSQL 18.4 (`127.0.0.1:54329`, name prefix and ownership marker enforced). Raw restore log and catalogs are in `C:\Users\vikki\migration-evidence\d3-scratch\`.

## Dump structure (inspected without printing function bodies)
Schemas auth, public, realtime, storage, supabase_migrations; 109 functions (55 SECURITY DEFINER), 199 policies, 33 triggers, 80 RLS enables, about 49 default-privilege statements, ownership by postgres and the Supabase platform roles. It contains **no** CREATE EXTENSION, event trigger or publication statements and no data.

## Result: faithful restore, with allow-listed scaffolding only
One restore error: `schema "public" already exists` (benign: the new database already had `public`). Nothing was stripped from the dump (no ownership, grant, policy, constraint, trigger or SECURITY DEFINER removal).

| Scaffold | What | Effect on rehearsal strength |
|---|---|---|
| A1 roles | 15 platform roles created or normalised as NOLOGIN, NOSUPERUSER stubs with the captured inherit/createrole/createdb/replication/bypassrls attributes and captured memberships; `postgres` is the local superuser; `cli_login_postgres` (temporary hosted role) not recreated | Ownership and grants are preserved by name; login/superuser attributes are not reproduced |
| A2 extensions | `pgcrypto`, `uuid-ossp`, `pg_stat_statements` in schema `extensions` (PG18 contrib versions); `pg_net` and `supabase_vault` unavailable and **not faked** | Objects that call `net.*` / `vault.*` cannot run locally |
| A3 publications | `supabase_realtime` (6 tables) and `supabase_realtime_messages_publication` (7 partitions) rebuilt from the captured membership | Membership matches Production exactly |
| A4 buckets | 8 `storage.buckets` rows seeded from the captured configuration (configuration, not customer data), including `carousel-media` | Matches the capture; Storage service behaviour not reproduced |
| A5 history | 277 `supabase_migrations.schema_migrations` rows (version and name from the capture; statements carry a "CAPTURED HISTORY ROW" marker) | Local ledger only |

No security-critical application object (function, policy, grant, owner, SECURITY DEFINER flag, search_path) had to be altered or dropped.

## Catalog comparison with the Production capture (all schemas the capture covers)
| Category | Production | Restored | Difference |
|---|---|---|---|
| tables/sequences | 105 | 105 | 0 |
| columns | 1,129 | 1,129 | 0 |
| constraints | 330 | 817 | 487, all PostgreSQL 18 explicit NOT NULL constraints (contype n) |
| indexes | 352 | 352 | 0 |
| triggers | 33 | 33 | 0 |
| functions (bodies, owner, SECURITY DEFINER, volatility, search_path) | 68 | 68 | 0 |
| policies | 199 | 199 | 0 |
| relation / function / schema grants | 2,836 / 338 / 38 | same | 0 |
| column grants, views, types | 0 | 0 | 0 |
| publication membership | 2 | 2 | 0 |
| storage buckets | 8 | 8 | 0 |
| default ACLs | 24 | 15 | 9: supabase_admin defaults in `extensions`, `graphql`, `graphql_public` (schemas created by platform extensions, not in the dump) |
| extensions | 6 | 4 | pg_net and supabase_vault missing; pgcrypto 1.3 vs 1.4 and pg_stat_statements 1.11 vs 1.12 (PG17 vs PG18) |
| roles | 17 | 16 | login/superuser attributes by design; `cli_login_postgres` not recreated |
| event triggers | 6 | 0 | PostgREST, pg_graphql, pg_cron and pg_net platform triggers |

All 521 differences are K1 (restore-environment) with checked preconditions (`d3-discrepancy-register.csv`, groups B1-B5). **No unexplained or security-relevant difference.**

## The four K2 characteristics are preserved (not overwritten by the D2 reconstruction)
1. `user_roles_user_id_fkey` absent: constraints are identical to Production, so `user_roles` has no foreign key.
2. and 3. `task_status.admin_notes` and `crew_notes` present: columns identical.
4. Storage bucket `carousel-media` present with its captured configuration.

## Limits of the restore
Supabase runtime services (Auth, Storage API, Realtime delivery, PostgREST) are not running; `pg_net` / `vault` are absent; platform roles cannot log in. The restore supports reliable migration execution and post-upgrade catalog comparison, which is what D3 needs.
