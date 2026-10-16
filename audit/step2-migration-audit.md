# Bounce Party Club — Step 2 Migration Audit and Implementation Blueprint (revision 3)

Audit date: 2026-10-16. Mode: audit and planning only. Branch `Dev`, HEAD `014615b6e481994856e96f4bcbcc1da1e52f006f`.
**Revision 3** applies your seven decisions, separates Step 2 into stages A–G, refines the Production-equivalent rehearsal (section X), and keeps Step 3/4/6 issues apart (section R). Start with **L (plan)**, **N (completion criteria)**, **Q (decisions)** and **Y (hosted state)**. Earlier sections remain the evidence base; corrections are logged in section O.

Evidence labels: **[V]** verified by me in this audit (read-only SQL, file read, hash, or test run) · **[H]** historical report recovered from a prior conversation or commit · **[I]** inference · **[R]** recommendation.

---

## 0. Access, method and disclosures

| Item | Result |
|---|---|
| "BPC production-to-dev data refresh solution" | **Read.** Exported its transcript and extracted passages (cited below as *refresh #N*, N = message number in the exported transcript). |
| "Large file refactoring audit" | **Read.** Exported its transcript and extracted passages (cited as *refactor #N*). |
| Prod `qaagfafagdpgzcijnfbw` / Dev `srxunxiytojjsuhcmzjg` | Read-only SQL (catalog queries, `supabase_migrations.schema_migrations`), `list_migrations`, `list_edge_functions`. |
| Original finding IDs SEC-01…, API-01…, MSG-01…, MED-01…, DB-01… | **Not recoverable.** The strings appear in neither transcript nor anywhere in the repo. Section H maps findings by topic. No IDs are invented. |
| Migration SQL edited | None. Documentation only. |

### Disclosures (things that happened that you should know about)

1. **A hosted write on Dev happened during this audit.** I ran `supabase db dump --linked --schema public --dry-run` to test whether the CLI can export without Docker. The dry-run prints a script, but before printing it the CLI **initialised its temporary login role on the linked project (Dev)**. Afterwards Dev has `cli_login_postgres` (`rolcanlogin=true`, member of `postgres`, `rolvaliduntil` 2026-10-16 18:00:18 UTC). That is a change to Dev's role catalog. It expires on its own; I did not drop it and will not run further CLI commands that contact either project. Prod has an older, already-expired `cli_login_postgres` (valid until 2026-10-07 20:02 UTC) that I did not create or touch. No data, schema, history, function or storage object changed on either project. [V]
2. **A password-hash comparison was run inside both databases** to test one security finding (section H, SEC-A). It returned only yes/no. No credential was printed, used to authenticate, or changed. [V]
3. **Docker Desktop is still installed** from earlier in this conversation (installed with `winget`, before your instruction not to). It is unused and can be uninstalled whenever you like. I did not touch it in this revision.
4. Exported transcripts of the two prior sessions sit in `C:\Users\vikki\Downloads\` (two `.zip` files) and, extracted, in my scratchpad (outside the repo). They contain no secrets I was aware of, but they are verbatim conversations.

---

## A. Executive assessment

**Settled**
- All 277 Prod-recorded versions have a repo file. The 15 recovered files match Prod's recorded SQL by MD5 three ways. Do not repeat recovery. [V]
- Dev data refresh counts match your report exactly (171 / 123 / 185 / 82 / 5 / 147). Also verified on Dev: 2 park acknowledgments (Oakland 1, Wayne 1), 4 orders with a weekday delivery fee, 0 of 82 invoices with a weekday fee, 16 distinct units, 1 `pricing_rules` row. [V]
- All 23 October migrations were read in full (section G). Every one implements what its header says, with the exceptions listed in G.3.

**Not settled / newly found**
1. **URGENT, outside Step 2 (owner action): the `master` account `admin@bouncepartyclub.com` exists on both Prod and Dev, and its stored password hash matches the demo password documented in the header comment of `20251003170350_015_create_demo_admin_user.sql`.** [V] See H, SEC-A. I changed nothing.
2. **Forcing the 43 baseline/alias files through `db push --include-all` would damage Prod** (re-create closed policies, resurrect dropped `orders.start_date/end_date`, overwrite live pricing and functions). Section B has the file-by-file evidence. Without `--include-all`, the CLI should refuse (documented behaviour, not tested here).
3. The 23 October migrations have never run on any hosted DB. Dev lacks all of their objects. [V]
4. Dev's history (58 rows) and Dev's schema disagree; so do Prod's history and Prod's schema (e.g. the `user_roles` CHECK). [V]
5. Prod is exposed today: anon can reach 11 tables through open "Service role full access" policies and every one of 68 public functions is executable by `anon`. [V]

**Obstacles to rehearsal:** no Docker, no local Supabase stack. A Docker-free rehearsal is feasible (section F) using local PostgreSQL 18.4, the repo's own 277 Prod-recorded files, and read-only catalog snapshots; it cannot prove PostgREST, Realtime, Storage-API or Auth-hook behaviour.

---

## B. The 43 cases that a future `db push` could apply incorrectly

### B.1 How the 43 arise [V/H]

- Prod's tracked history starts at `20251126190540`. The repo carries 40 earlier files (`20251001051900`…`20251019141249`) that created the original schema before tracking began (**cases 1–40**). Prod's schema contains their *effects* (all 23 tables, all 10 functions, all 7 triggers they create exist on Prod).
- 3 more files in `main` have no Prod row: `20260305203528`, `20260407203226`, `20260407211122` (**cases 41–43**).
- Prod's recorded versions are the apply-time timestamps that the applying tool stamped (the history `name` values with embedded `20xx..._` prefixes show the file's own timestamp was replaced). That tool-stamping is why file versions and recorded versions differ for cases 41–42 and, on Dev, for `20260814002658`. Any October file applied the same way will alias again unless the version is preserved (section D, rule R3).
- **What `db push` would do:** every local version absent from the remote history is "pending". For Prod that is **110 files**. Supabase's documented default refuses pending versions *older than the latest remote version* unless `--include-all` is passed [documented CLI behaviour; not executed here]. 82 of the 110 sort before Prod's latest (`20260928172217`; the other 28 are the five `20260929*` files and the 23 October files), so a plain push is expected to stop, and `--include-all` is the dangerous flag.

### B.2 Per-case table

"Prod effect": **present** = every table/column/function/index/trigger/policy the file creates exists on Prod; **superseded** = the file creates something later migrations dropped or replaced (Prod lacks it). "Forced replay" is a **static prediction** from object-existence tests against Prod's catalog (all 23 tables, 33 columns, 55 policies, 10 functions, 31 indexes, 7 triggers it names were tested) assuming one transaction per file. Unique-key conflicts on data rows and unverified constraints are not modelled. [V for existence; I for the prediction]

| # | Version | File | Prod effect | Forced replay on Prod | Hazard |
|---|---|---|---|---|---|
| 1 | 20251001051900 | 000_create_user_roles | superseded | applies | **re-creates two dropped policies**, including `Service role full access to user_roles` (open to PUBLIC) |
| 2 | 20251001051901 | 001_create_core_schema | superseded | aborts (objects exist) | would re-create 11 open "Service role full access" policies if it did not abort |
| 3 | 20251001052039 | 002_seed_sample_units | seed | applies | 9 INSERTs (`ON CONFLICT DO NOTHING` on slug): adds sample units if slugs absent |
| 4 | 20251001192425 | 004_add_new_order_fields | superseded | applies | **re-adds dropped `orders.start_date/end_date` (then SET NOT NULL), unconditional `UPDATE pricing_rules SET surface_sandbag_fee_cents = 3000`** (Prod now 3500) |
| 5 | 20251002180149 | 005_update_home_base_wayne_mi | seed | applies | **`UPDATE pricing_rules SET per_mile_after_base_cents = 500, included_city_list_json = ["Detroit"]`** (Prod now 300) |
| 6 | 20251002195907 | 006_add_unit_inventory | present | no-op | none |
| 7 | 20251002195922 | 007_add_availability_check_function | present | applies | overwrites `check_unit_availability` with an old body |
| 8 | 20251002210020 | 008_add_admin_settings | superseded | applies | re-creates 3 dropped `admin_settings` policies; 1 INSERT |
| 9 | 20251003111105 | 009_add_sms_conversations | superseded | aborts | none (safe-fail) |
| 10 | 20251003122900 | 010_add_contacts_and_invoices | superseded | aborts | none (safe-fail) |
| 11 | 20251003135541 | 011_add_special_details (alias, same name as #18) | present | no-op | none |
| 12 | 20251003142953 | 012_add_pets_field | present | no-op | none |
| 13 | 20251003152224 | 013_add_twilio_credentials | seed | applies | 1 INSERT into `admin_settings` |
| 14 | 20251003164124 | 014_add_admin_check_function | present | applies | overwrites `get_admin_users` with an old body |
| 15 | 20251003170350 | 015_create_demo_admin_user | seed | applies (static) | **INSERTs a demo admin into `auth.users`/`auth.identities`/`user_roles` with the documented demo password**; no existence guard (a unique-email conflict, not modelled, may abort it) |
| 16 | 20251003182356 | 016_add_sms_message_templates | present | aborts | none |
| 17 | 20251003183947 | 017_add_admin_email_setting | seed | applies | 1 INSERT into `admin_settings` |
| 18 | 20251003200000 | 011_add_special_details (alias of #11) | present | no-op | none |
| 19 | 20251003200318 | 018_fix_infinite_recursion_in_admin_check | superseded | applies | **overwrites `is_admin()` with the old uppercase-only body**; **re-creates 7 policies Prod no longer has** (4 on `user_roles`, 3 on `admin_settings`; each preceded by `DROP POLICY IF EXISTS`, lines 14–20, so nothing stops them) |
| 20 | 20251004233954 | 019_add_sms_consent | present | aborts | none |
| 21 | 20251006142419 | 020_add_travel_fee_breakdown | present | aborts | none |
| 22 | 20251006222941 | 021_add_stripe_payments | present | aborts | none |
| 23 | 20251007210840 | 022_add_stripe_publishable_key | seed | applies | 1 INSERT into `admin_settings` |
| 24 | 20251007214737 | 023_update_availability_check_for_date_range | present | applies | overwrites `check_unit_availability` |
| 25 | 20251007215413 | 024_fix_availability_check_nested_aggregate | present | applies | overwrites `check_unit_availability` |
| 26 | 20251007215603 | 025_fix_availability_ambiguous_columns | present | applies | overwrites `check_unit_availability` |
| 27 | 20251007220415 | 026_add_payment_pending_status | seed | applies | `UPDATE orders SET status='pending' WHERE status IS NULL OR ''` (0 matching rows today; `pending` is not an allowed status now) |
| 28 | 20251007221227 | 027_update_order_status_to_draft | seed | applies | `UPDATE orders SET status='draft' WHERE status='payment_pending'` (no such rows expected) |
| 29 | 20251007221817 | 028_add_deposit_required_flag | present | applies | `UPDATE orders SET deposit_required=true WHERE NULL` (0 rows today [V]) |
| 30 | 20251008132209 | 029_add_stripe_payment_status_column | present | aborts | none |
| 31 | 20251008141359 | 030_add_anon_orders_policy | superseded | applies | **re-creates `Anonymous users can read orders`** (reopens anon read of orders) |
| 32 | 20251008144308 | 031_add_admin_notification_template | seed | applies | 2 INSERTs into templates |
| 33 | 20251008153245 | 032_fix_contacts_bookings_counter | present | applies | overwrites `update_contact_booking_stats`; recomputes `contacts.total_bookings` |
| 34 | 20251008153325 | 033_add_order_workflow_and_features | present | aborts | none |
| 35 | 20251008155607 | 034_add_order_changelog | present | aborts | none |
| 36 | 20251008170619 | 035_add_void_status | present | aborts | none |
| 37 | 20251008180000 | 036_add_order_discounts | superseded | applies | re-creates 4 dropped open `order_discounts` policies |
| 38 | 20251008190000 | 037_setup_unit_images_storage | superseded | aborts | none (would re-create 3 dropped storage policies) |
| 39 | 20251008202716 | 038_add_wet_mode_images_and_dimensions | present | aborts | none |
| 40 | 20251019141249 | add_tip_support | present | aborts | none |
| 41 | 20260305203528 | add_customer_payment_amount | present (columns exist) | applies | **backfill `UPDATE orders ... WHERE customer_selected_payment_cents IS NULL` would change 22 of 171 Prod orders** [V]. Recorded Prod twin `20260305205811 add_customer_selected_payment_tracking` has *different SQL* (normalised length 1020 vs 637) |
| 42 | 20260407203226 | add_refund_requested_to_orders | present (column exists, default false) | no-op (the `ADD COLUMN` sits inside an `IF NOT EXISTS` `DO` block) | none. Recorded twin `20260408200431` has different SQL (414 vs 926 chars) |
| 43 | 20260407211122 | add_anon_insert_policy_order_changelog_cancellation | **absent** | applies | **Not an alias.** Prod's only anon INSERT policy on `order_changelog` allows `customer_approval`/`status_change`, not `cancellation`. The file's policy does not exist on Prod. `20261012` drops every `order_changelog` policy anyway. |

Counts (from the table above): forced replay **aborts** for 14 files, is a **no-op** for 5, and **applies** for 24 (each of the 24 changes something: data, a function body, a policy or a column). 20 files carry `INSERT`/`UPDATE`/`DELETE` statements (some of them abort first). 7 files re-create policies or columns Prod no longer has (cases 1, 4, 8, 19, 31, 37, 43). [V for the object tests; the prediction itself is I]

### B.3 Recommended reconciliation per group (nothing executed)

| Cases | Evidence that effects exist | Recommended approach | Not recommended |
|---|---|---|---|
| 1–40 (baseline) | Tables 23/23, functions 10/10, triggers 7/7 present; columns present except `orders.start_date/end_date` (dropped on purpose by `20251216210332`, in Prod history); 25 of 55 policies and 2 indexes intentionally gone | **History bookkeeping** after a per-file proof, as the *last* step of the plan, never by running them. Record "superseded by <version>" for the 8 that differ | `db push --include-all`; editing the files |
| 41–42 | Columns exist on Prod; Prod's recorded twins add the same columns with different SQL | **History bookkeeping** (mark applied), because replay would touch 22 rows (41) or is a guarded no-op (42). A forward migration is not needed | replaying 41 |
| 43 | Effect **absent** | **Treat as genuinely pending.** It runs in order before `20261012` and is dropped by it. Owner decision: apply as-is, or exclude. Do not mark it applied | marking it applied (would be a false record) |

Dev: only case 1 (`000_create_user_roles`) is in Dev's history; cases 2–40 are unrecorded on Dev but their effects are in Dev's schema snapshot [I, to be proven per section D].

---

## C. Historical replay defects (exact)

Source: replay-tool diagnostic of all 387 files on a local PostgreSQL stub (`refactor` transcript, run at HEAD `014615b`); "5 file(s) raised SQL errors". [H], then compared with hosted state by me. [V]

| # | File : line | PostgreSQL error | Root cause |
|---|---|---|---|
| 1 | `20260324175546_fix_get_user_role_case_sensitivity_v2.sql` : 33 (`UPDATE user_roles SET role = LOWER(role) WHERE role != LOWER(role);`) | `new row for relation "user_roles" violates check constraint "user_roles_role_check"` | `20251207163822` (lines 47–51) drops and re-adds `user_roles_role_check` as `CHECK (role IN ('MASTER','ADMIN','CREW','CUSTOMER'))`. This file lowercases roles. The preceding `ALTER TABLE ... DISABLE TRIGGER ALL` does not disable CHECK constraints. |
| 2 | `20260324190039_normalize_remaining_uppercase_roles.sql` : 15 (`UPDATE ... SET role = LOWER(role)`, statement spans 13–15) | same | same |
| 3 | `20261016120000_repair_role_assignment_and_signup_provisioning.sql` : 59 (end of the `DO` block at lines 44–59; its `UPDATE ... SET role = lower(btrim(role))` is at line 54) | same, "2 error(s)" | The migration lowercases data (line 54) **before** it replaces the CHECK (lines 62–78), so on any database that still has the uppercase CHECK the data step fails. The second error is not itemised in the retained log. |
| 4 | `20260615175816_add_orders_to_realtime_publication.sql` : 1 (`ALTER PUBLICATION supabase_realtime ADD TABLE orders;`) | `relation "orders" is already member of publication "supabase_realtime"` | `20260324051459` (lines 31–35) already adds `orders` behind an `IF NOT EXISTS` guard; this file is a bare statement. |
| (5) | `20260323201502...` : 27 | `extension "pg_net" is not available` | Stub limitation only. Not a defect. |

### C.1 Comparison with Prod's recorded SQL and live schema [V]

- Prod's recorded SQL for `20251207163822` creates the same uppercase CHECK (the recorded `ADD CONSTRAINT` statement is identical in effect to the file). **Prod's live `user_roles` has no CHECK constraint at all** (and no foreign key to `auth.users`), and no recorded migration drops the CHECK. So the CHECK was removed outside migrations. Live `user_roles` holds 9 rows, roles `customer`/`master` only, all lowercase, on both Prod and Dev.
- Recorded SQL for `20260615175816` is the same single statement as the file (47 characters after whitespace removal). Prod's history records it as succeeded, so at that time `orders` was not a member although `20260324051459` had added it. `orders` is a member now. A removal between the two dates is **[I]**, not provable from history.
- Recorded `20260324175546` is byte-identical (recovered file, hash-pinned). Recorded `20260324190039` is 358 normalised characters (2 statements).
- **Affects:** clean rebuilds only. Upgrades of Prod/Dev never replay these files and hold no objects that trip them. [V for the absence of the CHECK; I for the consequence]

### C.2 Options evaluated (revision 3: **option A, the shim, is selected by your decision 1**; option B is dropped)

| | A. Replay-tool shim | B. Edit historical files |
|---|---|---|
| What | The tool drops `user_roles_role_check` right after `20251207163822` and tolerates "already member" for the Realtime add | `20260615175816`: wrap in an `IF NOT EXISTS` DO block. `20260324175546` / `...190039`: drop the CHECK first |
| Touches | `scripts/dev/migration-replay.cjs` (+ its tests) | Files already applied on Prod/Dev; two are among the 15 hash-pinned recovered files |
| History/hash impact | None. Recorded SQL stays equal to the file | `20260324175546` is hash-pinned (test would fail); the others would stop matching Prod's recorded SQL |
| Fidelity | Encodes the real Prod drift (CHECK removed out-of-band) in the tool, visible and testable | Hides the drift inside historical files |
| Risk | Shim could mask a real defect if written broadly | Violates your decision 4 unless evidence is demonstrated first |
| `20261016120000` (pending, editable) | Needs its own fix either way: drop the CHECK **before** its data step | same |
| Regression tests | strict replay exits 0; catalog assertion "no uppercase-only role CHECK" after replay; recovered-migration test still 63/0 | same, plus hash re-pin |
| Rollback | `git revert` the tool change | `git revert`; no DB effect |

---

## D. Reconciliation plan (history ≠ schema)

### D.1 Facts [V]

| | Prod | Dev |
|---|---|---|
| History rows | 277 (0 without a file) | 58 (57 match a file; `20260814002658` = file `20260814120000`) |
| Repo files with no row | 110 (40 baseline + 3 alias/absent + 44 Dev-line + 23 October) | 330 (23 October + 307 older) |
| Effects present without a row | cases 1–42 (see B) | `20260816221636`, `20260816222905`, `20260928172217` effects (columns), the pre-June bulk, `20260712101626`(see below) |

- **Why Dev has effects without rows:** *refresh #1168* ("Production parity changes applied to Development"): seven approved changes were applied directly to Dev in one transaction — `orders.parks_acknowledgment_required` (`boolean NOT NULL DEFAULT false`), `orders.parks_acknowledgment_county` (`text`), `invoices.same_day_weekday_delivery_fee_cents` (`integer DEFAULT 0`), plus four missing `units` rows — and "I did not touch the migration-history table. Development still lists 58 versions." So `20260928172217`'s effect exists on Dev with no history row **by design**.
- **Dev `20260712101626`** (add_task_status_unique_constraint) is in Prod's history, not Dev's; *refactor #367 §E*: "would fail if applied (its constraint already exists)". Confirmed pattern: a bookkeeping-only case. [H]
- **`update_pricing_rules`**: in Prod history (`20260611184401`), absent from Dev's history and Dev's schema, and `20261007` guards it with `to_regprocedure(...)`. Dev has it nowhere. Per your decision 3, I recommend nothing until the target schema is decided. [V]

### D.2 Answers to the eight questions

1. **Already applied in Dev (by effect):** the 57 matched rows; the bulk pre-June files; `20260712101626`; the parks/weekday-fee columns.
2. **Must execute on Dev:** the 23 October files (all objects absent, verified). Whether `20260611184401` is wanted on Dev is your decision (3).
3. **Bookkeeping, not missing schema:** the 330 Dev rows minus the 23 October; Prod cases 1–42; the Dev `20260814002658` version number.
4. **Would fail if replayed:** see B.2 ("aborts") and `20260712101626` on Dev; also `20260615175816` on any DB where `orders` is already published.
5. **Needs deliberate history reconciliation:** Prod cases 1–42 (bookkeeping, after proof); Dev bookkeeping for effect-present files; Dev `20260814002658`. Nothing else.
6. **Evidence before any repair:** immutable dumps and hashes (section F, phase 0): both `schema_migrations` tables; a catalog snapshot of both DBs; a per-version "effects present?" proof table; a signed owner decision per bookkeeping action.
7. **Prerequisites to advance Dev to October:** decisions in section Q; proof table complete; the 14 stubs and the schema containment kept until Step 4; deploy-first gates (G.2) satisfied; October applied in strict version order.
8. **Prevent wrong replay on Prod:** never pass `--include-all`; run `supabase db push --dry-run` against Prod and compare its pending list to the approved list; reconcile cases 1–42 first; and **preserve file versions when applying** (rule R3 below).

### D.3 Rules

- **R1.** No history repair until effect-presence is shown per version (your decision 4).
- **R2.** No edits to applied SQL files.
- **R3.** Apply October files with the version in the file name. If a tool stamps its own timestamp (as the MCP/dashboard path evidently did), aliasing recurs: Prod's `20260305205811`/`20260408200431` and Dev's `20260814002658` are the same mechanism.
- **R4.** `--include-all` is forbidden for Prod.

---

## E. Squash decisions (all deferred)

Your decision 2: defer all five. The earlier conversation reached the same conclusion with specific reasons; they are recorded here, not summarised away.

> *refactor #367 §D:* "Portal short links … **No.** The October `20261009`/`20261012` migrations retire these RPCs. A squash would recreate objects that are then dropped, and Dev's history already holds the originals." / "`reorder_product_categories`: Possible later … Not worth the history drift." / "`save_product_bundle`: Same: functions only. v2 is the live one." / "Menu groups: Reasonable candidate, but it carries RLS, grants and a data-affecting function (`save_menu_group`). A squash would need the final policies to match Dev's, which I can only prove by rehearsal." / "Contact inquiries: **Already corrected.** Don't squash; further changes would break the now-verified order."
> *General position:* "do not squash anything already recorded on Dev. Squashing replaces many recorded versions with one new version, which forces a Dev history repair."

Verified now: all five groups are recorded on Dev and none on Prod. [V] If squashing is ever reopened, equivalence must be proven by section F rehearsal 3 across tables, columns, constraints, indexes, triggers, policies, grants, function bodies/owners/ACL/`search_path`, default privileges, storage config, publication membership and data transformations.

---

## F. Docker-free rehearsal design (executable; nothing created)

### F.1 Can a Docker-free, read-only Prod schema-only export be produced with existing credentials?

| Path | Verdict | Evidence |
|---|---|---|
| `supabase db dump` (CLI 2.104.0, scoop) | **Not recommended.** No `--use-api` flag on any `db`/`migration` command; `--use-api` exists only on `functions download` [V, and *refresh #1405/#1432*]. Default execution runs `pg_dump` in a Docker container. Contacting the project initialises a temporary login role on it (observed on Dev, disclosure 1). | `supabase db dump --help`; dry-run output |
| CLI login | `supabase projects list` reports "Access token not provided", yet `db dump --linked` could mint a temporary role, so some credential is available to that command. I could not reconcile the two behaviours. | [V] |
| **`pg_dump` 18.4 (installed locally) using the existing read-only Prod URL** in the git-ignored `.env.SyncDevDataFromProd` (`DEV_REFRESH_PROD_DB_URL`) | **Feasible.** No Docker, no password in chat, no hosted write. The refresh tool already proved Prod can be opened read-only: *refresh #1245* ("Production's session is read-only and a write was refused"; direct connection strings worked), `scripts/SyncDevDataFromProd/lib/psql.mjs:77-78` sets `PGOPTIONS='-c default_transaction_read_only=on'` for Prod, and `lib/run.mjs:64-67` proves a write is refused. pg_dump 18 can dump a PostgreSQL 17 server. | [V] file reads; end-to-end dump **not run** (a dump would put function bodies on disk; see below) |
| **Read-only catalog snapshot through SQL** | **Feasible today, zero secrets.** Everything in this audit's B/C/G/H checks used it. | [V] |

Run-time rules for the pg_dump path: read the URL from the env file inside the script and never echo it; set `PGOPTIONS` as above; use `pg_dump --schema-only` **without** `--no-owner` or `--no-privileges` (owners and privileges are exactly what is being audited) and `--exclude-schema` for Supabase-internal schemas; write to a git-ignored folder restricted to your account; **scan the dump for credentials before anyone shares it** (several migrations build email-hook functions that may embed keys).

### F.2 Included / excluded

- **Included:** tables, columns (order, defaults, identity), constraints, indexes, triggers, functions (body, owner, `SECURITY DEFINER`, `search_path`, ACL), policies, grants, default privileges, sequences, views, extensions list, publications, `storage.buckets` rows (config only) and `storage.objects` policies, `supabase_migrations.schema_migrations` rows (version, name, statements hash).
- **Excluded:** all table data, `auth.users` data, storage objects and files, secrets, `vault`, Edge Function code.

### F.3 Three rehearsals (not interchangeable) — **R-2 below is superseded by section X**

| | Purpose | Baseline | Steps | Pass condition |
|---|---|---|---|---|
| **R-1 Clean rebuild** | The repo alone can rebuild the intended schema | empty scratch DB | `scripts/dev/migration-replay.cjs --mode strict --stub-skips` (it already requires `bpc_replay_*` names, loopback, an ownership marker, and refuses Supabase servers) | completes all files; only `20260323201502` (`pg_net`) skipped; catalog assertions pass |
| **R-2 Prod-equivalent upgrade** | Prod → release schema | scratch DB rebuilt from **Prod's 277 recorded files + the 40 baseline files** (all exist in the repo), with the C.2 shim applied, then compared to the **live Prod catalog snapshot**; every difference is classified (known drift / replay artefact / defect) and reproduced in scratch by a documented forward statement | then apply the 44 Dev-line files and the 23 October files in order (case 43 per owner decision; the 42 baseline/alias files are **not** applied, they are bookkeeping) | zero errors; Section H assertions pass; post-state catalog equals the expected release schema |
| **R-3 Squash equivalence** | Only if squashing is reopened | two scratch DBs | replay original vs squashed, diff catalogs | no unexplained difference |

This design needs **no `pg_dump` and no password at all**, because the Prod-equivalent baseline is built from migrations and then *measured* against the live catalog by read-only SQL. The `pg_dump` path (F.1) is an optional cross-check.

### F.4 What the scratch environment needs

- **Server:** local PostgreSQL 18.4 (`C:\Program Files\PostgreSQL\18`), already present. Scratch DBs `bpc_replay_<name>`.
- **Roles:** `anon`, `authenticated`, `service_role`, `authenticator`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `supabase_realtime_admin`, `dashboard_user`, `pgbouncer`; `postgres` owns application objects. **The stub must also reproduce Supabase's default ACLs** (`postgres`/`supabase_admin` in `public`, `storage`, `graphql`, `graphql_public`, `realtime`, `extensions`) or `20261018120000` and the default-privilege assertions cannot be tested. Prod's live default ACLs are listed in section H.
- **Schemas/objects:** `auth.users` (+ `auth.uid()`, `auth.role()`, `auth.jwt()`), `storage.buckets` / `storage.objects` with RLS, `realtime` schema and a `supabase_realtime` publication, `extensions` schema (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`).
- **Not stubbable (needs a hosted target):** `pg_net` and `pg_cron` triggers (`20260323201502`), PostgREST exposure/visibility of RPCs, Realtime delivery, Storage API behaviour (signed URLs, private-bucket reads), Auth hooks and the `auth.users` trigger firing path. These are release-candidate and Step-6 checks. A paid hosted branch is **not** part of this plan (your decision 5).
- **Safety:** loopback only; scratch-prefixed names; no hosted connection string in the same process; schema-only inputs; no customer data.

---

## G. October migrations: full verification

All 23 files were read in full (6,000+ lines). "Verified" means the SQL implements its stated purpose. Live facts used: function signatures identical on Prod and Dev; every column named by the October function bodies exists on Dev except `addresses.user_id` and `addresses.is_default` (absent on Prod too); `ON CONFLICT` arbiters (`customers(email)`, `contacts(email)`, `addresses(address_key)`, `user_roles(user_id,role)`, `customer_profiles(user_id)`) all exist as non-partial unique indexes; `payments` has only a `type` CHECK (`deposit`/`balance`/`incidental`) and **no `status` CHECK**; `order_refunds.status` CHECK allows `pending`/`succeeded`/`failed`; no duplicate Stripe PaymentIntents (0 on both). [V]

### G.1 Per-file results

| Version | Verified? | Purpose & key objects | Destructive / data effects | Dependencies | Findings |
|---|---|---|---|---|---|
| 20261007120000 payment RPC auth | Yes | `is_admin()` lowercase-safe; revoke 5 payment RPCs, 2 signature helpers from PUBLIC/anon/authenticated; `find_order_id_by_prefix` admin-only; guarded `update_pricing_rules` revoke | none | all 14 explicit signatures exist on both DBs [V] | Header says `approve_order_changes` "stays executable by anon"; `20261012` revokes it to service-role only. Final state = service-role only. Prod today: `update_pricing_rules` executable by anon and authenticated [V], so this fixes it on Prod and is a no-op on Dev. |
| 20261008120000 role/admin exposure | Yes | drop open `user_roles` policy; `REVOKE ALL ON user_roles FROM anon`; 4 admin RPCs service-role only; `get_admin_analytics` renamed to `_impl` + authorization wrapper | none | `get_admin_analytics` returns `jsonb` on both [V], matching the wrapper | Dev has the open `Service role full access to user_roles [ALL public]` policy; Prod does not [V]. No caller of the 4 RPCs in `src` or Edge Functions [V]. `/setup` appears only in an ad-tag block list [V]. |
| 20261009120000 portal links | Yes | `invoice_links.revoked_at`; partial unique index (`link_type='portal'`); expiry function; sticky-revocation trigger; corrected expiry-sync trigger | none at apply time (the two `UPDATE`s run inside the trigger) | `portal-link`, `request-portal-link`, `customer-portal-*` exist | No `portal` rows exist (types today: `portal_shortlink` 247, `invoice` 38 on both DBs) so the unique index is safe. |
| 20261010110000 approval timestamp | Yes, **no-op** | `ADD COLUMN IF NOT EXISTS orders.customer_approved_at` | none | none | **Header is wrong**: "no earlier migration creates it". Recovered `20251126190624` (line 48) creates it; Prod has it (9 orders populated) [V]. |
| 20261010120000 secure booking creation | Yes | `booking_setup_proofs` (RLS, no policies, service-role only); `create_booking_request`; `upsert_contact_from_checkout` to service-role only | none | Dev-line columns it inserts (`event_essentials_subtotal_cents`, `setup_fee_cents`, `product_id`…) exist on Dev [V]; on Prod only after the Dev-line chain | `plpgsql` defers column checks to run time. |
| 20261011120000 address line 2 | Yes | `orders.event_address_line2`; re-declares `create_booking_request` (identical body + one column, confirmed by reading both) | none | 20261010120000 | additive |
| 20261012120000 core lockdown | Yes | 4 helpers incl. `get_my_orders`; drops **every** policy on 28 tables then creates the explicit set; revokes anon table privileges; revokes 5+3 RPC families | policy reset is destructive to *any* drifted policy, by design; no data | `order_portal_links` (Dev-line table) must exist: plain `CREATE POLICY`/`REVOKE` name it; `booking_setup_proofs` (1010120000) | All columns of `get_my_orders` exist on Dev [V]. Covers 25 of the 31 Prod tables that have anon/public policies. Of the other six: `billing_addresses` and `stripe_webhook_events` are handled by 1013, `site_events` by 1018100, `pending_signups_consent` is deliberately retained (H), and `google_reviews`/`hero_carousel_images` are intended public catalog reads. **Gaps for Step 6:** crew has no `task_status` INSERT policy (see runtime scan) and no policy lets anyone UPDATE `transaction_receipts`. `Crew update orders` allows any non-guarded column (acknowledged residual). |
| 20261013120000 remaining access | Yes | drops write policies on `stripe_webhook_events`, `billing_addresses`; sweeping function `REVOKE`/`GRANT` by name; caller-checks added to `generate_invoice_number`/`generate_receipt_number`; REVOKE TRUNCATE/TRIGGER/REFERENCES on all public tables | none | `is_admin()` (1007) | **Header is wrong**: "billing_addresses … no tracked migration". Recovered `20260501173826` creates it. Admin-only callers confirmed: `generate_invoice_number` is called only from `InvoicesList.tsx` and `orderApprovalService.ts` (admin) [V]. |
| 20261014120000 waiver media | Yes | `UPDATE storage.buckets SET public=false` for 3 buckets; reset policies on 9 buckets; explicit policy set | **config change** (bucket visibility); existing public URLs stop working | Edge functions `get-waiver-status`, `generate-signed-waiver`, `save-signature`, `upload-physical-waiver` (signed URLs present in the first two [V]) **before** apply; frontend right after | Creates `lot-pictures`/`order-pictures` policies that `20261015120000` then drops, and `Staff upload public assets` that `20261015123000` drops: the three must be applied together. |
| 20261015120000 customer photos | Yes | private `lot-pictures`/`order-pictures`; staff-only policies | config change | `customer-portal-action` `request_picture_upload` (present [V]) and `customer-portal-data` signed URLs (3 [V]) | none |
| 20261015123000 evidence storage | Yes | private `order-evidence` bucket (10 MB, image types), no policy; drops `Staff upload public assets` | none to objects | `task-evidence` function (bucket constant in `_shared/evidence/evidence-media.ts`) [V]; `scripts/migrate-order-evidence.mjs` exists [V] | none |
| 20261016120000 role/signup repair | Yes | canonical lowercase roles; CHECK replaced; **FK to `auth.users` restored**; `assign_role_by_email`, `auto_assign_customer_role` rewritten; `on_auth_user_created` re-created | **Deletes 2 orphan `user_roles` rows on Prod and 2 on Dev** (rows whose auth user no longer exists; no FK exists on either DB); lowercases roles (0 rows need it today); would raise if a role outside the vocabulary exists (none) [V] | creates a trigger on `auth.users`: **Prod already has it; Dev has none** [V] | Data step precedes CHECK replacement (clean-replay failure, C#3). Signup function swallows all errors by design; its Google-address branch writes `addresses.user_id`/`is_default`, columns absent on both DBs [V], so that branch is silently skipped. **Header claim 6 is stale**: `customer_profiles.first_name/last_name` are created by recovered `20251229223230`. |
| 20261017120000 booking confirmation | Yes | 2 columns; `claim_/finalize_/release_booking_confirmation` | none | `complete-booking` calls `claim_booking_confirmation` [V] | Retires hosted-only `send-booking-confirmation` (no repo source). |
| 20261018120000 future privileges | Yes | default ACLs for owner `postgres` only | none | none | **Prod keeps `supabase_admin`-owned default grants to anon/authenticated/service_role in `public` (tables, functions, sequences)** [V]; this migration does not touch them. Dev has no `public` default ACLs. |
| 20261018120100 site events | Yes | drop write policies; privileges | none | `record-site-event` deployed first; `src/lib/core/siteEvents.ts` calls it [V]; no `src` insert into `site_events` (reads only) [V] | analytics gap if ordered wrong |
| 20261018120200 role lookup/profile | Yes | `get_user_role` self-only; `customer_profiles` column-level UPDATE | none | all 25 Prod / 19 Dev policies and all 10 function callers use `auth.uid()` [V] | none |
| 20261019120000 payment operations | Yes | 9 `payments` columns; 2 CHECKs; 4 partial unique indexes; claim/record/mark/release/finalize functions; state-barrier trigger | none; **would fail on duplicate PaymentIntents/Checkout Sessions: 0 today** [V] | `stripe-charge`, `stripe-checkout`, `stripe-webhook`, `charge-deposit`, `customer-balance-payment` | The barrier uses a fixed 300 s while `claim_payment_operation` accepts `p_stale_seconds` (≥ 60): inconsistent if a caller passes a larger value. |
| 20261020120000 deposit catch-up/offline | Yes | `payment_deposit_principal_state`, redefined `claim_payment_operation`, `record_offline_payment`, cash/check wrappers; 2 `NOT VALID` CHECKs | none | 1019 | `CREATE OR REPLACE` keeps ACL; re-revokes anyway. Old cash/check signatures preserved [V]. |
| 20261021120000 server-authoritative pricing | Yes | pricing-authority trigger; `apply_staff_order_save`, `create_staff_invoice_order` (whitelisted dynamic SQL); drops 7 policies; revokes browser writes on 4 tables | none | `staff-order-save` function [V] and Admin Edit/Invoice UI. `src` has **no** direct writes to `order_items`/`order_discounts`/`order_custom_fees`/`payments`/`order_refunds` [V] | Frontend order updates only touch `status`, `workflow_status`, `lot_pictures_requested*`, `cancelled_at`, `cancellation_reason` [V] (none guarded). |
| 20261022120000 refund safety | Yes | `order_refunds` columns/indexes; transition, reserve, mark, record, apply-event functions; cancel-unattempted trigger; revokes browser writes on `payments`/`order_refunds`; redefines the pricing guard (adds `stripe_payment_status`, `payment_lock`) | none; legacy refund rows exempted by design | `stripe-refund`, `stripe-webhook` (call sites present [V]) | `payments.type='incidental'` allowed [V]. |
| 20261023120000 refund schema | Yes | 6 nullable columns, CHECK (validated), `order_net_financials` (invoker, admin-gated) | none | 1022 | all existing rows have the legacy shape, so `VALIDATE` is safe |
| 20261024120000 allocation reservation | Yes | `reserve_refund_allocation` | none | 1023; `stripe-refund` (call present [V]) | none |
| 20261025120000 refund overview | Yes | `order_refund_overview` (invoker, admin-gated) | none | 1023; `RefundAllocationPanel` calls it [V] | none |

### G.2 Dependency and sequencing matrix

| Gate | What must be live first | Migration |
|---|---|---|
| Edge Functions before | `get-waiver-status`, `generate-signed-waiver`, `save-signature`, `upload-physical-waiver`; `customer-portal-action`/`-data`; `task-evidence`; `record-site-event`; `staff-order-save`; `complete-booking`; `create-booking`; `stripe-refund` | 1014, 1015×2, 1018100, 1021, 1017, 1010120000, 1022/1024 |
| Frontend with | Admin Edit/Invoice via `staff-order-save`; refund panel; analytics via `record-site-event` | 1021, 1022–1025, 1018100 |
| Dev-line files first | `20260722212750` (`order_portal_links`), `20260929*` (menu groups) | 1012 names them |
| Version order | strict | all |

Hosted JWT settings change at deployment (from the existing manifest): `save-payment-method-from-session` false→true, `stripe-checkout` false→true, `save-signature` true→false. [H, `manifest.json`]

### G.3 Inaccurate statements found in migration comments (documentation only; SQL unchanged)

| File | Statement | Reality |
|---|---|---|
| 1010110000 | "no earlier migration creates it" | recovered `20251126190624` does |
| 1013 | `billing_addresses` has "no tracked migration" | recovered `20260501173826` creates it |
| 1016 | repository never creates `customer_profiles.first_name/last_name` | recovered `20251229223230` does |
| 1007 vs 1012 | `approve_order_changes` "stays executable by anon" vs revoked to service role | 1012 is the later and final state |

All three "stale" statements trace to the 15 files being missing when October was written. The statements are harmless (the October DDL is `IF NOT EXISTS`/skip-if-absent), but they should be corrected in a later documentation pass **if you choose**; editing pending files is within your decision 4.

### G.4 Runtime caller scan (non-test `src` and `supabase/functions`) [V]

- RPCs called by the browser: `generate_invoice_number`, `check_unit_availability`, `save_*`, `reorder_*`, `get_my_orders`, `get_my_last_order_address`, `order_refund_overview`, `get_user_order_prefill`, `get_unresolved_failures_count`, `get_public_nav_menu_groups`, `get_delivery_timing_analytics`, `get_booking_source_analytics`, `get_all_role_users`, `get_admin_analytics`, `find_order_id_by_prefix`, `check_product_availability`, `check_date_blackout`, `assign_role_by_email`, `archive_old_orders`, `save_lot_picture_to_address`. All remain callable after October by the intended roles. **No browser code calls any function that October makes service-role-only.**
- `check_rate_limit` is called through a service-role client inside `_shared/rate-limit.ts`. Compatible with `20261013`.
- Remaining browser table writes after October (reads omitted): `customers` (insert/update), `contacts` (insert/update/delete), `addresses` (update/upsert), `notification_failures`, `order_changelog` insert, `orders` update (columns above), `pricing_rules`, `sms_message_templates`, `task_status` (insert/update), `transaction_receipts` (insert/**update**), `units`/`unit_media`, `user_roles` (update/delete), `crew_location_history`.
  - **`transaction_receipts` UPDATE** (`transactionReceiptService.ts:175`, `:405`) sets `receipt_sent_to_admin`: after `20261012` no policy allows UPDATE, so these updates will match no rows (the code does not check the result).
  - **`task_status` INSERT** (`taskStatusService.ts:51`, `ensureTaskStatus`): admin policy only; crew has SELECT/UPDATE but no INSERT. Rows normally pre-exist via the auto-create trigger, so risk is low but real.
  - Both are Step 4/6 verification items, not migration defects.
- **Customer Portal live refresh does not use table Realtime.** It polls `customer-portal-data` every 20 s and on focus/visibility (`portalRefreshController.ts`: `PORTAL_POLL_INTERVAL_MS = 20_000`, `PORTAL_MIN_RELOAD_GAP_MS = 3_000`; the hook comment says "without any direct table or Realtime access"). `notifyPortalRefresh` broadcasts `order_updated`, but **no listener exists in `src`**. So Realtime publication membership does not affect the portal.
- `LotPicturesDisplay` (Realtime on `order_lot_pictures`) is rendered only by the admin `PendingOrderCard`; admin Realtime is unaffected by the customer lockdown.

### G.5 The 14 Dev stubs (from existing manifests; original deployment not re-investigated)

Source: `.SyncDevDataFromProd/function-backups/20261016-dev-14/manifest.json` (stub marker `BPC-TEMP-503-STUB`, stub SHA-256 `d1bd81f1…`, download verification: 14 completed, second independent download byte-identical, 0 unresolved imports, 0 parse errors, `redeployTested: False`). Hosted Dev matches it: for 13 of 14 functions the live version equals manifest `originalVersion + 1` and all 14 share the same Oct-15 update window [V]. **Exception:** `get-waiver-status` is live v12 vs the expected v10 (manifest original v9), unexplained by the manifest [V]; not investigated, per your instruction.

| Function | Original v → live | Original JWT | October disposition | Repo source |
|---|---|---|---|---|
| charge-deposit | 13 → 14 | true | REPLACE | yes (hosted 978 lines vs repo 788) |
| create-admin-user | 3 → 4 | true | REPLACE | yes |
| create-order-short-link | 2 → 3 | true | REPLACE | yes (identical to repo) |
| customer-balance-payment | 4 → 5 | false | REPLACE | yes |
| customer-cancel-order | 4 → 5 | false | REPLACE | yes |
| generate-blank-waiver | 17 → 18 | false | REPLACE | yes |
| generate-signed-waiver | 9 → 10 | false | REPLACE | yes |
| get-waiver-status | 9 → 12 | false | REPLACE | yes |
| order-lifecycle | 4 → 5 | false | REPLACE | yes (hosted 566 vs repo 687) |
| save-payment-method-from-session | 4 → 5 | false → **true** in repo | REPLACE | yes |
| save-signature | 3 → 4 | true → **false** in repo | REPLACE | yes |
| send-booking-confirmation | 2 → 3 | false | **RETIRE** (hosted-only; the backup is the only copy) | **no** |
| send-invoice | 3 → 4 | true | REPLACE | yes |
| stripe-checkout | 4 → 5 | false → **true** in repo | REPLACE | yes (hosted 266 vs repo 391) |

---

## H. Security: findings mapped to migrations

The original finding IDs are unrecoverable (section 0). Findings below use stable local labels (**SEC-A…**) that are *mine*, not the historical identifiers.

**Step labels:** **[S2]** verification needed in Step 2 · **[S3]** remediation reserved for Step 3 · **[S4]** coordinated deployment · **[U]** urgent owner action outside the step order.

### H.1 Measured state [V]

| Measure | Prod | Dev |
|---|---|---|
| public functions executable by `anon` | **68 of 68** | 75 of 82 |
| `SECURITY DEFINER` functions executable by `anon` | **55 of 55** | 61 of 68 |
| `SECURITY DEFINER` without pinned `search_path` | 1 | 1 |
| RLS enabled on public tables | **all 55** | all 67 |
| Policies named "Service role …" without `TO service_role` in `public`+`storage` | **15**: "Service role full access to <table>" on 11 tables (addresses, customers, documents, messages, order_items, orders, payments, pricing_rules, route_stops, unit_media, units), plus `Service role can insert failures`, `Service role can update system status` and two storage "Service role can upload waivers" policies | 14: the same 11 tables + `user_roles` + the two `notification_*` policies |
| `anon` privileges on every public table | all seven, including TRUNCATE | same (masked by schema `USAGE` revoke) |
| `anon`/`authenticated` `USAGE` on `public` | true | false (containment) |
| `public` default ACLs | `postgres` **and** `supabase_admin` grant ALL on new tables/functions/sequences to anon/authenticated/service_role | none |
| `update_pricing_rules` | exists, `SECURITY DEFINER`, anon+authenticated can execute | absent |
| `cli_login_postgres` role | present, expired | present, valid to 18:00:18 UTC (disclosure 1) |

### H.2 Mapping

| Label | Finding (topic) | Evidence | Intended fix | Does the SQL do it? | Test after apply | Phase |
|---|---|---|---|---|---|---|
| SEC-A | **Master account uses the documented demo password.** `admin@bouncepartyclub.com` exists with role `master` on Prod and Dev; its hash matches the password in the header of `20251003170350_015_create_demo_admin_user.sql` | [V] hash comparison, yes/no only; credential never printed | none in any October migration | **No.** Not addressed anywhere. | after rotation, the same comparison returns false | **[U]** rotate now; **[S3]** remove the secret from history and migration comments |
| SEC-B | Open "Service role full access" policies (anon full read/write on 11 tables) | [V] Prod catalog | `20261012` resets policies on 28 tables | Yes (header and body agree); depends on Edge/frontend (G.2) | `select count(*) from pg_policies where schemaname in ('public','storage') and policyname ilike '%service role%' and not ('service_role'=any(roles))` → 0 | [S3]/[S4] |
| SEC-C | anon/authenticated function EXECUTE | [V] 68/68 anon on Prod | `20261007`, `1008`, `1010120000`, `1012`, `1013`, `1017`, `1019`–`1025`; `1013` sweeps by name | Yes for named functions. **Any function not named in 1013 and not revoked by another file keeps its current EXECUTE.** | list `anon`-executable functions and reconcile against an explicit allow-list | [S2] verify, [S3] fix gaps |
| SEC-D | Anonymous writes: `transaction_receipts`, `stripe_webhook_events` (anon INSERT can suppress Stripe events), `notification_failures`, `notification_system_status`, `crew_location_history`, `order_signatures`, `consent_records`, `contacts`, `order_lot_pictures`, `order_pictures`, `billing_addresses`, `site_events`, `pending_signups_consent` | [V] policy list | `1012` (most), `1013` (webhook events, billing), `1018100` (site events) | Yes except `pending_signups_consent` (anon INSERT deliberately retained, 1013 says so) | policies with `roles && {anon,public}` and write `cmd` → only intended rows | [S3] |
| SEC-E | Default privileges grant new objects to anon/authenticated | [V] Prod `postgres` and `supabase_admin` default ACLs | `20261018120000` | **Partly.** Handles owner `postgres` only. Prod's `supabase_admin` defaults remain. | `select * from pg_default_acl` | [S3] |
| SEC-F | Role enumeration and mutation | `get_user_role` any-id lookup; `assign_role_by_email` arbiter bug | `20261018120200`, `20261016`, `20261013` (`assign_user_role`/`remove_user_role` service-role only), `20261008` | Yes (header and body agree; all callers pass `auth.uid()` [V]) | non-self `get_user_role` returns NULL; `assign_user_role` EXECUTE false for anon/authenticated | [S3] |
| SEC-G | Public waiver, signature, customer-photo and evidence storage | [V] buckets public on Prod: `signed-waivers`, `signatures`, `lot-pictures`, `order-pictures`, `public-assets`, `carousel-media`, `unit-images`; Prod storage policies 31 | `20261014`, `20261015120000`, `20261015123000` | Yes by header and body; **needs Edge deploy first** | `select id, public from storage.buckets` → the four sensitive buckets private; `order-evidence` exists private | [S3]/[S4]; media copy owned by the refresh thread |
| SEC-H | Customer can set their profile's `contact_id` and claim another contact's orders | by header | `20261018120200` column-level UPDATE | Yes | `has_column_privilege('authenticated','public.customer_profiles','contact_id','UPDATE')` false | [S3] |
| SEC-I | Pricing authored in the staff browser; browser writes to money tables | by header | `20261021`, `20261022` | Yes (no direct browser writes remain in `src` [V]) | `has_table_privilege('authenticated','public.payments','INSERT')` false | [S3]/[S4] |
| SEC-J | `update_pricing_rules` callable by anon on Prod | [V] | `20261007` guarded revoke | Yes on Prod; n/a on Dev | EXECUTE false for anon/authenticated | [S3] |

**Confirmed Prod vulnerabilities [V]:** SEC-A, SEC-B, SEC-C, SEC-D, SEC-E (as a posture), SEC-J. **Verified only by header/source:** SEC-G, SEC-H, SEC-I (their migrations are unapplied; their pre-state on Prod is the catalog above).

### H.3 Functions and role behaviour (Area H)

- All SECURITY DEFINER functions named in the brief exist on both DBs with identical signatures, except `claim_booking_confirmation` (October) and `update_pricing_rules` (Prod only). [V]
- `assign_user_role`, `assign_role_by_email`, `remove_user_role`, `get_user_role`: covered by `20261013` / `1016` / `1018200` as in the table. `assign_role_by_email` ownership of the "master vs admin" rule is enforced inside the function body (read in full).
- Outdated callers: none of the browser/Edge callers I scanned depend on a signature October changes; `get_user_role(uuid)` keeps its signature. [V]

---

## I. Storage and media (Area I; no changes made)

- Prod: 8 buckets, **31** storage policies. Dev: 9 buckets (adds `event-essentials-media`), **7** policies. Dev lacks **29** of Prod's 31 by name; Dev has 5 Prod lacks. [V]
- The October storage migrations *replace* the policy set on nine buckets with a minimal one. The 7 present on Dev are **not** the target, and neither are Prod's 31. The target set is what `20261014/1015x` creates. Per your decision 3, nothing is copied.
- Historical URLs: `20261014` keeps `signed-waivers`/`signatures` rows working because readers extract the object path (header). Evidence photos stay in public `public-assets` until `scripts/migrate-order-evidence.mjs` runs. These are Step 4/6 acceptance items.

## J. Realtime (Area J)

- Prod publishes 6 tables; Dev publishes `orders` only. **Customer Portal does not depend on it** (G.4). Admin screens use `postgres_changes` on `orders` (`OrdersManager`, `useCalendarTasks`, `TaskDetailModal`) and `order_lot_pictures` (admin only); on Dev these keep working for `orders` and not for the tables absent from the publication.
- The earlier bug "admin edit does not appear on the customer's phone until refresh": the sender (`notifyPortalRefresh`, called from `staffOrderSaveRequest.ts:152`) has **no receiving listener** in `src`, and the portal relies on the 20 s poll. A defect in that chain would be found by Step 6 browser testing, not by SQL. [V, I]
- Parity decision (your decision 3): do not add publication members to match Prod until the target set is defined by the portal's actual dependencies (currently none).

## K. Pricing, payments and historical-data compatibility (Area K)

Checks to run before and after each October apply on Dev, compared:

1. Per-order totals (subtotal, fees, tax, deposit, balance) unchanged for all 171 orders; spot-check the 4 weekday-fee orders. 2. `payments`: row count, sum of `amount_cents`, status distribution unchanged by 1019/1022; the new unique indexes build (0 duplicates [V]). 3. `order_refunds`: the 5 legacy rows keep `ledger_version` NULL and still count as reservations. 4. Invoices: 82 rows, weekday fee 0. 5. `user_roles`: snapshot before 1016 (it deletes 2 orphan rows). 6. Stripe quarantine: imported payments carry no reusable Prod payment-method instruments; verify no claim path reads them. 7. `update_pricing_rules` (decision 3). 8. 16 unit references resolve after 1012 (policy, not data). 9. `pricing_rules` row unchanged (Dev = Prod: sandbag 3500, per-mile-after-base 300, free cities `["Detroit"]` [V]). 10. 22 of 171 Prod orders have NULL `customer_selected_payment_cents` (relevant to case 41).

---

## L. Revised Step 2 implementation plan (dependency-ordered; nothing executed)

### L.0 Owner decisions received in this revision and how the plan reflects them

| # | Your decision | Reflected as |
|---|---|---|
| 1 | Narrow replay-tool shim preserving applied SQL and the 15 recovered hashes; separately plan a correction of pending `20261016120000` | Section W.1 (shim spec), W.2 (1016 correction). Option B (edit applied files) is dropped. |
| 2 | Defer all five squash groups | Unchanged (section E). |
| 3 | Case 43: favour excluding the obsolete anonymous cancellation policy, truthfully, documented, tested; never mark an unapplied migration as applied; present the safe alternative | Section V: **E1 withdraw-before-application** (recommended) and **E2 apply-then-drop** (safe alternative). Marking it applied is rejected. |
| 4 | Docker-free read-only Prod schema-only snapshot with existing protected credentials plus catalog snapshots; no CLI command that initialises login roles | Section F.1 and X. Both capture methods are required, and the CLI is excluded from every hosted step. |
| 5 | Do not add `update_pricing_rules` to Dev automatically; audit consumers and intended long-term existence | Section T (audit completed: no consumer found). Nothing is added to Dev. |
| 6 | Correct the three inaccurate October headers in the approved phase; documentation-only | Section W.3, with a comment-stripped SQL-hash check that proves the change is documentation-only. |
| 7 | No Docker; inspect `cli_login_postgres` read-only after expiry; do not drop or modify without approval | Section U (inspected; no cleanup performed or required for correctness). |

### L.1 What "Step 2 complete" means: seven distinct stages

Writing a repair list is stage E. It does **not** complete Step 2.

| Stage | Name | Status now | Hosted effect |
|---|---|---|---|
| **A** | Recovery of the 15 historical migrations | **COMPLETE** (commit `014615b`; MD5 triple-verified; `recoveredMigrationFiles.test.ts` 63/0). Not repeated. | none |
| **B** | Evidence gathering and per-version classification | **PARTIAL.** Done: 43-case classification, October verification, drift facts, `update_pricing_rules` audit, role inspection. Not done: independent Prod baseline capture and per-version proof tables for 277 / 110 / 330 versions. | none (read-only) |
| **C** | Repair the replay tool and the pending-migration issues | NOT STARTED | none |
| **D** | Rehearse clean rebuild and Prod-equivalent upgrade (local disposable DBs only) | NOT STARTED | none |
| **E** | Prepare the specific, reviewable history-reconciliation plan | NOT STARTED (draft inputs in B.3, W.4) | none |
| **F** | Execute approved reconciliation (history bookkeeping only) | NOT STARTED; gated | Dev history rows (F1). Prod history rows (F2) per gate G8. |
| **G** | Post-reconciliation verification | NOT STARTED | read-only |

**Completion rule:** Step 2 is complete only when stages A–G are satisfied as defined in section N. Stage F is "required" because Dev's history cannot otherwise describe Dev's schema before Step 4; its Prod half (F2) is governed by gate G8.

### L.2 Approval gates

No gate has been approved. Every gate needs your explicit written approval in chat, naming the gate.

| Gate | Authorises | Does **not** authorise |
|---|---|---|
| **G1** | Read-only evidence capture: catalog snapshots by SQL for Prod and Dev, plus `pg_dump --schema-only` of Prod through the existing protected read-only URL, stored **outside the repo** (`C:\Users\vikki\migration-evidence\`, ACL restricted to your account) | CLI commands that touch hosted projects; any write |
| **G2** | Editing `scripts/dev/migration-replay.cjs` and its tests (shim, pending-set calculator, comment-stripped hash check) | Editing any migration file |
| **G3** | Editing pending `20261016120000` per W.2 (working tree only) | Editing any applied file |
| **G4** | Case 43 handling per section V (E1 or E2, you choose) | Marking anything applied |
| **G5** | Comment-only header corrections in pending `20261010110000`, `20261013120000`, `20261016120000` (W.3) | SQL changes |
| **G5b** | Redacting the committed demo password in `20251003170350_015_…` **after** you confirm rotation (section S) | History rewrite |
| **G6** | Local disposable-database rehearsals including the 23 October files | Any hosted execution of October files |
| **G7** | Dev history bookkeeping with the exact reviewed SQL list (W.4) | Any Dev schema change; any October execution; touching containment or stubs |
| **G8** | Prod history bookkeeping, **timing chosen by you** (decision N6) | Running it before you pick the window |
| Commits | Only when you say so. None is made in this revision. | |

**Standing prohibitions (always, no gate lifts them):** never apply the 43 baseline/alias files to Prod or Dev merely because their versions are missing from history; never pass `--include-all`; never execute the 23 October files on hosted Dev while the 14 Edge Functions are stubs and the coordinated release is unauthorised; no deployments; no hosted policy changes; no removal of Dev containment or stubs; no Step 3 remediation; no CLI command that initialises a login role or otherwise mutates a hosted DB; no password printing, login attempts or credential resets by me.

### L.3 Dependency-ordered stages

Each item lists: preconditions · exact actions · likely files · **evidence required** · stop conditions · rollback · done.

#### Stage B: evidence and classification

**B1 Independent Production baseline capture (G1).**
- Pre: G1 approved; the refresh thread is not running a Prod-touching operation (check `.SyncDevDataFromProd` activity).
- Actions: (a) catalog snapshot by SQL of Prod and Dev (tables, columns, types, defaults, identity, constraints, indexes, triggers, functions with body-md5/owner/`SECURITY DEFINER`/`search_path`/ACL, policies, table/column/function grants, default ACLs, publications, extensions, sequences, views, storage buckets and `storage.objects` policies); (b) `schema_migrations` export (version, name, md5 of statements) for both; (c) **second, independent capture of Prod**: `pg_dump --schema-only` (owners and privileges kept) with `PGOPTIONS='-c default_transaction_read_only=on'`, URL read inside the script and never echoed.
- Files: none in the repo (outputs outside the repo). The capture script is kept outside the repo until you approve adding it.
- **Evidence required:** a manifest with UTC time, project ids, server version, SHA-256 of every artifact; `SHOW default_transaction_read_only` = `on` and a refused write probe (reusing the refresh tool's proof pattern, `lib/run.mjs:64-67`); history row counts before and after capture identical (277 / 58); **agreement test between the dump and the catalog snapshot** (normalised comparison; every difference explained); credential scan of the dump with zero hits, or hits quarantined and reported without printing values.
- Stop: any write succeeds; counts change mid-capture; credentials found in the dump (quarantine, do not store plaintext elsewhere).
- Rollback: delete the evidence folder. Done: manifest exists and the agreement test is clean or fully explained.

**B2 Per-version proof tables.** Proof standard for "effect present": every object the file defines exists in the snapshot **or** the final state of every object it touches equals Prod's final state (catalog equivalence), with supersession cited. A version with a partial result is "partially present" and stops that version.
- Tables: (i) 277 Prod rows (recorded; 15 hash-pinned, 262 compared by effect); (ii) 110 Prod-pending (the 43 cases get the B.2 treatment, now computed from the snapshot; 44 Dev-line and 23 October must show "absent"); (iii) 330 Dev-unrecorded; (iv) the Dev `20260814002658` ↔ `20260814120000` mapping.
- Files (on approval of the evidence layout): `audit/evidence/prod-proof.csv`, `dev-proof.csv`, `prod-pending-classification.csv`.
- **Evidence required:** each row carries version, file, verdict, evidence query id, snapshot id. 100 % of rows classified; zero "assumed".
- Stop: any "partially present". Done: all rows classified.

**B3 Drift register.** Every out-of-band difference between "what the repo's recorded history would build" and the Prod snapshot, each with class, evidence and treatment. Seeded with: `user_roles_role_check` absent on Prod; no `user_roles → auth.users` FK on Prod; `orders` publication membership at `20260615175816`; Dev snapshot-only effects (parks columns, weekday-fee column, four units: *refresh #1168*); `20260712101626` on Dev. Output: `audit/evidence/drift-register.md`.

**B4 `update_pricing_rules` audit:** done (section T). **B5 role inspection:** done (section U). **B6 password source evaluation:** done (section S).

#### Stage C: repair the replay tool and pending-migration issues

**C1 Replay-tool compatibility shim (G2).** Spec W.1. Evidence: static allow-list test; mutation test proving each step is necessary; recovered-migration test still 63/0 and **no file under `supabase/migrations/` changed** (git diff of that folder empty); safety rules of the tool unchanged (loopback, scratch prefix, ownership marker).
**C2 Pending `20261016120000` correction (G3).** Spec W.2. Evidence: ordering test, six scratch scenarios (W.2), idempotent re-run, comment-stripped diff showing only the intended statement moves.
**C3 Case 43 handling (G4).** Section V. Evidence: the chosen option's tests; pending-set calculator output.
**C4 Header corrections (G5).** Spec W.3. Evidence: comment-stripped SQL md5 identical before and after for each of the three files.
**C5 Pending-set calculator.** A small function in the replay tool that computes `local versions − history rows`, used to prove the pending list in D and G without any hosted CLI call.

Stop (stage C): any recovered file hash changes; any applied file shows in `git diff`; a shim step cannot cite drift-register evidence. Rollback: `git revert` / discard working-tree changes. Done: all C-items pass their tests on a clean checkout of the working tree.

#### Stage D: rehearsal (local disposable databases only; G6)

**D1 R-1 clean rebuild** (strict, shim on, `20260323201502` skipped). Evidence: exit 0 with the "STRICT REPLAY COMPLETED" line; per-file error count 0; the ordered file list hash.
**D2 R-2a rebuild-versus-live comparison** (section X.2): rebuild Prod's recorded history in scratch, compare with the independent Prod baseline from B1, classify **every** discrepancy. Evidence: discrepancy table with zero unclassified rows.
**D3 R-2b upgrade rehearsal from the restored Prod snapshot** (section X.3): restore the Prod schema-only dump into scratch, apply the pending set in version order (44 Dev-line files and the 23 October files; case 43 per V; the 42 baseline/alias files are **never applied**), then assert convergence and run Section H/K assertions.
**D4 Synthetic-data checks** (section K items 1–10 on a seeded scratch copy, never on hosted data).
**D5 Re-run after any fix** on a fresh scratch database (no state reuse).

Stop (stage D): any October file errors; any unclassified discrepancy; the Prod baseline older than 24 h at the time of D2/D3 (re-capture). Rollback: drop the scratch databases (the tool only drops databases it created). Done: D1–D4 evidence archived.

#### Stage E: reviewable reconciliation plan

Output: `audit/evidence/reconciliation-manifest.md` containing, per environment, (a) the exact versions to record, (b) the proof id for each, (c) the exact SQL (W.4), (d) the expected row-count delta, (e) the expected pending set after, (f) the rollback SQL, (g) for case 43 the chosen handling. Evidence: the pending-set calculator, run on a copy of each history table with the bookkeeping applied, returns exactly the intended pending set (Dev: the 23 October files; Prod: the 44 Dev-line files plus the 23 October files, with case 43 handled per V). **Done: you have reviewed and approved the manifest in writing. Stage E is not Step 2 completion.**

#### Stage F: execute approved reconciliation (history rows only)

**F1 Dev (G7).** Single transaction per the W.4 template; asserts inserted-row count equals the manifest; rolls back on mismatch. **No schema change, no October file executed, containment and stubs untouched.**
**F2 Prod (G8).** Same template. Timing is your decision N6: (X, recommended) execute in the production window immediately before the release deploy, with the exact reviewed list frozen in Step 2 and rehearsed in D; or (Y) execute now. Under X, Step 2 is recorded "complete with Prod execution scheduled as a Step 9 precondition"; under Y, Step 2 completes only after F2 and its verification.

Stop (stage F): inserted-row count differs; any non-history row changes; any proof id missing. Rollback: the manifest's delete-by-version SQL, run only for the rows this stage inserted (identified by the marker text in `statements`).

#### Stage G: post-reconciliation verification (read-only)

Dev: (1) history rows = 58 + N exactly and the inserted versions equal the manifest; (2) catalog snapshot after equals catalog snapshot before, apart from `schema_migrations`; (3) pending-set calculator returns exactly the 23 October files; (4) no October object exists on Dev (function-absence spot checks); (5) containment intact (`has_schema_privilege('anon','public','USAGE')` false); (6) the 14 stubs unchanged (versions and update times equal the manifest); (7) imported data counts unchanged (171/123/185/82/5/147); (8) Prod history count still 277 and its catalog hash equals B1 (until F2). Prod after F2: the same checks adapted, plus the pending list equals the approved release set.
Done: all checks recorded with output files and hashes.

### L.4 Global stop conditions and rollback safeguards

- Stop and report if: any hosted write is observed that you did not approve; a counted fact in this report no longer holds (history counts, function lists); a recovered-file hash changes; a rehearsal needs a secret in chat; the refresh thread is mid-operation on the same project.
- Safeguards: hosted work uses only read-only sessions or the explicitly approved transaction; every artifact is hashed; scratch databases carry the tool's ownership marker; nothing is committed without approval; every code change is a working-tree change that `git restore` undoes.

---

## M. Risk register

| # | Risk | Severity | Likelihood | Impact |
|---|---|---|---|---|
| 1 | Master account uses the documented demo password (Prod and Dev) | Critical | Certain | takeover of the master role |
| 2 | `db push --include-all` on Prod replays the 43 files (re-opens policies, resurrects `start_date/end_date`, overwrites pricing/functions) | Critical | Only if flag used | data/pricing corruption |
| 3 | Prod open policies and 68 anon-executable functions today | Critical | Certain | live exposure until Step 3/4 |
| 4 | October lockdown breaks flows that depended on open policies (`transaction_receipts` update, crew `task_status` insert, others unseen) | High | Medium | feature outage |
| 5 | 23 October files never executed on a real Supabase DB | High | Certain | unknown defects |
| 6 | `20261016` deletes 2 orphan `user_roles` rows per DB and adds an FK | Medium | Certain (small) | snapshot first |
| 7 | Financial migrations on historical rows | Medium | Low (0 duplicate PIs [V]) | blocked apply |
| 8 | Prod history ≠ Prod schema (role CHECK, Realtime) | Medium | Certain | clean rebuild never equals Prod without a shim |
| 9 | Version aliasing recurs when applying October by a tool that restamps versions | Medium | Likely | history confusion |
| 10 | Stub rehearsal cannot cover PostgREST/Realtime/Storage/Auth | Medium | Certain | needs release-candidate testing |
| 11 | A shim that is too broad hides a real defect | Medium | Low | mitigated by allow-list, evidence-citation and mutation tests (W.1) |
| 12 | Bookkeeping rows read as "SQL ran" when it did not | Medium | Medium | mitigated by the marker text in `statements` and the manifest (W.4) |
| 13 | Evidence capture collides with the refresh thread working on the same project | Low | Medium | check activity first; read-only sessions only (B1) |
| 14 | Baseline snapshot goes stale between capture and rehearsal | Medium | Medium | 24 h freshness rule (X.1) |
| 15 | Prod snapshot contains credentials embedded in function bodies | Medium | Possible | credential scan, quarantine, outside-repo storage (B1) |

## N. Definition of done (objective, by stage)

Step 2 is complete only when **every** item below is satisfied and its evidence file exists. Items are not interchangeable and a lower stage never substitutes for a higher one.

| # | Stage | Criterion | Exact evidence |
|---|---|---|---|
| 1 | A | The 15 recovered files exist, are tracked and match Prod's recorded SQL | `recoveredMigrationFiles.test.ts` 63 passed / 0 failed; the three-way MD5 table in section C of this report |
| 2 | B | An independent, current Prod baseline exists (SQL catalog snapshot **and** schema-only dump that agree) | B1 manifest with hashes; agreement test clean or fully explained |
| 3 | B | Every one of the 277 Prod rows, 110 Prod-pending versions and 330 Dev-unrecorded versions has an evidence-backed verdict | the three proof tables, 100 % classified, no "assumed" |
| 4 | B | Drift register complete; every drift item classified | `drift-register.md`, zero unclassified |
| 5 | C | Shim exists, is allow-listed, test-covered, mutation-tested; **no file under `supabase/migrations/` changed by it** | tool tests green; `git diff -- supabase/migrations` empty for applied files |
| 6 | C | Pending `20261016120000` handles the role CHECK before normalising data | ordering test + six scratch scenarios (W.2) green |
| 7 | C | Case 43 handled truthfully per your G4 choice, never marked applied | withdrawal manifest + test (E1) or apply-then-drop test (E2) |
| 8 | C | The three October headers are corrected with SQL unchanged | comment-stripped SQL md5 identical for all three files |
| 9 | D | R-1 clean rebuild passes strictly | "STRICT REPLAY COMPLETED", 0 errors, only `20260323201502` skipped |
| 10 | D | R-2a: rebuild-versus-live discrepancy table has **zero unclassified rows** | discrepancy table |
| 11 | D | R-2b: the pending set applies without error onto the restored Prod snapshot and the convergence, Section H and Section K assertions pass | rehearsal report |
| 12 | E | The reconciliation manifest was reviewed and approved by you in writing | your approval message referenced in the manifest |
| 13 | F | Dev history bookkeeping executed exactly as approved (F1); Prod bookkeeping executed or explicitly scheduled per your N6 choice | F1 transcript (row-count assertion passed); for F2 either its transcript or the frozen manifest plus your written deferral |
| 14 | G | Post-reconciliation verification passes (L.3 stage G) | verification output files and hashes |
| 15 | Hosted state | No hosted change other than the approved F steps and the already-disclosed expired Dev `cli_login_postgres` role | before/after catalog hashes |
| 16 | Security | SEC-A is rotated by you and verified (section S.3), or you have accepted the risk in writing | verification output |

**Not part of Step 2 completion:** Step 3 security remediation, Step 4 deployment, Step 6 browser acceptance (section R lists what they inherit).

## O. Corrections to the previous version of this report

| Previous claim | Correction |
|---|---|
| "20260407211122 … the anon INSERT policy is present on Prod" | **Wrong.** Prod's policy covers `customer_approval`/`status_change`, not `cancellation`. Case 43's effect is absent. |
| "alias files have the same effects as Prod's recorded versions" | Cases 41–42 are same-intent but **different SQL** from the recorded twins. |
| "Dev has effects of 20260816…/20260928… because of snapshot" | For parks and weekday-fee columns the cause is *refresh #1168* (direct change, no history row). |
| "assign_user_role / remove_user_role are not touched by any October migration" | They are, by `20261013120000` (service-role-only list). Corrected in the previous revision; retained here for the log. |
| "October migrations: line-by-line verification not done" | Done (section G). |
| "no hosted changes" (final confirmation of the previous revision) | Not true: disclosure 1. |
| "squash groups: deferred" | Unchanged; now supported by *refactor #367 §D*. |
| C.2 "Options evaluated (no selection made)" | Your decision 1 selects option A (shim) and drops editing applied files; see W.1/W.2. |
| F.3 R-2 "rebuild from migrations, then compare" | **Insufficient.** Confirmed out-of-band drift means a rebuild cannot stand in for Prod. Replaced by section X (independent baseline, two arms, zero unclassified differences). |
| D.1 "Dev `20260712101626`" and "update_pricing_rules" lead | `update_pricing_rules` audited in T; nothing is added to Dev. |
| Disclosure of the Dev `cli_login_postgres` role | Inspected after expiry (section U): expired, 0 sessions, owns nothing; not dropped. |
| S (new) | Git evidence for the password: 11 commits across five branches; repository visibility not determinable here. |

## P. Evidence incorporated from the prior conversations

- *refresh #64* (your message): "Approved: proceed with Phase 1 (local sync tool in preview-only mode, rehearsed on scratch Postgres). Do not commit or push."
- *refresh #1168*: the seven approved Dev changes and "Development still lists 58 versions".
- *refresh #1245*: Prod session read-only, a write refused; direct connection strings worked.
- *refresh #1405, #1432*: the project's CLI 2.58.5 has no `--use-api`; the scoop CLI 2.104.0 has it for `functions download`, needing no Docker; backups under `.dev-refresh/function-backups/20261016-dev-14/` (now `.SyncDevDataFromProd/…`).
- *refresh #1364 / #1375 / #1398*: you asked whether Docker was ever ruled out because of the Boot Camp partition; the assistant found another thread ("Migration audit and cleanup") that already knew.
- *refresh #1576, #1749*: `REVOKE USAGE ON SCHEMA public FROM anon, authenticated` applied; run `20261016-102714` applied at 2026-10-16 17:02Z; plan hash `e349a34d`; `media-copy` had not run.
- *refactor #367 §E–§H*: Prod history "already out of order"; 15 Prod-only migrations had no files; "a preview branch does not clone Prod's schema. It replays the repo's `supabase/migrations` from scratch"; recommendation to rehearse from a **Prod schema dump in a local scratch Postgres** and to validate clean rebuilds separately; "Do not create the paid branch yet." (consistent with your decision 5).
- Recovery commit `014615b`: 15 files restored, "A complete strict clean migration rebuild does not yet pass", two unresolved issues (uppercase role CHECK; duplicate Realtime add).

## Q. Owner decisions

### Q.1 Received (seven, this revision): see L.0. They are final unless you say otherwise.

### Q.2 New decisions requested before any execution

| # | Decision | My recommendation |
|---|---|---|
| N1 | Approve **G1** (read-only evidence capture, including `pg_dump` through the existing protected URL) and the storage location `C:\Users\vikki\migration-evidence\` (outside the repo) | Approve |
| N2 | Approve **G2**/**G3** scope: shim and 1016 correction as specified in W.1/W.2 | Approve after reading W.1/W.2 |
| N3 | Case 43: **E1 withdraw** (recommended) or **E2 apply-then-drop** | E1 |
| N4 | Dev's `20260814002658`: leave the Dev row and add a row for `20260814120000`, **or** rename the repo file to `20260814002658` (safe because Prod never applied it and Dev recorded that version), **or** leave both unreconciled until Step 4 | Rename the file (it also removes the ordering defect that `20260814120100` works around); needs its own approval and a test |
| N5 | After you rotate: approve **G5b** (redact the demo password in `20251003170350_015_…`, option O1 in S.4)? Git history rewrite is **not** proposed | Approve G5b only after rotation is verified |
| N6 | Prod bookkeeping timing (**G8**): X = in the production window (recommended), Y = now | X |
| N7 | May the three header corrections be bundled with the 1016 edit in one working-tree change set, or kept as separate steps? | Separate steps, 1016 SQL change first |
| N8 | Confirm that I should treat the hosted-source observations reported by the scan subagent (section T.3, R.4) as leads to verify, not facts | Yes |

## R. Issues reserved for Steps 3, 4 and 6 (kept separate from Step 2)

None of these is executed or fixed in Step 2. Labels: [V] verified here · [H] historical · [S] reported by the read-only scan subagent, **not independently verified by me** · [I] inference.

### R.1 Step 3: security remediation (Development first)

| # | Issue | Evidence |
|---|---|---|
| 3.1 | **SEC-A follow-through** after your rotation: redact the committed password (S.4), confirm no other account uses it, review who holds `master`, consider MFA | S |
| 3.2 | Reconcile the anon-executable function list (Prod 68/68, Dev 75/82) against an explicit allow-list; anything not named in `20261013120000` keeps today's grants | H.1 [V] |
| 3.3 | Prod `supabase_admin`-owned default ACLs in `public` (tables/functions/sequences to anon/authenticated/service_role) are **not** changed by `20261018120000` | [V] |
| 3.4 | `pending_signups_consent` keeps anonymous INSERT (deliberate per `20261013`); decide whether that is acceptable | [V] |
| 3.5 | `Crew update orders` lets any crew member update every non-guarded `orders` column; `Crew read customers` exposes all customers to crew | `20261012` header and body [V] |
| 3.6 | Missing policies: crew `task_status` INSERT; no UPDATE policy on `transaction_receipts` (admin code sets `receipt_sent_to_admin`) | G.4 [V] |
| 3.7 | One `SECURITY DEFINER` function without a pinned `search_path` on both DBs (identify it) | H.1 [V] |
| 3.8 | `update_pricing_rules`: long-term drop vs keep (T); Prod exposure is closed at deploy by `20261007` | T [V] |
| 3.9 | Storage policy target set and Dev parity (Dev lacks 29 of Prod's 31; the October set is the target) | I [V] |
| 3.10 | Hygiene: expired `cli_login_postgres` roles (Dev expired 2026-10-16 18:00Z, Prod expired 2026-10-07); a standing rule that CLI commands that initialise login roles are not used on hosted projects | U [V] |
| 3.11 | Dev has no `auth.users` trigger today (signups are not provisioned); `20261016` adds it | [V] |
| 3.12 | A hosted Prod function reportedly calls `get_admin_users`, which `20261008` makes service-role-only: identify the function and its client type before deploy | [S] |
| 3.13 | Public buckets on Prod today (`signed-waivers`, `signatures`, `lot-pictures`, `order-pictures`, `public-assets`) | H.2 SEC-G [V] |

### R.2 Step 4: coordinated Development release

| # | Issue | Evidence |
|---|---|---|
| 4.1 | Deploy-first gates: waiver functions (before 1014), `customer-portal-*` and `task-evidence` (before 1015×2), `record-site-event` (before 1018100), `staff-order-save` (with 1021), `complete-booking`/`create-booking` (with 1010120000, 1017), `stripe-refund` (with 1022/1024) | G.2 [V] |
| 4.2 | Replace 13 stubs, retire `send-booking-confirmation` (hosted-only); JWT setting changes `save-payment-method-from-session` false→true, `stripe-checkout` false→true, `save-signature` true→false | G.5 [H/V] |
| 4.3 | `get-waiver-status` is live v12 where the manifest implies v10 | G.5 [V] |
| 4.4 | Apply October with **file version = recorded version** (rule R3) and without a CLI path that initialises login roles; choose the mechanism before Step 4 | D.3, U |
| 4.5 | Dev-line prerequisites for `20261012`: `20260722212750` (`order_portal_links`) and the `20260929*` files must be applied first | G.1 [V] |
| 4.6 | `20261016` deletes 2 orphan `user_roles` rows per DB, adds an FK, and creates a trigger on `auth.users`; snapshot first | G.1 [V] |
| 4.7 | Hosted-source observations to verify before deploy: Prod `record-consent` source returned empty (0 bytes); Prod `create-order-short-link` calls `create_order_short_link`, an RPC that does not exist on Prod's database yet | [S] |
| 4.8 | Regenerate `src/lib/database.types.ts` only after Dev holds the pending migrations | *refactor #367 §I* [H] |
| 4.9 | Run `scripts/migrate-order-evidence.mjs` under its own approval; remove the schema containment only after the release is verified | G.1 [V] |

### R.3 Step 6: real-browser acceptance

| # | Check | Evidence |
|---|---|---|
| 6.1 | Customer Portal live refresh: poll every 20 s plus focus/visibility; `notifyPortalRefresh` broadcasts `order_updated` that **nothing in `src` listens to**; reproduce the "admin edit not shown on the phone" report end to end | G.4 [V] |
| 6.2 | Crew flows after `20261012`: `ensureTaskStatus` insert, evidence uploads through `task-evidence` | G.4 [V] |
| 6.3 | Receipt flags (`receipt_sent_to_admin`) silently not updated after `20261012` | G.4 [V] |
| 6.4 | Signup: the Google-address branch of `auto_assign_customer_role` is silently skipped (`addresses.user_id` / `is_default` absent on both DBs) | G.1 [V] |
| 6.5 | Private buckets: signed-URL reads in Admin, Crew and Customer screens; historical full-URL rows; evidence photos still public until migrated | I [V/H] |
| 6.6 | Admin Realtime on Dev covers `orders` only; screens that subscribe to `payments`, `task_status`, `order_signatures`, `order_lot_pictures`, `order_pictures` | J [V] |
| 6.7 | Admin Edit / Invoice through `staff-order-save`; refund panel and allocation; deposit catch-up; weekday-fee orders | G.1, K |
| 6.8 | Booking creation with the setup proof; confirmation claim (no double send) | G.1 |
| 6.9 | Portal link revocation and expiry (60-day rule) | G.1 |
| 6.10 | Role/permissions screens after the role CHECK change | G.1 |

### R.4 Hosted-source observations from the scan subagent [S]

Read-only scan of the 44 Edge Functions deployed on Prod through `get_edge_function`: none references `update_pricing_rules` or `pricing_rules`; `record-consent`'s `index.ts` came back empty; the RPCs called were `get_admin_users`, `check_rate_limit`, `check_date_blackout`, `record_notification_failure`, `record_notification_success`, `increment_order_refunded_cents`, `apply_balance_payment_financials`, `record_cash_payment`, `record_check_payment`, `get_user_role` and `create_order_short_link`. I did not re-read these functions.

---

## S. SEC-A: the committed demo password

### S.1 Facts [V]
- At HEAD the documented demo password appears **only in** `supabase/migrations/20251003170350_015_create_demo_admin_user.sql` (2 occurrences: header comment and the INSERT). No other tracked file contains it.
- In Git history it appears in **11 commits** (2025-10-03 to 2026-10-07), including documents and scripts that were later deleted. The introducing migration commit `0887247` is reachable from `main`, `Dev`, `origin/Dev`, `chore/prod-migration-recovery` and `backup-main-before-rollback`.
- The remote is `github.com/hawkinsd90/BouncePartyClubSite`. **I could not determine whether it is public** (`gh` is not installed). Check its visibility, forks and any external clones yourself. Rewriting history cannot recall copies that already exist, so rotation is what removes the risk.
- File `015` is not hash-pinned by any test, is not among the 15 recovered files, and has no Prod history row (it predates tracked history), so there is no recorded-SQL hash that editing it could break. Its effect (the account) already exists on both DBs.

### S.2 Rotation: owner only
I will not print the value, attempt a login, reset credentials or modify Production.

### S.3 Post-rotation verification (read-only; no password printed)
Run on **Prod and Dev separately**, from a script that assembles the old literal at runtime from parts so the value never appears in a command or output; each check returns a boolean or a count only:
1. The stored hash of `admin@bouncepartyclub.com` no longer matches the documented password → `false`.
2. A hash **fingerprint** (first 8 hex of `md5(encrypted_password)`), recorded before rotation, now differs.
3. The number of accounts in `auth.users` whose hash matches the documented password is `0`.
4. Sessions: `auth.sessions` / refresh tokens for that user created before the rotation time are gone, if you chose to sign out other sessions.
5. The account's `user_roles` rows are unchanged (`master`), and no new account was created.
6. Dev is rotated too (it has its own auth store and the same account).
7. A real sign-in with the new credential is performed **by you**.
Evidence: the output file of checks 1–6 with timestamps and project ids.

### S.4 Removing the committed value from accessible source without disturbing hashes
| Option | What changes | Hash/history impact | Verdict |
|---|---|---|---|
| **O1** Redact `015` at HEAD (replace the comment and the literal with a runtime-generated random password so a rebuild still creates a usable throw-away demo user) | one file; one commit | changes only `015`'s own hash; the 15 recovered files and every recorded Prod/Dev SQL hash are untouched (verified: nothing pins `015`) | **Recommended, after rotation, as G5b.** It is an edit of an applied historical file, so it needs your approval; the proof that nothing depends on its hash is in S.1. |
| O2 Leave the file, rely on rotation | none | none | Acceptable only if you accept that the value stays discoverable in the repo |
| O3 Rewrite Git history (`filter-repo`/BFG) | **every commit hash changes** (HEAD `014615b`, all branches, any PR, other sessions' worktrees) | breaks the recorded commit references in the other conversations' evidence | **Not proposed in this task**; would be a separate, approved project, and still needs rotation |

---

## T. `update_pricing_rules`: consumers and intended existence

### T.1 Evidence [V unless marked]
- **Definition:** `20260611184401_create_update_pricing_rules_rpc.sql`; `SECURITY DEFINER`, 11 parameters, updates one `pricing_rules` row. Prod has it; Dev does not and never had it.
- **Repo:** no caller in `src` or `supabase/functions`; the Admin UI updates the table directly (`PricingRulesTab.tsx:112`, `queries/pricing.ts:19`). The only repo references are its own migration and `20261007` (guarded revoke).
- **Prod database:** no other function, policy, view or trigger references it; `pg_cron` is not installed; `track_functions` is `none`, so there are **no call statistics**; grants today: PUBLIC/anon/authenticated/service_role.
- **Prod API logs:** 0 calls to a path containing `update_pricing_rules` in the last 24 h (the logs API caps the window at 24 h).
- **Hosted Edge Functions on Prod:** none of 44 references it [S].
- **Intent [I]:** created the same day as `reload_pgrst_schema_cache` and `force_pgrst_schema_cache_refresh` (2026-06-11), after adding `same_day_weekday_delivery_fee_cents`; it looks like a workaround for a PostgREST schema-cache problem.

### T.2 Conclusion and plan
No consumer was found, but absence of evidence over 24 h of logs and no call counters is **not proof**. Recommendation: do not add it to Dev; let `20261007` make it service-role-only on Prod (reversible); decide drop vs keep in Step 3 after monitoring for permission-denied errors on that function after deploy. Confirm with you whether any external script, dashboard or SQL-editor habit calls it. A drop would be a separate migration needing its own approval.

### T.3 Open verification
Hosted-source findings rely on the subagent's report [S]; re-read in Step 3 if the decision depends on it.

---

## U. Temporary Dev role `cli_login_postgres`: read-only inspection after expiry [V]

| Item | Dev | Prod |
|---|---|---|
| Exists | yes | yes |
| `rolvaliduntil` | 2026-10-16 18:00:18 UTC; database clock at inspection 18:14:14 UTC → **expired** | 2026-10-07 20:02:18 UTC → expired |
| Active sessions | 0 | not checked |
| Member of | `postgres` | not checked |
| Objects owned | 0 relations, 0 functions | not checked |
| `rolcanlogin` / `rolsuper` | true / false | true / false |

Assessment: an expired password cannot authenticate, so no live access remains; the role owns nothing, so a later `DROP ROLE` would need no reassignment. Cleanup is **not required for correctness**. Because it is a `postgres` member, if the CLI mints a new password the role is powerful again for about an hour; the safeguard is the standing rule in R.1 3.10. Exact statement for later approval (not run): `DROP ROLE cli_login_postgres;` after confirming no sessions and no owned objects. Prod's role predates this audit and is outside what I touched.

---

## V. Case 43 (`20260407211122`): exclusion that stays truthful

Facts [V]: effect absent on Prod and Dev; no history row anywhere; Prod's existing anonymous INSERT policy on `order_changelog` allows only `customer_approval`/`status_change`; `20261012` drops every `order_changelog` policy and creates admin-only ones; customer cancellations go through the `customer-cancel-order` Edge Function.

| Option | Mechanism | Truthfulness | Test | Rollback |
|---|---|---|---|---|
| **E1 Withdraw before application (recommended)** | `git mv` the file to `supabase/withdrawn-migrations/` with a README and a manifest entry (version, name, reason, evidence ids, date, approver) | Nothing is recorded as applied. The version simply never runs anywhere, and the manifest says so. A CLI sees no local file and no remote row. | (1) file absent from `supabase/migrations/`; (2) manifest lists it; (3) recorded query output shows no history row on either DB; (4) the pending-set calculator ignores it; (5) replay builds without it | `git mv` back |
| **E2 Apply in order, then drop (safe alternative)** | leave the file; it runs before `20261012` in the same release and `20261012` drops the policy | Truthful: it is genuinely applied, and the history says so | after the full pending set, `order_changelog` has **no** anonymous INSERT policy; the two migrations are applied in one approved window | none needed |
| ~~E3 Mark as applied~~ | `migration repair --status applied` or an inserted row | **False record. Rejected.** | n/a | n/a |

The file is already in `main`, so E1 appears as a deletion/move in the release PR; that is intended and documented.

---

## W. Specifications for stage C (none implemented)

### W.1 Replay-tool shim (G2)
- **Where:** only `scripts/dev/migration-replay.cjs` and its tests. No migration file is edited, so the 15 recovered hashes cannot change.
- **Form:** a declarative `COMPAT_STEPS` list. Each step: `id`, `when` (`after:<version>` or `before:<version>`), `sql`, `evidence` (drift-register id), `scratch-only`.
- **Initial candidates (confirmed or rejected by the D2 drift diff, not assumed):**
  1. `after:20251207163822` → `ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;` (Prod has no such CHECK [V]).
  2. `before:20260615175816` → drop `public.orders` from `supabase_realtime` **only if** it is a member (reproduces Prod's apparent state at that moment; the file then runs unchanged).
  3. Only if D2 shows it matters: remove the `user_roles → auth.users` FK that Prod lacks.
- **Guards:** `--no-compat` shows the raw failures; the report lists every applied step with its evidence id; strict mode prints that compat steps ran.
- **Tests:** (a) every step cites evidence; (b) allow-list: only `DROP CONSTRAINT IF EXISTS`, guarded `ALTER PUBLICATION … DROP TABLE`, no DML; (c) mutation test: deleting a step makes strict replay fail at the expected file; (d) `recoveredMigrationFiles.test.ts` still 63/0; (e) existing safety assertions (loopback, scratch prefix, ownership marker) still pass.

### W.2 Pending `20261016120000` correction (G3)
- **Defect:** the normalising `UPDATE` (line 54, inside the DO block at lines 44–59) runs before the CHECK is replaced (lines 62–78). A database that still has the uppercase CHECK fails; Prod and Dev (no CHECK) do not.
- **Change:** reorder only: (1) drop every CHECK that constrains `role` (current lines 61–75); (2) delete duplicates, lowercase, run the vocabulary guard (current lines 44–59); (3) add the lowercase CHECK (current lines 77–78); (4) the FK block unchanged.
- **Second reported error [I]:** the stub's `auth.users` is empty, so the guard `auth.users is empty; refusing…` fires. Keep the guard (it protects against deleting every role row); the rehearsal seeds at least one synthetic auth user and asserts the guard still raises on an empty table. The exact error is confirmed in D1 by capturing per-statement errors.
- **Scratch scenarios (all must pass):** (i) legacy uppercase CHECK + uppercase rows; (ii) Prod-like (no CHECK, lowercase rows, 2 orphans); (iii) a role outside the vocabulary → raises; (iv) empty `auth.users` → raises; (v) idempotent re-run; (vi) FK present afterwards and orphans removed.
- **Safety before any hosted use:** snapshot `user_roles` and the 2 orphan rows per DB.
- **Evidence:** ordering test by statement index; comment-stripped diff showing only the block move; scenarios green.

### W.3 Header corrections (G5), documentation-only
Replace the three false statements (`20261010110000`: "no earlier migration creates it"; `20261013120000`: "no tracked migration"; `20261016120000` item 6: "repository migrations never create them") with accurate text naming the recovered files. **Proof of documentation-only:** strip `/* … */` and `--` comments, normalise whitespace, md5 before and after must be equal for each file.

### W.4 Bookkeeping template (G7/G8), reviewed before use
```sql
-- Dev (or Prod): one transaction; no schema change; no CLI.
begin;
  -- expected_before = <N0 from manifest>
  insert into supabase_migrations.schema_migrations (version, name, statements)
  values
    ('<version>', '<file name without extension>',
     array['-- reconciled by evidence: effects verified present; SQL not executed here; proof <id>; <UTC date>'])
  -- ...one row per manifest line...
  on conflict (version) do nothing;
  -- assert: count(*) = <N0> + <manifest rows>, otherwise raise exception and roll back
commit;
-- rollback (only rows this stage inserted):
-- delete from supabase_migrations.schema_migrations where statements[1] like '-- reconciled by evidence:%';
```
The marker in `statements` keeps the record truthful (the SQL was **not** run) and makes rollback exact. Alias cases 41–42 add rows for the repo versions even though Prod already holds differently versioned twins; the manifest records that.

---

## X. Revised R-2: Production-equivalent rehearsal (replaces the rebuild-only design in F.3)

Historical migrations alone cannot reproduce Prod (confirmed drift), so R-2 has two arms and an independent baseline.

### X.1 Independent baseline
Captured in B1 within 24 h of the rehearsal: SQL catalog snapshot **and** `pg_dump --schema-only`, which must agree with each other. Recorded with time, project id, server version, `schema_migrations` hash. If older than 24 h at D2/D3, capture again.

### X.2 R-2a: rebuild versus live
Rebuild Prod's recorded history (277 Prod files + the 40 baseline files, shim on) in a scratch database and diff its catalog against the Prod baseline. Compared: tables, columns, types, defaults, identity, constraints, indexes, triggers, functions (body md5, owner, `SECURITY DEFINER`, `search_path`, ACL), policies, table/column/function grants, default ACLs, sequences, views, extensions, publications, storage buckets and `storage.objects` policies. Data is excluded.
**Every difference is classified; zero may remain unclassified:**

| Class | Meaning | Treatment |
|---|---|---|
| K1 | replay/stub artefact (no Supabase internals, `pg_net`) | documented, none needed |
| K2 | historical out-of-band Prod drift | reproduced by a cited shim step or recorded as accepted, with evidence |
| K3 | data-dependent difference | documented with the data fact |
| K4 | expected difference (object exists only on one side because of pending work) | listed |
| K5 | **unexplained** | **blocks the rehearsal**; investigate before continuing |

### X.3 R-2b: upgrade from the restored Prod snapshot
Restore the **Prod schema-only dump** (not the rebuilt database) into a fresh scratch database; apply the pending set in version order; then assert:
1. zero errors;
2. **convergence:** the final catalog equals the R-1 clean-rebuild final catalog except for K2/K4 items already classified (any other difference is a defect);
3. Section H assertions (anon-executable allow-list, no unscoped service-role policies, bucket privacy where stubbable);
4. Section K data checks on a synthetic seed;
5. `schema_migrations` after = before + the pending versions only.
The 42 baseline/alias files are never applied in either arm of R-2b.

### X.4 What this cannot prove
PostgREST exposure, Realtime delivery, Storage API behaviour and Auth hooks (stub limits); those move to Step 4/6. A hosted branch is not used (your decision 5 of the previous round, restated).

---

## Y. Hosted environment state at the end of this revision

- **Prod:** unchanged by me (read-only SQL, `list_*`, one 24 h log query). History 277 rows. Expired `cli_login_postgres` (2026-10-07) pre-dates this audit.
- **Dev:** unchanged apart from the already-disclosed `cli_login_postgres` role (now expired, 0 sessions, 0 owned objects, still present). History 58 rows. Containment and the 14 stubs untouched; imported data untouched.
- **Edge Functions:** read-only `list`/`get` through the scan subagent; no deployment.
- **No Docker, no CLI command against either project, no password handling in this revision.**
