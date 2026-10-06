// Differential tests for the pure task message builders (taskNotificationMessages.ts).
//
// The `oracle*` functions are verbatim copies of the old inline blocks in TaskDetailModal. Where the
// old code created a portal link in the middle of building the message, the oracle gets the link
// result through a stub at exactly that point (the real createShortPortalLink is I/O). The oracles never
// call the new builders. Every output string is compared byte for byte.

import { formatCurrency } from '../../../lib/pricing';
import {
  buildEnRouteMessage, buildEnRouteResultMessage, buildArrivedMessage, buildArrivedResultMessage,
  buildDropOffRulesMessage, buildDropOffResultMessage, buildPickupCompletionSummary,
} from './taskNotificationMessages';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
let compared = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Link = { success: true; url: string; shortCode: string } | { success: false; error: string };
const LINK_OK: Link = { success: true, url: 'https://x.test/i/ab12', shortCode: 'ab12' };
const LINK_FAIL: Link = { success: false, error: 'Short-link generation failed' };

interface FakeTask {
  type: 'drop-off' | 'pick-up'; customerName: string; waiverSigned: boolean; balanceDue: number; hasPets?: boolean;
  pickupPreference?: string; eventEndTime?: string;
}

// ---- ORACLES (verbatim old blocks) ----
function oracleEnRoute(task: FakeTask, etaDistance: string, etaStartStr: string, etaEndStr: string, link: Link): string {
  const tf = (s: string) => s;
  let msg = `Hello ${task.customerName.split(' ')[0]}! We're on our way to ${task.type === 'drop-off' ? 'deliver' : 'pick up'} your rental. ETA: ${tf(etaStartStr)} - ${tf(etaEndStr)}`;
  if (etaDistance) msg += ` (${etaDistance} away)`;
  msg += '. ';
  const hasActionRequirement = task.type === 'drop-off' && (!task.waiverSigned || task.balanceDue > 0);
  let enRouteLinkResult: any = { success: false, error: 'No action required' };
  if (hasActionRequirement) {
    msg += '\n\n';
    if (!task.waiverSigned) msg += '⚠️ IMPORTANT: Your waiver is not signed yet. ';
    if (task.balanceDue > 0) msg += `⚠️ IMPORTANT: Balance due: ${formatCurrency(task.balanceDue)}. `;
    enRouteLinkResult = link; // createShortPortalLink(...) in the old code
    if (enRouteLinkResult.success) {
      msg += `\n\nPlease complete these before we arrive: ${enRouteLinkResult.url}`;
    }
  }
  if (task.type === 'drop-off') {
    msg += '\n\nPlease ensure there is a clear path for delivery and setup.';
    if (task.hasPets) {
      msg += ' Please also clear the backyard area of any pet waste before we arrive.';
    }
    msg += ' See you soon!';
  } else {
    if (task.hasPets) {
      msg += ' Please make sure all pets are secured inside before we arrive.';
    }
  }
  return msg;
}

function oracleArrived(task: FakeTask, link: Link): string {
  let msg = `We have arrived at your location! `;
  const hasArrivedActionRequirement = task.type === 'drop-off' && (!task.waiverSigned || task.balanceDue > 0);
  let arrivedLinkResult: any = { success: false, error: 'No action required' };
  if (hasArrivedActionRequirement) {
    msg += '\n\n⚠️ Before we unload:\n';
    if (!task.waiverSigned) msg += '• Please sign the waiver\n';
    if (task.balanceDue > 0) msg += `• Complete payment (${formatCurrency(task.balanceDue)})\n`;
    arrivedLinkResult = link;
    if (arrivedLinkResult.success) {
      msg += `\nComplete at: ${arrivedLinkResult.url}\n\n`;
    }
  }
  if (task.type === 'drop-off') {
    msg += 'Please:\n• Put up any animals\n• Be ready to inspect the equipment\n• Approve the setup location';
    if (task.hasPets) {
      msg += '\n• Make sure all pets are secured inside';
    }
  } else {
    msg += "We'll begin pickup shortly.";
    if (task.hasPets) {
      msg += ' Please make sure all pets are secured inside before we arrive.';
    }
    msg += ' Thank you for using Bounce Party Club!';
  }
  return msg;
}

