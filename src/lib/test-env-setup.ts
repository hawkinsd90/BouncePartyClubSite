// Sets up import.meta.env for tsx (Node) — Vite-only in production
(import.meta as any).env = {
  VITE_SUPABASE_URL: 'https://test.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
};
