# D-02: Development restore point (owner-executable procedure)

**Status: STRATEGY APPROVED — EXECUTION AND RESTORE VERIFICATION PENDING** (owner decision, Step 4A.5; see the last section). The owner has not authorized taking the hosted backup, modifying Development, or starting Step 4B. The earlier text below is kept as history: where it says BLOCKED it means "no usable restore point has been proven yet". Nothing here was created, deleted or restored.

## What is known (read-only, 2026-10-18)
| Fact | Source | Provenance |
|---|---|---|
| Organization "Bounce Party Club" is on the **Pro** plan | Supabase organization lookup | [LIVE] |
| Project `srxunxiytojjsuhcmzjg` ("Bounce Party Club Dev"), PostgreSQL 17.6, region us-east-1, ACTIVE_HEALTHY | project lookup | [LIVE] |
| Ledger: 58 rows, max `20260929161925`; the restore must reproduce this ledger exactly | catalog | [LIVE] |
| The Supabase project has a branch record "Dev" linked to Git branch `Dev` (see `d03-netlify-and-integration-control.md`) | branch lookup | [LIVE] |
| Daily backups exist on Pro (retention is a platform plan feature, documented as 7 days); point-in-time recovery is a separate paid add-on | Supabase documentation, not verified for this project | [ASSUMED] |
| Whether daily backups ran, their timestamps, whether PITR is enabled | no read-only tool | **UNKNOWN** |
| Storage objects (the files) are **not** part of a database backup or restore; only the Storage metadata rows are | Supabase documentation | [ASSUMED] |

## What the 28 files do to Storage (so a restore stays safe)
Read from the files: they change `storage.buckets.public` for 5 buckets, insert the `order-evidence` bucket and replace policies on `storage.objects`. None contains `DELETE`, `UPDATE` or `INSERT` on `storage.objects` rows (grep of all 28 files), so no object is removed or renamed by Step 4B. A database restore therefore does not orphan files created by the rollout.

## Owner procedure
1. **Identify capability.** Dashboard > project `srxunxiytojjsuhcmzjg` > Database > Backups. Record (text, no screenshots of secrets): the list of scheduled backups with their UTC timestamps; whether the "Point in time" tab shows PITR enabled and its recovery window; the project's compute add-ons if shown.
2. **Decide the restore point.**
   - If PITR is enabled: note the current time as the restore point `rp-S5` immediately before stage S5 (and `rp-S7` before S7); PITR can restore to any second in the window.
   - If only daily backups exist: the newest backup must be **less than 12 hours old** at the start of S5 and no later than the start of the rollout window; if not, take a manual logical dump (step 3).
3. **Manual logical backup (always recommended, read-only on the project).** From the owner's machine, with the project's database connection string kept in the shell only:
   ```bash
   supabase db dump --db-url "$DEV_DB_URL" -f dev_roles.sql --role-only
   supabase db dump --db-url "$DEV_DB_URL" -f dev_schema.sql
   supabase db dump --db-url "$DEV_DB_URL" -f dev_data.sql --data-only --use-copy
   sha256sum dev_*.sql > dev_backup.sha256
   ```
   Store the files encrypted outside Git (they contain customer data copied from Production). Record the SHA-256 list and the UTC time. `supabase db dump` only reads.
4. **Prove recoverability locally (no hosted change).** Restore the schema and data dumps into a scratch local database (`pg_restore`/`psql` into a `bpc_*` scratch database), then compare: the ledger export (version, name, md5(statements)) with the pre-rollout export; table row counts for `orders`, `payments`, `customers`, `order_items`; and the executor's fingerprint (`captureFingerprint` equals the sealed start fingerprint after the two S3 bucket updates). Keep the comparison output.
5. **Ledger consistency record.** Before S5 save the ledger export (Q01) and its SHA-256. After any restore the ledger, schema, buckets and function versions can disagree: compare the post-restore ledger export with this file and resume only from the earliest stage whose evidence no longer holds (`rollback-and-recovery-plan.md`).
6. **Development-only data.** The restore discards everything written after the restore point. Before S5 the owner states whether Development holds data that exists nowhere else (test orders, test users, uploaded test media). If yes, list the tables and include them in the dump; for Storage objects, list counts per bucket (`SELECT bucket_id, count(*) FROM storage.objects GROUP BY 1`, read-only) and copy irreplaceable files separately.
7. **Optional rehearsal of a real restore.** If the plan allows "restore to a new project", restoring the newest backup into a **new, separate** project and running the read-only fingerprint query there proves the backup is usable without touching the Development project. This costs money and creates a project; it is the owner's call.
8. **Authorization input.** The hosted authorization document (`audit/step4/executor/README.md`) requires `restore_point {id, taken_at_utc}` taken before `approved_at`; use the PITR timestamp or the manual dump's UTC time.

