# S0 authorization request (Development recovery): for owner review

Status: **PREPARED FOR OWNER REVIEW. NOT APPROVED. NOTHING HOSTED HAS BEEN DONE FOR S0, S1 OR ANY LATER STAGE.** This file changes no migration, no sealed package and no executor code. It follows `development-deployment-runbook.md` (P0, S0, S1) and `step4b-first-authorization-package.md`; it is not a new audit.

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
| Restore point accepted | encrypted dump `dev-20261020T0245Z` (2026-10-20 02:45 UTC) plus a fresh dump before S2: yes / no |
| Rollout window (start, end, UTC) and on-call person | needed |
| No real customer expected on Development during the rollout | yes / no |
| Test recipients confirmed (e-mail, phone) | needed |
| Executor design (temporary recovery control, retired at R0 to R5) reviewed | yes / no |
Not authorized by this record: `supabase db push --include-all`, any historical migration repair, any ledger write, any push, any Netlify change, any Storage change, any Production action.

## 9. Next action
Reply with the window and on-call person, the two test recipients and yes/no on the rows above; that approves AUTH-4 (read-only P0). I then run P0 and report; AUTH-5 (S1) is requested only after P0 is clean and section 7 is closed.
