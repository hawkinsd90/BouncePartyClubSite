# Stage C0 report: reproduction of the known replay failures

Baseline: branch `Dev`, HEAD `831ea9496438fd3188c954106e88f6e9d500329b`. Environment: a throwaway local PostgreSQL 18 cluster (initdb'd under `C:\Users\vikki\migration-evidence\c0-scratch\pgdata`, loopback port 54329, now stopped), built through the guarded tool `scripts/dev/migration-replay.cjs` (stub of Supabase roles/auth/storage/realtime; plain PostgreSQL, not Supabase). Synthetic data only. Raw logs: `c0-scratch\diagnostic-full.txt`, `c0_detail.json`, `c0_matrix.json`, `c0_scenarios.json` (protected folder, outside the repo). Experiment driver: `audit/evidence/tools/c0_replay_experiments.py`.

## 1. Reproduced failures (exact statement, error, location)
All five reproduce in a clean full replay of all 387 files (diagnostic mode: 5 files raise errors) and each also fails in isolation, in strict style (one transaction, stop at first error), from the state built up to the preceding version.

| # | File : line | Statement | PostgreSQL error |
|---|---|---|---|
| F1 | `20260324175546_fix_get_user_role_case_sensitivity_v2.sql`:33 | `UPDATE user_roles SET role = LOWER(role) WHERE role != LOWER(role);` | `ERROR: 23514: new row for relation "user_roles" violates check constraint "user_roles_role_check"` (DETAIL: failing row has role `master`) |
| F2 | `20260324190039_normalize_remaining_uppercase_roles.sql`:13-15 | `UPDATE user_roles SET role = LOWER(role) WHERE role != LOWER(role);` | same 23514 error |
| F3 | `20260615175816_add_orders_to_realtime_publication.sql`:1 | `ALTER PUBLICATION supabase_realtime ADD TABLE orders;` | `ERROR: 42710: relation "orders" is already member of publication "supabase_realtime"` |
| F4a | `20261016120000_repair_role_assignment_and_signup_provisioning.sql`:54 (reported at 59, end of the DO block) | `UPDATE public.user_roles SET role = lower(btrim(role)) WHERE role <> lower(btrim(role))` (inside DO block, plpgsql line 11) | `ERROR: 23514: new row for relation "user_roles" violates check constraint "user_roles_role_check"` |
| F4b | same file :78 | `ALTER TABLE ... ADD CONSTRAINT user_roles_role_check CHECK (role IN ('master','admin','crew','customer'))` | `ERROR: 23514: check constraint "user_roles_role_check" of relation "user_roles" is violated by some row` |
| F5 (known stub limit) | `20260323201502_add_google_calendar_auto_sync_trigger.sql`:27 | `CREATE EXTENSION IF NOT EXISTS pg_net;` | `ERROR: 0A000: extension "pg_net" is not available` |

## 2. Reproduced / not reproduced
- Reproduced: F1, F2, F3, F4a, F4b, F5.
- **Not reproduced: the suspected second failure involving `auth.users`.** The second error in `20261016120000` is F4b, a direct consequence of F4a: the failed normalisation leaves uppercase rows, so the new CHECK cannot be added. The `auth.users is empty; refusing...` guard did not fire in the clean replay because the clean replay's `auth.users` holds one row (created by an earlier migration). The guard does fire when `auth.users` is empty (scenario C below), so it is a real but different failure mode. It is not an ordering defect.
- F5 only reflects the stub (no `pg_net`); it is not a migration defect.

## 3. Root causes and where they apply
| # | Root cause | Clean rebuild | Production-equivalent rehearsal |
|---|---|---|---|
| F1, F2 | `20251207163822` adds a CHECK allowing only uppercase roles. Production and Dev later lost that CHECK out of band (drift D2). In a clean replay it persists, so any lowercasing UPDATE writes a value the CHECK rejects. (The `DISABLE TRIGGER ALL` in F1 does not disable CHECK.) | **Fails** | Does not occur (no CHECK on Prod) |
| F3 | `20260324051459` already adds `orders` to the publication behind an `IF NOT EXISTS` guard. `20260615175816` adds it unguarded. | **Fails** | Fails when the schema is rebuilt from history. On the live Prod schema `orders` is already published, so it would also fail there if executed; Prod records this version as applied, so it is not pending |
| F4a/F4b | In `20261016120000` the lowercase-normalisation (line 54) precedes the CHECK replacement (lines 61-78), and the legacy uppercase CHECK is still active. | **Fails** (cascade F4a then F4b) | Succeeds when the CHECK is absent (scenarios B, E) |
| F5 | stub lacks `pg_net` | stub only | stub only |

## 4. Minimal correction per failure
- F1/F2: a replay-time adjustment that drops the uppercase-only `user_roles_role_check` after `20251207163822` (S1). Do not edit the applied files.
- F3: replay-time adjustment removing `orders` from the publication immediately before `20260615175816` (S2), or make the tool tolerate "already member".
- F4: an actual defect in a **pending** (unapplied) file, so it can legitimately be corrected: move the CHECK-dropping block before the normalising UPDATE (C2). With S1 in place the file replays (X1), but on a legacy uppercase-CHECK state it still fails on its own, so C2 is needed for a correct file.
- F5: none required; keep `--stub-skips`.

## 5. Strict-replay fixes versus Production-drift compatibility
- **Strict clean replay (purpose A):** a correct clean replay should *not* need S1 for the 20251207 to 20260324 files if the repository history is truthful. The CHECK is in the history and the files that lowercase roles genuinely conflict with it. This is a **defect in the historical chain** that cannot be fixed by editing applied files, so the clean replay can only pass with an explicit, labelled tool adjustment. S1 and S2 are legitimate corrections of actual replay failures but they change what the replay proves. They must be reported as adjustments (and never as a clean pass).
- **Production-equivalent rehearsal (purpose B):** S1 reproduces known Production drift (the CHECK is absent on Prod and Dev). S2 reflects Prod where `orders` is already published.
- Both strict and adjusted outcomes must be reported separately; S1/S2 should not run in strict mode by default.

## 6. Experiment matrix (full 387-file replay, diagnostic mode, adjustments injected into scratch DBs only)
| Run | Remaining errors |
|---|---|
| X0 none | F5, F1, F2, F3, F4a/b |
| X1 S1 only | F5, F3 |
| X2 S2 only | F5, F1, F2, F4 |
| X3 S1+S2 | F5 only (stub limit) |
| Tool strict, with `--stub-skips` | stops at `20260324175546` (234 files replayed) |
| Tool strict, no skips | stops at `20260323201502` (216 files) |

So S1+S2 are sufficient: no other replay failure hides behind these. S3, S4, S5 are **not** needed to avoid a replay failure.

## 7. Pending `20261016120000` scenarios (synthetic data, rolled back)
| Scenario | Result |
|---|---|
| A clean-replay state (uppercase CHECK active) | fails F4a |
| B Prod-like (no CHECK, no FK, lowercase rows, 2 orphan roles) | succeeds; orphans removed, new CHECK `master/admin/crew/customer`, FK to `auth.users` created, `on_auth_user_created` trigger present |
| C Prod-like but `auth.users` empty | fails by design: `auth.users is empty; refusing to treat every user_roles row as an orphan` |
| D role outside vocabulary (`owner`) | fails by design: `user_roles contains a role outside master / admin / crew / customer; review those rows before applying this migration` |
| E CHECK dropped, uppercase data | succeeds |

## 8. S1-S5 assessment
| Step | Verdict |
|---|---|
| S1 drop uppercase CHECK | **Corrects an actual replay failure** (F1, F2, F4) and **reproduces known Prod drift**. Low concealment risk if reported as an adjustment. |
| S2 duplicate publication membership | **Corrects an actual replay failure** (F3). It reflects the repo defect (duplicate add) rather than Prod drift. |
| S3 add `task_status.admin_notes`/`crew_notes` | Not a replay failure (no migration references the columns; they appear only in `src/lib/database.types.ts`). It reproduces Prod drift (columns exist there without a migration). **Risk of hiding a missing migration**: should be handled as a recorded missing migration, not a silent shim. |
| S4 reconstruct `carousel-media` bucket | Not a replay failure: no migration inserts the bucket, `20260325231044` only UPDATEs it (a silent no-op on a clean replay, rows affected 0), and policies on it are created regardless. Reproduces drift D1 (origin unknown). **Concealment risk** (a missing-bucket migration). Use only in the Production-equivalent rehearsal, labelled. |
| S5 remove user-role FK | **Not needed.** The FK is created by `20261016120000` and succeeds in B/E. Removing it would hide the real orphan check. Drop S5. |

## 9. Do the findings change C1 / C2?
- C1: reduce to **S1 and S2**, as separately reported adjustments. S3 and S4 belong only in the Production-equivalent profile (purpose B), and S5 is dropped. The tool must keep strict mode adjustment-free and print a banner when any adjustment is active.
- C2: confirmed as a real defect in a pending file; the correction is to reorder (drop the old CHECK, normalise, validate vocabulary, add the new CHECK). The "second failure" is the F4b cascade, not a separate `auth.users` defect. Guards in scenarios C and D are intentional and should be kept.
- Still unauthorized and untouched: C3 (case 43), C4 (headers).

## 10. Commands run (all local, scratch only)
- `initdb -D ...c0-scratch\pgdata -U postgres -A trust -E UTF8 --locale=C`, `pg_ctl start/stop` (port 54329, loopback)
- `node scripts/dev/migration-replay.cjs --db bpc_replay_c0_diag --mode diagnostic --report ...diagnostic-full.txt` (5 files with errors)
- `... --mode strict --stub-skips` and `--mode strict` (stop at `20260324175546` and `20260323201502`)
- `python -I audit/evidence/tools/c0_replay_experiments.py detail | matrix | scenarios`

Recorded issue (not fixed here): Production customer-cancellation audit gap (0 of 18 customer-initiated cancellations have a changelog row) depends on deploying the replacement `customer-cancel-order` function; not touched.

## Hosted systems
No connection to Production (`qaagfafagdpgzcijnfbw`) or Development (`srxunxiytojjsuhcmzjg`), no Supabase CLI, no Docker or WSL, in C0.