## Stop conditions
- No PITR, no backup newer than 12 hours, and no manual dump with a local restore proof: **D-02 stays blocked; do not start S5.**
- The local restore proof shows a ledger or fingerprint difference: stop and investigate before any rollout.
- The owner cannot state what Development-only data may be lost.

## What this does not claim
It does not claim that a restore of this project has been tested, that the Pro plan's backups actually ran, or that PITR is on. Those are unknown until the owner reads the dashboard.


---

## Step 4A.2 update (2026-10-18): what read-only evidence now proves, and the exact owner steps

**D-02 stays BLOCKED.** Nothing below makes a backup usable as a restore point; only the owner's dashboard evidence plus one validation does.

### Newly verified (read-only)
| Fact | Evidence | What it means |
|---|---|---|
| WAL archiving is running: `archive_mode = on`, `archive_command = /usr/bin/admin-mgr wal-push ...` (WAL-G), `wal_level = logical`, no replication slots | catalog settings query | The platform's physical-backup machinery is active on this database. It does **not** prove that a daily backup exists, how old it is, or that PITR is enabled. |
| Plan is Pro | organization lookup | Pro retains the last 7 daily backups (Supabase documentation). |
| `cli_login_postgres` exists (a member of `postgres`, `VALID UNTIL 2026-10-16 18:00 UTC`, so expired) | role catalog | A restore from a daily backup does not carry passwords of custom roles (documentation); expect to reset any such role afterwards. SEC-038. |
| Replication slots: 0 | catalog | The documented requirement to drop subscriptions/slots before a restore does not apply. |

### What the documentation says a restore does (Supabase "Database Backups")
- Restores the **whole database** to the backup moment: all schemas, `auth.users`, Storage **metadata** and `supabase_migrations.schema_migrations`. The ledger therefore returns to exactly the backup-time rows (58 rows if the backup is from before S2). Nothing is "reconciled" by a restore; compare, then resume from the earliest stage whose evidence no longer holds.
- The project is **inaccessible** during the restore; downtime grows with database size.
- **Not** restored: Storage objects (files), deployed Edge Functions, Edge Function secrets, dashboard settings and integrations. After a restore, deployed function versions can be newer than the database; the runbook's function matrix and the P0 preflight handle that.
- **Enabling PITR turns off daily backups** (documentation). PITR is a paid add-on (about USD 100 / 200 / 400 per month for 7 / 14 / 28 days, billed per hour), needs at least the Small compute add-on, and is not covered by the spend cap. Decide this deliberately; do not enable it only to "check".
- "Restore to a new project" (project duplication) exists for paid plans with physical backups. It creates a separate project and costs money.

### Owner dashboard steps (labels may differ slightly; take notes in text)
1. Open the project `srxunxiytojjsuhcmzjg` > **Database > Backups**.
   - **Scheduled backups** tab: write down every listed backup's UTC date and time. Needed: at least one backup **newer than 12 hours** at the start of S5, and not older than the rollout window start.
   - **Point in time** tab: record whether PITR is **enabled**, the earliest and latest recovery points, and the retention.
2. **Project Settings > Add-ons**: record the compute size and whether the PITR add-on is on.
3. **Restore method available**: record which of "Restore" (in place) and "Restore to a new project" the dashboard offers for the newest backup. Do **not** click either now.
4. Record in your own notes (nothing secret): the answers to 1-3, the date, and your name.

### Validating a restore before the rollout (choose one; both leave the Development project untouched)
- **A. Restore to a new project (preferred if the plan allows it; costs money).** Restore the newest backup into a new, separate project. In that project run, read-only, (i) `SELECT count(*), max(version) FROM supabase_migrations.schema_migrations` (expect 58 rows and max `20260929161925` if the backup predates S2) and (ii) the fingerprint statement `READ_ONLY_STATEMENT` from `scripts/dev/hosted-executor/lib/fingerprint.cjs` and compare it with the sealed start fingerprint (before S3 only the `bkt` category differs). Then delete the extra project.
- **B. Logical dump and local restore (free).** `supabase db dump` (schema, data, roles) with checksums, restored into a **local** scratch database, then the same two checks. This proves your dump, not the platform backup.
- **PASS:** the newest scheduled backup is under 12 hours old (or PITR is enabled with a recovery window covering the rollout), AND validation A or B reproduced the 58-row ledger and the expected fingerprint, AND the owner has stated what Development-only data would be lost.
- **FAIL / stay blocked:** no backup under 12 hours and no PITR; or validation not done; or the ledger or fingerprint differs; or the owner cannot state what data may be lost.

