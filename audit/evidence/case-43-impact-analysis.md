# Case 43: `20260407211122_add_anon_insert_policy_order_changelog_cancellation.sql`: impact analysis

Evidence date: 2026-10-16 (captures at 18:54–18:55 UTC). **Nothing was removed, moved or edited.** Withdrawal waits for your review.

## 1. What the file does
Creates one policy: `Anon customers can insert cancellation changelog entries` on `order_changelog`, `FOR INSERT TO anon WITH CHECK (change_type = 'cancellation' AND user_id IS NULL)`. It was added on 2026-04-07 (commit `f5204b7`, "Updated orderApprovalService.ts") alongside browser-code changes, because customer-initiated cancellations ran as an anonymous caller and their audit row was being silently dropped.

## 2. Has either hosted environment recorded its version? [V]
| | Prod | Dev |
|---|---|---|
| history row with version `20260407211122` | **no** (277 rows) | **no** (58 rows) |
| history row with a name containing `anon_insert_policy_order_changelog` | no | no |
| the policy exists | **no** | **no** |
| `order_changelog` INSERT policies today | `Anonymous users can log customer actions` (anon; only `customer_approval` and `status_change`), `Authenticated users can create changelog entries` | identical |

So the version was **never applied and never recorded** anywhere. Withdrawing the file creates no false record and disturbs no deployed environment.

## 3. Does the intended final schema need it? [V]
- `20261012120000_core_database_access_lockdown.sql` drops **every** policy on `order_changelog` and creates only `Admin and master read order changelog` and `Admin and master append order changelog`. The final schema has **no anonymous INSERT policy at all**, so this file's policy would be created and then dropped in the same release.
- The release version of `customer-cancel-order` (repo) writes the cancellation audit row through a **service-role client created without the caller's Authorization header** ("authorization is decided explicitly"), which bypasses RLS. It needs no anonymous policy.
- No browser code inserts a `cancellation` row as an anonymous user: the only `order_changelog` insert in `src` is the staff `StatusChangeDialog` (authenticated).

## 4. The audit gap that motivated the file still exists on Prod today [V, aggregate counts only]
The hosted `customer-cancel-order` (Prod v61 read through the Supabase API; Dev's original v4 from the local backup) builds its client with the service key **and** then overrides `Authorization` with the caller's token, so for an anonymous customer the insert runs as `anon` under RLS and fails against Prod's current policy (the code does not check the result).

| Prod `orders` / `order_changelog` | count |
|---|---|
| cancelled orders | 31 |
| cancelled with `cancelled_by` NULL (customer-initiated path) | 18 |
| cancelled with a staff user in `cancelled_by` | 13 |
| `change_type = 'cancellation'` rows | 11 |
| customer-initiated cancellations that have a cancellation row | **0 of 18** |
| staff-initiated cancellations that have a cancellation row | 11 of 13 |

The gap is closed **by deploying the repo function**, not by this policy: even if this policy were applied, `20261012` would remove it in the same release.

## 5. Consequence of the hosted function pattern for sequencing (belongs to Step 4)
The hosted function runs database calls **as the caller's role**. If `20261012` (which removes the anonymous `orders` policies) were applied before the repo `customer-cancel-order` is deployed, anonymous customer cancellations would fail at the `orders` UPDATE. The release plan must deploy `customer-cancel-order` with or before `20261012`. Added to the Step 4 list.

## 6. Withdrawal mechanics and what could still go wrong
| Question | Answer |
|---|---|
| Truthful history? | Yes. No row is created or edited. The manifest says "withdrawn before application". |
| Does `supabase db push` behave? | No local file and no remote row means it is not pending. (Documented CLI behaviour; not executed here.) |
| Does anything reference the file? | Only `audit/step2-migration-audit.md` and the file itself (grep of the repo). No test, script or doc. |
| Replay tooling | It would no longer replay it; Prod and Dev lack it, so the rebuilt baseline matches them better. |
| It is in `main` | The withdrawal shows as a move/deletion in the release PR. |
| Reversible | `git mv` back. |

## 7. Recommendation (unchanged, now evidenced)
**E1 withdraw before application** is safe: never recorded anywhere, effect absent everywhere, final schema does not need it, and its writer is replaced by a service-role function. Safe alternative **E2** (apply in order, then dropped by `20261012`) is also truthful but creates and removes a policy for no net effect. **Marking it applied is rejected.** Awaiting your review before any removal.

## 8. Outcome (Stage C3)
Withdrawn from the working tree (uncommitted). Original preserved in `withdrawn-migrations/` (SHA-256 `9e09c0a24aec4b6fa4e6403b64f8c89b4f2488af977c6055d3916ef16b7c0a85`). See `c3-report.md`.
