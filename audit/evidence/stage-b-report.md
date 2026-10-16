# Step 2, Stage B: evidence capture and per-version classification

Captured 2026-10-16 18:54:59 UTC (Prod) and 18:55:20 UTC (Dev). Branch `Dev`, HEAD `014615b6e481994856e96f4bcbcc1da1e52f006f`.
**No Stage C work was started.** Nothing in either database, in any migration file, or in any deployed function was changed by this stage.

Evidence labels: **[V]** verified in this stage · **[I]** inference · **[L]** limitation of the method.

## 1. How the evidence was captured

| Property | Result |
|---|---|
| Credentials | Only `DEV_REFRESH_PROD_DB_URL` and `DEV_REFRESH_DEV_DB_URL` from the protected, Git-ignored `.env.SyncDevDataFromProd`, read inside the process; never printed, logged or written. The tool refuses a target whose host/user lacks the expected project ref. |
| Read-only proof | Every session set `default_transaction_read_only=on`; the tool asserted `default_transaction_read_only='on'` and `transaction_read_only='on'` on each environment before any query (recorded in `<env>_manifest.json`). |
| Tools | Local `psql` and `pg_dump` 18.4 against PostgreSQL 17.6. **No Supabase CLI, no Docker, no WSL, no hosted resource, no temporary hosted role.** |
| Two independent captures per environment | (1) 24 SQL catalog snapshots (tables, columns, constraints, indexes, triggers, functions, policies, grants on relations/columns/functions/schemas, default ACLs, publications, extensions, roles, event triggers, views, types, buckets, history); (2) `pg_dump --schema-only` of `public`, `storage`, `auth`, `supabase_migrations`, `realtime` with owners and privileges kept. |
| Where artifacts live | `C:\Users\vikki\migration-evidence\stage-b-20261016\` (outside the repo, ACL restricted to your account): 51 files. Repo-side outputs hold only versions, names, verdicts and counts. |
| History unchanged by the capture | Prod 277 → 277 rows; Dev 58 → 58 rows (before/after counts in each manifest). |

## 2. Requirement 1: verified baselines [V]

| | Prod | Dev |
|---|---|---|
| public tables / functions / policies (public+storage) / indexes / triggers / constraints | 55 / 68 / 199 / 352 / 33 / 330 | 67 / 82 / 228 / 389 / 38 / 385 |
| storage policies / buckets | 31 / 8 | 6 / 9 |
| Realtime `supabase_realtime` members | 6 tables | `orders` only |
| History rows | 277 | 58 |
| Catalog fingerprint (sha256 of the 19 catalog hashes) | `c180056c…ae2f` | `3442d1bb…aff5` |
| Schema-dump sha256 | `d64fd3b4…552d` | `b3c75a40…7ec0`* |

\* full values are in `stage-b-manifest.json`.

**Agreement test (dump versus catalog), 12 object classes per environment: 0 differences on both** (`agreement-prod.md`, `agreement-dev.md`). Caveats: `pg_dump` emitted no `CREATE PUBLICATION` (publications are therefore evidenced by the catalog only); function bodies are compared by md5 of the stored body and **several bodies contain CRLF line endings**, a verified property of those functions, not a capture difference.

**The Dev baseline is moving.** Between my first Dev read earlier today and this capture, Dev's Storage configuration changed: storage policies 7 → 6, and `lot-pictures`, `public-assets`, `signatures` and `signed-waivers` became private. I did not do this; it matches the media-containment work of the other workstream. The Dev baseline here is valid as of 18:55 UTC and must be re-captured immediately before Stage D.

## 3. Requirement 2: migration-history records and fingerprints [V]

| | Prod | Dev |
|---|---|---|
| rows | 277 | 58 |
| history fingerprint (sha256 of `version\|name\|decoded-SQL-md5` lines) | `d4194b26…6b78` | `cde99f31…dea` |
| rows with a repo file | 277 | 57 (the 58th, `20260814002658`, is `20260814120000_create_contact_inquiries` recorded under a different version) |
| recorded SQL identical to the file | **276** | 55 |
| recorded SQL differs from the file in comments only | 1 (`20260316162524`) | 0 |
| recorded SQL differs in code | 0 | 2 (`20260814113146`, `20260814114825`: the files were edited after application by commit `84cdc3e`; Dev recorded the originals) |

The history store keeps backslash as `\\` and newline as `\n`. Decoding that exactly makes 276 of 277 Prod rows identical to their files; two earlier "differences" (`20251209115445`, `20260314215031`) were that escaping artefact only (the live `generate_invoice_number` body contains a single backslash, matching the file). Per-environment history exports are fingerprinted, not stored in the repo.

## 4. Requirement 3: all 277 Prod history entries [V]
File: `prod-history-277.csv`.

| Class | Count | Meaning |
|---|---|---|
| RECORDED_CONSISTENT | 233 | every catalog effect is present or superseded by a later applied version (31 of these are verified at name level only; see section 11) |
| RECORDED_NO_CATALOG_EFFECT | 43 | data or privilege statements only; not catalog-verifiable |
| **RECORDED_EFFECT_MISSING** | **1** | `20251207163822`: the role CHECK constraint is recorded as applied but absent (out-of-band removal) |

The 15 recovered files are within the 277 (hash-verified earlier; unchanged).

## 5. Requirement 4: 110 repo versions not recorded in Prod [V]
File: `prod-pending-110.csv`.

| Group (count) | Class | Count | Resolution |
|---|---|---|---|
| Baseline (40) | history-only, effects present | 28 | bookkeeping candidate after proof; never execute |
| | history-only, name-level only (definition unverified) | 3 | same, after the Stage D definition diff |
| | history-only, data/privilege only (not catalog-verifiable) | 9 | owner decision; includes `002` seed units, `005` pricing update, `015` demo admin; **never replay** |
| Aliases (2) `20260305203528`, `20260407203226` | history-only, effects present | 2 | bookkeeping candidates; recorded Prod twins hold *different SQL* |
| **Case 43** `20260407211122` | effect absent | 1 | **not** a bookkeeping candidate; see `case-43-impact-analysis.md` |
| Dev-line (44) | genuinely pending | 28 | release path only |
| | net-zero chains (create then removed by a later pending file) | 8 | run both or neither |
| | data/privilege only, pending | 7 | release path |
| | redefines an existing name; definition unverified | 1 | `20260722172048` (header says "Dev only - do not apply to production"; see U-5) |
| October (23) | genuinely pending | 20 | release path |
| | data/privilege only | 2 | release path |
| | already present (no new effect) | 1 | `20261010110000` (`customer_approved_at` exists from recovered `20251126190624`) |

## 6. Requirement 5: 330 repo versions not recorded in Dev [V]
File: `dev-pending-330.csv`.

| Group (count) | Class | Count |
|---|---|---|
| Prod-recorded versions not on Dev (263) | history-only, effects present | 183 |
| | history-only, name-level only | 26 |
| | history-only, data/privilege only | 41 |
| | **UNEXPECTED_MISSING_EFFECT** | **13** |
| Baseline (39 unrecorded) | present 26 / name-level 3 / not verifiable 9 / **missing 1** | 39 |
| Aliases and case 43 (3) | present 2 / absent 1 | 3 |
| Dev-line unrecorded (2) | history-only 1 present, 1 name-level | 2 |
| October (23) | pending 20 / data-privilege 2 / already present 1 | 23 |

`dev-history-58.csv` classifies Dev's own 57 file-matched rows: 46 consistent, 9 without catalog effect, **2 with a missing effect** (`20260718000744`: two public-read policies exist under different names than the file creates; `20260723174017`: `Public can view lot pictures` removed after application by the storage-containment work).

## 7. Requirement 6: history-only discrepancies versus genuinely missing schema effects

| Environment | History-only discrepancy (effects present / superseded, or not catalog-verifiable) | Genuinely missing schema effect |
|---|---|---|
| Prod | 42 baseline/alias versions (28 + 3 + 9 + 2) | 1 recorded (`20251207163822` role CHECK); case 43 (effect never applied); Dev-line and October files are pending by design |
| Dev | 292 versions (212 present + 30 name-level + 50 not verifiable) | **16 versions**: the 14 unrecorded below plus the 2 recorded above |

The 14 unrecorded Dev versions with missing effects (**cannot be reconciled by bookkeeping**): `20251008190000`, `20251129190013`, `20251129190039`, `20251202171808`, `20251230184228`, `20251231161729`, `20260324012349`, `20260324180043` (storage policies; Dev has 6 of Prod's 31); `20251207163822` (role CHECK); `20251229223230` (no `on_auth_user_created` trigger on `auth.users`); `20260323201502` (`pg_net` extension absent); `20260324051459`, `20260324154955` (Realtime publication members); `20260611184401` (`update_pricing_rules`).

## 8. Requirement 7: register of out-of-band schema differences
File: `drift-register.csv` (190 rows: Prod/Dev checks plus 142 Dev-versus-Prod object differences). Static, name-level; unnamed constraints are not compared (section 11).

**Prod: objects with no repo origin or contradicting history [V]**
| Id | Object | Evidence | Note |
|---|---|---|---|
| P-1 | `user_roles_role_check` absent | `20251207163822` recorded as creating it; no later migration drops it | known; also **no FK `user_roles → auth.users`** on Prod (inline unnamed constraint, found by direct catalog check) |
| P-2 | `task_status.admin_notes`, `task_status.crew_notes` (`text`, nullable) | named by no migration file | referenced only by generated types and one test; present on Dev too |
| P-3 | storage bucket `carousel-media` (public, 500 MB limit, image/video MIME list) | no file inserts it; code uses it | Dev has the bucket without the size/MIME limits |
| P-4 | `orders` Realtime membership at `20260615175816` | recorded SQL is a bare ADD of an already-published table | timing inference only |

**Dev [V]**: P-2 and P-3 as above; two policies whose names no file creates (`package_inflatable_components.Public can view inflatable components of active visible bundles`, `package_inflatable_eligibility.Public can view eligibility of active visible bundles`); the 39 missing-effect items across the 16 versions in section 7; Dev's `save_product_bundle_v2` body equals the file except for `--` comment lines (re-created by something that strips comments).
**Dev versus Prod** [V]: tables only on Dev 12, functions only on Dev 15, only on Prod 1 (`update_pricing_rules`), policies only on Dev 59, only on Prod 30 (**all 30 are storage policies**), columns only on Dev 15, triggers only on Dev 6, one trigger only on Prod (`auth.users`), `pg_net` only on Prod, Realtime membership differs (Prod 6 tables / Dev 1). All Dev-only objects are explained by Dev-line files **except five policies**: `objects.Authenticated can delete lot pictures`, the two renamed `package_inflatable_*` policies above, and two older `user_roles` policies (`Service role full access to user_roles` - the open policy that `20261008` drops - and `Users can read own role`) that Prod no longer has.

## 9. Requirement 8: exports contain no customer records or exposed credentials [V]
`stage_b_verify_manifest.py` scanned 51 protected files and 16 repo-side outputs:
- **Customer data:** 0 `COPY` statements; 0 `INSERT` statements outside function bodies (the 34/57 `INSERT INTO` lines in the dumps are all inside function/trigger code); catalog exports are structural only.
- **Credentials:** 0 hits for JWT-like tokens, Stripe `sk_/rk_/whsec_`, Resend, Twilio, Google API keys, bearer tokens, PEM blocks, bcrypt hashes, inline passwords. The only two pattern hits are the regex text `-----BEGIN` inside my own tool sources.
- **Emails:** 0 in the dumps and catalog JSON. (6 Prod migration-history statements contain email addresses in SQL text; the statements were **not exported**, only hashed.)
- Server-side scans of function bodies, defaults, policy text, trigger/view definitions and history statements found no credential-like strings.

## 10. Requirement 9: the classification report
Per-version files (all names and verdicts only): `version-matrix-all-387.csv` (every version, both environments), `prod-history-277.csv`, `prod-pending-110.csv`, `dev-pending-330.csv`, `dev-history-58.csv`, `drift-register.csv`, `stage-b-summary.json`, `stage-b-manifest.json` (hashes), `agreement-*.md`, `case-43-impact-analysis.md`. Each row carries version, file, group, recorded name, recorded-SQL relation, verdict, present/superseded/missing counts, missing objects, data and grant statement counts, class and **recommended resolution**.

## 11. Method limitations that bound the claims [L]
1. **Name-level checks** for policies, constraints, indexes and triggers: a same-name redefinition (drop + create) is flagged "definition unverified" (Prod: 31 recorded + 4 pending = 35 versions; Dev: 37 versions) and is **not** counted as proof. Function bodies are checked by body hash (comments tolerated, reported).
2. **Unnamed/auto-named constraints** and column types/defaults are not compared statically; Stage D's catalog diff is the definition-level check.
3. **Dynamic SQL**: 12 files use `EXECUTE format(...)`; their effects are not evaluated.
4. **Data-only and privilege-only versions (61)** cannot be verified from the catalog.
5. The parser is regex-based; every flagged item above was reviewed by hand, and the one place it produced false positives (`CREATE TABLE IF NOT EXISTS` on an existing table, same-name policies) was corrected before these numbers.

## 12. Requirement 10: unresolved discrepancies that bear on safe rehearsal or reconciliation

| Id | Discrepancy | Effect |
|---|---|---|
| U-1 | **Dev baseline is moving** (the other workstream changed Dev storage config today) | Re-capture immediately before Stage D; agree a freeze window |
| U-2 | Out-of-band objects P-2, P-3 (and the missing FK, P-1) have no repo definition | A clean rebuild will lack them; R-2a must classify each; `carousel-media` is used by code |
| U-3 | 14 Dev versions cannot be marked applied (effects absent) yet block a normal `db push` of newer versions on Dev | Owner decision needed before Stage E: (a) apply history rows with an explicit "waived/not applied" marker, (b) apply the missing effects (a hosted Dev change, not requested), or (c) avoid `db push` for Dev and apply by direct SQL with explicit version rows |
| U-4 | Hosted `customer-cancel-order` (Prod v61, Dev original) runs DB calls as the **caller's role** | With `20261012` applied first, anonymous cancellations would fail; deploy the repo version with/before it (Step 4); today 0 of 18 customer cancellations on Prod have an audit row |
| U-5 | `20260722172048` says "Dev only - do not apply to production" yet is in Prod's pending set and redefines `orders_surface_check` | Owner decision on the Prod release set |
| U-6 | 35 Prod and 37 Dev versions are only name-level verified | Definition-level proof deferred to Stage D |
| U-7 | 61 versions are data/privilege-only | Bookkeeping needs owner attestation, never replay |
| U-8 | Two Dev-applied files were edited after application (`84cdc3e`); one Prod file has comment-only edits | Recorded; no action, but the "do not edit applied files" rule was already crossed once |
| U-9 | Dev `20260814002658` ↔ file `20260814120000` version mapping | Your decision N4 from the previous round still applies |
| U-10 | Twelve files use dynamic SQL (including the October lockdown set) | Their effects must be proven by rehearsal, not statically |

None of U-1…U-10 prevents Stage C's tool work; **U-1, U-2 and U-6 must be settled before Stage D**, and U-3, U-5, U-7 before Stage E.

## 13. Findings carried forward (no change from earlier audit unless stated)
- `update_pricing_rules`: no consumer found (repo, Prod database, 24 h API logs, 44 hosted Prod functions as reported by the scan subagent, unverified). Not added to Dev.
- The expired Dev role `cli_login_postgres` (valid until 18:00:18 UTC, 0 sessions, owns nothing) is recorded; not modified.
- The master-account password finding remains with you.

## 14. Recommended Stage C changes (for your review; none started)

**Prerequisites:** your approval of this report; U-1 freeze agreed; a fresh capture if more than 24 h pass or the other workstream changes Dev again.

| Change | Exact scope | Verification | Stop condition |
|---|---|---|---|
| **C0 Reproduce the failures first** (local scratch only) | Using the existing guarded tool in a disposable `bpc_replay_*` database, reproduce failures #1–#4 and the 1016 error with per-statement error capture; add a seeded `auth.users` row for the 1016 guard | exact error text and line for each; confirms or refutes the "second error" inference | any hosted connection attempt |
| **C1 Replay shim** | `scripts/dev/migration-replay.cjs` + one new test file; declarative steps with evidence ids: **S1** after `20251207163822` drop `user_roles_role_check`; **S2** before `20260615175816` remove `orders` from `supabase_realtime` if present; **S3** after `task_status` creation add `admin_notes text`, `crew_notes text`; **S4** insert bucket `carousel-media` (public, 524288000, the Prod MIME list); **S5 optional** drop the `user_roles → auth.users` FK if R-2a requires it | allow-list test (no DML beyond the bucket insert); mutation test per step; recovered-migration test still 63/0; `git diff -- supabase/migrations` empty | any recovered file hash changes |
| **C2 Pending `20261016120000`** | reorder only: drop role CHECKs → normalise/guard → add lowercase CHECK → FK block; keep the empty-`auth.users` guard | six scratch scenarios (legacy uppercase CHECK + rows; Prod-like with 2 orphans; role outside vocabulary raises; empty `auth.users` raises; re-run idempotent; FK present and orphans removed) and a comment-stripped diff showing only the block move; confirms role assignment, signup behaviour, constraints and data preserved | any scenario changes data it should not |
| **C3 Case 43** | after your review of `case-43-impact-analysis.md`: E1 withdraw (manifest + test) | the five E1 tests | none before approval |
| **C4 Three headers** | comment-only edits in `20261010110000`, `20261013120000`, `20261016120000`, **separate from C2** | comment-stripped SQL md5 identical before/after | any SQL byte changes |

## 15. Hosted state
Production and Development are **unmodified by Stage B**: history 277 / 58 before and after; no write, no CLI, no temporary role, no deployment. Dev's Storage configuration changed during the day through the other workstream (section 2). Development's containment and the 14 stubs are untouched; the expired `cli_login_postgres` role remains as recorded.
