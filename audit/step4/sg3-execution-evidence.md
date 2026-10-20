# SG-3 execution evidence (AUTH-12, AUTH-12D), Development only, 2026-10-20

Result: **S5, S6 and S7 executed. Ledger 305 to 333. Final catalog fingerprint `f6c6f0b671d21b34703a0f0ad5848cb4` (sealed value). Two disclosed comment-only stored-text exceptions (steps 24 and 25). Two S6 findings still open (URL secrets, Stripe webhook secret).**

| Stage | Steps / items | Channel | Outcome |
|---|---|---|---|
| S5 | 23 October migrations, one transaction each | connector `execute_sql`, sealed scripts | all committed; ledger 328; all 23 stored SQL hashes equal sealed |
| S5 step 12 | only business-row DML | same | deleted the 2 orphan master `user_roles` (ids `09a71dda-...`, `82fcc6a3-...`); 9 to 7; content saved before in `sg3-step12-orphan-rows-before.json` |
| S6 | 21 Edge Functions | Supabase CLI `functions deploy --use-api` | deployed (version +1 each); `verify_jwt` equals the sealed matrix (checked with the connector's function list); downloaded source equals repo for all 21 (+20 shared files) |
| S7 | steps 24, 25 | connector (manual paste) | committed, fingerprints `430bd39c...`, `34b4b370...`; stored text differs by one comment line each (see `sg3-step24-integrity-discrepancy.md`) |
| S7 | steps 26, 27, 28 | CLI `db query --linked -f` (AUTH-12D), files unchanged | committed; ledger 331, 332, 333; stored hashes equal sealed |

## Final verification (read-only)
* Ledger 333 rows; full-ledger sha256 `3221ec481f7b3a621fb9a9903374e24b609f1b9d69b9aca35e85b0c06b1ffd29`.
* Reconciliation of the 28 migrations (stored `statements[2]` sha vs sealed `sha256_lf`): 26 match; **20261026120000 (step 24) and 20261026120100 (step 25) do not match** (comment-only; hashes in the discrepancy document; ledger rows unmodified).
* Catalog fingerprint (executor method) `f6c6f0b671d21b34703a0f0ad5848cb4`.
* anon and authenticated: no USAGE on `public` (containment intact).
* Business baseline: orders 171, payments 185, payments sum 2,496,274, auth users 9, user_roles 7 (the approved 9 to 7), Storage 500 objects / 941,404,649 bytes.
* Operator log: 42 entries, chain valid (4 new SG-3 entries).

## Open findings (not passed)
1. `SITE_URL` and `RETURN_ORIGINS` (both `https://dev.bouncepartyclub.com`) are not set (connector request declined). Owner: Supabase dashboard > Edge Functions > Secrets, those two names only.
2. `stripe-webhook` fails closed with 500 because `STRIPE_WEBHOOK_SECRET` is not set on Development. Needs its own authorization/owner action before any webhook or payment acceptance test.
3. `twilio-webhook` / `twilio-status-callback`: unsigned requests are refused (401/403 and 500 for a JSON body); no provider setting was changed. Inbound routing check stays an S13 item.

## Tests
`s2ConsolidatedPackage.test.ts` 50 passed, 0 failed. `fixPaymentMethodAuthorization.test.ts` not re-run (runner mismatch in this environment; it passed 32/32 when last run). No other tests run.

## Hosted actions
Connector SQL: steps 1 to 25 and read-only checks. CLI: 21 function deployments, steps 26 to 28, read-only probes/queries (byte-integrity, single-transaction, final verification). No push, no Production, no provider call, no ledger edit (one attempted correction was blocked before reaching the database).
