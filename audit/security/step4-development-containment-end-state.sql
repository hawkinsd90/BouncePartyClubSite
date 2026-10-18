-- Step 4 ONLY, last step, hosted Development only. NOT a migration. Do not apply during Step 3.
--
-- Development's schema containment (anon/authenticated lack USAGE on schema public, set during the data refresh) is removed
-- only AFTER the October chain and the Step 3B migrations are applied and the allow-list checks in
-- src/lib/tests/security/securityPosture.test.ts (queries repeated in audit/security/step3-test-plan.md) pass against
-- Development. Order matters: reopening the schema before the policies are fixed exposes real customer data.
--
-- Production already has USAGE for these roles and needs neither statement for USAGE; the CREATE revoke is also safe there.
-- Reversible: the opposite GRANT / REVOKE statements.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM service_role;
