# S2: the one final owner decision request (44 attestations) and what follows (2026-10-20)

Status: **PREPARED. NOTHING EXECUTED.** No database, Auth, Storage, Edge Function or Git-remote change was made for this document. Production was not contacted.

## 1. What you do now

1. Open `audit/step4/s2-attestation-decision-sheet.html` (nothing is preselected, nothing is sent anywhere).
2. Decide each of the 44 cards ATTEST or REJECT. Current recommendations: **42 ATTEST, D20 and D21 each "ATTEST with the qualified scope shown on the card"** (see 2), 0 REJECT. D20 and D21 are independent of each other and of the other 42.
3. Type your name, press "Build decision text", paste the text into the chat. That text is the 44 decisions.

## 2. Qualified wording for D20 and D21 (exactly what is recorded if you attest)

The ordinary wording ("the database reflects all intended outcomes") is **not** used for either one.

**D20** (batch B21). Scope: *The historical migration's updated function exists in Development. Its historical SQL execution is not proven. Current derived customer statistics are stale. The durable correction is pending at stage S12b. This attestation does not claim that current statistics are correct.* Not proven: *Historical SQL execution of this migration, and correctness of current derived customer statistics (contacts.total_spent_cents and total_bookings), which stay stale until S12b.*

**D21** (batch B22). Scope: *The historical account exists. Both accounts that share the public password are currently banned. Neither password has been rotated. The bans expire on 2026-11-13. Credential remediation remains required. No historical migration SQL will execute.* Not proven: *Credential remediation. Passwords are not rotated, the bans are time-limited to 2026-11-13, and Production has not been examined (SEC-005 stays CONTAINED, NOT PERMANENTLY REMEDIATED).*

The exact strings and their SHA-256 are in `audit/step4/s2-qualified-attestations.json` (D20 `28d222463b44…`, D21 `bf040e876d53…`). If you attest D20 or D21, the decision text carries a line `Dnn QUALIFIED-SCOPE-SHA256 <hash>`, inside the hashed record, so the ledger can only ever receive that wording.

**Can the existing mechanism carry it? Yes, no adjustment is needed.** The attestation marker written to the ledger is `attestation NOT EXECUTED; batch=…; version=…; rule_sha256=…; attested_by=…; attested_at=…; scope=…; not_proven=…; evidence_sha256=…` (`audit/evidence/tools/build_execution_package.py`, `marker`). `scope` and `not_proven` are free-text fields filled at authorization time; the qualified strings contain no `;`, `{` or `}` (tested), so they cannot break the marker or the placeholder substitution. The marker never says "executed". `evidence_sha256` will be the hash of the evidence file set at authorization time. Fallback if you reject: the version stays pending and nothing else changes.

## 3. What proceeds if D20 or D21 stays pending

| Your choice | Pending | Still proceeds |
|---|---|---|
| D21 rejected | B22 (1 version: D21) | Everything else, including B31, B33 and B40. B22 gates nothing. |
| D20 rejected | B21 (1 version: D20) **and** B31, B33, B40 (36 history-only versions) | The other 10 attestation batches. B31 needs B18 and B21; B33 needs B21; B40 needs B31, B33, B09, B36. |
| Both rejected | B21, B22, B31, B33, B40 | B13 to B20 and B37 (43 versions). |
| Any other card rejected | Only that version; if its batch holds other versions the batch is re-split so the rest proceed (a rejected B18 version also holds B31 and B40) | The rest. |

Nothing else in the critical path depends on any attestation: S3 onward runs on the ledger state S2 leaves, and the unrecorded S2-related versions (13 disputed, 26 October-dependent, B23/B24) are not S2 work.

## 4. Remaining S2 batches and exact dependencies

| Batch | Versions | Decision ids | Predecessors | Gates |
|---|---|---|---|---|
| B13 | 7 | D22 to D28 | recorded | none |
| B14 | 5 | D18, D29 to D32 | recorded | none |
| B15 | 6 | D10 to D15 | recorded | none |
| B16 | 6 | D34 to D39 | recorded | none |
| B17 | 5 | D40 to D44 | recorded | none |
| B18 | 2 | D16, D17 | recorded | B31 |
| B19 | 8 | D01 to D07, D19 | recorded | none |
| B20 | 2 | D08, D09 | recorded | none |
| B21 | 1 | D20 | recorded | B31, B33 |
| B22 | 1 | D21 | recorded | none |
| B37 | 1 | D33 | B09 (recorded) | none |
| B31 | history-only | none (no signature) | B02, B03, B05, B07, B12, B18, B21 | B40 |
| B33 | history-only | none | B05, B06, B07, B08, B21 | B40 |
| B40 | history-only | none | B09, B31, B33, B36 | none |

