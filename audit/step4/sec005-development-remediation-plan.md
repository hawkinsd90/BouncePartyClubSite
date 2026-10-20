# SEC-005 Development remediation plan: two accounts share the published password (2026-10-20)

Status: **PLAN FOR OWNER AUTHORIZATION (revised 2026-10-20 for the intentional schema containment). NOTHING WAS CHANGED.** No account was banned, reset, modified or deleted; the published password was never used to sign in (hash comparisons inside read-only queries only); Production was not contacted. The website's password-reset page has failed before, so **nothing here depends on the public reset workflow** (see section 8).

## 0. Why the Development website cannot be used to prove access right now (checked read-only, 2026-10-20 14:48 UTC)
The Development site loads but every data request fails. This is **exactly what the intentional containment predicts**, not a separate fault:
- `anon` and `authenticated` have no USAGE on schema `public` (`has_schema_privilege` false for both; the schema's ACL lists only `postgres` and `service_role`); `service_role` keeps USAGE and CREATE. Table-level grants and 222 row-level policies still exist, but cannot be reached without schema USAGE.
- The Postgres log for 13:30 to 14:48 UTC contains 281 errors, **all** `permission denied for schema public`. The only other errors in that window are six column-name mistakes in my own read-only queries (no effect).
- The API gateway log shows the same split: requests without a user token (public pages: reviews, carousel, business settings) return **401**; requests carrying the master's token (`user_roles?user_id=eq.<id>`, `customers?user_id=eq.<id>`) return **403**. Both are PostgREST's answer to a permission-denied error for the `anon` and `authenticated` roles.
- Authentication itself is healthy: `auth/v1/health` returns 200 and the only token call in the window (a refresh for the Google master at 14:44:10 UTC) returned 200. No second authentication or configuration problem is evident. Nothing was changed; the Admin UI test waits for the planned controlled access restoration.

## 0.1 Containment-compatible proof of alternate MASTER access (replaces "open the Permissions page")
| Step | Check | Status 2026-10-20 |
|---|---|---|
| A | The owner signs in to **Development** with the Google master (`ha***@gmail.com`, user id `bc6ed893-3cc7-4204-aad8-6216f6847b22`) | **Not yet shown.** The 14:44:10 event is a **token refresh of an old session** (created 2026-10-16); `last_sign_in_at` is still 2026-10-16. An existing browser session does not count. **Owner action needed: sign out of the Development site, then sign in with Google again.** The application will still show 403 errors afterwards; that is expected. |
| B | The session belongs to the **Development** Auth project | Shown for the refresh: the project's own Auth log (`srxunxiytojjsuhcmzjg`) recorded it for that user id, and the request URL in the gateway log is the Development project. Repeat for the fresh sign-in (a `login` event and a new session row). |
| C | Privileged read-only check that this user id has an active `master` role in `public.user_roles` | **Done:** one role row, `master`; the id in the Auth log equals the account's id. |
| D | Distinct from both compromised accounts, not banned, not deleted | **Done:** different user id from `admin@bouncepartyclub.com` and from the offline4ever account; `banned_until` null, `deleted_at` null, e-mail confirmed, provider google. A second independent master (`hw***@gmail.com`, e-mail sign-in, 2026-08-01) is also active. |
| E | The owner can open the Development **Supabase dashboard** (Authentication > Users) as an independent recovery path | **Owner confirmation needed** (the dashboard is independent of the website and of the containment). |
**Result 2026-10-20 14:56 UTC (read-only): prerequisite MET.** Fresh Google sign-in through `dev.bouncepartyclub.com` recorded by the Development Auth log at 14:54:48 (OAuth `/authorize` redirect at 14:54:26, `login` event, `/user` 200); `last_sign_in_at` for `bc6ed893-3cc7-4204-aad8-6216f6847b22` is now 2026-10-20 14:54:48; a new session row exists (17 sessions in total; created 14:54:48, aal1, user agent recorded); role `master`; not banned or deleted; distinct from both targets. Dashboard access to Authentication > Users confirmed by the owner. Targets verified before the action: demo master `baa7b068-da1f-45a3-b376-822e8166570d` (not banned, 4 sessions) and second account `c9e6a72d-246e-476a-8dd7-6d1e53bbd298` (not banned, 0 sessions).

After A the check is: `last_sign_in_at` for that id is newer than 2026-10-20 14:44, a new row exists in `auth.sessions`, and the Auth log shows a `login` for it. Then the prerequisite is met.

## 1. Evidence (read-only, Development, 2026-10-20; e-mail addresses masked)
| | Demo master | Second account |
|---|---|---|
| Address | `ad***@bouncepartyclub.com` (also the `business_email` setting) | `ad***@offline4ever.com` |
| Password equals the published one | **yes** | **yes** |
| Roles | `master` (promoted by a later migration) | none |
| Created / last sign-in | 2025-10-16 / 2026-07-18 | 2026-03-02 / never |
| Confirmed, banned, deleted | confirmed, not banned, not deleted | not checked (check it in step 3) |
| Sessions / active refresh tokens | 4 / 4 (newest 2026-07-18) | 0 / 0 |
| Linked customer row (`customers.user_id`, ON DELETE CASCADE) | 1 | 1 (0 orders, 0 contacts) |
| Contact row with that e-mail | 1 | 0 |
| Permission-change log rows | 0 as actor, 0 as target | 0 |
| MFA factors | 0 | not checked |
| Used by settings | `business_email` only (no template mentions it) | none |

Other `master` accounts (2): `ha***@gmail.com` (Google sign-in, **no password**, last sign-in **2026-10-16**) and `hw***@gmail.com` (e-mail and password, last sign-in 2026-08-01). Both are confirmed, not banned, not deleted. The Google account is not affected by any password change. I cannot sign in for you, so **"another master can access Development" is not yet proven**; that proof is step 1 of section 4 and is yours.

Tables that reference `auth.users`: `customers.user_id` and `customer_profiles.user_id` and `user_permissions_changelog.target_user_id` and `daily_mileage_logs.user_id` and `pending_signups_consent.user_id` cascade on delete; `order_changelog`, `order_notes`, `order_workflow_events`, `order_refunds`, `orders.cancelled_by`, `admin_settings_changelog.changed_by`, `order_discounts.created_by` and several others are NO ACTION (a delete is refused while rows exist). **Deleting either user therefore also deletes its linked customers row**, which orders may reference. Preserving customer records, order references, audit history and the business notification configuration means: **do not delete; disable.**

## 2. Is the account legitimately used?
- **Demo master:** it may be used: it is the master that signed in last on 2026-07-18, and its address is the business e-mail. But two other masters exist and signed in more recently (2026-10-16, 2026-08-01). Recommendation: **treat it as retired; disable first** (ban). If you or staff do sign in with it, **rotate** instead (section 5) and tell them the new password through your password manager.
- **Second account:** a customer-type account, created 2026-03-02, never signed in, no orders or contacts. It is probably a test account. **Do not assume that having no role makes it harmless:** the Development database lets any signed-in user read SMS templates and update them (policy `Authenticated users can update templates`, condition `true`), and anyone who guesses the published password could sign in as it. Recommendation: **disable (ban) now; delete only after the dependency check in section 6 and only if you confirm it is a test account.**

## 3. Sessions and tokens (what a ban or a password change does not do)
- A ban stops the account from signing in and from **refreshing** its session; an access token already issued stays valid until it expires (the JWT lifetime in dashboard > Authentication; 1 hour is the usual default). The demo account has 4 live sessions.
- The application authorizes admin actions from the `user_roles` table using `auth.uid()`, so a still-valid token can act as master until it expires. The window is at most the JWT lifetime after the ban.
- A password change does **not** by itself end other sessions (not verified for this project; treat it as not ending them). Ending them has no verified supported write (section 6); a ban stops refreshing instead.
- Therefore: **ban first, wait one JWT lifetime, then confirm read-only that the accounts are banned and no longer refresh.** After any later unban the old password would work again, so **rotate before any unban.**

## 4. Exact owner procedure (dashboard; no password ever typed into chat, SQL or a file)
1. **Prove alternate access (containment-compatible; section 0.1).** Sign out of the Development site, sign in again with the Google master, and confirm you can open the Development Supabase dashboard (Authentication > Users). Tell me; I verify read-only that a fresh Development sign-in and session exist for that user id with the `master` role. The admin pages are expected to show 403 errors until access is restored. If the sign-in or the dashboard does not work, **stop**; nothing else is changed.
2. Supabase dashboard > project `srxunxiytojjsuhcmzjg` (Development; check the name; never the Production project) > Authentication > Users.
3. Find the second account (`ad***@offline4ever.com`) > menu > **Ban user** (long duration). Find `admin@bouncepartyclub.com` > **Ban user** (long duration). Do not use "Send password recovery", "Send magic link" or "Delete user".
4. Wait one JWT lifetime. Then run the read-only checks in section 7 (the dashboard SQL editor, or ask me to run them). Session rows may remain; they cannot be refreshed once the user is banned (section 6).
5. Record date, who, and the check output in the operator log.

Preserved by this procedure: customers, contacts, orders, order references, audit history (changelog rows), the master role row, `business_email` and all notification settings. Nothing is deleted. Reversal: remove the ban in the dashboard (do this only after rotating the password).

## 5. If the demo master is still needed (rotation without the website)
From your own shell (PowerShell or bash), using the Development **service-role key** read silently and a new random password (at least 24 characters) from your password manager, call the Auth admin API: `PUT https://srxunxiytojjsuhcmzjg.supabase.co/auth/v1/admin/users/<user id>` with body `{"password": "<new>"}` and the two key headers. Read both values with a hidden prompt (`Read-Host -AsSecureString` or `read -s`); never echo them, put them in a command line you share, a file or Git. Afterwards run `audit/security/step3b-credential-check.sql` from your shell (it reads the old value from the migration file you open yourself and prints booleans and counts only). Expected after a rotation: the demo account no longer matches (false) and the count of matching accounts is 0 once the second account is also rotated or banned-and-checked.

## 6. Optional: sessions and the dependency check (read-only checks are safe; the deletion is a hosted write)
Read-only dependency check before ever deleting the second account (expect all zeros except its single `customers` row, which would cascade):
```sql
select (select count(*) from public.orders o join public.customers c on c.id = o.customer_id where c.user_id = '<second user id>' or c.email ilike 'ad%@offline4ever.com') as orders,
       (select count(*) from public.contacts where email ilike 'ad%@offline4ever.com') as contacts,
       (select count(*) from public.user_roles where user_id = '<second user id>') as roles;
```
Ending sessions: **no supported session-revocation procedure has been verified for this project, so none is proposed as a write.** Do not delete rows from the managed `auth` tables by hand. A banned user cannot refresh a session, so after the ban and one token lifetime the existing sessions are unusable even if their rows remain; the proof is read-only: banned state, and no further `token_refreshed` events for those two user ids in the Auth log. If you want the rows gone, check the dashboard for a per-user sign-out action first; anything else needs a separate explicit authorization after the method is confirmed supported.

## 7. Read-only verification after the action (no password involved)
```sql
select lower(u.email) like 'admin@%' as is_demo, u.banned_until is not null and u.banned_until > now() as banned,
       (select count(*) from auth.sessions s where s.user_id = u.id) as sessions,
       (select count(*) from auth.refresh_tokens r where r.user_id = u.id::text and not r.revoked) as active_refresh_tokens,
       (select count(*) from public.user_roles r where r.user_id = u.id) as role_rows
from auth.users u where lower(u.email) = 'admin@bouncepartyclub.com' or u.email ilike 'ad%@offline4ever.com';
```
PASS: both rows banned = true, no refresh activity for either user id in the Auth log after one token lifetime (session rows may remain; they cannot be refreshed), and the demo master's role row is still there (audit continuity). Session rows reaching 0 is a bonus, not a requirement. Note that a **ban leaves the stored password unchanged**, so `step3b-credential-check.sql` check 1 stays true after a ban; that is expected until the password is rotated.

## 8. Website password-reset defect (open; not fixed; not relied on)
Reported behaviour: the website reset flow failed. Not diagnosed here. Candidates to test at S13 (unverified hypotheses): the reset page reads the recovery token only from the URL hash (`type=recovery` in `src/pages/ResetPassword.tsx`) while newer Supabase flows can return a `?code=` query; the Development site URL may be missing from the Auth redirect allow-list; the reset e-mail may not be delivered (custom auth e-mail hook or provider). **Acceptance test to add to the S13 integration matrix:** a synthetic customer requests a reset on the Development site, receives the e-mail (approved recipients only), opens the link, sets a new password, signs in with it, and the old password stops working. Until then the defect stays open.

## 9. Authorization options (nothing happens until you answer)
- **A (recommended, no Claude write):** you do sections 4.1 to 4.3 yourself, then ask me to run the section 7 and 6 read-only checks.
- **B (Claude performs the ban): not available through a supported method.** The Supabase integration available to me offers SQL, migration, function and log tools only; it has no Authentication-admin operation. Banning by writing `auth.users.banned_until` or deleting `auth.sessions` rows would be improvising writes against managed Auth tables, which is excluded. So the ban itself is **your dashboard action** (section 4, steps 2 and 3); I do the surrounding verification: before (prerequisite 0.1) and after (section 7), read-only. Preserved by this: both Auth users, customer links, orders, contacts, audit trails, `business_email` and every legitimate master account.

## 10. Result: both accounts banned through the dashboard (2026-10-20 15:16 UTC; verified read-only 15:16:50)
- **Supported method used:** the dashboard's Ban user action; the Development Auth audit log records two `user_modified` events by the service role at 15:16:05 and 15:16:16. No write was made by Claude.
- **Banned:** demo master `baa7b068-da1f-45a3-b376-822e8166570d` until **2026-11-13 15:16:05 UTC**; second account `c9e6a72d-246e-476a-8dd7-6d1e53bbd298` until **2026-11-13 15:16:16 UTC**. Both are not deleted, both Auth records and identities remain, the demo master's `master` role row remains, and each still has its one linked customer row; the demo contact row and the `business_email` setting are unchanged.
- **Sessions:** the demo account still has 4 session rows and 4 refresh-token rows (newest activity 2026-07-18); the second has none. A banned user cannot refresh them; no new refresh events appeared. The rows were not deleted (no supported method used).
- **Untouched:** the Google master (signed in 14:54:48) and `hw***@gmail.com` are not banned; 2 of 9 users are banned in total; customers 123, contacts 95, orders 171, payments 185 unchanged; ledger 223 rows `e8f53b1e…`; containment unchanged (`anon` and `authenticated` without USAGE on `public`).
- **Open point:** the ban is **time-limited, about 24 days (to 2026-11-13)**, not permanent. When it expires both accounts accept the published password again. Before then: either extend the ban to a much longer duration, or rotate both passwords (section 5) and then decide about unbanning. Unban is reversible in the same dashboard menu; rotate before unbanning.

## 11. Completing the remediation: extend the bans, keep them disabled indefinitely (owner decision 2026-10-20)
The owner wants both accounts disabled **indefinitely** unless a legitimate business need to restore them arises, and does not want to rely on the current bans (to 2026-11-13) expiring silently.
- **Owner action (dashboard):** Authentication > Users > each account > menu > Ban user (or the ban-duration control) and choose the **longest duration the dialog offers**; do not touch anything else. Tell me when done.
- **I then verify read-only:** new `banned_until` for both ids (`baa7b068-…` and `c9e6a72d-…`); both still present and not deleted; the master role row, customer links, contacts, orders and the `business_email` setting unchanged; the Google master and `hw***@gmail.com` still active; no `login`, `token_refreshed` or sign-in event for either id in the Auth log after the ban; the ledger unchanged.
- **If a permanent ban is not offered:** the longest supported duration is recorded here with its exact expiry date and a **renewal date one month before it**; the residual risk is that an expired ban re-enables an account whose password is still the published one.
- **Residual risks to record after the extension:** (1) both passwords are unchanged and still match the published value; (2) already-issued access tokens may work until they expire (not since ban + token lifetime); (3) session rows remain (not refreshable); (4) the same demo account and password probably exist in Production (not examined; separate plan); (5) the website password reset is an open defect.
- **Rule for the future:** the passwords must be rotated (section 5) **before** either account is ever unbanned. Unbanning without rotating re-opens a MASTER login with a public password.
- **Gate status:** after the extension is verified, SEC-005 / G-03 for Development is **contained** (accounts disabled, alternate masters verified), **not permanently remediated** (passwords not rotated; Production unexamined). It becomes remediated for Development only when both passwords are rotated or the accounts are retired by an approved method, and for the whole product only when Production is handled.

