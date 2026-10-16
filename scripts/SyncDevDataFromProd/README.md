# Production -> Development order data refresh

Replaces Development's **order data** with the current Production order data, on demand. Production is only ever read. Nothing runs
on a schedule, and nothing is deployed: it is a command-line tool that uses the PostgreSQL client (`psql`) already used by the
repository's database tests.

```
npm run syncDevDataFromProd -- doctor                       check setup, identities, Stripe mode
npm run syncDevDataFromProd -- preview                      DEFAULT. Reads Production, rehearses the whole replacement, changes nothing that lasts
npm run syncDevDataFromProd -- apply   --run <id> --confirm "<phrase printed by preview>" --attest relays-guarded,auth-email-contained,stripe-edge-secrets-test
npm run syncDevDataFromProd -- restore --run <id> --confirm "<phrase printed by apply>" [--accept-drift "<phrase>"]
npm run syncDevDataFromProd -- verify  --run <id>           independent post-checks of an applied run
npm run syncDevDataFromProd -- runs                         list runs
npm run syncDevDataFromProd -- protect                      restrict .env.SyncDevDataFromProd and the run folders to your account
npm run syncDevDataFromProd -- cleanup [--include-backups] [--execute --confirm "<phrase>"]   list (default) or delete local run data
npm run syncDevDataFromProd -- audit-functions --project dev --file functions.json   compare deployed Edge Functions with the reviewed ones
npm run syncDevDataFromProd -- media-plan --run <id>        which waivers/photos of the imported orders are missing in Development (read-only)
npm run syncDevDataFromProd -- media-copy --run <id> [--execute --confirm "<phrase>"]   additive copy of missing evidence files
```

**Naming.** This utility was previously called `dev-refresh`. It is now `SyncDevDataFromProd` (folder `scripts/SyncDevDataFromProd/`, workspace
`.SyncDevDataFromProd/`, credentials `.env.SyncDevDataFromProd`, npm command `syncDevDataFromProd`, test group `syncDevDataFromProd`). Two kinds of
identifiers were intentionally NOT renamed: the credential variable names inside the credentials file (`DEV_REFRESH_PROD_DB_URL`,
`DEV_REFRESH_DEV_DB_URL`, `DEV_REFRESH_*`), so an existing credentials file keeps working, and the local scratch-test names (`devrefresh_*` databases,
`DEVREFRESH_*` switches). Synchronization is one-way only: Production is read, Development is written.

The same workflow is available as the `/SyncDevDataFromProd` Claude Code skill (`.claude/skills/SyncDevDataFromProd`).

## One-time setup

1. Install the PostgreSQL client tools (`psql`). On this machine they are in `C:\Program Files\PostgreSQL\18\bin`; set
   `DEV_REFRESH_PSQL` if yours lives elsewhere.
2. Copy `.env.SyncDevDataFromProd.example` to `.env.SyncDevDataFromProd` (git-ignored) and fill in the two database connection strings
   (Supabase -> Project Settings -> Database). The tool refuses a string that does not name the project its slot says.
3. `npm run syncDevDataFromProd -- protect` (restricts the credentials file and the run folders to your account), then `npm run syncDevDataFromProd -- doctor`.

### Before the first hosted refresh

A hosted `apply` also needs a **successful rehearsal of the exact preview** (`--no-rehearsal` is refused for hosted databases; it exists
only for the local scratch databases of the tests) and three confirmations (`--attest`) about things no tool can read from here:

