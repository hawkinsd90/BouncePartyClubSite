// Tests for Admin Event Essentials loader schema correctness.
//
// Verifies that the active Admin Add Event Essentials code does NOT reference
// the nonexistent product_bundle_pricing table or product_bundles.category_id
// column. Also verifies the actual schema fields are used.

import * as fs from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function readSource(filePath: string): string {
  return fs.readFileSync(path.resolve(filePath), 'utf-8');
}

// 1. AddEventEssentialsSection must not reference product_bundle_pricing
const addEESource = readSource('src/components/order-detail/AddEventEssentialsSection.tsx');
ok('AddEventEssentialsSection has no product_bundle_pricing', !addEESource.includes('product_bundle_pricing'));
ok('AddEventEssentialsSection has no product_bundles.category_id', !addEESource.includes('product_bundles.category_id'));

// 2. OrderDetailsTab must not reference product_bundle_pricing
const orderDetailsSource = readSource('src/components/order-detail/OrderDetailsTab.tsx');
ok('OrderDetailsTab has no product_bundle_pricing', !orderDetailsSource.includes('product_bundle_pricing'));

// 3. OrderDetailModal must not reference product_bundle_pricing
const modalSource = readSource('src/components/admin/OrderDetailModal.tsx');
ok('OrderDetailModal has no product_bundle_pricing', !modalSource.includes('product_bundle_pricing'));

// 4. No AddGeneratorSection reference remains
ok('OrderDetailsTab has no AddGeneratorSection', !orderDetailsSource.includes('AddGeneratorSection'));
ok('OrderDetailModal has no AddGeneratorSection', !modalSource.includes('AddGeneratorSection'));

// 5. AddGeneratorSection.tsx file should not exist
const addGenPath = path.resolve('src/components/order-detail/AddGeneratorSection.tsx');
ok('AddGeneratorSection.tsx file removed', !fs.existsSync(addGenPath));

// 6. LegacyGeneratorEditor.tsx file should not exist
const legacyGenPath = path.resolve('src/components/order-detail/LegacyGeneratorEditor.tsx');
ok('LegacyGeneratorEditor.tsx file removed', !fs.existsSync(legacyGenPath));

// 7. The actual schema fields ARE referenced in AddEventEssentialsSection
ok('AddEventEssentialsSection uses standalone_price_cents', addEESource.includes('standalone_price_cents'));
// AddEventEssentialsSection uses helper functions, not direct table names —
// verify it imports from the existing query helpers rather than hand-writing queries.
ok('AddEventEssentialsSection imports from queries/products', addEESource.includes('queries/products'));

// 8. No active source file references product_bundle_pricing (scan all src)
function scanDir(dir: string, pattern: string): string[] {
  const hits: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...scanDir(full, pattern));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      const content = fs.readFileSync(full, 'utf-8');
      if (content.includes(pattern)) {
        hits.push(full);
      }
    }
  }
  return hits;
}

const pricingHits = scanDir('src', 'product_bundle_pricing').filter(f => !f.includes('adminEESchema.test'));
ok('No src files reference product_bundle_pricing', pricingHits.length === 0);

console.log(`\nAdmin Event Essentials schema tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
