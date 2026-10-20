# AUTH-5 / S1 authorization package: deploy the two guarded notification relays to Development

Status: **AUTHORIZED BY THE OWNER AND EXECUTED (2026-10-20 04:31:57 UTC and 2026-10-20 04:33:30 UTC); E4 verification clean (section 8). No other stage is authorized.**

## 1. Owner decisions recorded (2026-10-20)
| Gate | Decision | Status |
|---|---|---|
| G-02 recipients | all four destinations are owner-controlled: SMS `+17343588854`; e-mail `hawkinsd90@gmail.com`, `deveehawk@gmail.com`, `neverforgetthevibes@gmail.com` (constants in `supabase/functions/_shared/notifications/outbound-guard.ts` lines 24 to 30); no change requested | **APPROVED** |
| D-JWT-1 relays | `verify_jwt = true` for `send-email` and `send-sms-notification`; in-function authorization stays; the legacy JWT API keys stay enabled; no move to non-JWT `sb_secret` keys without a separate review | **APPROVED** (hosted change not yet authorized) |
| G-14 window | open only while the owner supervises; the owner is on call; stop between stages when the owner is unavailable; no fixed end time (**owner-approved supervised-window exception**); the owner **reconfirms availability immediately before deployment** | **APPROVED** |
| G-01 C5 Twilio | Development uses **live** Twilio credentials, not a sandbox. **A live credential is not permission to send.** The guard stays mandatory; no customer-directed test; no message during preparation; no unguarded fallback; no automatic invocation after deployment; any functional SMS test needs its own authorization with an owner-controlled recipient and test event | **OWNER-CONFIRMED** (not independently verified through Twilio) |
| G-01 C7 Resend | sending domain verified, Development key has sending permission, recent activity checked; the e-mail guard stays mandatory | **OWNER-CONFIRMED** (not independently verified through Resend) |

## 2. Target and source
| Item | Value |
|---|---|
| Hosted target | Development Supabase project `srxunxiytojjsuhcmzjg` only. Production `qaagfafagdpgzcijnfbw` is never touched |
| Source commit / tree | `baf1daab2ca6c56d4176278a9b2dc60bbf39362f`, tree `8e8693834cd6db9970142fe8f690100564a5dd31`, branch `Dev` (116 ahead, 0 behind `origin/Dev` `aeb708e`); nothing pushed |
| Uncommitted source differences | **none** under `supabase/`; only audit documents are uncommitted. S1 is bound to the five blobs below, so later documentation commits do not change it; S1 refuses if any blob hash differs |
| Deployed bytes | exactly `git show HEAD:<path>` (LF, no carriage returns); not the working-tree copies |
| Deployed files | the five below. No `deno.json` (the hosted v6 and v7 have none; both relays import `npm:@supabase/supabase-js@2.57.4` directly) |
| Layout | repository layout, so `../_shared/...` resolves as it does locally and as on the existing hosted functions (for example `charge-deposit` is served from `source/supabase/functions/charge-deposit/index.ts`) |
| `config.toml` | `[functions.send-email] verify_jwt = true` (line 88) and `[functions.send-sms-notification] verify_jwt = true` (line 97): equal to the approved intent |
| File | Git blob | Bytes | SHA-256 |
|---|---|---|---|
| `supabase/functions/send-email/index.ts` | `30472d4660835731dc71f71c24dd2804f85412bb` | 14,402 | `4722398c75c3a94de67d8918610ba8b380049ef46b25c324451661236c259f2e` |
| `supabase/functions/send-sms-notification/index.ts` | `79c45675a022971ffec6456967b38f9abd1be910` | 17,663 | `893dc97eb14dcbbf29ab536be17a155dec94e749327d9bd323679285d51dcaf4` |
| `supabase/functions/_shared/auth.ts` | `a93a110c61bebc37bd293a9e179b008b7817c7cc` | 24,191 | `f65acc9fd88cf31bfcc7d8f78c08a2e0c2bb9ee1a768082b15090144dbe23d8b` |
| `supabase/functions/_shared/notifications/outbound-guard.ts` | `e91f376cf2b21b26b2e6de9500c741f0e4cab3d2` | 7,998 | `ec2c1525505613a37ab027fe0347609a0a1f25c053191dce3efb364d8fa13890` |
| `supabase/functions/_shared/format-order-id.ts` | `5f736495a6b406c1a4b15a78228f9a8b669b42cc` | 363 | `7e097dec79aabd1ef850112876d0defda990d32294ba8f6469b8db17758df600` |
`send-email` uses `auth.ts` and `outbound-guard.ts`; `send-sms-notification` uses `auth.ts`, `outbound-guard.ts` and `format-order-id.ts`. `auth.ts` and the guard have no relative imports.

