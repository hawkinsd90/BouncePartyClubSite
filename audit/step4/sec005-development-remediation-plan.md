# SEC-005 Development remediation plan: two accounts share the published password (2026-10-20)

Status: **PLAN FOR OWNER AUTHORIZATION. NOTHING WAS CHANGED.** No account was banned, reset, modified or deleted; the published password was never used to sign in (hash comparisons inside read-only queries only); Production was not contacted. The website's password-reset page has failed before, so **nothing here depends on the public reset workflow** (see section 8).

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
- A password change does **not** by itself end other sessions (not verified for this project; treat it as not ending them). Ending them needs the session rows deleted (section 6, owner or authorized Claude).
- Therefore: **ban first, wait one JWT lifetime, then confirm sessions are 0 or delete them.** After any later unban the old password would work again, so **rotate before any unban.**

## 4. Exact owner procedure (dashboard; no password ever typed into chat, SQL or a file)
1. **Prove alternate access.** In a private browser window sign in to the Development site as `ha***@gmail.com` with Google (or `hw***@gmail.com` with its own password), open the admin area and a master-only tab (Permissions). If it does not work, **stop**; nothing else is changed. Optionally repeat with the second master.
2. Supabase dashboard > project `srxunxiytojjsuhcmzjg` (Development; check the name; never the Production project) > Authentication > Users.
3. Find the second account (`ad***@offline4ever.com`) > menu > **Ban user** (long duration). Find `admin@bouncepartyclub.com` > **Ban user** (long duration). Do not use "Send password recovery", "Send magic link" or "Delete user".
4. Wait one JWT lifetime. Then run the read-only checks in section 7 (the dashboard SQL editor, or ask me to run them). If any session remains, use section 6.
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
Ending sessions (hosted write; owner in the dashboard SQL editor, or Claude only after a separate authorization): `delete from auth.sessions where user_id in ('<demo user id>', '<second user id>');` (refresh tokens follow their sessions). It changes no other table.

## 7. Read-only verification after the action (no password involved)
```sql
select lower(u.email) like 'admin@%' as is_demo, u.banned_until is not null and u.banned_until > now() as banned,
       (select count(*) from auth.sessions s where s.user_id = u.id) as sessions,
       (select count(*) from auth.refresh_tokens r where r.user_id = u.id::text and not r.revoked) as active_refresh_tokens,
       (select count(*) from public.user_roles r where r.user_id = u.id) as role_rows
from auth.users u where lower(u.email) = 'admin@bouncepartyclub.com' or u.email ilike 'ad%@offline4ever.com';
```
PASS: both rows banned = true, sessions 0, active tokens 0, and the demo master's role row is still there (audit continuity). Note that a **ban leaves the stored password unchanged**, so `step3b-credential-check.sql` check 1 stays true after a ban; that is expected until the password is rotated.

## 8. Website password-reset defect (open; not fixed; not relied on)
Reported behaviour: the website reset flow failed. Not diagnosed here. Candidates to test at S13 (unverified hypotheses): the reset page reads the recovery token only from the URL hash (`type=recovery` in `src/pages/ResetPassword.tsx`) while newer Supabase flows can return a `?code=` query; the Development site URL may be missing from the Auth redirect allow-list; the reset e-mail may not be delivered (custom auth e-mail hook or provider). **Acceptance test to add to the S13 integration matrix:** a synthetic customer requests a reset on the Development site, receives the e-mail (approved recipients only), opens the link, sets a new password, signs in with it, and the old password stops working. Until then the defect stays open.

## 9. Authorization options (nothing happens until you answer)
- **A (recommended, no Claude write):** you do sections 4.1 to 4.3 yourself, then ask me to run the section 7 and 6 read-only checks.
- **B (Claude performs the ban):** only after you tell me you completed section 4.1; scope: ban the two accounts and delete their sessions, nothing else. The supported method is the dashboard; an SQL update of `auth.users.banned_until` is not verified to be permitted for the integration role, so I would not attempt it without your explicit authorization of that method.
