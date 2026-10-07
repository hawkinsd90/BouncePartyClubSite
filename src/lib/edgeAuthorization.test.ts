// Tests for the shared Edge Function authorization helpers (supabase/functions/_shared/auth.ts).
//
// The helper has no imports, so it is loaded directly. Clients and the Stripe session lookup are fakes.
// Nothing here talks to a network or a database.

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  normalizeRole,
  getBearerToken,
  timingSafeEqualStrings,
  resolveCaller,
  callerHasAnyRole,
  isStaffAdmin,
  requireRoles,
  validateOrderToken,
  userOwnsOrder,
  sessionBoundToOrder,
  sessionCustomerId,
  proveOrderAccess,
  authFailureResponse,
  isFreshBookingDraft,
  FRESH_BOOKING_DRAFT_WINDOW_MS,
  INVOICE_SENDER_ROLES,
  STAFF_ADMIN_ROLES,
  type Caller,
} from '../../supabase/functions/_shared/auth';
import { deriveCustomerOutcome, UNVERIFIED_CUSTOMER_OUTCOME } from '../../supabase/functions/_shared/lifecycle-outcome';

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

const SERVICE_KEY = 'service-key-value-0123456789';
const ANON_KEY = 'anon-key-value-0123456789';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

// ---- fake service-role client ----
interface World {
  users: Record<string, string>; // access token -> user id
  roles: Record<string, string[]>; // user id -> role rows
  links: Array<{ link_token: string; order_id: string; expires_at: string | null; link_type?: string; revoked_at?: string | null }>;
  orders: Array<{ id: string; customer_id: string | null }>;
  customers: Array<{ id: string; user_id: string | null }>;
  failRoles?: boolean;
  throwOnGetUser?: boolean;
}
function makeClient(w: World): any {
  const query = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const api: any = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      maybeSingle: async () => {
        const rows = rowsOf(table).filter((r: any) => filters.every(([c, v]) => r[c] === v));
        // PostgREST maybeSingle() errors when more than one row matches.
        if (rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
        return { data: rows[0] ?? null, error: null };
      },
      then: (resolve: any) => {
        if (table === 'user_roles' && w.failRoles) return resolve({ data: null, error: { message: 'x' } });
        const rows = rowsOf(table).filter((r: any) => filters.every(([c, v]) => r[c] === v));
        return resolve({ data: rows, error: null });
      },
    };
    return api;
  };
  const rowsOf = (table: string): any[] => {
    if (table === 'user_roles') return Object.entries(w.roles).flatMap(([uid, rs]) => rs.map((role) => ({ user_id: uid, role })));
    if (table === 'invoice_links') return w.links;
    if (table === 'orders') return w.orders;
    if (table === 'customers') return w.customers;
    return [];
  };
  return {
    auth: {
      getUser: async (token: string) => {
        if (w.throwOnGetUser) throw new Error('boom');
        const id = w.users[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
      },
    },
    from: (table: string) => query(table),
  };
}

const world = (): World => ({
  users: { 'tok-admin': 'u-admin', 'tok-master': 'u-master', 'tok-crew': 'u-crew', 'tok-cust': 'u-cust', 'tok-upper': 'u-upper', 'tok-multi': 'u-multi', 'tok-norole': 'u-norole' },
  roles: { 'u-admin': ['admin'], 'u-master': ['master'], 'u-crew': ['crew'], 'u-cust': ['customer'], 'u-upper': ['ADMIN'], 'u-multi': ['customer', 'Master'] },
  links: [
    { link_token: 'A'.repeat(64), order_id: 'order-A', link_type: 'invoice', expires_at: FUTURE },
    { link_token: 'B'.repeat(64), order_id: 'order-B', link_type: 'invoice', expires_at: FUTURE },
    { link_token: 'E'.repeat(64), order_id: 'order-A', link_type: 'invoice', expires_at: PAST },
    { link_token: 'N'.repeat(64), order_id: 'order-A', link_type: 'invoice', expires_at: null },
  ],
  orders: [{ id: 'order-A', customer_id: 'cust-A' }, { id: 'order-B', customer_id: 'cust-B' }, { id: 'order-X', customer_id: null }],
  customers: [{ id: 'cust-A', user_id: 'u-cust' }, { id: 'cust-B', user_id: 'u-other' }],
});

