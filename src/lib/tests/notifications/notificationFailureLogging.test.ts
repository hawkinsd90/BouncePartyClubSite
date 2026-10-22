// Tests for the repaired client-side notification_failures logging.
//
// Contract (shared by Dev and production): a client-originated row carries
//   notification_type ('email' | 'sms'), intended_recipient, subject, error_message and
//   context { orderId, messageType, source }
// and never order_id / channel / message_type (columns that do not exist in production).
// Only UNIQUE client failures (a short portal link that could not be created, so no edge function
// ran) are recorded here. Provider send failures are recorded by the edge functions' RPC.
//
// orderApprovalService and orderNotificationService are executed for real (their Supabase client is a
// recording fake). The three React components cannot be imported under Node, so their insert blocks
// are located in the current source text, evaluated against stub values, and pinned.
//
// The `@ts-expect-error` lines below are checked by `npm run typecheck`: if the table type ever
// accepts the stale columns again, or stops requiring the three required fields, typecheck fails.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import type { NotificationFailure, SystemStatus } from '../../notifications/notificationFailures';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The app tsconfig has no Node typings; this test only runs under Node (jiti).
declare const require: (id: string) => any;
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

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

// ---------------------------------------------------------------------------
// Type-level proof (verified by tsc, not at runtime)
// ---------------------------------------------------------------------------
type FailureInsert = Database['public']['Tables']['notification_failures']['Insert'];
type StatusRow = Database['public']['Tables']['notification_system_status']['Row'];

export const typedInsertAccepted: FailureInsert = { notification_type: 'sms', intended_recipient: '+15555550123', error_message: 'e' };
// @ts-expect-error intended_recipient is required
export const missingRecipient: FailureInsert = { notification_type: 'sms', error_message: 'e' };
// @ts-expect-error notification_type is required
export const missingType: FailureInsert = { intended_recipient: 'x', error_message: 'e' };
// @ts-expect-error error_message is required
export const missingError: FailureInsert = { notification_type: 'sms', intended_recipient: 'x' };
// @ts-expect-error order_id is not a notification_failures column
export const staleOrderId: FailureInsert = { notification_type: 'sms', intended_recipient: 'x', error_message: 'e', order_id: 'o' };
// @ts-expect-error channel is a Dev-only column and not part of the shared contract
export const staleChannel: FailureInsert = { notification_type: 'sms', intended_recipient: 'x', error_message: 'e', channel: 'sms' };
// @ts-expect-error message_type is a Dev-only column and not part of the shared contract
export const staleMessageType: FailureInsert = { notification_type: 'sms', intended_recipient: 'x', error_message: 'e', message_type: 'm' };
// @ts-expect-error resolved_by does not exist
export const staleResolvedBy: FailureInsert = { notification_type: 'sms', intended_recipient: 'x', error_message: 'e', resolved_by: 'u' };

// The real typed client accepts the repaired payload without any cast.
export function typedClientInsertCompiles(client: SupabaseClient<Database>) {
  return client.from('notification_failures').insert({
    notification_type: 'email',
    intended_recipient: 'a@b.test',
    subject: 'Subject',
    error_message: 'e',
    context: { orderId: 'o', messageType: 'm', source: 's' },
  });
}

// Notification RPC contracts (verified against the migration and the live functions).
type NotificationRpcs = Database['public']['Functions'];
export const failureRpcArgs: NotificationRpcs['record_notification_failure']['Args'] = { p_type: 'sms', p_recipient: '+15555550123', p_subject: 's', p_message_preview: 'p', p_error: 'e' };
export const failureRpcArgsWithContext: NotificationRpcs['record_notification_failure']['Args'] = { ...failureRpcArgs, p_context: { orderId: 'o' } };
// @ts-expect-error the stale argument names are not part of the real function
export const staleFailureRpcArgs: NotificationRpcs['record_notification_failure']['Args'] = { p_order_id: null, p_notification_type: 'sms', p_intended_recipient: 'x', p_subject: null, p_message_preview: null, p_error_message: 'e' };
// @ts-expect-error p_error is required
export const missingFailureRpcError: NotificationRpcs['record_notification_failure']['Args'] = { p_type: 'sms', p_recipient: 'x', p_subject: 's', p_message_preview: 'p' };
// record_notification_failure returns the new row id (uuid), not void
export const failureRpcReturn: NotificationRpcs['record_notification_failure']['Returns'] = '00000000-0000-0000-0000-000000000000';
// @ts-expect-error the return value is a uuid string, not a number
export const badFailureRpcReturn: NotificationRpcs['record_notification_failure']['Returns'] = 1;
export const successRpcArgs: NotificationRpcs['record_notification_success']['Args'] = { p_type: 'email' };
// @ts-expect-error the stale argument name is rejected
export const staleSuccessRpcArgs: NotificationRpcs['record_notification_success']['Args'] = { p_notification_type: 'email' };
// get_unresolved_failures_count takes no arguments and returns jsonb
export const countRpcReturn: NotificationRpcs['get_unresolved_failures_count']['Returns'] = { email: 0, sms: 0, total: 0 };

