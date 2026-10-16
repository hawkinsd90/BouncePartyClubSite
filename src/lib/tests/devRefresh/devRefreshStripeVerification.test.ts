/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Stripe test-mode verification before any financial history is imported.
// test-mode verification, notification pathway review, protection of the sensitive local files, and retention / cleanup.
// Scenarios that need a database use throw-away scratch databases on the local test server (never a Supabase project) and synthetic rows.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/devRefresh/devRefreshStripeVerification.test.ts

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit: (n: number) => void; platform: string };
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

import { resolveTargets } from '../../../../scripts/dev-refresh/cli.mjs';
import { REVIEWED_FUNCTIONS, REVIEWED_HOSTED_ONLY, ATTESTATIONS, PATHWAY, auditDeployedFunctions, classifyFunctionFiles, classifyFunctionSource, relayCallingModules, usesUnreviewedProvider } from '../../../../scripts/dev-refresh/lib/pathways.mjs';
import { accessList, currentPrincipal, ensureProtectedDir, isRestricted, protectPath } from '../../../../scripts/dev-refresh/lib/protect.mjs';
import { RETENTION, cleanupPhrase, executeCleanup, planCleanup } from '../../../../scripts/dev-refresh/lib/retention.mjs';
import { DriftError, apply, confirmationPhrase, driftPhrase, preview, readManifest, restore, restorePhrase, stripeProblems, writeManifest } from '../../../../scripts/dev-refresh/lib/run.mjs';
import { K, buildScratchPair, id, psqlOn, scalar, scratchAvailable } from '../support/devRefreshScratch.mjs';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function eq(label: string, a: unknown, b: unknown) {
  ok(`${label} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
}
function thrown(f: () => any): any {
  try {
    f();
    return null;
  } catch (e: any) {
    return e;
  }
}
const throws = (f: () => any, re: RegExp) => re.test(String(thrown(f)?.message ?? '<no error>'));
const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const newRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'devrefresh-review-'));

function snapshot(db: string): Record<string, string> {
  const tables = psqlOn(db, "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1").stdout.trim().split('\n').filter(Boolean);
  const sql = [
    ...tables.map((t) => `SELECT '${t}=' || count(*) || ':' || md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public."${t}" x;`),
    `SELECT 'auth.users=' || count(*) || ':' || md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) FROM auth.users x;`,
    `SELECT 'storage.objects=' || count(*) || ':' || md5(COALESCE(string_agg(bucket_id || '/' || name || COALESCE(metadata::text, ''), '|' ORDER BY bucket_id, name), '')) FROM storage.objects;`,
  ].join('\n');
  const out: Record<string, string> = {};
  for (const line of psqlOn(db, sql).stdout.split('\n').filter(Boolean)) out[line.slice(0, line.indexOf('='))] = line.slice(line.indexOf('=') + 1);
  return out;
}
const diff = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const DEV_REF = 'srxunxiytojjsuhcmzjg';

async function main() {
  if (!scratchAvailable()) {
    const msg = 'devRefreshStripeVerification: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    return;
  }
  const made: any[] = [];
  const pair = (name: string, o: any = {}) => {
    const p = buildScratchPair(name, o);
    made.push(p);
    return p;
  };
  try {
    const p = pair('t_stripe');
    const root = newRoot();
    const prodBefore = snapshot(p.prodDb);


    // ---------------------------------------------------------------------------------------------------------------
    // 4. Stripe verification, end to end
    // ---------------------------------------------------------------------------------------------------------------
    const cases: Array<[string, string, string, RegExp]> = [
      ['missing secret key', "DELETE FROM public.admin_settings WHERE key = 'stripe_secret_key'", "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_secret_key', 'sk_test_scratchonly')", /stripe_secret_key is not configured/],
      ['missing publishable key', "DELETE FROM public.admin_settings WHERE key = 'stripe_publishable_key'", "INSERT INTO public.admin_settings (key, value) VALUES ('stripe_publishable_key', 'pk_test_scratchonly')", /stripe_publishable_key is not configured/],
      ['empty secret key', "UPDATE public.admin_settings SET value = '' WHERE key = 'stripe_secret_key'", "UPDATE public.admin_settings SET value = 'sk_test_scratchonly' WHERE key = 'stripe_secret_key'", /stripe_secret_key is empty/],
      ['blank (spaces) publishable key', "UPDATE public.admin_settings SET value = '   ' WHERE key = 'stripe_publishable_key'", "UPDATE public.admin_settings SET value = 'pk_test_scratchonly' WHERE key = 'stripe_publishable_key'", /stripe_publishable_key is empty/],
      ['unknown value', "UPDATE public.admin_settings SET value = 'whsec_123' WHERE key = 'stripe_secret_key'", "UPDATE public.admin_settings SET value = 'sk_test_scratchonly' WHERE key = 'stripe_secret_key'", /stripe_secret_key is not a recognizable Stripe test key/],
      ['live secret key', "UPDATE public.admin_settings SET value = 'sk_live_notreal' WHERE key = 'stripe_secret_key'", "UPDATE public.admin_settings SET value = 'sk_test_scratchonly' WHERE key = 'stripe_secret_key'", /stripe_secret_key is a LIVE Stripe key/],
      ['live restricted key', "UPDATE public.admin_settings SET value = 'rk_live_notreal' WHERE key = 'stripe_secret_key'", "UPDATE public.admin_settings SET value = 'sk_test_scratchonly' WHERE key = 'stripe_secret_key'", /LIVE Stripe key/],
      ['live publishable key', "UPDATE public.admin_settings SET value = 'pk_live_notreal' WHERE key = 'stripe_publishable_key'", "UPDATE public.admin_settings SET value = 'pk_test_scratchonly' WHERE key = 'stripe_publishable_key'", /stripe_publishable_key is a LIVE Stripe key/],
      ['publishable key in the secret slot', "UPDATE public.admin_settings SET value = 'pk_test_scratchonly' WHERE key = 'stripe_secret_key'", "UPDATE public.admin_settings SET value = 'sk_test_scratchonly' WHERE key = 'stripe_secret_key'", /stripe_secret_key is not a recognizable/],
      ['secret key in the publishable slot', "UPDATE public.admin_settings SET value = 'sk_test_scratchonly' WHERE key = 'stripe_publishable_key'", "UPDATE public.admin_settings SET value = 'pk_test_scratchonly' WHERE key = 'stripe_publishable_key'", /stripe_publishable_key is not a recognizable/],
      ['no settings table', 'ALTER TABLE public.admin_settings RENAME TO admin_settings_moved', 'ALTER TABLE public.admin_settings_moved RENAME TO admin_settings', /not configured/],
    ];
    for (const [label, up, down, re] of cases) {
      psqlOn(p.devDb, up);
      const before = snapshot(p.devDb);
      const blocked = preview({ prod: p.prod, dev: p.dev, root });
      ok(`${label}: preview is blocked, with a reason that names the key`, blocked.manifest.status === 'blocked' && re.test(blocked.manifest.problems.join('\n')));
      ok(`${label}: nothing was exported or changed`, !fs.existsSync(path.join(blocked.runDir, 'export')) || fs.readdirSync(path.join(blocked.runDir, 'export')).length === 0);
      eq(`${label}: Development unchanged`, diff(before, snapshot(p.devDb)), []);
      psqlOn(p.devDb, down);
    }
    // test mode (including a restricted test key) is accepted, and a key that goes bad after the preview stops the apply
    psqlOn(p.devDb, "UPDATE public.admin_settings SET value = 'rk_test_restricted' WHERE key = 'stripe_secret_key'");
    const okRk = preview({ prod: p.prod, dev: p.dev, root });
    ok('a restricted test key (rk_test_) is accepted', okRk.manifest.status === 'previewed' && okRk.manifest.stripeModes.every((s: any) => s.mode === 'test'));
    psqlOn(p.devDb, "UPDATE public.admin_settings SET value = 'sk_live_notreal' WHERE key = 'stripe_secret_key'");
    ok('a key that turns live after a good preview stops the apply', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: okRk.manifest.id, confirm: confirmationPhrase(okRk.manifest) }), /LIVE Stripe key/));
    psqlOn(p.devDb, "UPDATE public.admin_settings SET value = '' WHERE key = 'stripe_secret_key'");
    ok('a key that is emptied after a good preview stops the apply', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: okRk.manifest.id, confirm: confirmationPhrase(okRk.manifest) }), /stripe_secret_key is empty/));
    psqlOn(p.devDb, "UPDATE public.admin_settings SET value = 'sk_test_scratchonly' WHERE key = 'stripe_secret_key'");
    const doctor = spawnSync('node', ['scripts/dev-refresh/cli.mjs', 'doctor', '--scratch', 't_review'], { encoding: 'utf8' });
    ok('doctor shows the Stripe mode of both keys', doctor.status === 0 && /stripe_secret_key: test/.test(doctor.stdout) && /stripe_publishable_key: test/.test(doctor.stdout));
    ok('the refresh never writes Development\'s Stripe settings', scalar(p.devDb, "SELECT count(*) FROM public.admin_settings WHERE key LIKE 'stripe%' AND value LIKE '%test%'") === '2');
    eq('Production untouched throughout', diff(prodBefore, snapshot(p.prodDb)).filter((k) => k !== 'orders'), []);
  } finally {
    for (const pr of made) {
      try {
        pr.drop();
      } catch {
        /* best effort */
      }
    }
  }
  console.log(`dev refresh devRefreshStripeVerification tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} dev refresh safety devRefreshStripeVerification test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
