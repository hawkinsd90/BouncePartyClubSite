# Stage C3 report: Case 43 (`20260407211122`) withdrawn before application

HEAD `831ea9496438fd3188c954106e88f6e9d500329b`, branch `Dev`. Local scratch PostgreSQL only; raw replay reports in `C:\Users\vikki\migration-evidence\c3-scratch\`.

## Decision: withdraw (E1). File removed from the working tree; nothing committed.
| Check | Result |
|---|---|
| Identity | `supabase/migrations/20260407211122_add_anon_insert_policy_order_changelog_cancellation.sql`, SHA-256 `9e09c0a2...0a85`, git blob `e2e898e3...`, added by commit `f5204b7`. Preserved byte-identical in `audit/evidence/withdrawn-migrations/`. |
| Recorded in hosted history? | No. Re-read from the Stage B captures: Prod 277 rows, Dev 58 rows; no row with this version and no name containing `anon_insert_policy`. |
| Unresolvable history discrepancy? | No. No hosted row refers to the version and no local file after removal, so `db push` has nothing pending for it. Nothing was repaired. |
| Objects created | Exactly one: policy `Anon customers can insert cancellation changelog entries` on `order_changelog` (INSERT, anon, `change_type = 'cancellation' AND user_id IS NULL`). Modifies nothing else. Absent on Prod and Dev. |
| Later dependency | None. The policy name appears only in the file itself and in audit documents. No later migration references it. `20261012` drops every policy on `order_changelog` and creates only `Admin and master read order changelog` and `Admin and master append order changelog`. October migrations 1019-1022 only INSERT into the table (from functions), which does not depend on an anon policy. |
| Final schema needs it? | No: the final schema has no anon policy on `order_changelog` (verified by replay). |
| `customer-cancel-order` (read only, not modified or deployed) | Repo version builds a service-role client without the caller's Authorization header and writes the cancellation row through it (RLS bypassed), so it needs no anon policy. Hosted Prod v61 uses the caller's token and still loses the audit row today (0 of 18); that gap is unchanged and is fixed by deploying the repo function, not by this policy. |

## Replay effect (all with 386 files, local stub)
- Before withdrawal, a replay stopped before `20261012` contained the anon policy; `20261012` removes it. After withdrawal that run has 0 policies from this migration (one pre-existing anon policy, `Anonymous users can log customer actions`, remains until `20261012`, as on Production).
- Final `order_changelog` policies after withdrawal (adjusted strict): the two staff-only policies; **0 anon policies**.

| Run | Outcome |
|---|---|
| diagnostic, unadjusted | 4 failing files: `pg_net` file, `20260324175546`, `20260324190039`, `20260615175816` (same as C2) |
| strict, unadjusted, `--stub-skips` | FAILED at `20260324175546` (234 files, as C2) |
| diagnostic `--adjust s1,s2` | `pg_net` only |
| strict `--adjust s1,s2 --stub-skips` | ADJUSTED REPLAY COMPLETED, 385 files replayed, `20260323201502` skipped (was 386 replayed before; one file fewer) |
| strict `--adjust s1,s2`, no skips | FAILED at `20260323201502` (`pg_net`, local limitation) |

No missing-object or dependency error appeared. The `pg_net` limitation is reported as before. Replay-tool tests: 144 passed, 0 failed.

## Counts
Repository migration files 387 -> 386 (`ls supabase/migrations/*.sql`). Prod-pending 110 -> 109 and Dev-pending 330 -> 329 relative to the Stage B CSVs, which are left as a point-in-time snapshot. Replayed files in the adjusted strict run 386 -> 385 (plus 1 skipped).

## Risks for Stage D
- The replacement `customer-cancel-order` must be deployed with or before `20261012`; without it, anonymous customer cancellations fail at the `orders` UPDATE.
- The Production audit gap persists until then.
- The withdrawal shows as a deletion in the release PR to `main`, where the file already exists. Reversible with `git checkout -- <file>`.

## Files
- `audit/evidence/c3-report.md` created; `audit/evidence/case-43-impact-analysis.md` appended (section 8); `audit/evidence/withdrawn-migrations/20260407211122_...sql` created (preserved copy).
- `audit/step2-migration-audit.md` modified: status line in section V, new section Z.
- `supabase/migrations/20260407211122_...sql` deleted (working tree only).
- No other migration touched in C3 (`20261016120000` modification is from C2).
