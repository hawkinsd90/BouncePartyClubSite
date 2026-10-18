# Step 3B: actions and decisions that belong to the owner

Nothing here was done by Claude. No hosted account was changed, disabled or rotated, and no credential was tried or printed.

## 1. Demo master account (SEC-005): operational response

**What is known.** A login for `admin@bouncepartyclub.com` was created by migration `20251003170350_015` with a password that is written in that file; migration `20251207163822` then promoted it to `master`. Step 2 compared the stored hash with that documented password on both projects (yes/no only). On 2026-10-17 a read-only check of Production showed the account **exists, holds `master`, and has signed in within the last 90 days**; Production has 5 `master` and 0 `admin` role rows. The same address is also used as the "from" address in the email hook migrations, so it may be a mailbox you use. That recent sign-in may be you. Do not delete or lock the account before you know.

**Order of work (all in the Supabase dashboard, Production and Development separately)**
1. Authentication > Users: open the account and read "Last sign in". Confirm whether you or a staff member uses it.
2. Confirm that another `master` login of yours works (the `master` rows belong to other accounts: check by signing in with each, not by creating new ones).
3. Change the account's password in the dashboard to a long random value kept in a password manager; sign the account out of other sessions.
4. If nobody uses it, disable it (ban) rather than delete; delete only after a week with no complaints.
5. Turn on MFA for every `master` account if your plan allows it.
6. Run `audit/security/step3b-credential-check.sql` on each project and keep the output with the date. Expected: the old credential matches nothing.
7. Only then approve the follow-up code change below.

**Code-level controls already in place (this run)**
- `src/lib/tests/security/demoCredentialExposure.test.ts` reads the value from the migration at run time and fails if it appears in any other file, if the migration is ever scheduled for execution by the Development or Production plans, or if a later migration re-creates the user.
- Migration 015 stays on the Development deny list and is never executed.

**Needs your approval, not done:** redacting the value inside migration 015 (an edit of an applied historical file; Step 2 showed nothing depends on its hash) and rewriting Git history (not proposed; the value also lives in every clone, so rotation is the real fix). Check whether the GitHub repository is public and who has clones.

## 2. Decisions

| Item | Recommendation | Why |
|---|---|---|
| SEC-004 anonymous signup-consent insert | Accept as is | The policy reads `auth.users`, which `anon` cannot read, so an anonymous insert is refused with or without Step 3B (reproduced locally; hosted behaviour unverified); consent is recorded by the `record-consent` function (see that item). Step 3B leaves `anon` INSERT only on the table |
| SEC-035 crew can update every unguarded `orders` column and read all customers | Decide after Step 6 crew testing | Narrowing needs an exact list of the columns the crew screens write; a wrong list breaks crew work. The confirmation-state columns are already protected (migration 20261026120300) |
| SEC-015 hosted `supabase_admin` default privileges (**Step 4 gate**) | Before the Production (and, if the read-only check shows defaults, Development) run: confirm the migration operator can alter them, or close them once from the dashboard SQL editor as `supabase_admin` | `20261026120400` now **fails closed**: if the defaults are still open after it tries, it raises and nothing is recorded, so a privilege failure can never look like success. The hosted operator's ability is unverified; no new role is created |
| SEC-020 historical evidence photos in the public `public-assets` bucket | Approve the staged `scripts/migrate-order-evidence.mjs` on Development first | New evidence already goes to the private bucket; only history remains. Production is refused by the script |
| SEC-038 expired `cli_login_postgres` roles | Keep the standing rule "no CLI command that initialises login roles on hosted projects"; drop the roles only after checking they own nothing | Expired roles cannot sign in |
| `react-router-dom` 6.x advisories (open redirect) | Plan a dependency update PR | The one URL-driven redirect in the app is now guarded in code (SEC-048), but the library fix is the proper cure and needs a regression pass |
| `record-consent` | Compare with the hosted function before Step 4 | The repository file has been empty since commit 8d4701f, yet signup and the consent drain call it |
| `send-error-notification` | Decide whether to point it at `send-email` | It calls a function named `resend` that does not exist, so crash reports are not emailed today; the input is now safe if you enable it |
| Twilio | Confirm the webhook and status-callback URLs in the Twilio console | Signature checks use the configured URL (`TWILIO_WEBHOOK_URL` / `TWILIO_STATUS_CALLBACK_URL` can override) |