function oracleDropOff(task: FakeTask): string {
  const pickupTime = task.pickupPreference === 'same_day' ? `this evening (${task.eventEndTime || 'after your event'})` : 'tomorrow morning';
  return `Equipment has been delivered! You are now responsible for the equipment until ${pickupTime}.\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• NO HANGING OR CLIMBING ON THE NETS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉`;
}

function oracleEnRouteResult(smsWarning: string | null, etaCalcErr: string | null, etaMinutes: number, etaDistance: string, wfErr: any): string {
  let successMsg = smsWarning && etaCalcErr ? `En Route saved (fallback ETA), but the customer notification failed.`
    : smsWarning ? `En Route saved, but the customer notification failed.`
    : etaCalcErr ? `En Route saved and customer notified (fallback ETA used).`
    : `En Route saved and customer notified. ETA: ${etaMinutes} min${etaDistance ? ` (${etaDistance})` : ''}.`;
  if (wfErr) successMsg += '\n\n⚠️ Portal status may not update — workflow state failed to save.';
  return successMsg;
}
function oracleArrivedResult(smsWarn: string | null, wfErr: any): string {
  let arrivedMsg = smsWarn ? `Arrived saved, but the customer notification failed.` : 'Arrived and customer notified successfully!';
  if (wfErr) arrivedMsg += '\n\n⚠️ Portal status may not update — workflow state failed to save.';
  return arrivedMsg;
}
function oracleDropOffResult(smsWarn: string | null, wfErr: any): string {
  let dropOffMsg = smsWarn ? `Delivery marked complete. Warning: ${smsWarn}.` : 'Delivery completed and customer notified!';
  if (wfErr) dropOffMsg += '\n\n⚠️ Portal will not show "Delivered" — workflow state failed to save.';
  return dropOffMsg;
}

function oracleSummary(task: any, hasBalance: boolean, completionTime: Date) {
  const paymentMethods = [...new Set(
    (task.payments || [])
      .filter((p: any) => p.status === 'paid' || p.status === 'succeeded')
      .map((p: any) => {
        const method = (p.payment_method || '').toLowerCase();
        if (method === 'cash') return 'Cash';
        if (method === 'check') return 'Check';
        return 'Card';
      })
  )];

  const summary = {
    orderNumber: task.orderNumber,
    customerName: task.customerName,
    totalCents: task.total,
    depositPaidCents: task.depositPaidCents,
    balancePaidCents: task.balancePaidCents,
    tipCents: task.tipCents,
    remainingBalanceCents: hasBalance ? task.balanceDue : 0,
    paymentMethods,
    waiverSigned: task.waiverSigned,
    completionTime,
    hadBalanceWarning: hasBalance,
  };
  return summary;
}

// ---- New-side callers (what the modal does) ----
const needsAction = (t: FakeTask) => t.type === 'drop-off' && (!t.waiverSigned || t.balanceDue > 0);
function newEnRoute(t: FakeTask, dist: string, s: string, e: string, link: Link) {
  const has = needsAction(t);
  const linkResult: Link = has ? link : { success: false, error: 'No action required' };
  return buildEnRouteMessage({ customerName: t.customerName, taskType: t.type, etaStart: s, etaEnd: e, etaDistance: dist, waiverSigned: t.waiverSigned, balanceDue: t.balanceDue, hasPets: t.hasPets, hasActionRequirement: has, linkResult });
}
function newArrived(t: FakeTask, link: Link) {
  const has = needsAction(t);
  const linkResult: Link = has ? link : { success: false, error: 'No action required' };
  return buildArrivedMessage({ taskType: t.type, waiverSigned: t.waiverSigned, balanceDue: t.balanceDue, hasPets: t.hasPets, hasActionRequirement: has, linkResult });
}

