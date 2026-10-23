# Testing guide

How to check that the code still works: what each check does, which command to run when, and what to do when something looks wrong.
You do not need Claude to run any of this. The technical details (what exactly is cached, how the scratch database server works) are in
[`scripts/dev/PIPELINE.md`](../scripts/dev/PIPELINE.md).

## The checks in one minute

| Check | What it tells you | Command | Time |
|---|---|---|---|
| **Tests** (about 160 files in `src/lib/tests/`) | The code does what the tests expect: pricing math, payments, permissions, screens, the database rules | `node scripts/dev/run-tests.cjs` | 1-4 min when most results are reused, about 8 min from scratch |
| **Mutation suites** (`payment-mutants`, `pricing-mutants`) | The tests would notice if the code were wrong. The tool plants a deliberate bug (a "mutant"), runs the tests, and expects one to fail. A mutant no test catches is a **survivor**: a gap in the tests | `node scripts/dev/verify.cjs` (includes them) | minutes when reused, 1.5-2 hours from scratch |
| **Type check, lint, build** | The code compiles, follows the lint rules and builds for production | `npm run typecheck`, `npm run lint`, `npm run build` (or all through `verify.cjs`) | about 1-2 min |

Think of the tests as a smoke alarm and the mutation suites as the fire drill that checks the alarm works.

**Everything unchanged is skipped.** Each result is remembered together with the exact files it depended on. If none of them changed, the
result is reused, and the output says so ("reused from the cache N"). That is why a repeat run takes seconds, and why you should not
turn the cache off.

## Which command, when

| You are... | Run |
|---|---|
| Editing and want a quick check | `node scripts/dev/run-tests.cjs --changed` (only the tests your changes can affect, plus ones that failed last time) |
| Fixing a failure | `node scripts/dev/run-tests.cjs --failed`, or `node scripts/dev/run-tests.cjs <part of a file name>` |
| About to hand work over or commit | `node scripts/dev/verify.cjs` (type check, lint, build, tests and mutants; everything unchanged is skipped) |
| Not sure how long the mutants will take | `node scripts/dev/verify.cjs --plan` (says how many would run; runs nothing) |
| Asking for "everything from scratch" | `node scripts/dev/verify.cjs --full`. The tools decide whether that is really needed (see below), so it is safe to ask for at any time |
| Tests only, no mutants | `node scripts/dev/verify.cjs --quick` |

`--full` is what "uncached" or "from scratch" means. Do not use `CACHE_OFF=1` for that: it throws results away without remembering new ones.

### When a from-scratch run really happens

A from-scratch run is the safety net for what the cache cannot see, so it only needs repeating now and then. `--full` (and `NO_CACHE=1`) therefore check whether one is **due**, separately for the tests, each mutation suite and the static checks. It runs from scratch when:

- none has been completed yet, or the stored results it left behind are gone;
- the last one finished more than 24 hours ago (`FULL_MAX_HOURS` changes the limit);
- node, `package-lock.json` or the pipeline's own tooling changed since the last one;
- or you set `FORCE_FULL=1`.

Otherwise it runs the normal incremental way and prints a `NOTE:` saying why. Every reused result is matched to the exact files it depends on, and the output still says how many were reused and how many ran. Runs limited to some test files, or with `CACHE_OFF=1`, are left as asked.

## Reading the output

```
files 161 pass 160 fail 0 skipped 1
reused from the cache 90 (about 1687 s of recorded run time not spent), ran 70
SKIPPED (needs the evidence-derived databases ...): src/lib/tests/security/defaultPrivilegeMigration.test.ts
elapsed 217s
```

