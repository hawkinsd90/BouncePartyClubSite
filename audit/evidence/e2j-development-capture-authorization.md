# E2J / E2J-A: authorization request for a read-only evidence capture of the Development project

**Status: a request. Nothing in this document has been done.** No hosted connection was made in E2J or E2J-A, no hosted role was created, rotated, granted, altered or dropped, no password was reset, and no Supabase CLI or connector command was used against a hosted project. Run nothing until the owner has answered section 10 in writing for this specific request.

**E2J-A revision (what changed):** the capture is now split into **Authorization A** (a genuinely read-only capture using an *existing* database role, no hosted state change) and **Authorization B** (an optional, separate role-provisioning operation, needed only if no suitable existing role can be used). **A does not authorize B.** The temporary-role proposal of E2J is demoted to Authorization B, and the safety protocol no longer depends on session defaults or startup options. The 42-statement query package and its evidence objectives are unchanged except for one safety correction to `Q00` statement 1 (section 2).

## 1. Which environment
**The Development project only.** Production is not contacted, queried or modified; comparisons with Production use the committed, hash-verified Stage B captures. The target is identified to the operator by the owner at run time and verified by `Q00`; the project reference is deliberately not written here.

## 2. Exactly what is run
- File: `audit/evidence/e2j-development-readonly-queries.sql`, SHA-256 `6f0be43297029950bf672ab0c7edf2610907ffeb8a35b37313b6a38aa63d57a3`. The operator re-computes it and compares before the run; any difference stops the run. (The E2J hash `5f3945a0…` is superseded.)
- 31 query ids (Q00 to Q30), 42 statements, each preceded by a tag line `-- @query Qnn <index>`, run **one at a time, each in its own connection and transaction**, the statement text taken from the file by a tool (copy, never retyped).
- **The one change in E2J-A (a demonstrated safety correction):** `Q00` statement 1 additionally returns `transaction_read_only`, `member_of_pg_read_all_data` and `can_insert_orders`. Reason: the default setting `default_transaction_read_only` does not show whether the *current transaction* is read-only, and a privileged role must be recognisable from the first output. Nothing else in the package changed; mapping of queries to migration versions and classifications (`e2j-readonly-query-review.csv`, `e2j-manifest-closure-rules.csv`) is intact.
- Every statement is a single `SELECT` without a locking clause; static checks found no DML/DDL/privilege/maintenance token, and every called function is STABLE or IMMUTABLE.
- Essential subset if the owner wants less: **Q00, Q01, Q02, Q03, Q04, Q05, Q09, Q10, Q12, Q13, Q18, Q19, Q22, Q26 and the freshness group Q20, Q21, Q23, Q24, Q25, Q29, Q30.** Q06, Q07, Q08, Q14, Q15, Q16, Q17, Q27, Q28 are optional; Q11 is essential-but-weak.

## 3. Four separate things that are easy to confuse
| Concept | What it does | What it does not do |
|---|---|---|
| **Read-only transaction** (`SET TRANSACTION READ ONLY`) | Makes PostgreSQL refuse INSERT/UPDATE/DELETE/DDL/GRANT/CREATE ROLE in that transaction, whatever the role may do | Is not a privilege; it covers only the current transaction; a role with write privileges can start a new, read-write transaction |
| **Session default / startup option** (`default_transaction_read_only`, `PGOPTIONS`) | Sets the default for later transactions | **Is not a boundary**: the same role can `SET` it off (shown locally). Startup options are also rejected by some poolers |
| **Privilege grants** (table SELECT, schema USAGE, `pg_read_all_data`) | Decide what the role can see and what it could change | Do not by themselves hide anything from RLS |
| **RLS visibility** (`BYPASSRLS`) | Decides whether policies filter rows | `pg_read_all_data` does **not** bypass RLS (a role with it but without `BYPASSRLS` saw 0 of 9 `storage.buckets` rows locally); a zero count from such a role looks like absence |
A PostgreSQL connection role is also not the same thing as an API key: the `service_role` entry in the Stage B capture is a **NOLOGIN** role reached through PostgREST with a JWT; the key cannot open a SQL session and these queries cannot run through it. The key is a high-value secret and must not be used or requested for this capture.

