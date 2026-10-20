# SG-3 restore point: evidence (AUTH-12A executed by the owner, 2026-10-20)

The owner ran `scripts/dev/sg3/sg3-backup.ps1` against Development only (Session pooler, read-only), typing the database password at the hidden prompt. No credential or passphrase appears in this repository, in chat or in these notes. Production was not involved; Development was not written to.

| Item | Value |
|---|---|
| Restore-point ID | `dev-20261020T1942Z` (folder `C:\Users\vikki\BPC-Backups\dev-20261020T1942Z`, outside Git) |
| Taken (UTC) | 2026-10-20 19:42 |
| Pre-backup ledger (printed by the script, then compared with a separate read of Development) | `ledger|305|20260929161925|72cafdaca438365b30b41db0e7269832cc6591837dc8ef5bb5c01c125e2dd008`; Development re-read after the backup: identical (305 rows, same SHA-256, orders 171, payments 185, payments sum 2,496,274, 500 objects, storage metadata md5 `0a5e03fb61118f07c196b2733cacafb1`, anon without USAGE on `public`) |
| `dev.dump.gpg` (GnuPG AES-256, integrity checked) | 1,038,226 bytes, SHA-256 `10AD145D0EBFBA105459B95438EDFE614BDEDCFC801DE901D30B1EF78193E992` |
| `roles.txt.gpg` (no passwords) | SHA-256 `9E58D0B399A51004B4D6FF01B3397511E940F663647E03BDF09E5D7F70034575` |
| Plaintext dump (hashed through the decrypt pipe, never stored) | `3ec66375edea96a196b9f33429fc2624a380cef0fa7eac3d32a2c6d55c8d58be` |
| Source unchanged during the backup | True |
| Isolated local restore (2026-10-20 19:53:59 UTC, loopback scratch cluster, database dropped afterwards) | `RESULT: PASS` for application data, ledger, fingerprint, Storage metadata and containment: data checks 0 differences outside the extension list, fingerprint 0 differences, `containment|false|false`, `ledger|305|20260929161925|72cafdac…`, `storage_meta|500|941404649|0a5e03fb…`. `pg_restore` exit 1 with 14 error lines, all expected platform limitations (8 `supabase_vault`, 6 event-trigger ownership), 0 unexpected. The only content difference is the `supabase_vault` extension absent locally |
| Passphrase | saved by the owner in Bitwarden; the temporary key folder was deleted and the free space wiped (`cipher /w`) after the proof |

Limits, unchanged from AUTH-3: Storage object bytes are not in the backup (Option A, metadata only); vault ciphertext, platform event triggers, role passwords, Edge Functions and their secrets and dashboard settings are outside it; a local restore does not prove a managed-platform restore (**PARTIAL / NOT PROVEN** for full platform equivalence). The prior point `dev-20261020T1206Z` (58-row ledger, predates S2) was also re-restored by the owner during this session with the old script: PASS, ledger 58 rows.

Valid as the SG-3 restore point until 2026-10-21 07:42 UTC (12 hours, rule D-02). Step-12 checkpoint: Option B (this point; replay steps 1 to 11 if a restore is ever needed).
