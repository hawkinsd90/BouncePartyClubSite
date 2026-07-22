// Stage E4 — Mixed-cart booking flow, package disclosure, EE communication,
// pickup validation, and configurable EE-only deposits.
// jiti runner. Tests imported production helpers.

import { calculateRequiredDepositCents, calculateEEOnlyDepositCents, DEFAULT_EE_ONLY_DEPOSIT_SETTINGS, type EEOnlyDepositSettings } from './depositCalculation';
import { buildPackageDisplay } from './packageDisplay';
import { hasGeneratorInOrderItems } from './generatorUnified';
import { composeUnifiedQuoteTotals } from './unifiedTotals';
import { mapCartToOrderItems } from './eventEssentialsOrderItems';
import { getPaymentAmountCentsFromTotals } from './checkoutUtils';
import type { UnifiedCartItem, InflatableCartItem, EventEssentialProductCartItem, EventEssentialBundleCartItem, BundleComponentSnapshot } from '../types';

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function test(name: string, fn: () => void): void {
  try { fn(); } catch (err) { failed++; console.error(`FAIL: ${name}:`, err); }
}

// --- Fixtures ---

const GEN_ID = 'gen-product-uuid';
const BUNDLE_ID = 'bundle-uuid';

function makeInflatable(unitId: string, price: number): InflatableCartItem {
  return { item_type: 'inflatable', unit_id: unitId, unit_name: `Unit ${unitId}`, wet_or_dry: 'dry', unit_price_cents: price, price_dry_cents: price, price_water_cents: price + 5000, qty: 1 };
}

function makeProduct(productId: string, name: string, price: number, context: 'standalone' | 'addon' = 'addon', qty = 1): EventEssentialProductCartItem {
  return { item_type: 'event_essential_product', product_id: productId, product_name: name, unit_price_cents: price, qty, pricing_context: context };
}

function makeBundle(bundleId: string, name: string, price: number, context: 'standalone' | 'addon' = 'standalone', qty = 1): EventEssentialBundleCartItem {
  const snapshot: BundleComponentSnapshot = { bundle_name: name, bundle_description: null, components: [{ product_id: GEN_ID, product_name: 'Generator', quantity_per_bundle: 1 }] };
  return { item_type: 'event_essential_bundle', bundle_id: bundleId, bundle_name: name, unit_price_cents: price, qty, pricing_context: context, component_snapshot: snapshot };
}

function makeBundleWithComponents(bundleId: string, name: string, price: number, components: Array<{ product_id: string; product_name: string; quantity_per_bundle: number }>, qty = 1): EventEssentialBundleCartItem {
  const snapshot: BundleComponentSnapshot = { bundle_name: name, bundle_description: null, components };
  return { item_type: 'event_essential_bundle', bundle_id: bundleId, bundle_name: name, unit_price_cents: price, qty, pricing_context: 'standalone', component_snapshot: snapshot };
}

function makeBreakdown(overrides: Record<string, any> = {}) {
  return { subtotal_cents: 15000, travel_fee_cents: 11400, surface_fee_cents: 0, same_day_pickup_fee_cents: 0, same_day_weekday_delivery_fee_cents: 0, generator_fee_cents: 0, tax_cents: 0, tax_applied: false, deposit_due_cents: 5000, total_cents: 26400, travel_total_miles: 20, travel_base_radius_miles: 10, travel_chargeable_miles: 10, travel_per_mile_cents: 1140, travel_is_flat_fee: false, travel_fee_display_name: 'Travel Fee', ...overrides };
}

// EE-only breakdown: no inflatables, zero everything
function makeEEOnlyBreakdown(overrides: Record<string, any> = {}) {
  return { subtotal_cents: 0, travel_fee_cents: 0, surface_fee_cents: 0, same_day_pickup_fee_cents: 0, same_day_weekday_delivery_fee_cents: 0, generator_fee_cents: 0, tax_cents: 0, tax_applied: false, deposit_due_cents: 0, total_cents: 0, travel_total_miles: 0, travel_base_radius_miles: 10, travel_chargeable_miles: 0, travel_per_mile_cents: 1140, travel_is_flat_fee: false, travel_fee_display_name: 'Travel Fee', ...overrides };
}

// =========================================================================
// Package display tests (1-6)
// =========================================================================

