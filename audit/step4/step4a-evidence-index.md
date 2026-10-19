# Step 4A evidence index

Commit evaluated: `ecdda40cb2e858bb21469ce7fbc55fbfc5a05d6a`. Hosted observations were taken 2026-10-18 through read-only tooling and contain no secrets, customer rows or credentials.

## Hosted Development, read-only (project `srxunxiytojjsuhcmzjg`)
| Observation | Method | Result summary |
|---|---|---|
| Migration ledger | `list_migrations` | 58 rows, max `20260929161925`; identical to `audit/evidence/derived/dev-ledger-versions.txt` |
| Edge Functions | `list_edge_functions` | 42 functions, versions, `verify_jwt`, update times (embedded in `edge-function-deployment-matrix.csv`) |
| `record-consent` source | `get_edge_function` | single file, empty content |
| Security/catalog snapshot | one `SELECT jsonb_build_object(...)` over `pg_catalog`, `pg_policies`, `storage.buckets`, `pg_default_acl`, `pg_extension`, `pg_publication_tables`, `pg_roles`, and one `EXISTS` on `auth.users` for the demo e-mail (boolean) | see readiness report section 2; query text is reproduced in the runbook P0 (b) description; no row data returned |
| Not run | the demo-account password check (`step3b-credential-check.sql`): owner-run only; no credential was tried | |

Production: not contacted.

## GitHub (read-only)
`git ls-remote --heads origin`: `Dev` `b2cd801`, `main` `b79ca48`, `backup-main-before-rollback` `8edf5d2`.

## Local validation
| Command | Environment | Class | Result |
|---|---|---|---|
| `git rev-parse HEAD`, `git status --porcelain -uall`, `git branch -vv`, `git rev-list --count`, `git diff --name-status origin/Dev HEAD ...` | local repo | local read | as in readiness report |
| clean clone of `ecdda40` + `build_development_plan.py`, `build_execution_manifest.py`, `build_production_plan.py candidates`, `build_production_plan.py manifest` | local temp clone (deleted) | local | regenerate; only EOL differences |
| `python audit/evidence/...` matrix builders (scratchpad `build4a.py`, `tests4a.py`) | local | local write to `audit/step4/` | 3 CSVs generated |
| `node scripts/dev/security-scratch.cjs accept` | local PostgreSQL 18 scratch cluster | local | PASS at Step 3 close on this HEAD (143,213 assertions); not re-run in 4A because no code changed |
| `git grep` of `src` at `HEAD` vs `origin/Dev` for the 11 new function names | local | local read | 0 call sites in the deployed frontend, 2-6 files each in HEAD |

## Supporting repository documents
Step 2: `audit/step2-completion.md`, `audit/step2-compatibility-and-handoff.md`, `audit/development-hosted-procedure.md`, `audit/development-execution-approval-package.md`, `audit/development-execution-manifest.csv`, `audit/development-execution-batches.json`, `audit/development-execution-deny.json`, `audit/development-migration-manifest.csv`, `audit/production-migration-manifest.csv`, `audit/evidence/e2h-security-recovery-plan.md`, `audit/evidence/e2j-development-release-gates.md`, `audit/evidence/derived/README.md`.
Step 3: `audit/security/step3-security-issue-register.csv`, `step3-step4-deployment-dependencies.md`, `step3b-owner-actions.md`, `step3b-verification-rules.json`, `step3-acceptance-manifest.json`, `step4-development-containment-end-state.sql`.

## Known limits of this evidence
Local PostgreSQL is 18 while hosted is 17.6. Netlify, secrets, backups/PITR, provider consoles were not observable. The 103 earlier feature commits were inventoried, not reviewed line by line. The hosted function sources other than `record-consent` were not read in 4A (P0 does it, one at a time, before any overwrite).

## Step 4A.1 additions (2026-10-18)

