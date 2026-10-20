# SG-2 (S3 + S4 + S4b): preparation status and consolidated authorization draft (2026-10-20)

Status: **PREPARED AGAINST THE ACTUAL POST-S2 STATE. NOT AUTHORIZED. NOT EXECUTED.** AUTH-10 (S2) succeeded: the Development ledger is **303 rows, `b4f1f35ef890f200286199c84d0b3b76659453ba11ed20cac980b4bf3f828176`** (verified 2026-10-20). Order is the runbook's: S3, then S4, then S4b. Production is outside this package.

## 0. Read-only preparation results (2026-10-20, after S2)

- **Ledger prediction after S3** (run read-only on the real 303-row ledger with the two `executed` rows added): after B23 **304 rows `3c31b2a2cc1933212c1aa448033d383312324c795b0d8bba747821d5642e203a`**; after B24 **305 rows `72cafdaca438365b30b41db0e7269832cc6591837dc8ef5bb5c01c125e2dd008`**. Neither version exists in the ledger today.
- **Bucket preflight:** `carousel-media` and `public-assets` both have `file_size_limit` NULL and `allowed_mime_types` NULL (the values the reversal scripts restore). `storage.objects` has the same 6 policies (digest `b9eed816057e02092ab2eb4f563f3b6d`).
- **Triggers on `storage.buckets` (the runbook asked to read them first):** five, all platform-owned (`supabase_storage_admin`): `enforce_bucket_name_length_trigger` (fires on INSERT or UPDATE OF `name` only), `protect_bucket_control_insert` (INSERT), `protect_bucket_control_update` and `protect_bucket_control_update_role` (fire only on UPDATE OF the two lifecycle columns), `protect_buckets_delete` (DELETE). **None fires for an UPDATE of `file_size_limit` or `allowed_mime_types`, so they do not block S3.**
- **Hosted Edge Functions (read-only list):** all 10 hosted S4 functions have exactly the versions and `verify_jwt` values in the matrix (customer-cancel-order v5/false, create-order-short-link v3/false, generate-blank-waiver v18/false, generate-signed-waiver v10/false, get-payment-method v4/false, get-session-metadata v4/false, get-waiver-status v12/false, save-signature v4/false, stripe-refund v10/true, upload-physical-waiver v6/false). The 11 new functions are not deployed. The S1 relays are unchanged (send-email v8 `38d67a82…`, send-sms-notification v7 `2fceff7f…`). No drift since the P0 comparison. A byte-level source comparison of the 10 hosted bundles against the P0 copies is still to be done immediately before deployment.
- **Caller check:** no file under `src/`, `supabase/functions/` or `supabase/migrations/` invokes `get-session-metadata`, `get-payment-method` or `create-order-short-link` (only tests and the executor mention them). The hosted-log check could not be run: the log-query tool here does not expose resolvable function-log tables. The Supabase dashboard (Logs, Edge Functions) answers it in a minute; it is the basis for owner item 4, not a technical prerequisite of S4.

## 1. S3: the two bucket-limit updates (SEC-021) — scripts ready

Generated from the templates of `audit/evidence/tools/build_execution_package.py`; files in `sg2-package/`; approval text `sg2-auth11-approval-text.txt` (SHA-256 `727d45fc152c2c75fcc3ad89629c4f206ef2f0dce26d917a4133983d568a1977`, inside each script).

| Batch | Version | Effect | Ledger | Filled script SHA-256 | Reversal SHA-256 |
|---|---|---|---|---|---|
| B23 | `20260325231044` | `storage.buckets` `carousel-media`: `file_size_limit = 524288000` (500 MB) | 303 to 304 | `7e42564c76a1c96460eb31e5df7860c39983a88cd1f68c3881b5b25c806243f5` | `a3db54fd94411df6ee63c06f18e4ddb5ad8daa99d779c626aa9a0f7ed4fff6f8` |
| B24 | `20260517221038` | `public-assets`: `file_size_limit = 10485760` (10 MB) and allowed MIME types extended by `image/heic`, `image/heif` | 304 to 305 | `993a315a3a22cee8f5ffd4aa2dd87120a9e733678d6fdbdacd6a92a8100bc4a0` | `da9af8b441a24dce7ea469acba2a204f3fc4a92d51b31d177e72dec3a73398a0` |

Ledger rows are `executed` markers that also carry the SQL text. The expected ledger hash after B23 and B24 is produced by `sg2-package/predict_after_s3.sql` (a read-only query that must be run **after** S2 lands, because it adds these two rows to the 303-row ledger; I have not run it yet for that reason). Reversal scripts restore the values recorded at the time of the pre-batch read (both were NULL when captured on 2026-10-20: re-capture them in the preflight and regenerate the reversal if they differ). Preflight (read-only, mandatory): current `storage.buckets` rows for both buckets, and any trigger on `storage.buckets` (runbook: "unverified"). Stop: a trigger exists, or the current limits differ from the captured pre-values. Owner decision SEC-021: confirm that raising the limits to these values is wanted (the files are historical application migrations that the code base expects).

## 2. S4: 21 Edge Functions, one at a time, explicit `verify_jwt`

