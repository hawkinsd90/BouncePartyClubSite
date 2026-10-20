# S2 attestation decision package: evidence and recommendations for the 44 versions

Status: **FOR OWNER DECISION. RECOMMENDATIONS ARE NOT SIGNATURES. NOTHING IS ATTESTED, SIGNED OR RECORDED.** No ledger row exists for any of the 44 versions and no migration SQL ran. Evidence below comes from read-only queries on Development on 2026-10-20 (ledger 223 rows, SHA-256 `e8f53b1e951463a8731ac8fdb7497b689c4677da437cad02ff7b29b1b493bbf4`) and from reading each migration file. Production was not contacted. Queries and results: `s2-attestation-readonly-checks.sql`, `sec005-travel-d20-readonly-checks.sql` and `s2-attestation-readonly-results.json`.

## 1. Summary
| Recommendation | Count | Versions |
|---|---|---|
| ATTEST | 42 | all others (42) |
| NEEDS OWNER REVIEW | 2 | D20, D21 |
| REJECT | 0 |  |

**Important:** the Development database is a snapshot whose rows date from 2025-10-16 (the earliest order is 2026-04-02), so a historical back-fill can be *visible* (the end state is present) but never *proven to have run*. For that reason every ATTEST below is worded as "the state exists", never "the SQL executed". "Rerun risk" answers a different question (what would happen if the original SQL ran again); a safe rerun is not treated as proof of the state.

What an ATTEST means in the ledger: `attestation NOT EXECUTED`, your name, UTC date, scope, what is not proven, and an evidence hash. What a REJECT means: nothing is recorded; the version stays pending and blocks the batches in section 3.

## 2. Findings that need your attention first
1. **D21: the MASTER login with a publicly known password is now contained, not remediated (SEC-005, gate G-03).** `admin@bouncepartyclub.com` and a second account (`ad***@offline4ever.com`) still accept the published password, but both were **banned through the dashboard on 2026-10-20** (currently until 2026-11-13; the owner is extending the bans to the longest supported duration). Auth records, role row, customer links, contacts and the business-email setting are intact; the Google master signed in freshly and is verified, a second master is active. Residual risks: passwords unchanged (rotate before any unban), issued tokens may live until they expire, session rows remain, Production not examined. See `sec005-development-remediation-plan.md` sections 10 and 11.
2. **D20: customer totals are stale, and the cause is a second, older trigger.** 41 of 92 contacts have a stale total_spent and 24 a stale booking count (57 need a change); all 92 stored totals equal the OLD formula because `update_contact_stats_trigger` runs after the corrected one on every order update and overwrites it. One durable, tested package (one mechanism, triggers for every input, the obsolete writer removed, the 57 contacts repaired) is prepared in `d20-durable-correction-plan.md`; because it changes the schema it is placed after the sealed executor stages (S5 to S7), as a separately authorized S12b operation.
3. **D10 is decided: ATTEST (owner decision 2026-10-20).** The stored $3.00 per mile is authoritative; the migration's $5.00 is obsolete and is recorded as superseded. `pricing_rules` is not changed and the SQL must never run. **Historical charges are safe:** every order stores its own fee and the rate, radius and miles behind it; a stored positive fee is reused on edit. One latent gap exists for orders whose stored travel fee is 0 (an edit re-prices them from today's rules); no Development order would change today. A minimal remedy is proposed, not implemented (`travel-fee-historical-preservation-review.md`).
4. **Not attestation questions, but seen while checking (for the October security migrations):** any signed-in user can read and update SMS templates (D18 policies, `true`); anonymous callers can insert into notification tables and run three SECURITY DEFINER notification functions (D40). Twilio credentials are stored in `admin_settings`.

## 3. Dependencies
| Batch | Versions | Blocks |
|---|---|---|
| B13 | D22, D23, D24, D25, D26, D27, D28 | none |
| B14 | D18, D29, D30, D31, D32 | none |
| B15 | D10, D11, D12, D13, D14, D15 | none |
| B16 | D34, D35, D36, D37, D38, D39 | none |
| B17 | D40, D41, D42, D43, D44 | B38 |
| B18 | D16, D17 | B31 |
| B19 | D01, D02, D03, D04, D05, D06, D07, D19 | none |
| B20 | D08, D09 | none |
| B21 | D20 | B31, B33 |
| B22 | D21 | none |
| B37 | D33 | none |

B18 and B21 gate B31 and B33, which gate B40 (36 history-only versions). A batch is one transaction: if you reject a member of a batch, that whole batch cannot run as prepared and I would re-split it.

## 4. Your four named cases
### D18: SMS templates and the removed test template: recommended **ATTEST** (high confidence)
- **What the migration did:** Table sms_message_templates with RLS, update trigger and six default templates (order_confirmation, order_approved, order_rejected, payment_reminder, delivery_notification, test_message).
- **What Development shows:** Table exists. 5 of the 6 keys are present; test_message is absent (you state its removal was intentional). order_rejected and payment_reminder are byte-identical to the migration text (md5 match); order_confirmation, order_approved and delivery_notification were edited later (2026-07-01) and differ from the seed. Policies exist but allow ANY signed-in user to read and update templates (qual = true).
- **If the SQL ran again:** FAILS HARMLESSLY (CREATE POLICY errors because the policies exist, so the file aborts; if it did not, test_message would be re-inserted)
- **Assessment:** The table, seed templates and trigger are present, and the one missing seed is the deliberate removal you described. Recording this does not restore the test template. Separate finding: the open update policy is for the October security migrations (20261012120000), not this attestation.
- **Still unknown:** None for the attestation. Whether you want test_message back is your call (not requested).

### D19: Customer-selected payment tracking and the 22 matching orders: recommended **ATTEST** (medium confidence)
- **What the migration did:** orders.customer_selected_payment_cents and _type exist; existing orders back-filled from deposit_due_cents.
- **What Development shows:** Both columns exist. 149 of 171 orders have a value; 22 are NULL: 14 drafts (13 with a deposit due), 3 cancelled, 5 completed/in-progress with a single payment and deposit_due 0. All 22 were created after the migration (earliest 2026-04-15; no order pre-dates the migration, 0 of 171). The application treats NULL as 0 (portal-actions: ?? 0; OrderApprovalView: || 0) and sets the value when a customer chooses a payment. The type column also holds values the migration never writes ('custom' 10, 'balance' 3), showing the application has moved on.
- **If the SQL ran again:** CHANGES 22 live orders (sets a customer 'selection' on 14 unaccepted drafts and 8 others)
- **Assessment:** Nothing in Development existed when the migration was written, so the back-fill cannot be observed, and the 22 NULLs are post-migration orders the application handles as 0. Attesting records the column/back-fill as handled; it does not fill the 22. A rerun would be harmful: it would invent a customer payment choice on 14 draft invoices.
- **Still unknown:** Whether you want the 22 NULLs left as they are (recommended; no business logic depends on them being filled) or filled by a separate, authorized data fix.

