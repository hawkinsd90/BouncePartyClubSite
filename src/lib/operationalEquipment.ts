// Shared operational-equipment formatter for Calendar task cards,
// TaskDetailModal equipment section, and Equipment Checklist modal.
//
// Expands Event Essentials packages into their physical component products
// using the saved order_items.component_snapshot, multiplying each component
// quantity_per_bundle by the package order-item qty. Direct EE products use
// their saved item_name and qty. Inflatable items keep their existing
// "Name (Dry|Water)" label. Package marketing names are never shown as
// physical equipment.
//
// Primary snapshot contract:
//   component_snapshot: {
//     bundle_name: string,
//     bundle_description?: string | null,
//     components: [
//       { product_id, product_name, quantity_per_bundle }
//     ]
//   }
//
// Legacy array shape is supported defensively but is not the primary contract.

export interface OperationalEquipmentItem {
  name: string;
  qty: number;
  kind: 'inflatable' | 'event_essential';
  wetOrDry?: 'Water' | 'Dry';
}

export const PACKAGE_CONTENTS_UNAVAILABLE = 'Package contents unavailable';

interface NormalizedComponent {
  name: string;
  quantity: number;
}

function normalizeSnapshotComponents(snapshot: any): NormalizedComponent[] {
  if (!snapshot) return [];

  // Primary contract: { components: [...] }
  if (!Array.isArray(snapshot) && snapshot && typeof snapshot === 'object') {
    const components = snapshot.components;
    if (Array.isArray(components)) {
      return components.map((c: any) => ({
        name: c.product_name || c.name || 'Unknown component',
        quantity: c.quantity_per_bundle ?? c.quantity ?? 1,
      }));
    }
    return [];
  }

  // Legacy defensive: bare array of component objects
  if (Array.isArray(snapshot)) {
    return snapshot.map((c: any) => ({
      name: c.product_name || c.name || 'Unknown component',
      quantity: c.quantity_per_bundle ?? c.quantity ?? 1,
    }));
  }

  return [];
}

export function formatOperationalEquipment(orderItems: any[]): OperationalEquipmentItem[] {
  const result: OperationalEquipmentItem[] = [];

  for (const item of orderItems) {
    const qty = item.qty || 1;

    // Inflatable — keep existing label
    if (item.unit_id && item.units?.name) {
      result.push({
        name: item.units.name,
        qty,
        kind: 'inflatable',
        wetOrDry: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
      });
      continue;
    }

    // Event Essentials package — expand from saved component_snapshot
    if (item.bundle_id) {
      const components = normalizeSnapshotComponents(item.component_snapshot);
      if (components.length > 0) {
        for (const comp of components) {
          result.push({
            name: comp.name,
            qty: comp.quantity * qty,
            kind: 'event_essential',
          });
        }
      } else {
        result.push({
          name: PACKAGE_CONTENTS_UNAVAILABLE,
          qty: 1,
          kind: 'event_essential',
        });
      }
      continue;
    }

    // Direct Event Essentials product
    const name = item.item_name || 'Unknown item';
    result.push({
      name,
      qty,
      kind: 'event_essential',
    });
  }

  return result;
}

export function formatOperationalEquipmentLabels(orderItems: any[]): string[] {
  return formatOperationalEquipment(orderItems).map(e => {
    if (e.kind === 'inflatable') {
      return `${e.name} (${e.wetOrDry})`;
    }
    return `${e.name} ×${e.qty}`;
  });
}

export interface AggregatedEquipmentItem {
  name: string;
  totalQty: number;
  kind: 'inflatable' | 'event_essential';
  wetOrDry?: 'Water' | 'Dry';
}

export function aggregateEquipmentAcrossOrders(
  orders: { items: OperationalEquipmentItem[] }[],
): AggregatedEquipmentItem[] {
  const map = new Map<string, AggregatedEquipmentItem>();

  for (const order of orders) {
    for (const item of order.items) {
      const key = item.kind === 'inflatable'
        ? `inflatable|${item.name}|${item.wetOrDry || ''}`
        : `ee|${item.name}`;

      const existing = map.get(key);
      if (existing) {
        existing.totalQty += item.qty;
      } else {
        map.set(key, {
          name: item.name,
          totalQty: item.qty,
          kind: item.kind,
          wetOrDry: item.wetOrDry,
        });
      }
    }
  }

  return Array.from(map.values());
}
