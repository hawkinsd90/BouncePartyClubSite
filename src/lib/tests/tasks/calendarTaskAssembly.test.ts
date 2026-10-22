// Differential tests for the pure calendar task assembly (calendarTaskAssembly.ts).
//
// `oracleAssemble` is a verbatim copy of the assembly loop (and the three small helpers it calls) as it
// stood in useCalendarTasks.loadTasksForMonth before the extraction. It never calls the new module. Both
// sides run on the same rows and are compared with strict structural equality (own-undefined keys differ
// from missing keys, Dates compare by time), so key presence, defaults and ordering are all pinned.
// The known pick-up date quirk (derived from event_date, ignoring event_end_date) is pinned on purpose.

import { format, parseISO, addDays } from 'date-fns';
import { formatOrderId } from '../../utils';
import { ORDER_STATUS } from '../../constants/statuses';
import { formatOperationalEquipment } from '../../tasks/operationalEquipment';
import { aggregateOrderEquipment } from '../../eventEssentials/customerGeneratorCart';
import { buildCalendarTasks, deriveWaiverType, derivePickupReadiness, derivePickupBlockReason } from '../../tasks/calendarTaskAssembly';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
let compared = 0;

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

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
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

// ---------------------------------------------------------------------------
// ORACLE: verbatim old code
// ---------------------------------------------------------------------------
function oldDeriveWaiverType(
  waiverSignedAt: string | null,
  signatures: Array<{ electronic_consent_given: boolean; physical_waiver_storage_path: string | null; physical_waiver_upload_source?: string | null }>
): 'digital' | 'paper_with_photo' | 'paper_no_photo' | null {
  if (!waiverSignedAt) return null;
  if (!signatures || signatures.length === 0) return null;
  if (signatures.some(s => s.electronic_consent_given)) return 'digital';
  if (signatures.some(s => s.physical_waiver_storage_path)) return 'paper_with_photo';
  if (signatures.some(s => s.physical_waiver_upload_source === 'admin_no_photo')) return 'paper_no_photo';
  return null;
}

function oldDerivePickupReadiness(orderStatus: string, dropOffTaskStatus: string | null, pickUpTaskStatus: string | null, balanceDue: number): string {
  if (pickUpTaskStatus === 'completed') return 'completed';
  if (orderStatus === ORDER_STATUS.PENDING) return 'projected';
  if (dropOffTaskStatus !== 'completed') return 'projected';
  if (balanceDue > 0) return 'blocked';
  return 'ready';
}

function oldDerivePickupBlockReason(readiness: string, dropOffTaskStatus: string | null, balanceDue: number, orderStatus?: string): string | undefined {
  if (readiness === 'projected') {
    if (orderStatus === ORDER_STATUS.PENDING) return 'Order not yet confirmed';
    if (!dropOffTaskStatus || dropOffTaskStatus === 'pending') return 'Drop-off not yet started';
    if (dropOffTaskStatus === 'en_route') return 'Drop-off in progress';
    if (dropOffTaskStatus === 'arrived') return 'Drop-off in progress';
    return 'Drop-off not yet completed';
  }
  if (readiness === 'blocked') {
    return `Unpaid balance: $${(balanceDue / 100).toFixed(2)}`;
  }
  return undefined;
}