### Hosted Development, read-only
| Observation | Method | Result summary |
|---|---|---|
| Operator capabilities | one `SELECT` over `pg_roles`, `has_*_privilege`, `pg_has_role`, `pg_class` owners, `pg_event_trigger`, `current_setting` | `postgres`: not superuser, BYPASSRLS, CREATEROLE; owns `public`, the ledger and all public objects; **not** a member of `supabase_admin`, `supabase_storage_admin`, `supabase_auth_admin`; full table privileges on `auth.users` and the storage tables by grant (grantor the owning admin role); `storage.objects` and `buckets` owned by `supabase_storage_admin`; cannot CREATE in schema `storage`; can SET ROLE to `anon`, `authenticated`, `service_role`; `supautils` loaded with `supabase_privileged_role`; 6 event triggers; `statement_timeout` 2 min |
| Catalog fingerprint | the fingerprint statement of `lib/fingerprint.cjs` (SELECT) | digests equal to the local Development base for every category (public functions 82, relations 69, columns 804, constraints 235, indexes 237, triggers 37, policies 228, publications 8, buckets 9, schema ACLs; extensions compared as a set) |
| Plan and project | organization and project lookups | Pro plan; PostgreSQL 17.6; ACTIVE_HEALTHY; us-east-1 |
| Supabase branches | branch lookup | branch record "Dev", `git_branch: Dev`, default, `MIGRATIONS_FAILED` since 2026-06-02 |
| Public site | HTTP HEAD/GET of `https://dev.bouncepartyclub.com/` and its JS bundle | Netlify; bundle targets the Development ref (4 hits), no Production ref, none of the 11 new function names |

### Local commands (all against local scratch PostgreSQL `127.0.0.1:54329`, databases `bpc_exec_*`)
| Command | Result |
|---|---|
| `dev-migration-executor.cjs build --commit ecdda40... --out skeleton.json` | 28 items |
| `... seal --package skeleton.json --template bpc_replay_dev_s3 --db bpc_exec_seal --out sealed.json` | first attempt stopped at `20261016120000` (empty `auth.users` in the template: fixture, not a defect); sealed after adding one synthetic user |
| `... run/verify` on a fresh clone with the sealed package | 28 executed, ledger 60 -> 88, final fingerprint equals the sealed one; equals the Step 3 accepted `bpc_replay_devshape` in every category except the schema ACL (S11 effect) |
| `node scripts/dev/hosted-executor/rehearse.cjs --package audit/step4/executor/dev-package-oct-s3b.sealed.json --template bpc_replay_dev_s3 --out audit/step4/executor-rehearsal-results.json` | see `executor-rehearsal-results.json` and `.hostlike.json` |
| `node scripts/dev/hosted-executor/build-gate.cjs` | writes `s11-gate-checks.sql` (20 checks) |
| `node scripts/dev/run-tests.cjs devMigrationExecutor` | static and unit checks (no database) |

Limits: local PostgreSQL 18; the hosted transport is exercised by refusal paths only; Netlify and Supabase integration settings, backups and secrets are unobservable here.

## Step 4A.2 additions (2026-10-18)

### Hosted and public, read-only
| Observation | Method | Result |
|---|---|---|
| WAL archiving / replication | one SELECT of `archive_mode`, `archive_command`, `wal_level`, `pg_replication_slots` | `archive_mode on` with a WAL-G push command, `wal_level logical`, 0 slots (backups and PITR are NOT proven) |
| Role memberships | one SELECT over `pg_auth_members` | `postgres` is a member of `supabase_privileged_role`, `pg_monitor`, `pg_read_all_data`, `pg_signal_backend`, anon, authenticated, service_role, authenticator; `cli_login_postgres` is a member of `postgres`, expired 2026-10-16; privileged role members: `postgres`, `supabase_etl_admin` |
| Demo account (counts and booleans only) | one SELECT | exists, role master, last sign-in 92 days ago, not banned, 2 other masters, 8 other users |
| Storage policies | same SELECT | the 6 recorded names equal the CREATE POLICY names of recorded migrations `20260717110829` and `20260723174017` |
| GitHub: repository | `GET api.github.com/repos/hawkinsd90/BouncePartyClubSite` (unauthenticated) | public |
| GitHub: check runs for 8 `Dev` commits, `main` `b79ca48`, `8edf5d2` | `GET .../commits/{sha}/check-runs` | Supabase Preview ran on every Dev push, failure "Remote migration versions not found in local migrations directory"; skipped on the unassociated branch |
| GitHub: commit statuses and deployments for `b2cd801` | `GET .../status`, `.../deployments` | none (no Netlify evidence) |
| Supabase and npm documentation | documentation search; `npm view` | backup and integration behavior as cited in `d02`/`d03`; react-router-dom 6.x latest 6.30.6, qs 6.16.1, ws 8.22.0 |

