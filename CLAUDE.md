# Project notes for Claude

## Running the tests and the mutation suites

Several sessions share one 2-core machine and one scratch PostgreSQL. The tools in `scripts/dev/` keep a content-addressed cache of
results, so unchanged tests and mutants are skipped. Details: `scripts/dev/PIPELINE.md`. Use them as intended:

| When | Command |
|---|---|
| While editing | `node scripts/dev/run-tests.cjs --changed`, then `--failed` after a fix, or `run-tests.cjs <filter>` |
| Before handing work over | `node scripts/dev/verify.cjs` (type check, lint, build, tests, mutants; everything unchanged is skipped) |
| Final acceptance, once per piece of work | `node scripts/dev/verify.cjs --full` (or `run-tests.cjs --full`, `NO_CACHE=1` on a mutation suite) |
| How much would the mutants cost? | `node scripts/dev/verify.cjs --plan` |

- **"Uncached" or "from scratch" means `--full`**, which ignores stored results and still records new ones. It does not mean `CACHE_OFF=1`.
  Do it once at the end, not after every edit: a cold suite is about 8 minutes, a cold mutation run about 1.5-2 hours; cached, usually minutes.
- **Do not set** `PARALLEL=6` (slower than the default 3 on this machine), `CACHE_OFF=1` (reuses and records nothing), or `NO_CACHE=1` on
  every mutation run (reruns all 395 + 218 mutants even when a few changed).
- Database-backed runs wait for each other (a "waiting for ..." line is normal, not a hang). Do not delete the lock files in the temp folder
  or the databases on port 54339.
- The scratch databases are rebuilt with `node scripts/dev/scratch-server.cjs ensure` (about 13 minutes, takes its turn in the queue). A run's
  preflight prints a WARNING when they are older than the migrations in the repository: rebuild when you see it.
- A test reported **SKIPPED** (`defaultPrivilegeMigration`) did not run; say so, never call it passed.
- Do not edit files in `scripts/dev/` that belong to another session's task without being asked.
