# S2 attestation decision package: the 44 versions, one review session

Status: **FOR OWNER DECISION. NOTHING IS ATTESTED, SIGNED OR RECORDED.** No ledger row exists for any of these 44 versions; no migration SQL has run. Prepared 2026-10-20 from `audit/evidence/e2k-attestation-decisions.md`, `e2k-final-development-disposition.csv`, `s2-reconciliation-manifest.csv` and the migration files. It adds no new strategy and signs nothing on your behalf.

## 1. What you are deciding
For each version you choose **ATTEST** or **REJECT**. *Attest* means: "the Development database is in the state this migration describes; I do not claim the migration executed". The ledger row will say `attestation NOT EXECUTED` with your name, UTC date, scope, what is not proven and an evidence hash (the marker fields are defined in `build_execution_package.py`, function `marker`). *Reject* leaves the version unrecorded: Supabase tooling would still treat it as pending, so later stages that need it stay blocked and the file must be handled another way (a later owner decision). Silence is a rejection; nothing is recorded by default.

**Why history-only treatment is not enough for these 44:** history-only batches record versions whose effect is a catalog fact the database can prove itself (a column, function or policy exists). These 44 changed or seeded **data** (settings, templates, prices, balances, roles, backfills) or created an identity; the database cannot prove the historical statement ran, and the values changed since. Each therefore needs a person who can say the present state is the intended one.

**Consequence of attesting (any version):** the version is shown as handled in the ledger although its SQL did not run now; any tool that builds a database from the ledger will skip it. A false attestation would hide a gap. **Consequence of rejecting:** the version stays pending, which blocks the batches listed in section 3, and a `supabase db push` or automatic migration would re-run the SQL against live data (the risk is named per version).

## 2. How to decide in one session
Open `audit/step4/s2-attestation-decision-sheet.html` in your browser (nothing is sent anywhere). Choose ATTEST or REJECT per version (the group buttons only pre-fill; every row can be changed), type your name, press **Build decision text** and paste the result into this chat. The text lists each version with your choice and carries a SHA-256 over the list. I then (a) verify that all 44 are decided, (b) build the attested marker scripts for the approved versions only, with your name, the UTC date and the evidence hash, and (c) present them as one consolidated execution authorization with the exact batches, hashes and ledger counts. A decision text is not an execution authorization by itself. `s2-attestation-decision-sheet.csv` holds the same 44 rows for reference.

## 3. Dependencies the decisions unlock
| Batch | Versions | Group | Batches that list it as a predecessor |
|---|---|---|---|
| B13 | 7 | G1 | none |
| B14 | 5 | G2, G8 | none |
| B15 | 6 | G3 | none |
| B16 | 6 | G4 | none |
| B17 | 5 | G5 | B38 |
| B18 | 2 | G6 | B31 |
| B19 | 8 | G7, G8 | none |
| B20 | 2 | G7 | none |
| B21 | 1 | G8 | B31, B33 |
| B22 | 1 | G8 | none |
| B37 | 1 | G2 | none |

B18 and B21 gate B31 and B33, which gate B40 (12 history-only versions each; 36 in all). Because a batch is one transaction, rejecting any member of an attestation batch means that whole batch cannot run as prepared; I would then propose a re-split without that version.

## 4. The 44 decisions, grouped by business risk
### G7: Payment, financial, identity and webhook data (9 versions)
- **Unproven for the whole group:** Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **Risk if left pending:** HIGH for balance/tax recomputes and address merges: a re-run recalculates or merges live records.

