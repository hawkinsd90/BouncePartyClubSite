# E2E prerequisites for moving from local rehearsal to hosted Development changes (and what carries over to Production)

**Planning document.** It does not authorize any hosted read, write, deployment or containment change. Evidence date for all facts: Stage B captures (Production 2026-10-16 18:54:59 UTC, Development 18:55:20 UTC) and the local rehearsals of E2C to E2E. Every prerequisite is stated with how it would be satisfied and by whom.

## 1. Read-only evidence needed to establish Development's current state
| # | Evidence | Why | Method (approved read-only route only) |
|---|---|---|---|
| R1 | Fresh schema-only catalog capture of Development, inside a 24 h window of any write | the manifest is derived from 2026-10-16; objects, policies and containment may have changed | direct `psql` with `default_transaction_read_only=on`; no Supabase CLI |
| R2 | Development migration history (58 rows at capture) incl. `statements` text for `20260814002658` | confirms the alias and recorded rows | same |
| R3 | Per-statement presence queries for the 209 history-only candidates and 4 net-zero chains | history-only rows need a true predicate (D-6) | `e2a-dev-proof.csv` queries, regenerated |
| R4 | Read-only count queries for the 68 data-only class-P versions (part of the 95 unprovable statements in 73 pre-October Development versions) or labelled owner attestations | a schema capture cannot show seeds/backfills | `readonly_queries_needed` column; counts never prove execution |
| R5 | Definition comparison Development vs Production for the 12 "definition differs" items (list in the Development manifest) | decide history-only, targeted alignment or accept drift | queries in `e2a-unresolved-evidence.md` section A |
| R6 | Containment inventory: which `storage.objects` policies, triggers and extensions were removed or changed on purpose; the 14 Edge Function stubs | 8 storage-policy versions, the `pg_net` version and the signup trigger version are withheld on this | owner records, containment change log, read-only catalog |
| R7 | Ownership/privilege check for the run role (`pg_has_role`, table/schema owners, `has_*_privilege`) | the hosted `postgres` role was not tested locally for platform-owned objects | read-only catalog queries |
| R8 | Backup/restore point confirmation (what exists, how to restore, how long) | forward-only migrations | Supabase project settings (owner) |

## 2. Production reference checks (preserve existing data and workflows)
Production is the reference (D-7). Before any Development change is decided, record from Production:
1. the 24-check **data preflight** (`e1-production-preflight-queries.sql`; roles outside the vocabulary and orphan/duplicate role rows, duplicate positive PaymentIntents, multiple active portal links, `order_items` without exactly one reference, negative fees, discounts outside 0 to 100, refunds with non-positive amounts) - never run, mandatory before the Production run;
2. the live definitions of the objects that Development and the chain disagree about (`pending_signups_consent` policy, `orders` booking-confirmation policy, `addresses_address_key_unique`, `payments.ledger_sequence`);
3. the list of working business workflows to protect (booking with and without inflatables, deposit/balance payments, cash/check/offline payments, refunds and allocations, portal links, waivers, pictures, contact inquiries) as test cases for the compatibility step (section 8);
4. confirmation that Production still has neither `20260814120000` nor `20260814002658`, and still records 277 versions ending `20260928172217`.
Development data must not be used as evidence about Production behavior or data integrity.

## 3. Role and privilege restrictions
- The run uses the `postgres` role or one named, time-limited role (U-E2E-6); no `cli_login_postgres`; no superuser; no `SET ROLE`; credentials supplied at run time and never stored or logged.
- Read-only phases use `default_transaction_read_only=on`.
- Platform-owned objects touched by the 58: `storage.objects`/`storage.buckets` (5 files), the `auth.users` trigger (`20261016120000`), default privileges (`20261018120000`), a `supabase_*` role reference (`20261013120000`). Hosted capability for these is **unverified** and must be established by R7 (and, if the owner wishes, a rehearsal on a throwaway hosted project, not Development or Production).
- `supabase_admin` default privileges (finding F-2) stay permissive after the release; Step 3 decides.

