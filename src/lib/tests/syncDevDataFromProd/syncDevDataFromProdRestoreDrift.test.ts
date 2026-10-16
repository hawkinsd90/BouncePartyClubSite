/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Restore drift detection: a restore refuses a database that changed after the refresh unless explicitly approved, and always keeps a safety copy.
// test-mode verification, notification pathway review, protection of the sensitive local files, and retention / cleanup.
// Scenarios that need a database use throw-away scratch databases on the local test server (never a Supabase project) and synthetic rows.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/syncDevDataFromProd/syncDevDataFromProdRestoreDrift.test.ts

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit: (n: number) => void; platform: string };
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

import { resolveTargets } from '../../../../scripts/SyncDevDataFromProd/cli.mjs';
import { REVIEWED_FUNCTIONS, REVIEWED_HOSTED_ONLY, ATTESTATIONS, PATHWAY, auditDeployedFunctions, classifyFunctionFiles, classifyFunctionSource, relayCallingModules, usesUnreviewedProvider } from '../../../../scripts/SyncDevDataFromProd/lib/pathways.mjs';
import { accessList, currentPrincipal, ensureProtectedDir, isRestricted, protectPath } from '../../../../scripts/SyncDevDataFromProd/lib/protect.mjs';
import { RETENTION, cleanupPhrase, executeCleanup, planCleanup } from '../../../../scripts/SyncDevDataFromProd/lib/retention.mjs';
import { DriftError, apply, confirmationPhrase, driftPhrase, preview, readManifest, restore, restorePhrase, stripeProblems, writeManifest } from '../../../../scripts/SyncDevDataFromProd/lib/run.mjs';
import { K, buildScratchPair, id, psqlOn, scalar, scratchAvailable } from '../support/syncDevDataFromProdScratch.mjs';

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
    const msg = 'syncDevDataFromProdRestoreDrift: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
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
    const p = pair('t_drift');
    const root = newRoot();
    const devBefore = snapshot(p.devDb);
    const rm = preview({ prod: p.prod, dev: p.dev, root }).manifest; // a preview that is never applied
    const m = preview({ prod: p.prod, dev: p.dev, root }).manifest;
    const a = apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: confirmationPhrase(m) });
    ok('the refresh under test applied', a.ok);


    // ---------------------------------------------------------------------------------------------------------------
    // 3. Restore drift detection
    // ---------------------------------------------------------------------------------------------------------------
    ok('a run that was never applied can not be restored', throws(() => restore({ dev: p.dev, root, id: rm.id, confirm: restorePhrase(rm) }), /no backup/));
    // someone works in Development after the refresh
    psqlOn(p.devDb, `SET session_replication_role = replica;
      INSERT INTO customers (id, first_name, last_name, email, phone) VALUES ('${id(K.customer, 700)}', 'newbie', 'Drift', 'newbie-drift@example.test', '+15555550700');
      INSERT INTO orders (id, customer_id, status, location_type, event_date, event_end_date, start_window, end_window, pickup_preference, subtotal_cents, deposit_due_cents, balance_due_cents, special_details) VALUES ('${id(K.order, 700)}', '${id(K.customer, 700)}', 'confirmed', 'residential', '2026-08-01', '2026-08-01', '09:00', '11:00', 'same_day', 1000, 500, 500, 'created after the refresh');
      UPDATE orders SET special_details = 'edited after the refresh' WHERE id = '${id(K.order, 3)}';
      DELETE FROM payments WHERE id = '${id(K.payment, 3)}';
      INSERT INTO order_portal_links (id, order_id, short_code) VALUES (gen_random_uuid(), '${id(K.order, 700)}', 'DRIFT001');`);
    const drifted = snapshot(p.devDb);
    const refusal = thrown(() => restore({ dev: p.dev, root, id: m.id, confirm: restorePhrase(a.manifest) }));
    ok('restore refuses a drifted database with a DriftError', refusal instanceof DriftError && refusal.code === 'DRIFT');
    const d = refusal?.drift;
    eq('it reports what changed, per table', [d?.detail.orders, d?.detail.payments, d?.detail.customers, d?.detail.order_portal_links?.added], [{ added: 1, removed: 0, modified: 1 }, { added: 0, removed: 1, modified: 0 }, { added: 1, removed: 0, modified: 0 }, 1]);
    ok('the message names the tables, the counts and the exact approval phrase', /orders: 1 added, 1 modified, 0 removed/.test(refusal.message) && refusal.message.includes(driftPhrase(a.manifest)) && /Nothing was modified/.test(refusal.message));
    eq('the refused restore changed nothing', diff(drifted, snapshot(p.devDb)), []);
    ok('the drift phrase alone, without the flag, is not enough', thrown(() => restore({ dev: p.dev, root, id: m.id, confirm: restorePhrase(a.manifest), driftConfirm: driftPhrase(a.manifest) })) instanceof DriftError);
    ok('a wrong drift phrase is not enough', thrown(() => restore({ dev: p.dev, root, id: m.id, confirm: restorePhrase(a.manifest), acceptDrift: true, driftConfirm: 'yes' })) instanceof DriftError);
    ok('the restore phrase itself is still required first', throws(() => restore({ dev: p.dev, root, id: m.id, confirm: 'no', acceptDrift: true, driftConfirm: driftPhrase(a.manifest) }), /Approval phrase does not match/));
    eq('still nothing changed', diff(drifted, snapshot(p.devDb)), []);

    const r = restore({ dev: p.dev, root, id: m.id, confirm: restorePhrase(a.manifest), acceptDrift: true, driftConfirm: driftPhrase(a.manifest) });
    ok('with BOTH approvals the restore proceeds and verifies itself', r.ok === true && r.manifest.status === 'restored');
    const safety = r.manifest.restoreAttempt.safetyBackup.folder;
    ok('a safety copy of the drifted state was taken first and holds the data the restore discarded', /newbie-drift@example\.test/.test(read(path.join(a.runDir, safety, 'customers.copy'))) && read(path.join(a.runDir, safety, 'orders.copy')).includes(id(K.order, 700)) && /edited after the refresh/.test(read(path.join(a.runDir, safety, 'orders.copy'))) && isRestricted(path.join(a.runDir, safety)));
    ok('the discarded changes are recorded in the run', r.manifest.restoreAttempt.driftDiscarded.orders.added === 1 && r.manifest.restoreAttempt.driftDiscarded.payments.removed === 1);
    eq('Development is back to the exact state before the refresh', diff(devBefore, snapshot(p.devDb)), []);
    ok('the same run can not be restored twice', throws(() => restore({ dev: p.dev, root, id: m.id, confirm: restorePhrase(a.manifest) }), /already restored/));

    // a no-drift restore also takes the safety copy, and a record without a committed state is refused
    const pv2 = preview({ prod: p.prod, dev: p.dev, root });
    const a2 = apply({ prod: p.prod, dev: p.dev, root, id: pv2.manifest.id, confirm: confirmationPhrase(pv2.manifest) });
    const noState = readManifest(root, a2.manifest.id);
    const keepAfter = noState.afterApply;
    delete noState.afterApply;
    writeManifest(root, noState);
    ok('a run record without the committed state is refused (drift can not be judged)', throws(() => restore({ dev: p.dev, root, id: a2.manifest.id, confirm: restorePhrase(a2.manifest) }), /did not leave a recorded state/));
    noState.afterApply = keepAfter;
    writeManifest(root, noState);
    const r2 = restore({ dev: p.dev, root, id: a2.manifest.id, confirm: restorePhrase(a2.manifest) });
    ok('an undisturbed restore needs no drift approval, and still keeps a safety copy', r2.ok && fs.existsSync(path.join(a2.runDir, r2.manifest.restoreAttempt.safetyBackup.folder, 'orders.copy')));
    eq('and returns to the pre-refresh state', diff(devBefore, snapshot(p.devDb)), []);

    // an older run can not be restored over a newer refresh
    const pvA = preview({ prod: p.prod, dev: p.dev, root });
    const aA = apply({ prod: p.prod, dev: p.dev, root, id: pvA.manifest.id, confirm: confirmationPhrase(pvA.manifest) });
    psqlOn(p.prodDb, `SET session_replication_role = replica; UPDATE orders SET tip_cents = 999 WHERE id = '${id(K.order, 5)}';`);
    const pvB = preview({ prod: p.prod, dev: p.dev, root });
    const aB = apply({ prod: p.prod, dev: p.dev, root, id: pvB.manifest.id, confirm: confirmationPhrase(pvB.manifest) });
    ok('a second refresh applied', aA.ok && aB.ok);
    const old = thrown(() => restore({ dev: p.dev, root, id: aA.manifest.id, confirm: restorePhrase(aA.manifest) }));
    ok('restoring the OLDER run over the newer refresh is refused as drift', old instanceof DriftError && old.drift.detail.orders.modified === 1);
    const rB = restore({ dev: p.dev, root, id: aB.manifest.id, confirm: restorePhrase(aB.manifest) });
  } finally {
    for (const pr of made) {
      try {
        pr.drop();
      } catch {
        /* best effort */
      }
    }
  }
  console.log(`dev refresh syncDevDataFromProdRestoreDrift tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} dev refresh safety syncDevDataFromProdRestoreDrift test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