(async () => {
  // ---- small helpers ----
  eq('normalizeRole lowercases and trims', normalizeRole('  MASTER '), 'master');
  eq('normalizeRole of non-string is empty', normalizeRole(null), '');
  eq('getBearerToken strips the scheme', getBearerToken('Bearer abc'), 'abc');
  eq('getBearerToken is case-insensitive', getBearerToken('bearer abc'), 'abc');
  eq('getBearerToken of missing header is empty', getBearerToken(null), '');
  ok('timingSafeEqualStrings equal', timingSafeEqualStrings('abc', 'abc'));
  ok('timingSafeEqualStrings different', !timingSafeEqualStrings('abc', 'abd'));
  ok('timingSafeEqualStrings different length', !timingSafeEqualStrings('abc', 'abcd'));

  // ---- resolveCaller ----
  const c = makeClient(world());
  eq('no header is anonymous', await resolveCaller(c, null, SERVICE_KEY), { kind: 'anonymous' });
  eq('empty bearer is anonymous', await resolveCaller(c, 'Bearer ', SERVICE_KEY), { kind: 'anonymous' });
  eq('the public anon key is NOT a user', await resolveCaller(c, `Bearer ${ANON_KEY}`, SERVICE_KEY), { kind: 'anonymous' });
  eq('the service key is the service caller', await resolveCaller(c, `Bearer ${SERVICE_KEY}`, SERVICE_KEY), { kind: 'service' });
  eq('a service-looking token without the env key is not service', await resolveCaller(c, `Bearer ${SERVICE_KEY}`, undefined), { kind: 'anonymous' });
  eq('a near-miss service key is not service', await resolveCaller(c, `Bearer ${SERVICE_KEY}x`, SERVICE_KEY), { kind: 'anonymous' });
  eq('admin user resolves with lowercase roles', await resolveCaller(c, 'Bearer tok-admin', SERVICE_KEY), { kind: 'user', userId: 'u-admin', roles: ['admin'] });
  eq('uppercase role rows are normalized', await resolveCaller(c, 'Bearer tok-upper', SERVICE_KEY), { kind: 'user', userId: 'u-upper', roles: ['admin'] });
  eq('multiple role rows are all kept', await resolveCaller(c, 'Bearer tok-multi', SERVICE_KEY), { kind: 'user', userId: 'u-multi', roles: ['customer', 'master'] });
  eq('a user with no role rows has no roles', await resolveCaller(c, 'Bearer tok-norole', SERVICE_KEY), { kind: 'user', userId: 'u-norole', roles: [] });
  eq('a getUser exception is anonymous', await resolveCaller(makeClient({ ...world(), throwOnGetUser: true }), 'Bearer tok-admin', SERVICE_KEY), { kind: 'anonymous' });
  eq('a role-lookup failure leaves a user with no roles (fails closed)', await resolveCaller(makeClient({ ...world(), failRoles: true }), 'Bearer tok-admin', SERVICE_KEY), { kind: 'user', userId: 'u-admin', roles: [] });

  const throwingRoles: any = makeClient(world());
  const baseFrom = throwingRoles.from;
  throwingRoles.from = (table: string) => {
    if (table === 'user_roles') throw new Error('roles table exploded');
    return baseFrom(table);
  };
  eq('a throwing role lookup leaves a user with no roles (fails closed)', await resolveCaller(throwingRoles, 'Bearer tok-admin', SERVICE_KEY), { kind: 'user', userId: 'u-admin', roles: [] });

  // ---- role gates ----
  const caller = async (t: string): Promise<Caller> => resolveCaller(c, `Bearer ${t}`, SERVICE_KEY);
  ok('admin is staff admin', isStaffAdmin(await caller('tok-admin')));
  ok('master is staff admin', isStaffAdmin(await caller('tok-master')));
  ok('uppercase ADMIN row is staff admin', isStaffAdmin(await caller('tok-upper')));
  ok('master among several roles is staff admin', isStaffAdmin(await caller('tok-multi')));
  ok('crew is NOT staff admin', !isStaffAdmin(await caller('tok-crew')));
  ok('customer is NOT staff admin', !isStaffAdmin(await caller('tok-cust')));
  ok('no-role user is NOT staff admin', !isStaffAdmin(await caller('tok-norole')));
  ok('anonymous is NOT staff admin', !isStaffAdmin({ kind: 'anonymous' }));
  ok('service is not a user role holder', !isStaffAdmin({ kind: 'service' }));
  ok('crew passes a crew-inclusive gate', callerHasAnyRole(await caller('tok-crew'), ['master', 'admin', 'crew']));

  eq('requireRoles: anonymous is 401', requireRoles({ kind: 'anonymous' }, ['admin', 'master']), { ok: false, status: 401, error: 'Unauthorized' });
  eq('requireRoles: customer is 403', requireRoles(await caller('tok-cust'), ['admin', 'master']), { ok: false, status: 403, error: 'Forbidden' });
  eq('requireRoles: crew is 403 for admin-only', requireRoles(await caller('tok-crew'), ['admin', 'master']), { ok: false, status: 403, error: 'Forbidden' });
  eq('requireRoles: service is not accepted as a user', requireRoles({ kind: 'service' }, ['admin', 'master']), { ok: false, status: 403, error: 'Forbidden' });
  eq('requireRoles: admin passes', requireRoles(await caller('tok-admin'), ['admin', 'master']), { ok: true, userId: 'u-admin' });
  eq('requireRoles: custom messages', requireRoles({ kind: 'anonymous' }, ['admin'], { unauthorized: 'no' }), { ok: false, status: 401, error: 'no' });

  // ---- invoice link token binding ----
  ok('valid token for the exact order passes', await validateOrderToken(c, 'order-A', 'A'.repeat(64)));
  ok('token for order B does NOT authorize order A', !(await validateOrderToken(c, 'order-A', 'B'.repeat(64))));
  ok('token for order A does NOT authorize order B', !(await validateOrderToken(c, 'order-B', 'A'.repeat(64))));
  ok('expired token fails', !(await validateOrderToken(c, 'order-A', 'E'.repeat(64))));
  ok('token with null expiry fails', !(await validateOrderToken(c, 'order-A', 'N'.repeat(64))));
  ok('unknown token fails', !(await validateOrderToken(c, 'order-A', 'Z'.repeat(64))));
  ok('empty token fails', !(await validateOrderToken(c, 'order-A', '')));
  ok('non-string token fails', !(await validateOrderToken(c, 'order-A', 12345)));
  ok('short token fails without a lookup', !(await validateOrderToken(c, 'order-A', 'short')));
  ok('empty order id fails', !(await validateOrderToken(c, '', 'A'.repeat(64))));
  ok('a throwing client fails closed', !(await validateOrderToken({ from: () => { throw new Error('x'); } }, 'order-A', 'A'.repeat(64))));
  ok('now is injectable (a token valid now is expired later)', !(await validateOrderToken(c, 'order-A', 'A'.repeat(64), new Date(Date.now() + 2 * 86_400_000))));

  // ---- ownership ----
  ok('owner of order A is recognized', await userOwnsOrder(c, 'u-cust', 'order-A'));
  ok('owner of order A does NOT own order B', !(await userOwnsOrder(c, 'u-cust', 'order-B')));
  ok('another user does not own order A', !(await userOwnsOrder(c, 'u-other', 'order-A')));
  ok('order with no customer is owned by nobody', !(await userOwnsOrder(c, 'u-cust', 'order-X')));
  ok('unknown order is owned by nobody', !(await userOwnsOrder(c, 'u-cust', 'order-missing')));
  ok('empty ids are not ownership', !(await userOwnsOrder(c, '', 'order-A')) && !(await userOwnsOrder(c, 'u-cust', '')));

  // ---- Stripe session binding ----
  const setupA = { status: 'complete', mode: 'setup', metadata: { order_id: 'order-A' }, customer: 'cus_1' };
  ok('complete setup session for the exact order passes', sessionBoundToOrder(setupA, 'order-A'));
  ok('session for order A does NOT bind order B', !sessionBoundToOrder(setupA, 'order-B'));
  ok('open (incomplete) session fails', !sessionBoundToOrder({ ...setupA, status: 'open' }, 'order-A'));
  ok('expired session fails', !sessionBoundToOrder({ ...setupA, status: 'expired' }, 'order-A'));
  ok('session without metadata fails', !sessionBoundToOrder({ status: 'complete', mode: 'setup' }, 'order-A'));
  ok('session with empty order metadata fails', !sessionBoundToOrder({ status: 'complete', mode: 'setup', metadata: { order_id: '' } }, 'order-A'));
  ok('null session fails', !sessionBoundToOrder(null, 'order-A'));
  ok('mode restriction is enforced', !sessionBoundToOrder(setupA, 'order-A', { modes: ['payment'] }));
  ok('mode restriction allows the right mode', sessionBoundToOrder(setupA, 'order-A', { modes: ['setup'] }));
  ok('an unpaid payment-mode session fails', !sessionBoundToOrder({ status: 'complete', mode: 'payment', payment_status: 'unpaid', metadata: { order_id: 'order-A' } }, 'order-A'));
  ok('a paid payment-mode session passes', sessionBoundToOrder({ status: 'complete', mode: 'payment', payment_status: 'paid', metadata: { order_id: 'order-A' } }, 'order-A'));
  eq('session customer id (string)', sessionCustomerId(setupA), 'cus_1');
  eq('session customer id (object)', sessionCustomerId({ customer: { id: 'cus_2' } }), 'cus_2');
  eq('session customer id (none)', sessionCustomerId({ customer: null }), null);

  // ---- proveOrderAccess ----
  const sessions: Record<string, any> = { sess_A: setupA, sess_B: { ...setupA, metadata: { order_id: 'order-B' } }, sess_open: { ...setupA, status: 'open' } };
  const retrieve = async (id: string) => {
    if (id === 'sess_throw') throw new Error('stripe down');
    return sessions[id] ?? null;
  };
  const anon: Caller = { kind: 'anonymous' };
  const cust = await caller('tok-cust');
  const crew = await caller('tok-crew');

  eq('token proof', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, token: 'A'.repeat(64) }), 'token');
  eq('Order A token cannot prove Order B', await proveOrderAccess(c, { orderId: 'order-B', caller: anon, token: 'A'.repeat(64) }), null);
  eq('owner proof', await proveOrderAccess(c, { orderId: 'order-A', caller: cust }), 'owner');
  eq('owner of A cannot prove B', await proveOrderAccess(c, { orderId: 'order-B', caller: cust }), null);
  eq('session proof', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, sessionId: 'sess_A', retrieveCheckoutSession: retrieve }), 'stripe_session');
  eq('Session for A cannot prove B (cross-order)', await proveOrderAccess(c, { orderId: 'order-B', caller: anon, sessionId: 'sess_A', retrieveCheckoutSession: retrieve }), null);
  eq('open session is not proof', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, sessionId: 'sess_open', retrieveCheckoutSession: retrieve }), null);
  eq('unknown session is not proof', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, sessionId: 'sess_nope', retrieveCheckoutSession: retrieve }), null);
  eq('a throwing Stripe lookup is not proof (fails closed)', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, sessionId: 'sess_throw', retrieveCheckoutSession: retrieve }), null);
  eq('session proof without a lookup function is not proof', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, sessionId: 'sess_A' }), null);
  eq('anonymous with no proof at all gets nothing', await proveOrderAccess(c, { orderId: 'order-A', caller: anon }), null);
  eq('crew with no proof gets nothing', await proveOrderAccess(c, { orderId: 'order-A', caller: crew }), null);
  eq('accept list is honored (token not accepted)', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, token: 'A'.repeat(64), accept: ['stripe_session'] }), null);
  eq('accept list is honored (session only)', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, token: 'A'.repeat(64), sessionId: 'sess_A', retrieveCheckoutSession: retrieve, accept: ['stripe_session'] }), 'stripe_session');
  eq('a bad token falls through to a good session', await proveOrderAccess(c, { orderId: 'order-A', caller: anon, token: 'Z'.repeat(64), sessionId: 'sess_A', retrieveCheckoutSession: retrieve }), 'stripe_session');
  eq('service caller is not an owner', await proveOrderAccess(c, { orderId: 'order-A', caller: { kind: 'service' } }), null);

  // ---- fresh public booking draft (the only anonymous path to start card setup) ----
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  const draftWorld = (orders: any[], links: any[] = []): any => ({ ...world(), orders, links });
  const mkDraft = (over: Record<string, unknown> = {}) => ({ id: 'o-fresh', status: 'draft', created_at: iso(10 * 60_000), stripe_customer_id: null, stripe_payment_method_id: null, customer_id: null, ...over });
  const fresh = (orders: any[], links: any[] = [], id = 'o-fresh', opts: any = {}) => isFreshBookingDraft(makeClient(draftWorld(orders, links)), id, opts);

  ok('fresh draft: an untouched recent booking draft qualifies', await fresh([mkDraft()]));
  ok('fresh draft: unknown order does not', !(await fresh([mkDraft()], [], 'o-missing')));
  ok('fresh draft: non-string / empty id does not', !(await fresh([mkDraft()], [], '' as any)) && !(await isFreshBookingDraft(makeClient(draftWorld([mkDraft()])), 42 as any)));
  for (const status of ['pending_review', 'awaiting_customer_approval', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void']) {
    ok(`fresh draft: a ${status} order does not qualify`, !(await fresh([mkDraft({ status })])));
  }
  ok('fresh draft: a Stripe customer already attached disqualifies (single use)', !(await fresh([mkDraft({ stripe_customer_id: 'cus_1' })])));
  ok('fresh draft: a payment method already attached disqualifies', !(await fresh([mkDraft({ stripe_payment_method_id: 'pm_1' })])));
  ok('fresh draft: 1h59m old still qualifies', await fresh([mkDraft({ created_at: iso(119 * 60_000) })]));
  ok('fresh draft: 2h01m old does not', !(await fresh([mkDraft({ created_at: iso(121 * 60_000) })])));
  ok('fresh draft: a custom window is honored', !(await fresh([mkDraft({ created_at: iso(10 * 60_000) })], [], 'o-fresh', { windowMs: 5 * 60_000 })));
  ok('fresh draft: a future-dated created_at does not qualify', !(await fresh([mkDraft({ created_at: new Date(Date.now() + 3_600_000).toISOString() })])));
  ok('fresh draft: a missing created_at does not qualify', !(await fresh([mkDraft({ created_at: null })])));
  ok('fresh draft: an unparseable created_at does not qualify', !(await fresh([mkDraft({ created_at: 'not a date' })])));
  ok('fresh draft: an admin-created invoice draft does not qualify', !(await fresh([mkDraft()], [{ order_id: 'o-fresh', link_type: 'invoice', link_token: 'x'.repeat(64), expires_at: FUTURE }])));
  ok('fresh draft: an ambiguous invoice-link lookup fails closed', !(await fresh([mkDraft()], [
    { order_id: 'o-fresh', link_type: 'invoice', link_token: 'x'.repeat(64), expires_at: FUTURE },
    { order_id: 'o-fresh', link_type: 'invoice', link_token: 'y'.repeat(64), expires_at: FUTURE },
  ])));
  ok('fresh draft: a non-invoice link type does not block', await fresh([mkDraft()], [{ order_id: 'o-fresh', link_type: 'portal_shortlink', link_token: 'x'.repeat(64), expires_at: FUTURE }]));
  ok('fresh draft: a throwing client fails closed', !(await isFreshBookingDraft({ from: () => { throw new Error('x'); } }, 'o-fresh')));
  eq('fresh draft: the default window is 2 hours', FRESH_BOOKING_DRAFT_WINDOW_MS, 2 * 60 * 60 * 1000);
  eq('invoice senders are admin, master and crew only', INVOICE_SENDER_ROLES, ['admin', 'master', 'crew']);
  eq('staff admins exclude crew', STAFF_ADMIN_ROLES, ['admin', 'master']);
  ok('requireRoles with the invoice-sender list admits crew', requireRoles(await caller('tok-crew'), INVOICE_SENDER_ROLES).ok === true);
  ok('requireRoles with the invoice-sender list admits master and admin', requireRoles(await caller('tok-master'), INVOICE_SENDER_ROLES).ok === true && requireRoles(await caller('tok-admin'), INVOICE_SENDER_ROLES).ok === true);
  ok('requireRoles with the invoice-sender list refuses customers', requireRoles(await caller('tok-cust'), INVOICE_SENDER_ROLES).ok === false);
  ok('requireRoles with the invoice-sender list refuses anonymous', requireRoles({ kind: 'anonymous' }, INVOICE_SENDER_ROLES).ok === false);

  // ---- customer outcome derivation (order-lifecycle) ----
  eq('nothing owed: a claimed waived is kept as the label', deriveCustomerOutcome('waived', 0, 0), 'waived');
  eq('nothing owed: any other claim becomes zero_due_with_card', deriveCustomerOutcome('charged_now', 0, 0), 'zero_due_with_card');
  eq('nothing owed: a null deposit is treated as zero', deriveCustomerOutcome('waived', null, null), 'waived');
  eq('deposit collected exactly: charged_now label kept', deriveCustomerOutcome('charged_now', 5000, 5000), 'charged_now');
  eq('deposit collected exactly: any other claim becomes already_paid', deriveCustomerOutcome('waived', 5000, 5000), 'already_paid');
  eq('deposit over-collected counts as collected', deriveCustomerOutcome('cash', 5000, 7000), 'already_paid');
  eq('one cent short is NOT collected', deriveCustomerOutcome('already_paid', 5000, 4999), UNVERIFIED_CUSTOMER_OUTCOME);
  eq('nothing collected: waived claim is not honored', deriveCustomerOutcome('waived', 5000, 0), UNVERIFIED_CUSTOMER_OUTCOME);
  eq('nothing collected: charged_now claim is not honored', deriveCustomerOutcome('charged_now', 5000, null), UNVERIFIED_CUSTOMER_OUTCOME);
  eq('nothing collected: cash claim is not honored', deriveCustomerOutcome('cash', 5000, 0), UNVERIFIED_CUSTOMER_OUTCOME);
  eq('a non-string claim is ignored', deriveCustomerOutcome(42, 5000, 5000), 'already_paid');
  ok('the unverified outcome is not in the lifecycle bypass list', !['waived', 'already_paid', 'cash', 'charged_now'].includes(UNVERIFIED_CUSTOMER_OUTCOME));

  // ---- failure responses ----
  const r1 = authFailureResponse({ ok: false, status: 403, error: 'Forbidden' }, { 'X-A': '1' });
  eq('failure status', r1.status, 403);
  eq('failure body keeps the success flag shape', await r1.json(), { success: false, error: 'Forbidden' });
  const r2 = authFailureResponse({ ok: false, status: 401, error: 'Unauthorized' }, {}, 'error-only');
  eq('error-only shape', await r2.json(), { error: 'Unauthorized' });
  eq('content type is json', r2.headers.get('Content-Type'), 'application/json');

  console.log(`Edge authorization helper tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} edge authorization helper test(s) failed`);
})();