Bundle hashes are over the function directory plus nothing else; the shared helper tree `supabase/functions/_shared` (54 files) has SHA-256 `6ea09ce8866792de246deb0c58bf21e3a197398d60289c8bb0873481a54a1d85` and is part of every bundle at deploy time. Values below come from `edge-function-deployment-matrix.csv` and `edge-function-jwt-compatibility-matrix.csv`; machine-readable copy with full hashes in `sg2-package/package.json`.

| Function | Hosted today | Explicit `verify_jwt` at deploy | Directory SHA-256 (first 16) | Owner release |
|---|---|---|---|---|
| check-availability | not deployed | false | `9eeaf0f126edb3c1` | confirm new |
| complete-booking | not deployed | false | `11f497298c695272` | confirm new |
| create-booking | not deployed | false | `48e0448f377a32b9` | confirm new |
| create-order-short-link | v3, false | **true** | `f630917122e82f6f` | no (Step 3 change) |
| customer-cancel-order | v5, false | false | `97928ca738765b12` | no |
| customer-portal-action | not deployed | false | `c0c6668827cce77c` | confirm new |
| customer-portal-data | not deployed | false | `2216ae7dc8ee0d5b` | confirm new |
| generate-blank-waiver | v18, false | false | `333c707bfba90b86` | no |
| generate-signed-waiver | v10, false | false | `616cf7b933c482b9` | no |
| get-payment-method | v4, false | **true** | `450dfa3991711880` | no (Step 3 change) |
| get-session-metadata | v4, false | **true** | `cecc94b4fa47b377` | no (Step 3 change) |
| get-waiver-status | v12, false | false | `c153cb7edc46b9f4` | no |
| portal-link | not deployed | false | `b3b84e8de17ba956` | confirm new |
| record-site-event | not deployed | false | `a3c777298b0f7ab9` | confirm new |
| request-portal-link | not deployed | false | `00384d3187adf55d` | confirm new |
| resolve-link | not deployed | false | `3e738caa0c7ef8bb` | confirm new |
| save-signature | v4, false | false | `1f39df06787a9980` | no |
| staff-order-save | not deployed | true | `00093de5eac6a5df` | confirm new |
| stripe-refund | v10, true | true | `c08b51aa0738dd37` | no |
| task-evidence | not deployed | true | `b9ea1430915b3538` | confirm new |
| upload-physical-waiver | v6, false | **true** | `ea7deac1a3507a48` | **yes (D-JWT-1)** |

11 are new, 10 are changes of hosted functions. Preflight per function (read-only): compare the hosted source with the P0 bundle (`get_edge_function`), confirm secrets by name only. Smoke tests use synthetic input and must be refused without a provider call (anon refused where `verify_jwt` is true). Stop: a hosted source is not understood, a deployed `verify_jwt` differs from the table, any provider call. Recovery: redeploy the saved P0 bundle; a new function is deleted or replaced by a refusing stub only with approval.

## 3. S4b: Storage-policy capability canary (G-16)

`audit/step4/g16-storage-canary.sql` sent exactly as written as one statement; SHA-256 (LF) `7bcd38d9e1c8cf105af7174448fd33c1ac3400baef65728e39096862d4e61dd4`. Expected `ERROR: BPC-CANARY-OK`; verify read-only that `storage.objects` still has the same six policies and no `zz_bpc_canary`, ledger unchanged. `BPC-CANARY-STOP` or `must be owner of table objects` stops the rollout before SG-3 (the three Storage-policy October files cannot run); no privileged workaround without a new approval. Background in `g16-storage-capability.md`.

## 4. Owner checklist for one SG-2 approval

1. SEC-021: raise the two bucket limits as above (yes/no).
2. D-JWT-1: release `upload-physical-waiver` `false` to `true` (the only flip that needs a release; the three others are the reviewed Step 3 change).
3. Confirm the 11 new functions may be created (list above).
4. Confirm that `get-session-metadata`, `get-payment-method`, `create-order-short-link` have no callers in the hosted logs (I can check the logs read-only first on request; it needs no approval).
5. G-16 approval for the canary.
6. Approve this statement (`sg2-auth11-approval-text.txt`): *AUTH-11: SG-2 per audit/step4/sg2-authorization-package.md. S3: apply B23 and B24 (bucket size limits, ledger rows executed, 303 to 305 rows). S4: deploy the 21 listed Edge Functions one at a time with the listed explicit verify_jwt values. S4b: send the G-16 canary once, expecting BPC-CANARY-OK. Stop on any failed check. Nothing else.*

## 5. Preparation still open for SG-2 (not blockers for AUTH-10)

- Post-S3 ledger prediction: done (section 0).
- Read-only P0 re-comparison of the hosted sources for the 10 hosted functions just before deployment (state may have moved since P0).
- Hosted-log caller evidence for the three functions (owner item 4; dashboard, optional).
These need S2 to be done or a few read-only calls; none needs new analysis.

## 6. After SG-2

SG-3 = S5, S6, S7: the 23 October migrations through the sealed executor, 21 more Edge Functions, and the 5 Step 3B corrective migrations; it needs S4b to pass, a fresh restore point `rp-S5`, and the owner inputs listed in `s3-s15-stage-group-authorization-plan.md`. It is the stage that finally executes the security migrations. S11 then restores the public-schema access (SG-6).
