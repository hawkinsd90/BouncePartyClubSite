# D-03: What a `git push origin Dev` would trigger, and how to hold it

**Status: PARTIALLY RESOLVED, NEW RISK FOUND.** Netlify's exact settings are not readable from here, but the evidence shows that a push can reach **two** automated systems, not one: Netlify (frontend) and the Supabase GitHub integration (database migrations and Edge Functions). Nothing was pushed, built or changed.

## Evidence (read-only)
| Question | Finding | Provenance |
|---|---|---|
| Does `dev.bouncepartyclub.com` run on Netlify? | yes: `Server: Netlify`, `X-Nf-Request-Id`, `Cache-Status: "Netlify Edge"` | [LIVE] public HTTP HEAD/GET |
| What is deployed there? | `index.html` loads `/assets/index-rRSttZPK.js` and `index-b7Q0ZAnr.css` | [LIVE] |
| Which backend does the deployed bundle target? | the Development project ref appears 4 times; the Production ref 0 times | [LIVE] bundle text |
| Is the deployed frontend older than the 11 new functions? | none of `create-booking`, `check-availability`, `complete-booking`, `customer-portal-data/action`, `portal-link`, `record-site-event`, `request-portal-link`, `resolve-link`, `staff-order-save`, `task-evidence` occurs in the bundle | [LIVE] |
| Which Git commit is deployed? | not exposed (no commit header or meta tag). Presumed `origin/Dev` = `b2cd801`; the bundle hash `rRSttZPK` could not be matched to a local build because environment values are baked into the build | **UNKNOWN** |
| What does `netlify.toml` say? | build command, publish dir, Node 20.17.0, SPA redirect; **no** branch, context or deploy settings | [REPO] |
| Is there CI or another deploy hook in the repo? | no `.github/` directory | [REPO] |
| Does the Supabase project watch the repo? | **Yes, probably.** The project has a branch record named "Dev" with `git_branch: "Dev"`, `is_default: true`, `persistent: false`, **status `MIGRATIONS_FAILED`** (created and last updated 2026-06-02) | [LIVE] |

## The new risk: Supabase's GitHub integration
A Supabase branch record tied to Git branch `Dev` means the GitHub integration was connected to this repository. Depending on two dashboard toggles, a push to `Dev` could make Supabase itself run `supabase/migrations` against the project and deploy `supabase/functions`: exactly the "git push followed by db push" the rollout must avoid, on a ledger that is intentionally drifted. The `MIGRATIONS_FAILED` status shows it already tried and failed once. I cannot read the toggles ("Deploy to production" / automatic branching / working directory) with the available tools, so this must be treated as **live until the owner proves otherwise**.

## Owner inspection (before any push; write down each answer)
**Supabase**: Dashboard > project `srxunxiytojjsuhcmzjg` > Project Settings > Integrations > GitHub (and Branches).
1. Is a repository connected? Which repository and **production branch**?
2. Is "Deploy to production" (run migrations and deploy functions on push) **on**? Is "Automatic branching" on?
3. What is the "Supabase directory" (working directory)?
4. Open the "Dev" branch entry: why `MIGRATIONS_FAILED`; are there error logs?
**Netlify**: site for `dev.bouncepartyclub.com` > Site configuration.
5. Build & deploy > Continuous deployment: repository; **Production branch** (or is `dev.` a branch-deploy subdomain of the main site?); "Branch deploys" setting (All / specific / none); "Deploy Previews".
6. Deploys list: the currently published deploy (ID, branch, commit hash, time). Record the commit; it is the rollback target.
7. Build & deploy > Environment variables: scope per deploy context; confirm `VITE_SUPABASE_URL` and the anon key point at the **Development** project in every context that can build `Dev`.
8. Build hooks (any hook that rebuilds on demand).
9. Domain management: which site/branch serves `dev.bouncepartyclub.com`.

## Control strategy (to decide with the answers)
| Goal | Action | Reversible? |
|---|---|---|
| Stop Supabase applying anything on push | In the GitHub integration, turn **off** "Deploy to production" and "Automatic branching" for the duration of the rollout (or disconnect the repository). Do this **before** the push. | yes (toggle back, owner action) |
| Stop Netlify publishing on push | Deploys > **Stop auto publishing** (lock the published deploy). The push still builds; nothing goes live until "Start auto publishing" or "Publish deploy" on the chosen build. | yes |
| Verify the build without publishing | With auto publishing stopped, open the new deploy's permalink, run the smoke checks from the test matrix (PUB group) against it, then publish. The permalink uses the same environment variables, so it also talks to Development. | n/a |
| Roll the frontend back | Deploys > the recorded previous deploy > **Publish deploy**. No Git rewrite. | yes |
| Avoid touching `Dev` until ready | Optionally push the same commit to a throwaway branch first only if "Branch deploys" is limited and automatic branching is off; otherwise skip (a new remote branch can itself trigger deploys or Supabase preview branches). | branch can be deleted |

