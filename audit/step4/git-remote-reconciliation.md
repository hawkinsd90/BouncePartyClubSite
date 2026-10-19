# Git state and remote reconciliation (verified 2026-10-19; nothing fetched, merged, reset, pulled or pushed)

## 1. Fresh read-only check
| Ref | Value | Source |
|---|---|---|
| Local `Dev` (HEAD) | `0ea1ffe164f716babf03419f82b60ca56dae5c67` ("update link/reference image"), clean except 34 untracked Step 4 files, nothing staged | local |
| Parent chain | `0ea1ffe` -> `ecdda40` (Step 3 tip, the commit the sealed package is bound to) | local |
| `origin/Dev` | `aeb708ed9d5f0fbc2b146a52d378babd07024b30` | `git ls-remote` |
| `origin/main` | `b79ca480d244808a1926ef6f87dc5666a1dee052` (unchanged since 2026-09-28) | `git ls-remote` |
| `backup-main-before-rollback` | `8edf5d29047bdc95f9d27d33345387ab11f5c4f2` (unchanged) | `git ls-remote` |
| Relationship | local `Dev` is **104 ahead, 1 behind** `origin/Dev` | `git rev-list` |

## 2. The owner's commit and the remote commit
- `0ea1ffe` (the owner's) touches only `index.html` and `public/og-image.jpg`. It is **completed and out of scope** for Step 4: not recreated, edited, reverted or recommitted, and it is not one of the 34 uncommitted files.
- `aeb708e` (on `origin/Dev` only) deletes one stray Vite temporary file (`vite.config.ts.timestamp-...mjs`, 13 deletions). It touches no migration, function, test or configuration file.
- Nothing in either commit changes a migration file, the sealed package, the executor, the manifests or the recovery plan: no change under `supabase/`, `scripts/`, `src/` or `audit/` between `ecdda40` and HEAD.

## 3. Reconciliation options (owner decision G-22; nothing is done here)
| Option | What it does | Effect on package identity | Verdict |
|---|---|---|---|
| **R1 merge** | `git fetch origin Dev` then `git merge --no-ff origin/Dev`. A dry check, `git merge-tree --write-tree HEAD aeb708e`, produced a clean tree (no conflict). The stray file is then deleted locally too | `ecdda40` stays an ancestor; the hashes of the 104 commits are unchanged; package and future authorization remain valid | **Recommended** |
| R2 rebase the 104 commits onto `origin/Dev` | rewrites all hashes | `ecdda40` would leave the branch history | Not recommended |
| R3 force-push local `Dev` over the remote | removes `aeb708e` from the remote | none locally, but destroys the remote record and re-triggers every automation | Not recommended; only with the Supabase and Bolt controls in place and an approved exact command (G-15) |
| R4 do nothing | stay diverged | none | a plain push is rejected |
Branch history is not changed by this document or by any step of Step 4A.3.

## 4. Proposed order
1. After approval, locally: R1 merge, then re-run the executor unit test (package untouched).
2. Commit the Step 4 planning files per `package-freeze-and-commit-sequence.md` (three groups).
3. Push only at stage S9, after the Supabase and Bolt controls (gates D-03b, G-20) and with the exact command approved (G-15). Netlify continuous deployment stays ON; frontend errors during the backend migration are accepted.

## 5. Standing facts about unattended changes
- `Dev` has changed by means other than this work at least twice since 2026-09-28 (`b2cd801`, `aeb708e`); `main` has not.
- Check before every stage start: `git ls-remote --heads origin` must equal the recorded value; any difference stops the stage until reviewed (in P0 of the runbook).