// The real typed client accepts the RPC calls without any cast, and rejects the stale shapes.
export function typedRpcCallsCompile(client: SupabaseClient<Database>) {
  return [
    client.rpc('record_notification_failure', { p_type: 'email', p_recipient: 'a@b.test', p_subject: '', p_message_preview: '', p_error: 'e', p_context: {} }),
    client.rpc('record_notification_success', { p_type: 'sms' }),
    client.rpc('get_unresolved_failures_count'),
    // @ts-expect-error stale argument name
    client.rpc('record_notification_success', { p_notification_type: 'sms' }),
  ];
}

// The notification_system_status contract carries the live columns and not the stale one.
export const statusRow: StatusRow = {
  id: 'i', system_type: 'sms', is_operational: true, last_success_at: null, last_failure_at: null,
  consecutive_failures: 0, total_failures_24h: 0, error_details: null, admin_notified_at: null, updated_at: 'u',
};
// @ts-expect-error error_message is not a notification_system_status column
export const staleStatus: StatusRow = { ...statusRow, error_message: 'x' };

// Everything NotificationFailuresAlert reads is present on the reliability row type.
export const readerFields: Pick<NotificationFailure, 'id' | 'notification_type' | 'intended_recipient' | 'subject' | 'message_preview' | 'error_message' | 'created_at' | 'resolved_at'> = {
  id: 'i', notification_type: 'sms', intended_recipient: 'x', subject: null, message_preview: null, error_message: 'e', created_at: 't', resolved_at: null,
};
export const statusReader: Pick<SystemStatus, 'is_operational' | 'consecutive_failures'> = { is_operational: true, consecutive_failures: 0 };

// ---------------------------------------------------------------------------
// Fake Supabase client for the service modules
// ---------------------------------------------------------------------------
interface Recorder { inserts: Array<{ table: string; payload: any }>; tables: string[] }
type InsertBehavior = 'ok' | 'returns-error' | 'throws';

function fakeSb(behavior: InsertBehavior, rec: Recorder) {
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is', 'neq', 'gte', 'lte']) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.insert = (payload: any) => {
      rec.inserts.push({ table, payload });
      if (behavior === 'throws') return Promise.reject(new Error('insert threw'));
      if (behavior === 'returns-error') return Promise.resolve({ error: { message: 'insert rejected' } });
      return Promise.resolve({ error: null });
    };
    return b;
  };
  return { from(table: string) { rec.tables.push(table); return builder(table); } };
}

function captureErrors<T>(fn: () => Promise<T>): Promise<{ value: T; errors: any[][] }> {
  const real = console.error; const errors: any[][] = [];
  console.error = (...a: any[]) => { errors.push(a); };
  return fn().then((value) => ({ value, errors })).finally(() => { console.error = real; });
}

const FORBIDDEN = ['order_id', 'channel', 'message_type', 'created_at'];
function rowIsContractShaped(row: any, expected: { type: 'email' | 'sms'; recipient: string; subject: string; error: string; context: any }, label: string) {
  eq(`${label}: exact row`, row, {
    notification_type: expected.type, intended_recipient: expected.recipient, subject: expected.subject,
    error_message: expected.error, context: expected.context,
  });
  ok(`${label}: no stale columns`, FORBIDDEN.every((k) => !(k in row)));
}

