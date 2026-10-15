// Order-specific delivery unit (orders.event_address_line2).
//
// Two bookings at the same street address share ONE canonical addresses row (address_key = line1 + city + state + zip),
// so the apartment/unit must live on the order. These tests pin the rule end to end: the pure helper, the Customer Portal
// projection, the admin edit model and change planner, the migration, and a source scan that no active operational
// reader depends solely on the shared addresses.line2.
// Run: node node_modules/jiti/bin/jiti.js src/lib/orderEventAddress.test.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const require: (id: string) => any;
const fs = require('fs');

import { eventAddressLine2, normalizeUnit, addressWithOrderUnit, formatStreetWithUnit } from '../../booking/eventAddress';
import { projectOrder } from '../../../../supabase/functions/_shared/portal/portal-projection';
import { buildInitialEditedOrder, hasOrderDetailChanges } from '../../../components/admin/orders/detail-modal/editedOrderModel';
import { hasAddressChanged, planOrderChanges } from '../../orders/orderChangePlanning';

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
const read = (p: string): string => fs.readFileSync(p, 'utf8');

const shared = (line2: string | null) => ({ id: 'addr-shared', line1: '123 Main St', line2, city: 'Wayne', state: 'MI', zip: '48184' });

// ---------------------------------------------------------------------------------------------------------------
// 1. The helper: order-specific value wins, '' means "no unit", NULL means legacy
// ---------------------------------------------------------------------------------------------------------------
eq('helper: trimmed text is preserved exactly', eventAddressLine2({ event_address_line2: '  Apt 2A ', addresses: shared('Apt 8C') }), 'Apt 2A');
eq('helper: the order-specific unit beats the shared row', eventAddressLine2({ event_address_line2: 'Apt 2A', addresses: shared('Apt 8C') }), 'Apt 2A');
eq('helper: an EMPTY order unit means no unit and does NOT inherit the shared row', eventAddressLine2({ event_address_line2: '', addresses: shared('Apt 2A') }), '');
eq('helper: a whitespace-only order unit means no unit', eventAddressLine2({ event_address_line2: '   ', addresses: shared('Apt 2A') }), '');
eq('helper: NULL (legacy order) falls back to the shared row', eventAddressLine2({ event_address_line2: null, addresses: shared('Apt 2A') }), 'Apt 2A');
eq('helper: missing field (legacy order) falls back to the shared row', eventAddressLine2({ addresses: shared('Apt 2A') }), 'Apt 2A');
eq('helper: legacy order with no unit anywhere is empty', eventAddressLine2({ event_address_line2: null, addresses: shared(null) }), '');
eq('helper: legacy order without an address row is empty (no crash)', eventAddressLine2({ event_address_line2: null, addresses: null }), '');
eq('helper: null / undefined orders are empty', [eventAddressLine2(null), eventAddressLine2(undefined)], ['', '']);
eq('helper: normalizeUnit never returns null / undefined text', [normalizeUnit(null), normalizeUnit(undefined), normalizeUnit(42), normalizeUnit(' x ')], ['', '', '', 'x']);
eq('helper: units are NOT normalized across spellings (Apt 2A stays Apt 2A)', [normalizeUnit('Apt 2A'), normalizeUnit('Apartment 2A'), normalizeUnit('#2A')], ['Apt 2A', 'Apartment 2A', '#2A']);
eq('helper: street + unit formatting', formatStreetWithUnit('123 Main St', 'Apt 2A'), '123 Main St, Apt 2A');
eq('helper: street without a unit has no stray separator / "null" / "undefined"', [formatStreetWithUnit('123 Main St', null), formatStreetWithUnit('123 Main St', ''), formatStreetWithUnit('123 Main St', undefined)], ['123 Main St', '123 Main St', '123 Main St']);
const withUnit = addressWithOrderUnit({ event_address_line2: 'Apt 2A', addresses: shared('Apt 8C') });
ok('helper: addressWithOrderUnit swaps in the order unit and keeps the rest of the address', !!withUnit && withUnit.line2 === 'Apt 2A' && withUnit.line1 === '123 Main St' && withUnit.zip === '48184');
ok('helper: addressWithOrderUnit does not mutate the shared row', shared('Apt 8C').line2 === 'Apt 8C' && withUnit !== null);
eq('helper: addressWithOrderUnit with no address is null', addressWithOrderUnit({ event_address_line2: 'x', addresses: null }), null);

