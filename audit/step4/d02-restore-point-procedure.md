# D-02: Development restore point (owner-executable procedure)

**Status: BLOCKED.** Backup capability cannot be verified read-only from this environment. Nothing here was created, deleted or restored. Step 4B cannot start until the owner records the evidence below (stage S0).

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
