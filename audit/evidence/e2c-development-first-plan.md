# E2C Development-first reconciliation plan (D-7)

**Plan only. Nothing here has been run, and nothing here authorizes a hosted read, a hosted write, a migration, a history row or a deployment.** Facts come from the Stage B captures (Development 2026-10-16 18:55:20 UTC), E1, E2A and the E2C inventory run. Any hosted step needs a fresh, dated read-only capture first (the 24 h freshness rule) and its own authorization.

## 1. Principles (owner decision D-7, applied)
1. **Production is the reference.** The reference baseline is the captured Production schema (PostgreSQL 17.6, 2026-10-16 18:54:59 UTC, dump sha256 `d64fd3b4...`), its data-integrity requirements, and the application behavior known to work against it. Development is reconciled *toward* that reference and toward the intended release schema (the D3 final schema); Development is never the authority for what Production should contain.
2. **No history copying.** A Development history row is justified only by evidence about **Development's own catalog and data** for that version. That Production recorded a version proves nothing about Development.
3. **No suppression.** A pending Development migration is "legitimate outstanding" unless evidence shows its effect already exists, is superseded by a later migration that exists, or is intentionally obsolete. A count of pending versions is never reduced by annotation alone.
4. **No resurrection.** Absent objects are not recreated just because a migration mentions them. An absent Development object is compared against Production first: present in Production with the same definition means Development is behind; absent or different in Production means the object is obsolete or intentionally changed and stays absent (examples that must not come back: `orders.start_date`/`end_date` dropped by recorded `20251216210332`; the Case 43 anonymous cancellation policy; the uppercase `user_roles` CHECK; storage policies removed by containment; the superseded intermediate function definitions of the omitted-version group).
5. **Execution and recording are different acts** (D-6): "executed" only for what the approved application method really applied; "history-only" only with a stated basis; qualified attestations labelled as such.

## 2. Starting state of Development (from the captures and the pending-set calculator)
| Fact | Value |
|---|---|
| Recorded versions | 58 (57 match a repository file; `20260814002658` has no file of that version) |
| Pending repository versions | 329 = 306 pre-October + 23 October |
| E2A classes of the 329 | H 209, P 89, X 28 (5 pre-October + 23 October), I 3 |
| After the approved identity changes are made in the repository (D-3, D-4, D-5) | pending 326 (303 pre-October + 23 October); the three I-class versions disappear; `20260814002658` becomes matched. Calculator output: `e2c-version-identity-impact.md` |
| Edge Functions | 14 stubs/containment in place, deliberately untouched |
| Open items from the captures | 26 pre-October versions with absent or unmatched effects; 73 versions with 95 unprovable data/dynamic statements; storage policies removed by containment; custom e-mail hook function and its grants absent; `update_pricing_rules` absent (exists in Production); Realtime tables and the `pg_net` trigger path not provable; one recorded version (`20260723174017`) whose policy was later removed by containment |

## 3. The seven kinds of work, kept separate
| Kind | What it is | Development specifics | Write? | New evidence needed first |
|---|---|---|---|---|
| A. Historical bookkeeping | history rows for versions whose effect is verified (D-6) | up to 209 class-H versions, **each re-verified** against a fresh Development capture and recorded with a basis marker; class P only after proof or a labelled attestation | history only | fresh capture; per-version proof rows; marker wording approved |
| B. Schema alignment | making Development's objects match the reference where it is behind or different | the absent/unmatched items in section 5; decided object by object against the Production capture | schema | Production definition for each object, Development definition, intended-release definition |
| C. Applying pending migrations | executing SQL that has not run | the 5 pre-October class-X versions, any P version whose absent effect is confirmed legitimate, then (gated) the 23 October versions | schema and data | rehearsal on a scratch restore of the captured Development dump (section 7) |
| D. Data migration preconditions | counts and guards that decide whether data-touching migrations will fail or rewrite rows | role normalization/orphan/duplicate guards, duplicate PaymentIntent, active portal links, order_items references, non-negative amounts; the 95 unprovable statements | read-only | the preflight query set on **Development data** (Development data is not evidence for Production) |
| E. Edge Function deployment | restoring real functions in place of the stubs | needed before October migrations that change behavior (`customer-cancel-order` with or before `20261012120000`; signed-URL consumers before `20261014120000`/`20261015120000`) | deployment | separate authorization; out of Step 2 |
| F. Security prerequisites | issues that must be settled so the new schema does not widen exposure | `supabase_admin` default privileges (F-2), master-account password rotation (SEC-A), temporary `cli_login_postgres` role, Development containment | various | Step 3 decisions |
| G. Application compatibility verification | proving the app works against the resulting schema | booking with NULL surface (D-2), refund and payment RPCs, invoice links, private buckets | read/test | function-level financial tests (E1 plan), end-to-end checks on Development after E |

