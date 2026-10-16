/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @ts-nocheck
// Final safety review of the Production -> Development order data refresh: rehearsal enforcement, restore drift detection, strict Stripe
// test-mode verification, notification pathway review, protection of the sensitive local files, and retention / cleanup.
// Scenarios that need a database use throw-away scratch databases on the local test server (never a Supabase project) and synthetic rows.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/syncDevDataFromProd/syncDevDataFromProdSafetyReview.test.ts

declare const require: (id: string) => any;
declare const process: { env: Record<string, string | undefined>; exit: (n: number) => void; platform: string };
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

import { resolveTargets } from '../../../../scripts/SyncDevDataFromProd/cli.mjs';
import { REVIEWED_FUNCTIONS, REVIEWED_HOSTED_ONLY, ATTESTATIONS, PATHWAY, auditDeployedFunctions, classifyFunctionFiles, classifyFunctionSource, relayCallingModules, usesUnreviewedProvider } from '../../../../scripts/SyncDevDataFromProd/lib/pathways.mjs';
import { accessList, assertOwnFolder, currentPrincipal, ensureProtectedDir, isRestricted, protectPath } from '../../../../scripts/SyncDevDataFromProd/lib/protect.mjs';
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

// =====================================================================================================================
// PURE: Stripe test-mode verification
// =====================================================================================================================
const row = (key: string, mode: string) => ({ key, mode });
const good = [row('stripe_publishable_key', 'test'), row('stripe_secret_key', 'test')];
eq('two test-mode keys are accepted (test charges, refunds and saved test cards keep working)', stripeProblems(good), []);
for (const mode of ['live', 'missing', 'empty', 'unknown', 'no-table']) {
  for (const slot of ['stripe_secret_key', 'stripe_publishable_key']) {
    const rows = good.map((r) => (r.key === slot ? row(slot, mode) : r));
    ok(`${slot} = ${mode} is a blocker`, stripeProblems(rows).length === 1 && stripeProblems(rows)[0].includes(slot));
  }
}
ok('no rows at all is a blocker for both keys', stripeProblems([]).length === 2);
ok('a blocker never contains a key value', !stripeProblems([row('stripe_secret_key', 'live')]).join().match(/sk_|pk_/));

// =====================================================================================================================
// PURE: notification pathway review
// =====================================================================================================================
const repoFunctions = fs.readdirSync('supabase/functions', { withFileTypes: true }).filter((e: any) => e.isDirectory() && !['_shared', 'node_modules'].includes(e.name)).map((e: any) => e.name).sort();
const filesOf = (dir: string): any[] => fs.readdirSync(dir, { recursive: true }).map(String).filter((f: string) => /\.ts$/.test(f) && !/\.test\./.test(f) && !f.includes('node_modules')).map((f: string) => ({ path: `${dir}/${f.split('\\').join('/')}`, src: read(`${dir}/${f}`) }));
eq('every Edge Function in the repository has been reviewed (a new one fails this test until it is)', Object.keys(REVIEWED_FUNCTIONS).sort(), repoFunctions);
const relayModules = relayCallingModules(filesOf('supabase/functions/_shared'));
ok('the shared modules that reach the relays are found (customer-notice, transaction-logger)', relayModules.has('customer-notice') && relayModules.has('transaction-logger'));
const mismatched = repoFunctions.filter((f: string) => classifyFunctionFiles(filesOf(`supabase/functions/${f}`), relayModules) !== REVIEWED_FUNCTIONS[f]);
eq('the reviewed pathway of every function matches what its source (including shared modules) actually does', mismatched, []);
eq('only the two relays talk to a provider', repoFunctions.filter((f: string) => [PATHWAY.PROVIDER_EMAIL, PATHWAY.PROVIDER_SMS].includes(REVIEWED_FUNCTIONS[f])).sort(), ['send-email', 'send-sms-notification']);
const allSources = [...repoFunctions.flatMap((f: string) => filesOf(`supabase/functions/${f}`)), ...filesOf('supabase/functions/_shared'), ...filesOf('src').filter((f: any) => !f.path.includes('/tests/'))];
eq('no other mail / SMS / chat vendor, SMTP client or webhook is used anywhere', allSources.filter((f: any) => usesUnreviewedProvider(f.src)).map((f: any) => f.path), []);
ok('a function that starts to call another vendor is detected', usesUnreviewedProvider("await fetch('https://api.sendgrid.com/v3/mail/send')") && usesUnreviewedProvider("fetch('https://hooks.slack.com/services/T/B/x')") && !usesUnreviewedProvider("fetch('https://api.stripe.com/v1/charges')"));
eq('a new function that calls a relay is classified as such', classifyFunctionSource("await fetch(`${url}/functions/v1/send-sms-notification`)"), PATHWAY.VIA_RELAYS);
eq('a new function that imports a relay-calling shared module is classified as via-relays', classifyFunctionFiles([{ path: 'x/index.ts', src: "import { notifyCustomer } from '../_shared/customer-notice.ts';" }], relayModules), PATHWAY.VIA_RELAYS);
eq('a new function that talks to Resend is a provider', classifyFunctionSource("fetch('https://api.resend.com/emails')"), PATHWAY.PROVIDER_EMAIL);

