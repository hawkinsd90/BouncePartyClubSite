CREATE POLICY "Anon can insert portal shortlinks"
ON public.invoice_links FOR INSERT
TO anon, authenticated
WITH CHECK (link_type = 'portal_shortlink' AND deposit_cents = 0);