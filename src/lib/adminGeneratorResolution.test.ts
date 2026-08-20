// Tests for Admin Generator automatic hybrid resolution.
//
// Exercises the pure decision helpers in adminGeneratorResolution.ts:
//   - increase with EE available → EE representation
//   - increase with no EE candidate → legacy
//   - increase with EE out of stock → legacy
//   - increase with config/query failure → fail closed (not legacy)
//   - historical mixed: legacy 1 → requested 2 with EE → legacy1 + EE1
//   - decrease removes most recently added (EE first, then legacy)

import {
  decideAdminGeneratorIncrease,
  decideAdminGeneratorDecrease,
  computeVisibleGeneratorQty,
  type GeneratorAvailabilityOutcome,
  type CurrentGeneratorRepresentation,
} from './adminGeneratorResolution';
import type { GeneratorProductConfiguration } from './generatorUnified';

let passed = 0;
let failed = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
  }
}

const eeProduct: GeneratorProductConfiguration = {
  product_id: 'gen-1',
  product_slug: 'generator',
  product_name: 'Generator',
  category_id: 'cat-gen',
  category_slug: 'generators',
  total_quantity: 10,
  temp_unavailable_qty: 0,
  standalone_price_cents: 5000,
  addon_price_cents: 2500,
  standalone_enabled: true,
  addon_enabled: true,
  addon_qualifying_threshold_cents: 10000,
};

const available: GeneratorAvailabilityOutcome = { status: 'available', product: eeProduct };
const noCandidate: GeneratorAvailabilityOutcome = { status: 'no_candidate' };
const outOfStock: GeneratorAvailabilityOutcome = { status: 'out_of_stock' };
const failClosed: GeneratorAvailabilityOutcome = { status: 'fail_closed', reason: 'query error' };

// --- Increase ---

// requested 1 + available EE Generator → EE representation
eq(
  'increase 0→1 with EE available uses EE',
  decideAdminGeneratorIncrease({
    current: { legacyQty: 0, directEeQty: 0 },
    requestedTotal: 1,
    availability: available,
  }),
  { additionalQty: 1, representation: 'ee', eeProduct },
);

// requested 1 + no EE Generator → legacy
eq(
  'increase 0→1 with no_candidate uses legacy',
  decideAdminGeneratorIncrease({
    current: { legacyQty: 0, directEeQty: 0 },
    requestedTotal: 1,
    availability: noCandidate,
  }),
  { additionalQty: 1, representation: 'legacy', newLegacyQty: 1 },
);

// requested 1 + EE out of stock → legacy
eq(
  'increase 0→1 with out_of_stock uses legacy',
  decideAdminGeneratorIncrease({
    current: { legacyQty: 0, directEeQty: 0 },
    requestedTotal: 1,
    availability: outOfStock,
  }),
  { additionalQty: 1, representation: 'legacy', newLegacyQty: 1 },
);

// requested 1 + query/config failure → fail closed, not legacy
const failResult = decideAdminGeneratorIncrease({
  current: { legacyQty: 0, directEeQty: 0 },
  requestedTotal: 1,
  availability: failClosed,
});
eq('fail_closed representation is none', failResult.representation, 'none');
eq('fail_closed has reason', failResult.reason, 'query error');
eq('fail_closed additionalQty', failResult.additionalQty, 1);

// --- Historical mixed ---
// existing legacy 1 → requested total 2 with available EE → legacy1 + EE1
const mixed = decideAdminGeneratorIncrease({
  current: { legacyQty: 1, directEeQty: 0 },
  requestedTotal: 2,
  availability: available,
});
eq('mixed increase additionalQty', mixed.additionalQty, 1);
eq('mixed increase representation', mixed.representation, 'ee');
eq('mixed increase eeProduct', mixed.eeProduct, eeProduct);

// visible Generator quantity = 2 (legacy1 + EE1 after resolution)
eq(
  'visible qty for legacy1+EE1',
  computeVisibleGeneratorQty({ legacyQty: 1, directEeQty: 1 }),
  2,
);

// existing EE 1, no legacy → requested 1 → visible = 1 (not 0)
eq(
  'visible qty for EE1 only',
  computeVisibleGeneratorQty({ legacyQty: 0, directEeQty: 1 }),
  1,
);

// --- Decrease ---

// legacy1 + EE1 → requested 1: decrease EE first (most recently added)
const dec1 = decideAdminGeneratorDecrease({
  current: { legacyQty: 1, directEeQty: 1 },
  requestedTotal: 1,
});
eq('decrease mixed removeQty', dec1.removeQty, 1);
eq('decrease mixed target ee', dec1.target, 'ee');
eq('decrease mixed newDirectEeQty', dec1.newDirectEeQty, 0);
eq('decrease mixed newLegacyQty', dec1.newLegacyQty, 1);

// EE2 → requested 1: decrease EE
const dec2 = decideAdminGeneratorDecrease({
  current: { legacyQty: 0, directEeQty: 2 },
  requestedTotal: 1,
});
eq('decrease EE2→1 target ee', dec2.target, 'ee');
eq('decrease EE2→1 newDirectEeQty', dec2.newDirectEeQty, 1);
eq('decrease EE2→1 newLegacyQty', dec2.newLegacyQty, 0);

// legacy2 → requested 1: decrease legacy
const dec3 = decideAdminGeneratorDecrease({
  current: { legacyQty: 2, directEeQty: 0 },
  requestedTotal: 1,
});
eq('decrease legacy2→1 target legacy', dec3.target, 'legacy');
eq('decrease legacy2→1 newLegacyQty', dec3.newLegacyQty, 1);

// requested increase but no change needed
const noChange: CurrentGeneratorRepresentation = { legacyQty: 1, directEeQty: 1 };
eq(
  'increase to same total → none',
  decideAdminGeneratorIncrease({
    current: noChange,
    requestedTotal: 2,
    availability: available,
  }).representation,
  'none',
);

console.log(`\nAdmin Generator resolution tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