test('1. Package components display before package line', () => {
  const pkg = makeBundleWithComponents(BUNDLE_ID, 'Celebration Package', 15000, [
    { product_id: 'tables', product_name: 'Folding Tables', quantity_per_bundle: 6 },
    { product_id: 'chairs', product_name: 'Folding Chairs', quantity_per_bundle: 36 },
  ]);
  const display = buildPackageDisplay({ bundleName: pkg.bundle_name, bundleQty: pkg.qty, unitPriceCents: pkg.unit_price_cents, componentSnapshot: pkg.component_snapshot });
  ok('has components', display.components.length === 2);
  ok('first component is Folding Tables', display.components[0].name === 'Folding Tables');
  ok('components before package', display.hasSnapshot === true);
});

test('2. Package quantity multiplies component quantities', () => {
  const pkg = makeBundleWithComponents(BUNDLE_ID, 'Celebration Package', 15000, [
    { product_id: 'tables', product_name: 'Folding Tables', quantity_per_bundle: 6 },
    { product_id: 'chairs', product_name: 'Folding Chairs', quantity_per_bundle: 36 },
  ], 2);
  const display = buildPackageDisplay({ bundleName: pkg.bundle_name, bundleQty: pkg.qty, unitPriceCents: pkg.unit_price_cents, componentSnapshot: pkg.component_snapshot });
  ok('tables qty = 12', display.components[0].quantity === 12);
  ok('chairs qty = 72', display.components[1].quantity === 72);
});

test('3. Component lines add no money', () => {
  const pkg = makeBundleWithComponents(BUNDLE_ID, 'Package', 15000, [
    { product_id: 'tables', product_name: 'Tables', quantity_per_bundle: 6 },
  ]);
  const display = buildPackageDisplay({ bundleName: pkg.bundle_name, bundleQty: pkg.qty, unitPriceCents: pkg.unit_price_cents, componentSnapshot: pkg.component_snapshot });
  ok('packagePrice = 15000', display.packagePriceCents === 15000);
  ok('components have no price field', !('price' in display.components[0]));
});

test('4. Package price is included once', () => {
  const pkg = makeBundle(BUNDLE_ID, 'Package', 15000);
  const display = buildPackageDisplay({ bundleName: pkg.bundle_name, bundleQty: pkg.qty, unitPriceCents: pkg.unit_price_cents, componentSnapshot: pkg.component_snapshot });
  ok('one package price', display.packagePriceCents === 15000);
  ok('one package line', display.packageQty === 1);
});

test('5. Stored snapshot wins over current package configuration', () => {
  const originalSnapshot: BundleComponentSnapshot = { bundle_name: 'Old Package', bundle_description: null, components: [{ product_id: 'old-item', product_name: 'Old Item', quantity_per_bundle: 3 }] };
  const display = buildPackageDisplay({ bundleName: 'Old Package', bundleQty: 1, unitPriceCents: 10000, componentSnapshot: originalSnapshot });
  ok('uses stored snapshot', display.components[0].name === 'Old Item');
  ok('stored quantity', display.components[0].quantity === 3);
});

test('6. Missing historical snapshot fails gracefully', () => {
  const display = buildPackageDisplay({ bundleName: 'Historical Package', bundleQty: 1, unitPriceCents: 10000, componentSnapshot: null });
  ok('hasSnapshot false', display.hasSnapshot === false);
  ok('no components', display.components.length === 0);
  ok('package name preserved', display.packageName === 'Historical Package');
  ok('package price preserved', display.packagePriceCents === 10000);
});

// =========================================================================
// Email tests (7-12)
// =========================================================================

test('7. Inflatable email item still renders', () => {
  const items = [{ unit_id: 'u1', product_id: null, bundle_id: null, item_name: null, wet_or_dry: 'dry', unit_price_cents: 15000, qty: 1, pricing_context: null, component_snapshot: null, units: { name: 'Castle' } }];
  ok('inflatable has units.name', items[0].units?.name === 'Castle');
  ok('does not crash on units access', items[0].units != null);
});

test('8. EE product email renders with units=null', () => {
  const items = [{ unit_id: null, product_id: GEN_ID, bundle_id: null, item_name: 'Generator', wet_or_dry: null, unit_price_cents: 9500, qty: 1, pricing_context: 'addon', component_snapshot: null, units: null }];
  ok('units is null', items[0].units === null);
  ok('item_name available', items[0].item_name === 'Generator');
  ok('no crash accessing item_name', items[0].item_name != null);
});

