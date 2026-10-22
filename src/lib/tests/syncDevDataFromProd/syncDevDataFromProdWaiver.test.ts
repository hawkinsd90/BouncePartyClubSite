/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
// The single permitted waiver of an `apply` confirmation: only `relays-guarded`, only when explicitly requested with a written reason,
// recorded separately (WAIVED — NOT VERIFIED), never for the other two confirmations, and never carried to another run.
// No database is needed: the rules are pure functions that `apply` calls before it touches any database.
// Run: node node_modules/jiti/bin/jiti.js src/lib/tests/syncDevDataFromProd/syncDevDataFromProdWaiver.test.ts

declare const require: (id: string) => any;
declare const process: { cwd: () => string; exit: (n: number) => void };
const fs = require('fs');
const path = require('path');

import { ATTESTATIONS } from '../../../../scripts/SyncDevDataFromProd/lib/pathways.mjs';
import { WAIVABLE_ATTESTATIONS, WAIVED_LABEL, WAIVER_MIN_REASON_CHARS, parseWaiveOption, renderReport, renderWaivers, resolveAttestations } from '../../../../scripts/SyncDevDataFromProd/lib/run.mjs';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL:', label);
  }
}
function thrown(f: () => any): any {
  try {
    f();
    return null;
  } catch (e: any) {
    return e;
  }
}

const ALL = Object.keys(ATTESTATIONS);
const TWO = ['auth-email-contained', 'stripe-edge-secrets-test'];
const REASON =
  'Guarded Development relays are not deployed; the temporary Data API restriction and the 14 Edge Function stubs are active; Development messaging and payment operations will not be used before the coordinated release.';
const RUN = '20261016-102714';

