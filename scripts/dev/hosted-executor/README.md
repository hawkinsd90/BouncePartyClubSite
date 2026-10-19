# Exact-version migration executor (Step 4A.1, D-01)

**Status:** built and rehearsed on local scratch PostgreSQL only. Its hosted transport exists but has never been connected to any hosted project and cannot start without a signed hosted authorization. The Step 2 local executor (`scripts/dev/local-executor/`) is unchanged and remains loopback-only; this tool reuses its guard functions by import, not by edit.

## What it executes
Exactly the 28 files of `audit/step4/executor/dev-package-oct-s3b.sealed.json`: the 23 October gate files (`20261007120000` to `20261025120000`, class `withheld-gate`) and the 5 Step 3B files (`20261026120000` to `20261026120400`, class `step3b`), each at its own version, in version order, bound to Git commit `ecdda40cb2e858bb21469ce7fbc55fbfc5a05d6a`. History-only and attestation bookkeeping, the two bucket updates and everything blocked, withdrawn, excluded or demo-admin stay with the Step 2 batches and are refused here by code.

## How one step works (one transaction per version)
The tool renders one channel-neutral script per version. It contains no `BEGIN`/`COMMIT`; the caller supplies the single transaction (`psql --single-transaction`, or the implicit transaction of one multi-statement SQL call). Inside it:
1. `SET LOCAL lock_timeout`, `SET LOCAL statement_timeout`, advisory lock `bpc-dev-executor`.
2. **PRE** (a `DO` block): database and role are the expected ones; the ledger exists; the version is not recorded; its predecessors are recorded; the package rows already recorded are exactly the earlier steps and carry this executor's marker; the ledger rows outside the package equal the approved export (count and SHA-256 of the sorted versions); schema containment is in force; the catalog fingerprint equals the rehearsed pre-state.
3. The migration file, verbatim (LF-normalised), as written in Git.
4. **POST** (a `DO` block): the catalog fingerprint equals the rehearsed post-state; containment still holds; row level security is on for every public table; the version's own boolean rules (Step 3B `post_effect_present`) are true.
5. `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)` with the file's version, the CLI-style name (file name without version and `.sql`), and `statements = [marker, exact SQL]`. Marker: `-- BPC-DEV-RECONCILIATION executed; executor=bpc-dev-executor/1; batch=X-OCT|X-S3B; step=N/28; version=...; package_sha256=...; sha256_lf=...` (same prefix and `executed` kind as the Step 2 hosted procedure).
6. A final assertion that the ledger count is the approved base plus the step number.
Any `RAISE` rolls back the whole transaction: SQL effects, ledger row and all. **The guards live in the database, not in this tool**, so they also protect a script that is sent by any other channel.

## The fingerprint
`lib/fingerprint.cjs`: per-category MD5 digests of public functions (body hash, owner, SECURITY DEFINER, config, ACL), relations, columns, constraints, indexes, triggers, policies (public and storage), schema ACLs, default privileges (public/global), bucket rows, publications and extensions, evaluated with `search_path = pg_catalog`, ACLs ordered by role name, PostgreSQL 18-only NOT NULL constraints excluded. On 2026-10-18 a read-only run on hosted Development produced digests identical to the local Development base for every category (extension names compared as a set; versions excluded because 17 and 18 differ). The step-by-step sealed values come from `seal`.

## Commands
| Command | Target | Purpose |
|---|---|---|
| `build --commit SHA --out FILE` | none | skeleton package from the Development manifest at a commit |
| `seal --package SKELETON --template bpc_replay_X --db bpc_exec_Y --out FILE` | local scratch | rehearse on a fresh clone and record per-step fingerprints |
| `plan` / `run` / `verify` | local scratch | `--db bpc_exec_NAME --audit-dir DIR --approval-hash PACKAGE_SHA --expect-base-count N --expect-base-sha256 H` |
| `run` / `verify --target hosted-development --authorization FILE` | hosted | refused unless the authorization document passes every check |
| `render --step N ...` | none | print the exact script for step N |

`run` also accepts `--report FILE`: a sanitized report (package hash, commit, target, result, ledger identity before and after as row counts and SHA-256 of the sorted version lists, new versions, any pre-existing row modified or removed, each step's SHA-256, fingerprint and role probes, audit head). It contains no SQL text and no connection data.

Local safety (reused from the Step 2 tool): loopback host, `bpc_exec_*` database names, scratch ownership comment, no TLS, no credential options, no `DATABASE_URL`/`SUPABASE_*`/`PG*` environment.

## Hosted authorization (never committed with credentials)
JSON, `schema: bpc-hosted-dev-authorization/1`, hashed in `document_sha256`: `project_ref` (the Development ref; the Production ref is refused by name), `package_sha256`, `versions` (a contiguous run starting at the first unrecorded step), `approved_withheld` (October versions the owner releases), `base_ledger {count, sha256}` from the pre-run export, `restore_point {id, taken_at_utc}` taken before approval, `approved_by`, `approved_at`, `expires_at` (at most 48 h), and the statement `AUTHORIZE HOSTED DEVELOPMENT EXECUTION`. The connection string comes only from `BPC_HOSTED_DEV_DATABASE_URL` (Development direct host or `postgres.<ref>` pooler user, `sslmode=require`).

## Audit and restart
`audit.jsonl` is append-only and hash-chained (`step_start`, `step_end` with fingerprint and role probes, `step_failed`, `run_start/run_end`, `refused`). Restart works from the ledger, never from memory: recorded versions must be a prefix of the package, each carrying this executor's marker, hash and name; a missing `step_end` is reconciled; an incomplete prior run is noted. After every committed step the tool re-reads the ledger, captures the fingerprint again, and probes `public.orders` as `anon` and `authenticated` (must be denied). A mismatch after commit stops the run and reports that it is already committed.

## Known limits
1. Never run against a real hosted project; the hosted transport is tested by refusal paths only.
2. Local PostgreSQL 18 is not hosted 17.6; the fingerprint comparison on 2026-10-18 reduces but does not remove that risk.
3. Three files create or replace policies on `storage.objects` (`20261014120000`, `20261015120000`, `20261015123000`). A hosted-like operator that does not own that table is refused locally. The hosted `postgres` role is not a member of `supabase_storage_admin` (observed); the same statement types ran on this project in `20260723174017`, so it is probably allowed (supautils is loaded), but this needs a rolled-back canary before S5.
4. `statement_timeout` defaults to 120 s per step; the largest file is 39 KB. Hosted data volume may need a larger value.
5. The tool does not deploy Edge Functions, change Storage objects, or run bookkeeping batches.
