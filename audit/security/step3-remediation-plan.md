# Step 3B remediation plan (proposal for owner review; nothing implemented)

Principles: forward-only new migrations; no edits to applied history except the owner-approved redaction in SEC-005; no copy of Production grants into Development; no duplication of 20261007 to 20261025; containment stays until verification.

## Urgent notice (outside Step 3 scope, owner decision)
Live read-only catalog checks show Production **today** has the open `orders` policy, full anon table privileges and anon USAGE on `public` (SEC-001), 15 open "Service role" policies (SEC-002), anon USAGE/UPDATE on two sequences, seven public buckets, and an active-looking master demo account (SEC-005). Step 3 does not touch Production. A Production hotfix or the credential rotation is an owner call; the committed local fixes are the intended eventual remedy. I did not test exploitation.

## Work packages, in dependency order

### P0. Test baseline (no behavior change)
- Start the documented scratch PostgreSQL (port 54329) and replay Production-shaped and Dev-shaped schemas; run all security suites with `CORE_DB_REQUIRE=1` so nothing skips.
- Fix the two stale assertions (SEC-042, 043) to the recovered facts. Files: the two test files only.
- Add allow-list tests: anon-executable functions (SEC-010), anon-writable policies (SEC-003), `%service role%` policy count (SEC-002), `orders` has no public/anon policy (SEC-001), sequence privileges (SEC-014), `admin_settings` access (SEC-039), every function directory has a config block (SEC-032).
- Rollback: tests only.

### P1. Database corrections (new forward migrations, each guarded and idempotent)
Numbering follows the last repository migration (after `20261025120000`), so they run after the October files and need no interaction with ledger differences between environments.
1. **Sequences** (SEC-014): `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated`; confirm number generators are SECURITY DEFINER first.
2. **Leftover anon function exposure** (SEC-010, 037): only if the P0 allow-list test shows leftovers after the October files; revoke by name; pin `search_path` on the unpinned definer.
3. **Missing policies** (SEC-036): crew `task_status` INSERT, `transaction_receipts` UPDATE, narrowly scoped.
4. **Development grants** (SEC-016): `GRANT SELECT` on the eight catalog tables to `service_role`, skipping absent tables.
5. **Default privileges** (SEC-015) and **schema end state** (SEC-017): decision items; test first whether `postgres` may alter `supabase_admin` defaults.
6. **`admin_settings`** (SEC-039): only if the catalog query finds a gap.
7. **`pending_signups_consent`** (SEC-004) and **crew scope** (SEC-035): owner decisions; implement only if chosen.
Each migration: header with provenance, `IF EXISTS` guards, no data changes, no change to legacy objects; tested on both replays; recovery = the inverse GRANT or policy statement recorded in the header.

### P2. Edge Function corrections (code only, no deploy)
- Retire `get-session-metadata` and `get-payment-method` to 410 (SEC-023, 024), following `stripe-charge`.
- `twilio-webhook` and `twilio-status-callback`: X-Twilio-Signature validation using a shared helper (SEC-025, 026).
- `sync-google-calendar`: service-role or admin only, after reading the trigger's authentication (SEC-027).
- `send-error-notification`: escape, cap, rate-limit (SEC-028). `checkout-bridge`: escape and allow-list origin (SEC-029).
- `config.toml` completeness and `record-consent` decision (SEC-032). Remove the `send-booking-confirmation` dependency (SEC-031).
Reuse `_shared/auth.ts` and `_shared/rate-limit.ts`. No payment, refund or webhook-idempotency logic changes.

### P3. Application and operational items
- Guard against launching the dev server at the Production ref (SEC-041).
- Sanitize template preview (SEC-045); run `npm audit` when online.
- SEC-005: owner rotates the credential; then, with approval, redact migration 015 and add the literal-scan test. I will not authenticate with it.
- SEC-038: standing rule in the Step 4 procedure.

### P4. Evidence pack
Replay output, allow-list diffs and an updated register status column, committed to `Dev` locally after owner approval of each package.

## Effects on business workflows
Bookings (create-booking, complete-booking, grants), payments and refunds (no change in P1 to P3), customer portal (unchanged), admin invoices (sequence revoke affects only anon/authenticated direct use), crew (SEC-036 restores two gaps), SMS (webhook signature depends on correct public URL). Highest risk is ordering: October database files before their Edge Functions.

## Interaction with Step 2
The deny lists and manifests are untouched. New migrations are appended after `20261025120000`; Step 2's per-environment bookkeeping needs two small additions (new versions in the Development and Production plans). The Step 3B change must regenerate the manifests with the existing generators and re-run the manifest tests.

## Step 3B status (2026-10-17)
Implemented locally and uncommitted; see `step3b-implementation-report.md`. Two deviations from this plan, both from evidence: (1) SEC-010 needed no new revoke (the allow-list holds on all three database shapes), so P1 item 2 became a permanent allow-list test; (2) the sequence migration also removes anonymous table privileges where no anonymous policy exists (SEC-039 defence in depth) and a trigger guards the confirmation columns (new SEC-047). Migrations are `20261026120000` to `20261026120400`.
