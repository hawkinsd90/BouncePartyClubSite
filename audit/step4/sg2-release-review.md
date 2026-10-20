# SG-2 final release review (2026-10-20), before AUTH-11

Status: **REVIEW COMPLETE. NO RELEASE BLOCKER FOUND. AUTH-11 IS NOT YET AUTHORIZED AND NOTHING OF SG-2 WAS EXECUTED.** Hosted activity in this review was read-only on Development (`srxunxiytojjsuhcmzjg`); Production was not contacted; nothing was pushed.

## 1. S2 close-out

- Ledger re-read just now: **303 rows, `b4f1f35ef890f200286199c84d0b3b76659453ba11ed20cac980b4bf3f828176`**, equal to the prediction and to the last batch of `s2-auth10-execution-evidence.md`.
- Operator log `s2-operator-log.jsonl`: 34 entries, every `prev_entry_sha256` equals the previous entry's hash (checked after writing the 14 AUTH-10 entries).
- Integrity after B40 (all unchanged): 11 of 11 catalog category digests (canonical search path), business aggregates, Storage 500 objects / 941,404,649 bytes (500 objects re-counted today), `anon` and `authenticated` without USAGE on `public`, both compromised accounts still banned until 2026-11-13.
- Failed commands during the AUTH-10 work, classified: **zero hosted failures.** Every failure was local tooling: shell quoting/escape mangling in heredocs (several, fixed by writing files with the editor tool), a Windows `cp1252` console error printing an arrow character, `/dev/null` not existing on Windows for a validator smoke call, and a log-query call with a wrong parameter. None changed any hosted system or any committed evidence; all are harmless.

## 2. S3 bucket changes (B23, B24) — confirmed

- `carousel-media`: `file_size_limit` NULL to **524288000 (500 MB)**. Existing: 5 objects, all `image/jpeg`, largest 2,149,287 bytes.
- `public-assets`: `file_size_limit` NULL to **10485760 (10 MB)** and `allowed_mime_types` NULL to `image/png, image/jpeg, image/jpg, image/gif, image/webp, image/heic, image/heif`. Existing: 246 objects (242 `image/jpeg`, 4 `image/png`), largest 5,212,993 bytes.
- The statements are `UPDATE storage.buckets` on those two rows only. **No object, object metadata or policy is touched**; limits and MIME lists apply to future uploads. All 251 existing objects already satisfy the new limits and lists.
- Behavior note (not a blocker): `public-assets` currently accepts any file type (NULL). After B24 non-image uploads are refused. No code under `src/` or `supabase/functions/` uploads to `public-assets` any more (the new evidence pipeline writes to the private bucket); the bucket keeps serving the logo and historical photos.
- Note: a bucket limit cannot exceed the project-wide Storage upload limit, which this connector cannot read. If that global limit is below 500 MB the new carousel limit is simply not reachable; that is a dashboard setting, benign, and an acceptance-test item.
- The five platform triggers on `storage.buckets` do not fire for these columns (section 0 of `sg2-authorization-package.md`). Reversal scripts restore NULL/NULL, the values just re-read. Post-S3 ledger predictions: 304 rows `3c31b2a2…`, 305 rows `72cafdac…`.

## 3. The 21 functions — confirmed

- Recomputed today: every bundle hash equals `sg2-package/package.json`; the shared tree (54 files) equals `6ea09ce8…`; every function has `index.ts`; every relative import resolves inside its own folder or `_shared`; no remote (`https:`) code import exists; external imports are pinned (`npm:@supabase/supabase-js@2.57.4`, `npm:stripe@20.0.0`, `npm:jspdf@2.5.2`, `jsr:@supabase/functions-js@2`).
- The explicit `verify_jwt` value of all 21 equals `supabase/config.toml` and the deployment matrix (`false` for 14, `true` for 7: create-order-short-link, get-payment-method, get-session-metadata, staff-order-save, stripe-refund, task-evidence, upload-physical-waiver). Hosted today: the 10 existing functions have exactly the matrix versions and values; the 11 new ones are absent. The relays `send-email` v8 and `send-sms-notification` v7 are unchanged.
- **Secrets, by name only.** Required by the code: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` (platform-provided to every hosted function) and one custom secret, `SITE_URL` (only `request-portal-link`; it falls back to `https://bouncepartyclub.com`). The connector cannot list hosted secret names; whether `SITE_URL` exists is unverified.

## 4. Caller and authentication compatibility

- `upload-physical-waiver` (`false` to `true`, the D-JWT-1 flip): its two callers are `WaiverTab.tsx` (customer portal; `fetch` with `Authorization: Bearer <VITE_SUPABASE_ANON_KEY>`) and the admin task modal (supabase client, user session). Development exposes the **legacy anon JWT key** (enabled; the local `.env` uses it), which the gateway accepts under `verify_jwt = true`; the function then authenticates the real user or the portal token itself (it already tolerates an anon bearer: "falls through to the token path"). A `sb_publishable_…` key would be refused by the gateway, but the site is configured with the JWT key. Compatible. Netlify's own value of `VITE_SUPABASE_ANON_KEY` cannot be read from here; it should be the same key.
- `get-session-metadata`, `get-payment-method`, `create-order-short-link`: no caller exists in `src/`, `supabase/functions/` or `supabase/migrations/` (tests and the executor only). No committed workflow depends on them.
- `staff-order-save`, `task-evidence` (new, `true`): admin-only paths called with the user session. `stripe-refund` (`true`, unchanged). The 14 `false` functions keep their public, token-authenticated behavior. No customer, payment, waiver or crew workflow loses access by this deployment; the new functions are deployed ahead of the frontend that will use them (S9).
- Hosted function logs: the log-query tool here exposes no resolvable function-log tables, so **hosted-log caller evidence was not obtained**. It is only extra evidence for the three no-caller functions; the dashboard (Logs, Edge Functions) provides it if you want it.

## 5. Canary (S4b)

`g16-storage-canary.sql` is byte-identical to the reviewed file (SHA-256 LF `7bcd38d9e1c8cf105af7174448fd33c1ac3400baef65728e39096862d4e61dd4`). Its precondition list of six `storage.objects` policy names equals the six live names (read just now). The approved success signal is unchanged: the statement must END in `ERROR: BPC-CANARY-OK`; any other error stops the rollout.

## 6. Findings and classification (none blocks SG-2)

| Finding | Class | Dependency |
|---|---|---|
| `request-portal-link` falls back to the Production domain when `SITE_URL` is unset; the secret is set at S6 (gate G-06) | REQUIRED BEFORE DEVELOPMENT ACCEPTANCE | S4 smoke tests must not take the send path (negative tests only); guarded relays also limit recipients to the four owner-approved destinations |
| Hosted secret names unreadable by the connector | DEFERRED | owner can confirm `SITE_URL`, `RETURN_ORIGINS` in the dashboard before S6 |
| Hosted-log caller evidence for three functions not obtainable here | DEFERRED | optional dashboard check |
| Project-wide Storage upload limit may cap the 500 MB carousel limit | DEFERRED (acceptance test) | dashboard setting |
| `public-assets` stops accepting non-images | DEFERRED (documented behavior) | no current uploader |
| Hard-coded Production URLs in function strings (logo image in e-mail templates, a CORS/origin default) | DEFERRED | S6 secrets and the S15 reviewed commit |

**Conclusion: AUTH-11 can be sent as drafted** (`sg2-auth11-approval-text.txt`). The only owner decisions that change release behavior are the ones already in the checklist: SEC-021 limits, the D-JWT-1 release for `upload-physical-waiver`, creating the 11 new functions, and G-16.