After the decisions: ledger 223 rows, plus 44 attestation rows, plus the 36 history-only rows of B31/B33/B40 = **303 rows** if everything is accepted. `scripts/dev/validate-attestation-decisions.cjs <record.txt>` (read-only, tested) checks every line against the sheet, recomputes the record hash, checks the qualified-scope lines, and prints the dependency-safe batch plan (what executes, what stays pending, what waits).

## 5. The single consolidated authorization that follows your decisions

Prepared by me after the validator passes: exact scripts per batch (generated from the reviewed package; the template hashes equal `development-execution-batches.json`), version lists, approval and filled-script hashes, expected counts per batch and in total, the attestor and time, the `scope`/`not_proven` strings above, the `evidence_sha256`, and stop conditions: any failed assertion, any ledger count or hash that differs from the prediction, any canonical fingerprint or business-data difference, or any unexpected result. You approve once; I then execute batches sequentially without pausing after each success, B13 to B22 and B37 first, then B31, B33, B40 as their predecessors become recorded. A rejected card is never forced. No historical migration SQL is ever rerun.

## 6. SEC-005 deadline-bound follow-up (recorded)

- State: **CONTAINED, NOT PERMANENTLY REMEDIATED.** Both accounts are banned in Development (demo master until 2026-11-13 15:16:05 UTC; second account until 2026-11-13 15:16:16 UTC). Passwords are unchanged and still equal the published one. A legitimate Google master is verified.
- **Deadline: before 2026-11-13** the owner confirms either (a) a secure password rotation for both accounts, or (b) extended bans. Owner plan: restore password reset on the site and rotate before then.
- **Before either account is unbanned:** its password is replaced and session risks (issued tokens, remaining session rows) are addressed.
- I will not extend bans, change Auth accounts or touch Production. This item does not block unrelated S2 or later work, and I will not ask for it again before the deadline except at the S13 password-reset test and in the final acceptance checklist.

## 7. Issue classification (new priority rule)

| Item | Class | Exact dependency |
|---|---|---|
| SEC-005 rotation or extended bans before 2026-11-13 | DEFERRED FOLLOW-UP (deadline-bound) | none for S2 to S15 execution; required before Development acceptance and before any unban |
| Website password-reset defect | REQUIRED BEFORE DEVELOPMENT ACCEPTANCE | tested at S13; the owner's rotation depends on it |
| D20 durable statistics correction | REQUIRED BEFORE DEVELOPMENT ACCEPTANCE, placed at S12b | changes the schema (fn 82 to 84, trg 37 to 39), so it must run after the sealed executor stages S5 to S7 whose fingerprint chain would otherwise abort |
| Travel-fee historical-preservation gap (`shouldReuseSavedTravel` re-prices a stored zero fee on edit) | DEFERRED FOLLOW-UP (no Development order changes today) | code change with the S15 reviewed commit |
| Production likely has the same legacy trigger and demo account | DEFERRED FOLLOW-UP | Production remains unexamined by decision |
| Restore-point backup passphrase confirmation in Bitwarden | REQUIRED BEFORE DEVELOPMENT ACCEPTANCE | owner action; needed before any restore |
| SMS template policy and notification-table exposure (October migrations) | REQUIRED BEFORE DEVELOPMENT ACCEPTANCE | decided in SG-3, not S2 |

No BLOCKER is open for S2.

## 8. Next critical-path stage after S2

**SG-2 = S3 + S4 + S4b**, order unchanged (`s3-s15-stage-group-authorization-plan.md`): S3 the two `storage.buckets` limit updates (B23, B24); S4 deploy 21 Edge Functions one at a time with `verify_jwt` set per function; S4b the always-aborted Storage-policy canary. Its owner decisions are collected in one checklist (bucket limits SEC-021, 21 `verify_jwt` releases, G-16 canary approval, confirmation that the three hosted-log callers are unused). I prepare the exact SG-2 package immediately after the attestations are recorded, because B23/B24 and its preconditions use the ledger state those decisions produce. The goal after that is S5 to S7: execute the security migrations and then restore Development's public-schema access safely.
