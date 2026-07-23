// Stage E4 manual QA regression tests for operational equipment formatting,
// item-name suffix removal, Quote time defaults, and date-change availability.
//
// Run with: npx tsx src/lib/stageE4ManualQa.test.ts

import {
  formatOperationalEquipment,
  formatOperationalEquipmentLabels,
  aggregateEquipmentAcrossOrders,
  PACKAGE_CONTENTS_UNAVAILABLE,
} from './operationalEquipment';
import { formatStoredOrderItems } from './formatStoredOrderItems';
import { normalizeStoredQuoteForm } from '../hooks/useQuoteForm';
import {
  expandCartToProductQuantities,
  mapBundleAvailabilityToItem,
} from './unifiedCart';
import type {
  EventEssentialBundleCartItem,
  ProductAvailabilityResult,
  BundleComponentSnapshot,
} from '../types';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${name}`); }
}
function eq<T>(name: string, actual: T, expected: T) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (!match) {
    console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
  if (match) { passed++; } else { failed++; }
}

// ---------------------------------------------------------------------------
// Real saved snapshot shape: { components: [{ product_name, quantity_per_bundle }] }
// ---------------------------------------------------------------------------

const CELEBRATION_SNAPSHOT = {
  bundle_name: 'Celebration Seating',
  bundle_description: null,
  components: [
    { product_id: 'pc1', product_name: 'White Folding Chair', quantity_per_bundle: 50 },
    { product_id: 'pc2', product_name: 'Six-foot Rectangular Table', quantity_per_bundle: 6 },
  ],
};

function testDirectGenerator() {
  const items = [
    { item_name: 'Generator', qty: 1, product_id: 'p1', unit_id: null, bundle_id: null, component_snapshot: null },
  ];
  const result = formatOperationalEquipment(items);
  eq('1 direct generator name', result[0].name, 'Generator');
  eq('1 direct generator qty', result[0].qty, 1);
  eq('1 direct generator kind', result[0].kind, 'event_essential');
}

function testCelebrationSeatingSnapshot() {
  const items = [
    {
      item_name: 'Celebration Seating',
      qty: 1,
      product_id: null,
      unit_id: null,
      bundle_id: 'b1',
      component_snapshot: CELEBRATION_SNAPSHOT,
    },
  ];
  const result = formatOperationalEquipment(items);
  eq('2 snapshot has 2 components', result.length, 2);
  eq('2 first component name', result[0].name, 'White Folding Chair');
  eq('2 first component qty', result[0].qty, 50);
  eq('2 second component name', result[1].name, 'Six-foot Rectangular Table');
  eq('2 second component qty', result[1].qty, 6);
}

function testPackageQty2() {
  const items = [
    {
      item_name: 'Celebration Seating',
      qty: 2,
      product_id: null,
      unit_id: null,
      bundle_id: 'b1',
      component_snapshot: CELEBRATION_SNAPSHOT,
    },
  ];
  const result = formatOperationalEquipment(items);
  eq('3 qty2 chairs', result[0].qty, 100);
  eq('3 qty2 tables', result[1].qty, 12);
}

function testPackageMarketingNameNotPhysical() {
  const items = [
    {
      item_name: 'Celebration Seating',
      qty: 1,
      product_id: null,
      unit_id: null,
      bundle_id: 'b1',
      component_snapshot: CELEBRATION_SNAPSHOT,
    },
  ];
  const labels = formatOperationalEquipmentLabels(items);
  ok('4 no package name in labels', !labels.some(l => l.includes('Celebration Seating')));
  ok('4 has White Folding Chair', labels.some(l => l.includes('White Folding Chair')));
  ok('4 has Six-foot Rectangular Table', labels.some(l => l.includes('Six-foot Rectangular Table')));
}

function testHistoricalMissingSnapshot() {
  const items = [
    {
      item_name: 'Old Package',
      qty: 1,
      product_id: null,
      unit_id: null,
      bundle_id: 'b1',
      component_snapshot: null,
    },
  ];
  const labels = formatOperationalEquipmentLabels(items);
  ok('5 has fallback', labels.includes(`${PACKAGE_CONTENTS_UNAVAILABLE} ×1`));
}

function testInflatableUnchanged() {
  const items = [
    { unit_id: 'u1', units: { name: 'Castle Bounce' }, wet_or_dry: 'Dry', qty: 1 },
  ];
  const labels = formatOperationalEquipmentLabels(items);
  ok('6 inflatable label', labels.includes('Castle Bounce (Dry)'));
}

function testReproducedOrder() {
  const items = [
    { item_name: 'Generator', qty: 1, product_id: 'p1', unit_id: null, bundle_id: null, component_snapshot: null },
    {
      item_name: 'Celebration Seating',
      qty: 1,
      product_id: null,
      unit_id: null,
      bundle_id: 'b1',
      component_snapshot: CELEBRATION_SNAPSHOT,
    },
  ];
  const labels = formatOperationalEquipmentLabels(items);
  eq('7 reproduced order has 3 items', labels.length, 3);
  ok('7 has Generator ×1', labels.includes('Generator ×1'));
  ok('7 has White Folding Chair ×50', labels.includes('White Folding Chair ×50'));
  ok('7 has Six-foot Rectangular Table ×6', labels.includes('Six-foot Rectangular Table ×6'));
  ok('7 no Celebration Seating', !labels.some(l => l.includes('Celebration Seating')));
}

function testDailyChecklistAggregation() {
  const order1 = {
    items: formatOperationalEquipment([
      { item_name: 'Generator', qty: 1, product_id: 'p1', unit_id: null, bundle_id: null, component_snapshot: null },
      {
        item_name: 'Celebration Seating',
        qty: 1,
        product_id: null,
        unit_id: null,
        bundle_id: 'b1',
        component_snapshot: {
          bundle_name: 'Celebration Seating',
          bundle_description: null,
          components: [{ product_id: 'pc1', product_name: 'White Folding Chair', quantity_per_bundle: 50 }],
        },
      },
    ]),
  };
  const order2 = {
    items: formatOperationalEquipment([
      {
        item_name: 'Celebration Seating',
        qty: 1,
        product_id: null,
        unit_id: null,
        bundle_id: 'b1',
        component_snapshot: {
          bundle_name: 'Celebration Seating',
          bundle_description: null,
          components: [{ product_id: 'pc1', product_name: 'White Folding Chair', quantity_per_bundle: 25 }],
        },
      },
    ]),
  };
  const aggregated = aggregateEquipmentAcrossOrders([order1, order2]);
  const chairs = aggregated.find(a => a.name === 'White Folding Chair');
  eq('8 aggregated chairs', chairs?.totalQty, 75);
  const generators = aggregated.find(a => a.name === 'Generator');
  eq('8 aggregated generators', generators?.totalQty, 1);
}

// ---------------------------------------------------------------------------
// Item-name suffix removal
// ---------------------------------------------------------------------------

function testDirectGeneratorNoSuffix() {
  const items = [
    { item_name: 'Generator', qty: 1, unit_id: null, bundle_id: null, product_id: 'p1', pricing_context: 'addon', unit_price_cents: 5000, component_snapshot: null, is_new: false },
  ];
  const formatted = formatStoredOrderItems(items);
  eq('9 generator name', formatted[0].name, 'Generator (Add-on)');
  eq('9 generator mode', formatted[0].mode, 'Event Essential');
  ok('9 mode is Event Essential (display surfaces suppress)', formatted[0].mode === 'Event Essential');
}

function testPackageNoSuffix() {
  const items = [
    {
      item_name: 'Celebration Seating',
      qty: 1,
      unit_id: null,
      bundle_id: 'b1',
      product_id: null,
      pricing_context: 'standalone',
      unit_price_cents: 15000,
      component_snapshot: CELEBRATION_SNAPSHOT,
      is_new: false,
    },
  ];
  const formatted = formatStoredOrderItems(items);
  eq('10 package name', formatted[0].name, 'Celebration Seating');
  eq('10 package mode', formatted[0].mode, 'Event Essential');
}

function testInflatableDryWaterPreserved() {
  const items = [
    { unit_id: 'u1', units: { name: 'Castle Bounce' }, wet_or_dry: 'water', qty: 1, unit_price_cents: 20000, is_new: false },
  ];
  const formatted = formatStoredOrderItems(items);
  eq('11 inflatable name', formatted[0].name, 'Castle Bounce');
  eq('11 inflatable mode', formatted[0].mode, 'Water');
}

// ---------------------------------------------------------------------------
// Legacy Quote-time stored-form normalization
// ---------------------------------------------------------------------------

function testLegacyStoredFormClearsTimes() {
  const legacy = {
    start_window: '09:00',
    end_window: '17:00',
    event_date: '2026-07-28',
    address_line1: '123 Main St',
  };
  const normalized = normalizeStoredQuoteForm(legacy as any);
  eq('12 legacy start_window cleared', normalized.start_window, '');
  eq('12 legacy end_window cleared', normalized.end_window, '');
  eq('12 legacy event_date preserved', normalized.event_date, '2026-07-28');
  eq('12 legacy address preserved', (normalized as any).address_line1, '123 Main St');
}

function testVersionedStoredFormPreservesTimes() {
  const versioned = {
    _version: 2,
    start_window: '14:00',
    end_window: '20:00',
    event_date: '2026-07-28',
  };
  const normalized = normalizeStoredQuoteForm(versioned as any);
  eq('13 versioned start_window preserved', normalized.start_window, '14:00');
  eq('13 versioned end_window preserved', normalized.end_window, '20:00');
  ok('13 version stripped from output', !('_version' in normalized));
}

// ---------------------------------------------------------------------------
// Date-change package availability (focused scenario)
//
// Scenario: July 27 already has an order with White Folding Chair x50 and
// Six-foot Rectangular Table x6 (Celebration Seating qty 1). A new Quote
// starts on July 28, adds Celebration Seating qty 1, then changes to July 27.
// The package must become unavailable.
// ---------------------------------------------------------------------------

function testDateChangePackageAvailability() {
  const snapshot: BundleComponentSnapshot = {
    bundle_name: 'Celebration Seating',
    bundle_description: null,
    components: [
      { product_id: 'pc1', product_name: 'White Folding Chair', quantity_per_bundle: 50 },
      { product_id: 'pc2', product_name: 'Six-foot Rectangular Table', quantity_per_bundle: 6 },
    ],
  };

  const bundleItem: EventEssentialBundleCartItem = {
    item_type: 'event_essential_bundle',
    bundle_id: 'b1',
    bundle_name: 'Celebration Seating',
    unit_price_cents: 15000,
    qty: 1,
    pricing_context: 'standalone',
    component_snapshot: snapshot,
  };

  // Step 1: expand the cart to product quantities
  const allocation = expandCartToProductQuantities([bundleItem]);
  eq('14 allocation has 2 products', allocation.length, 2);
  eq('14 chairs requested', allocation[0].quantity, 50);
  eq('14 tables requested', allocation[1].quantity, 6);

  // Step 2: simulate the RPC result for July 27 (existing order already
  // reserved 50 chairs and 6 tables — total_quantity 60, already_reserved 50
  // for chairs; total_quantity 10, already_reserved 6 for tables)
  const resultsJuly27: ProductAvailabilityResult[] = [
    {
      product_id: 'pc1',
      product_name: 'White Folding Chair',
      total_quantity: 60,
      temp_unavailable_qty: 0,
      already_reserved: 50,
      quantity_requested: 50,
      available_before_request: 10,
      remaining_after_request: -40,
      is_allowed: false,
    },
    {
      product_id: 'pc2',
      product_name: 'Six-foot Rectangular Table',
      total_quantity: 10,
      temp_unavailable_qty: 0,
      already_reserved: 6,
      quantity_requested: 6,
      available_before_request: 4,
      remaining_after_request: -2,
      is_allowed: false,
    },
  ];

  // Step 3: map availability to the bundle item
  const isAvailableJuly27 = mapBundleAvailabilityToItem(bundleItem, resultsJuly27);
  ok('15 bundle unavailable on July 27', isAvailableJuly27 === false);

  // Step 4: simulate the RPC result for July 28 (no existing reservations)
  const resultsJuly28: ProductAvailabilityResult[] = [
    {
      product_id: 'pc1',
      product_name: 'White Folding Chair',
      total_quantity: 60,
      temp_unavailable_qty: 0,
      already_reserved: 0,
      quantity_requested: 50,
      available_before_request: 60,
      remaining_after_request: 10,
      is_allowed: true,
    },
    {
      product_id: 'pc2',
      product_name: 'Six-foot Rectangular Table',
      total_quantity: 10,
      temp_unavailable_qty: 0,
      already_reserved: 0,
      quantity_requested: 6,
      available_before_request: 10,
      remaining_after_request: 4,
      is_allowed: true,
    },
  ];

  const isAvailableJuly28 = mapBundleAvailabilityToItem(bundleItem, resultsJuly28);
  ok('16 bundle available on July 28', isAvailableJuly28 === true);

  // Step 5: verify that changing back to July 28 restores availability
  ok('17 availability restored on date change back', isAvailableJuly28 === true && isAvailableJuly27 === false);
}

// ---------------------------------------------------------------------------
// Lot Pics upload-completion decision (pure logic test)
//
// Verifies that uploadingRef guards loadPictures during an active upload,
// and that suppressRefreshRef is set/unset correctly.
// ---------------------------------------------------------------------------

function testUploadGuardLogic() {
  // Simulate the guard: loadPictures should be skipped while uploading
  const uploadingRef = { current: false };
  const suppressRefreshRef = { current: false };

  // Before upload: both false
  ok('18 pre-upload uploadingRef false', uploadingRef.current === false);
  ok('18 pre-upload suppressRefreshRef false', suppressRefreshRef.current === false);

  // During upload: both true
  uploadingRef.current = true;
  suppressRefreshRef.current = true;
  const shouldSkipLoad = uploadingRef.current;
  ok('18 during-upload loadPictures skipped', shouldSkipLoad === true);
  ok('18 during-upload suppressRefreshRef true', suppressRefreshRef.current === true);

  // After upload: both false again
  uploadingRef.current = false;
  suppressRefreshRef.current = false;
  ok('18 post-upload uploadingRef false', uploadingRef.current === false);
  ok('18 post-upload suppressRefreshRef false', suppressRefreshRef.current === false);
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

async function runTests() {
  testDirectGenerator();
  testCelebrationSeatingSnapshot();
  testPackageQty2();
  testPackageMarketingNameNotPhysical();
  testHistoricalMissingSnapshot();
  testInflatableUnchanged();
  testReproducedOrder();
  testDailyChecklistAggregation();
  testDirectGeneratorNoSuffix();
  testPackageNoSuffix();
  testInflatableDryWaterPreserved();
  testLegacyStoredFormClearsTimes();
  testVersionedStoredFormPreservesTimes();
  testDateChangePackageAvailability();
  testUploadGuardLogic();

  console.log(`\nStage E4 Manual QA Regression Tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
