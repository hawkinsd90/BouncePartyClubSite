// Dev-server guard (Step 3B: SEC-041): a local dev or preview server must refuse to start against the Production Supabase project unless
// that is explicitly requested, and a production BUILD must be unaffected.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;
const fs = require('fs');

// @ts-expect-error plain ESM helper without a declaration file (also imported by vite.config.ts)
import { assertNotProductionBackend, pointsAtProduction, PRODUCTION_PROJECT_REF } from '../../../../scripts/dev/production-backend-guard.mjs';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
const throws = (f: () => void) => { try { f(); return false; } catch { return true; } };

const PROD = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const DEV = 'https://srxunxiytojjsuhcmzjg.supabase.co';

ok('the Production project reference is the one in the audit documents', PRODUCTION_PROJECT_REF === 'qaagfafagdpgzcijnfbw');
ok('the Production URL is recognised', pointsAtProduction(PROD) && pointsAtProduction(PROD + '/') && pointsAtProduction(PROD.toUpperCase()));
ok('a Development, local or empty URL is not Production', !pointsAtProduction(DEV) && !pointsAtProduction('http://127.0.0.1:54321') && !pointsAtProduction('') && !pointsAtProduction(undefined));
ok('a look-alike host that merely contains the reference text elsewhere is not treated as the Production host', !pointsAtProduction(`https://example.com/${PRODUCTION_PROJECT_REF}`));
ok('`vite` (serve) against Production is refused', throws(() => assertNotProductionBackend({ command: 'serve', env: { VITE_SUPABASE_URL: PROD } })));
ok('`vite preview` also uses serve and is refused', throws(() => assertNotProductionBackend({ command: 'serve', env: { VITE_SUPABASE_URL: PROD }, shellEnv: {} })));
ok('`vite` against Development starts', !throws(() => assertNotProductionBackend({ command: 'serve', env: { VITE_SUPABASE_URL: DEV } })));
ok('`vite build` for Production is NOT blocked (the deployed site is built as before)', !throws(() => assertNotProductionBackend({ command: 'build', env: { VITE_SUPABASE_URL: PROD } })));
ok('an explicit BPC_ALLOW_PRODUCTION_BACKEND=yes in the shell allows it', !throws(() => assertNotProductionBackend({ command: 'serve', env: { VITE_SUPABASE_URL: PROD }, shellEnv: { BPC_ALLOW_PRODUCTION_BACKEND: 'yes' } })));
ok('any other value of the override does not allow it', throws(() => assertNotProductionBackend({ command: 'serve', env: { VITE_SUPABASE_URL: PROD }, shellEnv: { BPC_ALLOW_PRODUCTION_BACKEND: 'true' } })));
let message = '';
try { assertNotProductionBackend({ command: 'serve', env: { VITE_SUPABASE_URL: PROD } }); } catch (e: any) { message = String(e.message); }
ok('the refusal says what to do and prints no key', /Development/.test(message) && /BPC_ALLOW_PRODUCTION_BACKEND/.test(message) && !/eyJ/.test(message));
const cfg = fs.readFileSync('vite.config.ts', 'utf8');
ok('vite.config.ts runs the guard with the resolved environment and the shell environment', /assertNotProductionBackend\(/.test(cfg) && /loadEnv\(mode/.test(cfg) && /shellEnv/.test(cfg));

console.log(`Production backend guard tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} production backend guard test(s) failed`);
