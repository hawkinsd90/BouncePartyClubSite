// WP-09 (B8): what the Crew task screens load, show and can call.
//
// Crew cannot read `payments` or `order_signatures` (database policy since the 2026-10 lockdown) and the functions behind Charge
// to Card, Cancel Order and Refund refuse crew. These tests pin the front end to that reality: crew asks only for what it can read,
// shows status derived from the order and from get-waiver-status (summary only), and is never offered an admin-only control.
// PASS - LOCAL AUTOMATED. The full crew script (K-01..K-15) on a Dev crew account is REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { buildCalendarTasks, calendarOrdersSelect } from '../../tasks/calendarTaskAssembly';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// --- the select ---------------------------------------------------------------------------------------------------------
const crewSelect = calendarOrdersSelect(false);
const adminSelect = calendarOrdersSelect(true);
ok('crew select asks for no payments and no signature rows', !/payments/.test(crewSelect) && !/order_signatures/.test(crewSelect));
ok('crew select still loads the order, customer and address', /\*,/.test(crewSelect) && /customers \(/.test(crewSelect) && /addresses \(/.test(crewSelect));
ok('admin select is unchanged: payments and signature rows', /payments \(id, amount_cents, status, paid_at, type\)/.test(adminSelect) && /order_signatures!order_signatures_order_id_fkey \(electronic_consent_given, waiver_version, physical_waiver_storage_path, physical_waiver_upload_source\)/.test(adminSelect));
const hook = read('src/hooks/admin/useCalendarTasks.ts');
ok('the hook builds its select from the caller role and reloads when the role resolves', /calendarOrdersSelect\(isAdminRef\.current/.test(hook) && /\[isAdmin\]/.test(hook));
ok('no literal payments / order_signatures embed is left in the hook', !/payments \(/.test(hook) && !/order_signatures!/.test(hook));

// --- assembly of a crew-shaped order -------------------------------------------------------------------------------------
const baseOrder = {
  id: '11111111-2222-4333-8444-555555555555', event_date: '2026-11-10', status: 'confirmed', pickup_preference: 'next_day', start_window: '10:00', end_window: '14:00',
  customers: { first_name: 'Ann', last_name: 'Adams', phone: '5555550101', email: 'a@b.test' }, addresses: { line1: '1 Main St', city: 'Detroit', state: 'MI', zip: '48201', lat: 42.3, lng: -83 },
  total_cents: 30000, deposit_paid_cents: 5000, balance_paid_cents: 0, tip_cents: 0, balance_due_cents: 25000, waiver_signed_at: '2026-10-01T10:00:00Z',
};
const gen = new Set<string>();
const crewTasks = buildCalendarTasks({ orders: [baseOrder], orderItems: [], taskStatuses: [], generatorCategoryProductIds: gen });
eq('crew-shaped order: two tasks come out (drop-off, pick-up)', crewTasks.map((t) => t.type), ['drop-off', 'pick-up']);
ok('crew-shaped order: the waiver is signed but its kind is NOT known (so it is never shown as "photo missing")', crewTasks.every((t) => t.waiverSigned === true && t.waiverType === null && t.waiverTypeKnown === false));
ok('crew-shaped order: payment state comes from the order columns', crewTasks.every((t) => t.depositPaidCents === 5000 && t.balancePaidCents === 0 && t.balanceDue === 25000 && t.total === 30000 && Array.isArray(t.payments) && t.payments.length === 0));
const adminTasks = buildCalendarTasks({
  orders: [{ ...baseOrder, payments: [{ id: 'p1', amount_cents: 5000, status: 'succeeded', paid_at: null, type: 'deposit' }], order_signatures: [{ electronic_consent_given: true, waiver_version: 'v7', physical_waiver_storage_path: null }] }],
  orderItems: [], taskStatuses: [], generatorCategoryProductIds: gen,
});
ok('admin-shaped order: the kind is known and digital, and payments are carried', adminTasks.every((t) => t.waiverTypeKnown === true && t.waiverType === 'digital' && t.payments?.length === 1));
const adminNoSigs = buildCalendarTasks({ orders: [{ ...baseOrder, payments: [], order_signatures: [] }], orderItems: [], taskStatuses: [], generatorCategoryProductIds: gen });
ok('admin-shaped order with no signature rows: known, but no kind (unchanged behaviour)', adminNoSigs[0].waiverTypeKnown === true && adminNoSigs[0].waiverType === null);

// --- the controls ---------------------------------------------------------------------------------------------------
const modal = read('src/components/admin/tasks/TaskDetailModal.tsx');
const mgmt = read('src/components/admin/tasks/detail/TaskDetailOrderManagement.tsx');
const info = read('src/components/admin/tasks/detail/TaskDetailCustomerInfo.tsx');
const header = read('src/components/admin/tasks/detail/TaskDetailHeader.tsx');
ok('the modal takes the role from the signed-in session and hands it to the three panels', /const \{ isAdmin \} = useAuth\(\)/.test(modal) && /canOpenOrder=\{isAdmin\}/.test(modal) && /<TaskDetailCustomerInfo task=\{task\} isAdmin=\{isAdmin\}/.test(modal) && /isAdmin=\{isAdmin\}\n/.test(modal));
ok('Charge to Card only for Admin/Master', /\{isAdmin && task\.balanceDue > 0 && task\.stripePaymentMethodId && \(/.test(mgmt));
ok('Cancel Order only for Admin/Master', /\{isAdmin && \(\n\s+<div>\n\s+<button\n\s+onClick=\{\(\) => setShowCancelForm/.test(mgmt));
ok('crew keeps Record Cash, Record Check and the paper waiver button', /onCashPayment/.test(mgmt) && /onCheckPayment/.test(mgmt) && /Mark Waiver Signed \(Paper\)/.test(mgmt) && !/isAdmin &&[^\n]*onPaperWaiver/.test(mgmt));
ok('the Open Order link to the admin screen is plain text for crew', /canOpenOrder \? \(/.test(header) && /<span className="text-sm text-slate-600">Order #\{orderNumber\}<\/span>/.test(header));
ok('the Refund panel can only render from the Admin payment list (crew list is always empty)', /const succeededPayments = isAdmin \?/.test(info) && /showRefundForm && \(/.test(info));
ok('crew payment status is built from the order columns', /!isAdmin && task\.total > 0/.test(info) && /Deposit paid:/.test(info) && /Paid in full/.test(info));
ok('crew asks get-waiver-status for the SUMMARY only (no signed file links)', /summaryOnly: true/.test(info));
ok('the signed waiver file link is fetched for Admin only', /if \(!isAdmin \|\| !task\.waiverSigned/.test(info));
ok('a failed or slow status lookup never shows "photo missing"', /Checking waiver…/.test(info) && /details unavailable right now/.test(info) && /waiverKind === 'paper_no_photo'/.test(info));

// --- every function the crew-reachable screens call must be classified and, if admin-only, gated ---------------------------
const CREW_OK: Record<string, string> = {
  'record-cash-payment': 'ALLOWED_ROLES = new Set(["master", "admin", "crew"])',
  'record-check-payment': 'ALLOWED_ROLES = new Set(["master", "admin", "crew"])',
  'upload-physical-waiver': '["admin", "master", "crew"]',
  'task-evidence': '["admin", "master", "crew"]',
  'calculate-route-mileage': '["master", "admin", "crew"]',
  'get-waiver-status': '["admin", "master", "crew"]',
  'send-sms-notification': 'CREW_SMS_TEMPLATES',
  'send-email': 'CREW_EMAIL_TEMPLATES',
};
const ADMIN_ONLY: Record<string, RegExp> = {
  'charge-deposit': /isStaffAdmin\(caller\)/,
  'customer-cancel-order': /isStaffAdmin\(caller\)/,
  'stripe-refund': /isStaffAdmin|callerHasAnyRole\(caller, \["admin", "master"\]\)|admin/i,
  'get-user-info': /admin/i,
};
const files: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) files.push(p);
  }
};
walk('src/components/admin/tasks');
files.push('src/components/calendar/DayViewModal.tsx', 'src/components/calendar/MileageModal.tsx', 'src/lib/tasks/taskEvidenceApi.ts');
const called = new Set<string>();
for (const f of files) {
  const t = read(f);
  for (const m of t.matchAll(/functions\/v1\/([a-z-]+)/g)) called.add(m[1]);
  for (const m of t.matchAll(/functionName: '([a-z-]+)'/g)) called.add(m[1]);
  for (const m of t.matchAll(/invoke\('([a-z-]+)'/g)) called.add(m[1]);
}
const unclassified = [...called].filter((n) => !(n in CREW_OK) && !(n in ADMIN_ONLY));
eq('every function the task screens call is classified here (a new call must be added to the table)', unclassified, []);
for (const [fn, marker] of Object.entries(CREW_OK)) {
  if (called.has(fn)) ok(`${fn}: the function itself admits crew`, read(`supabase/functions/${fn}/index.ts`).includes(marker) || read('supabase/functions/_shared/auth.ts').includes(marker));
}
for (const [fn, re] of Object.entries(ADMIN_ONLY)) {
  if (called.has(fn)) ok(`${fn}: the function refuses non-admin callers`, re.test(read(`supabase/functions/${fn}/index.ts`)));
}
ok('the admin-only calls (charge, cancel) are reached only through the panels gated above', /onChargeCard=\{handleChargeCard\}/.test(modal) && /onCancelOrder=\{handleCancelOrder\}/.test(modal) && (modal.match(/handleChargeCard\(/g) ?? []).length === 1 && (modal.match(/handleCancelOrder\(/g) ?? []).length === 1);

console.log(`crewTaskScreens: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} crew task screen test(s) failed`);
