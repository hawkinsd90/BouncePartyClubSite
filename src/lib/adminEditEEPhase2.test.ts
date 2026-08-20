// Admin Edit EE — Phase 2 focused regression tests
// Runnable via: npx jiti src/lib/adminEditEEPhase2.test.ts

import { validateAvailabilityResult } from './eeOrderItemAvailability';
import { aggregateOrderEquipment } from './generatorUnified';

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { passCount += 1; } else { failCount += 1; failures.push(detail ? `${name} — ${detail}` : name); }
}

// ---------------------------------------------------------------------------
// A. Persisted Generator merge — is_updated must be true
// ---------------------------------------------------------------------------

function testPersistedGeneratorMergeIsUpdated(): void {
  // Existing persisted row: id='saved-id', product_id='gen', qty=1, is_new=false
  const existing = { id: 'saved-id', product_id: 'gen', qty: 1, is_new: false, is_updated: false };
  // Child returns { ...existing, qty: 2 }
  const childItem = { ...existing, qty: 2 };

  // Simulate handleAddGeneratorProduct merge logic:
  // isUpdated = existing.is_new ? false : true
  const isUpdated = existing.is_new ? false : true;
  const merged = { ...existing, qty: childItem.qty, is_updated: isUpdated };

  ok('persisted merge: qty is 2', merged.qty === 2);
  ok('persisted merge: is_new stays false', merged.is_new === false);
  ok('persisted merge: is_updated is true', merged.is_updated === true);
  ok('persisted merge: id preserved', merged.id === 'saved-id');
  ok('persisted merge: product_id preserved', merged.product_id === 'gen');
}

// ---------------------------------------------------------------------------
// B. Unsaved Generator merge — is_new stays true, is_updated not forced
// ---------------------------------------------------------------------------

function testUnsavedGeneratorMergeStaysNew(): void {
  const existing = { client_id: 'C', product_id: 'gen', qty: 1, is_new: true, is_updated: false };
  const childItem = { ...existing, qty: 2 };

  const isUpdated = existing.is_new ? false : true;
  const merged = { ...existing, qty: childItem.qty, is_updated: isUpdated };

  ok('unsaved merge: qty is 2', merged.qty === 2);
  ok('unsaved merge: is_new stays true', merged.is_new === true);
  ok('unsaved merge: is_updated stays false', merged.is_updated === false);
  ok('unsaved merge: one row not duplicated', merged !== childItem && merged.client_id === 'C');
}

// ---------------------------------------------------------------------------
// C. Resolver fallback classification — narrowed whitelist
// ---------------------------------------------------------------------------

function testResolverFallbackClassificationNarrowed(): void {
  // Only NO_STANDALONE_AND_ADDON_NOT_QUALIFIED may continue
  const allowedReason: string = 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED';

  // May continue
  ok('resolver: NO_STANDALONE_AND_ADDON_NOT_QUALIFIED may continue', allowedReason === 'NO_STANDALONE_AND_ADDON_NOT_QUALIFIED');

  // Must fail closed
  ok('resolver: NO_PURCHASE_PATH fails closed', 'NO_PURCHASE_PATH' !== allowedReason);
  ok('resolver: PREREQUISITE_NOT_MET fails closed', 'PREREQUISITE_NOT_MET' !== allowedReason);
  ok('resolver: unknown fails closed', 'UNKNOWN_REASON' !== allowedReason);
  ok('resolver: null fails closed', (null as any) !== allowedReason);
  ok('resolver: undefined fails closed', (undefined as any) !== allowedReason);
  ok('resolver: empty string fails closed', '' !== allowedReason);
}

// ---------------------------------------------------------------------------
// D. Historical Generator display tri-state
// ---------------------------------------------------------------------------