function oracleAssemble(orders: any[], orderItems: any[] | null, taskStatuses: any[] | null, generatorCategoryProductIds: Set<string>): any[] {
  const generatedTasks: any[] = [];

  for (const order of orders) {
    const eventDate = parseISO(order.event_date);
    const customer = order.customers as any;
    const customerName = customer
      ? `${customer.first_name} ${customer.last_name}`
      : 'Unknown Customer';

    const addr = order.addresses as any;
    const address = addr
      ? `${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip}`
      : 'No address';
    const lat: number | undefined = addr?.lat != null ? Number(addr.lat) : undefined;
    const lng: number | undefined = addr?.lng != null ? Number(addr.lng) : undefined;

    const orderItemsForOrder = orderItems?.filter(item => item.order_id === order.id) || [];

    const legacyGeneratorQty = order.generator_qty || 0;
    const equipmentItems = formatOperationalEquipment(orderItemsForOrder, legacyGeneratorQty);
    const items = equipmentItems.map(e => e.kind === 'inflatable' ? `${e.name} (${e.wetOrDry})` : `${e.name} ×${e.qty}`);
    const equipmentIds = orderItemsForOrder.filter((i: any) => i.unit_id).map((i: any) => i.unit_id);
    const numInflatables = orderItemsForOrder.filter((i: any) => i.unit_id).reduce((s: number, i: any) => s + (i.qty || 1), 0);
    const { totalGeneratorQty } = aggregateOrderEquipment({
      orderItems: orderItemsForOrder,
      legacyGeneratorQty,
      generatorCategoryProductIds,
    });

    const total = order.total_cents || 0;

    const balanceDue = Math.max(0, order.balance_due_cents || 0);

    const eventDateStr = format(eventDate, 'yyyy-MM-dd');
    const dropOffStatus = taskStatuses?.find(
      ts => ts.order_id === order.id && ts.task_type === 'drop-off' && ts.task_date === eventDateStr
    );

    generatedTasks.push({
      id: `${order.id}-dropoff`,
      orderId: order.id,
      type: 'drop-off',
      date: eventDate,
      orderNumber: formatOrderId(order.id),
      customerName,
      customerPhone: customer?.phone || '',
      customerEmail: customer?.email || '',
      address,
      items,
      rawOrderItems: orderItemsForOrder,
      rawEquipmentItems: equipmentItems,
      equipmentIds,
      numInflatables,
      eventStartTime: order.start_window || 'TBD',
      eventEndTime: order.end_window || 'TBD',
      notes: order.special_details || undefined,
      status: order.status,
      total,
      depositPaidCents: order.deposit_paid_cents || 0,
      balancePaidCents: order.balance_paid_cents || 0,
      tipCents: order.tip_cents || 0,
      waiverSigned: !!order.waiver_signed_at,
      waiverType: oldDeriveWaiverType(
        order.waiver_signed_at,
        (order.order_signatures as any[]) ?? []
      ),
      // B8 (WP-09): the one intentional addition to the assembled task - false when the signature rows were not loaded (crew).
      waiverTypeKnown: Array.isArray(order.order_signatures),
      balanceDue,
      stripePaymentMethodId: order.stripe_payment_method_id || null,
      paymentMethodBrand: order.payment_method_brand || null,
      paymentMethodLastFour: order.payment_method_last_four || null,
      pickupPreference: order.pickup_preference,
      surface: order.surface,
      lat,
      lng,
      generatorQty: totalGeneratorQty,
      hasPets: order.has_pets || false,
      payments: order.payments as any || [],
      taskStatus: dropOffStatus ? {
        id: dropOffStatus.id,
        status: dropOffStatus.status,
        sortOrder: dropOffStatus.sort_order,
        completedTime: dropOffStatus.completed_time ?? null,
        deliveryImages: (dropOffStatus.delivery_images as any) || [],
        damageImages: (dropOffStatus.damage_images as any) || [],
        etaSent: dropOffStatus.eta_sent || false,
      } : undefined,
    });

    const pickupDate = order.pickup_preference === 'same_day'
      ? eventDate
      : addDays(eventDate, 1);

    const pickupDateStr = format(pickupDate, 'yyyy-MM-dd');
    const pickUpStatus = taskStatuses?.find(
      ts => ts.order_id === order.id && ts.task_type === 'pick-up' && ts.task_date === pickupDateStr
    );

    const pickupReadiness = oldDerivePickupReadiness(
      order.status,
      dropOffStatus?.status ?? null,
      pickUpStatus?.status ?? null,
      balanceDue
    );

    const pickupBlockReason = oldDerivePickupBlockReason(pickupReadiness, dropOffStatus?.status ?? null, balanceDue, order.status);

    generatedTasks.push({
      id: `${order.id}-pickup`,
      orderId: order.id,
      type: 'pick-up',
      date: pickupDate,
      orderNumber: formatOrderId(order.id),
      customerName,
      customerPhone: customer?.phone || '',
      customerEmail: customer?.email || '',
      address,
      items,
      rawOrderItems: orderItemsForOrder,
      rawEquipmentItems: equipmentItems,
      equipmentIds,
      numInflatables,
      eventStartTime: order.start_window || 'TBD',
      eventEndTime: order.end_window || 'TBD',
      notes: order.special_details || undefined,
      status: order.status,
      total,
      depositPaidCents: order.deposit_paid_cents || 0,
      balancePaidCents: order.balance_paid_cents || 0,
      tipCents: order.tip_cents || 0,
      waiverSigned: !!order.waiver_signed_at,
      waiverType: oldDeriveWaiverType(
        order.waiver_signed_at,
        (order.order_signatures as any[]) ?? []
      ),
      // B8 (WP-09): the one intentional addition to the assembled task - false when the signature rows were not loaded (crew).
      waiverTypeKnown: Array.isArray(order.order_signatures),
      balanceDue,
      stripePaymentMethodId: order.stripe_payment_method_id || null,
      paymentMethodBrand: order.payment_method_brand || null,
      paymentMethodLastFour: order.payment_method_last_four || null,
      pickupPreference: order.pickup_preference,
      surface: order.surface,
      lat,
      lng,
      generatorQty: totalGeneratorQty,
      hasPets: order.has_pets || false,
      payments: order.payments as any || [],
      taskStatus: pickUpStatus ? {
        id: pickUpStatus.id,
        status: pickUpStatus.status,
        sortOrder: pickUpStatus.sort_order,
        completedTime: pickUpStatus.completed_time ?? null,
        deliveryImages: (pickUpStatus.delivery_images as any) || [],
        damageImages: (pickUpStatus.damage_images as any) || [],
        etaSent: pickUpStatus.eta_sent || false,
      } : undefined,
      pickupReadiness,
      pickupBlockReason,
    });
  }

  return generatedTasks;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const GEN = new Set(['p-gen']);
const CUSTOMER = { first_name: 'Ann', last_name: 'Lee', phone: '+15555550101', email: 'ann@example.test' };
const ADDRESS = { line1: '1 Main St', city: 'Tulsa', state: 'OK', zip: '74101', lat: '36.15', lng: -95.99 };

function mkOrder(over: any = {}): any {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001', event_date: '2026-07-04', event_end_date: '2026-07-04', status: 'confirmed',
    customers: { ...CUSTOMER }, addresses: { ...ADDRESS }, payments: [{ id: 'pay1', amount_cents: 5000, status: 'paid', paid_at: '2026-06-01', type: 'deposit' }],
    order_signatures: [], waiver_signed_at: null, generator_qty: 0, total_cents: 25000, balance_due_cents: 0, deposit_paid_cents: 5000,
    balance_paid_cents: 0, tip_cents: 0, start_window: '09:00', end_window: '11:00', special_details: null, pickup_preference: 'next_day',
    surface: 'grass', has_pets: false, stripe_payment_method_id: null, payment_method_brand: null, payment_method_last_four: null,
    ...over,
  };
}
const inflatable = (orderId: string, over: any = {}) => ({ order_id: orderId, unit_id: 'u1', units: { name: 'Castle' }, wet_or_dry: 'dry', qty: 1, ...over });
const eeProduct = (orderId: string, over: any = {}) => ({ order_id: orderId, product_id: 'p-tables', item_name: 'Tables', qty: 2, ...over });
const generatorItem = (orderId: string, over: any = {}) => ({ order_id: orderId, product_id: 'p-gen', item_name: 'Generator', qty: 1, ...over });
const bundleItem = (orderId: string, over: any = {}) => ({ order_id: orderId, bundle_id: 'b1', item_name: 'Party Pack', qty: 2, component_snapshot: { components: [{ product_name: 'Tables', product_id: 'p-tables', quantity_per_bundle: 3 }, { product_name: 'Generator', product_id: 'p-gen', quantity_per_bundle: 1 }] }, ...over });
const status = (orderId: string, type: 'drop-off' | 'pick-up', date: string, over: any = {}) => ({
  id: `ts-${orderId.slice(-2)}-${type}`, order_id: orderId, task_type: type, task_date: date, status: 'pending', sort_order: null, completed_time: null,
  delivery_images: [], damage_images: [], eta_sent: false, ...over,
});

