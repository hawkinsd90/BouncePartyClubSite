/*
  # Document historical decline-link classification gap

  ## Background
  The prior hotfix (add_link_type_to_invoice_links + backfill_portal_shortlinks)
  addressed rows created by createShortPortalLink() which had:
    - deposit_cents = 0
    - customer_filled = true
    - short_code IS NOT NULL
  Those rows were safely reclassified to portal_shortlink.

  ## Remaining gap
  orderApprovalService.ts was also inserting into invoice_links for card-decline
  notifications, WITHOUT setting link_type, so those rows defaulted to 'invoice'.
  Those rows have:
    - deposit_cents = deposit_due_cents (> 0 for real deposit orders)
    - customer_filled = false
    - short_code = NULL

  ## Why no automated backfill is safe here
  The field combination (customer_filled=false, deposit_cents>0, short_code IS NULL)
  is IDENTICAL to the fingerprint of legitimate admin invoice rows created by send-invoice
  when the admin does not provide a customer email. There is no stored distinguisher
  between decline-notification rows and real invoice rows for this case.

  ## What was fixed going forward
  orderApprovalService.ts now writes link_type = 'portal_shortlink' explicitly
  on all new decline/update-payment notification links (applied in code hotfix).

  ## Impact of historical rows
  - Volume: only orders where charge-deposit failed during the bad rollout window
  - Effect: those orders are misclassified as admin invoices in webhook/payment-completion checks
  - Mitigation: the order lifecycle is still correct if the customer pays via portal
    (which calls enterConfirmed rather than enterPendingReview); this is actually
    the correct path for a re-attempted payment on a declined-deposit order
  - No data will be corrupted by leaving these rows as-is

  ## No SQL changes in this migration
  This migration intentionally contains no data mutations.
  It is a permanent audit record of why no automated backfill was applied.
*/

SELECT 1;
