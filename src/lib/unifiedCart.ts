import type {
  UnifiedCartItem,
  InflatableCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
  ProductBundleWithComponents,
  BundleComponentSnapshot,
  ProductAvailabilityRequestItem,
  ProductAvailabilityResult,
} from '../types';

export function isInflatableCartItem(item: UnifiedCartItem): item is InflatableCartItem {
  return item.item_type === undefined || item.item_type === 'inflatable';
}

export function isEventEssentialProductCartItem(
  item: UnifiedCartItem
): item is EventEssentialProductCartItem {
  return item.item_type === 'event_essential_product';
}

export function isEventEssentialBundleCartItem(
  item: UnifiedCartItem
): item is EventEssentialBundleCartItem {
  return item.item_type === 'event_essential_bundle';
}

function isStringArray(val: unknown): val is unknown[] {
  return Array.isArray(val);
}

function normalizeInflatableEntry(
  entry: Record<string, unknown>
): InflatableCartItem | null {
  if (typeof entry.unit_id !== 'string' || !entry.unit_id || entry.unit_id === 'undefined') {
    return null;
  }
  if (typeof entry.unit_name !== 'string' || !entry.unit_name) {
    return null;
  }
  const qty = Number(entry.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }
  const wetOrDry = entry.wet_or_dry;
  if (wetOrDry !== 'dry' && wetOrDry !== 'water') {
    return null;
  }
  const unitPrice = Number(entry.unit_price_cents);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return null;
  }

  const item: InflatableCartItem = {
    unit_id: entry.unit_id,
    unit_name: entry.unit_name,
    wet_or_dry: wetOrDry,
    unit_price_cents: unitPrice,
    qty,
  };

  if (typeof entry.is_combo === 'boolean') item.is_combo = entry.is_combo;
  if (entry.isAvailable === false) item.isAvailable = false;
  if (entry.price_dry_cents != null) {
    const dryPrice = Number(entry.price_dry_cents);
    if (Number.isFinite(dryPrice)) item.price_dry_cents = dryPrice;
  }
  if (entry.price_water_cents != null) {
    const waterPrice = Number(entry.price_water_cents);
    if (Number.isFinite(waterPrice)) item.price_water_cents = waterPrice;
  }

  return item;
}

function normalizeEventEssentialProductEntry(
  entry: Record<string, unknown>
): EventEssentialProductCartItem | null {
  if (typeof entry.product_id !== 'string' || !entry.product_id) {
    return null;
  }
  if (typeof entry.product_name !== 'string' || !entry.product_name) {
    return null;
  }
  const qty = Number(entry.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }
  const unitPrice = Number(entry.unit_price_cents);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return null;
  }
  const pricingContext = entry.pricing_context;
  if (pricingContext !== 'standalone' && pricingContext !== 'addon') {
    return null;
  }

  const item: EventEssentialProductCartItem = {
    item_type: 'event_essential_product',
    product_id: entry.product_id,
    product_name: entry.product_name,
    unit_price_cents: unitPrice,
    qty,
    pricing_context: pricingContext,
  };

  if (entry.isAvailable === false) item.isAvailable = false;

  return item;
}

function normalizeEventEssentialBundleEntry(
  entry: Record<string, unknown>
): EventEssentialBundleCartItem | null {
  if (typeof entry.bundle_id !== 'string' || !entry.bundle_id) {
    return null;
  }
  if (typeof entry.bundle_name !== 'string' || !entry.bundle_name) {
    return null;
  }
  const qty = Number(entry.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }
  const unitPrice = Number(entry.unit_price_cents);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return null;
  }
  const pricingContext = entry.pricing_context;
  if (pricingContext !== 'standalone' && pricingContext !== 'addon') {
    return null;
  }
  const snapshot = entry.component_snapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const snap = snapshot as Record<string, unknown>;
  if (typeof snap.bundle_name !== 'string') {
    return null;
  }
  if (!Array.isArray(snap.components)) {
    return null;
  }
  const components = snap.components as Record<string, unknown>[];
  const validComponents = components.every(
    (c) =>
      typeof c.product_id === 'string' &&
      typeof c.product_name === 'string' &&
      typeof c.quantity_per_bundle === 'number' &&
      c.quantity_per_bundle > 0
  );
  if (!validComponents) {
    return null;
  }

  const componentSnapshot: BundleComponentSnapshot = {
    bundle_name: snap.bundle_name,
    bundle_description: typeof snap.bundle_description === 'string' ? snap.bundle_description : null,
    components: components.map((c) => ({
      product_id: c.product_id as string,
      product_name: c.product_name as string,
      quantity_per_bundle: c.quantity_per_bundle as number,
    })),
  };

  const item: EventEssentialBundleCartItem = {
    item_type: 'event_essential_bundle',
    bundle_id: entry.bundle_id,
    bundle_name: entry.bundle_name,
    unit_price_cents: unitPrice,
    qty,
    pricing_context: pricingContext,
    component_snapshot: componentSnapshot,
  };

  if (entry.isAvailable === false) item.isAvailable = false;

  return item;
}