function compare(label: string, orders: any[], orderItems: any[] | null, taskStatuses: any[] | null, gen: Set<string> = GEN) {
  compared++;
  const expected = oracleAssemble(orders, orderItems, taskStatuses, gen);
  const actual = buildCalendarTasks({ orders, orderItems, taskStatuses, generatorCategoryProductIds: gen });
  ok(`${label}: full Task[] equals the old assembly`, same(actual, expected));
  return { actual, expected };
}

const ID = 'aaaaaaaa-0000-0000-0000-000000000001';

// ---- Basic order ----
{
  const o = mkOrder();
  const { actual } = compare('basic order', [o], [inflatable(ID), eeProduct(ID)], [status(ID, 'drop-off', '2026-07-04', { status: 'completed', completed_time: '2026-07-04T15:00:00Z' }), status(ID, 'pick-up', '2026-07-05', { status: 'pending' })]);
  eq('basic: two tasks, drop-off first', actual.map((t: any) => t.id), [`${ID}-dropoff`, `${ID}-pickup`]);
  eq('basic: drop-off fields', [actual[0].type, actual[0].customerName, actual[0].address, actual[0].items, actual[0].orderNumber], ['drop-off', 'Ann Lee', '1 Main St, Tulsa, OK 74101', ['Castle (Dry)', 'Tables ×2'], formatOrderId(ID)]);
  eq('basic: lat/lng parsed to numbers', [actual[0].lat, actual[0].lng], [36.15, -95.99]);
  eq('basic: pickup readiness when drop-off completed with no balance', [actual[1].pickupReadiness, actual[1].pickupBlockReason], ['ready', undefined]);
}

