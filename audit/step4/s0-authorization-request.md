# S0 authorization request (Development recovery): for owner review

Status: **S0 RECORDED (AUTH-4 approved 2026-10-19 23:59 EDT / 2026-10-20 03:59 UTC); P0 clean (section 11); the S1 decisions are recorded and AUTH-5 is prepared for review (section 15, `auth5-s1-authorization-package.md`). S1 is NOT authorized and nothing hosted was written.** This file changes no migration, no sealed package and no executor code.

## 1. What S0 is, and the smallest authorization that follows from it
S0 in the runbook is **approvals, restore point and mechanism**. It contains **no hosted write**. What this request asks is therefore two separate permissions, kept apart so nothing is bundled:
- **AUTH-4 (S0 record + P0 read-only preflight).** You approve the S0 record in section 8, and allow one read-only preflight session on Development (P0: hand-checked `SELECT`s and function-source reads, no write). Nothing is changed.
- **AUTH-5 (S1, the first hosted mutation).** Requested **separately, afterwards**, only when the dependencies in section 7 are closed. It is **not** granted by approving this file.
Stages S2 to S15 are not requested.

## 2. Bindings (verified 2026-10-20 from the local repository; hosted values from the AUTH-1/AUTH-2 reads)
| Item | Value |
|---|---|
| Development Supabase project | `srxunxiytojjsuhcmzjg` (Bounce Party Club Dev, us-east-1, PostgreSQL 17.6, Pro plan). Production `qaagfafagdpgzcijnfbw` is out of scope and never contacted |
| Git branch / source commit | `Dev`, `4920b56713e17b7ad1ad96311ed57b64ccba2466` (tree `98d919aaf98bd6129b459da9ce0df879ed39f32c`); this file is added on top in its own commit, which changes no other file. 115 ahead, 0 behind `origin/Dev`; nothing pushed |
| Remote refs | `origin/Dev` `aeb708ed9d5f0fbc2b146a52d378babd07024b30`, `origin/main` `b79ca480d244808a1926ef6f87dc5666a1dee052` |
| Sealed package | 28 files (23 October + 5 Step 3B), `document_sha256 5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0`, bound to `ecdda40` (an ancestor of HEAD); the executor, deny list, compatibility migrations A/B and the comment-only alias are unchanged (executor test and strict acceptance green) |
| Starting ledger | 58 rows, newest `20260929161925`, SHA-256 `ca686c2d620154142ad9d9908c5c093a16a709df35c1c6860ed65c8bef24b999`; version-list md5 `093346c640a120a00b8cb32f5a5b0454` |
| Starting schema | 11-category fingerprint equal to the sealed start state except `bkt` (post-S3), method and values in `auth1-development-baseline.md`; `anon` and `authenticated` have no USAGE on `public` |
| Backup artifact | `C:\Users\vikki\BPC-Backups\dev-20261020T0245Z`: `dev.dump.gpg` 1,018,157 bytes SHA-256 `BBD648375A6D51BC5C4B518E0BBC24566B8F79E039783CA13AFF3AFC6AA3832A`; `roles.txt.gpg` `8FCB9562A91336AE07AD9BDAD5F95911013A37DEC8359DD9ACA93621399A1913`; passphrase in Bitwarden; retention until rollout and testing end + 30 days; no second copy confirmed |
| Restore evidence | `auth3-backup-execution-checklist.md` section 13: application, authentication, ledger, fingerprint, Storage metadata, containment **PASS**; local PostgreSQL restore **PARTIAL**; full managed-Supabase equivalence **NOT PROVEN**; Storage Option A (object bytes not backed up) |
| Supabase GitHub integration (Development) | Deploy to production **OFF**, Automatic branching **OFF**, connected, production-branch field blank (G-25, resolved only at S15). A push cannot apply migrations or deploy functions through Supabase |
| Netlify `bouncepartyclubdev` | continuous deployment from `hawkinsd90/BouncePartyClubSite` stays **ON**; current publish `aeb708e` (deploy `6ad6164006e80bd67c7754ed`); builds-active toggle unverified. A Netlify build happens only on a push, and S0/S1 contain no push (the first push is S9) |
| Owner data rule | **zero unexpected loss** of existing Development business data; a failed stage stops and is investigated |

