# Stage C5 report: pending-set calculator

HEAD `831ea9496438fd3188c954106e88f6e9d500329b`, branch `Dev`. Tool: `scripts/dev/migration-pending-set.cjs` (companion utility; `migration-replay.cjs` untouched in C5). Tests: `src/lib/tests/security/migrationPendingSet.test.ts`. Outputs: `audit/evidence/c5-pending-sets.json`, `audit/evidence/c5-pending-versions.md` (the exact lists). Aliases: `audit/evidence/version-aliases.json`.

## Design
`pending = local repository versions - recorded history versions`, exact 14-digit match only.
- **Local versions:** filenames in `supabase/migrations/`. Anything not exactly `<14 digits>_<name>.sql` with a plausible date is a *finding* (never ignored); two files with the same version are a finding naming both files.
- **Recorded versions:** the `version` field of the Stage B captures (`stage-b-20261016/prod_catalog_history.json`, `dev_catalog_history.json`). Malformed or duplicate recorded values are findings.
- **Aliases and Case 43:** `version-aliases.json` documents the three alias relationships and the withdrawn Case 43. They are annotations: an aliased version stays in the pending list. An alias that contradicts the data, a withdrawn version present in the repository, or one recorded in a history are findings.
- **Optional annotation:** the Stage B classification CSVs, summarised for the current pending set (rows no longer pending are listed).
- **Failure behaviour:** any finding prints `FAILED SAFELY` and exits 1; unreadable input exits 2. Output is sorted and independent of input order.
- **Why a companion file:** the replay tool's job is guarded database replay; putting file/CSV logic there would widen its surface. The calculator requires only `fs` and `path`.
- A missing history row is not proof that SQL effects are missing; this is not schema equivalence (Stage D).

## Results (current working tree after C3)
| | Expected | Actual |
|---|---|---|
| Repository files | 386 | 386 |
| Production recorded / pending | 277 / 109 | 277 / **109** |
| Development recorded / pending | 58 / 329 | 58 / **329** |

Findings: none. Warnings: two files carry a doubled `.sql.sql` extension (`20260816221636_...sql.sql`, `20260816222905_...sql.sql`); their versions are unambiguous and both are recorded in Production, so they are valid exact versions. (My first run treated `.sql.sql` as malformed and produced 384/327; I corrected that rule, since the version is unambiguous, and kept it as a visible warning.)

Composition of the pending sets: Production 109 = 40 baseline + 23 October + 46 other; Development 329 = 39 baseline + 23 October + 267 other. All 23 October versions are pending in both. Stage B counts (110 and 330) differ by exactly the withdrawn Case 43, reported as "no longer pending". Every current pending version has a Stage B classification (0 unclassified).

## Explicit treatment
- **Case 41** (`20260305203528`, Prod recorded `20260305205811`) and **Case 42** (`20260407203226`, Prod recorded `20260408200431`): both repository versions are pending on Production; the alias records the related recorded version (which also has its own local file). Not removed.
- **Case 43** (`20260407211122`): absent from the repository, not recorded in either history, not pending; becomes a finding if it reappears or gets recorded.
- **Development `20260814002658`**: recorded without a local file (the only such version); local `20260814120000` stays pending, annotated.
- **Development versions whose effects exist but have no history row** (Stage B `HISTORY_ONLY_*` classes, 290 of the 329) remain pending by exact version; the classification summary shows them without removing them.

## Tests
`migrationPendingSet`: 54 passed, 0 failed, 0 skipped (covers: normal, empty history, reconciled history, recorded-only, duplicate local, duplicate recorded, malformed filenames/versions, aliases and contradictions, Case 43 present/recorded/absent, deterministic ordering, classification summary, replay-tool safeguards unchanged, static no-network/no-database checks, and evidence checks against the real tree and captures). `migrationReplaySafety`: 144 passed. `recoveredMigrationFiles`: 63 passed.

## No hosted operations
The tool requires only `fs` and `path`; the test asserts the source contains no `child_process`, `net`, `http(s)`, `tls`, `dns`, `fetch`, `spawn`, `psql`, `process.env`, and that its only write is the optional `--out` report. No database or Supabase connection was opened in C5, and no Docker, WSL or Supabase CLI was used.

## Files
Created: `scripts/dev/migration-pending-set.cjs`, `src/lib/tests/security/migrationPendingSet.test.ts`, `audit/evidence/version-aliases.json`, `audit/evidence/c5-pending-sets.json`, `audit/evidence/c5-pending-versions.md`, `audit/evidence/c5-report.md`. Modified: `audit/step2-migration-audit.md` (section AB). No existing file otherwise changed.