### Local
| Command | Result |
|---|---|
| fresh `executor build --commit ecdda40...` compared with the sealed package | 28 items identical (order, version, file, name, SHA-256, class, dependencies, rules), deny list and containment equal |
| clean clone of `ecdda40` + the new files committed in two local commits (throwaway clone, deleted) | 60 unit checks pass at the new HEAD; tampering with one migration file makes 3 checks fail |
| canary `g16-storage-canary.sql` on a scratch copy as owner and as a non-owner | owner: `BPC-CANARY-OK`, policy digest unchanged; non-owner: `must be owner of table objects`, digest unchanged |
| `node scripts/dev/run-tests.cjs devMigrationExecutor` | see final report |

## Step 4A.2b additions (2026-10-19): connectors
| Observation | Method | Result |
|---|---|---|
| Netlify sites, team, current deploys | connector read operations (`get-projects`, `get-teams`, `get-project`, `get-deploy`, `get-team-env-vars` filtered to one key) | see `d03` section "Step 4A.2b"; no write operation was called |
| Supabase projects and branches | second connector `list_projects`, `list_branches` (Dev and Prod) | both projects have a GitHub-linked branch at `MIGRATIONS_FAILED` |
| GitHub `Dev` tip | `git ls-remote --heads origin` and the public commit API | `aeb708e` (one commit after `b2cd801`); local `Dev` 103 ahead, 1 behind |

## Step 4A.3 additions (2026-10-19)

### Hosted and public, read-only
| Observation | Method | Result |
|---|---|---|
| Compute and data size | one SELECT of settings and size catalogs | `max_connections 60`, `shared_buffers 256MB` (Micro-class, inferred); database 27 MB; 500 Storage objects of about 898 MB in 8 buckets; 171 orders, 185 payments, 9 auth users |
| Stored provider settings | one SELECT returning key names and value *classes* only | Stripe publishable and secret keys test-class; Twilio SID, token, from number and a Resend-style key present (classes only, no values) |
| Hosted `send-sms-notification` source | `get_edge_function` (v6) | unauthenticated, no outbound guard |
| Price quotes | connector `get_cost` | new project USD 10/month; branch USD 0.01344/hour |
| Remote refs | `git ls-remote --heads origin` | `Dev` `aeb708e`, `main` `b79ca48`, backup branch `8edf5d2` |
| GitHub commit screenshot | public commit API; owner screenshot | `aeb708e` removes one stray file |
| Documentation | Supabase docs search | backups, PITR, `db dump` schema exclusions, GitHub integration |

### Local
| Command | Result |
|---|---|
| `python -I scripts/dev/hosted-executor/cli-oracle.py --template bpc_replay_e2i_devbase --db bpc_sim_cli --work <throwaway dir> --out audit/step4/cli-oracle-results.json` | real Supabase CLI v2.104.0 against a local scratch database: see `standard-migration-recovery-plan.md` |
| `pg_dump -Fc` of the scratch database, `pg_restore` into a new scratch database | ledger (60 rows) and every fingerprint category identical with owners preserved |
| `git merge-tree --write-tree HEAD aeb708e` | clean tree, no conflict |
| `node scripts/dev/run-tests.cjs devMigrationExecutor` / jiti | 84 checks |
