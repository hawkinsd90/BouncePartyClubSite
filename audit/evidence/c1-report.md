# Stage C1 report: replay-only adjustments S1 and S2

Baseline: branch `Dev`, HEAD `831ea9496438fd3188c954106e88f6e9d500329b`. Local scratch PostgreSQL 18 only (127.0.0.1:54329, stopped afterwards). Raw outputs: `C:\Users\vikki\migration-evidence\c1-scratch\*.txt`.

## 1. The extra log errors (gen_salt, gen_random_bytes, invoice_links)
- **Source:** the first run of my own C0 experiment driver (`c0_replay_experiments.py matrix`), `server.log` timestamps 15:36 to 15:39. Never the replay tool's own runs (`diagnostic-full.txt` has none; the tool's strict runs show none).
- **Cause:** my driver cloned scratch databases with `CREATE DATABASE ... TEMPLATE`, which does **not** copy `ALTER DATABASE ... SET search_path = public, extensions`. pgcrypto lives in schema `extensions`, so `gen_salt()` (20251003170350:79) and `gen_random_bytes()` (20251203125006:40) were not found, and `invoice_links` (created in the same file) then failed in later files as cascades. Category: **incomplete setup in my driver (clone lost search_path) + cascading failures.** Not missing pgcrypto, not a stub bootstrap fault, not a historical defect.
- **Proved:** cloning `bpc_replay_c0_empty` without the setting reproduces exactly those errors (`search_path` = `"$user", public`); the source database carries the setting.
- **Fixed in the driver** (`clone()` now sets the search_path) before the numbers in the C0 report were produced (matrix re-run 15:41 to 15:43, no such errors). The C0 "detail" step was re-run after the fix: identical results. **C0 conclusions stand**: S1+S2 leave only the `pg_net` limit.
- Note: `c0_matrix.json` was overwritten by the corrected run; the first-run errors survive only in `server.log`.
- **Tool behaviour:** in diagnostic mode any file with an `ERROR:` line, or any non-zero psql status, is listed as failing, and the verdict says later errors can be cascades of an earlier failure. No partially applied or cascading failure can print a pass.

## 2. Implementation (`scripts/dev/migration-replay.cjs`)
- New explicit flag `--adjust s1,s2`. Default: none, in both modes. `s3`/`s4`/`s5`/anything else is refused before any connection.
- **S1:** after `20251207163822`, if a CHECK named `user_roles_role_check` whose definition contains `MASTER` exists, run `ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_role_check`. Constraint only; no row is read or changed. Logs `present before/after`, or `no-op` if absent.
- **S2:** before `20260615175816`, if `orders` is a member of `supabase_realtime`, run `ALTER PUBLICATION supabase_realtime DROP TABLE public.orders`; the unmodified migration then re-adds it. After the file the tool verifies `orders` is listed exactly once, otherwise the run fails.
- An adjustment that cannot be applied or verified counts as a replay failure.
- Output now always prints: mode, `ADJUSTMENTS: none` or the list with what each did, the verdict, `WHAT THIS PROVES`, and the final `user_roles` CHECK constraints and `supabase_realtime` membership.
- Adjusted verdicts use different wording (`ADJUSTED REPLAY COMPLETED` / `ADJUSTED DIAGNOSTIC`) so they cannot be read as `STRICT REPLAY COMPLETED`, and always say they are not evidence that the unmodified chain passes.

## 3. Results (all full 387-file replays unless noted)
| Run | Outcome |
|---|---|
| diagnostic, no adjustment | 5 files fail: pg_net, F1, F2, F3, F4 (2 errors). Final CHECK: **none** (F4 left the schema partly applied), orders listed once |
| strict, no adjustment, `--stub-skips` | FAILED at `20260324175546` (234 files). Final CHECK still the legacy uppercase one |
| strict, no adjustment, no skips | FAILED at `20260323201502` (pg_net) |
| diagnostic `--adjust s1` | remaining: pg_net, F3 |
| diagnostic `--adjust s2` | remaining: pg_net, F1, F2, F4 |
| diagnostic `--adjust s1,s2` | remaining: **pg_net only** |
| strict `--adjust s1,s2 --stub-skips` | **ADJUSTED REPLAY COMPLETED with 1 stub-limited file SKIPPED** (386 files) |
| strict `--adjust s1,s2`, no skips | ADJUSTED REPLAY FAILED at `20260323201502` (pg_net) |
| `--adjust s1,s2 --upto 20251201000000` | neither adjustment logged (points not reached); legacy `ADMIN/CREW` CHECK intact |
| `--adjust s1,s2 --upto 20260601000000` | S1 applied only, S2 not reached |

**Final states (adjusted strict, skips):** `user_roles_role_check CHECK (role = ANY (ARRAY['master','admin','crew','customer']))` (created by 20261016120000 line 77-78); `supabase_realtime` has 6 members with `orders` listed exactly once. Unadjusted strict run ends with the legacy `MASTER/ADMIN/CREW/CUSTOMER` CHECK.

**What this proves / qualification:** the adjusted strict replay shows the chain replays given S1+S2, with `20260323201502` skipped because the local PostgreSQL has no `pg_net`. The skipped file is not verified. It is **not** evidence that the unmodified chain passes, and it is a stub environment, not Supabase.

## 4. Tests
- `node node_modules/jiti/bin/jiti.js src/lib/tests/security/migrationReplaySafety.test.ts`: **144 passed, 0 failed** (adds validation of `--adjust`, S1/S2 definitions and points, S3/S4/S5 refusal, no success wording on connection failure, tool never touches the FK or the S3/S4 objects, final-state output). All pre-existing safety checks pass unchanged.
- `git diff HEAD -- supabase/migrations`: 0 lines. No historical migration changed, so no recorded hash changed.

## 5. Files changed
- `scripts/dev/migration-replay.cjs` (modified): `--adjust`, S1/S2, labelled verdicts, final state, stricter failure detection.
- `src/lib/tests/security/migrationReplaySafety.test.ts` (modified): tests above.
- `audit/evidence/c1-report.md` (created): this report.
- `audit/evidence/c0-report.md` (created in C0, unchanged in C1) and `audit/evidence/tools/c0_replay_experiments.py` (C0 driver; only change in this stage: `clone()` now sets `search_path`).
- Outside the repo: `C:\Users\vikki\migration-evidence\c1-scratch\` (run outputs).

## 6. Not done (not authorized)
C2, C3 (case 43), C4 (headers), S3, S4, S5.

Hosted Production and Development untouched; no Supabase CLI, Docker or WSL; nothing staged or committed.
