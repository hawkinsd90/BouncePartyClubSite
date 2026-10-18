// Refuses to start a LOCAL dev or preview server that is pointed at the Production Supabase project (Step 3B: SEC-041).
//
// The checked-in-style local `.env` resolves VITE_SUPABASE_URL to Production, and Vite lets a shell variable override it, so a plain
// `npm run dev` silently reads and writes live data. A production BUILD is unaffected: the guard runs only for `vite` / `vite preview`
// (command "serve"), never for `vite build`, so the deployed site is built exactly as before.
//
// To work against Production deliberately, set BPC_ALLOW_PRODUCTION_BACKEND=yes in the shell. To work against Development, set
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the shell before starting (shell values win over `.env`).

export const PRODUCTION_PROJECT_REF = 'qaagfafagdpgzcijnfbw';

export function pointsAtProduction(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === `${PRODUCTION_PROJECT_REF}.supabase.co` || host.startsWith(`${PRODUCTION_PROJECT_REF}.`);
  } catch {
    return url.toLowerCase().includes(PRODUCTION_PROJECT_REF);
  }
}

export function assertNotProductionBackend({ command, env, shellEnv = {} }) {
  if (command !== 'serve') return;
  if (shellEnv.BPC_ALLOW_PRODUCTION_BACKEND === 'yes') return;
  if (!pointsAtProduction(env.VITE_SUPABASE_URL)) return;
  throw new Error(
    'Refusing to start a local server against the PRODUCTION Supabase project (VITE_SUPABASE_URL points at it).\n' +
      'Use Development instead: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your shell for the Development project, then start again.\n' +
      'To really use Production from this machine, set BPC_ALLOW_PRODUCTION_BACKEND=yes in the shell first.',
  );
}
