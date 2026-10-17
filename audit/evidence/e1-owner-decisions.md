# E1 owner decisions required before a reconciliation manifest can be finalized

Nothing below was decided by me. Each item states the facts, the viable choices and my recommendation; the decision is yours. Items marked **blocks the manifest** stop an approval-ready manifest until answered.

## U-5 (blocks the manifest): `20260722172048_allow_null_surface_for_ee_only_orders.sql`

**What it does.** Its header says "Stage E4: allow `orders.surface` to be NULL for Event Essentials-only orders ... Dev only - do not apply to production." Its SQL: `ALTER TABLE orders ALTER COLUMN surface DROP NOT NULL;`, then drop and re-create `orders_surface_check` as `CHECK (surface IS NULL OR surface IN ('grass','cement'))`. The earlier behaviour stored a placeholder `'cement'` for orders without inflatables.

**Where it stands.**
| Question | Finding (evidence) |
|---|---|
| Recorded in Development? | Yes: Dev history row, recorded SQL identical to the file (`dev-history-58.csv`). Development already has nullable `surface` and the new CHECK (Stage B catalog). |
| Production lacks its effects? | Yes: Production `orders.surface` is NOT NULL with the old CHECK (Stage B catalog). Stage B class: `PENDING_REDEFINITION_DEFINITION_UNVERIFIED`. |
| Do the intended release or application code rely on it? | **Yes.** `supabase/functions/_shared/booking/bookingBuild.ts` line 271 builds the order with `surface: hasInflatables ? ('grass' or 'cement') : null`, i.e. NULL for Event-Essentials-only bookings (that file was last changed in commit `45377db`, 2026-10-07 "secure public booking creation"); `create_booking_request` (`20261010120000`, `20261011120000`) inserts `v_order->>'surface'`; `src/lib/database.types.ts` types `surface` as nullable. No later migration depends on it. |
| What happens if it is excluded from the Production upgrade? | Local scratch experiment (synthetic, E1): the other 66 migrations apply cleanly (66 of 66). The final schema differs from the 67-migration result **only** by `orders.surface` staying NOT NULL and the old CHECK (one column difference, one constraint difference). An insert of an Event-Essentials-only order with NULL surface is then **rejected** (`null value in column "surface" violates not-null constraint`) and accepted when the migration is included. Runtime impact through the Edge Function was not run (needs hosted/Edge testing) but follows from the code path above. |
| Does exclusion change convergence or the pending strategy? | The version stays technically pending in Production and, if excluded, Production would permanently differ from Development and from the repository's intended schema until some other change adds the same effect. The pending-set calculation (exact versions) is unchanged: the version remains in the 109. |
| Is it safe to apply? | It executed without error in D3, D4 (67-of-67 upgrades) and E1; it takes a brief ACCESS EXCLUSIVE lock on `orders`; the new CHECK is re-validated against all existing rows (all non-null values must be grass or cement; Production's NOT NULL + old CHECK already guarantee that). |

**Options.**
1. **Include it as is (recommended).** Treat the header as a historical note; Production needs the effect for Event-Essentials-only bookings. Risk: it was labelled Dev-only by its author, so confirm that the author's concern was rollout order, not a Production-specific problem. Needs: your confirmation, and an updated header comment (documentation-only change, separately authorized).
2. **Exclude it and change the booking code** to keep sending a placeholder surface for Event-Essentials-only orders. Risk: re-introduces the misleading `'cement'` placeholder the migration was written to remove; needs an application and Edge Function change, which is outside Step 2.
3. **Replace it with a new, Production-reviewed migration** that makes the same change under a new version (and bookkeep the old Dev-only version separately). Risk: adds a new migration and a new version identity for an identical effect; complicates Development reconciliation.
4. **Defer** until booking Event-Essentials-only orders is confirmed unused in Production. Risk: October booking code would still be deployed; the failure appears only when such a booking is attempted.

I will not include, exclude, rename, withdraw, edit or mark it applied without your decision.

## Other decisions (carried from the audit and new in E1)

| # | Decision | Needed for | Facts | Recommendation |
|---|---|---|---|---|
| N4 / U-identity | Development's `20260814002658` (recorded) vs repository `20260814120000`: leave both unreconciled, add a Dev row for `20260814120000`, or rename the file to the recorded version | Dev manifest (**blocks** that version) | Prod never recorded it; Dev recorded the other version; the pending-set tool keeps `20260814120000` pending as an alias annotation | Rename the file, but only after you approve; no automatic resolution |
| Cases 41 / 42 identity | `20260305203528` and `20260407203226` have effects present in Production through the related recorded versions `20260305205811` / `20260408200431` (SQL differs): bookkeeping row, rename, or leave unreconciled | Prod manifest (**blocks** these 2) | Recorded SQL differs from the files; an exact SQL diff has not been run | Approve an individual SQL diff first (read-only, local); then choose |
| 18 unproven baseline versions (Production) | Whether the missing evidence (name-level definition checks, data/privilege effects, 6 data-bearing files) is gathered or you attest | Prod manifest (**blocks** those 18) | Gap register rows `GAP-prod-*` | Gather the definition-level diffs I can do locally; attest or query only for the rest |
| Production history bookkeeping timing (N6/G8) | In the release window (recommended) or earlier | Stage F | Evidence is only valid inside the 24 h freshness window | Release window |
| 106 unproven + 11 partially present + 3 absent Development versions | Whether Development is reconciled at all before Step 4, and what to do about the versions with missing effects (Stage B flagged 14 as `UNEXPECTED_MISSING_EFFECT`; examples: storage policies removed by containment, Realtime tables absent on Development, `update_pricing_rules`, the `pg_net` trigger) | Dev manifest | Do not restore removed policies by default; parity decisions were deferred | Reconcile Development after the Production path is approved; keep containment |
| `update_pricing_rules` on Development | Add it to Development or leave it Production-only | Dev manifest (`20260611184401`) | Exists on Production, no known consumer (audit section T) | Leave until a consumer is identified |
| NOT VALID constraint validation timing | Validate `order_refunds_operation_shape` now or later; the other three only after read-only Production counts show zero offenders | Release plan | D4 `d4-constraint-validation.md` | As recommended in D4 |
| `supabase_admin` default privileges | Whether to narrow or accept them (they still grant anon/authenticated on objects `supabase_admin` creates) | Step 3 | D3 finding F-2 | Step 3 security review |
| Hosted application path for 39 versions older than Production's latest recorded version | How the upgrade is applied without `--include-all` | Step 4 | D3 finding F-1 | Design in Step 4 |
| Deploy-first sequence | Confirm `customer-cancel-order` ships with or before `20261012120000`; private-bucket consumers use signed URLs before `20261014/1015` | Step 4 | Case 43 and D3 findings | Confirm |
| Master-account password (SEC-A) and the temporary `cli_login_postgres` role | Rotation and removal | Outside Step 2 | Audit sections S and U | Owner action |
| `.sql.sql` filenames | Rename the two files or keep them | Cosmetic | `20260816221636...sql.sql`, `20260816222905...sql.sql` are recorded in Production | Keep for now; renaming changes nothing about versions |

## What is NOT a decision
Case 43 is withdrawn and must never be marked applied; the 23 October migrations stay pending until the coordinated release; no history row is inserted anywhere by E1.