### D20: Customer total-spent recalculation: recommended **NEEDS OWNER REVIEW** (high confidence)
- **What the migration did:** update_contact_booking_stats() includes generator, custom fees and discounts in total_spent_cents; all contacts re-computed once.
- **What Development shows:** The function has the new formula and its trigger is enabled, but a SECOND, older trigger (update_contact_stats_trigger, any order update) runs the older function update_contact_stats() after it and overwrites the result. All 92 stored totals equal the OLD formula (confirmed/approved/completed only, no custom fees or discounts; in-progress orders ignored). Under the application's current order-total definition 41 of 92 contacts have a stale total_spent (stored 1,004,616 vs 1,963,043 cents in total) and 24 a stale booking count (stored = all orders, drafts and cancelled included); 57 contacts need any change; completed counts, dates and repeat flags are correct. No migration ever drops the old trigger.
- **If the SQL ran again:** CHANGES 92 contacts' statistics (derived values only; no payment or order amount)
- **Assessment:** The stale totals are not proof that the migration failed to run: a competing legacy trigger produced them and would undo any repair. One durable package is prepared and tested on synthetic data (d20-durable-correction-plan.md): one statistics mechanism, triggers for every input, the obsolete writer removed, the 57 contacts repaired. Because it changes the schema it must wait until after the sealed executor stages (S5 to S7) and is proposed as a separately authorized S12b operation. Recommendation: attest D20 only together with, or after, that correction; or attest now with a function-only scope and accept stale statistics until S12b. Decide D20 separately from D21.
- **Still unknown:** Whether you will authorize the durable correction at S12b (no payment, invoice or order amount is touched). Blocks batch B21 and so B31, B33 and B40 until D20 is decided.

### D21: Historical demo administrator: recommended **NEEDS OWNER REVIEW** (high confidence)
- **What the migration did:** Creates admin@bouncepartyclub.com with a documented password and the admin role.
- **What Development shows:** The account EXISTS (confirmed, role 'master', last sign-in 2026-07-18). Its password STILL equals the one written in the public migration file (hash comparison only). A second account (ad***@offline4ever.com, no roles, never signed in, one customer row with no orders) has the same password. BOTH ACCOUNTS WERE BANNED through the dashboard on 2026-10-20 at 15:16 UTC, currently until 2026-11-13 (the owner is extending the bans to the longest supported duration); Auth records, role row, customer links, contacts and the business-email setting are intact; the Google master (fresh sign-in verified) and a second master remain active; no sign-ins or refreshes from the banned accounts since. Residual: passwords unchanged, existing tokens may live until they expire, session rows remain, Production not examined.
- **If the SQL ran again:** FAILS HARMLESSLY (the e-mail is unique; the insert errors)
- **Assessment:** Containment is now in place, so recording the historical creation as handled no longer blesses an exploitable login. Final assessment once the ban extension is verified: ATTEST is then reasonable with this scope: the account exists and is disabled, its password is NOT rotated, it must never be unbanned before rotation, and Production is unexamined. Leaving it pending (REJECT) is also safe: it blocks only batch B22 (one version). Decide D21 separately from D20.
- **Still unknown:** Whether you want it recorded as handled now or after the passwords are rotated; whether the extended ban is the longest the dashboard offers (expiry date to be recorded).

## 5. All 44 versions
Fields: expected outcome; observed Development state; evidence strength; rerun risk; recommendation; what remains unknown; read-only check reference (Q1 to Q6 in `s2-attestation-readonly-checks.sql`).