// Two orders on the same shared row, then the shared row changes
{
  const row = shared('Apt 2A');
  const orderA = { event_address_line2: 'Apt 2A', addresses: row };
  const orderB = { event_address_line2: 'Apt 8C', addresses: row };
  const orderC = { event_address_line2: '', addresses: row };
  eq('immutability: A / B / C show their own units on one shared address row', [eventAddressLine2(orderA), eventAddressLine2(orderB), eventAddressLine2(orderC)], ['Apt 2A', 'Apt 8C', '']);
  row.line2 = 'Suite 99'; // someone rewrites the canonical address
  eq('immutability: rewriting the shared row changes none of the orders', [eventAddressLine2(orderA), eventAddressLine2(orderB), eventAddressLine2(orderC)], ['Apt 2A', 'Apt 8C', '']);
  const legacy = { event_address_line2: null, addresses: row };
  eq('immutability: only a legacy (NULL) order still follows the shared row', eventAddressLine2(legacy), 'Suite 99');
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Customer Portal projection (server)
// ---------------------------------------------------------------------------------------------------------------
{
  const project = (orderUnit: unknown, sharedUnit: string | null, withAddress = true) =>
    projectOrder({ id: 'o', status: 'pending_review', event_address_line2: orderUnit } as any, { address: withAddress ? (shared(sharedUnit) as any) : null }) as any;
  eq('portal: the order-specific unit replaces the shared row line2', project('Apt 8C', 'Apt 2A').addresses.line2, 'Apt 8C');
  eq('portal: an order with NO unit shows none even if the shared row has one', project('', 'Apt 2A').addresses.line2, '');
  eq('portal: a legacy order (NULL) keeps the shared row line2', project(null, 'Apt 2A').addresses.line2, 'Apt 2A');
  eq('portal: a legacy order (field absent) keeps the shared row line2', (projectOrder({ id: 'o' } as any, { address: shared('Apt 2A') as any }) as any).addresses.line2, 'Apt 2A');
  eq('portal: the unit is trimmed', project('  Apt 8C  ', null).addresses.line2, 'Apt 8C');
  eq('portal: an order without an address row still projects (no crash)', project('Apt 8C', null, false).addresses, null);
  const p = project('Apt 8C', 'Apt 2A');
  ok('portal: the other booking\'s unit never appears anywhere in the projection', !JSON.stringify(p).includes('Apt 2A'));
  ok('portal: the raw order column is not added to the allowlisted order fields', !('event_address_line2' in p));
  ok('portal: street / city / zip still come from the shared row', p.addresses.line1 === '123 Main St' && p.addresses.zip === '48184');
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Admin edit order: load, change detection, planner write
// ---------------------------------------------------------------------------------------------------------------
{
  const baseOrder = (over: any = {}): any => ({
    id: 'ord-1', customer_id: 'cust-1', status: 'confirmed', location_type: 'residential', surface: 'grass', generator_qty: 0,
    start_window: '09:00', end_window: '11:00', event_date: '2026-07-04', event_end_date: '2026-07-04', pickup_preference: 'next_day',
    addresses: shared('Apt 8C'), subtotal_cents: 20000, deposit_due_cents: 5000, deposit_paid_cents: 5000, balance_due_cents: 17000,
    travel_fee_cents: 0, tax_cents: 0, require_card_on_file: true, admin_message: null, ...over,
  });
  const own = baseOrder({ event_address_line2: 'Apt 2A' });
  const initialOwn = buildInitialEditedOrder(own);
  eq('edit: the edit form loads THIS order\'s unit, not the shared row\'s', initialOwn.address_line2, 'Apt 2A');
  ok('edit: an unedited order with its own unit reports no address change', !hasAddressChanged(own, initialOwn) && !hasOrderDetailChanges(initialOwn, own, []));
  const legacy = baseOrder({ event_address_line2: null });
  const initialLegacy = buildInitialEditedOrder(legacy);
  eq('edit: a legacy order loads the shared unit', initialLegacy.address_line2, 'Apt 8C');
  ok('edit: an unedited legacy order reports no change', !hasAddressChanged(legacy, initialLegacy));
  const none = baseOrder({ event_address_line2: '' });
  eq('edit: an order with no unit loads empty even if the shared row has one', buildInitialEditedOrder(none).address_line2, '');

  const deps = { calculateTotal: () => 20000 };
  const planInput = (order: any, editedOver: any) => ({
    order, editedOrder: { ...buildInitialEditedOrder(order), ...editedOver }, stagedItems: [{ id: 'i1', unit_id: 'u1', unit_name: 'Castle', wet_or_dry: 'dry', qty: 1, unit_price_cents: 20000 }],
    discounts: [], customFees: [], calculatedPricing: null, customDepositCents: null, customSetupFeeCents: null, adminMessage: '', adminOverrideApproval: false,
    canonicalAddressId: 'addr-shared',
  });
  const unitOnly = hasAddressChanged(own, { ...initialOwn, address_line2: 'Apt 9Z' });
  ok('edit: changing ONLY the unit counts as an address change', unitOnly);
  const plan = planOrderChanges(planInput(own, { address_line2: ' Apt 9Z ' }) as any, deps as any) as any;
  eq('edit: a unit-only edit writes the unit to THIS order (trimmed) and keeps the canonical address id', [plan.changes.event_address_line2, plan.changes.address_id], ['Apt 9Z', 'addr-shared']);
  ok('edit: the address change is logged with the order\'s own old unit', plan.logs.some((l: any) => l[0] === 'address' && String(l[1]).includes('Apt 2A') && !String(l[1]).includes('Apt 8C') && String(l[2]).includes('Apt 9Z')));
  const clear = planOrderChanges(planInput(own, { address_line2: '' }) as any, deps as any) as any;
  eq('edit: clearing the unit writes an EMPTY string (not null), so it cannot fall back to the shared row', clear.changes.event_address_line2, '');
  const legacyEdit = planOrderChanges(planInput(legacy, { address_line1: '9 Oak St' }) as any, deps as any) as any;
  eq('edit: editing another address field of a legacy order freezes its currently displayed unit on the order', legacyEdit.changes.event_address_line2, 'Apt 8C');
  const noAddr = planOrderChanges(planInput(own, {}) as any, deps as any) as any;
  ok('edit: an edit that does not touch the address leaves event_address_line2 alone', !('event_address_line2' in noAddr.changes) && !('address_id' in noAddr.changes));
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Source wiring: admin invoice, address service, duplication, print, dashboard, admin card
// ---------------------------------------------------------------------------------------------------------------
{
  const invoice = read('supabase/functions/_shared/orders/staff-order-save.ts');
  ok('invoice: an admin-created order stores its own normalized unit (the server writes it)', /event_address_line2:\s*parsedEvent\.address_line2\.trim\(\)/.test(invoice));
  const addressService = read('src/lib/booking/addressService.ts');
  ok('address service: the shared row\'s line2 is first-writer and never rewritten by a later booking / edit', /const sharedLine2 = existingRow \? \(existingRow\.line2 \?\? null\) : \(line2 \?\? null\);/.test(addressService) && /line2: sharedLine2,/.test(addressService) && !/line2: line2 \?\? null,/.test(addressService));
  ok('duplication: a duplicated order copies THIS order\'s unit', /address_line2: eventAddressLine2\(orderData\)/.test(read('src/hooks/orders/useOrderDuplication.ts')));
  ok('print: the printed address uses the order unit', /line2: eventAddressLine2\(order\)/.test(read('src/lib/documents/printableDocument.ts')));
  ok('customer dashboard: the order card uses the order unit', /eventAddressLine2\(order\)/.test(read('src/components/dashboard/OrderCard.tsx')) && !/order\.addresses\.line2/.test(read('src/components/dashboard/OrderCard.tsx')));
  ok('admin pending order: the info section uses the order unit', /eventAddressLine2\(order\)/.test(read('src/components/pending-order/OrderInfoSection.tsx')) && !/order\.addresses\?\.line2/.test(read('src/components/pending-order/OrderInfoSection.tsx')));
  ok('the planner and the edit model compare against the order unit, not the shared row', !/order\.addresses\?\.line2 \|\| ''/.test(read('src/lib/orders/orderChangePlanning.ts')) && !/order\.addresses\?\.line2 \|\| ''/.test(read('src/components/admin/orders/detail-modal/editedOrderModel.ts')));
  ok('the server projection overrides line2 only when the order has its own string value', /typeof order\.event_address_line2 === "string"/.test(read('supabase/functions/_shared/portal/portal-projection.ts')));
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Source scan: every remaining reader of the shared addresses line2
// ---------------------------------------------------------------------------------------------------------------
{
  // Files whose `addresses.line2` is already the ORDER-specific value because the data comes through the server projection
  // (projectOrder), or that are pure fixtures / the helper itself. Anything else reading a shared line2 is a blocker.
  const PORTAL_PROJECTION_FED = [
    'src/components/customer-portal/InvoiceAcceptanceView.tsx',
    'src/components/customer-portal/RegularPortalView.tsx',
    'src/pages/Sign.tsx',
  ];
  const files: string[] = fs.readdirSync('src', { recursive: true }).filter((f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)).map((f: string) => `src/${f.replace(/\\/g, '/')}`);
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const readers = files.filter((f) => /addresses\??\.line2/.test(stripComments(read(f))) && !/lib\/(database\.types|tests\/support\/portalTestHarness|booking\/eventAddress)/.test(f));
  const direct = readers.filter((f) => !PORTAL_PROJECTION_FED.includes(f));
  eq('scan: no non-portal reader depends on the shared addresses.line2 (all go through eventAddressLine2)', direct, []);
  for (const f of PORTAL_PROJECTION_FED) {
    ok(`scan: ${f} never queries orders / addresses itself (its address comes from the portal projection)`, !/\.from\(\s*['"](orders|addresses)['"]\s*\)/.test(read(f)));
  }
  ok('scan: the portal-fed components get their order from the customer-portal-data projection', /projectOrder\(/.test(read('supabase/functions/customer-portal-data/index.ts')));
  // Event-address inputs that carry the unit from the browser to a new order
  ok('scan: the public booking request carries the unit', /line2: quoteData\.address_line2 \|\| null/.test(read('src/lib/booking/bookingApi.ts')));
  ok('scan: billing address columns are untouched (still separate order-level fields)', /billing_address_line2/.test(read('supabase/functions/_shared/portal/portal-projection.ts')) && !/billing[^\n]*event_address_line2|event_address_line2[^\n]*billing/.test(read('supabase/migrations/20261011120000_order_event_address_line2.sql').replace(/\/\*[\s\S]*?\*\//, '')));
}

// ---------------------------------------------------------------------------------------------------------------
// 6. Migration
// ---------------------------------------------------------------------------------------------------------------
{
  const sql = read('supabase/migrations/20261011120000_order_event_address_line2.sql');
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  ok('migration: adds the nullable text column additively', /ALTER TABLE public\.orders ADD COLUMN IF NOT EXISTS event_address_line2 text;/.test(code));
  ok('migration: nothing destructive (no DROP / DELETE / TRUNCATE / column type change)', !/\bDROP\b|\bDELETE\b|\bTRUNCATE\b|ALTER COLUMN/i.test(code));
  ok('migration: no historical backfill of the new column', !/UPDATE\s+(public\.)?orders/i.test(code) && !/UPDATE\s+(public\.)?addresses/i.test(code));
  ok('migration: no RLS or policy changes and no grant contraction beyond the booking RPC restatement', !/POLICY|ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/i.test(code) && (code.match(/REVOKE/g) ?? []).length === 3 && (code.match(/GRANT/g) ?? []).length === 1);
  ok('migration: the booking RPC writes the order\'s own trimmed unit, \'\' when none', /customer_id, address_id, event_address_line2, status,/.test(code) && /v_customer_id, v_address_id, COALESCE\(btrim\(v_address->>'line2'\), ''\), 'draft',/.test(code));
  ok('migration: the RPC keeps the registered-account guard and forced defaults', /RAISE EXCEPTION 'account_sign_in_required'/.test(code) && /'unpaid', false, NULL/.test(code) && /v_customer_id, v_address_id, COALESCE/.test(code));
  ok('migration: the RPC is still service-role only', /REVOKE ALL ON FUNCTION public\.create_booking_request\(jsonb, text, timestamptz, uuid\) FROM anon/.test(code) && /GRANT EXECUTE ON FUNCTION public\.create_booking_request\(jsonb, text, timestamptz, uuid\) TO service_role/.test(code));
  ok('migration: the address upsert still keeps the shared row\'s first line2 (no line2 in the DO UPDATE set)', !/line2\s*=\s*(COALESCE\()?EXCLUDED\.line2/.test(code));
}

console.log(`Order event address tests: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} order event address test(s) failed`);
