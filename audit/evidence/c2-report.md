# Stage C2 report: `20261016120000_repair_role_assignment_and_signup_provisioning.sql`

Baseline HEAD `831ea9496438fd3188c954106e88f6e9d500329b`, branch `Dev`. Local scratch PostgreSQL 18 only (stopped afterwards). Raw results: `C:\Users\vikki\migration-evidence\c2-scratch\` (replay reports, `c2_results_*.json`, copy of the original file). Test driver: `audit/evidence/tools/c2_scenarios.py`.

## 1. Root cause and change
Section 1 normalised role values (`UPDATE ... SET role = lower(btrim(role))`) **before** the block that drops the old role CHECK. When the legacy uppercase-only `user_roles_role_check` (from `20251207163822`) is still present, the UPDATE writes lowercase values the CHECK rejects (23514, line 54), and, in a non-transactional replay, the later `ADD CONSTRAINT` then fails on the leftover uppercase rows (line 78). The `auth.users` guard was not involved.

Change (18 insertions, 16 deletions; the CHECK-dropping DO block moved, and 3 comment lines edited):
- **Before:** DELETE duplicates / UPDATE lowercase / vocabulary guard, then drop CHECK, then ADD CHECK, then FK.
- **After:** drop every role CHECK (same block, same predicate), then DELETE duplicates / UPDATE lowercase / vocabulary guard (unchanged), then ADD CHECK (unchanged), then FK (unchanged).
- Line-set comparison with HEAD: no SQL line added or removed. Only the block position and the comments changed. The rest (duplicate retention, vocabulary guard, empty-`auth.users` guard, orphan delete, FK, both functions, grants, trigger) is byte-identical.
- The whole file still runs in one transaction in strict mode, so a guard failure rolls back the CHECK drop (verified, T5/T6).

## 2. Scenarios (one-transaction apply, synthetic data, 28/28 checks pass)
| # | Scenario | Result |
|---|---|---|
| T1 | legacy uppercase CHECK + uppercase rows | succeeds; roles lowercase; lowercase CHECK only; FK valid (cascade); trigger present |
| T2 | CHECK absent + lowercase rows (hosted shape) | succeeds, same end state |
| T3 | CHECK absent + uppercase / padded data (`ADMIN`, `Crew`, ` CUSTOMER `) | succeeds; all lowercase |
| T4 | duplicates `ADMIN` / `admin` / ` Admin ` for one user | one row kept: `admin`, the earliest created_at |
| T5 | unsupported role `owner` | fails `user_roles contains a role outside master / admin / crew / customer...`; state identical before/after (CHECK drop rolled back) |
| T6 | empty `auth.users` | fails `auth.users is empty; refusing...`; state unchanged |
| T7 | orphaned roles, no FK | 2 orphans deleted, synthetic valid user kept, FK created and validated |
| T8a/b | applied again to an already-correct schema (after T2 and T1 shapes) | succeeds; snapshot (rows, constraints, function bodies, triggers) identical |
| T9 | trigger | exactly one trigger, `on_auth_user_created`, AFTER INSERT ROW on `auth.users` -> `auto_assign_customer_role()`; a synthetic signup gives one customer role, 1 customer, 1 profile, 1 contact, no logged errors |
| T10 | authorization | admin assigning `MASTER`, ` Master `, `ADMIN`: refused; admin changing an admin: refused; crew / customer / no caller: refused; roles `customer`/`owner`: refused; unknown email: false; admin `CREW` succeeds; master `MASTER` succeeds and is stored as `master`, replacing the old role; direct insert of `MASTER` rejected by the CHECK; EXECUTE: anon no; authenticated/service_role yes on `assign_role_by_email`; signup function service_role only |

Control: the unmodified HEAD file, same driver: fails T1 (`23514`) and T8b, and T5 for the wrong reason (CHECK violation instead of the vocabulary guard); hosted-shape scenarios behave identically.

## 3. Full replays (387 files, local stub)
| Run | Outcome |
|---|---|
| diagnostic, unadjusted | 4 files fail: `pg_net`, `20260324175546`, `20260324190039`, `20260615175816`. **`20261016120000` no longer fails**, even unadjusted (it now removes the CHECK itself). |
| strict, unadjusted, `--stub-skips` | FAILED at `20260324175546` (234 files), as before |
| diagnostic `--adjust s1,s2` | `pg_net` only |
| strict `--adjust s1,s2 --stub-skips` | **ADJUSTED REPLAY COMPLETED** with `20260323201502` skipped (386 files); final CHECK `master/admin/crew/customer`, `orders` once in `supabase_realtime` |
| strict `--adjust s1,s2`, no skips | FAILED at `20260323201502` (`pg_net`, stub limitation) |

Qualification: stub PostgreSQL, not Supabase; the skipped `pg_net` file is unverified; an adjusted pass does not show that the unmodified chain passes. All failures listed are the known historical ones (F1, F2, F3) or the stub limit; none are defects in the corrected migration. Replay-tool tests: 144 passed, 0 failed.

## 4. Unchanged
`git diff --name-only HEAD -- supabase/` lists only `20261016120000...`; no applied, recovered or other October migration changed. No edge function, frontend, hosted object or history touched.

## 5. Remaining before C3 / C4 / Stage D
- C3 (case 43 withdrawal) and C4 (three header corrections): awaiting approval.
- Stage D must still use a Production-equivalent schema, not only the replay stub.
- Replacement `customer-cancel-order` deployment must precede or accompany `20261012` (Step 4).
- U-3, U-5, U-9 owner decisions and master-password rotation remain open.