| ID | Version | Batch | Migration | Strength | Rerun risk | Recommendation |
|---|---|---|---|---|---|---|
| D01 | `20251209133113` | B19 | Payment timestamps and updated_at trigger | STRONG | NO-OP (columns exist; the two UPDATEs match 0 rows) | **ATTEST** (high) |
| D02 | `20260120203953` | B19 | Back-fill tax_waived for pre-2026-01-19 orders | WEAK (nothing to observe) | NO-OP (the UPDATE matches 0 rows) | **ATTEST** (medium) |
| D03 | `20260125170305` | B19 | Revert the tax_waived back-fill | WEAK (nothing to observe) | NO-OP | **ATTEST** (medium) |
| D04 | `20260302131311` | B19 | Link customers to login users (customers.user_id) | STRONG | NO-OP (guards present; the link UPDATE matches 0 rows) | **ATTEST** (high) |
| D05 | `20260311191611` | B19 | Invoice 'partial' status | STRONG | NO-OP (constraint is dropped/re-added identically; UPDATE matches 0 rows) | **ATTEST** (high) |
| D06 | `20260314213726` | B19 | Address de-duplication key (address_key) | STRONG | NO-OP (column and index exist; 0 duplicate groups) | **ATTEST** (high) |
| D07 | `20260314215031` | B19 | Address key back-fill preferring rows with coordinates | STRONG | NO-OP | **ATTEST** (high) |
| D08 | `20260323175236` | B20 | Redact secrets in the settings change log | STRONG | NO-OP (re-redacts already redacted rows; function/trigger recreated identically) | **ATTEST** (high) |
| D09 | `20260326004004` | B20 | Back-fill card last-four and brand on orders | WEAK (nothing to observe) | NO-OP (matches 0 orders) | **ATTEST** (medium) |
| D10 | `20251002180149` | B15 | Home base Wayne, MI pricing (travel rate and free cities) | SUPERSEDED by the owner (value differs on purpose) | OVERWRITES the authoritative $3.00 rate with $5.00 (never run this SQL) | **ATTEST** (high) |
| D11 | `20251130231633` | B15 | Generator pricing | STRONG | NO-OP | **ATTEST** (high) |
| D12 | `20251222014723` | B15 | Deposit $50 per unit and free-travel cities column | STRONG | NO-OP (the UPDATE matches only 10000 or NULL; neither is present) | **ATTEST** (high) |
| D13 | `20251222020729` | B15 | Generator and same-day pickup fees | STRONG | NO-OP (columns exist; included_cities not empty) | **ATTEST** (high) |
| D14 | `20260119195140` | B15 | apply_taxes_by_default setting | STRONG (structure); value is a business choice | NO-OP (only NULLs are updated; none exist) | **ATTEST** (medium) |
| D15 | `20260311121119` | B15 | deposit_percentage column | STRONG | NO-OP | **ATTEST** (high) |
| D16 | `20260324175546` | B18 | get_user_role case-insensitive | STRONG | NO-OP (function recreated identically; UPDATE matches 0 rows; briefly disables triggers on user_roles) | **ATTEST** (high) |
| D17 | `20260324190039` | B18 | Normalize remaining upper-case roles | STRONG | NO-OP | **ATTEST** (high) |
| D18 | `20251003182356` | B14 | SMS message templates table and six default templates | STRONG (structure); STRONG that test_message was removed after creation | FAILS HARMLESSLY (CREATE POLICY errors because the policies exist, so the file aborts; if it did not, test_message would be re-inserted) | **ATTEST** (high) |
| D19 | `20260305205811` | B19 | Customer-selected payment tracking | MODERATE | CHANGES 22 live orders (sets a customer 'selection' on 14 unaccepted drafts and 8 others) | **ATTEST** (medium) |
| D20 | `20260323164559` | B21 | Customer total-spent recalculation | CONTRADICTED for the data; cause identified | CHANGES 92 contacts' statistics (derived values only; no payment or order amount) | **NEEDS OWNER REVIEW** (high) |
| D21 | `20251003170350` | B22 | Historical demo administrator login | STRONG that the account exists; security CONTAINED (banned), not remediated | FAILS HARMLESSLY (the e-mail is unique; the insert errors) | **NEEDS OWNER REVIEW** (high) |
| D22 | `20251003152224` | B13 | Twilio credential settings (placeholders) | STRONG | NO-OP (ON CONFLICT DO NOTHING) | **ATTEST** (high) |
| D23 | `20251003183947` | B13 | Admin e-mail setting | STRONG | OVERWRITES with the same value (no visible change) | **ATTEST** (high) |
| D24 | `20251007210840` | B13 | Stripe publishable key setting | STRONG | NO-OP (ON CONFLICT DO NOTHING) | **ATTEST** (high) |
| D25 | `20251231171420` | B13 | Business branding settings | STRONG | NO-OP (ON CONFLICT DO NOTHING; would not re-create business_website's old value) | **ATTEST** (high) |
| D26 | `20260126184412` | B13 | Travel-fee default and home address | STRONG | NO-OP (ON CONFLICT DO NOTHING) | **ATTEST** (high) |
| D27 | `20260203053948` | B13 | Social media URLs and business-address-for-travel | STRONG | OVERWRITES instagram_url back to the http:// seed value (minor) | **ATTEST** (high) |
| D28 | `20260325231020` | B13 | Carousel arrows setting | STRONG | NO-OP | **ATTEST** (high) |
| D29 | `20251008144308` | B14 | Admin booking notification template and admin phone | STRONG | NO-OP (overwrites with identical values) | **ATTEST** (high) |
| D30 | `20251205125907` | B14 | Crew checkpoint SMS templates | STRONG | NO-OP (ON CONFLICT DO NOTHING keeps the edit) | **ATTEST** (high) |
| D31 | `20251216201450` | B14 | Order-cancellation admin SMS template | STRONG | NO-OP | **ATTEST** (high) |
| D32 | `20260126193254` | B14 | Pictures-reminder SMS template | STRONG | NO-OP | **ATTEST** (high) |
| D33 | `20251221225000` | B37 | E-mail templates system | STRONG | FAILS HARMLESSLY (CREATE POLICY errors because the policies exist; inserts would not overwrite) | **ATTEST** (high) |
| D34 | `20251007220415` | B16 | 'payment_pending' order status comment and normalization | STRONG | NO-OP | **ATTEST** (high) |
| D35 | `20251007221227` | B16 | Orders 'payment_pending' becomes 'draft' | STRONG | NO-OP | **ATTEST** (high) |
| D36 | `20251007221817` | B16 | deposit_required flag | STRONG | NO-OP | **ATTEST** (high) |
| D37 | `20251130191333` | B16 | event_end_date and pickup_preference | STRONG | FAILS HARMLESSLY (ADD CONSTRAINT errors because it exists) | **ATTEST** (high) |
| D38 | `20260816221636` | B16 | payment_lock column | STRONG | NO-OP | **ATTEST** (high) |
| D39 | `20260928172217` | B16 | Parks acknowledgment system | STRONG | NO-OP (re-sets the same order to the same values) | **ATTEST** (high) |
| D40 | `20251231174711` | B17 | Notification failure tracking | STRONG | FAILS HARMLESSLY or NO-OP (statements guarded; policies recreated identically) | **ATTEST** (high) |
| D41 | `20260224165424` | B17 | Unit types as an array | STRONG | FAILS HARMLESSLY (ADD CONSTRAINT errors because it exists) | **ATTEST** (high) |
| D42 | `20260318191352` | B17 | Water-slide water price fix | STRONG | NO-OP | **ATTEST** (high) |
| D43 | `20260331151647` | B17 | Image visibility mode | STRONG | NO-OP | **ATTEST** (high) |
| D44 | `20260415234700` | B17 | Portal short links in invoice_links | MODERATE | CHANGES 7 live link rows from 'invoice' to 'portal_shortlink' | **ATTEST** (medium) |

### Group G7: Payment, financial, identity and webhook data

#### D01 `20251209133113` (batch B19): Payment timestamps and updated_at trigger
- **File:** `20251209133113_add_payment_timestamps.sql`
- **Expected outcome:** payments get paid_at, failed_at, updated_at; succeeded/failed payments are back-filled; a trigger keeps updated_at current.
- **Observed in Development:** All 3 columns exist; 185 of 185 payments are 'succeeded' and every one has paid_at (0 missing); trigger payments_updated_at_trigger and function update_payments_updated_at exist (a second, older trigger update_payments_updated_at also exists).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (columns exist; the two UPDATEs match 0 rows)
- **Recommendation:** **ATTEST** (high confidence). Every observable effect of the migration is present and complete. A rerun changes nothing.
- **Remaining unknown:** Whether the SQL itself ever ran in this database (not provable); the end state is correct.
- **Check:** Q1

#### D02 `20260120203953` (batch B19): Back-fill tax_waived for pre-2026-01-19 orders
- **File:** `20260120203953_backfill_tax_waived_for_old_orders.sql`
- **Expected outcome:** Old orders with tax would be flagged tax_waived=true (later undone by D03).
- **Observed in Development:** No order in Development is older than 2026-04-02 (0 orders before 2026-01-19); 0 orders have tax_cents>0; 0 rows carry the 'Auto-adjusted' reason; 0 orders are tax_waived.
- **Evidence strength:** WEAK (nothing to observe)
- **If the original SQL ran again:** NO-OP (the UPDATE matches 0 rows)
- **Recommendation:** **ATTEST** (medium confidence). The condition (created before 2026-01-19 with tax) matches nothing, so recording it cannot hide a gap and a rerun changes nothing. The data cannot prove the historical effect either way.
- **Remaining unknown:** The effect on pre-2026 orders that exist only in Production.
- **Check:** Q1

#### D03 `20260125170305` (batch B19): Revert the tax_waived back-fill
- **File:** `20260125170305_fix_tax_waived_backfill_logic.sql`
- **Expected outcome:** Undo D02: tax_waived=false and the auto reason removed where tax was charged.
- **Observed in Development:** 0 rows carry the 'Auto-adjusted' reason; 0 orders tax_waived=true; 0 orders with tax.
- **Evidence strength:** WEAK (nothing to observe)
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (medium confidence). End state equals the intended state of D02+D03 together (no auto-waived rows). Rerun changes nothing.
- **Remaining unknown:** Same as D02: pre-2026 orders are not in Development.
- **Check:** Q1

#### D04 `20260302131311` (batch B19): Link customers to login users (customers.user_id)
- **File:** `20260302131311_add_user_id_to_customers_and_password_reset.sql`
- **Expected outcome:** customers.user_id with unique index, two self-service policies, and existing customers linked to auth users by e-mail.
- **Observed in Development:** Column and unique index exist; both policies exist; 9 of 123 customers are linked; 0 customers whose e-mail matches an auth user remain unlinked; 0 links point at a missing user.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (guards present; the link UPDATE matches 0 rows)
- **Recommendation:** **ATTEST** (high confidence). The back-fill outcome is directly visible: every matching customer is linked and none dangles.
- **Remaining unknown:** None material.
- **Check:** Q1

#### D05 `20260311191611` (batch B19): Invoice 'partial' status
- **File:** `20260311191611_20260311150000_add_invoice_partial_status.sql`
- **Expected outcome:** invoices_status_check allows 'partial'; deposit-only 'paid' invoices become 'partial'.
- **Observed in Development:** Constraint allows draft/sent/partial/paid/cancelled; invoices: 68 partial, 14 paid; 0 'paid' invoices with paid_amount < total.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (constraint is dropped/re-added identically; UPDATE matches 0 rows)
- **Recommendation:** **ATTEST** (high confidence). Constraint and data both match the migration; 68 partial invoices show the status is in use.
- **Remaining unknown:** None material.
- **Check:** Q1

#### D06 `20260314213726` (batch B19): Address de-duplication key (address_key)
- **File:** `20260314213726_add_address_key_deduplication.sql`
- **Expected outcome:** addresses.address_key back-filled, duplicates merged, unique index.
- **Observed in Development:** Column exists; 165 addresses; 0 with a NULL key; 0 duplicate-key groups; unique index exists; 164 of 165 have coordinates; 0 orders point at a missing address.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (column and index exist; 0 duplicate groups)
- **Recommendation:** **ATTEST** (high confidence). The result of the de-duplication is visible and consistent (no duplicates, no dangling orders).
- **Remaining unknown:** Whether any duplicate rows were deleted historically (cannot be shown; none exist now).
- **Check:** Q1

#### D07 `20260314215031` (batch B19): Address key back-fill preferring rows with coordinates
- **File:** `20260314215031_fix_address_key_backfill_prefer_coords.sql`
- **Expected outcome:** Keys re-computed with whitespace-insensitive zip; duplicates resolved preferring rows with lat/lng.
- **Observed in Development:** 0 addresses whose key differs from the D07 formula; 0 zips with spaces; 0 duplicate groups; 164/165 with coordinates.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). Every key equals what the D07 formula produces today.
- **Remaining unknown:** None material.
- **Check:** Q1

