// Test-only: gives modules that read `window` at import time (the Supabase browser client) a minimal stand-in, so
// browser-side portal code can be loaded under Node. Import this FIRST in a test file.
/* eslint-disable @typescript-eslint/no-explicit-any */
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { origin: 'https://site.test', hash: '', search: '', href: 'https://site.test/' },
  };
}
export {};