// ---- Pickup dates (the event_end_date quirk is pinned) ----
{
  const sameDay = compare('same-day pickup', [mkOrder({ pickup_preference: 'same_day' })], [], []).actual;
  eq('same-day pickup: pickup date equals the event date', format(sameDay[1].date, 'yyyy-MM-dd'), '2026-07-04');
  const nextDay = compare('next-day pickup', [mkOrder({ pickup_preference: 'next_day' })], [], []).actual;
  eq('next-day pickup: event date + 1', format(nextDay[1].date, 'yyyy-MM-dd'), '2026-07-05');
  const noPref = compare('no pickup preference (null)', [mkOrder({ pickup_preference: null })], [], []).actual;
  eq('null pickup preference behaves as next-day', format(noPref[1].date, 'yyyy-MM-dd'), '2026-07-05');
  const multi = compare('multi-day order', [mkOrder({ event_end_date: '2026-07-07', pickup_preference: 'next_day' })], [], []).actual;
  eq('KNOWN QUIRK: multi-day pickup is still event_date + 1 (event_end_date is ignored)', format(multi[1].date, 'yyyy-MM-dd'), '2026-07-05');
  const multiSame = compare('multi-day order, same-day pickup', [mkOrder({ event_end_date: '2026-07-07', pickup_preference: 'same_day' })], [], []).actual;
  eq('KNOWN QUIRK: multi-day same-day pickup stays on event_date', format(multiSame[1].date, 'yyyy-MM-dd'), '2026-07-04');
  const crossMonth = compare('month boundary', [mkOrder({ event_date: '2026-07-31' })], [], []).actual;
  eq('month boundary pickup', format(crossMonth[1].date, 'yyyy-MM-dd'), '2026-08-01');
}