The runbook now requires the answers to 1-9 and both toggles being off (or confirmed absent) as preconditions of S9, and it makes S9 the first stage that may push.

## Frontend/backend compatibility window
Development is currently contained (`anon` and `authenticated` cannot use schema `public`), so the deployed bundle cannot read the database as those roles today; this is an inference from the observed schema ACL, not a test of the live site. Publishing the new bundle before S8 would call functions that do not exist (11 of them) and show errors; publishing it after S8 and before S11 would still be unable to read `public` as `anon`/`authenticated` because containment is deliberately still on. Real behaviour of the site is therefore only testable after S11 (S13).

## Decisions needed
D-03a: answers 1-9 above. D-03b: whether to disconnect the GitHub integration permanently (recommended for a repository whose migration history is deliberately managed by a reviewed executor). D-03c: whether Netlify auto publishing is stopped for the rollout (recommended).


---

## Step 4A.2 update (2026-10-18): verified behavior of the Supabase GitHub integration

### Verified (public GitHub API, read-only, no authentication; the repository is public)
| Evidence | Finding |
|---|---|
| Check runs on `Dev` commits from `1d4e5e2` (2026-09-28) to `b2cd801` (2026-09-29): 8 of 8 commits | Every push to `Dev` produced a check run named **"Supabase Preview"** from the Supabase GitHub app, linking to project `srxunxiytojjsuhcmzjg`, finishing in about 3 seconds. |
| Conclusion of each run | **failure**: "Remote migration versions not found in local migrations directory." |
| `main` commit `b79ca48` | Same failure (the run attaches to the commit). |
| `backup-main-before-rollback` commit `8edf5d2` (2026-06-18) | "skipped": "This git branch is not associated with any Supabase Branch." |
| Supabase branch record | one branch, name "Dev", `git_branch: Dev`, default, `persistent: false`, status `MIGRATIONS_FAILED`, `with_data: false` (no data copy). |
| Netlify | No commit statuses and no GitHub deployments exist for `b2cd801` (statuses: 0; deployments: empty), so GitHub gives **no** evidence about Netlify. |
| Repository | Public. No `.github/` workflows. Webhook list needs authentication, so it could not be read. |

### What this establishes
1. **The integration is active and reacts to every push of `Dev`.** It is associated with the "Dev" branch, not with arbitrary branches.
2. **It currently stops at a consistency pre-check** (the same rule as `supabase db push`: every version in the remote ledger must exist as a local file). That is why the ledger was never touched by a push. This is luck of drift, not a control: the check also fails today, so on the push this task is about, it would very probably fail the same way, because the ledger contains the ledger-only alias `20260814002658` (no file of that version) and rows for versions whose files were renamed.
3. **Whether it would apply migrations and deploy functions if the check passed depends on the "Deploy to production" toggle, which cannot be read here.** Per the Supabase documentation, with "Deploy to production" on, a push or merge to the production branch applies new migrations, deploys Edge Functions **declared in `config.toml`** (52 entries now) and deploys Storage buckets declared in `config.toml`; API/Auth settings are ignored by default. With "Automatic branching" on, a new GitHub branch (not a push to `Dev`) creates a separate preview branch database.
4. **Do not rely on the failing pre-check.** After Step 4B the ledger will contain executor rows and bookkeeping rows; a future combination could pass the check. The rollout must switch the automation off, or disconnect it, before any push.

### What changes when the automation is disabled
- Disabling "Deploy to production" or disconnecting the repository stops Supabase reacting to pushes. It does **not** delete the project, the ledger, the data or the existing branch record. The "Dev" branch record may remain or may be removable from Branches; leaving it is harmless.
- Production (`qaagfafagdpgzcijnfbw`) is a different project and is unaffected by anything on this page. (Whether Production has its own connected repository is unknown; the owner should look at its Integrations page too before any Production plan.)
- It is reversible: re-enable the toggle or reconnect later. Re-enabling later means the first push after that would run the integration again, so do it only after the ledger and the repository agree.

