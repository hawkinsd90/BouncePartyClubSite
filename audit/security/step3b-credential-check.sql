-- READ-ONLY verification for the owner after the demo master account (SEC-005) has been rotated. NOT a migration. Run on Production and on
-- Development SEPARATELY, from a SQL session, after you have changed the password in the Supabase dashboard.
--
-- The old credential is never written to this file. Pass it from your own shell so it appears in no command history you share:
--     psql "<connection string>" -v old_secret="$OLD_SECRET" -f audit/security/step3b-credential-check.sql
-- (OLD_SECRET is the documented value in supabase/migrations/20251003170350_015_create_demo_admin_user.sql; read it yourself.)
--
-- Every statement is a single SELECT inside a READ ONLY transaction that returns booleans and counts only (no hash, no email list, no token).
BEGIN READ ONLY;

-- 1. The demo account no longer accepts the old credential. Expected: false.
SELECT (encrypted_password = crypt(:'old_secret', encrypted_password)) AS demo_account_still_uses_old_secret
FROM auth.users WHERE email = 'admin@bouncepartyclub.com';

-- 2. No account at all accepts the old credential. Expected: 0.
SELECT count(*) AS accounts_still_using_old_secret
FROM auth.users WHERE encrypted_password IS NOT NULL AND encrypted_password = crypt(:'old_secret', encrypted_password);

-- 3. The account's roles are unchanged and you still have other working masters. Expected: demo_roles as before; other_masters >= 1.
SELECT
  (SELECT string_agg(r.role, ',' ORDER BY r.role) FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id WHERE u.email = 'admin@bouncepartyclub.com') AS demo_roles,
  (SELECT count(*) FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id WHERE lower(r.role) = 'master' AND u.email <> 'admin@bouncepartyclub.com') AS other_masters;

-- 4. Sessions: refresh tokens issued to the demo account before the rotation are gone (if you chose to sign it out). Expected: 0 after sign-out.
SELECT count(*) AS live_refresh_tokens_for_demo_account
FROM auth.refresh_tokens t JOIN auth.users u ON u.id = t.user_id::uuid
WHERE u.email = 'admin@bouncepartyclub.com' AND coalesce(t.revoked, false) = false;

ROLLBACK;