#### D01 `20251209133113` (batch B19)
- **File:** `20251209133113_add_payment_timestamps.sql`; statements: UPDATE x4, ALTER TABLE x3, CREATE OR REPLACE FUNCTION x1, CREATE TRIGGER x2, DROP x1
- **Intended historical effect:** Add Payment Success Timestamp
- **Current supporting evidence:** Q12: 0 succeeded without paid_at, 0 failed without failed_at among 185 payments (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** re-run backfills payment timestamps
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D02 `20260120203953` (batch B19)
- **File:** `20260120203953_backfill_tax_waived_for_old_orders.sql`; statements: UPDATE x2
- **Intended historical effect:** Backfill tax_waived for Old Orders
- **Current supporting evidence:** Q11: 0 NULL tax_waived, 0 waived-with-tax in 171 orders (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** re-run sets tax_waived on historic orders
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D03 `20260125170305` (batch B19)
- **File:** `20260125170305_fix_tax_waived_backfill_logic.sql`; statements: UPDATE x1
- **Intended historical effect:** Fix Tax Waived Backfill Logic
- **Current supporting evidence:** Q11 as above (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** re-run resets tax_waived on historic orders
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D04 `20260302131311` (batch B19)
- **File:** `20260302131311_add_user_id_to_customers_and_password_reset.sql`; statements: UPDATE x5, DELETE x1, ALTER TABLE x1, CREATE POLICY x2
- **Intended historical effect:** Add user authentication link and enable password reset
- **Current supporting evidence:** Q14: 9 customers linked, 0 linkable-but-unlinked of 123 (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** re-run links customers to auth users by e-mail
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D05 `20260311191611` (batch B19)
- **File:** `20260311191611_20260311150000_add_invoice_partial_status.sql`; statements: UPDATE x3, ALTER TABLE x2, DROP x3
- **Intended historical effect:** Add Invoice Partial Payment Status
- **Current supporting evidence:** Q16: 0 paid-but-underpaid invoices (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D06 `20260314213726` (batch B19)
- **File:** `20260314213726_add_address_key_deduplication.sql`; statements: UPDATE x2, DELETE x3, ALTER TABLE x1
- **Intended historical effect:** Add address_key for deduplication
- **Current supporting evidence:** Q13: 0 NULL keys, 0 duplicates in 165 addresses (the merges cannot be proved) (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** re-run computes address keys and merges duplicate addresses
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D07 `20260314215031` (batch B19)
- **File:** `20260314215031_fix_address_key_backfill_prefer_coords.sql`; statements: UPDATE x2, DELETE x1
- **Intended historical effect:** Fix address_key backfill: prefer rows with coordinates as canonical
- **Current supporting evidence:** Q13 as above (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** re-run merges duplicate addresses again
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D08 `20260323175236` (batch B20)
- **File:** `20260323175236_20260323_security_redact_secrets_in_settings_changelog.sql`; statements: INSERT x3, UPDATE x1, CREATE OR REPLACE FUNCTION x1, CREATE TRIGGER x1, DROP x1
- **Intended historical effect:** Redact secret values in admin_settings_changelog
- **Current supporting evidence:** Q18: 0 secret-like changelog rows not redacted (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D09 `20260326004004` (batch B20)
- **File:** `20260326004004_backfill_order_payment_method_last_four_brand.sql`; statements: UPDATE x1
- **Intended historical effect:** Backfill payment_method_last_four and payment_method_brand on orders
- **Current supporting evidence:** Q11_2: 0 orders missing last-four where a succeeded payment has one (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- **If the original SQL ran again now:** re-run copies payment method fields onto orders
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

### G3: Pricing configuration (6 versions)
- **Unproven for the whole group:** Only NULL counts were read; values were not compared with the file or with Production.
- **Risk if left pending:** Medium where the version UPDATEs the single pricing row: a re-run would overwrite today's business values.

#### D10 `20251002180149` (batch B15)
- **File:** `20251002180149_005_update_home_base_wayne_mi.sql`; statements: UPDATE x2
- **Intended historical effect:** Update Home Base to Wayne, MI
- **Current supporting evidence:** Q09: pricing row populated (values not compared with Production here) (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Only NULL counts were read; values were not compared with the file or with Production.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D11 `20251130231633` (batch B15)
- **File:** `20251130231633_add_generator_pricing.sql`; statements: UPDATE x2, ALTER TABLE x2
- **Intended historical effect:** Add Generator Pricing Support
- **Current supporting evidence:** Q09: generator price set; Q10 clean (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Only NULL counts were read; values were not compared with the file or with Production.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D12 `20251222014723` (batch B15)
- **File:** `20251222014723_fix_deposit_and_add_free_cities.sql`; statements: UPDATE x3, ALTER TABLE x1
- **Intended historical effect:** Fix Deposit Amount and Add Free Travel Cities
- **Current supporting evidence:** Q09: deposit_per_unit set (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Only NULL counts were read; values were not compared with the file or with Production.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D13 `20251222020729` (batch B15)
- **File:** `20251222020729_add_generator_and_same_day_fees.sql`; statements: UPDATE x1, ALTER TABLE x3
- **Intended historical effect:** Add Generator and Same Day Pickup Fees
- **Current supporting evidence:** Q09 covers the fee column; the included_cities update is not queried (partial)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Only NULL counts were read; values were not compared with the file or with Production.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D14 `20260119195140` (batch B15)
- **File:** `20260119195140_add_apply_taxes_by_default.sql`; statements: UPDATE x1, ALTER TABLE x1
- **Intended historical effect:** Add Tax Application Control
- **Current supporting evidence:** Q09: apply_taxes_by_default set (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Only NULL counts were read; values were not compared with the file or with Production.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D15 `20260311121119` (batch B15)
- **File:** `20260311121119_add_deposit_percentage_column.sql`; statements: UPDATE x2, ALTER TABLE x1
- **Intended historical effect:** Add deposit_percentage column to pricing_rules
- **Current supporting evidence:** Q09: deposit_percentage set (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Only NULL counts were read; values were not compared with the file or with Production.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

### G6: Role normalization (2 versions)
- **Unproven for the whole group:** Zero mixed-case roles of 9 does not show the UPDATE ran.
- **Risk if left pending:** Low: lower-casing only; no row matches today.

#### D16 `20260324175546` (batch B18)
- **File:** `20260324175546_fix_get_user_role_case_sensitivity_v2.sql`; statements: UPDATE x2, ALTER TABLE x2, CREATE OR REPLACE FUNCTION x1
- **Intended historical effect:** Fix get_user_role case sensitivity bug
- **Current supporting evidence:** Q19: 0 non-lowercase roles of 9 (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero mixed-case roles of 9 does not show the UPDATE ran.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D17 `20260324190039` (batch B18)
- **File:** `20260324190039_normalize_remaining_uppercase_roles.sql`; statements: UPDATE x1
- **Intended historical effect:** Normalize any remaining uppercase role values
- **Current supporting evidence:** Q19: 0 non-lowercase roles of 9 (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero mixed-case roles of 9 does not show the UPDATE ran.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

### G8: Unresolved versions that need an owner decision or one read-only query first (4 versions)
- **Unproven for the whole group:** Current-state evidence contradicts or does not cover the historical effect (details per version).
- **Risk if left pending:** HIGH for the demo administrator and the two backfills: a re-run would create a login, or recompute live customer totals.

#### D18 `20251003182356` (batch B14)
- **File:** `20251003182356_016_add_sms_message_templates.sql`; statements: INSERT x2, UPDATE x4, ALTER TABLE x1, CREATE TABLE x1, CREATE OR REPLACE FUNCTION x1, CREATE POLICY x2, CREATE TRIGGER x1
- **Intended historical effect:** Adds SMS message templates (customer communications).
- **Current supporting evidence:** 5 named templates present; the test template `test_message` is absent. (unresolved: owner decision or one read-only query first)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Current-state evidence contradicts or does not cover the historical effect (details per version).
- **If the original SQL ran again now:** Idempotent insert would re-add the test template the owner removed: unwanted.
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D19 `20260305205811` (batch B19)
- **File:** `20260305205811_add_customer_selected_payment_tracking.sql`; statements: UPDATE x1, ALTER TABLE x1
- **Intended historical effect:** Adds the customer_selected_payment tracking column and backfills it.
- **Current supporting evidence:** Q11: 22 orders have deposit_due set but customer_selected_payment unset; the backfill predicate still matches. (unresolved: owner decision or one read-only query first)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Current-state evidence contradicts or does not cover the historical effect (details per version).
- **If the original SQL ran again now:** A re-run would backfill those 22 live orders: changes live records.
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D20 `20260323164559` (batch B21)
- **File:** `20260323164559_fix_total_spent_cents_include_custom_fees_discounts.sql`; statements: INSERT x1, UPDATE x3, DELETE x2, CREATE OR REPLACE FUNCTION x1
- **Intended historical effect:** Recomputes total_spent_cents to include custom fees and discounts.
- **Current supporting evidence:** Q15 (customer totals) is consistent but the formula was never re-proved on edited orders. (unresolved: owner decision or one read-only query first)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Current-state evidence contradicts or does not cover the historical effect (details per version).
- **If the original SQL ran again now:** A re-run would recompute live customer totals: changes live records.
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D21 `20251003170350` (batch B22)
- **File:** `20251003170350_015_create_demo_admin_user.sql`; statements: INSERT x3
- **Intended historical effect:** Creates the demo administrator login.
- **Current supporting evidence:** Q26: the demo admin login EXISTS. Execution remains prohibited; owner security review (SEC-005). (unresolved: owner decision or one read-only query first)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Current-state evidence contradicts or does not cover the historical effect (details per version).
- **If the original SQL ran again now:** A re-run would (re)create a known-credential admin login: UNSAFE.
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

### G1: Admin settings seeds (7 versions)
- **Unproven for the whole group:** Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **Risk if left pending:** Low if keys are idempotent seeds; MEDIUM where the version overwrites a value (UPDATE of a setting).

#### D22 `20251003152224` (batch B13)
- **File:** `20251003152224_20251003210000_013_add_twilio_credentials.sql`; statements: INSERT x1
- **Intended historical effect:** Add Twilio Credentials to Admin Settings
- **Current supporting evidence:** 2 named keys/templates present; not covered by the query: twilio_from_number (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D23 `20251003183947` (batch B13)
- **File:** `20251003183947_017_add_admin_email_setting.sql`; statements: INSERT x1, UPDATE x1
- **Intended historical effect:** Add Admin Email Setting
- **Current supporting evidence:** 1 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **If the original SQL ran again now:** schema/DO only
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D24 `20251007210840` (batch B13)
- **File:** `20251007210840_022_add_stripe_publishable_key.sql`; statements: INSERT x1
- **Intended historical effect:** Add Stripe Publishable Key Setting
- **Current supporting evidence:** 1 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D25 `20251231171420` (batch B13)
- **File:** `20251231171420_20251231172000_add_business_branding_settings.sql`; statements: INSERT x3
- **Intended historical effect:** Add Business Branding Settings
- **Current supporting evidence:** 1 named keys/templates present; not covered by the query: business_address, business_email, business_legal_entity, business_license_number, business_name_short, business_phone; business_website intentionally deleted by 20260203053948 (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D26 `20260126184412` (batch B13)
- **File:** `20260126184412_add_travel_fee_default_and_home_address.sql`; statements: INSERT x5
- **Intended historical effect:** Add Travel Fee Default Setting and Home Address
- **Current supporting evidence:** 4 named keys/templates present; not covered by the query: home_address_city, home_address_line2, home_address_state, home_address_zip (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D27 `20260203053948` (batch B13)
- **File:** `20260203053948_20260203000000_add_social_media_urls.sql`; statements: INSERT x1, UPDATE x1, DELETE x1
- **Intended historical effect:** Add Social Media URLs and Travel Address Preference
- **Current supporting evidence:** 2 named keys/templates present; not covered by the query: use_business_address_for_travel (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **If the original SQL ran again now:** deletes rows
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D28 `20260325231020` (batch B13)
- **File:** `20260325231020_add_carousel_show_arrows_setting.sql`; statements: INSERT x1
- **Intended historical effect:** Add Carousel Show Arrows Setting
- **Current supporting evidence:** 1 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Row existence is not proof the seed ran; values were not compared with the file or with Production.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

### G2: Message and e-mail template seeds (5 versions)
- **Unproven for the whole group:** Templates may have been edited or created by hand; text was never read.
- **Risk if left pending:** Low: seeds use ON CONFLICT DO NOTHING; a re-run would not overwrite edited text.

#### D29 `20251008144308` (batch B14)
- **File:** `20251008144308_031_add_admin_notification_template.sql`; statements: INSERT x2, UPDATE x3
- **Intended historical effect:** Add Admin Notification Template and Phone Setting
- **Current supporting evidence:** 2 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Templates may have been edited or created by hand; text was never read.
- **If the original SQL ran again now:** schema/DO only
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D30 `20251205125907` (batch B14)
- **File:** `20251205125907_add_crew_checkpoint_sms_templates.sql`; statements: INSERT x2, DROP x3
- **Intended historical effect:** Add Crew Checkpoint SMS Templates
- **Current supporting evidence:** 4 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Templates may have been edited or created by hand; text was never read.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D31 `20251216201450` (batch B14)
- **File:** `20251216201450_add_order_cancellation_admin_sms_template.sql`; statements: INSERT x1, UPDATE x1
- **Intended historical effect:** Add Order Cancellation Admin SMS Template
- **Current supporting evidence:** 1 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Templates may have been edited or created by hand; text was never read.
- **If the original SQL ran again now:** schema/DO only
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D32 `20260126193254` (batch B14)
- **File:** `20260126193254_add_pictures_reminder_sms_template.sql`; statements: INSERT x1, UPDATE x1
- **Intended historical effect:** Add Pictures Reminder SMS Template
- **Current supporting evidence:** 1 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Templates may have been edited or created by hand; text was never read.
- **If the original SQL ran again now:** schema/DO only
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D33 `20251221225000` (batch B37)
- **File:** `20251221225000_add_email_templates_system.sql`; statements: INSERT x1, UPDATE x7, ALTER TABLE x1, CREATE TABLE x1, CREATE OR REPLACE FUNCTION x1, CREATE POLICY x2, CREATE TRIGGER x1, DROP x1
- **Intended historical effect:** Add Email Templates System
- **Current supporting evidence:** 5 named keys/templates present (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Templates may have been edited or created by hand; text was never read.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

### G4: Order status and flag normalizations (6 versions)
- **Unproven for the whole group:** Zero matching rows is also the state of a database that never had such rows.
- **Risk if left pending:** Low: guarded by a predicate that matches no row today.

#### D34 `20251007220415` (batch B16)
- **File:** `20251007220415_026_add_payment_pending_status.sql`; statements: UPDATE x2
- **Intended historical effect:** Add Payment Pending Status
- **Current supporting evidence:** Q10: 0 blank statuses in 171 orders (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero matching rows is also the state of a database that never had such rows.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D35 `20251007221227` (batch B16)
- **File:** `20251007221227_027_update_order_status_to_draft.sql`; statements: UPDATE x4
- **Intended historical effect:** Update Order Status to Draft for Unpaid Invoices
- **Current supporting evidence:** Q10: 0 payment_pending in 171 orders (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero matching rows is also the state of a database that never had such rows.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D36 `20251007221817` (batch B16)
- **File:** `20251007221817_028_add_deposit_required_flag.sql`; statements: UPDATE x2, ALTER TABLE x1
- **Intended historical effect:** Add Deposit Required Flag to Orders
- **Current supporting evidence:** Q10: 0 NULL deposit_required in 171 orders (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero matching rows is also the state of a database that never had such rows.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D37 `20251130191333` (batch B16)
- **File:** `20251130191333_add_event_end_date_and_pickup_preference.sql`; statements: UPDATE x2, ALTER TABLE x5
- **Intended historical effect:** Add Event End Date and Pickup Preference
- **Current supporting evidence:** Q10: 0 NULL event_end_date; pickup_preference part not queried (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero matching rows is also the state of a database that never had such rows.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D38 `20260816221636` (batch B16)
- **File:** `20260816221636_20260816120000_add_payment_lock_column.sql.sql`; statements: UPDATE x2, ALTER TABLE x1, GRANT x2
- **Intended historical effect:** Add dedicated payment_lock column to orders
- **Current supporting evidence:** Q10: 0 NULL payment_lock (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero matching rows is also the state of a database that never had such rows.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D39 `20260928172217` (batch B16)
- **File:** `20260928172217_20260928120000_add_parks_acknowledgment_system.sql`; statements: UPDATE x1, ALTER TABLE x2
- **Intended historical effect:** Add Parks Acknowledgment System
- **Current supporting evidence:** no captured query covers the parks-acknowledgment backfill (inconclusive)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Zero matching rows is also the state of a database that never had such rows.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

### G5: Catalog, content and link backfills (5 versions)
- **Unproven for the whole group:** Content is edited by the business; presence is not provenance.
- **Risk if left pending:** Low to medium; the sample-unit seed would insert sample inventory.

#### D40 `20251231174711` (batch B17)
- **File:** `20251231174711_create_notification_failure_tracking.sql`; statements: INSERT x7, UPDATE x9, ALTER TABLE x2, CREATE TABLE x2, CREATE OR REPLACE FUNCTION x3, CREATE POLICY x5, DROP x5
- **Intended historical effect:** Create Notification Failure Tracking System
- **Current supporting evidence:** Q08: email and sms status rows (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Content is edited by the business; presence is not provenance.
- **If the original SQL ran again now:** idempotent insert
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D41 `20260224165424` (batch B17)
- **File:** `20260224165424_convert_unit_type_to_array.sql`; statements: UPDATE x2, ALTER TABLE x4, DROP x2
- **Intended historical effect:** Convert Unit Type to Array for Multiple Categories
- **Current supporting evidence:** Q05: 0 units with NULL types (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Content is edited by the business; presence is not provenance.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D42 `20260318191352` (batch B17)
- **File:** `20260318191352_fix_waterslide_water_price.sql`; statements: UPDATE x1
- **Intended historical effect:** Fix Water Slide Pricing
- **Current supporting evidence:** Q05 does not test the water-slide price predicate; units exist (inconclusive)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Content is edited by the business; presence is not provenance.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D43 `20260331151647` (batch B17)
- **File:** `20260331151647_add_image_visibility_mode_to_unit_media.sql`; statements: UPDATE x1, ALTER TABLE x1
- **Intended historical effect:** Add visibility_mode to unit_media
- **Current supporting evidence:** Q05: 0 media rows pending the visibility backfill (supported (consistent, not proof))
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Content is edited by the business; presence is not provenance.
- **If the original SQL ran again now:** conditional update
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

#### D44 `20260415234700` (batch B17)
- **File:** `20260415234700_backfill_portal_shortlinks_in_invoice_links.sql`; statements: UPDATE x2, DROP x1
- **Intended historical effect:** Backfill historical portal_shortlink rows in invoice_links
- **Current supporting evidence:** Q27: 38 invoice-type and 247 portal_shortlink links; the backfill's full predicate was not captured (inconclusive)
- **Still unproven:** that this SQL executed, and that today's values equal what it wrote. Content is edited by the business; presence is not provenance.
- **If the original SQL ran again now:** re-run converts invoice links to portal short links
- **Decision asked:** ATTEST (state is as intended; no claim it executed) or REJECT (leave pending).

