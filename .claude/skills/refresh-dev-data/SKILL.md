---
name: refresh-dev-data
description: Refresh Development's order data from Production (preview, backup, explicit approval, replace, verify, restore). Use when the user wants current Production orders, customers or contacts in Dev, or wants to undo or check a previous refresh.
---

# Refresh Dev order data from Production

This wraps `scripts/dev-refresh` (see `scripts/dev-refresh/README.md`). The tool does the work; this skill only drives it and keeps the person informed. Production is only ever read. Development's schema, settings, inventory, pricing, templates, auth and Storage are never touched.

## Rules for you

- Never run `apply`, `restore` or `media-copy --execute` unless the user has just told you, in this conversation, to apply/restore/copy THAT run. A request to "refresh" means: preview, show the result, ask.
- Never type the approval phrase on your own initiative. The phrase is printed by `preview`; relay it and let the user approve.
- Never open, print or paste `.env.dev-refresh`, a connection string, or a run folder's data files (they hold real customer data). Quote only the summaries the tool prints.
- Never pass `--attest` yourself. The three confirmations (relays guarded, Auth email contained, Stripe edge secrets in test mode) are statements about hosted settings only the user can check; ask the user to confirm each, and pass only what they confirmed, naming them in your message.
- Never pass `--accept-drift`, `--include-backups` or `cleanup --execute` on your own initiative. A drift refusal means Development changed after the refresh: show the user the per-table counts and let them decide.
- Never use `--no-rehearsal` on a hosted database (the tool refuses it anyway).
- If anything fails, report the tool's message as it is. Do not retry with other flags, and do not edit the database by hand.

## Steps

1. Check the setup: `npm run dev-refresh -- doctor`. It must report both identities verified, "a write was refused" for Production, and Stripe test keys in Development. If `.env.dev-refresh` is missing, point the user at `.env.dev-refresh.example` and stop.
2. Preview (changes nothing that lasts): `npm run dev-refresh -- preview`.
3. Summarize for the user in plain words: how many Development rows will be deleted and how many Production rows imported per area (customers, orders, payments, tasks, messages, evidence rows); any warnings (pending Production payments, Production-only columns that will not be imported); the customer-login ownership counts; that the rehearsal succeeded. If the preview is "blocked", explain the reasons from the output; nothing was changed.
4. Ask whether to apply. Show the exact command line the preview printed (it includes the plan's approval phrase).
5. Only after a clear yes: run exactly that `apply` command. Report the verification checklist and the run id, and mention the undo command it prints.
6. To undo: `npm run dev-refresh -- restore --run <id> --confirm "<phrase>"`, only on the user's explicit request.
7. Evidence files: `npm run dev-refresh -- media-plan --run <id>` is read-only and tells how many waivers/photos referenced by the imported orders are missing in Development. Copying them (`media-copy --execute`) is a separate approval; it is additive and never overwrites.

## What to tell the user after a successful refresh

- Development now mirrors Production's orders, customers, contacts and order history as of the preview time.
- Real customer names, phones and emails are visible; every SMS and email sent from Development is redirected server-side to the approved test phone and the three test inboxes (this works only when the redirecting relays are deployed to Development).
- Imported orders have no saved card: charges and refunds must use Stripe test-mode objects created in Development.
- Only two customers' logins are linked automatically when the match is proven; the rest are listed in the run's report.
