# SG-2 execution evidence (AUTH-11), 2026-10-20

Authorization: the owner's exact AUTH-11 statement (SHA-256 of the statement file `sg2-auth11-approval-text.txt`: `727d45fc152c2c75fcc3ad89629c4f206ef2f0dce26d917a4133983d568a1977`). Target: Development `srxunxiytojjsuhcmzjg` only. Production was not contacted. Repository HEAD during execution: `50f3c9c4661d385c6126c411097b4909b8ad8a7a` (clean tree). Nothing pushed.

## S3: bucket limits (B23, B24)

Preflight (read just before): ledger 303 rows `b4f1f35e…`; `carousel-media` and `public-assets` both NULL/NULL; five platform triggers on `storage.buckets` (none fire for these columns); 9 buckets; 500 objects / 941,404,649 bytes.

| Batch | Version | Script (filled SHA-256) | Result | Ledger after |
|---|---|---|---|---|
| B23 | `20260325231044` | `7e42564c76a1c96460eb31e5df7860c39983a88cd1f68c3881b5b25c806243f5` | `carousel-media` `file_size_limit = 524288000` | 304, `3c31b2a2cc1933212c1aa448033d383312324c795b0d8bba747821d5642e203a` (= prediction) |
| B24 | `20260517221038` | `993a315a3a22cee8f5ffd4aa2dd87120a9e733678d6fdbdacd6a92a8100bc4a0` | `public-assets` `file_size_limit = 10485760`, MIME list png, jpeg, jpg, gif, webp, heic, heif | 305, `72cafdaca438365b30b41db0e7269832cc6591837dc8ef5bb5c01c125e2dd008` (= prediction) |

Two ledger rows with marker `executed` and the SQL text. Storage objects: 500, 941,404,649 bytes, digest of (id, bucket, name, metadata) identical before and after; no object created or updated in the last 12 hours. Business aggregates identical.

## S4: 21 Edge Functions

Channel: Supabase CLI 2.104.0 on the owner machine (`supabase functions deploy <name> --project-ref srxunxiytojjsuhcmzjg --use-api`, already signed in; no credential was typed or stored), one function at a time from the committed files at `50f3c9c`; `verify_jwt` comes from `supabase/config.toml`, which equals the explicit value of the package for all 21 (checked before deploying). Each deploy was followed by a version check and a smoke test; the loop stops on the first failure (none occurred).

| Function | Hosted before | After | verify_jwt | Smoke (no provider call) | Directory SHA-256 (first 16) |
|---|---|---|---|---|---|
| check-availability | none | v1 | false | OPTIONS 200 | `9eeaf0f126edb3c1` |
| complete-booking | none | v1 | false | OPTIONS 200 | `11f497298c695272` |
| create-booking | none | v1 | false | OPTIONS 200 | `48e0448f377a32b9` |
| create-order-short-link | v3 | v4 | true | POST without Authorization 401 | `f630917122e82f6f` |
| customer-cancel-order | v5 | v6 | false | OPTIONS 200 | `97928ca738765b12` |
| customer-portal-action | none | v1 | false | OPTIONS 200 | `c0c6668827cce77c` |
| customer-portal-data | none | v1 | false | OPTIONS 200 | `2216ae7dc8ee0d5b` |
| generate-blank-waiver | v18 | v19 | false | OPTIONS 200 | `333c707bfba90b86` |
| generate-signed-waiver | v10 | v11 | false | OPTIONS 200 | `616cf7b933c482b9` |
| get-payment-method | v4 | v5 | true | 401 | `450dfa3991711880` |
| get-session-metadata | v4 | v5 | true | 401 | `cecc94b4fa47b377` |
| get-waiver-status | v12 | v13 | false | OPTIONS 200 | `c153cb7edc46b9f4` |
| portal-link | none | v1 | false | OPTIONS 200 | `b3b84e8de17ba956` |
| record-site-event | none | v1 | false | OPTIONS 200 | `a3c777298b0f7ab9` |
| request-portal-link | none | v1 | false | OPTIONS 200 | `00384d3187adf55d` |
| resolve-link | none | v1 | false | OPTIONS 200 | `3e738caa0c7ef8bb` |
| save-signature | v4 | v5 | false | OPTIONS 200 | `1f39df06787a9980` |
| staff-order-save | none | v1 | true | 401 | `00093de5eac6a5df` |
| stripe-refund | v10 | v11 | true | 401 | `c08b51aa0738dd37` |
| task-evidence | none | v1 | true | 401 | `b9ea1430915b3538` |
| upload-physical-waiver | v6 | v7 | true | 401 | `ea7deac1a3507a48` |

Post-deploy verification: (1) the connector's function list shows these versions and `verify_jwt` values (7 true, 14 false), status ACTIVE; (2) the deployed source of all 21 was downloaded from Development into an empty scratch folder and compared with the repository files: all 21 `index.ts` and all 37 `_shared` files that the deployments carry (58 files) are byte-equal after line-ending normalization; (3) functions not in the list are unchanged (for example `charge-deposit` v14, `send-email` v8 `38d67a82…`, `send-sms-notification` v7 `2fceff7f…` keep their previous bundle hashes). Required secrets by name: only the platform-provided `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` plus `SITE_URL` for `request-portal-link` (not verifiable by this tooling; see release review). Smoke tests were unauthenticated or CORS preflight requests, which cannot reach a provider; no function was invoked with a real payload; no SMS, e-mail, Stripe or other provider call was made by this work.

Accepted testing limits (not claimed as passed): no authenticated or end-to-end workflow (booking, portal, payment, refund, waiver upload, crew evidence) was exercised; those belong to S13 after the frontend push. The three flipped functions with no committed callers were not log-checked.

## S4b: Storage-policy capability canary

`g16-storage-canary.sql` sent unchanged as one statement. Result: `ERROR P0001: BPC-CANARY-OK: CREATE POLICY and DROP POLICY on storage.objects are permitted for postgres ; this transaction is aborted on purpose and nothing persists`. That is the approved success signal. Afterward (read-only): the six `storage.objects` policies are exactly the six expected names, no `zz_bpc_canary`, the ledger is still 305 / `72cafdac…`, objects unchanged.

## SG-2 integrity after S4b (read-only)

- Ledger 305 rows, `72cafdaca438365b30b41db0e7269832cc6591837dc8ef5bb5c01c125e2dd008`; the only two `executed` rows are `20260325231044` and `20260517221038`; the 245 `NOT EXECUTED` rows are unchanged.
- Canonical fingerprint (search path `"$user", public, extensions`): ten categories equal the baseline (fn `3a11af85…`/82, trg `f729c8fe…`/37, col `a63239ea…`/804, con `3ab6496d…`/235, idx `b3988572…`/237, pol `8ee2e2c1…`/228, rel `e3bdf399…`/69, nsp `c20defe7…`/2, pub `350879c0…`/8, ext `5f40a353…`/4). The `bkt` category changed from `7d8cac3a…` to **`0bc770f2c5bb329f618516250c0cf124`** (9 buckets), which is exactly the two authorized bucket changes (`carousel-media` and `public-assets`). New fp_all baseline for the sealed executor, if it records the bucket category, must use this value.
- Business data unchanged: orders 171, payments 185, units 16, pricing_rules 1, invoices 82, balance due 1,344,396, deposits paid 856,550, tips 74,928, payments sum 2,496,274, auth users 9, customers 123, contacts 95, sms_conversations 1,039. Storage 500 objects / 941,404,649 bytes. `anon` and `authenticated` still without USAGE on `public`; 222 public policies.
- Operator log: 4 new hash-chained entries (38 total), chain valid.