#### D08 `20260323175236` (batch B20): Redact secrets in the settings change log
- **File:** `20260323175236_20260323_security_redact_secrets_in_settings_changelog.sql`
- **Expected outcome:** Secret values in admin_settings_changelog replaced by [REDACTED]; trigger redacts future rows.
- **Observed in Development:** 23 change-log rows; 6 concern secret-like keys (stripe_secret_key, twilio_auth_token, stripe_publishable_key); 6 of 6 are [REDACTED]; trigger trg_redact_settings_changelog exists; function is SECURITY DEFINER with search_path=public.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (re-redacts already redacted rows; function/trigger recreated identically)
- **Recommendation:** **ATTEST** (high confidence). Security-relevant effect is fully present: no plaintext secret is stored in the change log and future inserts are redacted.
- **Remaining unknown:** None material. (resend_api_key and google_oauth_client_secret exist as settings but have no change-log rows.)
- **Check:** Q2

#### D09 `20260326004004` (batch B20): Back-fill card last-four and brand on orders
- **File:** `20260326004004_backfill_order_payment_method_last_four_brand.sql`
- **Expected outcome:** Orders with a saved card get payment_method_last_four/brand copied from the latest succeeded payment.
- **Observed in Development:** No order has a stripe_payment_method_id (0 of 171); therefore 0 orders are missing last-four/brand and 0 would be back-filled; 162 payments carry a last-four.
- **Evidence strength:** WEAK (nothing to observe)
- **If the original SQL ran again:** NO-OP (matches 0 orders)
- **Recommendation:** **ATTEST** (medium confidence). The condition matches nothing in Development, so recording it hides nothing and a rerun changes nothing.
- **Remaining unknown:** Behaviour for orders with saved cards (none exist in Development).
- **Check:** Q2

### Group G3: Pricing configuration

#### D10 `20251002180149` (batch B15): Home base Wayne, MI pricing (travel rate and free cities)
- **File:** `20251002180149_005_update_home_base_wayne_mi.sql`
- **Expected outcome:** pricing_rules.per_mile_after_base_cents = 500 ($5.00 per mile after 20 miles) and included_city_list_json = ["Detroit"].
- **Observed in Development:** per_mile_after_base_cents is 300 ($3.00), not 500; included_city_list_json is ["Detroit"] (matches); base_radius_miles 20. All 45 orders that carry a travel fee store their own rate of 300, so the $3.00 rate is what customers were actually charged. OWNER DECISION 2026-10-20: the currently stored configuration is authoritative and the migration's $5.00 is obsolete.
- **Evidence strength:** SUPERSEDED by the owner (value differs on purpose)
- **If the original SQL ran again:** OVERWRITES the authoritative $3.00 rate with $5.00 (never run this SQL)
- **Recommendation:** **ATTEST** (high confidence). The owner decided that Development's stored pricing configuration is authoritative: $3.00 per mile beyond the included radius stays unchanged and the historical $5.00 is obsolete. The attestation therefore records that this migration was superseded by the current business configuration, not that its value is present. It must be recorded precisely so that no tool ever re-applies the $5.00. The charge on every existing order is protected independently by the per-order snapshot (travel-fee-historical-preservation-review.md).
- **Remaining unknown:** Nothing for the attestation. The historical SQL must never be executed; pricing_rules, travel rates, radius and included cities are not changed by recording it.
- **Check:** Q2,Q8