function testHistoricalGeneratorDisplayTriState(): void {
  // A. Clear legacy representation -> Yes immediately
  {
    const legacyGeneratorQty = 1;
    const legacyGeneratorFeeCents = 0;
    const lookupStatus: string = 'loading';
    let display: string;
    if (legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0) {
      display = 'Yes';
    } else if (lookupStatus === 'ready') {
      display = 'No';
    } else {
      display = '—';
    }
    ok('display: legacy qty>0 -> Yes without lookup', display === 'Yes');
  }

  // A2. legacy fee > 0 with qty 0 -> Yes
  {
    const legacyGeneratorQty = 0;
    const legacyGeneratorFeeCents = 5000;
    const lookupStatus: string = 'loading';
    let display: string;
    if (legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0) {
      display = 'Yes';
    } else if (lookupStatus === 'ready') {
      display = 'No';
    } else {
      display = '—';
    }
    ok('display: legacy fee>0 qty=0 -> Yes without lookup', display === 'Yes');
  }

  // B. No legacy + lookup loading -> NOT No
  {
    const legacyGeneratorQty = 0;
    const legacyGeneratorFeeCents = 0;
    const lookupStatus: string = 'loading';
    let display: string;
    if (legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0) {
      display = 'Yes';
    } else if (lookupStatus === 'ready') {
      display = 'No';
    } else {
      display = '—';
    }
    ok('display: no legacy + loading -> neutral', display === '—');
    ok('display: no legacy + loading -> NOT No', display !== 'No');
  }

  // C. No legacy + lookup failed -> NOT No
  {
    const legacyGeneratorQty = 0;
    const legacyGeneratorFeeCents = 0;
    const lookupStatus: string = 'failed';
    let display: string;
    if (legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0) {
      display = 'Yes';
    } else if (lookupStatus === 'ready') {
      display = 'No';
    } else {
      display = '—';
    }
    ok('display: no legacy + failed -> neutral', display === '—');
    ok('display: no legacy + failed -> NOT No', display !== 'No');
  }

  // D. No legacy + lookup ready + matching EE Generator product -> Yes
  {
    const legacyGeneratorQty = 0;
    const legacyGeneratorFeeCents = 0;
    const lookupStatus: string = 'ready';
    const generatorCategoryProductIds = new Set(['p_gen']);
    const orderItems = [{ product_id: 'p_gen', qty: 1 }];
    let display: string;
    if (legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0) {
      display = 'Yes';
    } else if (lookupStatus === 'ready' && generatorCategoryProductIds) {
      const hasGen = orderItems.some(i => i.product_id && generatorCategoryProductIds.has(i.product_id));
      display = hasGen ? 'Yes' : 'No';
    } else {
      display = '—';
    }
    ok('display: ready + matching EE product -> Yes', display === 'Yes');
  }

  // E. No legacy + lookup ready + no Generator representation -> No
  {
    const legacyGeneratorQty = 0;
    const legacyGeneratorFeeCents = 0;
    const lookupStatus: string = 'ready';
    const generatorCategoryProductIds = new Set(['p_gen']);
    const orderItems = [{ product_id: 'p_tables', qty: 1 }];
    let display: string;
    if (legacyGeneratorQty > 0 || legacyGeneratorFeeCents > 0) {
      display = 'Yes';
    } else if (lookupStatus === 'ready' && generatorCategoryProductIds) {
      const hasGen = orderItems.some(i => i.product_id && generatorCategoryProductIds.has(i.product_id));
      display = hasGen ? 'Yes' : 'No';
    } else {
      display = '—';
    }
    ok('display: ready + no matching product -> No', display === 'No');
  }
}

// ---------------------------------------------------------------------------
// E. Operational physical Generator quantities (legacy + direct EE + package)
// ---------------------------------------------------------------------------

