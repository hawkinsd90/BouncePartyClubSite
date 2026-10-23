# Project notes for Claude

## Tests, mutation suites and checks

How to run them, what each means and what to do when something looks wrong: [docs/testing.md](docs/testing.md).
How the cache and the scratch database server work: [scripts/dev/PIPELINE.md](scripts/dev/PIPELINE.md). Read the first before running anything;
do not rely on memory of older flags or of what a prompt says.

Rules for how Claude uses them:

- Use the commands in the guide's "Which command, when" table: `--changed` while editing, plain `verify.cjs` before handing work over.
- A prompt that says "uncached" or "from scratch" means `--full`, not `CACHE_OFF=1`. Asking for `--full` is safe: the tools run from scratch only when one is due and otherwise run incrementally with a NOTE. Report what the output says (reused and ran counts); do not describe an incremental run as uncached. Do not set `FORCE_FULL=1` unless the user says to override that. Do not set `PARALLEL=6` or `CACHE_OFF=1`.
- Several sessions share one machine and one scratch database server: a "waiting for ..." line is normal. Do not delete the lock files in the temp folder or the databases on port 54339.
- When a run prints a WARNING that the scratch databases are older than the migrations, rebuild with `node scripts/dev/scratch-server.cjs ensure` before trusting database test results.
- A test reported SKIPPED did not run. Say so; never report it as passed.
- Do not edit files in `scripts/dev/` that belong to another session's task without being asked.
