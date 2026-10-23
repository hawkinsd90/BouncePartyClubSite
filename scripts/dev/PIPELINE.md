# Verification pipeline (scripts/dev)

One page for everyone who runs tests or mutation testing on this machine (several Claude sessions share it).

## Everyday commands

| Command | What it does |
|---|---|
| `node scripts/dev/verify.cjs` | The default. Type check + lint + build alongside the tests, then both mutation suites. Everything that did not change since it last passed is **skipped**; the output says how many were reused / run. |
| `node scripts/dev/verify.cjs --quick` | Static checks and tests only (no mutants). |
| `node scripts/dev/verify.cjs --plan` | Says how many mutants the current files would rerun. Runs nothing. |
| `node scripts/dev/verify.cjs --full` | Everything from scratch (tests, mutants, plain tsc/eslint), then records the results so the next default run is cheap. About two hours when the machine is busy. Use it for a final acceptance, not for every change. |
| `node scripts/dev/run-tests.cjs [filter...]` | Just the tests; unchanged passing ones are skipped. `PARALLEL=n` (default 3) sets how many database-free files run at once. |
| `node scripts/dev/run-tests.cjs --changed` | Only the tests that depend on files git sees as changed (since HEAD, or `--changed=<ref>`), plus the ones that failed last time. The everyday command while editing. |
| `node scripts/dev/run-tests.cjs --failed` | Only the tests whose last recorded run failed: the fix-and-rerun loop. |
| `node scripts/dev/run-tests.cjs --full` | Ignore the stored results, run everything, then record the results. |
| `node scripts/dev/mutation-runner.cjs scripts/dev/<suite>-mutants.cjs` | One mutation suite. `PLAN=1`, `ONLY=<regex>`, `ONLY_FILE=<regex>`, `CHANGED=1`, `NO_CACHE=1`, `PROFILE=1`. |

## What is reused, and when it is not

- **Tests** (`test-cache.cjs`): a file is skipped only if its last run *passed* under the same key: its text, every file it imports or reads, the migrations (for tests that read them), the scratch databases it uses, and the directories it scans (a test that reads `src/` depends on `src/`, not on the whole repository; only 2 tests are whole-tree dependent; folders a test creates itself under the system temp directory do not count); not older than 24 h. A failing test is never skipped. A failure that happens with exactly the inputs of an earlier pass is labelled **flaky or environmental** in the output.
- **Mutants** (`mutation-runner.cjs`): a KILLED verdict is reused while the mutated source and the test that killed it are unchanged. Moving or renaming files does not invalidate it.
- Both are a shortcut, not a proof: they cannot see a path a test builds at run time, or a database changed by hand. `--full` is the safety net.
- The caches are in `node_modules/.cache/` and are shared by every session; saving merges into what is on disk.

## Habits that keep it fast

- **Leave the cache on.** `CACHE_OFF=1` (and `NO_CACHE=1` on every run) throws away the whole benefit: nothing is reused and, with `CACHE_OFF`, nothing is recorded for the next run. A full run with the cache off took 466–519 s; the same suite with the cache warm and nothing changed took 40–95 s. Use `--full` when you really need everything from scratch: it runs everything **and** records it.
- **While editing,** run `run-tests --changed` (or a filter), then `--failed` after a fix. Run the plain command (or `verify.cjs`) before you hand work over.
- **Do not run the whole suite after every small edit.** A change to a core library file legitimately reruns about half of the test time; most edits touch far less.
- The machine has 2 physical cores shared by every session. More parallelism does not help (3 database-free files plus 2 sync files at a time was the measured best), and it makes the heavy files 3–6 times slower each.

## The scratch database server

The database-backed tests need PostgreSQL with the `bpc_replay_*` databases. The pipeline has **its own** server (`scratch-server.cjs`, port 54339, data in `%LOCALAPPDATA%\bpc-pipeline-pg`), so nobody can replace it the way the shared one on 54329 gets replaced.

- It is started automatically when a run needs it. `node scripts/dev/scratch-server.cjs ensure` starts it **and builds missing databases** (about 13 minutes the first time). `status`, `start`, `stop` also exist.
- Each database is **stamped** with the migrations it was built from (`stamps.json` next to the cluster, nothing is added inside the databases). Every run's preflight compares the stamps with the repository and prints a WARNING when the databases are older than the migrations (a new migration does not rerun the database tests by itself; a rebuilt database does). `scratch-server.cjs ensure` rebuilds what is missing **or** older; `status` lists the differences. A rebuild takes its turn in the database-test queue.
- `PGPORT=<port>` points everything at another server instead.
- `scripts/dev/scratch-env.cjs check` verifies the server and all six databases in about a second; every run does this first and says what to do if something is missing.
- Tests that need the evidence-derived "shape" databases (`bpc_replay_prodpre`, `_prodshape`, `_devpre4`, `_devshape`; built from protected files outside Git) are reported as **SKIPPED, not passed**. The Step 3 acceptance (`security-scratch.cjs accept`) is the authority for them.

## Sharing the machine

- Database-backed test runs **take turns** (`queue-lock.cjs`, lock `bpc-db-tests.lock`); so do mutation runs (`bpc-mutation-runner.lock`). A second run waits and says so; it does not fail. `NO_QUEUE=1` skips the test queue.
- Which database each test file uses is defined once, in `security-scratch.cjs` (`envFor`, `DATABASES`); `scratch-env.cjs` re-exports it.
