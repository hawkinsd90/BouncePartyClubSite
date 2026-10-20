# AUTH-3 execution checklist: encrypted Development backup and isolated restore proof

Status: **AUTH-3 EXECUTED on 2026-10-20 02:45 UTC (owner ran the backup; result in section 13).** Owner decisions: Storage Option A (inventory only), encrypted files in `%USERPROFILE%\BPC-Backups\` under the owner's account, retention until the Development rollout and testing end plus 30 days, passphrase in the owner's password manager (Bitwarden), and **zero unexpected loss of existing Development business data** (section 11). The pipeline was first rehearsed on local scratch data. Production is never involved.

## 1. What AUTH-3 reads from Development (read only)
- Fresh verification: ledger count and SHA-256 (expect 58 rows, `ca686c2d620154142ad9d9908c5c093a16a709df35c1c6860ed65c8bef24b999`), the 11-category schema fingerprint, and the AUTH-1 row counts and financial sums.
- `pg_dump` of database `postgres`: a consistent snapshot of every schema the `postgres` role can read (`public`, `auth`, `storage` metadata rows, `supabase_migrations`, `vault` ciphertext, `extensions`, and platform schemas it can see). Development is about 28 MB, so the dump is small.
- A roles manifest (names, attributes, memberships; **no passwords**) from one `SELECT` on `pg_roles` and `pg_auth_members`.
- The Storage object inventory (500 objects, 941,404,649 bytes, metadata md5 `0260dd1cb6d342f37301be6813be3bf7`), from the database only.
- AUTH-3 writes nothing to Development. It authorizes no push, deployment, migration, function deploy, ledger write or integration change.

## 2. What the backup does NOT contain (constraints on a fully equivalent restore)
| Not captured | Consequence | Mitigation |
|---|---|---|
| Storage object **bytes** (941 MB; 522 MB signed waivers) | restored rows could point at missing files | owner decision, section 6 |
| Role passwords (`pg_authid` is unreadable by `postgres`) | roles are recreated without passwords | local proof only needs the names and memberships |
| Edge Functions and their secrets | not in any database dump | function source is in Git; secrets stay in the provider dashboards |
| Integration and dashboard settings (GitHub, auth providers, JWT secret, SMTP) | not in the database | recorded in `auth1-development-baseline.md`; re-read after any restore |
| Vault key (held by the platform) | `vault.secrets` ciphertext cannot be decrypted elsewhere | acceptable; do not rely on it |
| Platform-owned objects (`supabase_admin`/`supabase_auth_admin`/`supabase_storage_admin` ownership, event triggers, `supabase_vault`, `pg_stat_statements`) | local restore shows ownership and extension errors | classified in section 7 as expected local limitations |
| PostgreSQL 17.6 versus local 18.4 | planner and catalog differences | the dump format is forward compatible; compare data, not plans |
`admin_settings` holds live Twilio and Resend credentials, so the dump itself is secret material: it is only ever stored encrypted.

## 3. Encryption (verified available; nothing installed)
| Tool | Found | Use |
|---|---|---|
| GnuPG 2.4.8 at `C:\Program Files\Git\usr\bin\gpg.exe` (not on PATH) | yes | **chosen**: symmetric AES-256 with integrity check (MDC); a modified file fails to decrypt |
| OpenSSL 3.5.4 at `C:\Program Files\Git\mingw64\bin\openssl.exe` | yes | random passphrase and SHA-256 only (`enc` modes are not authenticated) |
| 7-Zip 18.06 | yes | fallback only: AES-256 is not authenticated; not used |
| `age` | no | not needed; not installed |
Rules: the passphrase is 256 random bits made by `openssl rand -hex 32`, written to a key file in a **separate** directory from the dump, copied into the owner's password manager, then the key file is deleted. The key never appears in Git, chat, command lines or logs (it is read with `--passphrase-file`). The dump is piped from `pg_dump` straight into `gpg` through a `cmd` pipe (binary safe; Windows PowerShell pipes corrupt binary), so **no plaintext dump is written to disk**. Git-for-Windows `gpg` needs POSIX-style paths (`/c/Users/...`) and a private `--homedir`, so the user keyring is never touched.

## 4. Command templates (owner shell; run only after AUTH-3 is approved)
Connection: use the Development **Session pooler** string from the dashboard Connect panel (port 5432, user `postgres.srxunxiytojjsuhcmzjg`); the direct host is IPv6-only and the transaction pooler (6543) is unsuitable for `pg_dump`. The password is typed once into a secure prompt, never written to a file or log.
```powershell
$ErrorActionPreference = 'Stop'
$gpg  = 'C:\Program Files\Git\usr\bin\gpg.exe'
$ssl  = 'C:\Program Files\Git\mingw64\bin\openssl.exe'
$pgb  = 'C:\Program Files\PostgreSQL\18\bin'
function P($x) { '/' + $x.Substring(0,1).ToLower() + $x.Substring(2).Replace('\','/') }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmZ')
$out   = "$env:USERPROFILE\BPC-Backups\dev-$stamp"      # encrypted files only; outside the repository and any synced folder
$keys  = "$env:USERPROFILE\BPC-Backups-Keys\dev-$stamp"  # separate directory for the key file (deleted after it is stored)
New-Item -ItemType Directory -Force $out,$keys,"$out\gnupg" | Out-Null
[IO.File]::WriteAllText("$keys\pass.txt", (& $ssl rand -hex 32))   # store this in the password manager now

# secure password prompt (no echo, no file)
$sec = Read-Host 'Development database password' -AsSecureString
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$env:PGSSLMODE = 'require'
$h = '<session pooler host from dashboard>'; $u = 'postgres.srxunxiytojjsuhcmzjg'

$g = "`"$gpg`" --homedir `"$(P "$out\gnupg")`" --batch --yes --pinentry-mode loopback --passphrase-file `"$(P "$keys\pass.txt")`""
# 1) database dump straight into encryption (no plaintext file)
cmd /c "`"$pgb\pg_dump.exe`" -h $h -p 5432 -U $u -d postgres --format=custom --compress=6 --lock-wait-timeout=60s --verbose 2> `"$out\dump.log`" | $g --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 -o `"$(P "$out\dev.dump.gpg")`""
# 2) roles manifest (no passwords) and ledger export, same discipline
& "$pgb\psql.exe" -X -h $h -p 5432 -U $u -d postgres -At -c "select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls from pg_roles where rolname !~ '^pg_' order by 1" | & cmd /c "$g --symmetric --cipher-algo AES256 -o `"$(P "$out\roles.txt.gpg")`""
# 3) record hashes (encrypted file, and plaintext through a decrypt pipe)
Get-FileHash "$out\dev.dump.gpg" -Algorithm SHA256 | Format-List
cmd /c "$g --decrypt `"$(P "$out\dev.dump.gpg")`" | `"$ssl`" dgst -sha256"
Remove-Item Env:PGPASSWORD, Env:PGSSLMODE
```
The log `dump.log` holds object names only (the password is never printed by `pg_dump`); it is not committed. If the full dump is refused on a platform schema (permission denied), stop and report; the documented fallback is explicit `--schema=public --schema=auth --schema=storage --schema=supabase_migrations` **without widening any privilege**. Do **not** use `--no-owner`, `--no-acl` or `--data-only` for the proof dump (they hide the ownership and privilege categories). `supabase db dump --role-only` needs a running Docker engine (not running here), so the roles manifest above replaces it; report that dependency rather than installing Docker.

## 5. Isolated local restore (proof)
- Target: the loopback-only scratch PostgreSQL (`127.0.0.1:54329`, `listen_addresses = 127.0.0.1`, verified). New database `bpc_auth3_restore`; drop it when the proof ends.
- Pre-create roles from the roles manifest (`anon`, `authenticated`, `service_role`, `authenticator`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user`, `postgres`, and others listed), without passwords and with `NOLOGIN` except where the manifest requires login.
- Restore straight from the decrypt pipe: `gpg --decrypt dev.dump.gpg | pg_restore -h 127.0.0.1 -p 54329 -U postgres -d bpc_auth3_restore --no-password 2> restore.err` (no `--exit-on-error`; every error is logged and classified, no plaintext file).
- No Supabase local stack, no Edge Function runtime, no application pointed at the copy, no network egress. The extension list is `pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp`; there is **no `pg_cron` or `pg_net`**, so no database-side scheduler or HTTP call exists to fire. SMS, e-mail, live Stripe, webhooks, scheduled functions and live-credential workers cannot run because nothing that calls them is started. The restored `admin_settings` credentials and the historical demo master account exist only inside the disposable copy, which is not reachable by any application and is dropped after the comparisons.

