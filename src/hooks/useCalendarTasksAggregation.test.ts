// useCalendarTasks equipment aggregation — independent item evaluation tests.
// jiti runner, no React/Supabase.

let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}:`, err);
  }
}

const generatorProductId = 'gen-abc';

function aggregateEquipment(
  orderItems: Array<{
    unit_id?: string | null;
    units?: { name?: string } | null;
    item_name?: string | null;
    product_id?: string | null;
    qty?: number;
    wet_or_dry?: string;
    component_snapshot?: any;
  }>,
): { genericItems: string[]; eeGeneratorQty: number; packageGeneratorQty: number } {
  let eeGeneratorQty = 0;
  let packageGeneratorQty = 0;
  const genericItems: string[] = [];

  for (const item of orderItems) {
    if (item.unit_id && item.units?.name) {
      genericItems.push(`${item.units.name} (${item.wet_or_dry === 'water' ? 'Water' : 'Dry'})`);
    } else if (item.item_name) {
      if (generatorProductId && item.product_id === generatorProductId) {
        eeGeneratorQty += item.qty || 0;
      } else {
        let itemContainsGenerator = false;
        if (item.component_snapshot && generatorProductId) {
          try {
            const snapshot = typeof item.component_snapshot === 'string'
              ? JSON.parse(item.component_snapshot)
              : item.component_snapshot;
            if (snapshot?.components) {
              for (const comp of snapshot.components) {
                if (comp.product_id === generatorProductId) {
                  packageGeneratorQty += (comp.quantity_per_bundle || 0) * (item.qty || 0);
                  itemContainsGenerator = true;
                }
              }
            }
          } catch {
            // Ignore malformed snapshot
          }
        }
        if (!itemContainsGenerator) {
          genericItems.push(item.item_name);
        }
      }
    }
  }

  return { genericItems, eeGeneratorQty, packageGeneratorQty };
}

// --- Tests ---

test('should preserve unrelated EE items after a package containing Generator', () => {
  const orderItems = [
    { unit_id: 'unit-1', units: { name: 'Castle Bounce' }, qty: 1, wet_or_dry: 'dry' },
    {
      item_name: 'Party Package',
      product_id: 'pkg-1',
      qty: 1,
      component_snapshot: { components: [{ product_id: generatorProductId, quantity_per_bundle: 1 }] },
    },
    { item_name: 'Tables (6)', product_id: 'tables-1', qty: 1 },
  ];

  const result = aggregateEquipment(orderItems);
  ok('package generator qty = 1', result.packageGeneratorQty === 1);
  ok('ee generator qty = 0', result.eeGeneratorQty === 0);
  ok('tables preserved', result.genericItems.includes('Tables (6)'));
});

test('should not double-count direct EE Generator + package Generator', () => {
  const orderItems = [
    {
      item_name: 'Party Package',
      product_id: 'pkg-1',
      qty: 1,
      component_snapshot: { components: [{ product_id: generatorProductId, quantity_per_bundle: 1 }] },
    },
    { item_name: 'Generator', product_id: generatorProductId, qty: 2 },
  ];

  const result = aggregateEquipment(orderItems);
  ok('package generator qty = 1', result.packageGeneratorQty === 1);
  ok('ee generator qty = 2', result.eeGeneratorQty === 2);
  ok('generator not in generic items', !result.genericItems.includes('Generator'));
});

test('should handle items without component_snapshot as generic items', () => {
  const orderItems = [{ item_name: 'Chairs (10)', product_id: 'chairs-1', qty: 2 }];
  const result = aggregateEquipment(orderItems);
  ok('chairs in generic items', result.genericItems.includes('Chairs (10)'));
  ok('ee generator qty = 0', result.eeGeneratorQty === 0);
  ok('package generator qty = 0', result.packageGeneratorQty === 0);
});

test('should handle malformed component_snapshot gracefully', () => {
  const orderItems = [
    { item_name: 'Broken Package', product_id: 'pkg-broken', qty: 1, component_snapshot: 'not valid json{{' },
  ];
  const result = aggregateEquipment(orderItems);
  ok('broken package in generic items', result.genericItems.includes('Broken Package'));
  ok('package generator qty = 0', result.packageGeneratorQty === 0);
});

// --- Runner ---

console.log('\nuseCalendarTasks aggregation tests:');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
