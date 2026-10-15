// Differential tests for the task edge-request helpers (taskEdgeRequests.ts).
//
// The `old*` functions are verbatim copies of the request mechanics in TaskDetailModal before the
// extraction (URL, headers, body, JSON parsed before the `ok` check, error projection, and for SMS the
// inline try/catch blocks). A recording fake `fetch` captures the exact request and the order in which
// the response is touched. The oracles never call the new helpers.

import { postSessionEdge, postTaskSms } from './taskEdgeRequests';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
let compared = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
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

const BASE = 'https://proj.supabase.test';
const ANON = 'anon-key-123';

// ---- Recording fake fetch ----
interface Scripted {
  ok: boolean; status?: number; json?: () => Promise<any>; text?: () => Promise<string>; throwOnFetch?: any;
}
function fakeFetch(script: Scripted) {
  const calls: any[] = [];
  const touched: string[] = [];
  const fn: any = async (url: string, init: any) => {
    calls.push({
      url, method: init.method, headers: init.headers,
      body: init.body instanceof FormData ? { formData: Array.from((init.body as FormData).entries()) } : init.body,
    });
    if (script.throwOnFetch) throw script.throwOnFetch;
    return {
      get ok() { touched.push('ok'); return script.ok; },
      get status() { touched.push('status'); return script.status ?? (script.ok ? 200 : 500); },
      json: () => { touched.push('json'); return (script.json ?? (() => Promise.resolve({})))(); },
      text: () => { touched.push('text'); return (script.text ?? (() => Promise.resolve('')))(); },
    };
  };
  return { fn, calls, touched };
}

async function settle<T>(p: Promise<T>): Promise<{ v?: T; e?: any }> {
  try { return { v: await p }; } catch (e) { return { e }; }
}
const sameErr = (a: any, b: any) => (!a && !b) || (a && b && a.constructor === b.constructor && a.message === b.message);