## 4. Role options (assessed from the Stage B Development role capture, 2026-10-16, and local profile tests)
| | A1: existing administrative role `postgres` | A2: existing platform read-only role `supabase_read_only_user` | A3: `service_role` key | A4: `cli_login_postgres` / CLI login | B: temporary dedicated role |
|---|---|---|---|---|---|
| In the capture | LOGIN; not superuser; BYPASSRLS; CREATEROLE, CREATEDB; member of `pg_read_all_data`; owns the 20 public tables; SELECT on `auth.users`, `storage.buckets`, `supabase_migrations.schema_migrations`; USAGE on those schemas | LOGIN; not superuser; BYPASSRLS; member of `pg_read_all_data`, `pg_monitor`; no write privilege | NOLOGIN, BYPASSRLS; API credential | LOGIN, member of `postgres`, expired 2026-10-16 18:00 UTC, created by a CLI login flow | Does not exist; would be created |
| Access sufficient for Q00 to Q30 | Yes (every relation read by the 42 statements is readable; catalog is public) | Yes by `pg_read_all_data` (all 42 statements ran locally with no other grant) | No SQL access | Not usable | Yes with the 23 SELECT grants |
| RLS behaviour | Bypassed (BYPASSRLS), no FORCE RLS on the 20 public tables | Bypassed | Bypassed, but not applicable | n/a | Bypassed only if created with BYPASSRLS |
| Can it write? | **Yes (owner of the application tables)**: protection rests on the per-transaction protocol and the hash-fixed statements | **No**: refused even with every session guard switched off (`permission denied`) | Yes | Yes | No |
| Hosted state change needed | None | None, **if the owner already holds a connection for it** | None, but the secret is exposed | The CLI path initialises login roles: excluded by the standing prohibition | **Yes**: a role, its grants and later its removal |
| Credential | The project database password: a high-value secret (also used by the application). Never reset it for this purpose (that is a hosted change and would affect running services) | Its password is platform-managed; whether the owner can obtain a direct SQL login is **unverified**. If it cannot be obtained without a reset or a dashboard action that creates state, treat A2 as unavailable | Rejected | Rejected | Owner-generated password for a temporary role |
| Verdict | Acceptable only under section 5 conditions, owner present | **Preferred** if obtainable without any hosted change | Not interchangeable; rejected | Rejected | Only under Authorization B |
Local profile tests (scratch copies of the captured schema; `tools/e2ja_validate.py`, role attributes modelled on the capture): the same 42 statements ran with identical output under the minimum-privilege profile, the platform read-only profile and the administrative profile (only `Q00_1` differs, as designed); the profile with `pg_read_all_data` but no `BYPASSRLS` differed on three statements (Q15_1, Q20_1, Q27_1). Outputs under the new protocol equal the E2J outputs except where ACL text contains the scratch role names (Q29_2, Q30_1).

