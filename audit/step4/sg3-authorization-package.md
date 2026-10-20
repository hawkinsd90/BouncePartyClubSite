# SG-3 (S5 + S6 + S7): preparation and consolidated authorization draft (2026-10-20)

Status: **PREPARED. NOT AUTHORIZED. NOTHING OF SG-3 WAS EXECUTED.** The only hosted calls made for this document were read-only SQL on Development (`srxunxiytojjsuhcmzjg`). Production untouched, nothing pushed, no setting changed. SG-2 is complete (`sg2-execution-evidence.md`).

## 1. Starting state (verified read-only after SG-2)

- Ledger **305 rows, `72cafdaca438365b30b41db0e7269832cc6591837dc8ef5bb5c01c125e2dd008`**; none of the 28 package versions is recorded. "Ledger outside the package" for the executor guard: **305 rows, version-list SHA-256 `76025b5b681008ec5b0239c57be1f54fd7bbed3a3f70fa1384698afcc6476c59`**.
- Catalog fingerprint in the executor's own method (`search_path = pg_catalog`): **every one of the 11 categories equals the sealed `start_state`** (bkt `0bc770f2…`/9, col `4cd6a654…`/804, con `6df540d6…`/235, ext `5f40a353…`/4, fn `a79519ab…`/82, idx `b3988572…`/237, nsp `c20defe7…`/2, pol `3335800d…`/228, pub `350879c0…`/8, rel `e3bdf399…`/69, trg `27bab468…`/37; sealed `fp_all` `07d2d5c96e142fef6a011bc1f9b30dec`). The sealed chain presupposes the two S3 bucket updates, and they are now in place. In the canonical method used for S2 the same state has `bkt` `0bc770f2…` and the other ten categories unchanged.
- Containment in force (`anon`, `authenticated` without USAGE on `public`); both compromised accounts still banned until 2026-11-13; business data and Storage unchanged.
- **S4b prerequisite met:** the canary answered `BPC-CANARY-OK` for `postgres`, so the three Storage-policy files (`20261014120000`, `20261015120000`, `20261015123000`) are expected to run through this role.

## 2. Sealed package integrity

`audit/step4/executor/dev-package-oct-s3b.sealed.json`: schema `bpc-dev-executor-package/1`, Git commit `ecdda40cb2e858bb21469ce7fbc55fbfc5a05d6a`, package SHA-256 `5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0`, 28 items (23 `withheld-gate` October files, then 5 `step3b`), in version order, each bound to a per-step pre/post fingerprint. Recomputed today: all 28 migration files in the working tree equal the sealed `sha256_lf`; dependencies (`requires`) respect the order; the executor's test suite (`devMigrationExecutor.test.ts`) passes 125 of 125. Deny list preserved (the 8 denied versions, including the demo-admin migration, can never run here).

## 3. The 28 rendered scripts (ready; the database enforces every guard)

`render` of the executor (no connection) produced one channel-neutral script per version in `sg3-package/` (deterministic, rendered twice and compared): `NN_<version>.sql`, 1,114,801 bytes in all, listed with SHA-256, pre and post fingerprints and expected ledger count in `sg3-package/package.json`. Each script is one transaction that (PRE) checks database and role, that the version is unrecorded, predecessors, that earlier package steps carry this executor's marker, the ledger outside the package (305 / `76025b5b…`), containment and the pre-fingerprint; then runs the migration file verbatim; then (POST) checks the post-fingerprint, containment, RLS on every public table and the step's own rules; then writes the ledger row (marker + exact SQL) and checks the new ledger count (305 + step). Any failed check raises and rolls back everything, including the ledger row. Expected ledger after step N: 305 + N; after step 28: **333 rows**. Expected final catalog fingerprint after step 28: sealed `post_fp_all` `f6c6f0b671d21b34703a0f0ad5848cb4`.

Two ways to run them (your decision, section 6):
- **Channel A (recommended): connector.** I send each rendered script through the same database channel used for all S2 and S3 writes, then verify the ledger row by recomputing the SHA-256 of the stored SQL against the sealed `sha256_lf`. No credential changes hands. Cost: about 1.1 MB of script text to send.
- **Channel B: the executor's own hosted transport** (`run --target hosted-development`), which adds its hash-chained audit store and per-step anon/authenticated probes, but it has **never connected to a hosted project** and needs you to put the Development database connection string in `BPC_HOSTED_DEV_DATABASE_URL` in a shell you control (I will not type or store a password).

## 4. Stages and dependencies