## 3. Gate status for S0 (`owner-approval-checklist.md`)
| Gate | State now | Needed from you |
|---|---|---|
| D-02 restore point | encrypted dump taken and proven (PARTIAL platform caveat); managed backups listed, restore untested | accept this as the restore point; a **fresh dump with the same script immediately before S2** (the first database write) is part of the plan, so the window since the backup is minutes |
| D-03a Netlify | repository and continuous deployment evidenced, builds-active unverified | nothing required; optionally a screenshot of Build & deploy |
| D-03b | Deploy to production OFF verified | nothing until S15 |
| G-14 window and on-call | OPEN | **name the window (start and end) and the person reachable throughout** |
| G-18 commit and package freeze | local commits done (`7adcf75`, `0fc95c2`, `280b285`, `4c86d3a`, `e70422e`, `4920b56`), package untouched | approve the sequence; push remains gated |
| G-22 reconcile `origin/Dev` | local merge done (`9085630`), 0 behind; no push | nothing now; the push decision stays with S9/G-15 |

## 4. Notification and payment safety
Stripe stored keys and the frontend key are test-class (read-only evidence). Twilio and Resend credentials sit in Development `admin_settings`; **S1 is mandatory before anything that could send**, and the old `send-email` v7 and `send-sms-notification` v6 are the expected pre-rollout versions. No function test, provider call or customer message occurs before the coordinated deployment. Test recipients are one owner-controlled e-mail address and one phone number (constants in `outbound-guard.ts`); the demo master account is handled at its own gates (G-03), never by signing in with the historical password.

## 5. The first specifically authorized hosted actions
- **With AUTH-4 only:** P0 read-only preflight: ledger export and SHA-256 (expect 58 rows, `ca686c2d…`), catalog fingerprint, containment booleans, `list_edge_functions` and the source of the S1 and S4/S6 functions against the committed copy, secret names present (never values), Storage inventory count (expect 500, 941,404,649 bytes). Stop on any difference.
- **With AUTH-5 (later):** S1 only: deploy the guarded `send-email` and `send-sms-notification` from the committed source, `verify_jwt` per the JWT matrix, after reading both hosted sources and saving the previous bundles. This is the first hosted mutation. It does not touch the database, the ledger, Storage or Netlify.

## 6. Rollback and stop conditions
Stop and report if: the ledger or fingerprint differs from section 2; a hosted function source differs unexpectedly; a message reaches an unapproved recipient or a live-mode Stripe event appears; `git ls-remote --heads origin` differs from the recorded refs; the Deploy-to-production toggle is not OFF; any business-data count or hash would change. Rollback for S1: redeploy the saved previous versions; accidental message: the "Accidental real notification" section of `rollback-and-recovery-plan.md`. A ledger edit is never a recovery step. Existing Storage object bytes are never deleted or overwritten: a static search of the October and Step 3B files shows policy and bucket-configuration statements only, no delete or update of `storage.objects`; if any stage ever introduces such a risk it stops for a separate decision (Option A means bytes are not recoverable from the backup).

## 7. Dependencies before the first hosted mutation (S1)
1. G-14: the window and the on-call person.
2. G-02: confirm the named test e-mail and phone.
3. D-JWT-1: decide the `verify_jwt` rows for the two S1 functions (the matrix recommends `true`).
4. G-01: confirm the read-only provider configuration items C1 to C10 (`provider-safety-checklist.md`).
5. AUTH-4 approved and the P0 preflight clean.
6. Not required before S1: the 13 disputed attestations, the 46 other attestations and the history-only batches (each is a one-time approval at its documented stage; none is requested now), the signed hosted authorization documents (G-17: needed only before S5, and built then so they bind the fresh ledger hash and restore point), the 28-file release, the push.

