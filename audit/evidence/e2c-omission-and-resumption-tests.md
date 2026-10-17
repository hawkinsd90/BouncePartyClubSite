# E2C omission, intermediate-state and interruption/resumption tests (67-version baseline versus the 58-version candidate)

All tests ran on disposable local PostgreSQL 18.4 databases (`127.0.0.1:54329`, names `bpc_replay_e2c_*`), each cloned from the restored pre-upgrade Production schema (`bpc_replay_d4_template`: Stage B dump sha256 `d64fd3b4...`, captured Production history). Data: the synthetic D4 valid dataset (6 users, 9 role rows, 12 orders, 14 payments, 4 refunds, 7 links) only. Tool: `tools/e2c_rehearse.py` (commands `steps`, `exposure`, `resume`, `late`, `atomic`, `aliasfx`); raw JSON in the protected scratch folder `C:\Users\vikki\migration-evidence\e2c-scratch\`. No hosted system was contacted and no result approves any sequence.

The 58-version candidate omits exactly nine of the 67 versions:
| Group | Version | File |
|---|---|---|
| no-effect pair | `20260715221828` | `add_anon_insert_portal_shortlink_policy.sql` |
| no-effect pair | `20260716104333` | `remove_anon_portal_shortlink_insert.sql` |
| no-op October | `20261010110000` | `add_customer_approval_timestamp.sql` |
| fully replaced | `20260716151530` | `add_check_product_availability_rpc.sql` |
| fully replaced | `20260716152823` | `grant_table_privileges_tc_tables.sql` |
| fully replaced | `20260716173644` | `extend_public_business_settings_for_event_essentials.sql` |
| fully replaced | `20260717111737` | `fix_reorder_categories_ambiguous_column.sql` |
| fully replaced | `20260717113131` | `fix_save_product_bundle_quantity_and_missing_product.sql` |
| fully replaced | `20260814114825` | `upgrade_contact_inquiries_for_invoices.sql` |
Per-version SQL effects, Production status, superseding version, data statements and dependencies are in `e2c-67-vs-58-crosswalk.csv`.

## 1. Final-state equivalence (repeats E2B-1 with the richer dataset)
| Sequence | Versions | Failures | Catalog differences vs the full 67 | Row-digest differences |
|---|---|---|---|---|
| `full67` (reference) | 67 | 0 | reference | reference |
| `c58` | 58 | 0 | none (19 categories incl. function bodies, policies, grants, default ACLs, Storage, publications) | none |
| `full67_alias` (`20260814120000` moved before `20260814113146`) | 67 | 0 | none | none |
| `c58_alias` (58 versions and the alias order) | 58 | 0 | none | none |

## 2. Intermediate states (fingerprint and probes after every migration)
A fingerprint of ten catalog categories and targeted probes (policies on `invoice_links`, anonymous INSERT privilege, function body digests and ACLs for the four affected functions, ACLs of seven tables, `contact_inquiries` column count) were taken after **each** migration of both paths.
- Of the 58 versions common to both paths, **24 stop points differ, all in the `functions` category only**; nothing else (tables, columns, constraints, indexes, triggers, policies, default ACLs, publications, Storage) differs at any shared stop point.
- Two functions explain every difference:
  1. `check_product_availability`: at the single stop after `20260716151549` the 67 path has the earlier variant (from `20260716151530`) and the 58 path has no function yet; they converge at `20260716152447`.
  2. `get_public_business_settings`: from `20260716231809` to `20260814120100` (23 stop points) the 67 path exposes the two Event-Essentials keys added by `20260716173644`; the 58 path keeps Production's current definition until `20260820165646`, which installs the final definition in both paths.
- The other omitted versions leave no difference at any shared boundary: `20260717111737` and `20260717113131` are replaced by the immediately following version, so no shared stop point lies between them; `20260716152823` and `20260814114825` change nothing in the catalog at their position (the privileges are already granted by the platform default ACLs when `20260716151458` creates the tables, and the contact-inquiries block is guarded and the table does not exist yet); `20261010110000` changes nothing.
- Dependency on platform default ACLs: the omission of `20260716152823` is equivalent **because** the restored Production default ACLs already grant `anon`/`authenticated`/`service_role` on new `public` tables (finding F-2). If those defaults were narrowed before `20260716151458` ran, the explicit grants would matter. The hosted default ACLs were captured and restored, so this holds for the captured state only.

## 3. The temporary anonymous INSERT policy on `invoice_links` (`exposure`)
Test: with a synthetic order, `SET LOCAL ROLE anon; INSERT INTO public.invoice_links (order_id, link_token, short_code, link_type, deposit_cents) VALUES (..., 'portal_shortlink', 0)`, rolled back.
| Sequence and point | Anonymous insert |
|---|---|
| 67 path, before `20260715221828` | rejected (row-level security) |
| 67 path, after `20260715221828` | **accepted** (policy `Anon can insert portal shortlinks` exists) |
| 67 path, after `20260716104333` | rejected |
| 58 path, before the pair and after the next selected version `20260716151458` | rejected at both points |
Meaning: in the 67-version path there is a window, bounded by two adjacent versions, in which any anonymous client can insert a portal shortlink row for any order id. It is closed by the next version, but a release interrupted between them leaves the policy open until resumed. The 58 path never creates it. The pair is net-zero for the final state, which is why final-catalog equality could not reveal this.

## 4. Late application of an omitted version (`late`)
Each omitted file was applied on its own to a completed 58-path database, and then all nine in version order; the final fingerprint is compared with the completed 58 state.
| Version applied late | Result |
|---|---|
| `20260715221828` | **leaves the open anonymous INSERT policy** (policies differ) |
| `20260716104333` | no change |
| `20261010110000` | no change |
| `20260716151530` | regresses `check_product_availability` to the earlier variant |
| `20260716152823` | no change |
| `20260716173644` | regresses `get_public_business_settings` (drops the later key) |
| `20260717111737` | regresses `reorder_product_categories` |
| `20260717113131` | regresses `save_product_bundle` (loses the overflow guard) |
| `20260814114825` | no change |
| all nine in order | functions regress; the policy pair nets to zero |
Meaning: **an omitted version that is left "pending" is not harmless**. Five of the nine would damage the finished release if any process later ran them (for example a push that includes older pending versions). Omission therefore only works if each omitted version is recorded in history (or withdrawn) so it can no longer be selected, and the application method must run only the frozen list.

## 5. Interruption and resumption (`resume`, `atomic`)
Method: the 58 path was executed up to eleven stop points; at each, the database was cloned twice and resumed two ways:
- **Proper resume:** the nine omitted versions recorded as history-only, then the remaining approved versions applied in order.
- **Naive resume:** every version of the 67-version set not found in the ledger applied in version order (what a "run all pending" tool would do), so omitted versions older than the stop point run late.
| Stop after | Executed so far | Proper resume: final = full 67 result | Naive resume: versions run | Omitted versions run late | Naive resume: final = full 67 result | Differing categories |
|---|---|---|---|---|---|---|
| `20260715214053` | 1 | yes | 66 | 0 | yes | none |
| `20260716151458` | 2 | yes | 65 | 2 | yes | none |
| `20260716151549` | 3 | yes | 64 | 3 | yes | none |
| `20260716173638` | 5 | yes | 62 | 4 | yes | none |
| `20260717110829` | 10 | yes | 57 | 5 | NO | functions |
| `20260717115647` | 13 | yes | 54 | 7 | NO | functions |
| `20260814113146` | 26 | yes | 41 | 7 | NO | functions |
| `20260814120000` | 27 | yes | 40 | 8 | NO | functions |
| `20260925171210` | 31 | yes | 36 | 8 | NO | functions |
| `20261010120000` | 40 | yes | 27 | 9 | NO | functions |
| `20261016120000` | 47 | yes | 20 | 9 | NO | functions |

Result: **proper resume reached the full-67 final state at 11 of 11 stop points** (and equals the uninterrupted 58 result at all of them); **naive resume diverged at 7 of 11** (stop points 20260717110829 onward are those where an omitted version's superseder had already run, so running the omitted version late regressed a function). The ledger holds 386 rows in these local runs (277 captured + 42 simulated baseline/case rows + 67 executed or history-only).
- Atomicity of one migration file (`atomic`): a copy of each of four files (`20260716151549` data seed, `20260716231809` data backfill, `20260820165646`, `20261012120000`) with an extra failing statement appended, run as one transaction, left the catalog fingerprint and the row digests unchanged (error "division by zero"; the test wrote no ledger row). This confirms the one-transaction-per-file method; a failure inside a file is not a partial state, but a stop **between** files is a real intermediate state (section 2).

## 6. Answers to the requested questions, per omission
| Question | Finding |
|---|---|
| Exact SQL effects, existence in Production, superseding versions, data statements | `e2c-67-vs-58-crosswalk.csv`; none of the nine contains a data statement |
| Intermediate permission, trigger, constraint, function dependency | permissions: none beyond the default-ACL dependence of `20260716152823`; triggers and constraints: none; functions: sections 2 to 4 |
| Effect on failure recovery or resumption | the 58 path has fewer risky intermediate states (no open anonymous policy; no defective function interim variants); it has one different intermediate behavior (the Event-Essentials keys appear later); a stop between files is recoverable only if the ledger and the executed list agree (section 5) |
| History bookkeeping still needed | **yes for all nine** if omitted, as history-only records with their basis (D-6); the five that regress and the policy-creating `20260715221828` are the ones that must never be left pending |
| Change to the expected final history inventory | none in row count (384 after D-3/D-4); the nine rows have a different kind (history-only instead of executed) |

## 7. Is the 58-version set safe?
**For the catalog and the synthetic data of the restored Production state, yes: it is at least as safe as the 67 and removes the open-policy window.** It is not yet approvable for hosted execution because: (1) the omission is safe only together with history-only records for the nine (or withdrawal), and a design for writing them; (2) the D4 failure and data scenarios (the five expected-failure fixtures and the 94 checks) were run on the 67-version sequence and have not been rerun on the 58; (3) the hosted application path for the 39 versions older than `20260928172217` is undesigned; (4) equivalence holds for the captured default ACLs and synthetic data only, and the Production read-only preflight has not run; (5) the interim difference in `get_public_business_settings` must be accepted (or the frontend gating confirmed tolerant) for a release that could be interrupted. Further tests that would remove (2): rerun the D4 scenario set on `c58` (a local, offline stage).