const NAMES = ['John Smith', 'Madonna', 'Mary Ann Lee', '', 'José Núñez'];
const BALANCES = [0, 1, 5000, 123456];

for (const type of ['drop-off', 'pick-up'] as const) {
  for (const waiverSigned of [true, false]) {
    for (const balanceDue of BALANCES) {
      for (const hasPets of [true, false, undefined]) {
        for (const dist of ['', '4.2 mi']) {
          for (const link of [LINK_OK, LINK_FAIL]) {
            for (const customerName of NAMES) {
              const t: FakeTask = { type, customerName, waiverSigned, balanceDue, hasPets };
              compared++;
              ok(`en route ${type} w=${waiverSigned} b=${balanceDue} pets=${hasPets} d="${dist}" link=${link.success} name="${customerName}"`,
                newEnRoute(t, dist, '2:50 PM', '3:10 PM', link) === oracleEnRoute(t, dist, '2:50 PM', '3:10 PM', link));
            }
            const t: FakeTask = { type, customerName: 'John Smith', waiverSigned, balanceDue, hasPets };
            compared++;
            ok(`arrived ${type} w=${waiverSigned} b=${balanceDue} pets=${hasPets} link=${link.success}`, newArrived(t, link) === oracleArrived(t, link));
          }
        }
      }
    }
  }
}

// ---- Exact pins for key variants (so a shared mistake in oracle + builder would still show) ----
const base: FakeTask = { type: 'drop-off', customerName: 'John Smith', waiverSigned: true, balanceDue: 0, hasPets: false };
eq('en route: plain drop-off', newEnRoute(base, '', '2:50 PM', '3:10 PM', LINK_FAIL),
  "Hello John! We're on our way to deliver your rental. ETA: 2:50 PM - 3:10 PM. \n\nPlease ensure there is a clear path for delivery and setup. See you soon!");
eq('en route: drop-off, waiver + balance, link, pets, distance', newEnRoute({ ...base, waiverSigned: false, balanceDue: 4550, hasPets: true }, '3.1 mi', '2:50 PM', '3:10 PM', LINK_OK),
  "Hello John! We're on our way to deliver your rental. ETA: 2:50 PM - 3:10 PM (3.1 mi away). \n\n⚠️ IMPORTANT: Your waiver is not signed yet. ⚠️ IMPORTANT: Balance due: $45.50. \n\nPlease complete these before we arrive: https://x.test/i/ab12\n\nPlease ensure there is a clear path for delivery and setup. Please also clear the backyard area of any pet waste before we arrive. See you soon!");
eq('en route: drop-off, action required, link failed (no URL line)', newEnRoute({ ...base, balanceDue: 1000 }, '', 'a', 'b', LINK_FAIL),
  "Hello John! We're on our way to deliver your rental. ETA: a - b. \n\n⚠️ IMPORTANT: Balance due: $10.00. \n\nPlease ensure there is a clear path for delivery and setup. See you soon!");
eq('en route: pickup ignores waiver/balance, pets sentence', newEnRoute({ ...base, type: 'pick-up', waiverSigned: false, balanceDue: 9999, hasPets: true }, '', 'a', 'b', LINK_OK),
  "Hello John! We're on our way to pick up your rental. ETA: a - b.  Please make sure all pets are secured inside before we arrive.");
eq('en route: pickup without pets ends after the ETA', newEnRoute({ ...base, type: 'pick-up' }, '', 'a', 'b', LINK_OK), "Hello John! We're on our way to pick up your rental. ETA: a - b. ");
eq('arrived: plain drop-off', newArrived(base, LINK_FAIL), 'We have arrived at your location! Please:\n• Put up any animals\n• Be ready to inspect the equipment\n• Approve the setup location');
eq('arrived: drop-off, waiver + balance + link + pets', newArrived({ ...base, waiverSigned: false, balanceDue: 2500, hasPets: true }, LINK_OK),
  'We have arrived at your location! \n\n⚠️ Before we unload:\n• Please sign the waiver\n• Complete payment ($25.00)\n\nComplete at: https://x.test/i/ab12\n\nPlease:\n• Put up any animals\n• Be ready to inspect the equipment\n• Approve the setup location\n• Make sure all pets are secured inside');
