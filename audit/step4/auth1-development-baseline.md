# Step 4B AUTH-1: Development baseline (read-only verification, 2026-10-19/20)

**Status: AUTH-1 = PARTIAL (see section 9 for the AUTH-2 addendum: AUTH-2 = PARTIAL).** The database baseline (ledger, schema fingerprint, aggregate data, Storage metadata, Edge Function metadata) is complete and agrees with the expected Development baseline. Part of the configuration check is **UNVERIFIED** because the authorized read-only tools cannot read the Supabase integration toggles or the Netlify continuous-deployment toggle (section 6). Nothing was changed. Structured values: `auth1-development-baseline.json`. This record is deliberately **uncommitted** (no third commit without separate authorization).

## 1. Scope and safeguards
- **Development only** (`srxunxiytojjsuhcmzjg`). Production (`qaagfafagdpgzcijnfbw`) was **not** queried.
- The connector session reports `transaction_read_only = off` and role `postgres`: **the connection itself is not read-only.** No database-enforced read-only role was available without changing configuration, so safety rested on the submitted statements: each was one reviewed `SELECT` or catalog query (the fingerprint statement is the repository's `DIGEST_ROWS`). No DDL, DML, `SET`, temporary object, migration command, application function or SECURITY DEFINER function was used; no secret, individual customer or payment record, message body or Storage object was read; no provider API was called.
- The session `search_path` is `"$user", public, extensions`. The fingerprint was therefore **not** run with `SET LOCAL search_path = pg_catalog` (a session-setting change); instead the local baseline template was evaluated under the same search_path (section 3).

## 2. Migration ledger (expected: 58 rows, newest `20260929161925`)
| Check | Expected | Observed | Result |
|---|---|---|---|
| Rows | 58 | 58 | match |
| Minimum / maximum | `20251001051900` / `20260929161925` | same | match |
| Sorted version list | the Step 2 capture (`audit/evidence/derived/dev-ledger-versions.txt`) | md5 of the list `093346c640a120a00b8cb32f5a5b0454` equals the capture's | **identical set; no new or missing version** |
| Version+name md5 | local Development-baseline template | `70154db57cc5e8f86a008571ee02ade9` equals the template's | match |
| Ledger SHA-256 including statement md5 (the value to bind into the S0 authorization) | not comparable (the local template's rows carry synthetic statement text) | `ca686c2d620154142ad9d9908c5c093a16a709df35c1c6860ed65c8bef24b999` | recorded |
| Alias row | present | `20260814002658`, name `20260814120000_create_contact_inquiries.sql` | present |
| `20260814120000` (original) | unrecorded | not recorded | as expected |
| The 13 disputed versions | unrecorded | none recorded | as expected |
| Compatibility A `20260324175545`, B `20260615175815` | unrecorded | neither recorded | as expected |
| October (23) and Step 3B (5) versions | pending | 0 recorded | as expected |
| Withdrawn Cases 41-43 and the demo-admin version | not recorded | none recorded | as expected |

## 3. Schema fingerprint (`scripts/dev/hosted-executor/lib/fingerprint.cjs`, 11 categories)
Observed (digest / count): `bkt 7d8cac3a…/9`, `col a63239ea…/804`, `con 3ab6496d…/235`, `ext 5f40a353…/4`, `fn 3a11af85…/82`, `idx b3988572…/237`, `nsp c20defe7…/2`, `pol 8ee2e2c1…/228`, `pub 350879c0…/8`, `rel e3bdf399…/69`, `trg f729c8fe…/37`.
- **Equal on all 11 categories** to the local Development-baseline template `bpc_replay_e2i_devbase`, evaluated under the same search_path.
- The sealed package's recorded start state differs from this only in `bkt` (`0bc770f2…/9`), which is the state **after** the two S3 bucket-limit updates. That is expected: S3 comes later, so the S0 binding uses the post-S2/S3 base ledger (60 rows), not today's.
- Deparse-dependent digests are valid only for this search_path; the comparison would not hold for a session with a different path (limitation, section 7).

## 4. Schema facts and data aggregates (aggregate-only)
| Item | Observed |
|---|---|
| Public base tables / policies / functions | 67 / 222 / 82 (68 SECURITY DEFINER; 75 executable by `anon`, contained by the schema revoke) |
| Containment | `anon` and `authenticated` have no USAGE on `public`; `service_role` does; schema owner `postgres` (intact) |
| Sign-up trigger | no user trigger on any `auth` table; `auto_assign_customer_role()` present (as recorded) |
| Realtime | `supabase_realtime` owned by `postgres`, member `orders`; `supabase_realtime_messages_publication` owned by `supabase_admin` |
| Storage-policy ownership | `storage.objects` and `storage.buckets` are owned by `supabase_storage_admin`; `postgres` is **not** a member; 6 policies on `storage.objects` (consistent with gate G-16: the three storage-policy files cannot run as `postgres`) |
| Critical schema | `pricing_rules` 26 columns with all key columns present; `orders` 113 columns with all key money/date columns present |
| Orders | 171; sum of `balance_due_cents` 1,344,396; of `deposit_paid_cents` 856,550; of `tip_cents` 74,928 |
| Payments | 185 (all `succeeded`); sum of `amount_cents` 2,496,274 |
| Other | pricing rules 1; auth users 9; customers 123; customer profiles 6; user roles 9; units 16; unit media 35; admin settings 37; webhook events 0 |
| Table population | 47 of 67 public tables non-empty; 5,074 rows in total |
No individual record was retrieved.

## 5. Storage metadata (no object was read)
500 objects, 941,404,649 bytes (about 898 MiB) in 8 buckets that hold objects, 9 buckets in total (`physical-waivers` is empty); metadata md5 `0260dd1cb6d342f37301be6813be3bf7`.
| Bucket | Public | Objects | Bytes |
|---|---|---|---|
| carousel-media | yes | 5 | 7,164,172 |
| event-essentials-media | yes | 4 | 1,071,678 |
| lot-pictures | no | 27 | 63,185,969 |
| order-pictures | yes | 3 | 1,775,975 |
| physical-waivers | no | 0 | 0 |
| public-assets | no | 246 | 234,241,070 |
| signatures | no | 83 | 3,064,967 |
| signed-waivers | no | 83 | 522,028,548 |
| unit-images | yes | 49 | 108,872,270 |
Per-bucket md5 values are in the JSON. Object count (500) and size (about 898 MiB) agree with the earlier record; the earlier documents said "8 buckets", which counted only buckets with objects.

## 6. Configuration
| Item | Value | Status |
|---|---|---|
| Supabase project | `Bounce Party Club Dev`, us-east-1, ACTIVE_HEALTHY, database 17.6.1.127 | confirmed |
| Supabase branch record | one branch `Dev`, git branch `Dev`, default, not persistent, status `MIGRATIONS_FAILED`, last updated 2026-06-02 | confirmed as a record; the status is not interpreted as the integration's current state |
| Integration "Deploy to production", "Automatic branching", GitHub connection settings | owner reported ON / OFF | **UNVERIFIED** (no authorized read-only tool exposes them) |
| Edge Functions | 42 deployed; 16 with `verify_jwt` true; `send-email` v7 and `send-sms-notification` v6 are the old pre-guard versions | confirmed; expected until S1; canonical slug:version:jwt md5 `b2d734d68eb8c480456fbf236e60a025` |
| Netlify site `bouncepartyclubdev` | URL `https://dev.bouncepartyclub.com`; current deploy `6ad6164006e80bd67c7754ed`, ready, context production, branch `Dev`, commit `aeb708e`, published 2026-10-19 13:08 UTC | confirmed |
| Netlify continuous-deployment toggle | the commit `aeb708e` was built and published automatically on 2026-10-19 | behavior evidenced; the toggle itself **UNVERIFIED** |
| Git remote | `origin/Dev` `aeb708e` (equals the Netlify deployed commit), `origin/main` `b79ca48`, unchanged | confirmed (`git ls-remote`) |
| Database-security containment | see section 4 | confirmed |

## 7. Differences from the expected baseline and blockers
| # | Expected | Observed | Blocks the next stage? | Smallest corrective action |
|---|---|---|---|---|
| 1 | ledger 58 rows | 58 rows, identical set | no | none |
| 2 | fingerprint equals the Development baseline | equal on all 11 categories | no | none |
| 3 | sealed start-state fingerprint | differs in `bkt` only | no (S3 effect) | bind the post-S3 state at S0 |
| 4 | "8 buckets" in earlier documents | 9 buckets, 8 with objects | no | wording only |
| 5 | storage-policy ownership | `postgres` not a member of the owner | not for AUTH-2/3; **it is the G-16 question for S5/S7** | the rolled-back canary (G-16) at its stage |
| 6 | Supabase and Netlify toggles | UNVERIFIED | **blocks D-03b/G-14 evidence, not AUTH-2** | owner reads the dashboards in AUTH-2 and records text/screenshots |
| 7 | old relays | v7 / v6 | no (expected) | S1 |
No unexpected migration, schema, data, Storage or function change was found.

## 8. Query log (hosted reads; all Development; none mutates)
1 environment settings; 2 ledger count/min/max/hashes; 3 fingerprint `DIGEST_ROWS`; 4 ledger versions+names and presence of the 13, A, B, October/Step 3B, alias, withdrawn/demo; 5 publications, Storage table owners, auth triggers, schema USAGE; 6 pricing/orders column inventory and public object counts; 7 payments column names; 8 orders, payments and customer aggregates; 9 per-table row counts (counts only); 10 Storage per-bucket aggregates and hash; 11 Storage totals and hash; connector reads: `list_edge_functions`, `list_branches`, `get_project`; Netlify reads: `get-projects`, `get-project`, `get-deploy`; local: `git ls-remote`. A local-only fingerprint of four scratch templates was used for comparison.


---

## 9. AUTH-2 addendum (2026-10-20): deployment controls and managed backups
**AUTH-2 = PARTIAL.** The reads that the authorized connectors can perform are done and nothing changed. The three items that need the owner's dashboards (Supabase integration settings, Netlify continuous-deployment state, managed-backup list) cannot be read by any connector action and are **UNVERIFIED**. Production was not touched.

### 9.1 What was read and what each read proves
| Read | Result | Proves | Does not prove |
|---|---|---|---|
| Local Git | `Dev` at `4c86d3a…`, 113 ahead / 0 behind; `origin/Dev` `aeb708e`, `origin/main` `b79ca48`; 2 modified + 2 untracked AUTH-1 records; 0 staged | the starting state is as expected | n/a |
| Supabase `get_project` | project `srxunxiytojjsuhcmzjg` "Bounce Party Club Dev", us-east-1, ACTIVE_HEALTHY, database 17.6.1.127 | the Development identity | integration settings |
| Supabase `get_organization` | plan `pro` | managed daily backups are a Pro-plan feature | that any backup exists |
| Supabase `list_branches` | the same single record as AUTH-1: branch `Dev`, git branch `Dev`, default, not persistent, `MIGRATIONS_FAILED`, last updated 2026-06-02 | a branch record | the GitHub integration toggles; `MIGRATIONS_FAILED` is not read as evidence that automatic deployment is disabled or enabled |
| Netlify `get-projects` | site `bouncepartyclubdev`, `https://dev.bouncepartyclub.com`, current deploy `6ad6164006e80bd67c7754ed` ready (unchanged since AUTH-1) | site identity and the latest published deploy | the continuous-deployment toggle |
| Netlify `get-deploy` (AUTH-1, same deploy) | branch `Dev`, context production, commit `aeb708ed9d5f0fbc2b146a52d378babd07024b30` (equals `origin/Dev`), commit URL on `github.com/hawkinsd90/BouncePartyClubSite`, `locked: null`, public repository | the repository and branch association are evidenced; that deploy is not locked | a site-level deploy lock; whether builds are currently active |
| One database `SELECT` (archiver view) | `archive_mode` on, `wal_level` logical, 5,270 WAL segments archived, 0 failures, last archived 2026-10-20 00:43:52 UTC (read at 00:55:45 UTC), 0 replication slots | the platform's WAL archiving is working | a listed, completed or restorable backup |
No connector action exposes the Supabase GitHub-integration settings, the managed-backup list, backup retention or restore availability, or the Netlify continuous-deployment/build state.

### 9.2 AUTH-2A Supabase GitHub integration
| Value | Historical (owner-reported) | Fresh verification |
|---|---|---|
| Repository | `hawkinsd90/BouncePartyClubSite` | **UNVERIFIED** |
| Connected / production branch | `Dev` | **UNVERIFIED** (the branch record says `Dev`, which is not the setting) |
| Deploy to production | ON | **UNVERIFIED** |
| Automatic branching | OFF | **UNVERIFIED** |
| Connection status; function-deployment behavior | n/a | **UNVERIFIED** |
**D-03b: CURRENT CONFIGURATION UNVERIFIED (owner dashboard read needed); DISABLE PENDING OWNER ACTION.** I did not toggle anything. D-03b is not satisfied until the owner confirms the OFF state. Restoring "Deploy to production" to ON stays a later gated action (G-25).

### 9.3 AUTH-2B Netlify (`bouncepartyclubdev`)
Site identity, branch `Dev`, production context, repository association (evidenced by the commit URL), latest published commit `aeb708e` and "ready" state are confirmed. The continuous-deployment toggle, the "builds active" state and any site-level deploy lock are **UNVERIFIED** (the build of `aeb708e` on 2026-10-19 shows the behavior). **D-03a: behavior evidenced, settings UNVERIFIED; no change authorized or required.** Continuous deployment stays ON.

### 9.4 AUTH-2C managed backups (four levels kept apart)
| Level | Status |
|---|---|
| A backup is **listed** in the dashboard | UNVERIFIED (list not readable by any connector) |
| A backup is **completed** (latest UTC timestamp, any error) | UNVERIFIED |
| A backup is **restorable** under this plan and the owner's permissions (restore option, retention, compute size, PITR state) | UNVERIFIED; documentation says Pro keeps the last 7 daily backups, that a restore makes the project inaccessible while it runs, and that Storage objects, Edge Functions, their secrets and custom-role passwords are not restored |
| A restore has been **tested** | **No.** Only a local `pg_dump` rehearsal on a scratch replica has been run (not a backup of Development) |
Nothing here claims recovery is proven. WAL archiving working is supporting evidence only. PITR is not required and nothing is to be purchased.

### 9.5 Preservation of AUTH-1
All AUTH-1 values remain valid. Newly observed differences: **none** (Netlify deploy, branch record and Git remote are unchanged; the database was not re-inspected beyond the single archiver `SELECT`).

### 9.6 Exact dashboard actions for the owner
**Read-only (no change):**
1. *Supabase integration.* Open `https://supabase.com/dashboard`, organization "Bounce Party Club", project **Bounce Party Club Dev** (its address must contain `/project/srxunxiytojjsuhcmzjg`; do not open the Production project `qaagfafagdpgzcijnfbw`). Left menu: **Project Settings** (gear) > **Integrations** > the **GitHub** panel (if absent, the same panel is under **Project Settings > Branching**). Record in text, or send a screenshot with no tokens: repository, production branch name, **Deploy to production** ON/OFF, **Automatic branching** ON/OFF, the Supabase directory path, and the connection status.
2. *Netlify.* Open `https://app.netlify.com/projects/bouncepartyclubdev`. **Project configuration > Build & deploy > Continuous deployment**: record the linked repository, the production branch (expected `Dev`), Branch deploys, Deploy Previews, and whether builds are active (the "Stop builds" / "Activate builds" control; do not click it). Then the **Deploys** page: note whether a publishing-lock banner or lock icon is shown and which commit is on top (expected `aeb708e`).
3. *Managed backups.* In the Development project: **Database > Backups**. On **Scheduled backups** record each listed backup's UTC date and time, type and status, and whether a Restore option is offered (do **not** click Restore or Download). On **Point in time** record whether it is enabled. **Project Settings > Add-ons** (or Billing > Add-ons): record the compute size and whether the PITR add-on is on (do not change). Record the retention statement shown.
**Change requested only after you approve it in chat (separate from the reads):**
4. *Turn Deploy to production OFF.* In the same Supabase GitHub panel, switch **Deploy to production** to OFF and confirm/save. Leave **Automatic branching** as it is (OFF), do not disconnect GitHub, and send a screenshot that shows OFF. I will then mark D-03b satisfied; I will not mark it before.

---

## 10. AUTH-2 closure (owner dashboard screenshots, 2026-10-20)
**AUTH-2 = PARTIAL (qualified).** The Deploy-to-production OFF control and the managed-backup listing are now owner-evidenced. One finding stays **unresolved and uncorrected**: the Supabase branch record changed after the owner's save. Netlify builds-active, PITR and compute size remain UNVERIFIED. Production was not touched and nothing hosted was written.

### 10.1 Evidence (owner screenshots unless stated)
| Item | Expected | Observed | Source | Status |
|---|---|---|---|---|
| Development integration repository | `hawkinsd90/BouncePartyClubSite` | same; working directory `.` | owner screenshot | verified (screenshot) |
| Integration connected | yes | still connected | owner screenshot | verified (screenshot) |
| Deploy to production | OFF after the change | OFF; "Production branch settings successfully updated." | owner screenshot | verified (screenshot) |
| Automatic branching | OFF | OFF | owner screenshot | verified (screenshot) |
| Configured branch before the change | `Dev` | `Dev` | owner screenshot | verified (before only) |
| Configured branch after the change | `Dev` | **not shown**; dashboard breadcrumb shows `main` | owner screenshot | **UNRESOLVED** |
| Branch record (connector `list_branches`, read-only) | name `Dev`, git branch `Dev`, updated 2026-06-02 | name `main`, git branch **empty**, default, `MIGRATIONS_FAILED`, updated 2026-10-20 01:27:01 UTC | connector | **DIFFERS** |
| Production project | Deploy ON, Automatic branching ON | unchanged in the earlier screenshot; not queried | owner screenshot | untouched |
| Development managed backups | listed | seven daily physical backups, October 13 to 19, 2026; latest 2026-10-19 10:56:30 UTC; Restore offered; Storage object bytes not included | owner screenshot | verified (listing only) |
| Netlify repository / continuous deployment | GitHub repository | `github.com/hawkinsd90/BouncePartyClubSite`, "continuous deployment from a Git repository" | owner screenshot | verified (screenshot) |
| Netlify latest deploy | `6ad6164006e80bd67c7754ed`, `aeb708e`, ready | unchanged (connector re-read) | connector | verified |
| Netlify builds-active / lock | on, not locked | not exposed by any connector | none | **UNVERIFIED** |
| PITR state; compute size | n/a | not shown | none | **UNVERIFIED** |

### 10.2 The branch-record finding (stop-and-report condition)
The AUTH-1 and AUTH-2 reads showed one branch record named `Dev` with git branch `Dev`. At 01:27:01 UTC on 2026-10-20, within the owner's save, that record changed to name `main` with an **empty** git branch; the dashboard breadcrumb now shows `main`. Read together this means the integration's configured branch is **no longer evidenced as `Dev`**. The connector cannot show the integration's own "production branch" field, so it is not known whether the setting was cleared or only the display name changed. I did not change anything. With Deploy to production OFF, a push does not deploy migrations or functions, so the safety purpose of D-03b is served; the branch identity must be read from the GitHub panel before it is restored (gate G-25) and **must not be corrected without authorization**. Owner read needed: Supabase **Project Settings > Integrations > GitHub** panel, the "Production branch" field and the branch selector, screenshot with no tokens.

### 10.3 Unchanged since AUTH-1 (fresh aggregate read, 01:30 UTC)
Ledger 58 rows, newest `20260929161925`, SHA-256 `ca686c2d620154142ad9d9908c5c093a16a709df35c1c6860ed65c8bef24b999`; 500 Storage objects; 171 orders; 185 payments; project ACTIVE_HEALTHY, PostgreSQL 17.6.1.127; `origin/Dev` `aeb708e`, `origin/main` `b79ca48`. Development database size 28,183,699 bytes; 5 extensions; 16 non-system roles. The migration ledger and data are unchanged.

### 10.4 What stays true
G-20 (Bolt freeze) stays removed. R0 to R5 are unchanged and R1/R2 are not satisfied. Netlify continuous deployment stays ON. The backups are a listing, not a tested restore. The manual encrypted dump and the local restore proof are prepared in `auth3-backup-execution-checklist.md` and are **not authorized or run**.

### 10.5 Follow-up owner screenshots (GitHub panels, 2026-10-20 9:48 PM local)
| Project (URL ref) | Deploy to production | Production branch name | Automatic branching | Repository / directory |
|---|---|---|---|---|
| Development `srxunxiytojjsuhcmzjg` | **OFF** | field **greyed out and blank** (no branch shown) | **OFF** (branch limit 50, greyed) | `hawkinsd90/BouncePartyClubSite`, `.` |
| Production `qaagfafagdpgzcijnfbw` | ON | `main` | ON (branch limit 3, "Supabase changes only" ON) | `hawkinsd90/BouncePartyClubSite`, `.` |
**Reading.** Both breadcrumbs show `main PRODUCTION`: that is the project's default branch label (Production also shows it), so the breadcrumb is **not** the integration setting. The Development "Production branch name" field no longer shows `Dev`: with Deploy OFF it is disabled and blank, so the configured branch is **not evidenced as `Dev`** and the stored value after the save is **unknown** (cleared or merely hidden). The connector branch record (git branch empty) agrees with a cleared binding. Nothing was corrected. Restoring automatic deployment later (G-25) must re-enter `Dev` deliberately and re-verify; I will not do it. Production is unchanged (Deploy ON, branch `main`, Automatic branching ON) and was not touched. The Development safety requirement (Deploy OFF, Automatic branching OFF, connected) is verified. **Residual unresolved:** the stored production-branch value. It no longer blocks AUTH-3 preparation.