// ---- Task status ----
{
  const none = compare('no task statuses', [mkOrder()], [], []).actual;
  eq('no status: taskStatus key present and undefined on both tasks', ['taskStatus' in none[0], none[0].taskStatus, 'taskStatus' in none[1], none[1].taskStatus], [true, undefined, true, undefined]);
  eq('no status: drop-off has no pickup readiness keys, pick-up has both', ['pickupReadiness' in none[0], 'pickupBlockReason' in none[0], 'pickupReadiness' in none[1], 'pickupBlockReason' in none[1]], [false, false, true, true]);
  eq('no status: pickup is projected, drop-off not yet started', [none[1].pickupReadiness, none[1].pickupBlockReason], ['projected', 'Drop-off not yet started']);
  const nullStatuses = compare('task_status query returned no data (null)', [mkOrder()], [], null).actual;
  eq('null statuses behave as none', nullStatuses[0].taskStatus, undefined);
  const nullItems = compare('order_items query returned no data (null)', [mkOrder()], null, []).actual;
  eq('null items: empty equipment', [nullItems[0].items, nullItems[0].rawOrderItems, nullItems[0].numInflatables], [[], [], 0]);
  const existing = compare('existing task statuses', [mkOrder()], [inflatable(ID)], [
    status(ID, 'drop-off', '2026-07-04', { status: 'en_route', sort_order: 3, completed_time: null, delivery_images: ['d1', 'd2'], damage_images: ['x1'], eta_sent: true }),
    status(ID, 'pick-up', '2026-07-05', { status: 'completed', sort_order: 0, completed_time: '2026-07-05T12:00:00Z', delivery_images: null, damage_images: null, eta_sent: null }),
  ]).actual;
  eq('existing drop-off status projection', existing[0].taskStatus, { id: 'ts-01-drop-off', status: 'en_route', sortOrder: 3, completedTime: null, deliveryImages: ['d1', 'd2'], damageImages: ['x1'], etaSent: true });
  eq('existing pick-up status projection (null images and eta default)', existing[1].taskStatus, { id: 'ts-01-pick-up', status: 'completed', sortOrder: 0, completedTime: '2026-07-05T12:00:00Z', deliveryImages: [], damageImages: [], etaSent: false });
  eq('completed pick-up readiness', [existing[1].pickupReadiness, existing[1].pickupBlockReason], ['completed', undefined]);
  const sparse = compare('task_status rows missing optional columns', [mkOrder()], [], [status(ID, 'drop-off', '2026-07-04', { completed_time: undefined, sort_order: undefined, delivery_images: undefined, damage_images: undefined, eta_sent: undefined })]).actual;
  eq('missing optional columns: completed time defaults to null, images to [], eta to false, sort order stays undefined', [sparse[0].taskStatus?.completedTime, sparse[0].taskStatus?.deliveryImages, sparse[0].taskStatus?.damageImages, sparse[0].taskStatus?.etaSent, sparse[0].taskStatus?.sortOrder], [null, [], [], false, undefined]);
  const wrongDate = compare('statuses on the wrong date are ignored', [mkOrder()], [], [status(ID, 'drop-off', '2026-07-05'), status(ID, 'pick-up', '2026-07-04')]).actual;
  eq('wrong-date statuses ignored', [wrongDate[0].taskStatus, wrongDate[1].taskStatus], [undefined, undefined]);
  const otherOrder = compare('statuses of another order are ignored', [mkOrder()], [], [status('bbbbbbbb-0000-0000-0000-000000000002', 'drop-off', '2026-07-04')]).actual;
  eq('other-order statuses ignored', otherOrder[0].taskStatus, undefined);
}

// ---- Customer / address ----
{
  const noCustomer = compare('missing customer', [mkOrder({ customers: null })], [], []).actual;
  eq('missing customer defaults', [noCustomer[0].customerName, noCustomer[0].customerPhone, noCustomer[0].customerEmail], ['Unknown Customer', '', '']);
  const noAddress = compare('missing address', [mkOrder({ addresses: null })], [], []).actual;
  eq('missing address defaults', [noAddress[0].address, noAddress[0].lat, noAddress[0].lng, 'lat' in noAddress[0]], ['No address', undefined, undefined, true]);
  const partialCustomer = compare('customer without phone/email', [mkOrder({ customers: { first_name: 'Bo', last_name: 'Ng' } })], [], []).actual;
  eq('partial customer defaults', [partialCustomer[0].customerPhone, partialCustomer[0].customerEmail], ['', '']);
  const zeroCoords = compare('zero coordinates are kept', [mkOrder({ addresses: { ...ADDRESS, lat: 0, lng: 0 } })], [], []).actual;
  eq('zero coordinates', [zeroCoords[0].lat, zeroCoords[0].lng], [0, 0]);
  const nullCoords = compare('null coordinates', [mkOrder({ addresses: { ...ADDRESS, lat: null, lng: undefined } })], [], []).actual;
  eq('null coordinates become undefined', [nullCoords[0].lat, nullCoords[0].lng], [undefined, undefined]);
}

