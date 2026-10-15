ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS customer_view_updated_at timestamptz;