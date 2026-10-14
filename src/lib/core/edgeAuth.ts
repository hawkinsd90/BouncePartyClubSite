import { supabase } from '../supabase';

// Bearer token for Edge Function calls: the signed-in user's access token when there is a session, otherwise the
// public anon key. The anon key proves nothing about a caller, so functions that need an admin or an order owner
// authorize server-side (a signed-in token resolves to a user there; the anon key stays anonymous).
export async function getEdgeAuthToken(): Promise<string> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || anonKey;
  } catch {
    return anonKey;
  }
}
