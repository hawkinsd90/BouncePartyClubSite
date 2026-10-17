# E2E allowlist executor design (design only; nothing implemented, nothing run against a hosted database)

This turns the 20 requirements of `e2d-executor-requirements.md` (X-01 to X-20) into a concrete procedure. **No executor was written with hosted credentials, and none may be run against Development or Production until the owner approves the design, a rehearsal passes (X-20) and a separate execution approval names the environment, allowlist hash and phases.** "Evidence" cites local results from E2C, E2D or E2E.

## 1. Findings that shape the design
1. **Hashes must be over canonical bytes.** `d3-selected-manifest.json` stores SHA-256 of the *working-copy* bytes. In this Windows checkout (`core.autocrlf=true`) 45 of the 67 files contain CRLF while git stores LF; only 22 of 67 recorded hashes also match the LF-normalized text. On an LF checkout (CI, another developer) **45 of 67 hashes would not verify**. The allowlist must therefore hash the **LF-normalized** text, and the executor must read the bytes from the approved git commit (`git show <commit>:<path>`), not from a working tree that may be modified or re-encoded. The local test `e2e_lf_test.py` measured what execution of CRLF versus LF bytes changes: 58 files (37 with CRLF) run both ways on scratch clones gave **identical tables, columns, constraints, indexes, triggers, policies, default ACLs, publications, Storage buckets and row digests; the only difference is carriage returns inside 19 of 116 public function bodies, which disappear when `chr(13)` is removed**. LF bytes are also the form Production's recorded function bodies have (D3 finding F3), so the executor sends LF.
2. **The ledger has three columns and no audit trail.** `supabase_migrations.schema_migrations` in both captures has exactly `version text`, `statements text[]`, `name text`: no timestamp, operator, hash or kind. Independent audit evidence therefore has to live outside that table (requirement X-16), and the `statements` content cannot carry proof by itself.
3. **A critical window exists in the 58-version path.** From E2D's per-step probes: only the start state and the stop points from `20261012120000` onward are no wider (anonymous-callable functions and anonymous-writable tables) than the starting state; **40 stop points, `20260716151458` to `20261011120000`, are wider** (functions peak at 83 before `20261007120000`; RLS is enabled on every anonymous-writable table at every step). A halt inside that block leaves a wider anonymous surface than either the start or the finished release.
4. **No file needs special transaction handling.** A static scan of the 58 files found no top-level BEGIN/COMMIT/ROLLBACK, no non-transactional statement and no CREATE EXTENSION (`e2d-txscan.json`).
5. **Privilege needs are modest but not locally testable.** The 58 files touch platform-owned objects as follows (static scan, `tools/e2e_priv_scan.py`; owners from the Production capture): `storage.objects`/`storage.buckets` (owner `supabase_storage_admin`) in 5 files; a trigger on `auth.users` (owner `supabase_auth_admin`) in 1 (`20261016120000`); `ALTER DEFAULT PRIVILEGES` in 1 (`20261018120000`, no recorded precedent in Production's history); a reference to a `supabase_*` role in 1 (`20261013120000`); SECURITY DEFINER function creation in 30; no CREATE EXTENSION, no vault, no pg_net. Production's recorded history shows precedent for storage DDL (20 of 277 recorded versions) and `auth.*` references (25 of 277). All 68 public functions and all `public` application tables in the capture are owned by `postgres`. The local rehearsals ran as a PostgreSQL superuser with stubbed platform schemas, so **they cannot prove the hosted `postgres` role is sufficient** for the five storage files, the `auth.users` trigger or the default-privileges statement.
6. **The CLI's own rules are not relied on.** The CLI's refusal to push pending versions older than the latest recorded one is documented behavior that this project has not tested; the executor does not use the CLI at all (X-04, X-05).

## 2. Inputs
- **Allowlist document** (shape in `e2d-executor-requirements.md` section 3) built from an owner-reviewed manifest: for Production `e2c-proposed-execution-manifest.csv` after the owner's final D-1 approval; for Development a manifest derived from `e2e-development-manifest.csv` after the evidence phase. Each item: order, version, file, **LF-normalized SHA-256**, kind (`execute` | `history-only` | `attestation`), phase, preconditions, `record_after`, and for history-only a machine-checkable predicate (section 5). A `deny` list (the withdrawn index). A document hash computed over the canonical JSON.
- **Source commit:** the git commit hash containing the files; the executor reads every file with `git show`/`git cat-file` from that commit and refuses to run if the working tree is not that commit (X-02).
- **Approval artifact:** a small signed or owner-typed record that binds *environment* (project reference), *allowlist document hash*, *commit hash*, *phase list*, *expiry* and *operator* (X-19, section 7).
- **Connection:** supplied by the operator at run time through a prompt or a process environment variable; never stored in the allowlist, logs or the repository (X-18).

## 3. State machine and phases
| Phase | What it does | Entry preconditions (checked, logged) | Stop-safe at its end? |
|---|---|---|---|
| P0 Verify | read-only: connect with `default_transaction_read_only=on`, compare history and catalog with the manifest's expected pre-state (counts, latest version, hashes of live definitions the plan assumes), run the data preflight set, confirm backups | approval artifact valid; fresh capture inside 24 h | yes (no write) |
| P1 Record-first | write only the history-only records whose predicate is already true (the net-zero pair, `20261010110000` for Production; verified H versions for Development) | P0 passed | yes |
| P2 Ordinary block A | execute allowlisted versions before the critical window | P1 done | yes (state no wider than start up to `20260715214053` for the Production 58) |
| P3 Critical window | execute `20260716151458` to `20261011120000` **contiguously**, writing superseded-version records right after each superseder succeeds | P2 done; owner has confirmed the window (section 6) | **no** |
| P4 Lockdown block | execute `20261012120000` onward | P3 done | yes from `20261012120000` |
| P5 Verify | read-only: ledger equals allowlist (58 executed, 9 history-only for Production), 37 catalog assertions, 19-category comparison with the approved reference, security probes, anon-callable function list equals the expected 6 | P4 done | yes |
For Development the plan differs (section 9 of `e2e-development-manifest.csv` logic): P2 to P4 contain only what the evidence phase proves necessary; the 23 October migrations form the Development critical block and stay behind their gate.

## 4. Algorithm (stateless, resumable)
```
verify approval, environment, commit, document hash, deny list      # refuse on any mismatch
acquire a session-level advisory lock (one executor per database)   # second instance refuses
loop:
    led  = read ledger (version -> kind from the external audit store, cross-checked with the table)
    validate(led):  an execute item may only be 'executed'; an omitted item only 'history-only';
                    no row for a denied version; no row for a version outside the allowlist;
                    mismatch => STOP (never skip)                          # tested in E2D guards
    for each history-only item with predicate true and preconditions met: write the record (own transaction)
    item = first allowlist 'execute' item not in led, in allowlist order    # never "pending by version"
    if none: break
    check phase boundary and preconditions; verify LF-normalized hash of the bytes read from the commit
    BEGIN; SET LOCAL lock_timeout/statement_timeout/search_path; <file>; INSERT ledger row; COMMIT
    on any error: ROLLBACK, write the failure to the audit store, STOP
post-run verification (P5)
```
Properties: ordering is by allowlist position, independent of `max(version)` (31 of the 58 are older than `20260928172217`); omitted versions are never selectable; a restart recomputes from the ledger; a second run on a finished database does nothing.

## 5. History-only items and attestations (D-6)
- **Execute** rows carry an executed marker plus the allowlist hash; **history-only** rows carry a marker "NOT EXECUTED" plus basis; **attestation** rows carry "qualified owner attestation", who, when, what was not proven. The marker is in `statements` for humans, but the authoritative distinction is the external audit store (finding 2).
- Each history-only item has a **predicate** the executor evaluates read-only immediately before writing: for the net-zero pair "policy `Anon can insert portal shortlinks` absent on `invoice_links`"; for `20261010110000` "column `orders.customer_approved_at` exists"; for a superseded version "all superseders are `executed` in the ledger". For Development H versions the predicate is the E2A statement-level presence check, regenerated from a fresh capture. Without a true predicate the item is not written (X-09).
- Attestation items never have a predicate; they require an explicit owner approval line in the approval artifact.
- A history-only or attestation row is never counted as "applied" by any report (X-08).

## 6. The critical window
Because 40 consecutive stop points are wider than the start (finding 3), P3 is designed to be run **without pausing** and the executor refuses to start P3 unless: the previous phase is complete, a restore point exists, the owner is present (interactive confirmation), and an agreed recovery action for a failure inside P3 is on record. Recovery actions to choose in advance (owner decision U-E2E-5): (a) resume immediately after fixing the cause; (b) apply a prepared, reviewed containment script (for example revoking anonymous EXECUTE on the functions created so far, a hosted write that needs its own approval); (c) restore from the backup/point-in-time. The executor itself never runs (b) or (c).

## 7. Owner approval and hosted writes (X-10, X-19)
- No hosted write without an approval artifact that names: project reference, allowlist hash, commit hash, phase list, expiry (recommended: same day) and operator. The executor prints the plan (versions, hashes, kinds, phase) and requires the operator to type the allowlist hash and the phase name before each phase; there is no flag that skips the prompt.
- P0 and P5 are read-only and can be authorized separately from P1 to P4.
- A dry-run prints the ordered plan and diffs it with the allowlist (X-15) and is the only mode that needs no approval artifact beyond a read-only connection approval.

## 8. Transaction boundaries, ledger writes, restart, rollback
- **One transaction per file, ledger row inside it.** Sending the whole file in one simple-query message executes it as one implicit transaction in PostgreSQL (documented behavior), but the executor should use an explicit `BEGIN ... COMMIT` and insert the ledger row before `COMMIT`; this removes the crash gap between "applied" and "recorded" for all 58 files (finding 4). The external audit record is written after COMMIT; a crash between them is detected on restart by comparing the ledger with the audit store and is resolved by recording the missing audit line, never by re-running the file.
- **Session settings:** `SET LOCAL lock_timeout` (so an ACCESS EXCLUSIVE statement on `orders` or `payments` fails fast instead of queueing behind traffic), `statement_timeout`, a fixed `search_path`, and the role in use logged.
- **In-flight marker:** the audit store records "starting version V, hash H" before `BEGIN`. On restart a marker without a matching ledger row means the transaction did not commit (rolled back by the server when the session died); the executor may start that version again. A ledger row without an "end" line is completed in the audit store. Neither case needs the D4 re-application classes, because the file ran in one transaction.
- **Rollback:** automatic and complete for the failing file (E2D atomicity test: 4 of 4 injected failures left no catalog or data change). There is **no automatic reverse** of committed files; recovery is forward (resume), containment (section 6) or restore. The executor never attempts compensating SQL.
- **Local test on bytes (finding 1):** `e2e_lf_test.py` ran the 58 files once as checked out (CRLF where present) and once LF-normalized on scratch clones; result in `e2e-report.md` section 5. The executor will send LF-normalized bytes read from the commit; the rehearsal must be re-run in that exact mode (X-20).

## 9. Privileges and minimal access
- Needed: ownership of the `public` objects it changes (the hosted `postgres` role owns all of them in the capture), the ability to create policies on `storage.objects`, rows in `storage.buckets` and a trigger on `auth.users` (platform-owned), `ALTER DEFAULT PRIVILEGES` for its own role, and `INSERT` on `supabase_migrations.schema_migrations`. Read-only phases need only `CONNECT` and catalog `SELECT`.
- Recommended: one **named, time-limited run role** or the project's `postgres` credentials supplied for the run only, rotated afterwards (owner decision U-E2E-6). The temporary `cli_login_postgres` role created by earlier CLI use must not be reused and should be removed (SEC item). Creating a dedicated role is itself a hosted write needing approval.
- **Unverified:** whether hosted `postgres` can perform the five storage files, the `auth.users` trigger and the default-privileges statement. The precedent in the recorded history suggests the first two work (20 and 25 recorded versions touch those schemas); the third has no precedent. Resolve by a read-only privilege check (`has_table_privilege`, `pg_has_role`, ownership lookups) in P0 and by a Supabase-hosted rehearsal on a throwaway project (not Development or Production) if the owner wants it.
- Least privilege inside the run: the executor never changes roles, never uses `SET ROLE`, never grants itself anything, and logs the effective role at the start of each phase.

## 10. Older-than-recorded versions without a bulk push
The allowlist order replaces the CLI's rule. The ledger rows for older versions are simply inserted. After the run the table holds versions that precede its own latest version; nothing in the executor reads `max(version)`. What a *future* CLI would do with such a table is documented-not-tested, so the post-run verification compares the ledger with the allowlist and does not rely on any CLI output. For Development the recorded alias `20260814002658` (no repository file) is a case where the CLI is documented to complain about a remote version missing locally; that is a reason to decide D-5, and it does not affect the executor.

## 11. Rehearsal required before any hosted use (X-20)
On a scratch restore of the Production snapshot (and, for Development, of the captured Development dump): full run; interruption at every phase boundary and at every superseder; kill of the database session mid-transaction; second concurrent instance; tampered file, tampered ledger, withdrawn and unknown versions; LF-normalized bytes from a git commit; a non-superuser run role that owns `public` (to the extent a local clone can imitate the platform ownership); failure fixtures (D4 B1 to B5) driven through the executor; verification of the audit store against the ledger.

## 12. What this design deliberately does not settle
The implementation language/tool; where the audit store lives and who can read it; the exact marker strings; whether the approval is an interactive prompt or a signed file; the recovery action inside the critical window; the run role. They are decisions U-E2E-3 to U-E2E-6 in `e2e-unresolved-decisions.md`.
