# Local allowlist migration executor (Stage E2G) - LOCAL SCRATCH ONLY

**Not authorized for any hosted project.** This tool exists to rehearse the allowlist execution design on disposable local PostgreSQL databases. It must not be pointed at the Development or Production Supabase projects, and it is built so that it cannot be, without changing its code.

## What it does
- `build-allowlist.cjs` turns the E2C manifest (`audit/evidence/e2c-proposed-execution-manifest.csv`) into a reviewable JSON allowlist bound to **one git commit** and to the **SHA-256 of each file's LF-normalised text**, the expected base history (count, hash of the sorted versions, latest), the deny list (withdrawn Cases 41, 42, 43) and a document hash.
- `local-migration-executor.cjs plan|run|verify`:
  - reads each file with `git show <commit>:<path>`, normalises CRLF to LF, and requires the hash to match and the working tree to agree;
  - never lists the migrations directory to decide what to run; work = allowlist items minus ledger rows, in allowlist order;
  - refuses unknown, withdrawn, modified or unexpected input, a ledger that differs from the verified expectation (extra/missing base rows, rows for withdrawn versions, wrong kind, wrong hash, no audit evidence) and a broken audit chain;
  - never executes Cases 41, 42, 43 or the nine omitted versions (hard-coded, independent of the allowlist);
  - runs each file in ONE transaction together with its ledger row (`begin; advisory lock; lock_timeout; statement_timeout; <file>; insert ledger; commit`);
  - records history-only items (kind `history-only`) only when every `record_after` version is executed and the read-only `predicate_sql` is true;
  - writes an append-only, hash-chained audit store (`audit.jsonl`) that separates `item_start`/`item_end` (real execution) from `history_only` events, and different ledger markers (`-- BPC-LOCAL-EXECUTOR executed ...` versus `... history-only NOT EXECUTED ...`);
  - requires `--acknowledge-older-than-latest N` when N allowlisted versions are older than the latest recorded version, and `--allow-stop-in-critical-window` to pause inside the critical window.

## Hosted-target protection (enforced in code, not by a prompt)
1. Before any connection: host must be exactly `127.0.0.1`; database name must match `^bpc_exec_[a-z0-9_]{1,40}$`; unknown options (so no `--password`, `--conninfo`, `--url`) are refused; any option value, allowlist text or relevant environment variable containing a Supabase host, pooler, connection-string, `sslmode=`, `password=`, `host=` or either project reference is refused; `DATABASE_URL`, `SUPABASE_*`, `PGPASSWORD`, `PGPASSFILE`, `PGSERVICE*`, `PGHOSTADDR`, `PGSSL*` in the environment are refused; a non-loopback `PGHOST` is refused; the allowlist must say `environment: local-scratch`.
2. psql is started with a minimal environment, `PGSSLMODE=disable`, `-w` (never prompts for a password) and explicit loopback arguments.
3. After connecting and before any write: the server must report a loopback `inet_server_addr()`, the connection must not use TLS, and the database must carry the ownership comment `bpc-migration-executor-scratch:v1`.
Hosted Supabase requires TLS and a password, so a hosted connection cannot even authenticate through this path.

## Supported scope (and not)
Local scratch databases whose ledger is `supabase_migrations.schema_migrations(version, name, statements)`. Not supported: any hosted project, general migration discovery, rollback of committed files, privilege management, Supabase CLI integration, bundled deployment of Edge Functions.

## Tests
`audit/evidence/tools/e2g_executor_tests.py` (black-box, uses the evidence fixtures); results in `audit/evidence/e2g-executor-test-results.json`.

## E2H additions
- **Dependency metadata is validated before any connection.** Every `requires` entry must be an earlier executable item of the same allowlist (`dependency-missing`, `dependency-order` refusals, self-dependencies included); `record_after` entries must be executable items. `prod58-dependencies.json` holds the audited prerequisites of the 58 items (59 edges, from `audit/evidence/tools/e2h_dependency_audit.py`, validated by leave-one-out runs); `build-allowlist.cjs --dependencies-json` merges it. Dependencies that change only the *final state* (redefinitions) cannot be enforced by PostgreSQL: the allowlist order and the final-state comparison protect them.
- **Executed ledger rows store the exact LF SQL** as `statements[2]` (marker in `statements[1]`); the run is refused if the stored text's hash differs from the allowlisted hash. History-only and attestation rows hold a single SQL comment (no executable SQL).
- **Three kinds, kept apart:** `execute` (executed), `history-only` (NOT EXECUTED, basis), `attestation` (NOT EXECUTED, attested_by / attested_at / scope / not_proven). An attestation without those fields is refused; an attestation or history-only row without audit evidence is refused.
- **Audit store:** invalid JSON, edited, reordered or inserted records are refused; every command prints `audit_head` and `audit_records`; `--expect-audit-head HASH` refuses a store that no longer contains that head (truncation or replacement). A run that never wrote `run_end` is reported as `prior_run_incomplete` by the next run.
- A manifest `file` must start with its `version`; `--stop-after` must name an executable item.
- **Step 2 final (restart safety):** history-only and attestation records now write a `record_start` audit event before the ledger insert. A kill between the commit and the completion event no longer leaves an unexplainable row: the row is accepted through its `record_start` and the missing completion event is reconciled on the next run (`reconciled_after_crash`). A ledger row with no audit event of any kind is still refused.