## 5. Authorization A: the capture with an existing role (no hosted state change)
**Preconditions.** (1) The owner has a direct PostgreSQL connection for A2, or for A1 with the owner present as operator. (2) The connection is to the Development project (checked by `Q00`). (3) No role, password, grant or setting is created or changed to make this possible.
**Mandatory protocol (replaces E2J's startup-option guard).** One statement per connection:
```
psql "host=<owner-provided> port=<owner-provided> dbname=<owner-provided> user=<existing role> sslmode=require" -X -q -1 --csv -v ON_ERROR_STOP=1 \
  -c "SET TRANSACTION READ ONLY" -c "SET LOCAL statement_timeout = '30s'" -c "SET LOCAL lock_timeout = '3s'" \
  -c "SET LOCAL idle_in_transaction_session_timeout = '60s'" -c "<statement text from the hash-verified file>" > out_Qnn_<index>.csv
```
with the password only in the process environment for that connection. It uses no startup options, so it also works through poolers that reject them; use the direct or session connection, and record the `psql` version (tested with 18.4; test another version on a scratch database first).
**Validity rule, evaluated on `Q00_1` before anything else:** the run is valid only if `is_superuser = f` (never use `supabase_admin`), `bypasses_rls = t`, `transaction_read_only = on`; `can_insert_orders` tells the mode: `f` = a read-only role (A2), `t` = a privileged role (A1: the operator must be present and may run only the tagged statements). Otherwise stop.
**What protects the system, by layer:** (a) statements fixed by hash and statically checked; (b) read-only transaction, refused-write behaviour shown locally for INSERT, CREATE TABLE, GRANT and CREATE ROLE even for a role holding write privileges; (c) statement and lock timeouts (shown to cancel a long statement); (d) for A2 only: **no write privilege exists**, so even an operator error cannot write; for A1 this layer is absent and the residual risk is an ad hoc command typed on the privileged connection, which is why A1 requires the operator discipline above and no other tool connected as that role.
**What the local tests proved and did not prove.** Proved: 42/42 statements ran under every profile; outputs identical across profiles except `Q00_1`; before/after fingerprints of the catalog, ACLs, functions, policies and the hash of every row of 103 tables identical; none of 18 synthetic sensitive values and no credential-like string in any output; a role with write grants and the protocol could not write; with only the session default, the same role *could* write (temp table, nothing persisted); the read-only profile could not write even with the default off. Not proved (needs hosted access): that the hosted `postgres` password is available to the owner and acceptable to use; whether a direct login for `supabase_read_only_user` can be obtained without a hosted change; hosted table sizes and run time; hosted pooler behaviour; hosted RLS/`FORCE` configuration beyond the capture; whether any column queried contains unexpected sensitive content.

## 6. Authorization B: optional temporary-role provisioning (separate; not granted by A)
Needed only if neither A1 nor A2 is workable. It **changes persistent hosted state** (creates a role and grants, later drops them) and requires its own explicit written owner authorization, naming who executes it. Proposed definition (documentation only, not executed by me; the capture shows `postgres` holds CREATEROLE and BYPASSRLS, so creation is probably possible, which is unverified):
```sql
-- AUTHORIZATION B ONLY. Owner action, Development only.
CREATE ROLE bpc_evidence_ro LOGIN PASSWORD '<generated by the owner, never shared>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 2;
GRANT USAGE ON SCHEMA public, auth, storage, supabase_migrations TO bpc_evidence_ro;
GRANT SELECT ON auth.users, public.addresses, public.admin_settings, public.admin_settings_changelog, public.contacts, public.customer_profiles, public.customers,
  public.email_templates, public.google_reviews, public.hero_carousel_images, public.invoice_links, public.invoices, public.notification_system_status, public.orders,
  public.payments, public.pricing_rules, public.sms_message_templates, public.stripe_webhook_events, public.unit_media, public.units, public.user_roles,
  storage.buckets, supabase_migrations.schema_migrations TO bpc_evidence_ro;
-- after the run:  DROP OWNED BY bpc_evidence_ro; DROP ROLE bpc_evidence_ro;
```
Under B the capture then follows the same protocol and validity rule. B would be logged as a hosted change; a failure to drop the role is itself a stop condition.

## 7. Duration, outputs, privacy, freshness (unchanged unless stated)
- Under two minutes expected for 42 statements; run off-peak and sequentially; 30 s statement and 3 s lock timeouts. `Q14` and `Q15` are the heaviest; skip them if they exceed 30 s.
- Outputs: `C:\Users\vikki\migration-evidence\e2j-dev-capture-<UTC timestamp>\` (outside Git): 42 `out_Qnn_<index>.csv` files, `run-record.json` (UTC times, operator, `psql` version, role and database from `Q00`, SHA-256 of the query file and of every output) and `operator-notes.md`. Raw outputs are never committed; after owner review only derived summaries (counts, booleans, key names) enter the repository in a new evidence file.
- Output minimization: the queries return counts, flags, key and template **names** (never values), bucket settings, catalog definitions, ACL text and hashes. Q26 returns one boolean about a login whose address is already committed in a migration. If any output contains an e-mail address, phone number, name, token, key, credentialed URL or payment value: stop, delete that file, tell the owner. No output is pasted into chat.
- Freshness: Stage B captures are dated 2026-10-16. Run in one session; `Q01` must reproduce exactly the 58 captured ledger rows; results are valid for manifest decisions for at most 7 days and only while the owner confirms no hosted change; repeat `Q00` and `Q01` immediately before any later ledger or schema action.
- Integrity: the run record carries the file hash and every output hash so that a later reader can detect substitution or reordering; a partial run is labelled partial and is never merged with a later run.

## 8. Stop conditions
1. `Q00_1` shows a database or role other than the intended Development target, `is_superuser = t`, `bypasses_rls = f` or `transaction_read_only <> on`.
2. The SHA-256 of the query file differs from section 2.
3. Any statement errors (other than a documented timeout) or exceeds 30 s; or `Q01` differs from the 58 captured rows.
4. A password prompt, secret or connection string appears anywhere except the owner's own terminal environment, or any credential is typed into chat, a file or command history.
5. Any output contains personal, payment or credential data.
6. The role holds more privilege than assumed and the operator is not present (A1), or any ad hoc command would be needed on a privileged connection.
7. Anything would require changing the hosted database, a password, a role or a setting to proceed (including a password reset to obtain a login).
8. Under B: the role cannot be dropped afterwards.
After a stop: close the connection, preserve files already written, report; do not retry without a new owner decision.

## 9. Confirmation that the operation cannot change migration history or schema
Under A2 four independent layers apply (fixed read-only statements; no write privilege; read-only transaction; timeouts). Under A1 three apply (the privilege layer is absent, the owner-present operator rule replaces it). Migration history is referenced only by `SELECT … FROM supabase_migrations.schema_migrations` in Q01. No layer depends on a startup option or on a session default.

## 10. What the owner is asked to decide
**Authorization A: capture with an existing role**
| # | Decision | Default |
|---|---|---|
| A1 | Approve a read-only capture on the Development project using an existing role | No |
| A2 | Which existing role: platform read-only role (preferred, only if a direct login already exists to you without any hosted change) / the administrative role with the owner present as operator | Not approved |
| A3 | Query set: full (31 ids) / essential subset (section 2) | None |
| A4 | Operator and off-peak window | None |
| A5 | May Q14 and Q26 read `auth.users` (count / boolean only)? | No (both skipped) |
| A6 | Retention of the raw outputs | 30 days, then delete |

**Authorization B: temporary role provisioning (separate decision; not implied by A)**
| # | Decision | Default |
|---|---|---|
| B1 | Authorize creating and later dropping `bpc_evidence_ro` on Development, with the definition in section 6, executed by a named person | No |

Suggested wording for A: "I approve a read-only capture on the Development project only, using `e2j-development-readonly-queries.sql` with SHA-256 `6f0be432…57a3`, through the existing role I name, with the per-transaction read-only protocol and the stop conditions in section 8. This does not authorize creating or changing any role, grant, password or setting."