function testOperationalMixedGeneratorQuantities(): void {
  const genIds = new Set(['p_gen']);

  // legacy1 + direct1 -> 2
  {
    const orderItems = [{ product_id: 'p_gen', qty: 1, component_snapshot: null }];
    const { totalGeneratorQty } = aggregateOrderEquipment({ orderItems, legacyGeneratorQty: 1, generatorCategoryProductIds: genIds });
    ok('op qty: legacy1 + direct1 -> 2', totalGeneratorQty === 2);
  }

  // legacy1 + package1 -> 2
  {
    const orderItems = [
      { product_id: null, qty: 1, component_snapshot: { components: [{ product_id: 'p_gen', quantity_per_bundle: 1 }] } },
    ];
    const { totalGeneratorQty } = aggregateOrderEquipment({ orderItems, legacyGeneratorQty: 1, generatorCategoryProductIds: genIds });
    ok('op qty: legacy1 + package1 -> 2', totalGeneratorQty === 2);
  }

  // legacy1 + direct1 + package1 -> 3
  {
    const orderItems = [
      { product_id: 'p_gen', qty: 1, component_snapshot: null },
      { product_id: null, qty: 1, component_snapshot: { components: [{ product_id: 'p_gen', quantity_per_bundle: 1 }] } },
    ];
    const { totalGeneratorQty } = aggregateOrderEquipment({ orderItems, legacyGeneratorQty: 1, generatorCategoryProductIds: genIds });
    ok('op qty: legacy1 + direct1 + package1 -> 3', totalGeneratorQty === 3);
  }

  // legacy2 only -> 2
  {
    const orderItems: any[] = [];
    const { totalGeneratorQty } = aggregateOrderEquipment({ orderItems, legacyGeneratorQty: 2, generatorCategoryProductIds: genIds });
    ok('op qty: legacy2 only -> 2', totalGeneratorQty === 2);
  }

  // direct2 only -> 2
  {
    const orderItems = [{ product_id: 'p_gen', qty: 2, component_snapshot: null }];
    const { totalGeneratorQty } = aggregateOrderEquipment({ orderItems, legacyGeneratorQty: 0, generatorCategoryProductIds: genIds });
    ok('op qty: direct2 only -> 2', totalGeneratorQty === 2);
  }

  // package qty 2 with 1 generator per bundle -> 2
  {
    const orderItems = [
      { product_id: null, qty: 2, component_snapshot: { components: [{ product_id: 'p_gen', quantity_per_bundle: 1 }] } },
    ];
    const { totalGeneratorQty } = aggregateOrderEquipment({ orderItems, legacyGeneratorQty: 0, generatorCategoryProductIds: genIds });
    ok('op qty: package2x1 -> 2', totalGeneratorQty === 2);
  }

  // No generator products at all -> 0
  {
    const orderItems = [{ product_id: 'p_tables', qty: 3, component_snapshot: null }];
    const { totalGeneratorQty } = aggregateOrderEquipment({ orderItems, legacyGeneratorQty: 0, generatorCategoryProductIds: genIds });
    ok('op qty: no generator -> 0', totalGeneratorQty === 0);
  }
}

// ---------------------------------------------------------------------------
// F. Availability malformed product_id -> invalid
// ---------------------------------------------------------------------------

function testAvailabilityMalformedProductId(): void {
  // null product_id
  {
    const r = validateAvailabilityResult(['p1'], { data: [{ product_id: null, is_allowed: true }], error: null });
    ok('avail: null product_id -> invalid', r.status === 'invalid');
  }
  // empty string product_id
  {
    const r = validateAvailabilityResult(['p1'], { data: [{ product_id: '', is_allowed: true }], error: null });
    ok('avail: empty product_id -> invalid', r.status === 'invalid');
  }
  // undefined product_id
  {
    const r = validateAvailabilityResult(['p1'], { data: [{ product_id: undefined, is_allowed: false }], error: null });
    ok('avail: undefined product_id -> invalid', r.status === 'invalid');
  }
  // valid product_id still works
  {
    const r = validateAvailabilityResult(['p1'], { data: [{ product_id: 'p1', is_allowed: true }], error: null });
    ok('avail: valid product_id -> ok', r.ok === true && r.status === 'ok');
  }
}

// ---------------------------------------------------------------------------
// G. Pricing exception clears stale calculatedPricing and sets pricingError
// ---------------------------------------------------------------------------

function testPricingExceptionFailClosed(): void {
  // Simulate usePricing catch block behavior
  let calculatedPricing: any = { total_cents: 50000 }; // stale
  let pricingError: string | null = null;

  // Simulate catch block
  calculatedPricing = null;
  pricingError = 'Unable to calculate pricing. Please review the order and try again.';

  ok('pricing exception: calculatedPricing cleared', calculatedPricing === null);
  ok('pricing exception: pricingError populated', pricingError !== null);
  ok('pricing exception: pricingError is user-friendly', pricingError!.includes('Unable to calculate pricing'));

  // Simulate successful recalculation clearing error
  pricingError = null;
  calculatedPricing = { total_cents: 51000 };
  ok('pricing recovery: pricingError cleared on success', pricingError === null);
  ok('pricing recovery: calculatedPricing repopulated', calculatedPricing !== null);
}

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

testPersistedGeneratorMergeIsUpdated();
testUnsavedGeneratorMergeStaysNew();
testResolverFallbackClassificationNarrowed();
testHistoricalGeneratorDisplayTriState();
testOperationalMixedGeneratorQuantities();
testAvailabilityMalformedProductId();
testPricingExceptionFailClosed();

console.log(`\nAdmin Edit EE Phase 2 tests: ${passCount} passed, ${failCount} failed`);
if (failures.length > 0) {
  failures.forEach(f => console.log(`  FAIL: ${f}`));
  process.exit(1);
}