### Development-only data and migration history
- A restore discards everything written to Development after the backup, including test orders and users. State before S5 whether any such data matters; if yes, dump those tables first (`d02` step 3 above).
- The ledger is restored with the database, so history cannot end up ahead of the schema. Edge Functions can (see above).
- Protect the evidence: save the ledger export (version, name, md5(statements)) and its SHA-256 at the time of the restore point.


---

## Step 4A.3 (2026-10-19): method selection
Decision 2: no method chosen. The full comparison of Supabase managed backups, a manual logical backup with a locally verified restore, PITR and a combination, with verified plan, size, cost quotes and a local restore rehearsal, is in `backup-options-comparison.md`. Recommendation there: managed-backup check + manual logical dump verified by a local restore, no PITR. **D-02 stays BLOCKED** until the owner records the method, the dashboard backup list, and the Development-only-data statement, and the local restore proof runs on the owner's dump.


---

## Step 4A.5 (2026-10-19): owner decision recorded and the pre-deployment backup procedure prepared

**D-02 = STRATEGY APPROVED — EXECUTION AND RESTORE VERIFICATION PENDING.** Nothing in this section was run. No hosted connection, dump, restore, purchase or setting change occurred in Step 4A.5.

### Approved strategy (owner)
1. Verify an existing recent Supabase **managed** Development backup (dashboard read only).
2. Immediately **before the first authorized hosted database migration**, create one **encrypted manual `pg_dump -Fc` backup**.
3. Prove that dump restores in an **isolated local PostgreSQL** database.
4. Validate ledger integrity, schema and critical data after that restore.
5. Retain the backup securely until Development deployment **and** integration testing are complete.
6. **No PITR** (not purchased or enabled).
7. Account **separately** for Storage object bytes (not in any PostgreSQL backup).

### Approvals still required before anything runs (each separate, none given)
| # | Approval | Why |
|---|---|---|
| 1 | Reading the dashboard Backups page and recording timestamps | confirms a managed backup exists and its age |
| 2 | Taking the hosted dump at a named UTC time, using a connection string you hold | a hosted connection (read-only `pg_dump`, brief share locks) |
| 3 | Where the encrypted dump is stored and who can read it | it contains copied customer data and password hashes |
| 4 | The local restore proof and its pass criteria (below) | gate before the first hosted change |
| 5 | The Storage accounting choice (inventory only, or a byte copy) | see below |
| 6 | What Development-only data may be lost on a restore | defines the loss tolerance |
| 7 | Starting Step 4B itself | not requested |

### Step 1: managed backup check (owner, dashboard, text notes only)
Dashboard > project `srxunxiytojjsuhcmzjg` > Database > Backups > Scheduled backups. Record every UTC timestamp. Needed: the newest is under 12 hours old at the start of the window, or take the manual dump at the start of the window and treat the managed backup as the second copy. Do not click Restore.

### Step 2: exact pre-deployment backup commands (for later authorization; not run)
Run from the owner's machine, in one shell, with the session-pooler connection string in an environment variable that is never written to a file or pasted into chat. The client tools must be PostgreSQL 17 or newer (the server is 17.6).
```bash
# 0. read-only snapshot of the migration ledger, compared later (must show 58 rows, max 20260929161925)
psql "$DEV_DB_URL" -Atc "select version||'|'||coalesce(name,'')||'|'||md5(coalesce(array_to_string(statements,E'\n'),'')) from supabase_migrations.schema_migrations order by version" > ledger-before.txt
sha256sum ledger-before.txt > ledger-before.sha256

# 1. the backup: custom format, all schemas the postgres role can read, ACLs and owners kept
pg_dump "$DEV_DB_URL" --format=custom --compress=6 --verbose --lock-wait-timeout=60s --file=dev-pre-rollout.dump 2> pg_dump.log

# 2. roles (names and memberships only; passwords of custom roles are not restorable from Supabase)
supabase db dump --db-url "$DEV_DB_URL" --role-only -f dev-roles.sql

# 3. integrity record
sha256sum dev-pre-rollout.dump dev-roles.sql > dev-backup.sha256
pg_restore --list dev-pre-rollout.dump > dev-toc.txt
```
If `pg_dump` is refused on a platform-owned schema, do not widen privileges. Fall back to the explicit list `--schema=public --schema=auth --schema=storage --schema=supabase_migrations`, record that the fallback was used, and note the schemas that are then absent.