// ---- Items, equipment, generator ----
{
  const many = compare('multiple items', [mkOrder({ generator_qty: 1 })], [inflatable(ID, { qty: 2, wet_or_dry: 'water' }), inflatable(ID, { unit_id: 'u2', units: { name: 'Slide' }, qty: undefined }), eeProduct(ID), eeProduct(ID, { qty: 3 }), bundleItem(ID), generatorItem(ID, { qty: 2 })], []).actual;
  eq('multiple items: inflatables counted with qty fallback to 1', many[0].numInflatables, 3);
  eq('multiple items: equipment ids', many[0].equipmentIds, ['u1', 'u2']);
  eq('multiple items: aggregated labels', many[0].items, ['Castle (Water)', 'Slide (Dry)', 'Tables ×11', 'Generator ×5']);
  eq('generator quantity combines legacy, direct and package generators', many[0].generatorQty, 1 + 2 + 2);
  const noGenIds = compare('generator category ids empty', [mkOrder({ generator_qty: 1 })], [generatorItem(ID), bundleItem(ID)], [], new Set()).actual;
  eq('empty category ids: only the legacy generator counts', noGenIds[0].generatorQty, 1);
  const legacyOnly = compare('legacy generator only', [mkOrder({ generator_qty: 2 })], [], []).actual;
  eq('legacy generator is added as equipment', [legacyOnly[0].items, legacyOnly[0].generatorQty], [['Generator ×2'], 2]);
  const unavailable = compare('package without snapshot', [mkOrder()], [{ order_id: ID, bundle_id: 'b9', qty: 1, component_snapshot: null, item_name: 'Pack' }], []).actual;
  eq('package contents unavailable label', unavailable[0].items, ['Package contents unavailable ×1']);
  const otherOrdersItems = compare('items of another order are not mixed in', [mkOrder()], [inflatable('bbbbbbbb-0000-0000-0000-000000000002'), inflatable(ID)], []).actual;
  eq('only this order items', otherOrdersItems[0].rawOrderItems.length, 1);
}

// ---- Waiver variants ----
{
  const sigs = {
    none: [], digital: [{ electronic_consent_given: true, physical_waiver_storage_path: null }],
    paperPhoto: [{ electronic_consent_given: false, physical_waiver_storage_path: 'w/1.jpg' }],
    paperNoPhoto: [{ electronic_consent_given: false, physical_waiver_storage_path: null, physical_waiver_upload_source: 'admin_no_photo' }],
    other: [{ electronic_consent_given: false, physical_waiver_storage_path: null, physical_waiver_upload_source: 'customer' }],
    mixed: [{ electronic_consent_given: false, physical_waiver_storage_path: 'w/1.jpg' }, { electronic_consent_given: true, physical_waiver_storage_path: null }],
  } as Record<string, any[]>;
  const expected: Record<string, any> = { none: null, digital: 'digital', paperPhoto: 'paper_with_photo', paperNoPhoto: 'paper_no_photo', other: null, mixed: 'digital' };
  for (const k of Object.keys(sigs)) {
    const r = compare(`waiver ${k}`, [mkOrder({ waiver_signed_at: '2026-06-01T00:00:00Z', order_signatures: sigs[k] })], [], []).actual;
    eq(`waiver ${k}: type`, [r[0].waiverSigned, r[0].waiverType], [true, expected[k]]);
  }
  const unsigned = compare('waiver unsigned with signatures', [mkOrder({ waiver_signed_at: null, order_signatures: sigs.digital })], [], []).actual;
  eq('unsigned order has no waiver type', [unsigned[0].waiverSigned, unsigned[0].waiverType], [false, null]);
  const nullSigs = compare('waiver signed with null signatures', [mkOrder({ waiver_signed_at: '2026-06-01T00:00:00Z', order_signatures: null })], [], []).actual;
  eq('null signatures', nullSigs[0].waiverType, null);
}