## 6. Storage decision (owner chooses; not performed)
| | **Option A: inventory only** (recommended) | **Option B: full encrypted byte copy** (not performed) |
|---|---|---|
| What is kept | the 500 metadata rows inside the dump, plus count/bytes/md5 and a bucket list | A plus every object file |
| Size | nothing extra | about 941 MB (522 MB across 83 signed-waiver files) |
| Protects against | loss of the rows or bucket configuration | the above plus loss of the files |
| Recoverability | rows can be restored; files cannot be rebuilt from our copy | files and rows both recoverable |
| Handling cost | none | downloading needs a service-role key (secret), and signed waivers and signatures are customer personal documents: each copy needs encryption, an access list, a retention date and secure deletion |
| Fit to this rollout | the 28 migration files change bucket SQL/policies only and never delete or update objects (S3 touches bucket configuration) | useful only if the owner regards the signed waivers as irreplaceable |
**Recommendation: Option A now.** If the owner wants extra protection, add a signed-waivers-only encrypted copy later as a separate approval rather than copying everything. The decision stays with the owner.

## 7. Acceptance criteria (all must pass; classify, do not hide, any error)
| # | Check | Expected |
|---|---|---|
| 1 | Ledger count and SHA-256 on the restored copy | 58 rows; hash equals the fresh pre-backup read (`ca686c2d…`), computed with the same method |
| 2 | 11-category schema fingerprint (`DIGEST_ROWS`) | equal to Development on 10 categories; the owner category may differ only for platform roles, and the difference is listed |
| 3 | Object counts: tables, constraints, functions, triggers, policies, indexes, views | equal to Development (67 public tables) |
| 4 | Row counts | 171 orders, 185 payments, 1 pricing rule, 9 auth users, 123 customers, 6 profiles, 9 roles, 16 units, 35 unit media; 47 non-empty public tables, 5,074 rows |
| 5 | Financial aggregates | balance due 1,344,396; deposits paid 856,550; tips 74,928; payments sum 2,496,274 |
| 6 | Storage metadata | 500 rows, 941,404,649 bytes, 9 buckets, md5 `0260dd1cb6d342f37301be6813be3bf7` |
| 7 | Privileges and containment | `anon` and `authenticated` have no USAGE on `public`; no new grants |
| 8 | Extensions | the five extensions present or the exact local error recorded |
| 9 | Restore errors | every line of `restore.err` classified as an expected local limitation (role passwords, platform-owned ownership, `supabase_vault`/`pg_stat_statements` where unavailable, event triggers) or as **data loss**. Any data-loss line fails the proof |
| 10 | Encrypted file | SHA-256 recorded; decrypt reproduces the recorded plaintext hash; a tampered copy fails |
If any check fails: stop; keep only the encrypted files; make no retry with wider privileges; report the failing check; nothing hosted is changed, and no rollout stage starts.