#### D11 `20251130231633` (batch B15): Generator pricing
- **File:** `20251130231633_add_generator_pricing.sql`
- **Expected outcome:** pricing_rules.generator_price_cents (default 7500) and orders.generator_fee_cents exist and are filled.
- **Observed in Development:** pricing_rules.generator_price_cents = 7500; orders.generator_fee_cents exists (used by the D20 formula).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). Columns exist and the value equals the migration's default.
- **Remaining unknown:** None material.
- **Check:** Q2,Q4

#### D12 `20251222014723` (batch B15): Deposit $50 per unit and free-travel cities column
- **File:** `20251222014723_fix_deposit_and_add_free_cities.sql`
- **Expected outcome:** deposit_per_unit_cents = 5000 (from 10000/NULL); included_cities column exists.
- **Observed in Development:** deposit_per_unit_cents = 5000; included_cities = ["Detroit"].
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (the UPDATE matches only 10000 or NULL; neither is present)
- **Recommendation:** **ATTEST** (high confidence). Value equals the migration's target and the column exists.
- **Remaining unknown:** None material.
- **Check:** Q2

#### D13 `20251222020729` (batch B15): Generator and same-day pickup fees
- **File:** `20251222020729_add_generator_and_same_day_fees.sql`
- **Expected outcome:** pricing_rules gets generator_fee_single_cents (default 10000), generator_fee_multiple_cents (7500), same_day_pickup_fee_cents; Detroit set as free city if empty.
- **Observed in Development:** All 3 columns exist: single = 9500 (default was 10000, later changed), multiple = 7500, same-day pickup = 10000; included_cities = ["Detroit"].
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (columns exist; included_cities not empty)
- **Recommendation:** **ATTEST** (high confidence). Structure present; the 9500 differs from the default only because the price was edited later, which a rerun would not touch.
- **Remaining unknown:** None material.
- **Check:** Q2

#### D14 `20260119195140` (batch B15): apply_taxes_by_default setting
- **File:** `20260119195140_add_apply_taxes_by_default.sql`
- **Expected outcome:** pricing_rules.apply_taxes_by_default exists (default true); NULL rows set to true.
- **Observed in Development:** Column exists; value is false (owner setting). All 171 orders have tax_cents = 0, consistent with taxes being off.
- **Evidence strength:** STRONG (structure); value is a business choice
- **If the original SQL ran again:** NO-OP (only NULLs are updated; none exist)
- **Recommendation:** **ATTEST** (medium confidence). The column exists and no NULL remains, so the migration's effect is present. Taxes being off by default is a configuration choice, not something this migration controls.
- **Remaining unknown:** Whether 'no tax by default' is what you intend for Development (not an attestation question).
- **Check:** Q1,Q2

#### D15 `20260311121119` (batch B15): deposit_percentage column
- **File:** `20260311121119_add_deposit_percentage_column.sql`
- **Expected outcome:** pricing_rules.deposit_percentage exists (default 0.25).
- **Observed in Development:** pricing_rules.deposit_percentage exists and holds 0.25, the migration's default.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The column exists and its value equals the migration's default, so the deposit setting is as described.
- **Remaining unknown:** None material.
- **Check:** Q2

### Group G6: Role normalization

#### D16 `20260324175546` (batch B18): get_user_role case-insensitive
- **File:** `20260324175546_fix_get_user_role_case_sensitivity_v2.sql`
- **Expected outcome:** get_user_role() returns lower-case; stored roles normalized to lower-case.
- **Observed in Development:** Function exists once and lower-cases the role; user_roles has master 5, customer 4; 0 rows differ from their lower-case form; the only trigger on user_roles is enabled.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (function recreated identically; UPDATE matches 0 rows; briefly disables triggers on user_roles)
- **Recommendation:** **ATTEST** (high confidence). The function body lower-cases the role and every stored role is already lower-case, so both halves of the migration are visible.
- **Remaining unknown:** None material.
- **Check:** Q2

#### D17 `20260324190039` (batch B18): Normalize remaining upper-case roles
- **File:** `20260324190039_normalize_remaining_uppercase_roles.sql`
- **Expected outcome:** Any remaining upper-case role values lower-cased.
- **Observed in Development:** 0 role values differ from their lower-case form.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). No upper-case role remains, which is the whole outcome the migration was meant to produce.
- **Remaining unknown:** None material.
- **Check:** Q2

### Group G8: Unresolved versions that need an owner decision or one read-only query first

#### D18 `20251003182356` (batch B14): SMS message templates table and six default templates
- **File:** `20251003182356_016_add_sms_message_templates.sql`
- **Expected outcome:** Table sms_message_templates with RLS, update trigger and six default templates (order_confirmation, order_approved, order_rejected, payment_reminder, delivery_notification, test_message).
- **Observed in Development:** Table exists. 5 of the 6 keys are present; test_message is absent (you state its removal was intentional). order_rejected and payment_reminder are byte-identical to the migration text (md5 match); order_confirmation, order_approved and delivery_notification were edited later (2026-07-01) and differ from the seed. Policies exist but allow ANY signed-in user to read and update templates (qual = true).
- **Evidence strength:** STRONG (structure); STRONG that test_message was removed after creation
- **If the original SQL ran again:** FAILS HARMLESSLY (CREATE POLICY errors because the policies exist, so the file aborts; if it did not, test_message would be re-inserted)
- **Recommendation:** **ATTEST** (high confidence). The table, seed templates and trigger are present, and the one missing seed is the deliberate removal you described. Recording this does not restore the test template. Separate finding: the open update policy is for the October security migrations (20261012120000), not this attestation.
- **Remaining unknown:** None for the attestation. Whether you want test_message back is your call (not requested).
- **Check:** Q3,Q4

