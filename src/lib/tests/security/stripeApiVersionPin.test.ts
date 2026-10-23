// The Edge Functions deliberately pin Stripe API version 2024-10-28.acacia while the installed SDK (stripe@20) is typed for 2025-11-17.clover.
// Stripe documents passing another version than the latest (the types then describe the latest only), so each site casts the literal to the SDK's
// version type. This test pins that nothing was upgraded and that no site silently diverged. PASS - LOCAL AUTOMATED (source assertions).
import { readdirSync, readFileSync, statSync } from 'node:fs';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`;
    if (e === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const PINNED = '2024-10-28.acacia';
let sites = 0;
const wrong: string[] = [];
for (const f of walk('supabase/functions')) {
  const t = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  for (const m of t.matchAll(/apiVersion:\s*([^,}\n]+)/g)) {
    sites++;
    if (m[1].trim() !== `"${PINNED}" as unknown as Stripe.LatestApiVersion`) wrong.push(`${f}: ${m[1].trim()}`);
  }
}
ok(`every Stripe client in the Edge Functions pins ${PINNED} (${sites} sites) with the documented type override${wrong.length ? ' - differing: ' + wrong.join('; ') : ''}`, wrong.length === 0 && sites === 15);

console.log(`stripeApiVersionPin: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} Stripe API version pin test(s) failed`);