## 3. Source review (local; 2026-10-20)
| # | Check | Result |
|---|---|---|
| 1 | Development recipient redirection before any provider | `send-email` calls `decideOutbound('email', supabaseUrl, emailTo)` at line 283 and `send-sms-notification` calls `decideOutbound("sms", supabaseUrl, toPhone)` at line 305; the provider request is built from `delivery.recipient` only, after the guard |
| 2 | Every outbound provider call passes through the guard | exactly two provider requests exist in the repository's functions (`api.resend.com` in `send-email` line 309, `api.twilio.com` in `send-sms-notification` line 331); both follow the guard. No other function calls either provider |
| 3 | No exception or fallback permits a real customer message | an unknown environment or unsafe destination list returns 503 and sends nothing; the failure fallbacks (e-mail to SMS, SMS to e-mail) call the other relay with the service key, so they pass the same guard; `skipFallback: true` prevents loops |
| 4 | Live Twilio credentials cannot bypass the guard | the Twilio credentials are read only inside the relay and used only in the request that follows the guard; there is no other reader. **Outside the relays:** `twilio-webhook` can reply to an inbound text with TwiML (not a relay send). Today the gateway refuses Twilio's unauthenticated webhook (hosted `verify_jwt` true), so no reply happens; the number's webhook target (C6) must be reviewed before any change to that function |
| 5 | E-mail fallbacks stay guarded | yes (item 3); the fallback SMS goes to the relay and is redirected to `+17343588854` |
| 6 | No deployment-time initialization sends messages | both files do nothing at load except register `Deno.serve`; deploying a version does not invoke it |
| 7 | Authenticated application callers work with `true` | staff, admin, master and crew session JWTs and the service-role JWT all pass the gateway and the in-function check (`s0-authorization-request.md` section 14.2) |
| 8 | Anonymous or unauthorized callers cannot send | `authorizeRelayCaller` is the first step after parsing the body: anonymous 401, non-staff 403, crew limited to the pickup templates for the order's own customer; failures are recorded and fallbacks sent only after authorization |
| 9 | Service-role callers stay compatible | the service key is matched by value (constant-time) against the function's own environment key, and is a legacy JWT that the gateway accepts while the legacy keys are enabled (they are) |
| 10 | Intended settings match `config.toml` | yes (section 2) |
| 11 | No secret value printed or logged | the logs contain object names, booleans, provider status codes and error messages, never a key, token or password; provider credentials come from `admin_settings` and are never echoed |
| 12 | Suitable for coordinated deployment | yes: no schema, no ledger, no Storage and no Netlify dependency |
Observations that are not blockers: the guard keeps the original recipient in the subject, SMS prefix and banner and in `sms_conversations` (by design); `Access-Control-Allow-Origin: *` is pre-existing. **No concrete security issue was found.** Local tests this task: relay authorization, outbound guard, edge auth helpers, development execution manifest, executor (counts in the report).