eq('arrived: pickup keeps the existing "before we arrive" wording', newArrived({ ...base, type: 'pick-up', hasPets: true }, LINK_OK),
  "We have arrived at your location! We'll begin pickup shortly. Please make sure all pets are secured inside before we arrive. Thank you for using Bounce Party Club!");
eq('arrived: pickup without pets', newArrived({ ...base, type: 'pick-up' }, LINK_OK), "We have arrived at your location! We'll begin pickup shortly. Thank you for using Bounce Party Club!");

// ---- Link sequencing contract: no action requirement means no link text, whatever the link says ----
eq('en route: a successful link is ignored when no action is required', newEnRoute(base, '', 'a', 'b', LINK_OK).includes('https://'), false);
eq('arrived: a successful link is ignored when no action is required', newArrived(base, LINK_OK).includes('https://'), false);
ok('builders include the URL only when action is required and the link succeeded',
  buildEnRouteMessage({ customerName: 'A B', taskType: 'drop-off', etaStart: 'a', etaEnd: 'b', etaDistance: '', waiverSigned: true, balanceDue: 0, hasActionRequirement: false, linkResult: LINK_OK }).includes('https://') === false);

// ---- Drop-Off Complete ----
for (const pickupPreference of ['same_day', 'next_day', undefined, '']) {
  for (const eventEndTime of ['6:00 PM', '', undefined]) {
    const t: FakeTask = { ...base, pickupPreference, eventEndTime };
    compared++;
    ok(`drop-off rules pref=${pickupPreference} end=${eventEndTime}`, buildDropOffRulesMessage({ pickupPreference, eventEndTime }) === oracleDropOff(t));
  }
}
eq('drop-off rules: same day with end time', buildDropOffRulesMessage({ pickupPreference: 'same_day', eventEndTime: '6:00 PM' }),
  'Equipment has been delivered! You are now responsible for the equipment until this evening (6:00 PM).\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• NO HANGING OR CLIMBING ON THE NETS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉');
eq('drop-off rules: same day, empty end time falls back', buildDropOffRulesMessage({ pickupPreference: 'same_day', eventEndTime: '' }).includes('this evening (after your event)'), true);
eq('drop-off rules: same day, missing end time falls back', buildDropOffRulesMessage({ pickupPreference: 'same_day' }).includes('this evening (after your event)'), true);
eq('drop-off rules: next day', buildDropOffRulesMessage({ pickupPreference: 'next_day' }).includes('until tomorrow morning.'), true);