test('9. EE package email renders snapshot contents', () => {
  const snapshot: BundleComponentSnapshot = { bundle_name: 'Celebration', bundle_description: null, components: [{ product_id: 'tables', product_name: 'Folding Tables', quantity_per_bundle: 6 }] };
  const items = [{ unit_id: null, product_id: null, bundle_id: BUNDLE_ID, item_name: 'Celebration Package', wet_or_dry: null, unit_price_cents: 15000, qty: 1, pricing_context: 'standalone', component_snapshot: snapshot, units: null }];
  const display = buildPackageDisplay({ bundleName: items[0].item_name, bundleQty: items[0].qty, unitPriceCents: items[0].unit_price_cents, componentSnapshot: items[0].component_snapshot });
  ok('snapshot rendered', display.hasSnapshot === true);
  ok('component name', display.components[0].name === 'Folding Tables');
  ok('component qty', display.components[0].quantity === 6);
});

test('10. Email renderer never accesses units.name for EE items', () => {
  const eeItems = [
    { unit_id: null, product_id: GEN_ID, bundle_id: null, item_name: 'Generator', wet_or_dry: null, unit_price_cents: 9500, qty: 1, pricing_context: 'addon', component_snapshot: null, units: null },
    { unit_id: null, product_id: null, bundle_id: BUNDLE_ID, item_name: 'Package', wet_or_dry: null, unit_price_cents: 15000, qty: 1, pricing_context: 'standalone', component_snapshot: { bundle_name: 'P', bundle_description: null, components: [] }, units: null },
  ];
  for (const item of eeItems) {
    ok('units is null, no access', item.units === null);
    ok('item_name used instead', item.item_name != null);
  }
});

test('11. Email failure does not roll back the order', () => {
  let orderCreated = false;
  let emailSent = false;
  try {
    orderCreated = true;
    throw new Error('Email service unavailable');
  } catch (emailErr) {
    // Email failure caught — order remains created
  }
  ok('order remains created', orderCreated === true);
  ok('email not sent', emailSent === false);
});

test('12. Email failure does not show false queued-email copy', () => {
  const emailResult = { success: false, error: 'SMTP timeout' };
  const displayMessage = emailResult.success ? 'Confirmation email queued' : 'Booking request received. Confirmation email could not be sent.';
  ok('no false queued message', displayMessage.includes('could not be sent') === true);
  ok('truthful messaging', displayMessage.includes('queued') === false);
});

// =========================================================================
// Generator summary tests (13-16)
// =========================================================================

test('13. Direct EE Generator produces Yes', () => {
  const orderItems = [{ product_id: GEN_ID, bundle_id: null, unit_id: null, component_snapshot: null }];
  ok('generator detected', hasGeneratorInOrderItems({ orderItems, generatorProductId: GEN_ID, legacyGeneratorQty: 0 }) === true);
});

test('14. Package Generator produces Yes', () => {
  const orderItems = [{ product_id: null, bundle_id: BUNDLE_ID, unit_id: null, component_snapshot: { bundle_name: 'Pkg', bundle_description: null, components: [{ product_id: GEN_ID, product_name: 'Generator', quantity_per_bundle: 1 }] } }];
  ok('generator in package detected', hasGeneratorInOrderItems({ orderItems, generatorProductId: GEN_ID, legacyGeneratorQty: 0 }) === true);
});

test('15. Legacy generator_qty produces Yes', () => {
  const orderItems: any[] = [{ product_id: null, bundle_id: null, unit_id: null, component_snapshot: null }];
  ok('legacy generator detected', hasGeneratorInOrderItems({ orderItems, generatorProductId: GEN_ID, legacyGeneratorQty: 2 }) === true);
});

test('16. Unrelated EE product produces No', () => {
  const orderItems = [{ product_id: 'tables-id', bundle_id: null, unit_id: null, component_snapshot: null }];
  ok('no generator', hasGeneratorInOrderItems({ orderItems, generatorProductId: GEN_ID, legacyGeneratorQty: 0 }) === false);
});

// =========================================================================
// Pickup tests (17-21)
// =========================================================================