## 8. Where, who, how long (owner confirms)
- Encrypted files: `%USERPROFILE%\BPC-Backups\dev-<UTC stamp>\` (outside the repository and outside any OneDrive/synced folder); key file in a separate directory, then password manager only.
- Access: the owner's Windows account only.
- Retention (owner decision): until the Development rollout and integration testing end, plus 30 days. Do not delete, move, overwrite or modify the existing backup before then; afterwards delete the encrypted files and the password-manager entry.
- A second encrypted copy on external media is **recommended but NOT confirmed**; it is an optional resilience measure, not a completed operation.
- NTFS deletion is not a secure wipe; the design avoids plaintext on disk for that reason. Full-disk encryption (BitLocker) status is not verified here.

## 9. Local rehearsal evidence (scratch data only, no hosted access)
`pg_dump | gpg` of the local template `bpc_replay_e2i_devbase` produced a 143,034-byte encrypted file; decrypting through a pipe gave a stable plaintext SHA-256; `gpg --decrypt | pg_restore` into a new database exited 0 with an identical 58-row ledger hash; a one-byte modification and a wrong passphrase each made decryption fail ("encrypted message has been manipulated"); the scratch database and files were deleted. This proves the Windows pipeline, not Development.

## 10. Prohibitions
No hosted write; no restore against Development or Production; no managed-backup Restore or Download click; no Storage download; no Production query; no `--include-all`/`db push`; no plaintext dump file; no secret in Git, chat or logs; no integration toggle, Netlify change, push, merge, deployment or migration.

## 11. Owner decisions (recorded)
1. Storage: **Option A, inventory only** (no object bytes are copied).
2. Encrypted-file location and access: `%USERPROFILE%\BPC-Backups\`, the owner's Windows account.
3. Retention: rollout and testing end plus 30 days.
4. **Data-loss rule: ZERO unexpected loss of existing Development business data** (orders, payments, balances, deposits, customer and authentication records, migration history, pricing and equipment records, other application data). This replaces earlier wording that implied some loss was acceptable; no loss is pre-accepted. A failed recovery stops and is investigated, never silently accepted. If a restore from a backup were ever needed, it would discard changes made after that backup, so a fresh backup is taken immediately before any stage that could need it and the owner decides at that moment, with the evidence in front of them.
5. The passphrase lives only in Bitwarden; it is never copied into an audit record, chat or Git.

## 12. Owner run sheet (`scripts/dev/auth3/auth3-backup.ps1`, rehearsed locally in both modes)
1. Backup (prompts for the Development database password; reads Development only; aborts if the ledger differs from the AUTH-1 baseline): `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\devuth3uth3-backup.ps1 -Mode Backup -DbHost <Development Session pooler host>`
2. Copy the printed key file into your password manager, then delete it.
3. Restore proof (local loopback scratch cluster only; the script aborts if it is not loopback-only or if the hashes differ): `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\devuth3uth3-backup.ps1 -Mode Restore -OutDir <printed backup folder> -KeyFile <key file>`
4. Send me the printed output (it contains counts, md5 values and error lines, no secrets). I classify the errors and record the AUTH-3 result. Pass criteria: data-check differences 0, fingerprint differences 0 (or only listed platform-owner differences), containment `false|false`, every error line a documented local limitation.
Rehearsal on the local scratch database: both modes passed (restore exit 0, 0 error lines, 0 data differences, 0 fingerprint differences, containment false|false).

## 13. AUTH-3 RESULT (2026-10-20), classified
**Backup:** created by the owner at 2026-10-20 02:45 UTC from Development only (Session pooler, us-east-1). Pre-backup ledger 58 rows, newest `20260929161925`, SHA-256 `ca686c2d620154142ad9d9908c5c093a16a709df35c1c6860ed65c8bef24b999` (equals the AUTH-1 baseline); the hosted source was unchanged across the backup (the same checks before and after were identical). Folder `C:\Users\vikki\BPC-Backups\dev-20261020T0245Z` (inherits the owner's user-profile ACL: the owner, SYSTEM and local administrators).
| File | Size / SHA-256 |
|---|---|
| `dev.dump.gpg` (GnuPG 2.4.8, symmetric AES-256, integrity-checked) | 1,018,157 bytes; `BBD648375A6D51BC5C4B518E0BBC24566B8F79E039783CA13AFF3AFC6AA3832A` |
| `roles.txt.gpg` | `8FCB9562A91336AE07AD9BDAD5F95911013A37DEC8359DD9ACA93621399A1913` |
| plaintext dump (hashed through the decrypt pipe; never stored) | `623ec4a5a0cc36090a2a45a9f4920a21d38f9b081e0cd603bac93facb1e6dafa` |
No plaintext dump was written to disk. The passphrase was saved in Bitwarden by the owner and the temporary key folder was removed; no passphrase appears in any record. Not done: a second encrypted copy on external media (recommended, unconfirmed).

**What was run and what the first result was.** The first local restore reported `pg_restore` exit 1, 14 errors and **98 content differences**; it was not a pass. The differences were a measurement artefact: the content checks formatted timestamps in the local Windows time zone while the hosted read ran in UTC. After the checks were pinned to UTC the restore was re-run from the same encrypted backup.

| Area | Result | Basis |
|---|---|---|
| Application and business data | **PASS** | row counts and content md5 identical for all 67 public tables, including orders (171), payments (185), customers, pricing and equipment records, in the UTC-normalized rerun |
| Authentication data | **PASS** | `auth.users` and `auth.identities` counts and content md5 identical |
| Migration history | **PASS** | 58 rows, newest `20260929161925`, SHA-256 equals the original Development ledger |
| Schema fingerprints | **PASS** | 11 categories, 0 differences (same search_path method as AUTH-1) |
| Financial aggregates | **PASS** | implied by the identical orders/payments content hashes (balance due 1,344,396; deposits paid 856,550; tips 74,928; payments 2,496,274 are the AUTH-1 values) |
| Storage metadata | **PASS** | `storage.objects` and `storage.buckets` rows identical: 500 objects, 941,404,649 bytes, 9 buckets. **Object bytes are NOT in the backup** (Option A) and are not recoverable from it |
| Security containment | **PASS** | `anon` and `authenticated` lack USAGE on `public` in the restored copy |
| Extensions | **PARTIAL** | `supabase_vault` cannot exist in a stock local PostgreSQL; the other four extensions are present |
| Local PostgreSQL restore as a whole | **PARTIAL** | `pg_restore` exit 1: 14 errors, all in two classes: 8 from `supabase_vault` (extension, `vault.secrets`, its functions and view; ciphertext whose key the platform holds) and 6 `permission denied to change owner` for platform event triggers (`issue_graphql_placeholder`, `issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`, `pgrst_ddl_watch`, `pgrst_drop_watch`) |
| Full managed-Supabase restoration equivalence | **NOT PROVEN** | not demonstrable on a local PostgreSQL: vault contents, platform event triggers, role passwords, Edge Functions and their secrets, integration settings and Storage bytes are outside this proof |
**Is that acceptable for continuing?** Yes for continuing the Development recovery, for these reasons: every business table, the authentication tables, the migration ledger and the Storage metadata are proven recoverable byte for byte; the 14 errors touch only objects the platform owns and that none of the 28 migration files modifies; and Supabase's own daily physical backups (seven listed, latest 2026-10-19 10:56:30 UTC, Restore offered, **not tested**) cover the platform-level objects. It is **not** a proof that a full platform restore would be seamless, and nothing here claims that.

**Script, hashes and logs.** `scripts/dev/auth3/auth3-backup.ps1` was reviewed after the run (section 14). The restore log of the first run was written into the backup folder as `restore.err` (overwritten once by the rerun); no backup artifact was altered. Hash verification of the encrypted file against `hashes.txt` is part of the restore mode.
Open follow-ups: second encrypted copy (optional); G-25 (Development production-branch field must be re-entered as `Dev` before automatic migrations are restored); managed-backup restore untested; Netlify builds-active, PITR and compute size unverified. AUTH-3 authorized no hosted write, push, deployment or migration, and none occurred.

## 14. Script review (2026-10-20, after the run)
Reviewed against the 14 required properties; fixed only defects tied to AUTH-3:
| Property | Finding | Action |
|---|---|---|
| Development-only source | the baseline ledger check implied it; no explicit guard | added a guard that refuses any user not ending `.srxunxiytojjsuhcmzjg` or containing the Production reference; tested (refused, exit 1) |
| No plaintext dump; encrypted custom format | confirmed (`pg_dump --format=custom` piped into `gpg`) | none |
| Pipe exit codes | `cmd` returns only the last command of a pipe, so a failing `pg_dump` could have produced a truncated encrypted file | now scans `dump.log` for `pg_dump: error/fatal`, proves the decrypted stream with `pg_restore --list`, and checks the roles manifest decrypts and is non-empty; the roles exit code is read before cleanup |
| No password/passphrase exposure | password was typed, never logged; the buffer was not zeroed; the key file is read through `--passphrase-file` | zeroes the password buffer; nothing else needed |
| Owner-only location | relied on inherited permissions | new backup and key folders are restricted to the owner account (`icacls`), tested; the existing backup was not touched |
| Integrity checks | hash comparison existed | unchanged; tamper test (one flipped byte) aborts with a hash mismatch |
| Isolated restore | checks loopback `listen_addresses` | unchanged |
| UTC normalization | added in the rerun | kept (`SET TimeZone = 'UTC'`) |
| Error classification | errors were only printed | restore errors are classified automatically (vault, platform event-trigger owner = expected; anything else UNEXPECTED fails the run); content differences outside the extension list fail the run; the run prints PASS only with the full set of criteria and PARTIAL/NOT PROVEN wording, otherwise FAIL (exit 1) |
| No hosted destructive operation | reads only | none |
| Storage metadata only | confirmed | none |
| Retained backup protection | restore mode wrote `restore.err` into the backup folder | logs now go to `%USERPROFILE%\BPC-Backups-Logs\restore-<UTC>`; restore mode writes nothing into the backup folder |
Local scratch rehearsal after the fixes: backup and restore modes both pass (restore exit 0, 0 errors, 0 content and 0 fingerprint differences, containment false|false); the Production-user guard and the tamper test both abort. The real Development backup was not re-run.
