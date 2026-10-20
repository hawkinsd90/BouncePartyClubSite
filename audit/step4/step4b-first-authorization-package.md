# Step 4B: first operational authorization package (Development)

**Status: FOR OWNER REVIEW. NOTHING HOSTED-WRITING IN THIS PACKAGE IS AUTHORIZED (the read-only AUTH-1 and AUTH-2 were; see section 8).** It orders the steps, separates decisions already made from permissions still required, and asks for **one** permission first. It is not a request to authorize the Development rollout. Every later item needs its own approval. Sources: `development-deployment-runbook.md` (stages P0 and S0 to S15), `d02-restore-point-procedure.md`, `rollback-and-recovery-plan.md`, `owner-attestation-review.md`, `strategy-a-attestation-package.md`, `standard-migration-recovery-plan.md`.

## 1. Decisions already made (not asked again)
Netlify continuous deployment stays ON (frontend errors during the backend rollout are accepted). Temporary Development downtime is acceptable. No isolated SMS, e-mail or frontend hotfix. Functional and provider testing start only after the coordinated deployment. Stripe test mode and approved recipients later. Combined backup approach: verify a recent managed backup, take an encrypted `pg_dump -Fc` immediately before the first hosted database migration, prove it by a local restore, keep it until deployment and testing end, no PITR, Storage bytes accounted separately. The historical demo master account is disabled only after another master is verified, as a separate action. Strategy A in principle; the compatibility files A and B are in the repository and are recorded **without executing** on existing databases. The deny list, the manifests and the custom executor are temporary and retired in phases R0 to R5. Historical attestations and ledger bookkeeping are one-time reconciliation work. Production is not touched.

## 2. Development's current confirmed hosted state (read-only; dates)
| Fact | Value | Date |
|---|---|---|
| Project | `srxunxiytojjsuhcmzjg`, PostgreSQL 17.6, Pro plan, role `postgres` not a superuser | 2026-10-18/19 |
| Migration ledger | 58 rows, newest `20260929161925`; includes the remote-only version `20260814002658` | 2026-10-19 |
| Data | 171 orders, 185 payments, 9 auth users; database about 27 MB | 2026-10-19 |
| Storage | 500 objects, about 898 MB in 8 buckets | 2026-10-19 |
| Edge Functions | 42 deployed; `send-sms-notification` v6 and `send-email` v7 are the old versions (expected until S1) | 2026-10-19 |
| Schema | `public` contained (`anon`, `authenticated` have no USAGE); the sign-up trigger is absent | 2026-10-19 |
| Git/Netlify | `origin/Dev` is `aeb708e`; local `Dev` is ahead and not pushed; Netlify publishes `Dev` automatically | 2026-10-19 |
**Not yet confirmed (these are the purpose of the first authorization):** the dashboard backup list and ages, the integration toggles as they stand now, the exact fingerprints and ledger hash to be bound into the authorization, and the Storage inventory hash. The integration settings reported by the owner (Development: production branch `Dev`, Deploy to production ON, Automatic branching OFF) have not been read by me.

