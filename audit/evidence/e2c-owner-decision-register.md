# E2C owner decision register (D-1 to D-7)

Recorded 2026-10-16 from the owner's Stage E2C instruction. **These are planning decisions, not authorization for any hosted change, any migration-file change (withdrawal, archive move, rename), any history write or any deployment.** Identifiers D-1 to D-7 are those of `e2b1-owner-decision-options.md` and `e2b2-owner-decision-package.md`. Where the owner chose differently from my earlier recommendation, that is stated. Each "prerequisite" below is a condition I propose for the next authorization; none has been performed unless the table says so.

| ID | Owner decision | Status | Differs from my E2B recommendation? |
|---|---|---|---|
| D-1 | Conditional reduction; 58-version sequence is the leading candidate; 67 stays the comparison baseline; no shortened set approved for hosted execution | approved (conditional) | Yes (I recommended keeping all 67) |
| D-2 | Include `20260722172048` in the intended Production upgrade | approved | No |
| D-3 | Withdraw and archive Case 41 `20260305203528`; never execute its differing backfill against Production | approved | No (withdraw) |
| D-4 | Withdraw and archive Case 42 `20260407203226` | approved | Chosen among two options I rated equal |
| D-5 | Align `20260814120000` with Development-recorded `20260814002658` only after verifying cross-environment dependencies and risks | approved conditionally | Conditional, I had recommended rename after approval |
| D-6 | Per-version, evidence-backed reconciliation; never claim SQL ran because effects exist; label qualified attestations | approved | No |
| D-7 | Development-first reconciliation and validation, with Production's schema, data integrity and known application behavior as the source of truth | approved | Reverses my order (I had recommended Production first) |

## D-1. Conditional reduction of the 67-version rehearsal set
- **Scope:** the nine versions omitted by the 58-version candidate: `20260715221828`, `20260716104333`, `20261010110000` (no-effect group) and `20260716151530`, `20260716152823`, `20260716173644`, `20260717111737`, `20260717113131`, `20260814114825` (fully-replaced group).
- **Rationale (owner):** do not execute everything merely because it was rehearsed; find the smallest demonstrably safe sequence.
- **Evidence:** E2B-1 catalog and data-digest equality for 64, 58 and each-of-six omissions; E2C adds intermediate-state, exposure, interruption/resumption, late-application and alias-order tests (`e2c-omission-and-resumption-tests.md`, `e2c-67-vs-58-crosswalk.csv`).
- **What the decision does not do:** it does not approve the 58, 64 or any other set for hosted execution. The 67 remains the comparison baseline.
- **Prerequisites before any set is approved:** (1) owner review of the E2C tests; (2) the omitted versions' treatment in history decided per version (D-6); (3) D4-style failure and data scenarios rerun on the chosen set, if the owner wants them to carry over (not yet done); (4) the application method for the 39 versions older than `20260928172217` designed and rehearsed (finding F-1); (5) the Production read-only preflight run.

## D-2. Include `20260722172048_allow_null_surface_for_ee_only_orders`
- **Scope:** one version, in both the 67 and the 58.
- **Rationale:** Event-Essentials-only bookings send `surface: null` (`bookingBuild.ts` line 271); Production's column is NOT NULL.
- **Evidence:** E1 U-5 experiment; E2B-1/E2B-2 findings; the other 66 apply without it.
- **Prerequisites:** the migration must be applied **before** the booking Edge Function that sends NULL goes live (the old code sends a surface value and is unaffected by the change); a documentation-only correction of the "Dev only" header is separate and, because it edits a migration file, needs its own authorization and a refresh of the D3 manifest hash; the preflight check that no Production consumer depends on the old placeholder.
- **Not done:** no SQL or metadata change.