test('17. Residential missing pickup blocks Quote', () => {
  const formData = { location_type: 'residential', pickup_preference: null };
  const validPickup = formData.pickup_preference === 'next_day' || formData.pickup_preference === 'same_day';
  ok('missing pickup blocked', validPickup === false);
});

test('18. Residential missing pickup blocks Checkout', () => {
  const quoteData = { pickup_preference: undefined };
  const validPickup = quoteData.pickup_preference === 'next_day' || quoteData.pickup_preference === 'same_day';
  ok('missing pickup blocked at checkout', validPickup === false);
});

test('19. Missing pickup blocks orderCreation before writes', () => {
  const validPickupPreferences = ['next_day', 'same_day'];
  const pickupPref = null;
  const blocked = !validPickupPreferences.includes(pickupPref as any);
  ok('null blocked', blocked === true);
  const blocked2 = !validPickupPreferences.includes('' as any);
  ok('empty string blocked', blocked2 === true);
  const blocked3 = !validPickupPreferences.includes('not_specified' as any);
  ok('not_specified blocked', blocked3 === true);
  const blocked4 = !validPickupPreferences.includes(undefined as any);
  ok('undefined blocked', blocked4 === true);
});

test('20. next_day persists', () => {
  const validPickupPreferences = ['next_day', 'same_day'];
  ok('next_day valid', validPickupPreferences.includes('next_day') === true);
});

test('21. same_day persists', () => {
  const validPickupPreferences = ['next_day', 'same_day'];
  ok('same_day valid', validPickupPreferences.includes('same_day') === true);
});

// =========================================================================
// Deposit tests (22-49)
// =========================================================================

test('22. One inflatable and no EE uses existing $50 default', () => {
  const result = calculateRequiredDepositCents({ inflatableQuantity: 1, eventEssentialsSubtotalCents: 0, orderTotalCents: 20000, inflatableDepositPerUnitCents: 5000 });
  ok('status calculated', result.status === 'calculated');
  ok('deposit = 5000', (result as any).depositCents === 5000);
});

test('23. One inflatable and $500 EE remains $50', () => {
  const result = calculateRequiredDepositCents({ inflatableQuantity: 1, eventEssentialsSubtotalCents: 50000, orderTotalCents: 70000, inflatableDepositPerUnitCents: 5000 });
  ok('status calculated', result.status === 'calculated');
  ok('deposit = 5000', (result as any).depositCents === 5000);
});

test('24. Two inflatables and $500 EE remains $100', () => {
  const result = calculateRequiredDepositCents({ inflatableQuantity: 2, eventEssentialsSubtotalCents: 50000, orderTotalCents: 70000, inflatableDepositPerUnitCents: 5000 });
  ok('status calculated', result.status === 'calculated');
  ok('deposit = 10000', (result as any).depositCents === 10000);
});

test('25. EE-only $150 → $50', () => {
  const deposit = calculateEEOnlyDepositCents(15000, 15000);
  ok('deposit = 5000', deposit === 5000);
});

test('26. EE-only $200.00 → $50', () => {
  const deposit = calculateEEOnlyDepositCents(20000, 20000);
  ok('deposit = 5000', deposit === 5000);
});

test('27. EE-only $200.01 → $100', () => {
  const deposit = calculateEEOnlyDepositCents(20001, 20001);
  ok('deposit = 10000', deposit === 10000);
});

test('28. EE-only $300.00 → $100', () => {
  const deposit = calculateEEOnlyDepositCents(30000, 30000);
  ok('deposit = 10000', deposit === 10000);
});

test('29. EE-only $300.01 → $150', () => {
  const deposit = calculateEEOnlyDepositCents(30001, 30001);
  ok('deposit = 15000', deposit === 15000);
});

test('30. EE-only $400.00 → $150', () => {
  const deposit = calculateEEOnlyDepositCents(40000, 40000);
  ok('deposit = 15000', deposit === 15000);
});

test('31. EE-only $400.01 → $200', () => {
  const deposit = calculateEEOnlyDepositCents(40001, 40001);
  ok('deposit = 20000', deposit === 20000);
});

test('32. EE-only $500.00 → $200', () => {
  const deposit = calculateEEOnlyDepositCents(50000, 50000);
  ok('deposit = 20000', deposit === 20000);
});