## 4. Private Storage buckets and signed-URL compatibility
`20261014120000` and `20261015120000` make `signed-waivers`, `signatures`, `lot-pictures` and `order-pictures` private and `20261015123000` creates the private `order-evidence` bucket; `carousel-media` stays public. Consumers (`get-waiver-status`, evidence/portal functions, `useAdminPhotos.ts`, `LotPicturesDisplay.tsx`) must already use signed URLs **before** those migrations run, otherwise public URLs stop working. Verification: bucket rows by id/public flag (locally shown: 10 buckets, the five private ones), and on a hosted Development after deployment: an upload, a signed-URL read and an unauthenticated read refused for each private bucket (not testable locally: the Storage API and signed URLs were not exercised).

## 5. Edge Function deployment dependencies
- `customer-cancel-order` (service-role client) deployed with or before `20261012120000`.
- The booking function that sends `surface: null` deployed only after `20260722172048` (already recorded in Development; for Production D-2).
- Edge Functions that call RPCs whose grants change at `20261012120000`/`20261013120000` must be on the matching version.
- The 14 Development stubs and the containment stay until the owner lifts them; the October migrations must not run on hosted Development while stubs are in place.

## 6. Current Development containment restrictions (unchanged by this stage)
14 Edge Function stubs; storage policies removed (8 pending versions mention them); `pg_net`-dependent calendar sync path and the signup trigger absent in Development; the temporary `cli_login_postgres` role and master-account password rotation (SEC-A) outstanding. **E2E does not remove or alter any of it.** The Development manifest withholds 33 versions on these grounds (23 October, 8 storage-policy versions, the `pg_net` version, the signup-trigger version).

## 7. Financial RPC and Supabase runtime validation
- **Done locally (E2D):** 94 scenario checks; 47 differential calls to 9 financial functions (outcomes identical between the 67 and 58 results).
- **Not done:** provider-facing financial functions (`finalize_payment_operation`, `release_payment_operation`, `mark_*_provider_attempt`, `record_*_provider*`, `apply_provider_refund_event`, `apply_balance_payment_financials`, `claim_balance_payment_financials`, `reserve_refund_allocation`, `_apply_refund_transition`); PostgREST/RLS under real JWT roles; Auth hooks; Storage API; Realtime delivery; payment-provider behavior (no provider calls are authorized).
- Requirement: a function-level financial test plan (E1) executed on a local restore, and a hosted Development smoke test after the release (booking, offline payment, refund reservation) with test data only.

## 8. The critical window and pausing
From E2D/E2E probes of the 58-version path: stop points before `20260716151458` and from `20261012120000` onward are no wider (anonymous-callable functions and anonymous-writable tables) than the starting state; **the 40 stop points from `20260716151458` to `20261011120000` are wider**. Anonymous-callable functions rise from 68 to a peak of 83 before `20261007120000`, drop to 61 at `20261012120000` and to the final 6 at `20261013120000`; anonymous-writable tables (all RLS-enabled) peak at 66 and fall to 39, 2 and finally 1. Therefore: run `20260716151458` through `20261011120000` as one uninterrupted block (the executor's P3), have a recovery action chosen beforehand, and treat "pause before `20261013120000`" as a decision with a recorded owner approval. For Development the October block is the corresponding critical window.

## 9. Recovery and verification for a failed or partially completed upgrade
| Situation | Procedure |
|---|---|
| A file fails | its transaction rolled back (tested); the executor stops; fix the cause (data, privilege, lock timeout) under a new approval; resume from the ledger |
| Run stops between files outside the critical window | resume; no wider exposure than the start state |
| Run stops inside the critical window | resume immediately, or apply a prepared containment script (reviewed in advance; a hosted write needing its own approval), or restore the backup/point-in-time; record the decision |
| History/audit disagree (crash after commit) | complete the audit record; never re-run the file |
| Wrong history-only record found | stop; correction requires a new approval (a deletion is a hosted write) |
| After any outcome | P5 verification: ledger equals the allowlist; 37 catalog assertions; 19-category comparison with the approved reference; anonymous function and table probes; bucket and signed-URL checks; compatibility smoke tests |
No automatic compensating SQL exists or is proposed.

## 10. Gate checklist before the first hosted Development write
1. Owner approval of the design (`e2e-executor-design.md`) and the unresolved decisions that block it.
2. Executor implemented and rehearsed (X-20) on scratch restores of the Production snapshot and of the captured Development dump.
3. Fresh read-only captures R1 to R8.
4. Development manifest finalized from evidence (no `Requires additional evidence` item left in the executable plan).
5. Containment decision recorded; Edge Function and signed-URL prerequisites confirmed.
6. Approval artifact for the specific environment, allowlist hash, commit and phases.