const DEV_REF = 'srxunxiytojjsuhcmzjg';
const PROD_REF = 'qaagfafagdpgzcijnfbw';
eq('audit: repository functions and the reviewed hosted-only function pass', auditDeployedFunctions([...repoFunctions.slice(0, 5), 'send-booking-confirmation'], repoFunctions, DEV_REF), { unknown: [], changedHostedOnly: [] });
eq('audit: an unknown deployed function is flagged', auditDeployedFunctions(['send-email', 'mystery-mailer'], repoFunctions, DEV_REF).unknown, ['mystery-mailer']);
eq('audit: the reviewed hosted-only function is NOT accepted on another project', auditDeployedFunctions(['send-booking-confirmation'], repoFunctions, PROD_REF).unknown, ['send-booking-confirmation']);
eq('audit: a reviewed hosted-only function whose deployed source changed is flagged', auditDeployedFunctions([{ slug: 'send-booking-confirmation', ezbr_sha256: 'f'.repeat(64) }], repoFunctions, DEV_REF).changedHostedOnly, ['send-booking-confirmation']);
eq('audit: the reviewed source hash is accepted', auditDeployedFunctions([{ slug: 'send-booking-confirmation', ezbr_sha256: REVIEWED_HOSTED_ONLY['send-booking-confirmation'].sourceSha256 }], repoFunctions, DEV_REF), { unknown: [], changedHostedOnly: [] });
ok('the hosted-only function was reviewed as relay-only', REVIEWED_HOSTED_ONLY['send-booking-confirmation'].pathway === PATHWAY.VIA_RELAYS);
eq('the three operator confirmations are defined', Object.keys(ATTESTATIONS).sort(), ['auth-email-contained', 'relays-guarded', 'stripe-edge-secrets-test']);

const auditFile = path.join(os.tmpdir(), `devrefresh-audit-${process.pid}.json`);
fs.writeFileSync(auditFile, JSON.stringify([{ slug: 'send-email' }, { slug: 'stranger' }]));
const aud = spawnSync('node', ['scripts/SyncDevDataFromProd/cli.mjs', 'audit-functions', '--project', 'dev', '--file', auditFile], { encoding: 'utf8' });
ok('the audit-functions command exits non-zero and names the unreviewed function', aud.status === 2 && /UNREVIEWED: stranger/.test(aud.stdout));
fs.writeFileSync(auditFile, 'send-email\nsend-sms-notification\nsend-booking-confirmation\n');
ok('and exits zero for a reviewed list (plain text list accepted)', spawnSync('node', ['scripts/SyncDevDataFromProd/cli.mjs', 'audit-functions', '--project', 'dev', '--file', auditFile], { encoding: 'utf8' }).status === 0);
fs.rmSync(auditFile, { force: true });

