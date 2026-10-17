# E2I: unresolved blockers and owner decisions for the Development manifest

Status: **nothing here is approved.** `e2i-development-manifest.csv` is a proposal; candidates are not approved for recording or execution. Production's 58-version allowlist is not reused anywhere in it.

## 1. What remains unresolved, by version
| Group | Versions | Why it cannot be closed offline | Evidence that would close it |
|---|---|---|---|
| Qualified owner-attestation candidates (data/seed/backfill effects) | 42 | The data effect of a statement cannot be proved from a schema capture, and a state that matches the effect does not prove this version produced it | Q02 to Q10, Q12, Q19 to Q21, Q27 (counts, key names, booleans) **and** a signed owner attestation naming the version |
| Unresolved: financial, identity, security, definition | 25 | Destructive or financial transformations (balances, tax flags, address merges, loyalty counters, customer links, webhook events, changelog redaction), the demo admin login, the user_roles chain, two definition differences | Q11 to Q18, Q22, Q23, Q26, Q28, plus a per-version owner decision (attest, corrective statement, or leave unrecorded) |
| Withheld, containment | 6 | Removed on purpose from Development (pg_net, signup trigger path, public buckets, Realtime membership) | Owner containment decision, Q20, Q21, Q24, Q25 |
| Withheld, storage policies | 8 | Superseded only after the three October storage migrations have run | Executed October storage migrations, then Q22 |
| Withheld, October block | 23 | Behind the deployment gate | The gate itself (below) |
| Actual SQL execution candidates | 2 | `20260325231044`, `20260517221038` (bucket limits/MIME) | Q20 to confirm, then owner approval |

## 2. Owner decisions (new, numbered U-E2I-n; the U-E2E-1 to U-E2E-14 list is unchanged)
1. **U-E2I-1 Attestation.** Will the owner sign qualified attestations for the 42 candidates once the read-only counts are in hand, in the form the executor already supports (version, statement of what was observed, date, author)? Without it these 42 stay unrecorded.
2. **U-E2I-2 The 25 unresolved.** For each financial/identity item: attest, run a separately reviewed corrective, or leave unrecorded. No item may be recorded history-only.
3. **U-E2I-3 Bucket SQL.** Approve or decline running `20260325231044` and `20260517221038` (idempotent `UPDATE storage.buckets … WHERE name = …`). The carousel-media MIME list is not set by either file; where Production's list comes from is not established.
4. **U-E2I-4 `update_pricing_rules`.** Production-only, no caller. Run `20260611184401` (parity; October then restricts it to `service_role`) or leave it out (October's own guard skips it).
5. **U-E2I-5 Realtime.** Keep Development's reduced publication (containment) or restore Production's membership with `20260324051459`/`20260324154955`.
6. **U-E2I-6 pg_net / signup trigger.** Keep pg_net and the calendar-sync trigger path out of Development, and confirm that `20261016120000` (which recreates the signup trigger) is the intended way to restore signup behaviour.
7. **U-E2I-7 Default privileges.** Development's captured `public` default ACLs are absent; Production's grant `anon`/`authenticated`/`service_role`. Decide whether new Development tables, sequences and functions should receive explicit GRANTs (14 relations and 27 functions in the replay) before the release runs. Highest-impact open item.
8. **U-E2I-8 Demo admin.** `20251003170350` creates an admin login in `auth.users`. Q26 says whether it exists; either way the version is never executed and a present login needs an owner review.
9. **U-E2I-9 Stricter columns.** Development's `same_day_weekday_delivery_fee_*` columns are `NOT NULL`, Production's nullable. Accept (no function fails) or relax with a reviewed change.
10. **U-E2I-10 Read-only access.** Approve the method, the role (a read-only role as described in the plan) and the run record for `e2i-development-readonly-evidence-plan.sql` (Development only). Until then no evidence is gathered.
11. **U-E2I-11 Hosted tooling.** Any hosted-capable executor is a new, separately reviewed design (opposite network and credential protections). The local executor is not relaxed here (section 5).

## 3. Identity and ledger uncertainties that remain
- The alias `20260814120000` (recorded as `20260814002658`) stays treated as recorded. Its content equivalence was established in E2A/E2E; this stage did not change it.
- The 58 captured Development rows were taken as correct; Q01 re-reads them before any use.
- A history-only row carries a single SQL comment, so a replay of the ledger runs nothing; a tool that only compares version strings cannot tell executed, history-only and attested rows apart (accepted, documented in `e2h-ledger-integrity.md`).
- Production-recorded versions are **not** evidence for Development: no row was copied; Production's captured catalog was used only as the behavioural reference.

## 4. Conditions before the Development manifest can be approved
1. U-E2I-1 to U-E2I-10 answered.
2. Q01 to Q29 run read-only on Development; results reviewed with the owner; the manifest regenerated from the results (the verdicts above can only move *toward* history-only, attestation or execution by evidence, never by assumption).
3. Fresh Stage B-style captures (the 2026-10-16 captures are the basis here; hosted state may have moved).
4. A rehearsal of the final Development manifest on a fresh scratch restore with the local executor's checks (a new allowlist built for Development; the Production allowlist stays untouched).
5. The security checks of `e2h-security-recovery-plan.md` for the October intermediate states (three portal functions, containment SQL ready, reversible).

## 5. Executor boundaries kept
`scripts/dev/local-executor/` was not modified. Loopback-only, `bpc_exec_` database names, no credentials, scratch-ownership marker, the Production allowlist bound to the E2C manifest and git commit, and the audit-store rules are unchanged. This stage used a separate analysis helper (`e2i_dev_restore.py::run_files`, no allowlist, no ledger writes, scratch databases `bpc_replay_e2i_*` only) to apply the repository files. Requirements for a future Development-capable executor (separate, not built): a new allowlist builder for the Development manifest format with the three record kinds; a read-only precondition step that re-verifies each history-only candidate against fresh captures at run time; explicit attestation documents for the 42/25; a Development target profile with TLS and an approval artifact; no reuse of the loopback relaxations.
