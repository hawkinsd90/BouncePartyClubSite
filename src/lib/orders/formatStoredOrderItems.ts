// Pure stored-order-item formatter.
//
// Extracted from orderSummary.ts so it can be used by:
// - formatOrderSummary (orderSummary.ts)
// - Customer Portal Payment Summary (RegularPortalView.tsx)
// - browser Receipt (Receipt.tsx)
// - tests
//
// This module has NO supabase dependency — it only needs buildPackageDisplay.

import { buildPackageDisplay } from '../pricing/packageDisplay';

export interface FormattedOrderItem {
  name: string;
  mode: string;
  price: number;
  qty: number;
  isNew: boolean;
  components: Array<{ name: string; quantity: number }>;
  packageContentsUnavailable: boolean;
}

// The fields of one stored order line that the formatter reads (inflatable lines carry `units`; Event Essentials lines carry
// bundle_id / item_name / pricing_context / component_snapshot).
export interface StoredOrderItemInput {
  unit_id?: string | null;
  units?: { name?: string | null } | null;
  wet_or_dry?: string | null;
  unit_price_cents: number;
  qty: number;
  is_new?: boolean | null;
  bundle_id?: string | null;
  item_name?: string | null;
  pricing_context?: string | null;
  component_snapshot?: unknown;
}

export function formatStoredOrderItems(items: StoredOrderItemInput[]): FormattedOrderItem[] {
  return items.map(item => {
    const isInflatable = !!item.unit_id && !!item.units?.name;
    if (isInflatable) {
      return {
        name: item.units!.name as string,
        mode: item.wet_or_dry === 'water' ? 'Water' : 'Dry',
        price: item.unit_price_cents,
        qty: item.qty,
        isNew: item.is_new || false,
        components: [],
        packageContentsUnavailable: false,
      };
    }
    // Event Essential package — render component snapshot before package line
    if (item.bundle_id) {
      const pkgDisplay = buildPackageDisplay({
        bundleName: item.item_name ?? null,
        bundleQty: item.qty,
        unitPriceCents: item.unit_price_cents,
        componentSnapshot: (item.component_snapshot ?? null) as Parameters<typeof buildPackageDisplay>[0]["componentSnapshot"],
      });
      const isAddOn = item.pricing_context === 'addon';
      return {
        name: isAddOn ? `${pkgDisplay.packageName} (Add-on)` : pkgDisplay.packageName,
        mode: 'Event Essential',
        price: item.unit_price_cents,
        qty: item.qty,
        isNew: item.is_new || false,
        components: pkgDisplay.hasSnapshot ? pkgDisplay.components : [],
        packageContentsUnavailable: !pkgDisplay.hasSnapshot,
      };
    }
    // Event Essential product
    const name = item.item_name || 'Event Essential';
    const isAddOn = item.pricing_context === 'addon';
    return {
      name: isAddOn ? `${name} (Add-on)` : name,
      mode: 'Event Essential',
      price: item.unit_price_cents,
      qty: item.qty,
      isNew: item.is_new || false,
      components: [],
      packageContentsUnavailable: false,
    };
  });
}