## 4. Order of work (conceptual; each arrow is a gate)
1. **Fresh read-only capture** of Development and Production (both inside the same freshness window).
2. **Local Development rehearsal (no hosted write):** restore the captured Development schema dump into a scratch database, apply the intended Development manifest, compare the result with the Production-reference release schema, and rerun the D4 data scenarios against the Development-shaped start. This is the real Development-first validation; it is a future local stage.
3. **Read-only evidence queries** (section 6) on Development; owner attestations where no query can answer.
4. **Bookkeeping (A)** for verified class-H versions; the marker states "history-only: schema effect verified on Development" and cites the proof row. Bookkeeping must not make any pending version look executed.
5. **Schema alignment and pending application (B, C)** for non-October items, one object or version at a time, each preceded by the comparison against Production's definition.
6. **Preconditions (D)** on Development data.
7. **Security prerequisites (F)** and **Edge Function deployment (E)** as the owner authorizes them; this is the gate that releases the October migrations.
8. **October migrations (C)** on Development, then **compatibility verification (G)**.
9. Only then is the Production manifest finalized; it is built from the Production reference and the E2C manifest, not copied from Development.

## 5. How each Development class is handled
- **Class H (209):** bookkeeping candidates only. Re-verify every one on the fresh capture. Versions whose effects were removed by containment (storage policies) are not H.
- **Class P, data-only (68):** evidence by read-only counts on Development, or a labelled attestation. A count never proves the original SQL ran.
- **Class P with absent or unmatched effects (21) and class X pre-October (5):** per object, compare with Production:
  - Storage policies on `storage.objects` removed by containment: **stay absent**; the October migrations define the final storage policy set.
  - `custom_email_hook` function and its `supabase_auth_admin` grant (versions `20260315190615`, `20260315202232`, `20260316174421`; three redefinitions of one function): Production has the end state; Development needs the same end state. Whether all three are executed or only the last, with the others recorded history-only, is the same omission/resumption question as D-1 and must be tested on a scratch restore before a choice.
  - `update_pricing_rules` (`20260611184401`): exists in Production, absent in Development; no known consumer (audit section T). Align only if the owner confirms a consumer or wants parity.
  - `pg_net` extension and calendar-sync trigger path: not provable locally; needs hosted read-only evidence and an owner decision.
  - The unmatched definitions listed in `e2a-unresolved-evidence.md` section A: read the live definition and compare with Production before any action.
- **Class I (3):** removed by the repository changes in D-3, D-4, D-5 once they are separately authorized. Until then they stay pending and annotated.
- **23 October:** blocked by the containment/stub gate; applied only after step 7.

## 6. Decisions that need new read-only evidence before any Development write
| Decision | Evidence needed |
|---|---|
| Which class-H versions are recorded | fresh Development catalog; per-version proof rows |
| Which absent objects are realigned | Production and Development definitions of each object (queries in `e2a-unresolved-evidence.md`) |
| Treatment of the three `custom_email_hook` versions | Production function body digest, Development absence, local scratch test of "last version only" versus "all three" |
| `update_pricing_rules` parity | consumer search (code and database) |
| Case 41 on Development (`20260305205811`, unrecorded in Development, backfill unprovable) | count of Development orders with NULL `customer_selected_payment_cents` and the distribution of `customer_selected_payment_type`; the Development provenance of the columns |
| Case 42 equivalent on Development (`20260408200431`) | presence of `orders.refund_requested` and its default |
| Alias (D-5) | Development history row for `20260814002658` (name, statements text) re-read at the time of the change |
| Data preconditions | preflight set on Development data |
| October readiness | stub inventory and containment state |

## 7. What stays out of scope
Any use of the Production-to-Development data synchronization utility (it overwrites Development data and needs its own authorization); Development data copied from Production is not evidence about Production. No Step 3 remediation; no password changes; no containment removal.