// ---- Statuses, defaults, ordering ----
{
  const defaults = compare('defaults', [mkOrder({ total_cents: null, balance_due_cents: -500, deposit_paid_cents: null, balance_paid_cents: null, tip_cents: null, start_window: null, end_window: null, special_details: null, has_pets: null, payments: null, stripe_payment_method_id: undefined, surface: undefined })], [], []).actual;
  eq('defaults: money and window fallbacks', [defaults[0].total, defaults[0].balanceDue, defaults[0].depositPaidCents, defaults[0].tipCents, defaults[0].eventStartTime, defaults[0].eventEndTime, defaults[0].notes, defaults[0].hasPets, defaults[0].payments, defaults[0].stripePaymentMethodId], [0, 0, 0, 0, 'TBD', 'TBD', undefined, false, [], null]);
  for (const st of ['pending_review', 'confirmed', 'in_progress', 'completed', 'cancelled', 'draft', 'awaiting_customer_approval']) {
    compare(`order status ${st} (assembled as-is; filtering happens in the query)`, [mkOrder({ status: st, balance_due_cents: 1234 })], [], [status(ID, 'drop-off', '2026-07-04', { status: 'completed' })]);
  }
  const pend = compare('pending_review pickup', [mkOrder({ status: 'pending_review' })], [], []).actual;
  eq('pending_review pickup is projected with its reason', [pend[1].pickupReadiness, pend[1].pickupBlockReason], ['projected', 'Order not yet confirmed']);
  const blocked = compare('blocked pickup', [mkOrder({ balance_due_cents: 4567 })], [], [status(ID, 'drop-off', '2026-07-04', { status: 'completed' })]).actual;
  eq('blocked pickup reason', [blocked[1].pickupReadiness, blocked[1].pickupBlockReason], ['blocked', 'Unpaid balance: $45.67']);
  const ID2 = 'bbbbbbbb-0000-0000-0000-000000000002'; const ID3 = 'cccccccc-0000-0000-0000-000000000003';
  const multi = compare('several orders keep input order', [mkOrder(), mkOrder({ id: ID2, event_date: '2026-07-02' }), mkOrder({ id: ID3, event_date: '2026-07-09', pickup_preference: 'same_day' })], [], []).actual;
  eq('task order: per order, drop-off then pick-up, in the order given (no sorting)', multi.map((t: any) => t.id), [`${ID}-dropoff`, `${ID}-pickup`, `${ID2}-dropoff`, `${ID2}-pickup`, `${ID3}-dropoff`, `${ID3}-pickup`]);
  eq('empty orders', buildCalendarTasks({ orders: [], orderItems: [], taskStatuses: [], generatorCategoryProductIds: GEN }), []);
}

// ---- Direct tests of the pickup helpers ----
{
  const cases: Array<[string, string | null, string | null, number]> = [];
  for (const os of ['pending_review', 'confirmed', 'in_progress', 'completed']) for (const d of [null, 'pending', 'en_route', 'arrived', 'completed', 'weird']) for (const p of [null, 'pending', 'completed']) for (const b of [0, 1, 12345]) cases.push([os, d, p, b]);
  for (const [os, d, p, b] of cases) {
    const r = derivePickupReadiness(os, d, p, b);
    compared++;
    ok(`derivePickupReadiness(${os},${d},${p},${b}) matches the old function`, r === oldDerivePickupReadiness(os, d, p, b));
    ok(`derivePickupBlockReason(${r},${d},${b},${os}) matches the old function`, derivePickupBlockReason(r, d, b, os) === oldDerivePickupBlockReason(r, d, b, os));
  }
  eq('readiness: completed pick-up wins over everything', derivePickupReadiness('pending_review', null, 'completed', 999), 'completed');
  eq('readiness: pending_review is projected even when drop-off is completed', derivePickupReadiness('pending_review', 'completed', null, 0), 'projected');
  eq('readiness: blocked with a balance', derivePickupReadiness('confirmed', 'completed', null, 1), 'blocked');
  eq('readiness: ready without a balance', derivePickupReadiness('confirmed', 'completed', null, 0), 'ready');
  eq('block reason: en_route and arrived share a message', [derivePickupBlockReason('projected', 'en_route', 0, 'confirmed'), derivePickupBlockReason('projected', 'arrived', 0, 'confirmed')], ['Drop-off in progress', 'Drop-off in progress']);
  eq('block reason: unknown drop-off status', derivePickupBlockReason('projected', 'weird', 0, 'confirmed'), 'Drop-off not yet completed');
  eq('block reason: ready and completed have none', [derivePickupBlockReason('ready', 'completed', 0), derivePickupBlockReason('completed', 'completed', 0)], [undefined, undefined]);
  eq('waiver helper matches the old function on null input', [deriveWaiverType(null, []), oldDeriveWaiverType(null, [])], [null, null]);
}