// ---- ORACLES: verbatim old request blocks ----
type OldCall = (f: any, token: string | undefined, p: any) => Promise<any>;
const oldCalls: Record<string, OldCall> = {
  async refund(fetch, token, p) {
    const r = await fetch(`${BASE}/functions/v1/stripe-refund`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: p.orderId, amountCents: p.amountCents, reason: p.reason }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to process refund');
    return data;
  },
  async cash(fetch, token, p) {
    const r = await fetch(`${BASE}/functions/v1/record-cash-payment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: p.orderId, amountCents: p.balancePaymentCents, tipCents: p.tipCents }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to record payment');
    return data;
  },
  async check(fetch, token, p) {
    const r = await fetch(`${BASE}/functions/v1/record-check-payment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: p.orderId, amountCents: p.balancePaymentCents, checkNumber: p.checkNumber, tipCents: p.tipCents }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to record payment');
    return data;
  },
  async waiverNoPhoto(fetch, token, p) {
    const form = new FormData();
    form.append('orderId', p.orderId);
    form.append('uploadSource', 'admin_no_photo');
    form.append('overrideReason', p.overrideReason.trim());
    const r = await fetch(`${BASE}/functions/v1/upload-physical-waiver`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to record waiver');
    return data;
  },
  async waiverUpload(fetch, token, p) {
    const form = new FormData();
    form.append('file', p.file);
    form.append('orderId', p.orderId);
    form.append('uploadSource', 'admin_upload');
    const r = await fetch(`${BASE}/functions/v1/upload-physical-waiver`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to upload waiver');
    return data;
  },
  async charge(fetch, token, p) {
    const r = await fetch(`${BASE}/functions/v1/charge-deposit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: p.orderId, paymentAmountCents: p.amountCents, tipCents: 0, selectedPaymentType: 'balance' }),
    });
    const data = await r.json();
    if (!r.ok || !data.success) throw new Error(data.error || 'Failed to charge card');
    return data;
  },
  async cancel(fetch, token, p) {
    const r = await fetch(`${BASE}/functions/v1/customer-cancel-order`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: p.orderId, cancellationReason: p.cancelReason, adminOverrideRefund: p.shouldRefund }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to cancel order');
    return data;
  },
};

// New-side callers: exactly what the modal passes to the helper.
const newCalls: Record<string, (f: any, token: string | undefined, p: any) => Promise<any>> = {
  refund: (f, t, p) => postSessionEdge({ functionName: 'stripe-refund', accessToken: t, body: { orderId: p.orderId, amountCents: p.amountCents, reason: p.reason }, fallbackMessage: 'Failed to process refund' }, { fetch: f, baseUrl: BASE }),
  cash: (f, t, p) => postSessionEdge({ functionName: 'record-cash-payment', accessToken: t, body: { orderId: p.orderId, amountCents: p.balancePaymentCents, tipCents: p.tipCents }, fallbackMessage: 'Failed to record payment' }, { fetch: f, baseUrl: BASE }),
  check: (f, t, p) => postSessionEdge({ functionName: 'record-check-payment', accessToken: t, body: { orderId: p.orderId, amountCents: p.balancePaymentCents, checkNumber: p.checkNumber, tipCents: p.tipCents }, fallbackMessage: 'Failed to record payment' }, { fetch: f, baseUrl: BASE }),
  waiverNoPhoto: (f, t, p) => {
    const form = new FormData();
    form.append('orderId', p.orderId);
    form.append('uploadSource', 'admin_no_photo');
    form.append('overrideReason', p.overrideReason.trim());
    return postSessionEdge({ functionName: 'upload-physical-waiver', accessToken: t, body: form, fallbackMessage: 'Failed to record waiver' }, { fetch: f, baseUrl: BASE });
  },
  waiverUpload: (f, t, p) => {
    const form = new FormData();
    form.append('file', p.file);
    form.append('orderId', p.orderId);
    form.append('uploadSource', 'admin_upload');
    return postSessionEdge({ functionName: 'upload-physical-waiver', accessToken: t, body: form, fallbackMessage: 'Failed to upload waiver' }, { fetch: f, baseUrl: BASE });
  },
  charge: (f, t, p) => postSessionEdge({ functionName: 'charge-deposit', accessToken: t, body: { orderId: p.orderId, paymentAmountCents: p.amountCents, tipCents: 0, selectedPaymentType: 'balance' }, fallbackMessage: 'Failed to charge card', requireSuccess: true }, { fetch: f, baseUrl: BASE }),
  cancel: (f, t, p) => postSessionEdge({ functionName: 'customer-cancel-order', accessToken: t, body: { orderId: p.orderId, cancellationReason: p.cancelReason, adminOverrideRefund: p.shouldRefund }, fallbackMessage: 'Failed to cancel order' }, { fetch: f, baseUrl: BASE }),
};

const params = {
  orderId: 'ord-1', amountCents: 4550, reason: 'Damaged "unit" & more', balancePaymentCents: 3000, tipCents: 500, checkNumber: '1042',
  overrideReason: '  Crew collected paper copy  ', file: new Blob(['pdf-bytes'], { type: 'application/pdf' }), cancelReason: 'Customer changed plans', shouldRefund: true,
};

const responses: Array<[string, Scripted]> = [
  ['success with success flag', { ok: true, json: async () => ({ success: true, id: 'x' }) }],
  ['success without success flag', { ok: true, json: async () => ({ id: 'x' }) }],
  ['success false flag', { ok: true, json: async () => ({ success: false, error: 'declined' }) }],
  ['success false without error', { ok: true, json: async () => ({ success: false }) }],
  ['non-OK with data.error', { ok: false, status: 400, json: async () => ({ error: 'Card declined' }) }],
  ['non-OK without data.error', { ok: false, status: 500, json: async () => ({}) }],
  ['non-OK with empty error string', { ok: false, status: 500, json: async () => ({ error: '' }) }],
  ['non-OK with success true', { ok: false, status: 500, json: async () => ({ success: true }) }],
  ['non-JSON body (json rejects)', { ok: true, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } }],
  ['non-JSON body on a non-OK response', { ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } }],
  ['fetch itself rejects', { ok: true, throwOnFetch: new TypeError('Failed to fetch') }],
];

(async () => {
  for (const name of Object.keys(oldCalls)) {
    for (const token of ['tok-abc', undefined]) {
      for (const [rname, script] of responses) {
        const o = fakeFetch(script); const n = fakeFetch(script);
        const ro = await settle(oldCalls[name](o.fn, token, params));
        const rn = await settle(newCalls[name](n.fn, token, params));
        compared++;
        ok(`${name} token=${token} ${rname}: identical request`, same(o.calls, n.calls));
        ok(`${name} token=${token} ${rname}: same result`, same(ro.v, rn.v));
        ok(`${name} token=${token} ${rname}: same thrown error`, sameErr(ro.e, rn.e));
        ok(`${name} token=${token} ${rname}: response touched in the same order`, same(o.touched, n.touched));
      }
    }
  }

  // ---- Exact request pins ----
  {
    const f = fakeFetch({ ok: true, json: async () => ({}) });
    await newCalls.cash(f.fn, 'tok-abc', params);
    eq('cash: exact request', f.calls, [{
      url: `${BASE}/functions/v1/record-cash-payment`, method: 'POST',
      headers: { 'Authorization': 'Bearer tok-abc', 'Content-Type': 'application/json' },
      body: '{"orderId":"ord-1","amountCents":3000,"tipCents":500}',
    }]);
  }
  {
    const f = fakeFetch({ ok: true, json: async () => ({}) });
    await newCalls.waiverNoPhoto(f.fn, 'tok-abc', params);
    eq('no-photo waiver: no Content-Type, FormData fields in order, reason trimmed', f.calls, [{
      url: `${BASE}/functions/v1/upload-physical-waiver`, method: 'POST', headers: { 'Authorization': 'Bearer tok-abc' },
      body: { formData: [['orderId', 'ord-1'], ['uploadSource', 'admin_no_photo'], ['overrideReason', 'Crew collected paper copy']] },
    }]);
  }
  {
    const f = fakeFetch({ ok: true, json: async () => ({}) });
    await newCalls.waiverUpload(f.fn, 'tok-abc', params);
    const body: any = f.calls[0].body;
    eq('upload waiver: field names and order', body.formData.map((e: any) => e[0]), ['file', 'orderId', 'uploadSource']);
    eq('upload waiver: source tag', body.formData[2], ['uploadSource', 'admin_upload']);
    eq('upload waiver: no Content-Type', Object.keys(f.calls[0].headers), ['Authorization']);
  }
  {
    const f = fakeFetch({ ok: true, json: async () => ({}) });
    await newCalls.refund(f.fn, undefined, params);
    eq('missing session still sends "Bearer undefined"', f.calls[0].headers.Authorization, 'Bearer undefined');
  }
  {
    const f = fakeFetch({ ok: true, json: async () => ({ success: false }) });
    const r = await settle(newCalls.charge(f.fn, 't', params));
    eq('charge: ok but success=false throws the fallback', r.e && r.e.message, 'Failed to charge card');
    const f2 = fakeFetch({ ok: true, json: async () => ({ success: false }) });
    const r2 = await settle(newCalls.cancel(f2.fn, 't', params));
    ok('non-charge callers do not require data.success', !r2.e);
  }
  {
    const order: string[] = [];
    const f: any = async () => ({
      get ok() { order.push('ok'); return false; },
      json: async () => { order.push('json'); return { error: 'e' }; },
    });
    await settle(postSessionEdge({ functionName: 'x', accessToken: 't', body: {}, fallbackMessage: 'fb' }, { fetch: f, baseUrl: BASE }));
    eq('response.json() is awaited before response.ok is read', order, ['json', 'ok']);
  }
  {
    const f = fakeFetch({ ok: false, status: 400, json: async () => ({ error: 'Specific', other: 1 }) });
    const r = await settle(postSessionEdge({ functionName: 'x', accessToken: 't', body: {}, fallbackMessage: 'fb' }, { fetch: f.fn, baseUrl: BASE }));
    eq('data.error takes precedence over the fallback', r.e.message, 'Specific');
    const f2 = fakeFetch({ ok: false, status: 400, json: async () => ({}) });
    const r2 = await settle(postSessionEdge({ functionName: 'x', accessToken: 't', body: {}, fallbackMessage: 'fb' }, { fetch: f2.fn, baseUrl: BASE }));
    eq('fallback used without data.error', r2.e.message, 'fb');
  }

  // ---- Direct task SMS: differential against the three verbatim inline blocks ----
  const smsBody = { to: '+15555550123', message: 'Hello', orderId: 'ord-1' };
  const smsBodyMedia = { ...smsBody, mediaUrls: [] as string[] };
  // Old inline blocks, verbatim except for the surrounding handler variables.
  async function oldEnRouteSms(fetch: any, log: any[]) {
    let smsWarning: string | null = null; let smsFailureError: string | undefined;
    try {
      const r = await fetch(`${BASE}/functions/v1/send-sms-notification`, {
        method: 'POST', headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: smsBody.to, message: smsBody.message, orderId: smsBody.orderId }),
      });
      if (!r.ok) { smsWarning = 'SMS failed to send'; smsFailureError = `SMS endpoint returned ${r.status}`; log.push(['En Route SMS failed:', await r.text()]); }
    } catch (e: any) { smsWarning = 'SMS failed: ' + e.message; smsFailureError = e.message; }
    return { smsWarning, smsFailureError };
  }
  async function oldArrivedSms(fetch: any, log: any[]) {
    let smsWarn: string | null = null; let arrivedSmsFailureError: string | undefined;
    try {
      const r = await fetch(`${BASE}/functions/v1/send-sms-notification`, {
        method: 'POST', headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: smsBody.to, message: smsBody.message, orderId: smsBody.orderId }),
      });
      if (!r.ok) { smsWarn = 'SMS failed to send'; arrivedSmsFailureError = `SMS endpoint returned ${r.status}`; log.push(['Arrived SMS failed:', await r.text()]); }
    } catch (e: any) { smsWarn = 'SMS failed: ' + e.message; arrivedSmsFailureError = e.message; }
    return { smsWarning: smsWarn, smsFailureError: arrivedSmsFailureError };
  }
  async function oldDropOffSms(fetch: any, log: any[]) {
    let smsWarn: string | null = null;
    try {
      const r = await fetch(`${BASE}/functions/v1/send-sms-notification`, {
        method: 'POST', headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: smsBody.to, message: smsBody.message, orderId: smsBody.orderId, mediaUrls: [] }),
      });
      if (!r.ok) { smsWarn = 'SMS failed to send'; log.push(['Drop-off SMS failed:', await r.text()]); }
    } catch (e: any) { smsWarn = 'SMS failed: ' + e.message; }
    return { smsWarning: smsWarn, smsFailureError: undefined };
  }
  const warns: any[] = [];
  const realWarn = console.warn;
  const newSms = async (body: any, label: string, fetch: any) => {
    console.warn = (...a: any[]) => { warns.push(a); };
    try {
      const out = await postTaskSms(body, label, { fetch, baseUrl: BASE, accessToken: ANON });
      return out.ok ? { smsWarning: null, smsFailureError: undefined } : { smsWarning: out.warning, smsFailureError: out.failureError };
    } finally { console.warn = realWarn; }
  };

  const smsScripts: Array<[string, Scripted]> = [
    ['OK', { ok: true }],
    ['500 with body text', { ok: false, status: 500, text: async () => 'upstream exploded' }],
    ['400 with empty text', { ok: false, status: 400, text: async () => '' }],
    ['non-OK where text() rejects', { ok: false, status: 503, text: async () => { throw new Error('stream broke'); } }],
    ['fetch rejects with an Error', { ok: true, throwOnFetch: new TypeError('Failed to fetch') }],
    ['fetch rejects with a non-Error', { ok: true, throwOnFetch: 'nope' }],
  ];
  const variants: Array<[string, (f: any, l: any[]) => Promise<any>, any, string]> = [
    ['En Route', oldEnRouteSms, smsBody, 'En Route'],
    ['Arrived', oldArrivedSms, smsBody, 'Arrived'],
    ['Drop-off', oldDropOffSms, smsBodyMedia, 'Drop-off'],
  ];
  for (const [vname, oldFn, body, label] of variants) {
    for (const [sname, script] of smsScripts) {
      const o = fakeFetch(script); const n = fakeFetch(script);
      const lo: any[] = [];
      console.warn = (...a: any[]) => { lo.push(a); };
      let ro: any; try { ro = await oldFn(o.fn, lo); } finally { console.warn = realWarn; }
      warns.length = 0;
      const rn = await newSms(body, label, n.fn);
      compared++;
      ok(`sms ${vname} / ${sname}: identical request`, same(o.calls, n.calls));
      // Drop-Off Complete never read a failure error (and never read r.status); its caller uses only the warning.
      const dropOff = vname === 'Drop-off';
      ok(`sms ${vname} / ${sname}: identical warning${dropOff ? '' : ' and failure error'}`, dropOff ? ro.smsWarning === rn.smsWarning : same(ro, rn));
      ok(`sms ${vname} / ${sname}: identical console.warn`, same(lo, warns));
      ok(`sms ${vname} / ${sname}: response touched in the same order`, same(o.touched, dropOff ? n.touched.filter(t => t !== 'status') : n.touched));
    }
  }
  {
    const f = fakeFetch({ ok: true });
    await postTaskSms(smsBodyMedia, 'Drop-off', { fetch: f.fn, baseUrl: BASE, accessToken: ANON });
    eq('sms: exact request (session access token, body serialized as given)', f.calls, [{
      url: `${BASE}/functions/v1/send-sms-notification`, method: 'POST',
      headers: { Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: '{"to":"+15555550123","message":"Hello","orderId":"ord-1","mediaUrls":[]}',
    }]);
    const f2 = fakeFetch({ ok: false, status: 500, text: async () => 'x' });
    const r2 = await postTaskSms(smsBody, 'En Route', { fetch: f2.fn, baseUrl: BASE, accessToken: ANON });
    eq('sms: failure projection', r2, { ok: false, warning: 'SMS failed to send', failureError: 'SMS endpoint returned 500' });
    const f3 = fakeFetch({ ok: true, throwOnFetch: new Error('offline') });
    const r3 = await postTaskSms(smsBody, 'En Route', { fetch: f3.fn, baseUrl: BASE, accessToken: ANON });
    eq('sms: thrown projection', r3, { ok: false, warning: 'SMS failed: offline', failureError: 'offline' });
  }

  console.log(`Task edge request differential tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
  if (failed > 0) throw new Error(`${failed} task edge request test(s) failed`);
})();
