# E2G prerequisites before any hosted use of the executor, and Development-specific limitations

**The executor is local-scratch only and is not authorized for Development or Production.** It refuses any non-loopback target in code (see `e2g-report.md` section 3). Nothing here authorizes lifting those protections; a hosted-capable executor would be a different, separately reviewed change.

## 1. What E2G proved and what it did not
| Proved locally (103 tests) | Not proved |
|---|---|
| exact allowlist bound to a commit; LF-normalized hashes; modified, unknown, withdrawn and omitted-version input refused | behavior against the hosted Supabase platform (TLS, pooler, roles, platform-owned schemas) |
| ledger/audit consistency checks; separate execution and history-only evidence; truthful record timing | hosted `postgres` privileges for `storage.*`, the `auth.users` trigger and `ALTER DEFAULT PRIVILEGES` |
| one transaction per file with the ledger row; rollback on failure; kill mid-transaction; restart; crash-gap reconciliation | server crash during commit; network failure; concurrent application traffic |
| failure inside and after the critical window; lock timeout; resumption to the intended final state | any containment that is safe for all roles (candidate containment altered privileges of 2 functions) |
| deliberate handling of the 31 older-than-latest versions (`--acknowledge-older-than-latest 31`) | what a future Supabase CLI does with a ledger holding versions older than its latest (documented, untested) |

## 2. Preconditions for a hosted-capable executor (all unmet)
1. **Owner approval of the design and of this implementation's behavior**, including the marker wording, the audit-store location and the LF hash form (U-E2E-3, U-E2E-4).
2. **A separately reviewed hosted-capable variant.** The local guard (loopback only, scratch name pattern, scratch marker, no TLS, no credentials) is deliberately incompatible with Supabase. A hosted variant must replace it with the opposite protections: an approval artifact binding project reference, allowlist hash, commit, phases and expiry; TLS required; read-only phases separated from write phases; credentials supplied at run time and never logged.
3. **Privilege verification** for the run role by read-only catalog queries (ownership of `public` objects, ability on `storage.objects`/`storage.buckets`, the `auth.users` trigger, default privileges) and, if the owner wants confidence, a rehearsal on a throwaway hosted project that is neither Development nor Production (U-E2E-12).
4. **Fresh read-only captures** inside the 24 h window of any write: schema, ledger (the expected base history must match: Production 277 rows ending `20260928172217`; Development 58 rows), containment inventory, backups and restore procedure (U-E2E-13).
5. **Production data preflight** (24 checks, never run) and the baseline per-statement evidence for the 15 versions with unprovable data statements (or labelled attestations).
6. **Critical-window plan**: a recovery action agreed in advance (U-E2E-5), a quiet window, the Edge Function and signed-URL prerequisites in place, and a reviewed containment script **with re-grants** if containment is part of the plan.
7. **Rehearsal of the hosted-capable variant** on scratch restores of the Production snapshot and of the captured Development dump through the full test matrix (this suite plus concurrency, privilege-limited role, server kill).
8. **Explicit execution approval** naming the environment, allowlist hash, commit and phases.

## 3. Production versus Development: the executor is Production-58 specific
- The allowlist builder reads only the E2C manifest format and the Production history; it refuses the Development manifest (test D01). The executor's built-in never-execute list (Cases 41, 42, 43 and the nine omitted versions) and its history-only rules are Production decisions (test D03). A Development-shaped ledger (the 58 captured Development versions) is refused by the Production allowlist's expected base history (D02).
- **Do not copy Production's plan into Development.** The 58-version sequence is the preferred *Production* candidate. Development already records most of those versions (and `20260722172048`); its pending inventory is 327 versions after the withdrawals: 213 history-only candidates (209 with all material statements present or superseded, 4 net-zero chains that must never be executed), 80 needing evidence, 33 withheld (the 23 October migrations behind the deployment gate and 10 containment-related versions), and **no pre-October version proven to need SQL execution** (`e2e-development-manifest.csv`).
- A Development executor would need its own: allowlist builder and rules; expected base history (58 rows including the recorded alias `20260814002658`, which has no repository file); per-statement predicates for each history-only candidate (regenerated from a fresh capture); evidence-gated items for the 80; the October block treated as its own critical window behind the containment/stub gate; and a decision on the alias (U-E2E-2). History-only records for Development are justified by Development's own catalog, never by Production's history.
- Production's working structure and behavior stay the reference: each Development object that differs is compared against the Production capture before any action (U-E2E-8).

## 4. Findings that change the allowlist, not the executor
- Declared dependencies derived from the E2B-1 graph are incomplete (the seed migration `20260716151549` declares no dependency on `20260716151458`; test F05b/F06). Add declared dependencies for data-seeding migrations before any hosted use; until then missing objects are caught by SQL failure and rollback.
- Manifest hashes of the earlier rehearsals (`d3-selected-manifest.json`) are working-copy (CRLF) hashes; the allowlist uses LF-normalized hashes from the bound commit. The executor sends LF text, which differs from the CRLF rehearsals only by carriage returns inside function bodies (tests R05b, R05c).
- The allowlist is bound to the commit `efda417`. After the E2F withdrawals the working tree is ahead of that commit in unrelated files; the executor verifies the migration files against both the commit and the working tree, so a later commit that changes any allowlisted file requires a new allowlist.

## 5. Still-pending items from earlier stages (unchanged by E2G)
Two pre-existing failing assertions (`coreDatabaseAccess` 1 failed of 308, `databaseFunctionAccessClassification` 1 failed of 60; recovered files changed their premises); the Case 41/42 withdrawals and the alias decision are repository-level decisions already handled (E2F) or deferred (alias); the `supabase_admin` default privileges, master-account password rotation and the temporary `cli_login_postgres` role remain Step 3 items; Development containment (14 Edge Function stubs) is untouched.