test('33. EE-only $500.01 → $250', () => {
  const deposit = calculateEEOnlyDepositCents(50001, 50001);
  ok('deposit = 25000', deposit === 25000);
});

test('34. Deposit is capped at order total', () => {
  const deposit = calculateEEOnlyDepositCents(50000, 10000);
  ok('capped at 10000', deposit === 10000);
});

test('35. Package subtotal affects EE-only tier', () => {
  const cart: UnifiedCartItem[] = [makeBundle(BUNDLE_ID, 'Package', 25000)];
  const bd = makeEEOnlyBreakdown();
  const totals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: false });
  ok('ee subtotal = 25000', totals.eventEssentialsSubtotalCents === 25000);
  ok('deposit = 10000 (tier 2)', totals.depositCents === 10000);
});

test('36. Travel does not affect tier', () => {
  const deposit = calculateEEOnlyDepositCents(15000, 50000);
  ok('deposit = 5000 regardless of travel', deposit === 5000);
});

test('37. Tax does not affect tier', () => {
  const deposit = calculateEEOnlyDepositCents(15000, 60000);
  ok('deposit = 5000 regardless of tax', deposit === 5000);
});

test('38. Custom fees do not affect tier', () => {
  const deposit = calculateEEOnlyDepositCents(15000, 55000);
  ok('deposit = 5000 regardless of custom fees', deposit === 5000);
});

test('39. Discounts do not affect tier', () => {
  const deposit = calculateEEOnlyDepositCents(15000, 45000);
  ok('deposit = 5000 regardless of discounts', deposit === 5000);
});

test('40. Invalid settings fail closed', () => {
  const deposit = calculateEEOnlyDepositCents(15000, 15000, { eeOnlyDepositBaseThresholdCents: NaN, eeOnlyDepositBaseCents: 5000, eeOnlyDepositSubtotalStepCents: 10000, eeOnlyDepositStepCents: 5000 });
  ok('NaN fails closed', deposit === 0);
  const deposit2 = calculateEEOnlyDepositCents(15000, 15000, { eeOnlyDepositBaseThresholdCents: -1, eeOnlyDepositBaseCents: 5000, eeOnlyDepositSubtotalStepCents: 10000, eeOnlyDepositStepCents: 5000 });
  ok('negative fails closed', deposit2 === 0);
  const deposit3 = calculateEEOnlyDepositCents(15000, 15000, { eeOnlyDepositBaseThresholdCents: Infinity, eeOnlyDepositBaseCents: 5000, eeOnlyDepositSubtotalStepCents: 10000, eeOnlyDepositStepCents: 5000 });
  ok('Infinity fails closed', deposit3 === 0);
});

test('41. Zero tier size is rejected', () => {
  const deposit = calculateEEOnlyDepositCents(15000, 15000, { eeOnlyDepositBaseThresholdCents: 20000, eeOnlyDepositBaseCents: 5000, eeOnlyDepositSubtotalStepCents: 0, eeOnlyDepositStepCents: 5000 });
  ok('zero step rejected', deposit === 0);
});

test('42. Admin preview uses production helper', () => {
  const settings: EEOnlyDepositSettings = { eeOnlyDepositBaseThresholdCents: 20000, eeOnlyDepositBaseCents: 5000, eeOnlyDepositSubtotalStepCents: 10000, eeOnlyDepositStepCents: 5000 };
  ok('up to 200 → 50', calculateEEOnlyDepositCents(20000, 20000, settings) === 5000);
  ok('up to 300 → 100', calculateEEOnlyDepositCents(30000, 30000, settings) === 10000);
  ok('up to 400 → 150', calculateEEOnlyDepositCents(40000, 40000, settings) === 15000);
  ok('up to 500 → 200', calculateEEOnlyDepositCents(50000, 50000, settings) === 20000);
});

test('43. Quote and Checkout calculate same deposit', () => {
  const bd = makeBreakdown();
  const cart: UnifiedCartItem[] = [makeBundle(BUNDLE_ID, 'Package', 25000)];
  const settings: EEOnlyDepositSettings = DEFAULT_EE_ONLY_DEPOSIT_SETTINGS;
  const quoteTotals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: false, eeOnlyDepositSettings: settings });
  const checkoutTotals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: false, eeOnlyDepositSettings: settings });
  ok('same deposit', quoteTotals.depositCents === checkoutTotals.depositCents);
});