function main() {
  // --- the contract itself ------------------------------------------------------------------------------------------------------
  ok('the three confirmations still exist', ALL.length === 3 && ALL.includes('relays-guarded') && TWO.every((n) => ALL.includes(n)));
  ok('exactly one confirmation is waivable: relays-guarded', JSON.stringify(WAIVABLE_ATTESTATIONS) === JSON.stringify(['relays-guarded']));
  ok('the label is the one the approval asked for', WAIVED_LABEL === 'WAIVED — NOT VERIFIED');

  // --- the Stripe confirmation says what is actually required: a test-mode Edge secret, and no webhook delivering to Production -----------------
  const stripeText = ATTESTATIONS['stripe-edge-secrets-test'];
  ok('the Stripe confirmation requires a test-mode STRIPE_SECRET_KEY Edge secret', /STRIPE_SECRET_KEY/.test(stripeText) && /test-mode key/.test(stripeText));
  ok('the Stripe confirmation requires that no webhook endpoint delivers to the Production project', /no Stripe webhook endpoint delivers events to the Production project/.test(stripeText));
  ok('a Development webhook is NOT required by the Stripe confirmation', /not required/.test(stripeText) && !/the Development Stripe webhook points only at Development\./.test(stripeText));
  ok('the Stripe confirmation is still a mandatory name (not waivable)', Object.keys(ATTESTATIONS).includes('stripe-edge-secrets-test') && !WAIVABLE_ATTESTATIONS.includes('stripe-edge-secrets-test'));

  // --- unchanged behaviour: all three confirmations pass, none missing is refused ---------------------------------------------------
  ok('all three confirmed -> accepted, no waivers', resolveAttestations({ attest: ALL, runId: RUN, at: 't' }).waivers.length === 0);
  const missingAll = thrown(() => resolveAttestations({ attest: [], runId: RUN, at: 't' }));
  ok('nothing confirmed and nothing waived -> refused, naming all three', !!missingAll && ALL.every((n) => missingAll.message.includes(n)));

  // --- relays-guarded can be waived only when explicitly requested -------------------------------------------------------------------
  const noWaiverRequested = thrown(() => resolveAttestations({ attest: TWO, runId: RUN, at: 't' }));
  ok('relays-guarded missing and NOT explicitly waived -> refused', !!noWaiverRequested && noWaiverRequested.message.includes('relays-guarded'));
  const waived = resolveAttestations({ attest: TWO, waive: { 'relays-guarded': REASON }, runId: RUN, at: '2026-10-16T00:00:00Z' });
  ok('relays-guarded waived with a written reason + the two confirmations -> accepted', waived.waivers.length === 1);
  const w = waived.waivers[0];
  ok('the waiver is recorded with name, reason, run, time and the unverified claim', w.name === 'relays-guarded' && w.reason === REASON && w.run === RUN && w.at === '2026-10-16T00:00:00Z' && w.unverified === ATTESTATIONS['relays-guarded']);
  ok('the waiver is labelled WAIVED — NOT VERIFIED', w.status === 'WAIVED — NOT VERIFIED');

  // --- the other two stay mandatory --------------------------------------------------------------------------------------------------
  for (const name of TWO) {
    const others = TWO.filter((n) => n !== name);
    const e = thrown(() => resolveAttestations({ attest: others, waive: { 'relays-guarded': REASON }, runId: RUN, at: 't' }));
    ok(`${name} missing (relays waived) -> refused and named`, !!e && e.message.includes(name) && !e.message.includes('relays-guarded:'));
    const e2 = thrown(() => resolveAttestations({ attest: others, waive: { [name]: REASON }, runId: RUN, at: 't' }));
    ok(`${name} can not be waived`, !!e2 && /can not be waived/.test(e2.message));
  }
  const unknown = thrown(() => resolveAttestations({ attest: ALL, waive: { 'something-else': REASON }, runId: RUN, at: 't' }));
  ok('an unknown name can not be waived', !!unknown && /can not be waived/.test(unknown.message));
  const onlyRelaysConfirmed = thrown(() => resolveAttestations({ attest: ['relays-guarded'], runId: RUN, at: 't' }));
  ok('confirming only relays-guarded does not satisfy the other two', !!onlyRelaysConfirmed && TWO.every((n) => onlyRelaysConfirmed.message.includes(n)));

  // --- the reason is required ---------------------------------------------------------------------------------------------------------
  for (const bad of ['', '   ', 'x', 'not deployed', 'a'.repeat(WAIVER_MIN_REASON_CHARS - 1)]) {
    const e = thrown(() => resolveAttestations({ attest: TWO, waive: { 'relays-guarded': bad }, runId: RUN, at: 't' }));
    ok(`a missing / trivial reason is refused (${JSON.stringify(bad).slice(0, 20)})`, !!e && /written reason/.test(e.message));
  }
  ok('a reason of exactly the minimum length is accepted', resolveAttestations({ attest: TWO, waive: { 'relays-guarded': 'a'.repeat(WAIVER_MIN_REASON_CHARS) }, runId: RUN, at: 't' }).waivers.length === 1);

  // --- a waiver is not a confirmation, and does not carry over --------------------------------------------------------------------------
  const both = thrown(() => resolveAttestations({ attest: ALL, waive: { 'relays-guarded': REASON }, runId: RUN, at: 't' }));
  ok('confirming AND waiving the same name is refused', !!both && /both confirmed/.test(both.message));
  resolveAttestations({ attest: TWO, waive: { 'relays-guarded': REASON }, runId: RUN, at: 't' });
  const nextRun = thrown(() => resolveAttestations({ attest: TWO, runId: '20261017-000000', at: 't' }));
  ok('a waiver given for one apply does not apply to the next apply', !!nextRun && nextRun.message.includes('relays-guarded'));
  ok('the waiver records the run it was made for', resolveAttestations({ attest: TWO, waive: { 'relays-guarded': REASON }, runId: 'RUN-A', at: 't' }).waivers[0].run === 'RUN-A');

  // --- scratch databases (no confirmations required) still validate any waiver given ---------------------------------------------------------------
  ok('not required (scratch): nothing missing, nothing thrown', resolveAttestations({ attest: [], required: false, runId: RUN, at: 't' }).waivers.length === 0);
  ok('not required (scratch): an invalid waiver is still refused', !!thrown(() => resolveAttestations({ attest: [], waive: { 'auth-email-contained': REASON }, required: false, runId: RUN, at: 't' })));

  // --- command line parsing -------------------------------------------------------------------------------------------------------------------
  const parsedWaive = parseWaiveOption(`relays-guarded=${REASON}`);
  ok('--waive "name=reason" is parsed', parsedWaive['relays-guarded'] === REASON);
  ok('the reason may itself contain "="', parseWaiveOption('relays-guarded=a=b reason')['relays-guarded'] === 'a=b reason');
  ok('no --waive -> no waiver', Object.keys(parseWaiveOption(undefined)).length === 0);
  ok('--waive without a value (bare flag) is refused', !!thrown(() => parseWaiveOption(true)));
  ok('--waive without "=" is refused', !!thrown(() => parseWaiveOption('relays-guarded')));

  // --- the report: waivers are separate and prominent, never listed among the confirmations ----------------------------------------------------------------------------
  const m = { id: RUN, waivers: waived.waivers, attestations: { names: TWO, at: 't' } };
  const lines = renderWaivers(m).join('\n');
  ok('the report has a WAIVED — NOT VERIFIED section with the reason', lines.includes('## WAIVED — NOT VERIFIED') && lines.includes('relays-guarded') && lines.includes(REASON));
  ok('no waivers -> no section', renderWaivers({ id: RUN }).length === 0);
  const report = renderReport({ id: RUN, status: 'applied', prodLabel: 'p', devLabel: 'd', createdAt: 't', waivers: waived.waivers, attestations: { names: TWO, at: 't' } });
  const confirmations = report.split('## Operator confirmations')[1]?.split('## WAIVED')[0] ?? '';
  ok('the full report contains the waiver section', report.includes('## WAIVED — NOT VERIFIED'));
  ok('the waived relay check is NOT listed as an operator confirmation', !confirmations.includes('relays-guarded') && confirmations.includes('auth-email-contained') && confirmations.includes('stripe-edge-secrets-test'));

  // --- wiring: apply uses these rules, and nothing else about its safety checks was removed -------------------------------------------------------------------------
  const src = fs.readFileSync(path.join(process.cwd(), 'scripts/SyncDevDataFromProd/lib/run.mjs'), 'utf8');
  const applyBody = src.slice(src.indexOf('export function apply('), src.indexOf('export function verifyApplied('));
  ok('apply takes a waive argument and resolves attestations through resolveAttestations', /waive = \{\}/.test(applyBody) && /resolveAttestations\(\{ attest, waive/.test(applyBody));
  ok('apply still checks the plan hash, approval phrase, preview age, rehearsal, schema, stripe mode, export checksums', ['computePlanHash(manifest) !== manifest.planHash', 'confirmationPhrase(manifest)', 'maxAgeHours', 'rehearsalRequired(dev, enforceRehearsal)', 'schemaHash(plan, devSchema)', 'stripeProblems(stripeModeOfDev(dev))', 'manifest.exportChecksums', 'verifyEnvironment({ prod, dev })'].every((s) => applyBody.includes(s)));
  ok('the old inline attestation loop is gone (single code path)', !/Object\.keys\(ATTESTATIONS\)\.filter\(\(k\) => !attest\.includes\(k\)\)/.test(applyBody));
  const cli = fs.readFileSync(path.join(process.cwd(), 'scripts/SyncDevDataFromProd/cli.mjs'), 'utf8');
  ok('the CLI passes the waiver to apply and refuses a repeated --waive', /parseWaiveOption\(args\.waive\)/.test(cli) && /--waive may be given once only/.test(cli) && /attest, waive, log/.test(cli));

  console.log(`dev refresh syncDevDataFromProdWaiver tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} syncDevDataFromProdWaiver test(s) failed`);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
