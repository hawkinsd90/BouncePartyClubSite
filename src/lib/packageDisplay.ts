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

// Stage E4 — Pure production validator for a current cart package snapshot.
// Used before Quote continues, Checkout submits, and orderCreation writes.
// Does NOT silently replace invalid quantity with 1 or invalid price with 0.

export interface PackageSnapshotValidation {
  ok: boolean;
  error?: string;
}

export function validatePackageSnapshot(cartItem: {
  bundle_id?: string | null;
  bundle_name?: string | null;
  unit_price_cents?: number;
  qty?: number;
  component_snapshot?: BundleComponentSnapshot | null;
}): PackageSnapshotValidation {
  if (!cartItem.bundle_id || typeof cartItem.bundle_id !== 'string' || cartItem.bundle_id.trim() === '') {
    return { ok: false, error: 'Package is missing a valid bundle ID' };
  }

  const name = cartItem.bundle_name;
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return { ok: false, error: 'Package is missing a valid name' };
  }

  const qty = cartItem.qty;
  if (typeof qty !== 'number' || !Number.isFinite(qty) || !Number.isSafeInteger(qty) || qty <= 0) {
    return { ok: false, error: 'Package quantity must be a positive integer' };
  }

  const price = cartItem.unit_price_cents;
  if (typeof price !== 'number' || !Number.isFinite(price) || !Number.isSafeInteger(price) || price < 0) {
    return { ok: false, error: 'Package price must be a nonnegative integer' };
  }

  const snapshot = cartItem.component_snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, error: 'Package is missing a component snapshot' };
  }

  if (!Array.isArray(snapshot.components)) {
    return { ok: false, error: 'Package snapshot is missing a components array' };
  }

  for (const comp of snapshot.components) {
    if (!comp.product_id || typeof comp.product_id !== 'string' || comp.product_id.trim() === '') {
      return { ok: false, error: 'Package component is missing a valid product ID' };
    }
    if (!comp.product_name || typeof comp.product_name !== 'string' || comp.product_name.trim() === '') {
      return { ok: false, error: 'Package component is missing a valid product name' };
    }
    if (typeof comp.quantity_per_bundle !== 'number' || !Number.isFinite(comp.quantity_per_bundle) || !Number.isSafeInteger(comp.quantity_per_bundle) || comp.quantity_per_bundle <= 0) {
      return { ok: false, error: 'Package component quantity must be a positive integer' };
    }
  }

  return { ok: true };
}

export function validateCartPackageSnapshots(cart: any[]): PackageSnapshotValidation {
  for (const item of cart) {
    if (isPackageItem(item)) {
      const result = validatePackageSnapshot(item);
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}