#### D19 `20260305205811` (batch B19): Customer-selected payment tracking
- **File:** `20260305205811_add_customer_selected_payment_tracking.sql`
- **Expected outcome:** orders.customer_selected_payment_cents and _type exist; existing orders back-filled from deposit_due_cents.
- **Observed in Development:** Both columns exist. 149 of 171 orders have a value; 22 are NULL: 14 drafts (13 with a deposit due), 3 cancelled, 5 completed/in-progress with a single payment and deposit_due 0. All 22 were created after the migration (earliest 2026-04-15; no order pre-dates the migration, 0 of 171). The application treats NULL as 0 (portal-actions: ?? 0; OrderApprovalView: || 0) and sets the value when a customer chooses a payment. The type column also holds values the migration never writes ('custom' 10, 'balance' 3), showing the application has moved on.
- **Evidence strength:** MODERATE
- **If the original SQL ran again:** CHANGES 22 live orders (sets a customer 'selection' on 14 unaccepted drafts and 8 others)
- **Recommendation:** **ATTEST** (medium confidence). Nothing in Development existed when the migration was written, so the back-fill cannot be observed, and the 22 NULLs are post-migration orders the application handles as 0. Attesting records the column/back-fill as handled; it does not fill the 22. A rerun would be harmful: it would invent a customer payment choice on 14 draft invoices.
- **Remaining unknown:** Whether you want the 22 NULLs left as they are (recommended; no business logic depends on them being filled) or filled by a separate, authorized data fix.
- **Check:** Q3,Q4 + code review

#### D20 `20260323164559` (batch B21): Customer total-spent recalculation
- **File:** `20260323164559_fix_total_spent_cents_include_custom_fees_discounts.sql`
- **Expected outcome:** update_contact_booking_stats() includes generator, custom fees and discounts in total_spent_cents; all contacts re-computed once.
- **Observed in Development:** The function has the new formula and its trigger is enabled, but a SECOND, older trigger (update_contact_stats_trigger, any order update) runs the older function update_contact_stats() after it and overwrites the result. All 92 stored totals equal the OLD formula (confirmed/approved/completed only, no custom fees or discounts; in-progress orders ignored). Under the application's current order-total definition 41 of 92 contacts have a stale total_spent (stored 1,004,616 vs 1,963,043 cents in total) and 24 a stale booking count (stored = all orders, drafts and cancelled included); 57 contacts need any change; completed counts, dates and repeat flags are correct. No migration ever drops the old trigger.
- **Evidence strength:** CONTRADICTED for the data; cause identified
- **If the original SQL ran again:** CHANGES 92 contacts' statistics (derived values only; no payment or order amount)
- **Recommendation:** **NEEDS OWNER REVIEW** (high confidence). The stale totals are not proof that the migration failed to run: a competing legacy trigger produced them and would undo any repair. One durable package is prepared and tested on synthetic data (d20-durable-correction-plan.md): one statistics mechanism, triggers for every input, the obsolete writer removed, the 57 contacts repaired. Because it changes the schema it must wait until after the sealed executor stages (S5 to S7) and is proposed as a separately authorized S12b operation. Recommendation: attest D20 only together with, or after, that correction; or attest now with a function-only scope and accept stale statistics until S12b. Decide D20 separately from D21.
- **Remaining unknown:** Whether you will authorize the durable correction at S12b (no payment, invoice or order amount is touched). Blocks batch B21 and so B31, B33 and B40 until D20 is decided.
- **Check:** Q3,Q4,Q6,Q9

#### D21 `20251003170350` (batch B22): Historical demo administrator login
- **File:** `20251003170350_015_create_demo_admin_user.sql`
- **Expected outcome:** Creates admin@bouncepartyclub.com with a documented password and the admin role.
- **Observed in Development:** The account EXISTS (confirmed, role 'master', last sign-in 2026-07-18). Its password STILL equals the one written in the public migration file (hash comparison only). A second account (ad***@offline4ever.com, no roles, never signed in, one customer row with no orders) has the same password. BOTH ACCOUNTS WERE BANNED through the dashboard on 2026-10-20 at 15:16 UTC, currently until 2026-11-13 (the owner is extending the bans to the longest supported duration); Auth records, role row, customer links, contacts and the business-email setting are intact; the Google master (fresh sign-in verified) and a second master remain active; no sign-ins or refreshes from the banned accounts since. Residual: passwords unchanged, existing tokens may live until they expire, session rows remain, Production not examined.
- **Evidence strength:** STRONG that the account exists; security CONTAINED (banned), not remediated
- **If the original SQL ran again:** FAILS HARMLESSLY (the e-mail is unique; the insert errors)
- **Recommendation:** **NEEDS OWNER REVIEW** (high confidence). Containment is now in place, so recording the historical creation as handled no longer blesses an exploitable login. Final assessment once the ban extension is verified: ATTEST is then reasonable with this scope: the account exists and is disabled, its password is NOT rotated, it must never be unbanned before rotation, and Production is unexamined. Leaving it pending (REJECT) is also safe: it blocks only batch B22 (one version). Decide D21 separately from D20.
- **Remaining unknown:** Whether you want it recorded as handled now or after the passwords are rotated; whether the extended ban is the longest the dashboard offers (expiry date to be recorded).
- **Check:** Q3,Q4,Q7

### Group G1: Admin settings seeds

#### D22 `20251003152224` (batch B13): Twilio credential settings (placeholders)
- **File:** `20251003152224_20251003210000_013_add_twilio_credentials.sql`
- **Expected outcome:** admin_settings rows twilio_account_sid, twilio_auth_token, twilio_from_number (empty placeholders).
- **Observed in Development:** All 3 keys exist and are non-empty (34, 32 and 12 characters; values not read).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (ON CONFLICT DO NOTHING)
- **Recommendation:** **ATTEST** (high confidence). Keys exist and have been filled in since. A rerun does not overwrite them.
- **Remaining unknown:** None for the attestation. (Credentials are stored in a table; handled by security stages, not here.)
- **Check:** Q5

#### D23 `20251003183947` (batch B13): Admin e-mail setting
- **File:** `20251003183947_017_add_admin_email_setting.sql`
- **Expected outcome:** admin_settings.admin_email = deveehawk@gmail.com.
- **Observed in Development:** admin_email = deveehawk@gmail.com (exact match).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** OVERWRITES with the same value (no visible change)
- **Recommendation:** **ATTEST** (high confidence). admin_email holds exactly the address the migration sets, so even an overwrite would change nothing.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D24 `20251007210840` (batch B13): Stripe publishable key setting
- **File:** `20251007210840_022_add_stripe_publishable_key.sql`
- **Expected outcome:** admin_settings.stripe_publishable_key row exists.
- **Observed in Development:** Row exists, non-empty (107 characters), prefix pk_test_ (Stripe TEST mode).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (ON CONFLICT DO NOTHING)
- **Recommendation:** **ATTEST** (high confidence). Row exists and is a test-mode key, as required for Development.
- **Remaining unknown:** None material.
- **Check:** Q5,Q6

