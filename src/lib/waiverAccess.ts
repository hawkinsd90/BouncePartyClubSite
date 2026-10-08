import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Headers for the waiver Edge Functions. A signed-in visitor sends their own session (the server recognises an order's owner
// or staff from it); anyone else sends the public key, which proves nothing by itself, so the portal token travels in the body.
export async function waiverFunctionHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
}

// The signed waiver PDF lives in a private bucket, so the browser cannot open a stored link directly. A signed-in customer
// asks the server for a short-lived link; the server returns one only for an order that customer owns.
export async function fetchSignedWaiverPdfUrl(orderId: string): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-waiver-status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const url = body?.data?.pdf_url;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
}