## D-3. Case 41 `20260305203528_add_customer_payment_amount` — withdraw and archive
- **Scope:** the file (sha256 `a6a679d26b0e7200990438338a66f684184721e4f80e60fd72cf2828bed601e8`, 774 bytes); related recorded Production version `20260305205811` (file sha256 `8f6892b3...e38`).
- **Rationale:** backfill proven different (always `'deposit'` versus `CASE 'full'/'deposit'`); executing it can rewrite real payment-selection rows.
- **Evidence:** `e2a-prod-alias-comparison.md`; E2B-1 local test (13 synthetic orders: 13 `'deposit'` versus 12 `'deposit'` + 1 `'full'`).
- **Prerequisites:** the repository change itself (move to `audit/evidence/withdrawn-migrations/` as Case 43 was, record in `version-aliases.json` as withdrawn, remove the alias entry, update pending-set test assertions that currently say cases 41/42 stay pending) needs its own authorization; the archive must keep SQL, hash and the evidence reports; the version must never be recorded in any history. Development still lists `20260305205811` as an unrecorded version with an unprovable backfill; that is a D-6/D-7 item, not covered by this withdrawal.
- **Expected inventory effect:** `e2c-version-identity-impact.md`.

## D-4. Case 42 `20260407203226_add_refund_requested_to_orders` — withdraw and archive
- **Scope:** the file (sha256 `589560b47350a0d0c1ffe64988971fa89ea4c68330465d5b761b21b6e09f5170`, 1,178 bytes); equivalent recorded Production version `20260408200431` (file sha256 `26988ec16332be273a76e857e4fecbf52331f90d317e7e7f4e0bdafb5f74e06f`).
- **Rationale:** executable SQL is digest-identical (`23fa13edf474228c...`); the files differ only in the header comment; the recorded counterpart stays.
- **Prerequisites:** same repository-change authorization as D-3; archive copy keeps the longer header comment, which is the only part not present in the retained file.
- **Caution:** equivalence is established by executable-SQL digest, not by filename; the recorded `statements` text itself has not been read (digest only).

## D-5. Align `20260814120000` with Development's `20260814002658` (conditional)
- **Scope:** the file `20260814120000_create_contact_inquiries.sql` (sha256 `9ef0fe6e6f484c3a706f6beb8ab2f6c987d5bc0be8a0b04d6602f1f900ce4cd0`) and the three migrations and tests that mention it.
- **Condition set by the owner:** verify all cross-environment dependencies and risks; do not assume a rename is harmless.
- **Evidence:** E2C `e2c-version-identity-impact.md` section 3 and the alias-order sequences in `e2c-omission-and-resumption-tests.md`.
- **Result so far:** see section 3 of `e2c-version-identity-impact.md`; the conditions are listed there as satisfied, unsatisfied or open. No file was renamed.

## D-6. Per-version evidence-backed reconciliation
- **Rule:** a history record means exactly what its marker says. "Effect present" never becomes "SQL ran". Allowed record kinds proposed here: (a) `executed`, written by the approved application method only for versions it actually applied; (b) `history-only: schema effect verified (basis: <evidence ids>)`; (c) `history-only: qualified owner attestation (attested by <owner>, date, scope, not proven by catalog)`; (d) never a record for a withdrawn version.
- **Scope:** the nine omitted versions (if the 58 is later approved), the 40 baseline versions, Development's pending versions, and any version the owner attests.
- **Prerequisites:** the marker wording approved by the owner; per-version proof rows (`e2a-prod-baseline-proof.csv`, `e2a-dev-proof.csv`); read-only queries for the 15 baseline versions with unprovable data statements.

## D-7. Development-first reconciliation and validation
- **Rule (owner):** Production's existing schema, data integrity and working application behavior are the source of truth; Development is neither the authority for Production nor a source to copy history from.
- **Consequences:** Development is reconciled and validated first against the captured Production schema, without suppressing legitimate pending migrations and without recreating obsolete functions or permissions; the October migrations on Development stay blocked by the containment/stub gate until the owner lifts it.
- **Plan:** `e2c-development-first-plan.md`.
- **Prerequisites:** a fresh, dated read-only capture of both environments before any write; the owner's decision about the Development containment gate; the evidence queries listed in the plan.

## Interactions between decisions
- D-1 and D-5: moving `20260814120000` earlier changes what `20260814113146` and `20260814114825` do when they run (see the alias-order sequences); `20260814114825` is one of the nine candidates for omission.
- D-3/D-4 and D-6: withdrawn versions are removed from the pending inventory without a history row; omitted-but-kept versions need a history-only record or the pending inventory keeps listing them.
- D-2 and the Edge Function deploy order: migration first, booking function after.
- D-7 reverses the order in my E2B-2 sequence outline (Production first); that outline is superseded for ordering by `e2c-development-first-plan.md`.
