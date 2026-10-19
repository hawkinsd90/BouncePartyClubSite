# Development backup options (Decision 2)

> **Step 4A.5: the owner selected the combined approach** (managed-backup check, encrypted `pg_dump -Fc` immediately before the first authorized hosted database migration, local restore proof, retention until deployment and integration testing end, no PITR, Storage bytes accounted separately). D-02 = STRATEGY APPROVED - EXECUTION AND RESTORE VERIFICATION PENDING. The exact commands, storage requirements and pass criteria are in `d02-restore-point-procedure.md`. The comparison below is retained as the basis for that choice.

Nothing was purchased, enabled, created, deleted or restored. Facts are tagged **[LIVE]** (read-only observation 2026-10-19), **[DOCS]** (current Supabase documentation), **[QUOTE]** (price quoted by the Supabase connector, read-only) or **[INFERRED]**.

## 1. What the rollout needs from a backup
The 28 migration files change schema, policies and grants and write a ledger row each; the Step 2 bookkeeping writes about 280 ledger rows; the rollout does **not** delete or rewrite any Storage object (grep of all 28 files). A recovery therefore has to bring back **the database as it was before S2**: all `public` data, `auth.users`, Storage *metadata*, and above all the exact 58-row migration ledger. Edge Function code is already in Git (plus a P0 download of each hosted version before it is overwritten).

## 2. Facts about this Development project
| Fact | Value |
|---|---|
| Plan | Pro [LIVE] |
| Compute | looks like **Micro** (`max_connections 60`, `shared_buffers 256MB`) [INFERRED] |
| Database size | 27 MB (`public` 7.3 MB, `auth` 4.9 MB, Storage metadata 1.3 MB, ledger 0.2 MB) [LIVE] |
| Data | 171 orders, 185 payments, 9 auth users (copied Production data) [LIVE] |
| Storage objects | 500 objects, about 898 MB in 8 buckets (signed-waivers 498 MB, public-assets 223 MB, unit-images 104 MB, lot-pictures 60 MB, others under 10 MB) [LIVE] |
| WAL archiving | on, WAL-G push command, `wal_level logical`, 0 replication slots [LIVE]. **This does not prove that a backup or a usable restore point exists.** |
| Backup list, PITR state | not readable with any available tool |
| Quote: new project | USD 10 per month recurring [QUOTE] |
| Quote: a Supabase branch | USD 0.01344 per hour [QUOTE] |

## 3. Comparison
| | A. Supabase managed daily backups | B. Manual logical backup + locally verified restore | C. Point-in-time recovery (PITR) | D. Combination |
|---|---|---|---|---|
| **Available on this plan** | Yes on Pro; last 7 daily backups [DOCS]. Whether the backups exist is unverified. | Yes, today, with no plan dependency. Docker is installed locally, so `supabase db dump` works; `pg_dump` also works | PITR is an add-on for Pro [DOCS]; needs at least **Small** compute [DOCS], so Micro compute must be upgraded first | A + B (recommended) |
| **Extra cost** | Included in Pro [DOCS] | None | About USD 100/month for 7-day retention, billed hourly (USD 0.137/h); not covered by the spend cap; plus the Small compute step (USD 15/month in the docs example) [DOCS] | None |
| **Database contents** | Whole database, physical: every schema [DOCS] | Whatever you dump. `supabase db dump` **excludes** `auth`, `storage` and extension schemas and dumps no data or custom roles unless asked [DOCS]; use `--schema` and `--data-only` flags or plain `pg_dump` | Whole database to any second in the window [DOCS] | A for full coverage, B for a file you hold |
| **Migration ledger** | Restored with the database to the backup moment [DOCS] | Only if you include schema `supabase_migrations` (the docs show `--schema supabase_migrations`) | Restored to the chosen second | Both |
| **Supabase Auth** | Included (`auth` schema is in the database) | Only if dumped explicitly (`--schema auth`); password hashes are in `auth.users`, so encrypt the file | Included | Both |
| **Storage** | Metadata rows only; **objects are not backed up or restored** [DOCS] | Metadata rows only if `storage` is dumped; objects not | Metadata only | Not covered by any DB backup. The rollout does not change objects |
| **Edge Functions and secrets** | Not included. Deployed versions can be newer than the restored database | Not included | Not included | Download each hosted function version at P0; secrets stay in the owner's vault (names only here) |
| **Custom role passwords** | Not stored; reset after a restore [DOCS] (relevant: expired `cli_login_postgres`) | Roles-only dump excludes reserved roles | Same as A | |
| **Recovery time** | In-place restore makes the project inaccessible while it runs; longer for bigger databases [DOCS]. For 27 MB expect minutes, but the platform gives no figure | Manual and partial: re-create/replace objects yourself. Hours, not minutes, and only for tables you dump | Same downtime behavior as A | A for fast full recovery, B for surgical |
| **Potential data loss** | Everything since the last daily backup (up to 24 h; age unknown) [DOCS] | Everything since the dump (taken immediately before S5 and S7: minutes) | About 2 minutes in the worst case [DOCS] | Minutes |
| **Validation without altering Development** | Restore the newest backup into a **new project** ("restore to a new project", paid plans with physical backups) [DOCS], then run the read-only checks, then delete it. Cost: a new project, quoted USD 10/month [QUOTE], so hours cost cents (proration not confirmed) | Restore the dump into a **local** scratch database and compare. **Rehearsed locally on 2026-10-19:** a custom-format `pg_dump` of the Development-shaped scratch database restored with identical migration ledger (60 rows, same hash) and an identical catalog fingerprint (owners preserved). Restoring with `--no-owner` changed only the schema-owner category | Restore to a new project to a chosen second | Both |
| **Advantages here** | Free; whole-database; includes Auth and the ledger; nothing to manage | Free, fast (27 MB), under your control, proves a restore works without any platform feature, rehearsed | Seconds of loss | Covers fast full recovery and a file you can verify |
| **Disadvantages here** | Age and existence unverified; restore wipes Development-only changes since the backup; Storage/functions not covered; validation needs a paid temporary project | Not a platform restore: re-importing into the live project is manual; contains customer data and password hashes (encrypt, keep out of Git); Docker needed for the CLI route | Costs the most; needs a compute upgrade (restart) first; protects a 27 MB, single-tester database; enabling it stops daily backups; window starts when enabled, not before | Slightly more owner effort |

