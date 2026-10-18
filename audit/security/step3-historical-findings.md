# Step 3A: historical findings and their evidence

Evidence classes: **LIVE-PROD** read-only catalog query run in this Step 3A (2026-10-17); **LIVE-DEV** read-only Development evidence from Step 2 (not re-run); **SNAP** Production snapshot of 2026-10-16; **LOCAL** local PostgreSQL rehearsal; **STATIC** repository code or SQL; **HIST** a concern recorded in a prior conversation. These are not interchangeable.

## 1. Access to the three required conversations

| Conversation | Retrieved | Coverage | Limits |
|---|---|---|---|
| Migration audit and cleanup | Yes, exported by session id; 281 user/assistant text messages, tool results included in the raw export | Complete from the first user message | The original SEC finding ids were already unrecoverable in Step 2 (audit section 0); labels SEC-A to SEC-J are Step 2's own, not historical ids |
| BPC production-to-dev data refresh solution | Yes; 152 text messages | The export begins with a compaction summary; the detailed pre-summary turns are present only as that summary | The urgent Production security verification inside it was interrupted by the user before completion ("[Request interrupted by user]"); its catalog-level conclusions are SNAP, not live |
| Large file refactoring audit | Yes; 67 text messages | Also begins with a compaction summary; pre-summary detail only as summary | Findings relating to the earliest audit turns are taken from the summary |

I read the exported text directly. Where a statement depends only on a summary, the register says so.

## 2. Findings by source

### A. Migration audit and cleanup (and the repository record it produced)
- Open "Service role full access" policies without `TO service_role` on 11 tables (15 policies) (SEC-001, 002). Now LIVE-PROD verified for `orders`.
- Anon execute on all 68 Production public functions, 55 of them SECURITY DEFINER (SEC-010). LIVE-PROD re-verified.
- Anonymous write policies, including `stripe_webhook_events` INSERT that could suppress a Stripe event (SEC-003).
- Default privileges from `supabase_admin` (SEC-015); LIVE-PROD shows 6 default ACL rows in `public`.
- Demo master account whose password is committed (SEC-005). Step 2 reported it present in Production; the handoff then called Production "unverified". LIVE-PROD now confirms it exists, holds `master` and signed in within 90 days.
- Public waiver, signature, photo and evidence buckets (SEC-018 to 020); LIVE-PROD confirms seven public buckets.
- `get_user_role` enumeration, `customer_profiles.contact_id` claim, `update_pricing_rules`, role-assignment arbiter bug, missing FK/CHECK/trigger (SEC-007 to 009, 013).
- Temporary `cli_login_postgres` roles (SEC-038).
- Replay-only issues, not vulnerabilities: contact-inquiry ordering (fixed 84cdc3e), role-constraint sequencing (fa08fb5).
- Correction found in this audit: `e2k-security-handoff.md` section 2 says no October file drops the `orders` policy. `20261012120000` section 2 drops every policy on `orders`. The handoff statement should be treated as superseded.

### B. BPC production-to-dev data refresh solution
- Production and Development both allow the public anon key to read/change customers, orders, payments, messages, addresses; reported from catalog inspection only (HIST/SNAP). LIVE-PROD this run confirms the `orders` policy and privileges.
- Development-only open `user_roles` policy (SEC-006).
- 61 SECURITY DEFINER functions anon-executable on Development at that time, including role and payment RPCs (SEC-011, 012).
- Public evidence buckets on Development with no policies (SEC-018 to 020).
- Hosted `send-email` v7 and `send-sms-notification` v6 had no caller authentication while Development holds live provider credentials and real customer data (SEC-030, 040).
- Environment isolation: local `.env` points at Production (SEC-041); the utility was built Production→Development only, Production read-only, with guards (8b4a514).
- A temporary Development lockdown (schema USAGE revoked) was applied; its end state is open (SEC-017).
- Process disclosures from that thread, not vulnerabilities: an accidental ACL change on the Windows Temp folder (disclosed, repair command blocked, guard added). The user was to repair it separately; this audit did not touch it.
- Deferred: the unfinished Production exposure assessment became Step 3.

### C. Large file refactoring audit
- `fix-payment-method`, `get-session-metadata`, `create-order-short-link` orphan unauthenticated functions (SEC-022 to 024). The first was fixed locally (84cdc3e); `create-order-short-link` fails closed and is retired by 20261009.
- `twilio-status-callback` JWT question, functions missing from config.toml (SEC-026, 032).
- 19 October migrations on neither Dev nor Production; 11 functions missing from both (deployment dependency).
- Dev buckets public; real customer data and live provider credentials on Development.
- Refactoring regressions: none identified as security defects. The audit kept payment/authorization code to type-only changes backed by tests.

## 3. Items in the prompt not found in any conversation
Stripe signature validation exists (`stripe-webhook`); Twilio signature validation does not (new finding SEC-025). Edge Function CORS, `admin_settings` secret storage, `sync-google-calendar`, `send-error-notification`, `checkout-bridge` and `get-payment-method` findings are new to this audit (static).