// ---------------------------------------------------------------------------
// Source helpers for the React components
// ---------------------------------------------------------------------------
function readSrc(rel: string): string { return fs.readFileSync(path.join('src', rel), 'utf8').replace(/\r\n/g, '\n'); }

function balanced(text: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) return text.slice(openIdx, i + 1); }
  }
  throw new Error('unbalanced');
}

interface InsertSite { file: string; index: number; asAny: boolean; argText: string; src: string }
function findInserts(file: string, src: string): InsertSite[] {
  const sites: InsertSite[] = [];
  const re = /\.from\(\s*'notification_failures'( as any)?\s*\)\s*\.insert\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    sites.push({ file, index: m.index, asAny: !!m[1], argText: balanced(src, open).slice(1, -1), src });
  }
  return sites;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function evalLiteral(literal: string, scope: Record<string, any>): any {
  return new Function(...Object.keys(scope), `return (${literal});`)(...Object.values(scope));
}

(async () => {
  // The service modules import the browser Supabase client at load time.
  (globalThis as any).window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { origin: 'https://site.test' } };
  const realConsoleError = console.error;
  console.error = () => {};
  const approval = await import('../../orders/orderApprovalService');
  const editNotif = await import('../../notifications/orderNotificationService');
  const { supabase } = await import('../../supabase');
  console.error = realConsoleError;

  // ---------------------------------------------------------------------------
  // orderApprovalService: executed
  // ---------------------------------------------------------------------------
  const LINK_FAIL = async () => ({ success: false as const, error: 'link boom' });
  const LINK_OK = async () => ({ success: true as const, url: 'https://site.test/i/ab', shortCode: 'ab' });
  const order = (customers: any) => ({ id: 'ord-1', event_date: '2026-07-04', customers, order_items: [], addresses: {} }) as never;
  const both = { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.test', phone: '+15555550101' };

  for (const behavior of ['ok', 'returns-error', 'throws'] as InsertBehavior[]) {
    const rec: Recorder = { inserts: [], tables: [] };
    const sendEmailFn = async () => { throw new Error('should not send'); };
    const { value: res, errors } = await captureErrors(() =>
      approval.sendApprovalConfirmationNotifications(order(both), 0, async () => true, { createLink: LINK_FAIL as any, sendEmailFn: sendEmailFn as any, supabaseClient: fakeSb(behavior, rec) as any } as any));
    const rows = rec.inserts.filter(i => i.table === 'notification_failures').flatMap(i => i.payload);
    eq(`confirmation link failure (${behavior}): two rows, email then sms`, rows.length, 2);
    rowIsContractShaped(rows[0], { type: 'email', recipient: both.email, subject: 'Booking confirmation not sent', error: 'link boom', context: { orderId: 'ord-1', messageType: 'booking_confirmation', source: 'orderApprovalService' } }, `confirmation email row (${behavior})`);
    rowIsContractShaped(rows[1], { type: 'sms', recipient: both.phone, subject: 'Booking confirmation not sent', error: 'link boom', context: { orderId: 'ord-1', messageType: 'booking_confirmation', source: 'orderApprovalService' } }, `confirmation sms row (${behavior})`);
    ok(`confirmation (${behavior}): inserted as one batch`, rec.inserts.filter(i => i.table === 'notification_failures').length === 1);
    ok(`confirmation (${behavior}): result semantics unchanged`, res.emailSent === false && res.smsSent === false && res.errors.length === 1 && res.errors[0] === 'link boom');
    ok(`confirmation (${behavior}): ${behavior === 'ok' ? 'no logging-failure console error' : 'insert problem is console-logged'}`, behavior === 'ok' ? !errors.some(e => String(e[0]).includes('Failed to log notification failure')) : errors.some(e => String(e[0]).includes('Failed to log notification failure')));
    ok(`confirmation (${behavior}): no record_notification_failure RPC`, !rec.tables.includes('record_notification_failure'));
  }

  {
    const rec: Recorder = { inserts: [], tables: [] };
    await captureErrors(() => approval.sendApprovalConfirmationNotifications(order({ ...both, phone: '   ' }), 0, async () => true, { createLink: LINK_FAIL as any, supabaseClient: fakeSb('ok', rec) as any } as any));
    const rows = rec.inserts.filter(i => i.table === 'notification_failures').flatMap(i => i.payload);
    eq('confirmation: blank phone -> email row only', rows.map((r: any) => r.notification_type), ['email']);
    const rec2: Recorder = { inserts: [], tables: [] };
    await captureErrors(() => approval.sendApprovalConfirmationNotifications(order({ ...both, email: '' }), 0, async () => true, { createLink: LINK_FAIL as any, supabaseClient: fakeSb('ok', rec2) as any } as any));
    eq('confirmation: no email -> sms row only', rec2.inserts.filter(i => i.table === 'notification_failures').flatMap(i => i.payload).map((r: any) => r.notification_type), ['sms']);
    const rec3: Recorder = { inserts: [], tables: [] };
    const r3 = await captureErrors(() => approval.sendApprovalConfirmationNotifications(order({ ...both, email: null, phone: null }), 0, async () => true, { createLink: LINK_FAIL as any, supabaseClient: fakeSb('ok', rec3) as any } as any));
    eq('confirmation: neither contact -> no rows and no link attempt side effects', rec3.inserts.length, 0);
    ok('confirmation: neither contact keeps its own error', r3.value.errors[0] === 'No customer email address or phone number was available.');
  }

  for (const behavior of ['ok', 'returns-error', 'throws'] as InsertBehavior[]) {
    const rec: Recorder = { inserts: [], tables: [] };
    const { value: res, errors } = await captureErrors(() =>
      approval.sendCardDeclinedNotifications(order(both), 'ord-9', async () => true, { createLink: LINK_FAIL as any, supabaseClient: fakeSb(behavior, rec) as any } as any));
    const rows = rec.inserts.filter(i => i.table === 'notification_failures').flatMap(i => i.payload);
    eq(`declined link failure (${behavior}): two rows`, rows.length, 2);
    rowIsContractShaped(rows[0], { type: 'email', recipient: both.email, subject: 'Payment declined notification not sent', error: 'link boom', context: { orderId: 'ord-9', messageType: 'card_declined', source: 'orderApprovalService' } }, `declined email row (${behavior})`);
    rowIsContractShaped(rows[1], { type: 'sms', recipient: both.phone, subject: 'Payment declined notification not sent', error: 'link boom', context: { orderId: 'ord-9', messageType: 'card_declined', source: 'orderApprovalService' } }, `declined sms row (${behavior})`);
    ok(`declined (${behavior}): result semantics unchanged`, res.emailSent === false && res.smsSent === false && res.errors[0] === 'link boom');
    ok(`declined (${behavior}): ${behavior === 'ok' ? 'quiet' : 'console-logged'}`, behavior === 'ok' ? !errors.some(e => String(e[0]).includes('Failed to log notification failure')) : errors.some(e => String(e[0]).includes('Failed to log notification failure')));
  }
  {
    const rec: Recorder = { inserts: [], tables: [] };
    await captureErrors(() => approval.sendCardDeclinedNotifications(order({ ...both, phone: '' }), 'ord-9', async () => true, { createLink: LINK_FAIL as any, supabaseClient: fakeSb('ok', rec) as any } as any));
    eq('declined: no phone -> email row only', rec.inserts.filter(i => i.table === 'notification_failures').flatMap(i => i.payload).map((r: any) => r.notification_type), ['email']);
  }

  // Duplicate suppression: provider send failures never insert client-side.
  {
    const rec: Recorder = { inserts: [], tables: [] };
    const res = await captureErrors(() => approval.sendApprovalConfirmationNotifications(order(both), 0, async () => false, {
      createLink: LINK_OK as any, sendEmailFn: (async () => { throw new Error('email provider down'); }) as any, supabaseClient: fakeSb('ok', rec) as any } as any));
    eq('confirmation: email throw + sms false -> no notification_failures insert', rec.inserts.filter(i => i.table === 'notification_failures').length, 0);
    ok('confirmation: email-throw semantics preserved', res.value.emailSent === false && res.value.errors.includes('Email: email provider down'));
    ok('confirmation: sms-false semantics preserved', res.value.smsSent === false && res.value.errors.includes('SMS: send returned false'));
    const rec2: Recorder = { inserts: [], tables: [] };
    const res2 = await captureErrors(() => approval.sendApprovalConfirmationNotifications(order(both), 0, async () => { throw new Error('sms boom'); }, {
      createLink: LINK_OK as any, sendEmailFn: (async () => undefined) as any, supabaseClient: fakeSb('ok', rec2) as any } as any));
    eq('confirmation: sms throw -> no insert', rec2.inserts.filter(i => i.table === 'notification_failures').length, 0);
    ok('confirmation: sms-throw semantics preserved', res2.value.smsSent === false && res2.value.errors.includes('SMS: sms boom'));
    const rec3: Recorder = { inserts: [], tables: [] };
    const res3 = await captureErrors(() => approval.sendCardDeclinedNotifications(order(both), 'ord-9', async () => false, {
      createLink: LINK_OK as any, sendEmailFn: (async () => { throw new Error('email down'); }) as any, supabaseClient: fakeSb('ok', rec3) as any } as any));
    eq('declined: email throw + sms false -> no insert', rec3.inserts.filter(i => i.table === 'notification_failures').length, 0);
    ok('declined: result semantics preserved', res3.value.errors.includes('Email: email down') && res3.value.errors.includes('SMS: send returned false') && res3.value.smsSent === false);
    const rec4: Recorder = { inserts: [], tables: [] };
    const res4 = await captureErrors(() => approval.sendCardDeclinedNotifications(order(both), 'ord-9', async () => { throw new Error('sms boom'); }, {
      createLink: LINK_OK as any, sendEmailFn: (async () => undefined) as any, supabaseClient: fakeSb('ok', rec4) as any } as any));
    eq('declined: sms throw -> no insert', rec4.inserts.filter(i => i.table === 'notification_failures').length, 0);
    ok('declined: sms-throw semantics preserved', res4.value.errors.includes('SMS: sms boom'));
  }

  // ---------------------------------------------------------------------------
  // orderNotificationService.sendOrderEditNotifications: executed against the real client object,
  // whose rpc/from are replaced by recorders for the duration of each case.
  // ---------------------------------------------------------------------------
  async function runOrderEdit(customers: any, behavior: InsertBehavior) {
    const rec: Recorder = { inserts: [], tables: [] };
    const fake = fakeSb(behavior, rec);
    const sb: any = supabase;
    const saved = { rpc: sb.rpc, from: sb.from };
    sb.rpc = async (name: string) => { rec.tables.push('rpc:' + name); return { data: null, error: { message: 'link boom' } }; };
    // A2.1: the secure portal link now comes from the portal-link Edge Function.
    Object.defineProperty(sb, 'functions', { configurable: true, value: { invoke: async (name: string) => { rec.tables.push('fn:' + name); return { data: null, error: { message: 'link boom' } }; } } });
    sb.from = (t: string) => fake.from(t);
    try {
      const out = await captureErrors(() => editNotif.sendOrderEditNotifications({ order: { id: 'ord-5', event_date: '2026-07-04', customers }, adminMessage: '' }));
      return { rec, errors: out.errors };
    } finally { sb.rpc = saved.rpc; sb.from = saved.from; delete sb.functions; }
  }
  for (const behavior of ['ok', 'returns-error', 'throws'] as InsertBehavior[]) {
    const { rec, errors } = await runOrderEdit({ first_name: 'Ann', email: both.email, phone: both.phone }, behavior);
    const batches = rec.inserts.filter(i => i.table === 'notification_failures');
    const rows = batches.flatMap(i => i.payload);
    eq(`order edit link failure (${behavior}): email + sms rows`, rows.map((r: any) => r.notification_type), ['email', 'sms']);
    const ctx = { orderId: 'ord-5', messageType: 'order_edit', source: 'orderNotificationService' };
    rowIsContractShaped(rows[0], { type: 'email', recipient: both.email, subject: 'Order update notification not sent', error: 'link boom', context: ctx }, `order edit email (${behavior})`);
    rowIsContractShaped(rows[1], { type: 'sms', recipient: both.phone, subject: 'Order update notification not sent', error: 'link boom', context: ctx }, `order edit sms (${behavior})`);
    ok(`order edit (${behavior}): ${behavior === 'ok' ? 'quiet' : 'insert problem console-logged, no throw'}`, behavior === 'ok' ? !errors.some(e => String(e[0]).includes('Failed to log')) : errors.some(e => String(e[0]).includes('Failed to log notification failure')));
  }
  {
    const a = await runOrderEdit({ first_name: 'A', email: 'a@x.test', phone: '' }, 'ok');
    eq('order edit: no phone -> email row only', a.rec.inserts.flatMap(i => i.payload).map((r: any) => r.notification_type), ['email']);
    const b = await runOrderEdit({ first_name: 'A', email: '  ', phone: '+1555' }, 'ok');
    eq('order edit: blank email -> sms row only', b.rec.inserts.flatMap(i => i.payload).map((r: any) => r.notification_type), ['sms']);
    const a2 = await runOrderEdit({ first_name: 'A', email: 'a@x.test', phone: '   ' }, 'ok');
    eq('order edit: whitespace-only phone -> email row only', a2.rec.inserts.flatMap(i => i.payload).map((r: any) => r.notification_type), ['email']);
    const c = await runOrderEdit({ first_name: 'A' }, 'ok');
    eq('order edit: neither -> no insert at all', c.rec.inserts.length, 0);
  }

  // ---------------------------------------------------------------------------
  // Source inventory across the repo
  // ---------------------------------------------------------------------------
  const allSites: InsertSite[] = [];
  for (const f of walk('src')) allSites.push(...findInserts(f.replace(/\\/g, '/'), fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')));
  eq('repo has exactly 6 direct notification_failures inserts', allSites.length, 6);
  eq('inserts per file', Object.fromEntries(Object.entries(allSites.reduce((m: Record<string, number>, s) => { m[s.file] = (m[s.file] || 0) + 1; return m; }, {})).sort()), {
    'src/components/admin/orders/PendingOrderCard.tsx': 1, 'src/components/admin/tasks/TaskDetailModal.tsx': 2,
    'src/lib/orders/orderApprovalService.ts': 2, 'src/lib/notifications/orderNotificationService.ts': 1,
  });
  ok('no insert casts the table name to any', allSites.every(s => !s.asAny));
  ok('no insert payload names a stale column', allSites.every(s => !/\border_id\b|\bchannel\b|\bmessage_type\b|\bcreated_at\b/.test(s.argText)));
  ok('no insert is wrapped in `as any`', !/notification_failures'\s+as any/.test(allSites.map(s => s.src).join('\n')));
  ok('no client code calls the RPC for these failures', allSites.every(s => !/record_notification_failure/.test(s.src)));

  // ---------------------------------------------------------------------------
  // TaskDetailModal (source characterization with stub values)
  // ---------------------------------------------------------------------------
  const td = readSrc('components/admin/tasks/TaskDetailModal.tsx');
  const tdSites = findInserts('TaskDetailModal.tsx', td);
  const task = { orderId: 'ord-7', customerPhone: '+15555550177' };
  eq('TaskDetailModal En Route row', evalLiteral(tdSites[0].argText, { task, enRouteDecision: { failureRecord: { error: 'link boom' } } }), {
    notification_type: 'sms', intended_recipient: '+15555550177', subject: 'En Route notification not sent',
    error_message: 'link boom', context: { orderId: 'ord-7', messageType: 'en_route_action_required', source: 'TaskDetailModal' },
  });
  eq('TaskDetailModal Arrived row', evalLiteral(tdSites[1].argText, { task, arrivedDecision: { failureRecord: { error: 'link boom' } } }), {
    notification_type: 'sms', intended_recipient: '+15555550177', subject: 'Arrived notification not sent',
    error_message: 'link boom', context: { orderId: 'ord-7', messageType: 'arrived_action_required', source: 'TaskDetailModal' },
  });
  ok('TaskDetailModal: both inserts only run when a phone exists', tdSites.every(s => /task\.customerPhone\?\.trim\(\)/.test(td.slice(Math.max(0, s.index - 260), s.index))));
  ok('TaskDetailModal: En Route insert is inside the link-failure branch (before the SMS-sent decision)', tdSites[0].index < td.indexOf('const smsSentSuccessfully'));
  ok('TaskDetailModal: Arrived insert is inside the link-failure branch (before the status writes)', tdSites[1].index < td.indexOf("status: 'arrived'"));
  ok('TaskDetailModal: no insert between the En Route SMS result and the status write (duplicate provider-failure row removed)', !td.slice(td.indexOf('const smsSentSuccessfully'), td.indexOf("status: 'en_route'")).includes('notification_failures'));
  ok('TaskDetailModal: no insert between the Arrived SMS send and the status write (duplicate provider-failure row removed)', !td.slice(td.indexOf("const sms = await postTaskSms({ to: task.customerPhone, message: msg, orderId: task.orderId }, 'Arrived')"), td.indexOf("status: 'arrived'")).includes('notification_failures'));
  ok('TaskDetailModal: returned insert errors are logged', (td.match(/if \(logError\) console\.error\('\[TaskDetailModal\] Failed to log notification failure:', logError\)/g) || []).length === 2);
  ok('TaskDetailModal: workflow strings untouched', td.includes("smsWarning = 'Customer notification failed: unable to create portal link'") && td.includes("smsWarn = 'Customer notification failed: unable to create portal link'"));

  // ---------------------------------------------------------------------------
  // PendingOrderCard
  // ---------------------------------------------------------------------------
  const poc = readSrc('components/admin/orders/PendingOrderCard.tsx');
  const pocSite = findInserts('PendingOrderCard.tsx', poc)[0];
  eq('PendingOrderCard row', evalLiteral(pocSite.argText, { order: { id: 'ord-3', customers: { phone: '+15555550133' } }, decision: { failureRecord: { error: 'link boom' } } }), {
    notification_type: 'sms', intended_recipient: '+15555550133', subject: 'Lot pictures request not sent',
    error_message: 'link boom', context: { orderId: 'ord-3', messageType: 'lot_pictures_request', source: 'PendingOrderCard' },
  });
  const pocGuard = poc.slice(Math.max(0, pocSite.index - 200), pocSite.index);
  ok('PendingOrderCard: row only when the short link failed (SMS-only failure writes nothing)', /!portalLinkResult\.success && order\.customers\?\.phone\?\.trim\(\)/.test(pocGuard));
  ok('PendingOrderCard: user-facing failure alert and return are unchanged', /alert\('Failed to send request\. Please try again\.'\);\s*return;/.test(poc.slice(pocSite.index)));
  ok('PendingOrderCard: returned insert error is logged', poc.includes("if (logError) console.error('[PendingOrderCard] Failed to log notification failure:', logError)"));

  // ---------------------------------------------------------------------------
  // InvoiceAcceptanceView (Customer Portal, A2.2): customers no longer write notification_failures from the browser;
  // the notification Edge Functions record provider failures themselves.
  // ---------------------------------------------------------------------------
  ok('InvoiceAcceptanceView has no direct notification_failures insert', !readSrc('components/customer-portal/InvoiceAcceptanceView.tsx').includes('notification_failures'));

  // ---------------------------------------------------------------------------
  // Reader compatibility and untouched writers
  // ---------------------------------------------------------------------------
  const alertSrc = readSrc('components/admin/settings/NotificationFailuresAlert.tsx');
  for (const field of ['notification_type', 'intended_recipient', 'subject', 'message_preview', 'error_message', 'created_at']) {
    ok(`reader still reads ${field}`, alertSrc.includes(`failure.${field}`));
  }
  const repaired = { notification_type: 'sms', intended_recipient: '+15555550101', subject: 'Order update notification not sent', error_message: 'link boom', context: {} };
  ok('repaired rows carry every field the reader displays (created_at comes from the DB default)', ['notification_type', 'intended_recipient', 'subject', 'error_message'].every(k => (repaired as any)[k]));
  const edgeSms = fs.readFileSync('supabase/functions/send-sms-notification/index.ts', 'utf8');
  ok('edge function RPC writers are untouched (still record via record_notification_failure)', (edgeSms.match(/record_notification_failure/g) || []).length === 4);

  console.log(`Notification failure logging tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} notification failure logging test(s) failed`);
})();
