# G-16: can the hosted operator run the three storage-policy migrations?

**Status: OPEN, evidence favorable, canary proposed but NOT executed.** Nothing was run on any hosted system for this document except read-only catalog queries.

## 1. Exactly what needs ownership of `storage.objects`
Read from the three files (`supabase/migrations/`):

| File | Needs ownership of `storage.objects` | Plain DML by grant (no ownership needed) |
|---|---|---|
| `20261014120000_protect_waiver_media_and_restrict_storage_access.sql` | a dynamic loop `DROP POLICY %I ON storage.objects` for **every** existing policy (line 75); 12 `CREATE POLICY ... ON storage.objects` (lines 84-130) | `UPDATE storage.buckets SET public = false` for 3 buckets (line 53) |
| `20261015120000_protect_customer_order_photos.sql` | loop `DROP POLICY` on every existing policy (line 56); 5 `CREATE POLICY` (lines 60-77) | `UPDATE storage.buckets SET public = false` for `lot-pictures`, `order-pictures` (line 42) |
| `20261015123000_create_private_order_evidence_storage.sql` | loop `DROP POLICY` (line 58); `DROP POLICY IF EXISTS "Staff upload public assets"` (line 63); new policies follow | `INSERT INTO storage.buckets` (line 33) |

None of the 28 files deletes, updates or inserts rows of `storage.objects` or touches Storage files.

**Minimum privilege:** ownership of the table `storage.objects` (PostgreSQL requires table ownership for `CREATE POLICY` and `DROP POLICY`), which means being the owner role `supabase_storage_admin`, a member of it, or a superuser. `storage.buckets` DML only needs the table privileges already granted.

## 2. Is the approved operator expected to have it?
| Observation (hosted Development, read-only, 2026-10-18) | Reading |
|---|---|
| `storage.objects` and `storage.buckets` are owned by `supabase_storage_admin` | the operator is not the owner |
| the `postgres` role is **not** a member of `supabase_storage_admin`, `supabase_admin` or `supabase_auth_admin`; it cannot CREATE in schema `storage` | ordinary ownership rules would refuse it (and a local emulation of exactly this profile fails with "must be owner of table objects") |
| `postgres` **is** a member of `supabase_privileged_role` (the role named by `supautils.privileged_role`), and `supautils` is loaded with a reserved-roles list | Supabase's supautils extension is designed to let this role do privileged operations that plain PostgreSQL would refuse; its exact rules for policies on storage tables are not readable here |
| The six policies now on `storage.objects` are exactly the ones created by two recorded migrations: `20260717110829` (three Admins/Public event-essentials policies) and `20260723174017` ("Anyone can upload lot pictures", "Authenticated can delete lot pictures"). Both versions are in the hosted ledger. | The same statement types (`CREATE POLICY ... ON storage.objects`) succeeded on this project through the migration channel, run by the CLI session role `cli_login_postgres`, which is a member of `postgres` |

**Conclusion:** it is probable that the operator can do it, because the same statements ran here before, and `postgres` carries the privileged role. It is not proven for `DROP POLICY` of policies created by others, and plain ownership rules say no. A canary is the cheapest way to turn "probable" into evidence.

## 3. The canary (`audit/step4/g16-storage-canary.sql`)
One statement, always ends in an error:
1. Stop unless the database is `postgres` and the six policy names on `storage.objects` are exactly the six recorded today.
2. `CREATE POLICY zz_bpc_canary ... FOR SELECT TO service_role USING (false)` then `DROP POLICY zz_bpc_canary`.
3. `DROP POLICY "Public can read event-essentials media"` (an existing policy created by an earlier migration, exactly what the real files do to every policy).
4. Check 5 policies remain, then `RAISE EXCEPTION 'BPC-CANARY-OK: ...'`.

**Result reading:** the error text `BPC-CANARY-OK` **is** success. `BPC-CANARY-STOP` means the precondition failed (drift: investigate). Any other error (for example `must be owner of table objects`) means the capability is not available: stop at once.

**Why the rollback is guaranteed:** the whole block is one `DO` statement that raises. An error aborts the statement and its transaction, so the database itself undoes every effect, in any channel (autocommit psql, `--single-transaction`, or the implicit transaction of one multi-statement SQL call). There is no `COMMIT` and no separate `ROLLBACK` to forget. Event triggers on DDL (PostgREST schema-cache notifications) are transactional and are discarded on abort. No row of any table is read except `pg_policies`; no customer data is touched; `SET LOCAL lock_timeout = 3s` and `statement_timeout = 20s` bound any lock wait. The table lock taken by policy DDL lasts for the few milliseconds of the block.

**Local rehearsal (scratch copy of the Development base, 2026-10-18):**
- As the table owner: the statement raised `BPC-CANARY-OK`; the policy count and an MD5 over (name, command, roles, qualifier) were identical before and after; no `zz_bpc_canary` remained.
- As a hosted-like non-owner (member of `postgres`, not of the storage admin): it raised `must be owner of table objects`; the policy digest was again unchanged.
- Under autocommit `psql -f`, `SET LOCAL` only warns (it needs a transaction block) but the `DO` block is still atomic, so rollback does not depend on it.

**Read-only recheck after the canary (mandatory):** `SELECT count(*), md5(string_agg(policyname || cmd || roles::text || coalesce(qual,''), ',' ORDER BY policyname)) FROM pg_policies WHERE schemaname = 'storage'` must return `6` and the same digest as before; `SELECT count(*) FROM pg_policies WHERE policyname LIKE 'zz_bpc%'` = 0; ledger export unchanged.

## 4. Approval and stop
- Requires explicit owner approval (G-16), the restore point recorded (S0) and the Supabase auto-deploy automation irrelevant (the canary is a SQL call, not a push).
- It runs as stage **S4b**, after S4 and before any October file.
- **PASS:** `BPC-CANARY-OK` and an unchanged recheck. **FAIL:** anything else.

## 5. If it fails (or the owner will not approve the canary)
The canary is the only mechanism that adds no new privilege. If it fails, no workaround is proposed that the owner has not separately approved: the dashboard SQL editor runs as the same role and will fail the same way; changing ownership of Supabase-managed tables, granting membership in `supabase_storage_admin`, or creating a SECURITY DEFINER wrapper owned by a platform role are all unapproved privileged workarounds. The remaining honest options are: ask Supabase support how the platform expects storage policies to be managed on this project, or defer the three files and the Storage tightening to a later owner-approved design. The rollout then stops before step 9 of the October block (`20261014120000`); steps 1-8 are already independent of Storage.
If the owner prefers not to run the canary, the alternative approval mechanism is to run the first of the three files itself as a normal rollout step with the executor: it is transactional, so a privilege error rolls back with no ledger row. That is acceptable only after steps 1-8 are committed and verified, and it is the same stop condition with a larger blast radius, so the canary remains the recommendation.