// ---- Fixed-seed scenario grid ----
{
  const r = rng(20261006);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const STATUSES = ['pending_review', 'confirmed', 'in_progress', 'completed'];
  const GRID = 600;
  for (let n = 0; n < GRID; n++) {
    const count = 1 + Math.floor(r() * 3);
    const orders: any[] = []; const items: any[] = []; const statuses: any[] = [];
    for (let i = 0; i < count; i++) {
      const id = `${String(i + 1).padStart(8, '0')}-0000-0000-0000-00000000000${i + 1}`;
      const eventDate = pick(['2026-07-04', '2026-07-31', '2026-12-31', '2026-02-28', '2028-02-29']);
      const pref = pick(['same_day', 'next_day', null, undefined]);
      const sigKind = pick(['none', 'digital', 'photo', 'nophoto', 'other', 'null']);
      const sigs = sigKind === 'none' ? [] : sigKind === 'digital' ? [{ electronic_consent_given: true, physical_waiver_storage_path: null }]
        : sigKind === 'photo' ? [{ electronic_consent_given: false, physical_waiver_storage_path: 'w.jpg' }]
        : sigKind === 'nophoto' ? [{ electronic_consent_given: false, physical_waiver_storage_path: null, physical_waiver_upload_source: 'admin_no_photo' }]
        : sigKind === 'other' ? [{ electronic_consent_given: false, physical_waiver_storage_path: null }] : null;
      orders.push(mkOrder({
        id, event_date: eventDate, event_end_date: pick([eventDate, '2030-01-01', null]), pickup_preference: pref, status: pick(STATUSES),
        customers: pick([{ ...CUSTOMER }, null, { first_name: 'Z', last_name: 'Q' }]), addresses: pick([{ ...ADDRESS }, null, { ...ADDRESS, lat: null }]),
        waiver_signed_at: pick([null, '2026-06-01T00:00:00Z']), order_signatures: sigs, generator_qty: pick([0, 0, 1, 3]),
        balance_due_cents: pick([0, 0, 500, -200]), total_cents: pick([0, 20000]), has_pets: pick([true, false, null]), special_details: pick([null, 'Gate code 1234']),
        payments: pick([null, [], [{ id: 'p', amount_cents: 1, status: 'paid', paid_at: null, type: 'deposit' }]]),
      }));
      if (r() < 0.8) items.push(inflatable(id, { qty: pick([undefined, 1, 2]), wet_or_dry: pick(['dry', 'water']) }));
      if (r() < 0.4) items.push(eeProduct(id, { qty: pick([1, 4]) }));
      if (r() < 0.3) items.push(generatorItem(id));
      if (r() < 0.3) items.push(bundleItem(id, { qty: pick([1, 2]) }));
      const dropDate = eventDate; // statuses are matched by the old rules, including mismatching dates
      if (r() < 0.6) statuses.push(status(id, 'drop-off', pick([dropDate, '2026-01-01']), { status: pick(['pending', 'en_route', 'arrived', 'completed']), sort_order: pick([null, 0, 2]), eta_sent: pick([true, false, null]), delivery_images: pick([null, [], ['a']]) }));
      if (r() < 0.5) statuses.push(status(id, 'pick-up', pick([format(addDays(parseISO(eventDate), 1), 'yyyy-MM-dd'), eventDate, '2026-01-01']), { status: pick(['pending', 'completed']), completed_time: pick([null, '2026-07-05T00:00:00Z']) }));
    }
    compare(`grid ${n}`, orders, pick([items, items, null]), pick([statuses, statuses, null]), pick([GEN, new Set<string>()]));
  }
  ok(`grid ran ${GRID} scenarios`, compared >= GRID);
}

console.log(`Calendar task assembly differential tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
if (failed > 0) throw new Error(`${failed} calendar task assembly test(s) failed`);