## 3. Final acceptance review (2026-10-18): the six open items as owner choices

None of these blocks LOCAL Step 3 acceptance: each local implementation is complete and tested (or is, by nature, an operation on a hosted project or a credential). "Step 4 gate" means it must be settled before the named Step 4 action. Nothing below was decided or done on the owner's behalf; no hosted account or credential was touched.

| Item | Choices | Recommendation | Risks | Blocks local acceptance? | Needed when |
|---|---|---|---|---|---|
| **SEC-005** demo master account | A. Rotate its password and sign out its sessions (dashboard), then verify with `step3b-credential-check.sql`. B. Disable (ban) it if nobody uses it. C. Leave it. | A first (it signed in within 90 days on Production, so it may be your login), then B once another master login is proven. Never C. | Lock-out of the only master login; the documented password works for anyone until changed; the value also lives in Git history and every clone (rotation, not history rewriting, is the fix) | No. Local controls exist (credential-spread test, deny list, the migration is never executed). | **Before Step 4 refreshes Development from Production**, and as soon as you like for Production (independent of any release) |
| **SEC-015** hosted default privileges (`...0400`) | A. Confirm the hosted migration operator can alter `supabase_admin` defaults, then run the file. B. Close the defaults once from the dashboard SQL editor as `supabase_admin`, then run the file (it passes as a no-op). C. Skip the file. | A if the read-only preflight shows the operator is allowed, otherwise B. Not C. | If neither A nor B holds the file fails (by design) and the version is not recorded. Option C leaves objects created from the dashboard open to `anon` and `authenticated`. No new role is involved in A or B. | No: it is a **Step 4 gate**; the local file is fail-closed and tested. | Before the Production run; before the Development run if `pre_work_remaining` is true there |
| **SEC-020** legacy delivery and damage photos in the public `public-assets` bucket | A. Run the staged `scripts/migrate-order-evidence.mjs` on Development (plan, copy, rewrite; cleanup last), then decide Production. B. Leave them public. | A on Development after `task-evidence` and `20261015123000` are live; Production only after a separate approval (the script refuses Production by design). | Rewriting task rows and deleting public copies: do copy and verify first and run cleanup last; old links stop working | No: new evidence already goes to the private bucket. | Step 4 (Development), Step 6 acceptance |
| **SEC-035** crew scope on `orders` and `customers` | A. Keep (confirmation columns are already guarded). B. Narrow crew UPDATE to the columns the crew screens write. C. Replace crew writes with a narrow SECURITY DEFINER function. | A until Step 6 crew testing lists the exact columns, then B. | A wrong list silently breaks crew status updates and photos | No (deliberate residual from the October lockdown). | After Step 6 crew testing |
| **SEC-048** vulnerable dependencies | A. Apply the in-range patch updates (`react-router-dom` to 6.30.3 or later, which also moves `react-router` and `@remix-run/router`; the `ws` and `qs` patches) and run build, type-check and the browser regression pass. B. Wait. | A as its own small change after Step 3 is committed. | Needs a registry install and a lockfile change; a router patch can alter navigation | No: the one URL-driven redirect is guarded in code (tested) and the `ws`/`qs` findings are transitive and not in the browser bundle. | Before the frontend release |
| **SEC-049** `record-consent` | A. Deploy the source restored from Git history (commit `8d4701f^`) after reading the hosted function. B. Write a new function. C. Leave it empty. | A, after reading the hosted source, because the restored file matches the callers' contract and the `user_consent_log` schema and now has 23 authorization tests. | Overwriting a newer hosted version; C silently stops consent logging for signups | No: restored locally and tested. | Before Step 4 deploys functions |

Other owner items unchanged from section 2 above: SEC-004 (accept), SEC-028 (whether crash e-mails go through `send-email`), SEC-038 (login roles), Twilio console URLs, `SITE_URL` / `RETURN_ORIGINS`.