## 4. Rollback readiness: READY
| Item | State |
|---|---|
| Hosted now | `send-email` **v7**, `send-sms-notification` **v6**, both `verify_jwt false`; `ezbr_sha256` `54369442bac6ae837a5bb3765a95ac9720feb882f49b4a9c063a9e332529ed71` and `9f6590283fdc9f75635c29641f6425ed8d462b63bbd17501ab8bf71254c2fdf4`; unchanged since AUTH-1 and P0 |
| Previous source, compared in full | the hosted v7 and v6 sources (and the shared `format-order-id.ts`) were read through the connector and compared **line by line, in full** with the `origin/Dev` copies (`aeb708e`): **no difference** except a missing final newline in the Git copy. The shared file is byte-identical (SHA-256 `7e097dec…`). Timestamps agree: Git commit 2026-08-14 01:02:40 UTC vs hosted v7 updated 01:02:35 UTC; Git commit 2026-07-01 01:29:58 UTC vs hosted v6 updated 01:29:46 UTC |
| Immutable rollback sources | Git blobs at `aeb708ed9d5f0fbc2b146a52d378babd07024b30`: `send-email/index.ts` `f2f9f15f25d0c960eba3893621bf79ac4bfbc465`, `send-sms-notification/index.ts` `a5c6f067cdd756176c69cf990b142bdb5bf906d9`, `_shared/format-order-id.ts` `5f736495a6b406c1a4b15a78228f9a8b669b42cc` |
| Local rollback copies (outside Git, source code only, no secrets) | `C:\Users\vikki\BPC-Backups\s1-rollback-functions-20261020\` with `SHA256SUMS.txt` (`send-email.v7.hosted.ts`, `send-sms-notification.v6.hosted.ts`, `format-order-id.hosted.ts`) |
| Limit | the comparison used the connector's inline response, not a machine download (the Supabase CLI is not logged in, and logging in is an owner credential action). The line-by-line result, the timestamps and the unchanged versions make a material difference very unlikely; for an exact download the owner may run `supabase login` and `supabase functions download send-email send-sms-notification --project-ref srxunxiytojjsuhcmzjg --use-api` into a folder outside Git, and I compare it with the Git blobs (optional, not required) |
| Restore procedure | redeploy the saved sources with `verify_jwt` **false** (the previous hosted value) through the same deployment tool, each as a new version, then confirm versions and flags. Rolling back restores the **unguarded** relays, so it is a last resort; the normal response to a defect is to fix forward. After any rollback no message may be sent until the guarded versions are redeployed |

## 5. Execution plan (S1 only; each step stops on any mismatch)
**E0 (owner present).** The owner reconfirms availability and that the window is open. Read-only checks: `git rev-parse HEAD` and the five blob hashes equal section 2; `git ls-remote --heads origin` equals `Dev` `aeb708e`, `main` `b79ca480`; `get_project` is `srxunxiytojjsuhcmzjg`; the ledger count and SHA-256 (58 rows, `ca686c2d…`) and the orders and payments counts (171, 185) equal P0; `list_edge_functions` still shows 42 functions with the two relays at v7 and v6, `verify_jwt` false, the `ezbr_sha256` values above.
**E1.** Re-read both hosted sources and compare them with the saved rollback copies. Any difference stops S1.
**E2. Deploy `send-sms-notification` first** (SMS is the more intrusive channel and Twilio is live). One call of the Supabase connector tool `deploy_edge_function` with `project_id` `srxunxiytojjsuhcmzjg`, `name` `send-sms-notification`, `entrypoint_path` `supabase/functions/send-sms-notification/index.ts`, **`verify_jwt` `true`**, and `files` = the four files `supabase/functions/send-sms-notification/index.ts`, `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/notifications/outbound-guard.ts`, `supabase/functions/_shared/format-order-id.ts`, each with the exact content of `git show HEAD:<path>`. No `import_map_path`.
**E3. Deploy `send-email`.** The same tool with `name` `send-email`, `entrypoint_path` `supabase/functions/send-email/index.ts`, **`verify_jwt` `true`**, and `files` = `supabase/functions/send-email/index.ts`, `supabase/functions/_shared/auth.ts`, `supabase/functions/_shared/notifications/outbound-guard.ts`. (The Supabase CLI equivalent, not planned, would be `supabase functions deploy <name> --project-ref srxunxiytojjsuhcmzjg --use-api` with `config.toml` supplying `verify_jwt = true`; it needs the owner's login.) A failed deployment creates no version.
Between E2 and E3 (under a minute) the old `send-email` v7 is still unguarded; nothing invokes it (no customers, no schedule, no database caller).
**E4. Read-only verification (nothing is invoked).** `list_edge_functions`: `send-sms-notification` at v7 and `send-email` at v8, both `verify_jwt` **true**, new `ezbr_sha256` values recorded, the other 40 functions unchanged (versions, flags, update times); `get_edge_function` for both shows the expected file names and the guard in the source (`decideOutbound`, `authorizeRelayCaller`); `query_logs` for the two functions since E2 shows **no invocation**; `sms_conversations` count unchanged (1,039) and the ledger unchanged (58 rows, `ca686c2d…`).
**E5.** Record the evidence locally (versions, hashes, outputs); uncommitted until the owner approves. Then stop: S2 and later stages need their own authorization, and the fresh encrypted dump required before S2 needs its own execution authorization.

## 6. Safeguards, exclusions and stop conditions
**Not part of S1:** migrations, ledger or data writes, Storage changes, customer records, Git push, Netlify, any test or real message, any webhook invocation, any Stripe or Twilio call, re-enabling Supabase automatic migrations, Production. **No automatic invocation after deployment. No OPTIONS preflight or other request to the relays is included** (it would be an invocation); a later, separately approved check may add one.
**Stop at once, change nothing further, and report if:** a source or blob hash differs; a hosted source differs from the saved copy; the project is not `srxunxiytojjsuhcmzjg`; the ledger or counts differ; a function other than the two relays changes; any invocation, message, provider event or webhook appears in the logs; `verify_jwt` is not `true` on either relay afterwards; the rollback copies are missing; the owner is unavailable (stop between steps).

## 7. Approval statement (reply with this, or edit it)
"I authorize S1 only, as described in `audit/step4/auth5-s1-authorization-package.md`: deploy `send-sms-notification` and then `send-email` to Development project `srxunxiytojjsuhcmzjg` from commit `baf1daab` with `verify_jwt` true, after the E0 and E1 checks, followed by the read-only E4 verification. I am available now. No other stage, message, test, Git push, Netlify change or Production action is authorized."

## 8. Execution record (2026-10-20; S1 only)
Authorization: the owner clicked the approval statement of section 7 (the message text reached me cut off after "I am avai", which is the start of "I am available now"; the clicked button is the immediate reconfirmation of availability required by G-14, and the exclusions of section 6 stayed in force).
| Step | Result |
|---|---|
| E0 | `HEAD` `baf1daab…`, the five blob hashes equal section 2, `origin/Dev` `aeb708e` and `origin/main` `b79ca480`, no uncommitted file under `supabase/`; project `srxunxiytojjsuhcmzjg`; ledger 58 rows `ca686c2d…`, orders 171, payments 185, `sms_conversations` 1,039, Storage objects 500; 42 functions with the relays at v7 and v6 (`verify_jwt` false) and their recorded `ezbr_sha256` values |
| E1 | the `ezbr_sha256` of the hosted bundles of both relays equals the values whose full sources were compared line by line with the saved rollback copies (a bundle hash identical to the one already compared proves the source did not change); no difference |
| E2 | `send-sms-notification` deployed: **v7, `verify_jwt` true**, 2026-10-20 04:31:57 UTC, `ezbr_sha256` `2fceff7f2c24fe6ea6d3159b8731cb03630439b4076abd33268d79fa7e3c117e`, four files |
| E3 | `send-email` deployed: **v8, `verify_jwt` true**, 2026-10-20 04:33:30 UTC, `ezbr_sha256` `38d67a82918252f3cae1cd7f48257879d42fac1627b768c28a64d824d3d2fe36`, three files |
| E4 | the full function list: 42 functions, 18 with `verify_jwt` true (16 + the two relays); the **only** differences from the AUTH-1 record are the two relays (version, flag, update time); the other 40 are unchanged. The deployed `send-sms-notification` source was read back and is **byte-identical** to the four Git blobs (SHA-256 `893dc97e…`, `7e097dec…`, `f65acc9f…`, `ec2c1525…`). The deployed `send-email` source was read back and its three files are identical to the blobs (compared after a second independent transcription; hashes `4722398c…`, `f65acc9f…`, `ec2c1525…`). Edge logs for the window 04:20 to 04:40 UTC contain **no function invocation and no request to `functions/v1`**; ledger unchanged (58 rows, `ca686c2d…`), orders 171, payments 185, `sms_conversations` 1,039, Storage objects 500 |
Nothing was invoked, no message was sent, no OPTIONS or other request was made to the relays, no database, ledger, Storage, Git, Netlify or Production action occurred. The rollback copies remain in `C:\Users\vikki\BPC-Backups\s1-rollback-functions-20261020\`; restoring them means redeploying them with `verify_jwt` false (section 4), which would bring the unguarded relays back and is a last resort. The deployed layout is `functions/<name>/index.ts` with `functions/_shared/...` beside it (the platform normalizes the `supabase/` prefix); the relative imports resolve.