- **pass / fail**: a failing file is listed as `FAIL <file>` with the failed checks under it. A failing test is never reused; it runs every time until fixed.
- **reused / ran**: how much came from the cache. A first run after a big change legitimately runs a lot.
- **SKIPPED**: this test did **not** run (it needs databases built from protected evidence files that are not on this machine). It is not a pass. Do not count it as one.
- **flaky or environmental**: a test failed now but passed before with exactly the same inputs. Run it again; if it keeps failing, it is a real problem.
- **mutation line**: `mutants: 395 (395 from cache) survivors: 0 errors: 0`. Survivors should be 0. A survivor names the planted bug that no test caught; the fix is a new test, not changing the code.
- A line starting with **TIP:** means the run was started in a way that throws speed away; it says what to do instead.
- **WARNING ... older than the repository migrations**: see "The scratch databases" below.

## First-time setup, and after a reboot

The database tests need a local PostgreSQL (version 18, installed under `C:\Program Files\PostgreSQL\18`). They use their **own private
copy on port 54339**, with its data in `%LOCALAPPDATA%\bpc-pipeline-pg`. It listens on this computer only and never talks to Supabase,
Stripe or any hosted service.

- Nothing to do normally: the server starts by itself when a run needs it, including after a reboot.
- First time, or if a run says databases are missing: `node scripts/dev/scratch-server.cjs ensure` (about 13 minutes for all six databases).
- Check on it any time: `node scripts/dev/scratch-server.cjs status`.
- Stop it: `node scripts/dev/scratch-server.cjs stop` (the data stays).

## The scratch databases

Six databases (`bpc_replay_*`) are built by replaying the repository's migration files, each up to a different point. Each build is
**stamped** with the migrations it used. Every run checks the stamps and prints a **WARNING** when a database is older than the
migrations in the repository (for example after pulling or writing a new migration). Tests still run, but against an out-of-date
database, so rebuild when you see the warning:

```bash
node scripts/dev/scratch-server.cjs ensure
```

It rebuilds only what is missing or older (about 90 seconds per database; a new migration normally affects only `bpc_replay_full`).

## Habits that keep it fast

- Leave the cache on. Do not set `CACHE_OFF=1`. `NO_CACHE=1` and `--full` are safe to use: they only run from scratch when one is due (see above).
- Leave `PARALLEL` alone. The default (3) was measured fastest on this 2-core machine; 6 is slower.
- While editing, use `--changed` or a file-name filter. Run the whole thing before you hand work over, and `--full` once at the very end.
- A change to a widely shared file (for example `src/lib/database.types.ts`) legitimately reruns most tests. That is correct, not a fault.

## If something looks wrong

| You see | It means | Do |
|---|---|---|
| `waiting for ... (pid N)` | Another run is using the shared scratch databases; runs take turns | Wait. It is not stuck. If the other run is gone, a stale lock is taken over automatically |
| `PREFLIGHT FAILED` | The scratch server is not answering, or databases are missing | Run the command it prints (`scratch-server.cjs ensure`) |
| `WARNING ... older than the repository migrations` | The databases predate the newest migrations | `node scripts/dev/scratch-server.cjs ensure` |
| A test fails that you did not touch | Either a real regression, or a database out of date | Run the warning check above, then `run-tests.cjs <file>` again |
| A mutation survivor | A planted bug no test catches | Add or strengthen a test for that behaviour |
| `Gave up waiting` | The queue wait limit (2 hours) passed | Find what holds the lock (`%TEMP%\bpc-db-tests.lock` holds a process number), or try again later |
| Everything reruns after you changed one file | You changed something many tests depend on (see above), or a from-scratch run was due | Normal; the next run is quick again |

## Where things live

- `scripts/dev/run-tests.cjs`, `verify.cjs`, `mutation-runner.cjs`: the commands above.
- `scripts/dev/payment-mutants.cjs`, `pricing-mutants.cjs`: the planted bugs (add one when you add a rule worth protecting).
- `scripts/dev/PIPELINE.md`: the technical reference (what is cached and when it is not, the scratch server, sharing the machine).
- Cached results: `node_modules/.cache/` (safe to delete; the next run is just slower).
