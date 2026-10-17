# E2K: owner attestation decisions (54 individually listed versions)

Nothing here is an attestation or an approval. **No blanket attestation is requested.** Each version below needs its own signature; versions are grouped only where they share the same independently supported evidence and risk, and each group carries its own recommended disposition. Current-state evidence comes from the E2J-B hosted read-only capture (2026-10-17; the results were transcribed from the Supabase integration, see `e2k-report.md`). **Current-state equivalence is not proof that the historical SQL ran**; a qualified attestation would state exactly that: "the database is in the state this version describes; I do not claim this migration executed".

How to read the risk columns. *Risk if bookkeeping is performed*: the ledger would show the version as handled while its effect is only inferred. *Risk if left pending*: any tool that applies pending migrations would re-run the SQL against live data; the re-run effect column states what that would do.

## G1 Admin settings seeds (10 versions)

- Shared unproven effect: Row existence is not proof the seed ran; values were not compared with the file or with Production.
- Risk if left pending (group): Low if keys are idempotent seeds; MEDIUM where the version overwrites a value (UPDATE of a setting).

| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |
|---|---|---|---|---|---|---|
| `20251002210020` | Admin Settings Configuration | 1 named keys/templates present | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251003152224` | Add Twilio Credentials to Admin Settings | 2 named keys/templates present; not covered by the query: twilio_from_number | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251003183947` | Add Admin Email Setting | 1 named keys/templates present | schema/DO only | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251007210840` | Add Stripe Publishable Key Setting | 1 named keys/templates present | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251231171420` | Add Business Branding Settings | 1 named keys/templates present; not covered by the query: business_address, business_email, business_legal_entity, business_license_number, business_name_short, business_phone; business_website intentionally deleted by 20260203053948 | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260126184412` | Add Travel Fee Default Setting and Home Address | 4 named keys/templates present; not covered by the query: home_address_city, home_address_line2, home_address_state, home_address_zip | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260126193205` | Fix Home Address Default to Correct Address | the version only UPDATEs existing settings; the related keys exist (Q02: home_address_* / google_review_url present with values) but the values were not compared with the file or Production | re-run overwrites the home-address settings with constants | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260203053948` | Add Social Media URLs and Travel Address Preference | 2 named keys/templates present; not covered by the query: use_business_address_for_travel | deletes rows | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260224184535` | Update Google Review URL | the version only UPDATEs existing settings; the related keys exist (Q02: home_address_* / google_review_url present with values) but the values were not compared with the file or Production | re-run overwrites the review URL | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260325231020` | Add Carousel Show Arrows Setting | 1 named keys/templates present | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |

## G2 Message and e-mail template seeds (6 versions)

- Shared unproven effect: Templates may have been edited or created by hand; text was never read.
- Risk if left pending (group): Low: seeds use ON CONFLICT DO NOTHING; a re-run would not overwrite edited text.

| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |
|---|---|---|---|---|---|---|
| `20251008144308` | Add Admin Notification Template and Phone Setting | 2 named keys/templates present | schema/DO only | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251205125907` | Add Crew Checkpoint SMS Templates | 4 named keys/templates present | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251216201450` | Add Order Cancellation Admin SMS Template | 1 named keys/templates present | schema/DO only | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260126193254` | Add Pictures Reminder SMS Template | 1 named keys/templates present | schema/DO only | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251221225000` | Add Email Templates System | 5 named keys/templates present | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260224183629` | Add Google Review Link to Pickup Complete Messages | 2 named keys/templates present | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |

## G3 Pricing configuration (8 versions)

- Shared unproven effect: Only NULL counts were read; values were not compared with the file or with Production.
- Risk if left pending (group): Medium where the version UPDATEs the single pricing row: a re-run would overwrite today's business values.

| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |
|---|---|---|---|---|---|---|
| `20251001051901` | Bounce Party Club - Core Schema (Phase 1 MVP) | Q09: the single pricing_rules row exists with no NULLs; the wet_or_dry/surface NOT NULL gap is closed by the October chain | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251001192425` | Add New Order and Pricing Fields | Q09 sandbag fee set; the orders.start_date column the backfill targeted no longer exists (Q10 not applicable) | conditional update, unconditional update | partial | Attest only the schema/pricing part: The orders.start_date column the backfill targeted no longer exists. | Yes, signed for this version only |
| `20251002180149` | Update Home Base to Wayne, MI | Q09: pricing row populated (values not compared with Production here) | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251130231633` | Add Generator Pricing Support | Q09: generator price set; Q10 clean | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251222014723` | Fix Deposit Amount and Add Free Travel Cities | Q09: deposit_per_unit set | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251222020729` | Add Generator and Same Day Pickup Fees | Q09 covers the fee column; the included_cities update is not queried | conditional update | partial | Attest the fee column; query the cities update: included_cities update not covered. | Yes, signed for this version only |
| `20260119195140` | Add Tax Application Control | Q09: apply_taxes_by_default set | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260311121119` | Add deposit_percentage column to pricing_rules | Q09: deposit_percentage set | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |

## G4 Order status and flag normalizations (6 versions)

- Shared unproven effect: Zero matching rows is also the state of a database that never had such rows.
- Risk if left pending (group): Low: guarded by a predicate that matches no row today.

| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |
|---|---|---|---|---|---|---|
| `20251007220415` | Add Payment Pending Status | Q10: 0 blank statuses in 171 orders | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251007221227` | Update Order Status to Draft for Unpaid Invoices | Q10: 0 payment_pending in 171 orders | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251007221817` | Add Deposit Required Flag to Orders | Q10: 0 NULL deposit_required in 171 orders | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251130191333` | Add Event End Date and Pickup Preference | Q10: 0 NULL event_end_date; pickup_preference part not queried | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260816221636` | Add dedicated payment_lock column to orders | Q10: 0 NULL payment_lock | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260928172217` | Add Parks Acknowledgment System | no captured query covers the parks-acknowledgment backfill | conditional update | inconclusive | Query first, or leave pending: No captured query covers the parks-acknowledgment backfill. | Yes, signed for this version only |

## G5 Catalog, content and link backfills (9 versions)

- Shared unproven effect: Content is edited by the business; presence is not provenance.
- Risk if left pending (group): Low to medium; the sample-unit seed would insert sample inventory.

| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |
|---|---|---|---|---|---|---|
| `20251001052039` | Seed Sample Units for Bounce Party Club | Q05: 16 units exist but none of the 3 seed slugs; the catalog was replaced or edited since. Never re-insert | re-run would insert sample units | partial | DO NOT ATTEST AS APPLIED; owner decides: The 3 sample units are absent and the catalog holds 16 other units; the seed was either replaced or never applied. Recording as applied would claim an effect that is not visible. Recommended: owner attests 'obsolete seed, never re-run' (not 'executed'), or leave pending. | Yes, signed for this version only |
| `20251207160232` | Add Hero Carousel System | Q06: 3 carousel rows | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20251231174711` | Create Notification Failure Tracking System | Q08: email and sms status rows | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260224133344` | Create Google Reviews System | Q07: 1 review row | idempotent insert | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260224161311` | Add Featured Image Support to Unit Media | Q05: 12 featured media rows of 35 | schema/DO only | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260224165424` | Convert Unit Type to Array for Multiple Categories | Q05: 0 units with NULL types | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260318191352` | Fix Water Slide Pricing | Q05 does not test the water-slide price predicate; units exist | conditional update | inconclusive | Query first, or leave pending: The water-slide price predicate is not covered by any captured query. | Yes, signed for this version only |
| `20260331151647` | Add visibility_mode to unit_media | Q05: 0 media rows pending the visibility backfill | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260415234700` | Backfill historical portal_shortlink rows in invoice_links | Q27: 38 invoice-type and 247 portal_shortlink links; the backfill's full predicate was not captured | re-run converts invoice links to portal short links | inconclusive | Query first, or leave pending: 38 invoice-type links remain; the backfill's full predicate was not captured. | Yes, signed for this version only |

## G6 Role normalization (2 versions)

- Shared unproven effect: Zero mixed-case roles of 9 does not show the UPDATE ran.
- Risk if left pending (group): Low: lower-casing only; no row matches today.

| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |
|---|---|---|---|---|---|---|
| `20260324175546` | Fix get_user_role case sensitivity bug | Q19: 0 non-lowercase roles of 9 | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260324190039` | Normalize any remaining uppercase role values | Q19: 0 non-lowercase roles of 9 | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |

## G7 Payment, financial, identity and webhook data (13 versions)

- Shared unproven effect: Consistency checks are weak; the historical formulas cannot be re-proved on orders edited since.
- Risk if left pending (group): HIGH for balance/tax recomputes and address merges: a re-run recalculates or merges live records.

| Version | Historical purpose | Current-state evidence (live) | Re-run effect if left pending | Evidence | Recommended disposition | Owner approval |
|---|---|---|---|---|---|---|
| `20251209133113` | Add Payment Success Timestamp | Q12: 0 succeeded without paid_at, 0 failed without failed_at among 185 payments | re-run backfills payment timestamps | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260120203953` | Backfill tax_waived for Old Orders | Q11: 0 NULL tax_waived, 0 waived-with-tax in 171 orders | re-run sets tax_waived on historic orders | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260125170305` | Fix Tax Waived Backfill Logic | Q11 as above | re-run resets tax_waived on historic orders | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260125173238` | Fix Incorrect Balance Due Calculations | Q11: 0 NULL balance_due (the formula itself cannot be re-proved on edited orders) | re-run recalculates balance_due on every order | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260305222010` | Fix Balance Calculation to Exclude Tip | Q11: 0 NULL balance_due (formula not re-provable) | re-run recalculates balance_due on every order (tips excluded) | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260326004004` | Backfill payment_method_last_four and payment_method_brand on orders | Q11_2: 0 orders missing last-four where a succeeded payment has one | re-run copies payment method fields onto orders | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260302131311` | Add user authentication link and enable password reset | Q14: 9 customers linked, 0 linkable-but-unlinked of 123 | re-run links customers to auth users by e-mail | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260311191611` | Add Invoice Partial Payment Status | Q16: 0 paid-but-underpaid invoices | conditional update | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260314213726` | Add address_key for deduplication | Q13: 0 NULL keys, 0 duplicates in 165 addresses (the merges cannot be proved) | re-run computes address keys and merges duplicate addresses | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260314215031` | Fix address_key backfill: prefer rows with coordinates as canonical | Q13 as above | re-run merges duplicate addresses again | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260315173745` | Fix trigger + backfill: customer_profiles has first_name/last_name, not display_name/phone | Q28: 0 NULL first_name in 6 profiles | re-run backfills profile names | supported (consistent, not proof) | Attest individually after the owner confirms the content is intended | Yes, signed for this version only |
| `20260323175236` | Redact secret values in admin_settings_changelog | Q18: 0 secret-like changelog rows not redacted | conditional update | supported (consistent, not proof) | Attest (security state verified safe): Q18 = 0 secret-like changelog rows unredacted; this is a safe-state check, the strongest evidence in the group. | Yes, signed for this version only |
| `20260311113547` | Fix Webhook Idempotency and Receipt Deduplication | Constraint webhook_events_status_check and trigger update_webhook_events_updated_at are present and identical in both captures; the only data statement updates stripe_webhook_events rows and the table is empty (Q17), so the data effect is vacuous and unprovable. Low-risk individual attestation. | conditional update | inconclusive | Query first, or leave pending | Yes, signed for this version only |

## What the owner is asked

1. Decide group by group whether the recommended disposition is acceptable; sign **per version**, naming the observed state and the date. The executor already supports a qualified-attestation record (version, observation, author, date).
2. For versions marked *Query first*, either approve a narrowly scoped read-only query (`e2k-additional-readonly-queries.sql`, not run) or choose to leave them pending.
3. Versions the owner will not attest remain pending; nothing may be recorded for them by default.

## Not attestable or not in this list

The eight unresolved versions (`e2k-report.md` section 3) are not offered for attestation. The 221+ history-only candidates are bookkeeping candidates re-verified at run time, not owner attestations.
