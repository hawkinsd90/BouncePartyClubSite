# Bolt access control (gate G-20)

Nothing here was changed. Evidence is the owner's description, the owner's saved Bolt answer, Git history and the hosted ledger.

## 1. Why Bolt is a rollout risk
Bolt's own answer (provided by the owner) says that in a Bolt project migrations are applied by the **Supabase MCP `apply_migration` tool, which runs SQL directly against the live database and records it in `supabase_migrations.schema_migrations`**, and that Bolt syncs the repository to GitHub. Taken together:
| Capability | Consequence during the recovery |
|---|---|
| Push to `Dev` | publishes `dev.bouncepartyclub.com` within 30 seconds (Netlify, verified) and triggers the Supabase GitHub integration (verified failing at its pre-check). It already happened today (`aeb708e`) |
| `apply_migration` against a connected Supabase project | writes DDL and a ledger row **with a timestamp Bolt chooses and no matching file**, which recreates the "remote-only version" problem (obstacle O1/O5), can alter schema or grants the executor fingerprints, and would make the sealed package's pre-state check fail (a safe failure, but a stop). If Bolt is connected to the **Production** project, the same applies to Production. Which project Bolt is connected to is not known from here |
| Rewriting files such as `index.html` | it has re-added third-party content before; the owner has since committed the site's own social-preview image (`0ea1ffe`), which is outside this plan |
| Evidence it has done these things | ledger rows with Bolt-style names (for example `add_tables_chairs_inventory_schema.sql` as a name, versions that match no file); `a02ecd7` (stray Vite file, 2026-07-09); `aeb708e` (2026-10-19) |

## 2. Owner actions (read first, change only with your decision; gate G-20)
1. **Bolt, project settings:** open the Supabase integration and write down which Supabase project(s) are connected; open the GitHub/Git sync and write down which repository and branch it pushes to.
2. **During the rollout:** disconnect Bolt's Supabase connection (or point it at a throwaway project) and pause or disconnect its GitHub sync. If you want to keep Bolt for design work, have it push to a separate branch (for example `bolt-work`), never to `Dev` or `main`, and merge by pull request.
3. **GitHub** (`hawkinsd90/BouncePartyClubSite` > Settings): Applications (installed and authorized apps) > review the Bolt / StackBlitz authorization and restrict or revoke it; Branches > add a protection rule for `Dev` and `main` (require a pull request or restrict who can push; block force pushes). The repository is public, so branch protection is available.
4. **Supabase** (account menu > Account Preferences/Access Tokens and the organization's Integrations/authorized apps): revoke Bolt's token or OAuth grant if it is not needed.
5. **Verify** after the freeze: `git ls-remote --heads origin` stays equal to the recorded value; `list_migrations` count stays 58 until the rollout writes; no new function versions appear unexpectedly.
**PASS:** Bolt cannot push to `Dev`/`main` and has no live connection to either Supabase project; the three checks of step 5 hold for 24 hours. **FAIL:** any unexplained commit, ledger row or function version.