#### D25 `20251231171420` (batch B13): Business branding settings
- **File:** `20251231171420_20251231172000_add_business_branding_settings.sql`
- **Expected outcome:** Eight business_* settings with default values.
- **Observed in Development:** 7 of 8 exist: business_name, business_name_short, business_legal_entity, business_phone equal the defaults; business_address ('4426 Woodward St, Wayne, MI 48184') and business_email ('admin@bouncepartyclub.com') were edited later; business_license_number is empty as seeded; business_website is absent (deleted by D27, as intended).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (ON CONFLICT DO NOTHING; would not re-create business_website's old value)
- **Recommendation:** **ATTEST** (high confidence). All keys that should exist do; the differences are later edits and the intended website deletion.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D26 `20260126184412` (batch B13): Travel-fee default and home address
- **File:** `20260126184412_add_travel_fee_default_and_home_address.sql`
- **Expected outcome:** apply_travel_fee_by_default and home_address_* settings created.
- **Observed in Development:** All 8 keys exist: apply_travel_fee_by_default = true; address 4426 Woodward St, Wayne, MI 48184 (the 3200 S Wayne Rd seed was later corrected), lat 42.2808, lng -83.3863.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (ON CONFLICT DO NOTHING)
- **Recommendation:** **ATTEST** (high confidence). All eight keys exist and hold the corrected Wayne address; the seed address was replaced by a later fix, which a rerun would not undo.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D27 `20260203053948` (batch B13): Social media URLs and business-address-for-travel
- **File:** `20260203053948_20260203000000_add_social_media_urls.sql`
- **Expected outcome:** instagram_url, facebook_url, use_business_address_for_travel inserted/updated; business_website deleted.
- **Observed in Development:** facebook_url equals the seed; use_business_address_for_travel = true; business_website is absent; instagram_url is https://instagram.com/bouncepartyclub (the seed was http://..., edited since).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** OVERWRITES instagram_url back to the http:// seed value (minor)
- **Recommendation:** **ATTEST** (high confidence). Deletion and inserts are visible. The only risk of a rerun is a cosmetic URL change.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D28 `20260325231020` (batch B13): Carousel arrows setting
- **File:** `20260325231020_add_carousel_show_arrows_setting.sql`
- **Expected outcome:** The settings row carousel_show_arrows exists (value true) so the photo carousel arrows can be toggled.
- **Observed in Development:** The row carousel_show_arrows exists in admin_settings and holds true.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The row is present with the migration's value, and a rerun would leave it alone.
- **Remaining unknown:** None material.
- **Check:** Q5

### Group G2: Message and e-mail template seeds

#### D29 `20251008144308` (batch B14): Admin booking notification template and admin phone
- **File:** `20251008144308_031_add_admin_notification_template.sql`
- **Expected outcome:** SMS template booking_received_admin and admin_phone setting.
- **Observed in Development:** Template exists and its text is byte-identical to the migration (md5 match); admin_phone = +13138893860 (exact match).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (overwrites with identical values)
- **Recommendation:** **ATTEST** (high confidence). Template text and phone number both match the migration exactly, so even the overwrite in a rerun would change nothing.
- **Remaining unknown:** None material.
- **Check:** Q3,Q5

#### D30 `20251205125907` (batch B14): Crew checkpoint SMS templates
- **File:** `20251205125907_add_crew_checkpoint_sms_templates.sql`
- **Expected outcome:** Templates eta_sms, arrived_sms, dropoff_done_sms, pickup_thanks_sms.
- **Observed in Development:** All 4 exist; eta, arrived and dropoff texts are byte-identical to the migration; pickup_thanks_sms was edited later (2026-02-24).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (ON CONFLICT DO NOTHING keeps the edit)
- **Recommendation:** **ATTEST** (high confidence). All present; one later edit that a rerun would not touch.
- **Remaining unknown:** None material.
- **Check:** Q3

#### D31 `20251216201450` (batch B14): Order-cancellation admin SMS template
- **File:** `20251216201450_add_order_cancellation_admin_sms_template.sql`
- **Expected outcome:** SMS template order_cancelled_admin exists, used to tell the admin that a customer cancelled.
- **Observed in Development:** Exists, byte-identical to the migration (md5 match).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The stored template text is identical to the migration text (md5 match), so nothing was edited since.
- **Remaining unknown:** None material.
- **Check:** Q3

#### D32 `20260126193254` (batch B14): Pictures-reminder SMS template
- **File:** `20260126193254_add_pictures_reminder_sms_template.sql`
- **Expected outcome:** SMS template pictures_reminder exists, used to ask the customer for setup-area pictures.
- **Observed in Development:** Exists, byte-identical to the migration (md5 match).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The stored template text is identical to the migration text (md5 match), so nothing was edited since.
- **Remaining unknown:** None material.
- **Check:** Q3

#### D33 `20251221225000` (batch B37): E-mail templates system
- **File:** `20251221225000_add_email_templates_system.sql`
- **Expected outcome:** Table email_templates with admin-only policies, trigger and five seeded templates.
- **Observed in Development:** Table has 6 rows: the 5 seeded templates exist (booking_confirmation_admin, error_notification, order_rejection, payment_receipt are byte-identical to the migration; booking_confirmation_customer was edited 2026-03-18) plus pickup_complete added later. Admin-only select/update policies exist.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** FAILS HARMLESSLY (CREATE POLICY errors because the policies exist; inserts would not overwrite)
- **Recommendation:** **ATTEST** (high confidence). Everything the migration created is present; the differences are later edits and one added template.
- **Remaining unknown:** None material.
- **Check:** Q3

### Group G4: Order status and flag normalizations

#### D34 `20251007220415` (batch B16): 'payment_pending' order status comment and normalization
- **File:** `20251007220415_026_add_payment_pending_status.sql`
- **Expected outcome:** Orders with NULL/empty status set to 'pending'; column comment updated.
- **Observed in Development:** 0 orders with NULL or empty status; 0 'payment_pending'; the column comment now holds the later text from D36's migration.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The normalization target is empty and the comment was superseded.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D35 `20251007221227` (batch B16): Orders 'payment_pending' becomes 'draft'
- **File:** `20251007221227_027_update_order_status_to_draft.sql`
- **Expected outcome:** Orders still in the old payment_pending status are moved to draft (unpaid invoice).
- **Observed in Development:** No order has the status payment_pending; 48 orders are draft.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). No order is left in the old status, which is the outcome the migration produces.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D36 `20251007221817` (batch B16): deposit_required flag
- **File:** `20251007221817_028_add_deposit_required_flag.sql`
- **Expected outcome:** orders.deposit_required (default true), NULLs set to true.
- **Observed in Development:** Column exists (boolean, default true, nullable); 0 NULL; 163 true, 8 false.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The column exists with the migration's default and no NULL remains, so the migration's outcome is visible.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D37 `20251130191333` (batch B16): event_end_date and pickup_preference
- **File:** `20251130191333_add_event_end_date_and_pickup_preference.sql`
- **Expected outcome:** orders.event_end_date NOT NULL (= event_date for old rows); pickup_preference NOT NULL with check same_day/next_day.
- **Observed in Development:** Both columns NOT NULL; check constraint present; 0 orders end before start; 25 same_day, 146 next_day.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** FAILS HARMLESSLY (ADD CONSTRAINT errors because it exists)
- **Recommendation:** **ATTEST** (high confidence). Both columns are NOT NULL, the constraint exists and no order ends before it starts, so the structure and data are as described.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D38 `20260816221636` (batch B16): payment_lock column
- **File:** `20260816221636_20260816120000_add_payment_lock_column.sql.sql`
- **Expected outcome:** orders.payment_lock boolean NOT NULL default false; service_role may UPDATE.
- **Observed in Development:** Column exists (NOT NULL, default false); 171 of 171 false; service_role has UPDATE.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The column exists with NOT NULL and default false, every order is unlocked and service_role can update, which is exactly the result the migration describes.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D39 `20260928172217` (batch B16): Parks acknowledgment system
- **File:** `20260928172217_20260928120000_add_parks_acknowledgment_system.sql`
- **Expected outcome:** orders.parks_acknowledgment_required/_county; order 4ae9723c... flagged required, county Wayne.
- **Observed in Development:** Both columns exist; the named order exists and is flagged true / Wayne; 2 orders are flagged in total (Wayne 1, Oakland 1, the latter set later by the application).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP (re-sets the same order to the same values)
- **Recommendation:** **ATTEST** (high confidence). The one specific back-filled row is present with exactly the intended values.
- **Remaining unknown:** None material.
- **Check:** Q5