## 8. S0 record (you approve by replying; nothing else is implied)
| Field | Your answer |
|---|---|
| Restore point accepted | **YES** (2026-10-19/20): the AUTH-3 encrypted dump `dev-20261020T0245Z` with its documented limits. The owner also **requires a fresh encrypted dump immediately before the first hosted database write (S2)**; that dump needs its own execution authorization and was not made during P0 |
| Rollout window and on-call person | **Start: NOW = 2026-10-19 23:59 EDT (UTC-04:00) = 2026-10-20 03:59 UTC. No end time given: the window is owner-supervised and open-ended until the owner closes it or names an end.** On-call: the owner, available throughout. G-14 asks for an explicit end: recorded as the one outstanding requirement for S1, not treated as satisfied and not invented |
| No real customer expected on Development during the rollout | **YES** (this does not waive database integrity or security requirements) |
| Test recipients confirmed (e-mail, phone) | **APPROVED 2026-10-20 (see section 15).** Earlier note:  Only the destinations in `outbound-guard.ts` may be used. Reading them locally shows **one phone and three e-mail addresses**, not one e-mail: masked here as phone `+1 734 ***-8854` and e-mails `h*******0@gmail.com`, `d******k@gmail.com`, `n*************s@gmail.com`. The owner must confirm that all four are owner-controlled (or decide to change the constants, which is a code change with its own review). Nothing was sent |
| Executor design (temporary recovery control, retired at R0 to R5) reviewed | **APPROVED for the one-time historical recovery only**; the executor and the deny list stay in place and unchanged during P0 and are retired from normal deployment per R0 to R5 |
Not authorized by this record: `supabase db push --include-all`, any historical migration repair, any ledger write, any push, any Netlify change, any Storage change, any Production action.

## 9. Next action
Reply with the window and on-call person, the two test recipients and yes/no on the rows above; that approves AUTH-4 (read-only P0). I then run P0 and report; AUTH-5 (S1) is requested only after P0 is clean and section 7 is closed.