export function normalizeCartItems(raw: unknown): UnifiedCartItem[] {
  if (!isStringArray(raw)) {
    return [];
  }

  const result: UnifiedCartItem[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const itemType = record.item_type;

    let normalized: UnifiedCartItem | null = null;

    if (itemType === undefined) {
      normalized = normalizeInflatableEntry(record);
    } else if (itemType === 'inflatable') {
      normalized = normalizeInflatableEntry(record);
    } else if (itemType === 'event_essential_product') {
      normalized = normalizeEventEssentialProductEntry(record);
    } else if (itemType === 'event_essential_bundle') {
      normalized = normalizeEventEssentialBundleEntry(record);
    }

    if (normalized) {
      result.push(normalized);
    }
  }

  return result;
}

export function buildBundleSnapshot(
  bundle: ProductBundleWithComponents
): BundleComponentSnapshot {
  return {
    bundle_name: bundle.name,
    bundle_description: bundle.description ?? null,
    components: bundle.product_bundle_components.map((c) => ({
      product_id: c.product_id,
      product_name: c.inventory_products?.name ?? 'Unknown Product',
      quantity_per_bundle: c.quantity_per_bundle,
    })),
  };
}

export function expandCartToProductQuantities(
  items: (EventEssentialProductCartItem | EventEssentialBundleCartItem)[]
): ProductAvailabilityRequestItem[] {
  const quantities = new Map<string, number>();

  for (const item of items) {
    if (isEventEssentialProductCartItem(item)) {
      const current = quantities.get(item.product_id) ?? 0;
      quantities.set(item.product_id, current + item.qty);
    } else if (isEventEssentialBundleCartItem(item)) {
      for (const component of item.component_snapshot.components) {
        const current = quantities.get(component.product_id) ?? 0;
        quantities.set(
          component.product_id,
          current + component.quantity_per_bundle * item.qty
        );
      }
    }
  }

  return Array.from(quantities.entries()).map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }));
}

export function hasQualifyingInflatable(cart: UnifiedCartItem[]): boolean {
  return cart.some(isInflatableCartItem);
}

export function getInvalidAddOnItems(cart: UnifiedCartItem[]): UnifiedCartItem[] {
  if (hasQualifyingInflatable(cart)) {
    return [];
  }
  return cart.filter(
    (item) =>
      (isEventEssentialProductCartItem(item) || isEventEssentialBundleCartItem(item)) &&
      item.pricing_context === 'addon'
  );
}

export function findMergeableProductIndex(
  cart: UnifiedCartItem[],
  item: EventEssentialProductCartItem
): number {
  return cart.findIndex(
    (entry) =>
      isEventEssentialProductCartItem(entry) &&
      entry.product_id === item.product_id &&
      entry.pricing_context === item.pricing_context
  );
}

export function mergeProductIntoCart(
  cart: UnifiedCartItem[],
  item: EventEssentialProductCartItem
): UnifiedCartItem[] {
  const index = findMergeableProductIndex(cart, item);
  if (index === -1) {
    return [...cart, item];
  }
  const existing = cart[index] as EventEssentialProductCartItem;
  const updated: EventEssentialProductCartItem = {
    ...existing,
    qty: existing.qty + item.qty,
  };
  const next = [...cart];
  next[index] = updated;
  return next;
}

export function mapProductAvailabilityToItem(
  item: EventEssentialProductCartItem,
  results: ProductAvailabilityResult[]
): boolean {
  const result = results.find((r) => r.product_id === item.product_id);
  return result != null && result.is_allowed === true;
}

export function mapBundleAvailabilityToItem(
  item: EventEssentialBundleCartItem,
  results: ProductAvailabilityResult[]
): boolean {
  return item.component_snapshot.components.every((component) => {
    const result = results.find((r) => r.product_id === component.product_id);
    return result != null && result.is_allowed === true;
  });
}

export function filterOutEventEssentialProduct(
  cart: UnifiedCartItem[],
  productId: string,
): UnifiedCartItem[] {
  return cart.filter(
    (item) =>
      !(
        isEventEssentialProductCartItem(item) &&
        item.product_id === productId
      ),
  );
}

export function filterOutEventEssentialBundle(
  cart: UnifiedCartItem[],
  bundleId: string,
): UnifiedCartItem[] {
  return cart.filter(
    (item) =>
      !(
        isEventEssentialBundleCartItem(item) &&
        item.bundle_id === bundleId
      ),
  );
}