### Owner steps (changes require the owner; Claude changes nothing)
**Supabase** > project `srxunxiytojjsuhcmzjg` > **Project Settings > Integrations > GitHub** (and **Branches**):
1. Record: connected repository; **production branch**; working directory; the state of **Deploy to production**, **Automatic branching**, **Supabase changes only**; any "required check" configured in the GitHub repository settings.
2. Open the "Dev" branch and read the failure message and date.
3. **Before S9 only**, with the owner's decision (D-03b): turn **Deploy to production OFF** and **Automatic branching OFF** (or disconnect). Record the time. Take a screenshot or copy the text of the final state.
4. Verification after the push (S9): the new commit's "Supabase Preview" check run is absent, skipped or failed at the pre-check, **and** the read-only ledger export is unchanged (count and SHA-256).
**Netlify** > the site serving `dev.bouncepartyclub.com` > **Site configuration > Build & deploy > Continuous deployment**: record production branch, branch deploys, deploy previews; **Deploys**: the published deploy's ID, branch, commit and time; **Environment variables**: `VITE_SUPABASE_URL` value host part (must be `srxunxiytojjsuhcmzjg.supabase.co`) for every deploy context that can build `Dev`. Then set **Stop auto publishing** for the rollout.

### Classification
| Item | Class |
|---|---|
| The integration reacts to pushes of `Dev`; has failed at a pre-check since at least 2026-09-28 | verified |
| "Deploy to production", "Automatic branching" toggles; production branch; Netlify branch and publish settings | requires owner inspection |
| Turning off Supabase auto-deploy; stopping Netlify auto publishing; disconnecting the integration | requires explicit owner authorization (hosted-setting changes) |


---

## Step 4A.2b update (2026-10-19): settings read through the Netlify and Supabase connectors (read-only)

### Netlify (connector, read-only operations only)
| Fact | Value |
|---|---|
| Team | one team (`hawkinsd90`, plan Pro, 1 member, MFA not enforced) |
| **Two separate sites** | `bouncepartyclub` (production, `https://bouncepartyclub.com`, built from branch **`main`**, current deploy `6abae90b...`, commit `b79ca48`, 2026-09-28) and `bouncepartyclubdev` (`https://dev.bouncepartyclub.com`, built from branch **`Dev`**) |
| Dev site current deploy | `6ad61640...`, state ready, **context `production`, branch `Dev`, commit `aeb708e`, created 2026-10-19 13:08:16 UTC, published 13:08:39 (build time 19 s)**, not a manual deploy, framework vite, no Netlify Functions or Edge Functions, 1 redirect rule |
| **Auto publishing** | **Verified ON.** `origin/Dev` received commit `aeb708e` at 13:08:13 UTC (title "Deleted vite.config.ts.timestamp-...mjs", one removed file) and Netlify built and published it to `dev.bouncepartyclub.com` within 30 seconds. A push to `Dev` therefore publishes the Development site automatically. A push to `main` does the same for production. |
| Password / SSO protection | none on any site |
| Repository | public (`public_repo: true`) |
| Not readable with the connector tools | build command/settings, branch-deploy and deploy-preview settings, site-level environment variable values (team-level variables do not include `VITE_SUPABASE_URL`) |

### Supabase (second connector, read-only)
| Fact | Value |
|---|---|
| Projects in the organization | `Bounce Party Club Dev` (us-east-1), `Bounce Party Club Prod` (us-east-2, `qaagfafagdpgzcijnfbw`), and an unrelated project |
| **Production also has the GitHub integration** | branch record "main", `git_branch: main`, default, status **`MIGRATIONS_FAILED`** (created 2026-05-27); `with_data: false` |
| Development | branch record "Dev", `git_branch: Dev`, default, `MIGRATIONS_FAILED` (2026-06-02) |
| Not exposed by any connector tool | the integration's toggles (Deploy to production, Automatic branching, Supabase changes only), working directory, required check |

### What this changes
1. **The first question of D-03 is answered: yes, a push to `Dev` publishes `dev.bouncepartyclub.com` automatically**, and a push to `main` would publish the production site. The earlier "stop auto publishing" instruction is needed for the Dev site (`bouncepartyclubdev`) and must never be done on `bouncepartyclub` by accident.
2. **The Supabase integration is connected on Production as well**, and is stuck at the same pre-check. Any later Production push to `main` reaches it too. The Production plan must treat it as live until the owner has read its toggles.
3. **`origin/Dev` moved.** It is now `aeb708e` (the old tip `b2cd801` plus one commit that only deletes a stray file). Local `Dev` is 103 commits ahead and **1 behind**: a plain `git push origin Dev` would be rejected as non-fast-forward. Before S9 the owner must decide how to reconcile (merge or rebase; this is a Git decision that was not made here). The deleted file does not appear in the deployed bundle (Netlify reported "all files already uploaded"), so the deployed frontend is still the `b2cd801` build.
4. Owner questions that remain: the three Supabase toggles, and the Netlify build and environment settings for `bouncepartyclubdev`.


---

## Step 4A.3 (2026-10-19): owner decision 5 and the screenshots

