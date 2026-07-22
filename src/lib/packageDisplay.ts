// Stage E4 — Shared package component display adapter.
//
// Used by Quote Summary, Checkout Order Summary, Pending Review order
// details, and booking-request confirmation email to render package
// component contents from the saved component_snapshot.
//
// Components appear before the package line. Component quantity equals
// quantity_per_bundle × package item quantity. Component lines are
// informational only (no individual prices). Package price is included
// exactly once.

import type { BundleComponentSnapshot } from '../types';

export interface PackageComponentLine {
  name: string;
  quantity: number;
}

export interface PackageDisplayResult {
  components: PackageComponentLine[];
  packageName: string;
  packageQty: number;
  packagePriceCents: number;
  hasSnapshot: boolean;
}

export function buildPackageDisplay(input: {
  bundleName: string | null;
  bundleQty: number;
  unitPriceCents: number;
  componentSnapshot: BundleComponentSnapshot | null;
}): PackageDisplayResult {
  const packageName = input.bundleName || 'Package';
  const packageQty = Math.trunc(input.bundleQty) || 1;
  const packagePriceCents = Math.trunc(input.unitPriceCents) || 0;

  if (!input.componentSnapshot || !Array.isArray(input.componentSnapshot.components)) {
    return {
      components: [],
      packageName,
      packageQty,
      packagePriceCents,
      hasSnapshot: false,
    };
  }

  const components: PackageComponentLine[] = input.componentSnapshot.components.map((c) => ({
    name: c.product_name || 'Item',
    quantity: (Math.trunc(c.quantity_per_bundle) || 0) * packageQty,
  }));

  return {
    components,
    packageName,
    packageQty,
    packagePriceCents,
    hasSnapshot: true,
  };
}

export function isPackageItem(item: any): boolean {
  return (
    item &&
    (item.item_type === 'event_essential_bundle' ||
      (item.bundle_id != null && item.unit_id == null))
  );
}