## 4. Recommendation
**Least complex reliable option: managed daily backup check plus ONE verified `pg_dump -Fc` file, no PITR.** The owner is the only user and temporary downtime is acceptable, so the simplest dependable setup is: confirm a recent managed backup exists (free, one page view), take a single custom-format dump immediately before the first database step, restore it into a local scratch database to prove it works (free, rehearsed), and record its SHA-256. The six-file `supabase db dump` variant below is optional detail, not a requirement. Nothing is bought, enabled, created or restored by this document.
Detail, **D without PITR:** (1) owner reads the dashboard backup list and confirms a backup under 12 hours old exists (free); (2) a manual logical backup (schema, data including `auth` and `supabase_migrations`, roles) taken immediately before S5 and again before S7, stored encrypted outside Git, with its SHA-256; (3) validation by restoring that dump into a **local** scratch database and comparing ledger and fingerprint (free, rehearsed); (4) optionally, validation of the platform backup by restoring it into a temporary project (cents to a few dollars).
Why not PITR now: the database is 27 MB, the owner is the only user, an hour of data is not at stake, and PITR costs about USD 100/month plus a compute upgrade. Revisit before Production.
Commands for the owner (run from a shell holding the connection string; nothing is run here):
```bash
supabase db dump --db-url "$DEV_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$DEV_DB_URL" -f schema.sql
supabase db dump --db-url "$DEV_DB_URL" -f data.sql --use-copy --data-only
supabase db dump --db-url "$DEV_DB_URL" -f ledger.sql --schema supabase_migrations
supabase db dump --db-url "$DEV_DB_URL" -f ledger_data.sql --use-copy --data-only --schema supabase_migrations
supabase db dump --db-url "$DEV_DB_URL" -f auth_data.sql --use-copy --data-only --schema auth
# or one custom-format file for the local restore proof: pg_dump "$DEV_DB_URL" -Fc -f dev.dump
sha256sum *.sql dev.dump > backup.sha256
```
Local restore proof: create a scratch database, `pg_restore --exit-on-error` the custom dump (roles `supabase_*` must exist locally, as they do in the scratch cluster), then compare the ledger export and the read-only fingerprint statement with the pre-rollout values.

## 5. What the owner must approve
1. The method: D without PITR (or name another).
2. Reading the Backups page (and recording timestamps) and storing the encrypted dumps (where, and who can read them).
3. Whether to spend a few dollars on the optional restore-to-new-project validation.
4. The statement of what Development-only data may be lost.
5. Not enabling PITR now (or approving its cost and the compute upgrade).
D-02 stays **BLOCKED** until items 1, 2 and 4 are recorded and the local restore proof has run on the owner's dump.