## 10. Owner decisions recorded for AUTH-4 (2026-10-19 23:59 EDT / 2026-10-20 03:59 UTC)
- **Scope: AUTH-4 / S0 / P0 only.** Not authorized: S1 or any function deployment; S2 or later database operations; ledger writes; migration execution; pushes; Netlify changes; Supabase integration changes; Storage modification or download; Stripe operations; e-mail or SMS; Production access; the fresh pre-S2 dump (needs its own authorization).
- **Data rule:** zero unexpected loss of existing Development business data. (The instruction text read "is acceptable"; it is recorded as the requirement, consistent with the owner's earlier correction. Please say so if that reading is wrong.)
- **Backup limits, unchanged:** local business-data restoration passed; full managed-Supabase equivalence not proven; Storage Option A protects metadata, not object bytes.
- **Integration (G-25):** the production-branch field stays blank until S15; automatic deployment stays OFF; Netlify continuous deployment stays ON; nothing was changed.

## 11. P0 read-only preflight result (2026-10-20 03:59 to 04:05 UTC; Development only; no write)
**Result: PASS. Every expected value matched; no stop condition occurred.**
| Check | Expected | Observed |
|---|---|---|
| Git | branch `Dev`, no unexpected change | `Dev`, HEAD `baf1daab2ca6c56d4176278a9b2dc60bbf39362f`, tree `8e8693834cd6db9970142fe8f690100564a5dd31`, clean tree, 0 staged, 116 ahead / 0 behind `origin/Dev`; `origin/Dev` `aeb708ed…`, `origin/main` `b79ca480…`; only one commit since `4920b567` (this file's creation); no migration, executor, deny-list or package file changed since `4c86d3a`; the strict acceptance of the AUTH-3 task (121 files, 135 runs, 132 passed, 3 baselines, 0 failed, 143,343 assertions) ran on code identical to the current tree |
| Project | `srxunxiytojjsuhcmzjg` | confirmed by `get_project` (Bounce Party Club Dev, ACTIVE_HEALTHY, PostgreSQL 17.6.1.127) and `current_database()` = `postgres`; Production never contacted |
| Ledger | 58 rows, newest `20260929161925`, SHA-256 `ca686c2d…b999` | 58 rows, min `20251001051900`, max `20260929161925`, SHA-256 equal; the 58 versions equal the Step 2 capture as a set; the local capture file hash `21ea3e55…` equals the hosted list hash computed the same way (the older "093346c6…" figure in the AUTH-1 record uses a formatting that is not reproducible: a documentation gap, not a data difference) |
| Ledger content | none of the 13, A, B, October or Step 3B versions, no denied version, alias present | recorded of the 13: 0; compat A/B: 0; the 28 package versions: 0; denied versions: 0; alias `20260814002658` present (`20260814120000_create_contact_inquiries.sql`); original `20260814120000`: 0; rows newer than expected: 0 |
| Schema fingerprint | 11 categories equal to AUTH-1 | **all 11 equal** (bkt 9, col 804, con 235, ext 4, fn 82, idx 237, nsp 2, pol 228, pub 8, rel 69, trg 37), same method (`DIGEST_ROWS`, no `SET`) |
| Containment | `anon` and `authenticated` no USAGE on `public` | false / false; `service_role` true; 222 public policies, 6 on `storage.objects`, 82 functions (68 security definer, 75 anon-executable), 6 event triggers, 0 triggers on `auth.users`, realtime publication holds `orders`; all as at AUTH-1 |
| Business data | 171 orders, 185 payments, 16 units, 1 pricing rule | **equal**: 171, 185, 16, 1; also auth users 9, customers 123 |
| Financial aggregates | balance due 1,344,396; deposits paid 856,550; tips 74,928; payments 2,496,274 | **equal** (counts and sums only; no individual record read) |
| Storage (metadata only) | 9 buckets, 500 objects, 941,404,649 bytes, md5 `0260dd1c…` | **equal**: 9, 500, 941,404,649, total md5 `0260dd1cb6d342f37301be6813be3bf7`; per-bucket object counts, bytes, public flags and size limits equal AUTH-1 (per-bucket md5 values use a different expression than AUTH-1's and are not compared); no object read or downloaded |
| Edge Functions | 42 deployed, 16 `verify_jwt` true, `send-email` v7, `send-sms-notification` v6 | **all 42 slugs, versions, `verify_jwt` values and update times equal the AUTH-1 record**; `send-email` v7 `verify_jwt` false, `ezbr_sha256` `54369442bac6ae837a5bb3765a95ac9720feb882f49b4a9c063a9e332529ed71`; `send-sms-notification` v6 `verify_jwt` false, `ezbr_sha256` `9f6590283fdc9f75635c29641f6425ed8d462b63bbd17501ab8bf71254c2fdf4` |
| Hosted source versus `origin/Dev` copy | no unexpected difference | 17 of 17 and 16 of 16 distinctive lines of the hosted v7 and v6 sources, plus the shared `format-order-id.ts`, are present in the `origin/Dev` copies; both hosted functions are the unguarded pre-rollout versions. A byte-for-byte comparison is UNVERIFIED (the connector returns the source inline only); S1 must save both bundles locally and compare before it deploys |
| Provider safety (no provider contacted) | see section 12 | Stripe keys in `admin_settings` (secret and publishable): `test` class; Twilio SID, token, from-number, Resend key, admin phone and e-mail settings are present (names and lengths only, no value read); `pg_net` is not installed |

## 12. S1 readiness assessment (S1 is not authorized)
**Clean:** P0 baseline (section 11). **Rollback:** the hosted v7 and v6 sources are retrievable now and match the `origin/Dev` copies; the rollback is to redeploy those sources with `verify_jwt` false (the current hosted value); S1 must first write them to a local folder outside Git and compare. **Exact local S1 source (HEAD):** `supabase/functions/send-email/index.ts` (git blob `30472d4660835731dc71f71c24dd2804f85412bb`), `send-sms-notification/index.ts` (`79c45675a022971ffec6456967b38f9abd1be910`), `_shared/auth.ts` (`a93a110c61bebc37bd293a9e179b008b7817c7cc`), `_shared/notifications/outbound-guard.ts` (`e91f376cf2b21b26b2e6de9500c741f0e4cab3d2`), `_shared/format-order-id.ts` (`5f736495a6b406c1a4b15a78228f9a8b669b42cc`); `auth.ts` and the guard have no relative imports. The Supabase integration is OFF, so a push cannot deploy these; S1 deploys them directly in its own authorized step.
**Blockers before S1 can be requested** (each needs you):
1. **G-02 recipients:** the guard's constants contain one phone and **three** e-mail addresses (masked in section 8). Confirm all four are owner-controlled, or choose to change them (a code change, new test run and commit before S1).
2. **D-JWT-1:** decide `verify_jwt` for `send-email` and `send-sms-notification` (hosted `false`; the repository matrix recommends `true` because the relays authorize callers in code and all committed callers send an Authorization header). Not decided silently.
3. **G-14:** an explicit end time (or your statement that an open-ended supervised window is acceptable for S1). The signed hosted documents for S5 and S7 are limited to 48 hours.
4. **G-01 provider checklist:** C1 (admin_settings class) and C10 are verified; C1's Edge secret and Netlify `VITE_STRIPE_PUBLISHABLE_KEY` (C2), the Stripe test-mode webhook (C3), the Twilio live-or-test statement (C5), callback URLs (C6), Resend sender domain (C7), `SITE_URL`/`RETURN_ORIGINS` (C8) and the Maps key (C9) are UNVERIFIED because they live in provider dashboards; you confirm them (names and first characters only). Because the deployed relays are unguarded and the Twilio and Resend credentials are present, **no function may be invoked and no test message sent before S1 completes.**
**Not blockers for S1:** the fresh dump (needed before S2), the 13 and 46 attestations, the signed hosted authorization documents (before S5), G-25 (S15), the push (S9), D-03a builds-active.

## 13. Next authorization (the smallest AUTH-5 / S1 decision package)
Answer the four blockers above (recipients, two `verify_jwt` values, end time or open-ended confirmation, the C-items you can confirm now). I then prepare AUTH-5 as: read both hosted sources again and save them locally; deploy only `send-email` and `send-sms-notification` from the five files at HEAD with the chosen `verify_jwt`; verify with negative calls that send nothing; stop conditions and rollback as in section 6. No other stage is requested.

## 14. Pre-S1 review (2026-10-20, read only; nothing changed, no message sent)
### 14.1 The four notification destinations (`supabase/functions/_shared/notifications/outbound-guard.ts`)
They are **code constants**, not settings, secrets or dashboard values (lines 24 to 30). In Development the relays send **only** to these; the original recipient is kept in the subject or body prefix (`[DEV -> original]`) and in the e-mail banner. Masked here; the full values were shown to the owner in chat.
| # | Kind | Masked value | Constant | Reaches |
|---|---|---|---|---|
| 1 | Phone (SMS) | `+1 734 ***-8854` | `DEV_SMS_RECIPIENT` | **every** SMS Development would send: customer and admin templates, invoice and portal-link texts, pickup thank-you, admin failure alerts. It is not equal to the Development `admin_phone` or `admin_notification_phone` settings (those hold other numbers, which the guard redirects away from) |
| 2 | E-mail | `h*******0@gmail.com` | `DEV_EMAIL_RECIPIENTS[0]` | about one third of redirected e-mails: the inbox is chosen deterministically (FNV-1a hash of the original recipient). Not equal to the Development `admin_email` setting |
| 3 | E-mail | `d******k@gmail.com` | `DEV_EMAIL_RECIPIENTS[1]` | the same one-third share; **equals the Development `admin_email` setting** |
| 4 | E-mail | `n*************s@gmail.com` | `DEV_EMAIL_RECIPIENTS[2]` | the same one-third share |
Kinds of e-mail that can reach 2 to 4: order, approval, invoice, receipt, portal-link, pickup, contact-inquiry and admin notices sent through `send-email`. Points for the decision: (a) Development holds real Production customer data, so the subjects and banners in these inboxes show **real customer names, addresses and phone numbers**: all four destinations must be owner-controlled and trusted; (b) changing any constant is a code change with a test change (`outboundGuard.test.ts` pins them) and a new commit before S1; (c) the guard covers the two relays only: Supabase Auth's own sign-up and password-reset e-mails and any Stripe-side mail do not pass through it (Stripe sends none in test mode); they occur only if someone signs up or resets a password.

### 14.2 Is `verify_jwt: true` compatible with every legitimate caller of `send-email` and `send-sms-notification`?
**Answer: yes. Enabling it for both is safe on Development; no caller needs a different authenticated approach.** Basis: the existing JWT matrix rows (`proposed true`), every call site in `src` and `supabase/functions`, and the Development database.
| Caller class | Call sites | What it sends | Passes the gateway with `true`? |
|---|---|---|---|
| Staff, admin, master and crew browser sessions | `notificationService.ts` (e-mail and SMS), `PermissionsTab.tsx`, `TaskDetailModal.tsx` (crew pickup thank-you), `taskEdgeRequests.ts`, `transactionReceiptService.ts` via `supabase.functions.invoke` (admin receipts, from `orderApprovalService.ts`) | the signed-in user's access token (a JWT) | **yes**. With no session the browser sends `Bearer undefined` or the anon key: `undefined` is refused by the gateway, the anon key passes the gateway and is refused by the function: both are the denial that exists today |
| Edge Functions, server to server | `customer-notice.ts`, `customer-balance-payment`, `customer-cancel-order`, `customer-portal-action`, `reconcile-balance-payment`, `request-portal-link`, `save-signature`, `send-invoice`, `submit-contact-inquiry`; and service-key clients through `functions.invoke`: `transaction-logger.ts`, `charge-deposit`, `order-lifecycle`, `record-cash-payment`, `record-check-payment`; the two relays calling each other for failure fallbacks | `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (a JWT) | **yes**, while the legacy API keys stay enabled (verified: the legacy `anon` key is enabled, and a publishable key also exists) |
| Inbound provider webhooks | `stripe-webhook/emails.ts` sends through the relay with the service key; `twilio-webhook` and `twilio-status-callback` make no relay call | service key | **yes** (the providers never call the relays) |
| Database triggers, `pg_net`, scheduled jobs | none on Development: no function in `public`, `auth` or `extensions` references a function URL or the relays (only the platform helper `grant_pg_net_access`), `pg_net` is not installed, no `pg_cron` | n/a | **not applicable** (the historical 2026-03 trigger migrations are not present on Development; Production was not examined) |
| Anonymous visitors and customers | never call the relays directly; they use `submit-contact-inquiry`, the portal functions and the payment functions, which call the relays with the service key | n/a | n/a |
Conditions that keep this true: (1) the legacy JWT API keys must stay enabled (if the owner later moves to the new `sb_secret` keys, those are not JWTs and the gateway would refuse them, so the relays would have to be redeployed with `false` and rely on the in-function check; do not do that without re-testing); (2) the **in-function authorization stays the real control**: the anon key is a valid JWT and passes the gateway, so `true` is a second layer, not a substitute; (3) cross-origin browser calls: the preflight works today for the existing `true` functions that the web app calls (`record-consent`, `stripe-refund`), and S1 checks it for these two with a non-sending `OPTIONS` request. S1 verification that sends nothing: no Authorization header: refused by the gateway; anon key: refused by the function; service key with an empty body: `400` (an authorized call that stops before any provider request). Local evidence: `notificationRelayAuthorization` 399 passed, `edgeAuthHelpers` 107 passed, `outboundGuard` 105 passed, `developmentExecutionManifest` 23 passed.
**Recommendation for D-JWT-1 (relays): `true` for `send-email` and `send-sms-notification`** (the repository value, `config.toml` lines 88 and 97, equals it).

### 14.3 G-01: provider-dashboard checks that still need you
Only C5 and C7 bear on S1 (the relays and their credentials). C1 to C3, C6, C8 and C9 matter before functional and provider testing (S13) and can wait. C4 and C10 are already settled. Send text or a screenshot with no secret values.
| Check | Needed before | Exact navigation | What to report |
|---|---|---|---|
| **C5** Twilio credentials are live or test | S1 (recommended) | 1) Supabase, project **Bounce Party Club Dev** (`srxunxiytojjsuhcmzjg`) > **Table Editor** > `admin_settings` > row `twilio_account_sid`: note only the first 6 characters. 2) `console.twilio.com` > **Account** > **API keys & tokens**: compare with the **Live credentials** SID and the **Test credentials** SID (first 6 characters) | whether the stored SID is the live or the test one |
| **C7** Resend | S1 (recommended) | `resend.com` > **Domains**: `bouncepartyclub.com` status **Verified**; **API keys**: the key used by Development and its permission (**Sending access** is enough); **Emails** (logs): no unexpected recent sends | verified domain yes/no; key permission |
| **C1** Stripe secret key and Edge secrets | S13 | `dashboard.stripe.com`, switch **Test mode** on > **Developers** > **API keys**: the secret key shown starts `sk_test_`. Then Supabase Dev > **Project Settings** > **Edge Functions** > **Secrets**: confirm the names `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`, `RETURN_ORIGINS` exist (values are shown only as digests) | names present; test prefix |
| **C2** Frontend Stripe key | S13 | Netlify `bouncepartyclubdev` > **Project configuration** > **Environment variables** > `VITE_STRIPE_PUBLISHABLE_KEY` > show values in each deploy context | first 8 characters in every context (`pk_test_`) |
| **C3** Stripe webhook | S13 | Stripe **Test mode** > **Developers** > **Webhooks**: endpoint list; then switch Test mode **off** (live) and open **Webhooks** again | one test endpoint at `https://srxunxiytojjsuhcmzjg.supabase.co/functions/v1/stripe-webhook`; no live endpoint containing `srxunxiytojjsuhcmzjg` |
| **C6** Twilio callbacks | S13 | Twilio > **Phone Numbers** > **Manage** > **Active numbers** > the number > **Messaging Configuration** (also **Messaging** > **Services** if one is used): the incoming-message and status-callback URLs | where they point (Development function URLs, Production URLs, or none) |
| **C8** `SITE_URL`, `RETURN_ORIGINS` | S13 | values cannot be read in the dashboard (digests only); confirm only the names exist (see C1); their values are verified behaviorally at S13 | names present |
| **C9** Maps key | S13 | Netlify > **Environment variables** > `VITE_GOOGLE_MAPS_API_KEY`; then `console.cloud.google.com` > **APIs & Services** > **Credentials** > that key > **Application restrictions** | HTTP referrers list the Development and Production domains |

### 14.4 Remaining owner decisions to authorize S1
1. **Recipients (G-02):** confirm that the one phone and the three e-mail addresses in 14.1 are owner-controlled and trusted with real customer details, **or** tell me to change them (code change, tests, commit; this delays S1).
2. **D-JWT-1:** approve `verify_jwt: true` for `send-email` and `send-sms-notification` (recommended), or choose `false`.
3. **G-14:** an explicit window end time, or confirm that an open-ended supervised window is acceptable for S1.
4. **G-01:** the C5 and C7 answers (14.3). The other checks can follow before S13.
5. After 1 to 4, say **"prepare AUTH-5"**: I then produce the S1 execution package (exact files, hashes, deployment arguments, non-sending verification, rollback). Approving 1 to 4 does not itself authorize S1.

## 15. S1 decisions recorded and AUTH-5 prepared (2026-10-20)
The section 12 and 14.4 blockers are resolved by the owner: **G-02** all four destinations owner-controlled (no change); **D-JWT-1** `verify_jwt = true` for both relays; **G-14** supervised, open-ended window as an owner-approved exception, with the owner's availability reconfirmed immediately before deployment; **C5** Development uses live Twilio credentials (owner-confirmed; a live credential is not permission to send); **C7** Resend configuration owner-confirmed. The source review found no concrete security issue and the rollback sources are verified (full line-by-line comparison of the hosted v7 and v6 sources with the `origin/Dev` copies, saved copies, immutable Git blobs). The execution package is `auth5-s1-authorization-package.md`. Nothing hosted changed and nothing was sent; S1 remains unauthorized until the owner replies with the approval statement in that file.

## 16. S1 executed (2026-10-20 04:31 to 04:33 UTC)
The owner authorized S1 only (`auth5-s1-authorization-package.md`). `send-sms-notification` is now **v7** and `send-email` **v8**, both guarded and `verify_jwt` true, deployed from commit `baf1daab` and read back byte-identical to the Git blobs; nothing was invoked or sent; the database, ledger, Storage, Git and Netlify are unchanged; no other function changed. Details and hashes are in section 8 of the package. The next stage (S2, bookkeeping, the first database write) needs its own authorization and a fresh encrypted dump taken immediately before it, which also needs its own execution authorization.