| Stage | What | Depends on | Stop conditions |
|---|---|---|---|
| S5 | steps 1 to 23 (`20261007120000` to `20261025120000`), one transaction each | SG-2 done (met); restore point (section 5); your release of the 23 October versions | any guard or fingerprint mismatch; `must be owner` on a Storage-policy file; containment changed |
| S6 | deploy the 21 `S6` Edge Functions (list below) | S5 verified; `SITE_URL` and `RETURN_ORIGINS` secrets (G-06); Twilio console URLs read (G-05); D-JWT-1 releases; G-19 | Twilio URL mismatch; a `HOLD` function in the list; any deployed `verify_jwt` differing from `config.toml` |
| S7 | steps 24 to 28 (`20261026120000` to `…0400`) | S5, S6; SEC-015 pre-check | `42501` from `…0400` (never bypass); any postcondition false |

**S6 functions (21):** backfill-payment-methods, charge-deposit, checkout-bridge, create-admin-user, customer-balance-payment, fix-payment-method, order-lifecycle, promote-media, reconcile-balance-payment, record-cash-payment, record-check-payment, record-consent, save-payment-method-from-session, send-error-notification, send-invoice, stripe-charge, stripe-checkout, stripe-webhook, sync-google-calendar, twilio-status-callback, twilio-webhook. `HOLD` (`send-booking-confirmation`) and the 11 unchanged functions are not touched. Matrix flags needing your D-JWT-1 release (hosted `false` to `true`): charge-deposit, create-admin-user, fix-payment-method, promote-media, record-cash-payment, record-check-payment, save-payment-method-from-session, send-invoice, stripe-charge, stripe-checkout.

Read-only pre-checks already done: SEC-015: Development has **0** default-ACL rows in `public` (18 rows in other schemas, none relevant), so `20261026120400` is expected to be a no-op that passes. `user_roles_role_check` is absent (SEC-007 context). `get_admin_users` exists in the database, and no application code outside tests and generated types calls it (SEC-011 caller question: none found in code).

## 5. Restore point

Procedure `d02-restore-point-procedure.md`: an owner-run dump (the owner's machine, password prompt in their shell) with SHA-256, the ledger export and a local restore proof. **Current situation:** the existing restore point `dev-20261020T1206Z` (dump SHA-256 `3831AE9F…1D0B`) is 6.4 hours old at 18:30 UTC and satisfies the D-02 rule "newer than 12 hours" until **2026-10-21 00:06 UTC**. It predates the SG-2 and S2 ledger and bucket changes, but no business data has changed since (aggregates and the Storage object digest were verified equal several times). Options: (1) accept `dev-20261020T1206Z` if S5 starts before 00:06 UTC; (2) take a fresh dump right before S5 (about five minutes, recommended if S5 starts later). The runbook also asks for a second dump immediately before step 12 (`20261016120000`, which writes `user_roles` data); a single dump taken before step 1 covers the same business data because steps 1 to 11 are privilege, policy and function changes (a static scan found no business-table DML at top level in them), so I recommend **waiving the second dump** so the run stays continuous; if you want it, the run pauses once after step 11 for your dump.

## 6. Decisions and inputs that change release behavior

1. **Execution channel:** A (recommended) or B.
2. **Restore point:** which one (section 5) and whether to waive the step-12 dump.
3. **Release the 23 October versions** (the statement below does).
4. **G-06:** set `SITE_URL` and `RETURN_ORIGINS` to `https://dev.bouncepartyclub.com` (the Edge Function secret values are public URLs; I set them with the already signed-in CLI scoped to the Development ref). Without `SITE_URL`, `request-portal-link` falls back to the Production domain.
5. **G-05:** the Twilio console inbound and status-callback URLs for Development. I cannot read the console; please confirm they point at the Development function URLs (`https://srxunxiytojjsuhcmzjg.supabase.co/functions/v1/twilio-webhook` and `…/twilio-status-callback`) or tell me they must be changed (a provider setting is yours to change).
6. **D-JWT-1:** release the ten `false` to `true` flips listed in section 4 (the matrix records that all committed callers send an Authorization header; the payment functions keep their in-function role checks).
7. **G-19:** deploy the stubs `fix-payment-method` and `backfill-payment-methods` or leave them (they are in the 21; "leave" removes them from the list).

## 7. Proposed statement (one decision once items 1 to 7 are settled)

> AUTH-12: SG-3 per audit/step4/sg3-authorization-package.md, channel A. S5: release and execute October steps 1 to 23, one transaction each. S6: set SITE_URL and RETURN_ORIGINS to https://dev.bouncepartyclub.com and deploy the 21 listed Edge Functions with the listed explicit verify_jwt values, releasing the ten D-JWT-1 flips. S7: execute steps 24 to 28. Restore point: <id and UTC time>. Ledger 305 to 333. Stop on any failed check. No push, nothing else.

I will not execute any of it before that statement. After it, I run S5, S6 and S7 continuously, verify the ledger, the fingerprint and the business data after each step, and prepare the restore of containment (S10 and S11) as the next package.
