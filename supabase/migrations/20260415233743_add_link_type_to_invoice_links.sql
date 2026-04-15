/*
  # Add link_type to invoice_links

  ## Purpose
  Distinguishes real admin-created invoice links from generic short portal links
  created for SMS delivery. Without this column, any row in invoice_links caused
  an order to be misclassified as an admin invoice, bypassing admin review.

  ## Changes
  - Adds `link_type` column: 'invoice' (real admin invoice) | 'portal_shortlink' (SMS shortlink)
  - Existing rows (all created by send-invoice) default to 'invoice'
  - New portal shortlinks will be inserted with link_type = 'portal_shortlink'

  ## No data loss
  Purely additive. Existing rows are correctly classified as 'invoice'.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_links' AND column_name = 'link_type'
  ) THEN
    ALTER TABLE invoice_links ADD COLUMN link_type text NOT NULL DEFAULT 'invoice';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS invoice_links_link_type_idx ON invoice_links(link_type);
