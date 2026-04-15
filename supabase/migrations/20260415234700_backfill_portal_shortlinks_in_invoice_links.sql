/*
  # Backfill historical portal_shortlink rows in invoice_links

  ## Background
  A hotfix (add_link_type_to_invoice_links) added a `link_type` column with DEFAULT 'invoice'.
  Before that hotfix, createShortPortalLink() inserted into invoice_links with no link_type,
  so those rows defaulted to 'invoice' and were misclassified as real admin invoices.

  ## What this migration does
  Reclassifies historical polluted rows from link_type = 'invoice' to 'portal_shortlink'
  using the definitive 3-field fingerprint of rows created by createShortPortalLink():
    1. deposit_cents = 0        (hardcoded in createShortPortalLink, never used in send-invoice)
    2. customer_filled = true   (hardcoded in createShortPortalLink)
    3. short_code IS NOT NULL   (always generated in createShortPortalLink)

  ## Safety
  - Zero current live rows with link_type = 'invoice' match all three conditions simultaneously
  - Real invoice rows from send-invoice always have deposit_cents > 0 in practice
  - This is a targeted UPDATE, not a DROP or structural change
  - Any row not matching all three conditions is left untouched

  ## Rows protected (not touched)
  - deposit_cents > 0               → real invoice rows
  - customer_filled = false         → real invoice rows (admin sent without customer email)
  - short_code IS NULL              → early real invoice rows before short_code feature
  - link_type = 'portal_shortlink'  → already correctly classified (future writes)
*/

UPDATE invoice_links
SET link_type = 'portal_shortlink'
WHERE link_type = 'invoice'
  AND deposit_cents = 0
  AND customer_filled = true
  AND short_code IS NOT NULL;