### Encrypted storage requirements
- Encrypt before the file leaves the working folder: `gpg --symmetric --cipher-algo AES256 dev-pre-rollout.dump` or `7z a -p -mhe=on` (the passphrase is kept in the owner's password manager, never in Git, chat or the repository).
- Store in a folder that is **outside the repository** and outside any cloud-synced public share, readable only by the owner; keep one offline copy (external drive) if the folder is cloud-synced.
- Keep the plain `.dump` only for the local restore proof, then delete it; keep the encrypted file, `dev-backup.sha256`, `ledger-before.txt` and `pg_dump.log`.
- Record the SHA-256 of both the plain and the encrypted file and the UTC time. Keep the backup until Development deployment **and** integration testing finish, then decide retention (it holds customer data).

### Step 3: local restore verification (no hosted change)
1. Use the scratch PostgreSQL cluster (roles `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin` must exist, as in the Step 4 scratch template).
2. `createdb bpc_restore_verify`, then decrypt a **copy** of the encrypted file and run `pg_restore --exit-on-error --dbname=bpc_restore_verify dev-pre-rollout.dump`. Restoring with `--no-owner` is not accepted for the proof: the earlier local rehearsal showed it changes the schema-owner category.
3. Compare to the hosted values captured before the dump.

### Success criteria (all must hold)
| Check | Pass |
|---|---|
| Dump and encrypted copy | SHA-256 recorded; decrypt of the stored copy equals the plain file |
| `pg_restore` | exit code 0, no errors in the log |
| Ledger | restored `supabase_migrations.schema_migrations` export equals `ledger-before.txt` byte for byte (58 rows, max `20260929161925`) |
| Fingerprint | the read-only catalog fingerprint (`scripts/dev/hosted-executor/lib/fingerprint.cjs`) run on the restore equals the one run on hosted Development at dump time, per category |
| Critical data | row counts equal the hosted counts for `orders` (171 at last read), `payments` (185), `auth.users` (9), `customers`, `customer_profiles`, `units` (16), `unit_media` (35), `pricing_rules` (1), `admin_settings`, `storage.objects` (500 metadata rows); and sums of `orders.balance_due_cents` and of payment amounts equal |
| Containment | `anon` and `authenticated` still have no USAGE on schema `public` in the restore |
| Storage | the inventory in the next section was captured |
Any difference: stop. D-02 is then not satisfied and nothing hosted proceeds.

### What is and is not recoverable from the manual dump
| Recoverable | Not recoverable from it |
|---|---|
| All database tables and their data in the dumped schemas, including `auth.users` (with password hashes), Storage **metadata rows**, the migration ledger, functions, triggers, policies, grants, owners | **Storage object bytes** (about 898 MB, 500 objects); deployed Edge Functions and their secrets; dashboard and integration settings; Netlify; custom role passwords; anything written after the dump |

### Storage object bytes (accounted separately)
The 28 migration files never delete or update objects (grep of all 28 files), so the rollout is not expected to alter bytes. Account for them in one of two ways (owner chooses):
- **Inventory only (recommended):** read-only list of `storage.objects` per bucket (count, total size, and a hash over names, sizes and etags), taken at dump time and again after the rollout; equal inventories prove nothing changed. This needs only a SELECT.
- **Byte copy (optional):** download the buckets with the Storage API or `supabase storage cp` (about 898 MB; `signed-waivers` alone is about 498 MB of customer documents, so it falls under the same encryption rules). Needed only if the owner cannot recreate these files from Production.

### Managed backup, restate
The managed daily backup is the second copy for the database. It does not cover Storage bytes, functions or secrets, and PITR is not used. The earlier local rehearsal (a dump and restore of the **scratch replica** with an identical 60-row ledger and fingerprint) is a rehearsal only: it is not a backup of Development and does not satisfy D-02.
