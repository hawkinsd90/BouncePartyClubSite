// Pure stored-order-item formatter.
//
// Extracted from orderSummary.ts so it can be used by:
// - formatOrderSummary (orderSummary.ts)
// - Customer Portal Payment Summary (RegularPortalView.tsx)
// - browser Receipt (Receipt.tsx)
// - tests
//
// This module has NO supabase dependency — it only needs buildPackageDisplay.

import { buildPackageDisplay } from './packageDisplay';

export interface FormattedOrderItem {
  name: string;
  mode: string;
  price: number;
  qty: number;
  isNew: boolean;
  components: Array<{ name: string; quantity: number }>;
  packageContentsUnavailable: boolean;
}

export function formatStoredOrderItems(items: any[]): FormattedOrderItem[] {
  return items.map(item => {
    const isInflatable = !!item.unit_id && !!item.units?.name;
    if (isInflatable) {
      return {
        name: item.units!.name,
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
        componentSnapshot: (item as any).component_snapshot ?? null,
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
