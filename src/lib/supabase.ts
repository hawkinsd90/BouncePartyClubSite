// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Log for debugging
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables:', {
    hasUrl: !!supabaseUrl,
    hasKey: !!supabaseAnonKey,
    url: supabaseUrl,
  });
}

// Use fallback values to prevent app crash, but log the issue
const finalUrl = supabaseUrl || 'https://placeholder.supabase.co';
const finalKey = supabaseAnonKey || 'placeholder-key';

export const supabase = createClient<Database>(finalUrl, finalKey);