### Owner decision 5
Netlify continuous deployment stays **ON**; the owner is the only tester and accepts temporary downtime or errors on the Development site during the rollout. Therefore Netlify publication is **not a blocker** (gate D-03c is recorded, not blocking). What remains:
- The frontend may be incompatible with the backend from the push (S9) until S12; that is accepted.
- **Testing resumes** when S11 has been applied, S12 passes, the Netlify deploy for the final HEAD is "ready" and published (record its ID), and provider checklist V1-V3 pass.
- **Rollback:** Netlify > Deploys > the recorded previous deploy > Publish deploy. The deploy live on 2026-10-19 is `6ad6164006e80bd67c7754ed` (commit `aeb708e`); record the then-current one just before the push.
- **Production unaffected:** the production site is a different Netlify site (`bouncepartyclub`, branch `main`, current deploy commit `b79ca48`). Nothing in this plan pushes to `main`.
- Supabase automatic migrations are a **separate** risk and stay controlled (gate D-03b) until stage S15 proves them safe.

### What the owner's four screenshots established (Netlify site `bouncepartyclubdev`)
| Item | Observed |
|---|---|
| Repository | `github.com/hawkinsd90/BouncePartyClubSite` |
| Build settings | base directory `/`, build command `npm run build`, publish directory `dist`, functions directory `netlify/functions` (default, no functions), runtime not set, deploy logs **public**, build status **Active** |
| Enforce deployment methods | "All deployment methods can deploy to production" (CLI, MCP, API, Git) |
| Environment variable names | `NODE_VERSION`, `SECRETS_SCAN_OMIT_KEYS`, `VITE_GOOGLE_MAPS_API_KEY` (5 values in 5 contexts), `VITE_LOGO_URL`, `VITE_STRIPE_PUBLISHABLE_KEY` (4 values in 4 contexts), `VITE_SUPABASE_ANON_KEY` (4 values in 4 contexts), `VITE_SUPABASE_URL` (one value for all contexts) |
| Sensitive-variable policy | untrusted (fork) deploys: "Require approval" |
**Still needed from Netlify (not in the screenshots):** the **Branches and deploy contexts** section (production branch, branch deploys, deploy previews) on the same Developer settings page; and, by expanding `VITE_STRIPE_PUBLISHABLE_KEY`, only the first 8 characters of each context's value (`pk_test_` vs `pk_live_`). The values of the other variables are not needed.

### Where the Supabase integration toggles are (owner)
1. Open `https://supabase.com/dashboard/project/srxunxiytojjsuhcmzjg` (Development; Production is `.../project/qaagfafagdpgzcijnfbw`).
2. Left sidebar, bottom: **Project Settings** (gear icon) > **Integrations** > **GitHub Integration** (it may be labelled "GitHub Connections"). Direct link: `https://supabase.com/dashboard/project/srxunxiytojjsuhcmzjg/settings/integrations`.
3. On that page read: the connected repository; the **Production branch**; **Working directory**; the toggles **Deploy to production**, **Automatic branching**, **Supabase changes only**; and any branch limit. Copy the state of each toggle as text. Do not change anything yet.
4. Then open **Branches** in the left sidebar (`.../project/<ref>/branches`) and read the "Dev" (or "main") entry and its failure message.
5. Do both projects. If you cannot find it, send a screenshot of the Project Settings left menu.


---

## Owner screenshots of 2026-10-19: the toggles are now known
| Setting | Development (`srxunxiytojjsuhcmzjg`) | Production (`qaagfafagdpgzcijnfbw`) |
|---|---|---|
| Repository | `hawkinsd90/BouncePartyClubSite` | same |
| Working directory | `.` | `.` |
| **Deploy to production** | **ON** | **ON** |
| Production branch name | **`Dev`** | **`main`** |
| **Automatic branching** | OFF | **ON** (branch limit 3) |
| Supabase changes only | greyed (ON by default) | ON |
**Meaning.** (1) A push to `Dev` is the "merge into the production branch" of the Development project: once the integration's pre-check passes it applies new migrations and deploys the functions declared in `config.toml`. Today it stops at the pre-check (the remote-only ledger version). So **Deploy to production must be turned OFF on Development before any push** (gate D-03b). (2) Production has the same toggle ON for `main`: nothing in this plan pushes to `main`, but a later Production release must treat the integration as live. (3) Production has **Automatic branching ON**: any pull request that changes files under `supabase/` creates a Supabase preview branch on the Production project, billed at about USD 0.01344 per hour per branch (limit 3), outside the spend cap. Any pull request opened against the Production project's repository would do this too.
**Stripe and Netlify (same screenshots).** `VITE_STRIPE_PUBLISHABLE_KEY` has the same masked value ending `9XMo` in all four Netlify contexts, and the Stripe sandbox API log shows a `pk_test_...NB9XMo` key calling from `https://www.dev.bouncepartyclub.com/` with `cs_test_` sessions: the frontend is on the Stripe **test** key in every context. The Dev migrations page shows the same ledger as the connector (top version `20260929161925`; alias row `20260814002658`).