| confirmation | what you check |
|---|---|
| `relays-guarded` | The Development `send-email` and `send-sms-notification` functions are deployed from the version containing the outbound guard, and `audit-functions` (see below) reported no unreviewed function. |
| `auth-email-contained` | Development Authentication -> SMTP Settings: no custom SMTP (the built-in sender only delivers to your organization's team members), or one that reaches only the test inboxes; Authentication -> Hooks: no Send Email hook. |
| `stripe-edge-secrets-test` | Development Edge Function secret `STRIPE_SECRET_KEY` (read by `get-payment-method`, `get-session-metadata`, `stripe-webhook`) is a test key, and no Stripe webhook endpoint (in the Stripe test-mode account) delivers events to the Production project. A Development webhook is not required; if one exists it points only at Development. |

**Waiving `relays-guarded` (this one only, per run).** If the guarded relays are deliberately not deployed yet, `apply` accepts
`--waive "relays-guarded=<written reason>"` instead of `--attest relays-guarded`. The reason (at least 40 characters) must say what is not in
place, what contains the risk, and what will not be used meanwhile. It is recorded in the run manifest and report under
**WAIVED — NOT VERIFIED**, separately from the confirmations that were made. It exists only in that one command: the next `apply` needs its
own waiver. `auth-email-contained` and `stripe-edge-secrets-test` can never be waived, and no database protection can be waived. `--waive` may be
given once; confirming and waiving the same name is refused.

`audit-functions`: `npx supabase functions list --project-ref srxunxiytojjsuhcmzjg -o json > functions.json`, then
`npm run syncDevDataFromProd -- audit-functions --project dev --file functions.json`. Anything deployed that is neither in this repository nor a
reviewed hosted-only function (today: `send-booking-confirmation`, which only calls the two relays) stops you until it has been read.

## What a refresh does

1. **Identity.** Both connections must name the right Supabase project (user `postgres.<ref>` or host `db.<ref>.supabase.co`) **and** the
   database itself must say so (`admin_settings.supabase_url`). Production's session is opened read-only and the tool proves a write is
   refused before it uses the connection. Development's Stripe keys must be test keys.
2. **Preview.** Reads both schemas and stops on any incompatibility. Takes one consistent read-only snapshot of Production into the run
   folder. Counts the Development rows that would be deleted and lists their ids. Then **rehearses** the complete replacement inside a
   Development transaction that is always rolled back, so every constraint in Development's real schema is exercised. Prints the exact
   approval command.
3. **Approval.** `apply` needs the run id and the exact phrase (it contains the Development database and the plan hash). A preview is
   refused if it is older than 24 hours, if the export files were altered, if Development's schema changed, or if the Development rows
   being replaced changed since the preview.
4. **Backup.** The Development rows about to be replaced (and the references from other tables to them) are written to `backup/` and
   checked against row counts and checksums.
5. **Replace, in one transaction.** Lock the replaced tables, re-check nothing changed, stage the Production rows in temporary tables,
   validate them (orphans, missing reference data, duplicate keys, NOT NULL gaps) **before any delete**, switch off only the named
   application triggers, delete, insert, fill circular references, put preserved references back, verify the imported rows against the
   source rows both ways, verify that every table the refresh must not touch is byte-identical to before, restore every trigger to
   its original enabled state, check it, and commit. Any failure rolls the whole transaction back.
6. **Verify** in a fresh session, and write `report.md`.
7. **Restore** (if wanted): deletes the replaced rows again and re-inserts the backup, and proves the result hashes to exactly what the
   backup recorded.

Foreign keys, unique, check and not-null constraints are **never** switched off, `session_replication_role` is never used, nothing is
truncated, and no `CASCADE` is used.

## Scope

Replaced (`lib/config.mjs`, `REPLACE_TABLES`): customers, addresses, contacts, orders, billing_addresses, order_signatures, order_items,
order_discounts, order_custom_fees, order_notes, order_changelog, order_workflow_events, payments, order_refunds, transaction_receipts,
invoices, invoice_links, consent_records, task_status, route_stops, crew_location_history, documents, messages, sms_conversations,
order_pictures, order_lot_pictures, address_lot_pictures. Development-only tables hanging off orders (`order_portal_links`,
`booking_setup_proofs`) are emptied with their orders.

Never touched: schema, migration history, Edge Functions, auth users and sessions, roles, `admin_settings` (credentials), pricing rules,
inventory/units/media, the product catalog, templates, blackout rules, Stripe webhook log, analytics, rate limits, **Storage objects,
buckets and policies**.

A dependency the lists do not account for stops the run: an unlisted table that would lose rows through `ON DELETE CASCADE`, one whose
reference would make the delete fail, a new foreign key that points forward, a trigger nobody reviewed (`REVIEWED_TRIGGERS`), a column
type or a required column that differs.

## Financial safety

- Imported payments, receipts, refunds and invoices are **history**; nothing replays them. The tool never calls Stripe.
- The three reusable instruments of an order - `stripe_customer_id`, `stripe_payment_method_id`, `payment_method_id` - are **not
  imported**. The application treats an order as having a saved card only when both ids are present, so imported orders ask for a
  (test) card instead of trying to charge a Production id. The originals are written to `outputs/stripe-quarantine-*.copy` in the run
  folder, outside the database. Ledger references (payment intent, charge, refund ids) are kept unchanged: they are history, and unique
  indexes are built on them.
- Development keeps working with Stripe **test mode** (charges, refunds, saved test cards, invoices). Before it imports payment history
  (preview, and again at apply) the tool positively confirms Development is in test mode: both `stripe_secret_key` and
  `stripe_publishable_key` must exist and be test keys (`sk_test_`/`rk_test_`, `pk_test_`). A missing, empty, unrecognizable or live key
  - or a missing settings table - blocks the run. The class is computed inside the database; a key is never read out or printed.
  The Stripe Edge Function secret (a separate setting no tool can read) is the `stripe-edge-secrets-test` confirmation.
- `orders.payment_lock` is forced to `false` (a payment that was in flight in Production can never finish in Development).

## Customer ownership (login links)

`customers.user_id` decides who can see an order in the portal. It is kept only when the relationship is proven and unique:
**A** the Development login has the same id as the Production customer's login *and* the same email; or **B** the customer had a
Production login and exactly one confirmed Development login has the same email. Everything else is set to NULL and listed in
`outputs/auth-unlinked-customers.copy` with the reason (conflicting id/email, ambiguous email, unmatched, collision). Other
staff-attribution columns keep their value only when that user exists in Development; the rest become NULL and are listed in
`outputs/auth-attribution-*.copy`. Links from preserved tables (`customer_profiles.contact_id`, `user_consent_log.customer_id`,
`site_events.order_id`) are remembered and restored when the same row exists again; a profile is re-linked to a contact only when
the login's email is the contact's email.

## Notifications

Independent of this tool, `supabase/functions/_shared/notifications/outbound-guard.ts` is used by the two relays (`send-email`,
`send-sms-notification`) after authorization and just before the provider call: Production sends to the real recipient, Development
sends only to `+17343588854` and the three test inboxes, any other project sends nothing. It reads no environment variable, so it can
not be switched on in Production. It protects Development only once these relays are deployed there.

## Evidence files

The refresh replaces database rows only. `media-plan` lists, for the imported rows, which waiver/signature/photo objects already exist
in Development, which are missing (and available in Production), which conflict (different content; never touched), and which Development
objects are no longer referenced (reported, never deleted). `media-copy --execute` copies only the missing objects, never overwrites
(`upsert: false`), never deletes, and verifies each copy byte for byte; it needs service keys in `.env.SyncDevDataFromProd` and a separate approval.

**Privacy before copying.** The evidence buckets (`signed-waivers`, `signatures`, `public-assets` delivery/pickup photos, `lot-pictures`) hold private customer
evidence. Make them private in Development (and make sure no Storage policy lets `anon`/`authenticated` read them) BEFORE running `media-copy`.
Note that the imported rows keep their original **absolute Production Storage URLs** (`https://<production>.supabase.co/storage/v1/object/public/...`).
Those URLs stay publicly reachable through Production's own public buckets regardless of any Development bucket setting; the refresh never rewrites them.
Copying the objects makes them available under the same bucket and path in Development for code that resolves references against the current project.

## Restore and drift

`restore` replaces the order tables again, so it first checks that Development is still **exactly the state the refresh left**. The apply
records the fingerprint and one hash per row of every replaced table (inside the transaction that commits). If anything was created,
changed or removed afterwards - or a newer refresh has run - the restore stops, prints per table how many rows were added, modified and
removed, and changes nothing. To go ahead anyway you must add `--accept-drift "DISCARD CHANGES MADE AFTER REFRESH <id>"`.
Whether or not there was drift, every restore first writes a **safety copy of the current state** (`pre-restore-*` in the run folder), so a
restore never destroys data that has no copy. A run can be restored once.

## Sensitive local files and retention

Everything under `.SyncDevDataFromProd/` (Production exports, Development backups, Stripe-reference and customer-id reports, row hashes) and
`.env.SyncDevDataFromProd` (database passwords) is readable by your account only (Windows: inherited access removed, only you granted; other systems:
mode 700 / 600). The tool creates run folders private before writing into them and refuses to use a credentials file that other accounts
can read (`protect` fixes it; `doctor` reports it). Passwords are passed to `psql` through its environment and are never written to a run
folder, a manifest or a report.

Nothing is ever deleted automatically. `cleanup` lists what the retention policy allows and what it keeps; `cleanup --execute --confirm
"<phrase>"` deletes exactly that list:
- the Production copy (`export/`) of finished runs, and of expired previews, at once;
- reports (`outputs/`, `dev-rows-to-replace/`, `after-*`) after 30 days;
- backups only with `--include-backups`, and never the restore point of the most recent applied run, or any interrupted run's;
- `manifest.json` and `report.md` (the audit trail, no customer data) are never removed.

## Files

Run folders (`.SyncDevDataFromProd/runs/<id>/`, git-ignored, contain real customer data): `manifest.json`, `report.md`, `export/` (Production rows),
`backup/` (replaced Development rows), `dev-rows-to-replace/` (ids), `outputs/` (quarantine and ownership reports).

## Tests

`src/lib/tests/syncDevDataFromProd/*.test.ts`, run with `node scripts/dev/run-tests.cjs syncDevDataFromProd`. The replacement scenarios use throw-away
databases on the local test server (`devrefresh_<name>_prod` / `_dev`) and synthetic rows only.
Creating a database is slow on some machines, so each test file keeps ONE pair (`devrefresh_rep1_*` ... `devrefresh_rep7_*`, `devrefresh_t_*`) between runs
and empties and refills it for every scenario; a kept pair is reused only if its structure fingerprint matches a freshly built one, otherwise it is
rebuilt (the first run after a schema change therefore takes about a minute longer). Set `DEVREFRESH_DROP_SCRATCH=1` to drop the pairs after a run;
to remove them all: `DROP DATABASE` for every database whose name starts with `devrefresh_` on the local test server.