## 3. The ordered path and the permission each step needs
| # | Step | Kind | Permission still required | Pass criteria | Stop condition | Rollback |
|---|---|---|---|---|---|---|
| 1 | **Read-only verification session** (P0): ledger count and SHA-256 export, catalog fingerprint, row counts, Storage inventory (count, bytes, hash of names/sizes/etags), function list and versions, integration and Netlify settings read | hosted **read only**: hand-checked `SELECT` and catalog reads through the Supabase connector (its session is not itself read-only, so no statement other than a single SELECT is sent) plus dashboard reads | **AUTH-1 (the smallest first permission)** | values recorded; ledger still 58 rows/newest `20260929161925`; fingerprint equals the sealed start state | any difference from the figures above | none needed (nothing changed) |
| 2 | **Deploy to production OFF** for Development (D-03b); hold any Git push | owner toggle, hosted setting | AUTH-2 (owner performs; I do not change settings) | the toggle shows OFF; nothing pushed; `git ls-remote` equals the recorded refs | the toggle cannot be set | set the toggle back |
| 3 | **Managed backup verification** | dashboard read | AUTH-2 (same session) | a backup under 12 hours old is listed, or step 4 is taken at the window start and the managed one is the second copy | no backup listed | n/a |
| 4 | **Encrypted `pg_dump -Fc`** (owner machine, connection string kept in the shell; commands in `d02-restore-point-procedure.md`) | hosted read (dump) | AUTH-3 | dump, roles file and `ledger-before.txt` produced; SHA-256 recorded; encrypted copy stored outside Git with the passphrase in the owner's vault | `pg_dump` refused on a schema (use the documented fallback, do not widen privileges) | delete local plain copies after step 5 |
| 5 | **Local restore proof** | local only | AUTH-3 (same) | `pg_restore` errors limited to the two documented platform classes (`supabase_vault`, platform event-trigger ownership; the 2026-10-20 run: exit 1, 14 errors, all in those classes; `--exit-on-error` cannot be used against a platform dump); restored ledger export equals `ledger-before.txt` byte for byte (58 rows); fingerprint equals the hosted one per category; row counts and balance/payment sums equal; `anon` and `authenticated` still lack USAGE on `public` | any difference | D-02 stays unsatisfied; nothing hosted proceeds |
| 6 | **Storage decision** | owner decision | AUTH-3 (decision) | inventory only (recommended) or a byte copy of the 8 buckets (about 898 MB; `signed-waivers` about 498 MB is customer data, same encryption rules) | none | n/a |
| 7 | **Bind the fingerprints** into the hosted authorization document (ledger hash, fingerprint chain, restore-point id and time, package hash `5d63e4af339b481e48dcf5ec60a5ded758eba9a3dea2404a1f40b2d0762b7be0`) | document | AUTH-4 (S0 approval) | document passes the executor's checks (no hosted connection to build it) | any mismatch | n/a |
| 8 | **First hosted recovery stage: S1**, deploy the guarded `send-email` and `send-sms-notification` from the committed source (the first hosted mutation); read both hosted sources first; save the previous bundles | hosted mutation | AUTH-5 | unauthenticated and customer-token calls refused; no message sent; function versions listed | hosted source differs unexpectedly; any message sent | redeploy the saved previous versions; "Accidental real notification" procedure |
| 9 | Later stages S2 onward (bookkeeping, buckets, deploy-first functions, October block, Step 3B, push, containment release, verification) | hosted | one authorization **per stage group**, not requested now | per `development-deployment-runbook.md` | per stage | per stage; restore point and ledger comparison |
**Authorization status:** AUTH-1 and AUTH-2 were granted and are PARTIAL (section 8); AUTH-3 to AUTH-5 are listed so you can see the order and are not requested yet. I will ask for each when its predecessor is complete.

## 4. Stop conditions and rollback (apply to every step)
Stop at once and report if: the ledger or fingerprint differs from the recorded values; a message reaches an unapproved recipient; a live-mode Stripe event appears; the hosted source of a function differs unexpectedly; `git ls-remote --heads origin` differs from the recorded refs; the integration toggle is not OFF. Rollback order: undo the last stage's own recovery step (redeploy a saved function, the stage's documented recovery), then compare the ledger with the stage-start export, and use the restore point (managed backup or the verified dump) only for data loss. A ledger edit is never the recovery. Details: `rollback-and-recovery-plan.md`.

## 5. Where the historical approvals fit (one-time; nothing is approved or signed)
| Approval | Count | Taken at | Notes |
|---|---|---|---|
| History-only batches | 225 | S2 (the pre-October part, with the canary row) and S8 (the deferred part) | batch approval; no individual signature |
| Step 2 attestations | 46 | S2 (44) and S8 (2) | per-version signatures presented in groups (`e2k-attestation-decisions.md`) |
| Bucket-limit SQL | 2 | S3 | exact SQL approved |
| Sealed package SQL | 28 | S5 (23) and S7 (5) | executor, exact versions |
| Withheld rows | 17 | S8 | recorded as history-only after October |
| **The 13 disputed versions** | 13 | after S12, with the alias items, before S15 | **paused**; reviewed individually in `owner-attestation-review.md`; four need a separate deny-list exception id; the marker SQL needs the sealed-package and alias rows first |
| Alias reconciliation | 1 file + 1 row | the file is prepared (below); the row `20260814120000` is recorded after S12 with the 13 | Development already has the row for `20260814002658` |
| Compatibility rows A and B | 2 | after S12, with the 13 | recorded without executing |
None of these is needed for steps 1 to 8 above except the S2 attestations when S2 is reached.

## 6. Owner decisions versus permissions still required
| Already decided | Still required (separate, in order) |
|---|---|
| everything in section 1 | AUTH-1 read-only session; AUTH-2 controls and backup read; AUTH-3 dump, restore proof and Storage choice; AUTH-4 the S0 approval record; AUTH-5 the first mutation (S1); one approval per later stage group; the one-time historical approvals at their stages |

## 7. New-environment prohibition (recorded)
A newly initialized BPC database (built from these migrations) must not be exposed to real customers until its demo master account, migration-generated sample content, security controls and outbound notification settings pass the new-environment acceptance criteria N1 to N6 in `standard-migration-recovery-plan.md` section 9.6. This is separate from the Development recovery above and does not block it. No historical migration file is modified, and the historical demo credential is neither used nor repeated.