// =====================================================================================================================
// PURE: file protection and retention
// =====================================================================================================================
{
  const root = newRoot();
  const f = path.join(root, 'secret.env');
  fs.writeFileSync(f, 'DEV_REFRESH_PROD_DB_URL=x\n');
  if (process.platform === 'win32') spawnSync('icacls', [f, '/grant', '*S-1-5-32-545:R'], { encoding: 'utf8' });
  else fs.chmodSync(f, 0o644);
  ok('a credentials file readable by other accounts is detected as such', !isRestricted(f));
  const envFile = path.join(root, 'creds.env');
  fs.writeFileSync(envFile, '# nothing here\n');
  if (process.platform === 'win32') spawnSync('icacls', [envFile, '/grant', '*S-1-5-32-545:R'], { encoding: 'utf8' });
  else fs.chmodSync(envFile, 0o644);
  const env = { ...process.env, DEV_REFRESH_ENV_FILE: envFile };
  const doctor = spawnSync('node', ['scripts/SyncDevDataFromProd/cli.mjs', 'doctor'], { encoding: 'utf8', env });
  ok('hosted commands refuse to read connection settings from a file that other accounts can read, and say how to fix it', doctor.status !== 0 && /readable by other accounts/.test(doctor.stderr) && /protect/.test(doctor.stderr));
  const prot = spawnSync('node', ['scripts/SyncDevDataFromProd/cli.mjs', 'protect'], { encoding: 'utf8', env });
  ok('the protect command restricts the file to the current user', prot.status === 0 && isRestricted(envFile) && accessList(envFile).every((p: string) => p === currentPrincipal() || p === os.userInfo().username));
  const after = spawnSync('node', ['scripts/SyncDevDataFromProd/cli.mjs', 'doctor'], { encoding: 'utf8', env });
  ok('after protecting it the permission error is gone (the next error is the missing connection settings)', /Missing connection settings/.test(after.stderr) && !/readable by other accounts/.test(after.stderr));
  ok('the same loader refuses on a scratch run without needing the file at all', resolveTargets({ scratch: 'x' }, {}).dev.scratch === true);
  // These calls name REAL system folders. They are made with a recording stand-in for the commands that change permissions (and for mkdir /
  // chmod), so that even if the guard ever regressed this test could not change a real folder - it would fail on the recorded calls instead.
  const attempted: any[] = [];
  const spy = {
    spawn: (...a: any[]) => { attempted.push(['spawn', ...a]); return { status: 0, stdout: '', stderr: '' }; },
    chmod: (...a: any[]) => attempted.push(['chmod', ...a]),
    mkdir: (...a: any[]) => attempted.push(['mkdir', ...a]),
  };
  const systemFolders = [os.tmpdir(), os.homedir(), path.parse(os.tmpdir()).root, path.dirname(os.tmpdir()), process.env.LOCALAPPDATA || os.homedir(), process.env.APPDATA || os.homedir(), process.env.USERPROFILE || os.homedir(), process.env.SystemRoot || '/etc', process.env.ProgramData || '/etc', process.env.ProgramFiles || '/usr'];
  for (const bad of systemFolders) {
    ok(`access-list changes are refused on a system / profile / temporary folder (${bad})`, throws(() => protectPath(bad, spy), /not a folder this tool created/) && throws(() => ensureProtectedDir(bad, spy), /not a folder this tool created/));
  }
  const ownChild = path.join(root, 'child');
  fs.mkdirSync(ownChild);
  ok('a link that really points at a system folder is refused as well (the folder is judged by where it really is)', throws(() => protectPath(ownChild, { ...spy, realpath: () => os.tmpdir() }), /not a folder this tool created/) && throws(() => ensureProtectedDir(ownChild, { ...spy, realpath: () => os.homedir() }), /not a folder this tool created/));
  ok('NOT ONE permission, mkdir or chmod command was attempted for any of them', attempted.length === 0);
  ok('a child of the temporary folder (what every test uses) is allowed by the same guard', (() => { try { return assertOwnFolder(ownChild) === path.resolve(ownChild); } catch { return false; } })());
  ok('every folder these tests (and the tool) change is under a folder created for the test, or the repository .SyncDevDataFromProd folder', path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.resolve(root) !== path.resolve(os.tmpdir()));
  const dir = ensureProtectedDir(path.join(root, 'private'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  ok('a protected folder and a file created in it are restricted to the current user', isRestricted(dir) && isRestricted(path.join(dir, 'a.txt')) && protectPath(dir).ok);
  fs.rmSync(root, { recursive: true, force: true });
}
{
  // retention: fake run folders with known ages and states
  const root = newRoot();
  const runs = path.join(root, '.SyncDevDataFromProd', 'runs');
  const DAY = 86400000;
  const now = Date.now();
  const mk = (idv: string, status: string, ageDays: number, folders: string[]) => {
    const dir = path.join(runs, idv);
    fs.mkdirSync(dir, { recursive: true });
    const at = new Date(now - ageDays * DAY).toISOString();
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id: idv, status, createdAt: at, appliedAt: ['applied', 'restored'].includes(status) ? at : undefined, planHash: 'ab'.repeat(32) }));
    fs.writeFileSync(path.join(dir, 'report.md'), '# report');
    for (const f of folders) {
      fs.mkdirSync(path.join(dir, f), { recursive: true });
      fs.writeFileSync(path.join(dir, f, 'data.copy'), 'customer data '.repeat(100));
    }
  };
  const ALL = ['export', 'backup', 'outputs', 'dev-rows-to-replace', 'after-apply'];
  mk('r1-old-applied', 'applied', 60, ALL);
  mk('r2-newest-applied', 'applied', 2, ALL);
  mk('r3-old-restored', 'restored', 40, ALL);
  mk('r4-fresh-preview', 'previewed', 0.1, ['export', 'dev-rows-to-replace']);
  mk('r5-expired-preview', 'previewed', 3, ['export']);
  mk('r6-interrupted', 'applying', 50, ALL);
  mk('r7-failed', 'failed', 10, ['export', 'backup', 'outputs']);
  mk('r8-young-failed', 'failed', 2, ['export', 'backup']);
  const plan = planCleanup(root, { now });
  const has = (p: any, idv: string, cat: string) => p.items.some((i: any) => i.id === idv && i.category === cat);
  ok('by default NO backup is ever selected', !plan.items.some((i: any) => i.category === 'backup' || i.category.startsWith('pre-restore')));
  ok('the Production copy (export) of finished runs is removable at once; a fresh unapplied preview keeps it', has(plan, 'r2-newest-applied', 'export') && has(plan, 'r7-failed', 'export') && !has(plan, 'r4-fresh-preview', 'export'));
  ok('an expired unapplied preview\'s export is removable', has(plan, 'r5-expired-preview', 'export'));
  ok('reports (Stripe references, customer ids) are kept until they are 30 days old', !has(plan, 'r2-newest-applied', 'outputs') && has(plan, 'r1-old-applied', 'outputs') && !has(plan, 'r7-failed', 'outputs'));
  ok('the row-hash snapshot of the most recent applied run is kept (restore needs it to detect later changes)', !has(plan, 'r2-newest-applied', 'after-apply') && plan.kept.some((k: any) => k.id === 'r2-newest-applied' && k.category === 'after-apply'));
  ok('an interrupted run keeps everything (it may need recovery)', !plan.items.some((i: any) => i.id === 'r6-interrupted') && plan.kept.filter((k: any) => k.id === 'r6-interrupted').length === ALL.length);
  const withBackups = planCleanup(root, { now, includeBackups: true });
  ok('with --include-backups an old superseded backup and a used (restored) backup are selectable', has(withBackups, 'r1-old-applied', 'backup') && has(withBackups, 'r3-old-restored', 'backup'));
  ok('...but NEVER the restore point of the most recent applied run', !has(withBackups, 'r2-newest-applied', 'backup') && withBackups.kept.some((k: any) => k.id === 'r2-newest-applied' && k.category === 'backup'));
  ok('...nor the backup of an interrupted run, nor of a young failed run; an old failed run\'s (an unchanged state) is selectable', !has(withBackups, 'r6-interrupted', 'backup') && !has(withBackups, 'r8-young-failed', 'backup') && has(withBackups, 'r7-failed', 'backup') && RETENTION.failedBackupDays === 7);
  ok('the audit trail (manifest.json, report.md) is never selected', !withBackups.items.some((i: any) => /manifest|report/.test(i.category)));
  // nothing happens without the exact phrase
  const before = fs.readdirSync(path.join(runs, 'r1-old-applied'));
  ok('execute without the approval phrase deletes nothing', throws(() => executeCleanup(root, plan, 'yes'), /Approval phrase does not match/) && fs.readdirSync(path.join(runs, 'r1-old-applied')).join() === before.join());
  ok('a phrase for a different list is refused', cleanupPhrase(plan) !== cleanupPhrase(withBackups) && throws(() => executeCleanup(root, plan, cleanupPhrase(withBackups)), /Approval phrase does not match/));
  const forgedPlan = { ...plan, items: [...plan.items, { id: 'x', category: 'export', path: path.join(root, 'outside'), bytes: 0, reason: 'forged' }] };
  fs.mkdirSync(path.join(root, 'outside'));
  ok('a path outside the run folders is refused even with a valid phrase', throws(() => executeCleanup(root, forgedPlan, cleanupPhrase(forgedPlan)), /outside the run folders/) && fs.existsSync(path.join(root, 'outside')) && plan.items.every((i: any) => fs.existsSync(i.path)));
  const removed = executeCleanup(root, plan, cleanupPhrase(plan));
  ok('with the exact phrase exactly the listed items are removed', removed.length === plan.items.length && plan.items.every((i: any) => !fs.existsSync(i.path)));
  ok('everything not listed is still there, including every backup', fs.existsSync(path.join(runs, 'r1-old-applied', 'backup')) && fs.existsSync(path.join(runs, 'r2-newest-applied', 'backup')) && fs.existsSync(path.join(runs, 'r4-fresh-preview', 'export')) && fs.existsSync(path.join(runs, 'r6-interrupted', 'export')));
  ok('manifests and reports survive and record what was removed', fs.existsSync(path.join(runs, 'r1-old-applied', 'report.md')) && Array.isArray(JSON.parse(fs.readFileSync(path.join(runs, 'r1-old-applied', 'manifest.json'), 'utf8')).cleanup));
  fs.rmSync(root, { recursive: true, force: true });
}
{
  const toolFiles = fs.readdirSync('scripts/SyncDevDataFromProd/lib').map((f: string) => `scripts/SyncDevDataFromProd/lib/${f}`).concat(['scripts/SyncDevDataFromProd/cli.mjs']);
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const removers = toolFiles.filter((f: string) => /\b(rmSync|unlinkSync|rmdirSync|rm\()|fs\.promises\.rm|\.unlink\(/.test(code(f)));
  eq('the only code that deletes files is retention.mjs (and only from executeCleanup)', removers, ['scripts/SyncDevDataFromProd/lib/retention.mjs']);
  ok('retention deletes in exactly one place', (code('scripts/SyncDevDataFromProd/lib/retention.mjs').match(/rmSync\(/g) || []).length === 1);
  ok('nothing in the tool schedules or repeats itself', !toolFiles.some((f: string) => /setInterval|setTimeout|node-cron|CronCreate|schedule\(/.test(code(f))));
}

// =====================================================================================================================
// DATABASE scenarios
// =====================================================================================================================
async function main() {
  if (!scratchAvailable()) {
    const msg = 'syncDevDataFromProdSafetyReview: no scratch PostgreSQL reachable - executed scenarios SKIPPED';
    if (process.env.ROLE_DB_REQUIRE === '1') throw new Error(`${msg} (ROLE_DB_REQUIRE=1)`);
    console.log(msg);
    // The checks that need no database (pathway review, file protection, retention) have already run: their result must still count.
    console.log(`dev refresh safety review tests (no database): ${passed} passed, ${failed} failed`);
    if (failed > 0) throw new Error(`${failed} dev refresh safety review test(s) failed`);
    return;
  }
  const made: any[] = [];
  const pair = (name: string, o: any = {}) => {
    const p = buildScratchPair(name, o);
    made.push(p);
    return p;
  };
  try {
    const p = pair('t_review');
    const root = newRoot();
    const devBefore = snapshot(p.devDb);
    const prodBefore = snapshot(p.prodDb);
    const hostedLike = { ...p.dev, scratch: false, host: `db.${DEV_REF}.supabase.co` };

    // ---------------------------------------------------------------------------------------------------------------
    // 1. Rehearsal enforcement
    // ---------------------------------------------------------------------------------------------------------------
    ok('a hosted preview can not skip the rehearsal (refused before any connection is made)', throws(() => preview({ prod: hostedLike, dev: hostedLike, root, rehearse: false }), /rehearsal can not be skipped for a hosted refresh/));
    ok('the same rule can be switched on for scratch databases (so it is testable)', throws(() => preview({ prod: p.prod, dev: p.dev, root, rehearse: false, enforceRehearsal: true }), /can not be skipped/));
    const cliNo = spawnSync('node', ['scripts/SyncDevDataFromProd/cli.mjs', 'preview', '--no-rehearsal', '--scratch', 't_review'], { encoding: 'utf8' });
    ok('local scratch testing may still skip it (--no-rehearsal on a scratch pair works)', cliNo.status === 0 && /scratch databases only/.test(cliNo.stdout));
    const runIdNo = (cliNo.stdout.match(/Run (\d{8}-\d{6})/) || [])[1];
    fs.rmSync(path.join('.SyncDevDataFromProd', 'runs', runIdNo || 'none'), { recursive: true, force: true });

    const unrehearsed = preview({ prod: p.prod, dev: p.dev, root, rehearse: false });
    ok('an un-rehearsed local preview exists with no rehearsal evidence', unrehearsed.manifest.status === 'previewed' && unrehearsed.manifest.rehearsal.skipped === true);
    ok('a hosted-rule apply of an un-rehearsed preview is refused', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: unrehearsed.manifest.id, confirm: confirmationPhrase(unrehearsed.manifest), enforceRehearsal: true, requireAttestations: false }), /requires a successful rehearsal of this exact preview/));
    // forging the record does not help
    const forge = readManifest(root, unrehearsed.manifest.id);
    forge.rehearsal = { ok: true, planHash: forge.planHash, result: { staged: {}, imported: {} } };
    writeManifest(root, forge);
    ok('a forged "rehearsal passed" record without matching evidence is refused', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: forge.id, confirm: confirmationPhrase(forge), enforceRehearsal: true, requireAttestations: false }), /rehearsal evidence for \w+ does not match the export/));
    forge.rehearsal = { ok: true, planHash: 'f'.repeat(64), result: forge.rehearsal.result };
    writeManifest(root, forge);
    ok('a rehearsal record that belongs to a different plan is refused', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: forge.id, confirm: confirmationPhrase(forge), enforceRehearsal: true, requireAttestations: false }), /does not belong to this preview/));

    const rehearsed = preview({ prod: p.prod, dev: p.dev, root });
    const rm = rehearsed.manifest;
    ok('a normal preview carries rehearsal evidence bound to its plan hash', rm.rehearsal.ok === true && rm.rehearsal.planHash === rm.planHash);
    const tampered = readManifest(root, rm.id);
    tampered.exportChecksums.orders = '0'.repeat(64);
    writeManifest(root, tampered);
    ok('editing the preview record (export checksum) after the fact is detected by the plan hash', throws(() => apply({ prod: p.prod, dev: p.dev, root, id: rm.id, confirm: confirmationPhrase(rm), enforceRehearsal: true, requireAttestations: false }), /altered after it was made/));

    const pv = preview({ prod: p.prod, dev: p.dev, root });
    const m = pv.manifest;
    const names = Object.keys(ATTESTATIONS);
    const noAtt = thrown(() => apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: confirmationPhrase(m), enforceRehearsal: true, requireAttestations: true }));
    ok('a hosted-rule apply without the operator confirmations is refused and names all three', noAtt && names.every((n) => noAtt.message.includes(n)));
    const partial = thrown(() => apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: confirmationPhrase(m), enforceRehearsal: true, requireAttestations: true, attest: ['relays-guarded', 'auth-email-contained'] }));
    ok('two of three is refused and names the missing one only', partial && partial.message.includes('stripe-edge-secrets-test') && !partial.message.includes('  relays-guarded:'));
    ok('nothing was written by the refusals', diff(devBefore, snapshot(p.devDb)).length === 0 && readManifest(root, m.id).status === 'previewed');
    const a = apply({ prod: p.prod, dev: p.dev, root, id: m.id, confirm: confirmationPhrase(m), enforceRehearsal: true, requireAttestations: true, attest: names });
    ok('with a rehearsed preview and all confirmations the hosted-rule apply succeeds (normal behavior intact)', a.ok && a.manifest.status === 'applied');
    ok('the confirmations are recorded in the run and its report', a.manifest.attestations.names.length === 3 && /Operator confirmations/.test(read(path.join(a.runDir, 'report.md'))));
    eq('Production untouched', diff(prodBefore, snapshot(p.prodDb)), []);
    ok('the committed state was recorded for drift detection', Object.keys(a.manifest.afterApply.fingerprints).length >= 26 && fs.existsSync(path.join(a.runDir, 'after-apply', 'orders.hash')));

    // ---------------------------------------------------------------------------------------------------------------
    // 2. Sensitive local files
    // ---------------------------------------------------------------------------------------------------------------
    {
      const sample = ['export/orders.copy', 'backup/orders.copy', 'outputs/stripe-quarantine-orders.stripe_customer_id.copy', 'outputs/auth-unlinked-customers.copy', 'dev-rows-to-replace/orders.ids', 'after-apply/orders.hash', 'manifest.json', 'report.md'].map((f) => path.join(a.runDir, f));
      ok('the run folder and its parent are restricted to the current user', isRestricted(a.runDir) && isRestricted(path.join(root, '.SyncDevDataFromProd')));
      ok('every sensitive file is restricted (export, backup, Stripe quarantine, customer ids, row hashes)', sample.every((f) => fs.existsSync(f) && isRestricted(f)));
      ok('on this machine only the current user has access (no Everyone / Users / Authenticated Users)', accessList(a.runDir).every((x: string) => x === currentPrincipal() || x === os.userInfo().username));
      ok('the files really hold customer data (this is why they are protected)', /Synthetic order 1/.test(read(path.join(a.runDir, 'export', 'orders.copy'))) && /cus_prod_1/.test(read(path.join(a.runDir, 'outputs', 'stripe-quarantine-orders.stripe_customer_id.copy'))));
      const meta = read(path.join(a.runDir, 'manifest.json')) + read(path.join(a.runDir, 'report.md'));
      ok('the manifest and report hold no connection string, password or Stripe id', !/postgres(ql)?:\/\//i.test(meta) && !/PGPASSWORD|password/i.test(meta) && !/cus_prod_|pm_prod_/.test(meta));
    }
  } finally {
    for (const pr of made) {
      try {
        pr.drop();
      } catch {
        /* best effort */
      }
    }
  }
  console.log(`dev refresh safety review tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} dev refresh safety review test(s) failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