### Group G5: Catalog, content and link backfills

#### D40 `20251231174711` (batch B17): Notification failure tracking
- **File:** `20251231174711_create_notification_failure_tracking.sql`
- **Expected outcome:** Tables notification_failures and notification_system_status, three functions, admin policies, email/sms status rows.
- **Observed in Development:** Both tables, all 3 functions (SECURITY DEFINER) and the email/sms status rows exist (both operational, 0 failures, last success 2026-09-24); admin select/update policies exist. Known exposure: an INSERT policy on notification_failures and an UPDATE policy on notification_system_status are open to everyone (check true), and anon can execute the three functions.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** FAILS HARMLESSLY or NO-OP (statements guarded; policies recreated identically)
- **Recommendation:** **ATTEST** (high confidence). Everything the migration created is present. The open write access is a security finding for the October migrations (20261012120000 and 20261013120000 touch these objects), not a reason to withhold this attestation.
- **Remaining unknown:** None for the attestation.
- **Check:** Q5

#### D41 `20260224165424` (batch B17): Unit types as an array
- **File:** `20260224165424_convert_unit_type_to_array.sql`
- **Expected outcome:** units.types text[] NOT NULL replaces units.type; non-empty check; GIN index.
- **Observed in Development:** types exists (ARRAY, NOT NULL); old 'type' column gone; check units_types_not_empty and index idx_units_types exist; 16 units.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** FAILS HARMLESSLY (ADD CONSTRAINT errors because it exists)
- **Recommendation:** **ATTEST** (high confidence). The array column, constraint and index exist and the old column is gone, which is the complete result of the migration.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D42 `20260318191352` (batch B17): Water-slide water price fix
- **File:** `20260318191352_fix_waterslide_water_price.sql`
- **Expected outcome:** Water slides with water price 0 and dry price > 0 get water price = dry price.
- **Observed in Development:** 3 water slides; 0 match the condition (2 have water = dry, 1 has water > dry).
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). No water slide has a zero water price with a positive dry price, so the migration's fix is in place and nothing is left to repair.
- **Remaining unknown:** None material.
- **Check:** Q5

#### D43 `20260331151647` (batch B17): Image visibility mode
- **File:** `20260331151647_add_image_visibility_mode_to_unit_media.sql`
- **Expected outcome:** unit_media.visibility_mode (default 'dry'); copied from mode where still 'dry'.
- **Observed in Development:** Column exists (text, default 'dry'); 35 media rows: dry 24, water 7, both 4; a rerun would change 0 rows (no row is 'dry' with a different mode); the 4 'both' rows were set by the application.
- **Evidence strength:** STRONG
- **If the original SQL ran again:** NO-OP
- **Recommendation:** **ATTEST** (high confidence). The column exists and no media row is left with the default where the old mode column says otherwise, so the copy is consistent.
- **Remaining unknown:** None material.
- **Check:** Q5,Q6

#### D44 `20260415234700` (batch B17): Portal short links in invoice_links
- **File:** `20260415234700_backfill_portal_shortlinks_in_invoice_links.sql`
- **Expected outcome:** invoice_links of type 'invoice' with zero deposit, customer-filled and a short code are relabelled 'portal_shortlink'.
- **Observed in Development:** 285 links: 247 portal_shortlink (all created after the migration), 38 invoice. 7 'invoice' links still match the back-fill condition, all created 2026-04-16 or later (after the migration, which had no rows to convert: 6 invoice links pre-date it and none match).
- **Evidence strength:** MODERATE
- **If the original SQL ran again:** CHANGES 7 live link rows from 'invoice' to 'portal_shortlink'
- **Recommendation:** **ATTEST** (medium confidence). Nothing needed converting when the migration ran; the 247 portal short links are created directly by the application. The 7 remaining matches are newer rows whose label is the application's choice. Attesting records the migration as handled; a rerun would relabel those 7.
- **Remaining unknown:** Whether the 7 newer 'invoice' links should be 'portal_shortlink' (a data fix would need separate authorization; it has no payment effect).
- **Check:** Q6

## 6. How to decide
Open `audit/step4/s2-attestation-decision-sheet.html` in your browser. It shows, for each of the 44 versions, the same fields as above with ATTEST and REJECT buttons. **Nothing is pre-selected.** Press **Build decision text**, copy it, and paste it into the chat. The text names each version with your choice and carries a SHA-256 of the list. It is a record of your decisions, not an execution authorization; I will then prepare one consolidated execution request with exact scripts and hashes.