## 8. Authorization status (updated after AUTH-2, 2026-10-20)
| Authorization | Scope | Status |
|---|---|---|
| AUTH-1 | read-only Development baseline | **PARTIAL.** Database baseline complete and matching; configuration items UNVERIFIED (`auth1-development-baseline.md`) |
| AUTH-2 | verify the Supabase integration, Netlify and managed backups | **PARTIAL (qualified).** Owner screenshots show Deploy to production OFF, Automatic branching OFF, seven managed backups (latest 2026-10-19 10:56:30 UTC) and the Netlify repository; **unresolved:** the Supabase branch record changed to `main` / empty after the save (branch not re-verified as `Dev`: the Development "Production branch name" field now shows blank with Deploy OFF; not corrected); Netlify builds-active, PITR and compute size UNVERIFIED |
| AUTH-3 | backup workflow (section 9; `auth3-backup-execution-checklist.md`) | **EXECUTED 2026-10-20 02:45 UTC.** Application data, authentication data, migration ledger, schema fingerprints, Storage metadata and containment: PASS. Local PostgreSQL restore: PARTIAL (14 platform-object errors: vault, event-trigger ownership). Full managed-Supabase restoration equivalence: NOT PROVEN. Storage Option A (no object bytes). Owner rule: zero unexpected loss of Development business data |
| AUTH-4 | S0 approval and the P0 read-only preflight | **APPROVED and EXECUTED 2026-10-19 23:59 EDT / 2026-10-20 03:59 UTC; P0 clean** (`s0-authorization-request.md` sections 10 and 11) |
| AUTH-5 | S1 only: deploy the two guarded relays | **APPROVED and EXECUTED 2026-10-20 04:31 to 04:33 UTC; E4 verification clean** (`auth5-s1-authorization-package.md` section 8): `send-sms-notification` v7 and `send-email` v8, `verify_jwt` true |
| AUTH-6A | S2 prerequisite: a fresh encrypted Development backup and its isolated restore proof (no migration, no ledger write) | **EXECUTED AND PASSED 2026-10-20 12:06 UTC** (`s2-authorization-package.md` section 8) |
| AUTH-6B | S2 first database write: the canary batch B01 only (one history-only ledger row) | **EXECUTED 2026-10-20 12:16:50 UTC**: ledger 58 to 59 rows, SHA-256 `99f57ab9…` as predicted, fingerprint 11/11 equal, business data equal (`s2-authorization-package.md` section 9) |
| Later stages | the rest of S2 (batch approvals, signed attestations) and S3 onward | not authorized |
**Still needed from the owner (AUTH-2 residue):** (a) a screenshot of Supabase Project Settings > Integrations > GitHub showing the "Production branch" field and branch selector (resolves the `main` question; do not change it); (b) optionally the Netlify Build & deploy status (builds active, no lock) and the Add-ons page (compute size, PITR). None blocks preparing AUTH-3, but (a) must be read before any restoration of automatic deployment (G-25).

## 9. AUTH-3 handoff (the smallest next authorization; not requested now)
AUTH-3 would cover, in this order, and nothing else:
1. Fresh pre-backup read-only verification: ledger count and SHA-256 (expect `ca686c2d620154142ad9d9908c5c093a16a709df35c1c6860ed65c8bef24b999`) and the 11-category schema fingerprint.
2. Confirmation that a managed backup is recoverable (from the AUTH-2 dashboard values; a restore is not performed).
3. The encrypted `pg_dump -Fc` of Development (owner machine; commands in `d02-restore-point-procedure.md`), plus a roles-only file.
4. Capture of roles, extensions and metadata needed for the restore.
5. An isolated local restore (scratch PostgreSQL only).
6. Comparison of ledger export, fingerprint, row counts and the financial aggregates (171 orders; balance due 1,344,396; deposits paid 856,550; 185 payments totalling 2,496,274).
7. Containment check after the restore (`anon` and `authenticated` still lack USAGE on `public`).
8. Storage inventory reconciliation (500 objects, 941,404,649 bytes, metadata md5 `0260dd1cb6d342f37301be6813be3bf7`).
9. Secure retention of the encrypted dump until deployment and integration testing end.
**What the dump covers:** all database schemas the `postgres` role can read, including `auth`, the Storage **metadata rows** and the migration ledger. **What it does not cover:** the Storage **object bytes** (941 MB, of which 522 MB are signed waivers), Edge Functions and their secrets, dashboard and integration settings, and custom-role passwords. The Storage bytes need a separate owner decision (inventory only, recommended, or a byte copy). No purchase (PITR or otherwise) is required unless the AUTH-2 reads show that no usable managed backup exists.
**Before AUTH-3 the owner confirms** (full list in `auth3-backup-execution-checklist.md` section 11): the Storage decision; where the encrypted dump will be kept and who may read it; the owner rule of zero unexpected loss of Development business data; and that the connection string will be supplied only in the owner's shell. **AUTH-3 does not authorize any hosted write, push, deployment or migration.**