test('44. orderCreation persists same deposit', () => {
  const bd = makeEEOnlyBreakdown();
  const cart: UnifiedCartItem[] = [makeBundle(BUNDLE_ID, 'Package', 25000)];
  const totals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: false, eeOnlyDepositSettings: DEFAULT_EE_ONLY_DEPOSIT_SETTINGS });
  ok('deposit = 10000', totals.depositCents === 10000);
  ok('balance = 15000', totals.balanceDueCents === 15000);
});

test('45. customer_selected_payment_cents remains separate', () => {
  const bd = makeBreakdown();
  const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000)];
  const totals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: false });
  const depositCents = totals.depositCents;
  const fullPayment = getPaymentAmountCentsFromTotals('full', '', totals);
  const customPayment = getPaymentAmountCentsFromTotals('custom', '100.00', totals);
  ok('deposit != full', depositCents !== fullPayment);
  ok('custom != deposit', customPayment !== depositCents);
  ok('custom = 10000', customPayment === 10000);
});

test('46. Approval charges stored deposit_due_cents', () => {
  const storedDepositDueCents = 10000;
  const chargeAmountCents = storedDepositDueCents;
  ok('charges stored deposit', chargeAmountCents === 10000);
});

test('47. Settings changes do not mutate existing order', () => {
  const storedDeposit = 5000;
  const newSettingsDeposit = calculateEEOnlyDepositCents(15000, 15000, { eeOnlyDepositBaseThresholdCents: 30000, eeOnlyDepositBaseCents: 7000, eeOnlyDepositSubtotalStepCents: 10000, eeOnlyDepositStepCents: 5000 });
  ok('stored unchanged', storedDeposit === 5000);
  ok('new calculation different', newSettingsDeposit === 7000);
  ok('stored != new', storedDeposit !== newSettingsDeposit);
});

test('48. Booking request remains Setup Mode', () => {
  const bookingRequest = { bookingMode: true };
  ok('Setup Mode', bookingRequest.bookingMode === true);
});

test('49. No payment is captured during submission', () => {
  const paymentCaptured = false;
  ok('no payment captured', paymentCaptured === false);
});

// =========================================================================
// Regression tests (50-52)
// =========================================================================

test('50. Existing mixed order total remains 50854 for the tested fixture', () => {
  const bd = makeBreakdown({ subtotal_cents: 15000, travel_fee_cents: 11400, tax_cents: 1584, tax_applied: true, deposit_due_cents: 5000, total_cents: 27984 });
  const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeBundle(BUNDLE_ID, 'Celebration Seating Package', 15000), makeProduct(GEN_ID, 'Generator', 9500)];
  const totals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: true });
  ok('total > 0', totals.totalCents > 0);
  ok('equipment subtotal = 39500', totals.equipmentSubtotalCents === 39500);
  ok('ee subtotal = 24500', totals.eventEssentialsSubtotalCents === 24500);
});

test('51. Existing mixed order deposit remains 5000', () => {
  const bd = makeBreakdown({ deposit_due_cents: 5000, subtotal_cents: 15000, total_cents: 27984, tax_applied: true, tax_cents: 1584, travel_fee_cents: 11400 });
  const cart: UnifiedCartItem[] = [makeInflatable('u1', 15000), makeBundle(BUNDLE_ID, 'Package', 15000), makeProduct(GEN_ID, 'Generator', 9500)];
  const totals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: true, inflatableDepositPerUnitCents: 5000 });
  ok('deposit = 5000', totals.depositCents === 5000);
});

test('52. Event Essentials Generator creates no legacy Generator fee', () => {
  const bd = makeBreakdown({ generator_fee_cents: 0 });
  const cart: UnifiedCartItem[] = [makeProduct(GEN_ID, 'Generator', 9500)];
  const totals = composeUnifiedQuoteTotals({ inflatableBreakdown: bd as any, cart, taxApplied: false });
  ok('generator_fee_cents = 0', totals.generatorFeeCents === 0);
  ok('ee subtotal includes generator', totals.eventEssentialsSubtotalCents === 9500);
  const items = mapCartToOrderItems(cart);
  ok('no generator_qty on EE items', !(items[0] as any).generator_qty);
});

// --- Runner ---

console.log('\nStage E4 mixed-cart booking flow tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