// ---- Result messages: every warning combination ----
for (const smsWarning of [null, 'SMS failed to send', 'SMS failed: boom']) {
  for (const etaCalcErr of [null, 'no gps']) {
    for (const etaDistance of ['', '4 mi']) {
      for (const wf of [false, true]) {
        compared++;
        ok(`en route result sms=${smsWarning} eta=${etaCalcErr} d="${etaDistance}" wf=${wf}`,
          buildEnRouteResultMessage({ smsWarning, etaCalcErr, etaMinutes: 17, etaDistance, workflowStatusFailed: wf }) === oracleEnRouteResult(smsWarning, etaCalcErr, 17, etaDistance, wf ? { message: 'x' } : null));
      }
    }
  }
  for (const wf of [false, true]) {
    compared += 2;
    ok(`arrived result sms=${smsWarning} wf=${wf}`, buildArrivedResultMessage({ smsWarn: smsWarning, workflowStatusFailed: wf }) === oracleArrivedResult(smsWarning, wf ? { message: 'x' } : null));
    ok(`drop-off result sms=${smsWarning} wf=${wf}`, buildDropOffResultMessage({ smsWarn: smsWarning, workflowStatusFailed: wf }) === oracleDropOffResult(smsWarning, wf ? { message: 'x' } : null));
  }
}
eq('en route result: success', buildEnRouteResultMessage({ smsWarning: null, etaCalcErr: null, etaMinutes: 22, etaDistance: '5 mi', workflowStatusFailed: false }), 'En Route saved and customer notified. ETA: 22 min (5 mi).');
eq('en route result: warning + fallback + workflow failure', buildEnRouteResultMessage({ smsWarning: 'x', etaCalcErr: 'y', etaMinutes: 30, etaDistance: '', workflowStatusFailed: true }), 'En Route saved (fallback ETA), but the customer notification failed.\n\n⚠️ Portal status may not update — workflow state failed to save.');
eq('arrived result: warning', buildArrivedResultMessage({ smsWarn: 'x', workflowStatusFailed: false }), 'Arrived saved, but the customer notification failed.');
eq('drop-off result: warning + workflow failure', buildDropOffResultMessage({ smsWarn: 'SMS failed to send', workflowStatusFailed: true }), 'Delivery marked complete. Warning: SMS failed to send.\n\n⚠️ Portal will not show "Delivered" — workflow state failed to save.');

// ---- Pickup summary ----
{
  const r = rng(77);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const METHODS = ['cash', 'CASH', 'check', 'Check', 'card', 'stripe', '', null, undefined, 'venmo'];
  const STATUSES = ['paid', 'succeeded', 'pending', 'failed', 'refunded'];
  for (let n = 0; n < 400; n++) {
    const payments = Array.from({ length: Math.floor(r() * 6) }, () => ({ status: pick(STATUSES), payment_method: pick(METHODS) as any }));
    const task = {
      orderNumber: pick(['BPC-1', '2']), customerName: pick(['A B', '']), total: pick([0, 25000]), depositPaidCents: pick([0, 5000]),
      balancePaidCents: pick([0, 1000]), tipCents: pick([0, 500]), balanceDue: pick([0, 3000, -5]), waiverSigned: pick([true, false]),
      payments: pick([payments, undefined as any]),
    };
    const hasBalance = task.balanceDue > 0;
    const when = new Date(Date.UTC(2026, 6, 4, 18, 30, n % 60));
    compared++;
    ok(`pickup summary ${n}`, same(buildPickupCompletionSummary(task, hasBalance, when), oracleSummary(task, hasBalance, when)));
  }
  const s = buildPickupCompletionSummary({ orderNumber: 'N', customerName: 'C', total: 1, depositPaidCents: 2, balancePaidCents: 3, tipCents: 4, balanceDue: 500, waiverSigned: true,
    payments: [{ status: 'paid', payment_method: 'Cash' }, { status: 'succeeded', payment_method: 'cash' }, { status: 'paid', payment_method: 'check' }, { status: 'paid', payment_method: 'visa' }, { status: 'pending', payment_method: 'check' }, { status: 'paid', payment_method: null }] },
  true, new Date(5));
  eq('pickup summary: methods deduplicated in first-seen order, only paid/succeeded', s.paymentMethods, ['Cash', 'Check', 'Card']);
  eq('pickup summary: remaining balance and warning', [s.remainingBalanceCents, s.hadBalanceWarning], [500, true]);
  eq('pickup summary: completion time is the injected value', s.completionTime.getTime(), 5);
  eq('pickup summary: no balance zeroes remaining', buildPickupCompletionSummary({ orderNumber: 'N', customerName: 'C', total: 1, depositPaidCents: 0, balancePaidCents: 0, tipCents: 0, balanceDue: 500, waiverSigned: false }, false, new Date(0)).remainingBalanceCents, 0);
}

console.log(`Task notification message differential tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
if (failed > 0) throw new Error(`${failed} task notification message test(s) failed`);
