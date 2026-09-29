// Pure model for the Order Detail modal's staged item list (ordinary inflatable
// and Event Essentials rows): building it from persisted order items and the
// add / remove / quantity transitions.
//
// Moved verbatim from OrderDetailModal, including its quirks:
// - A persisted row with a truthy unit_id but a missing/empty units.name is
//   mapped through the Event Essentials branch, so its unit_id is dropped.
// - Removal matching is decided by the CANDIDATE row's own properties
//   (id, else client_id, else unit_id, else object identity).
// - Event Essentials matching compares with ===, so undefined === undefined
//   can match if a caller omits product_id / bundle_id.
// - Quantity update matching treats rows with neither id nor client_id as equal.
// - Bundle snapshots are compared with JSON.stringify (key-order sensitive).
// - Quantity is clamped with Math.max(1, qty), so NaN stays NaN.
//
// State (setStagedItems), manualDirty, the initialization effect and the ID
// templates stay in OrderDetailModal; client IDs are created through an injected
// factory so the call timing and count are unchanged.
//
// No runtime imports, so it can be loaded from Node-based tests.

export interface BundleComponentSnapshot {
  bundle_name: string;
  bundle_description?: string | null;
  components: Array<{
    product_id: string;
    product_name: string;
    quantity_per_bundle: number;
  }>;
}

export interface StagedItem {
  client_id?: string;
  id?: string; // undefined for new items
  unit_id?: string; // optional for EE products
  unit_name?: string;
  product_id?: string; // set for EE products
  bundle_id?: string; // set for EE packages
  product_name?: string;
  item_name?: string;
  qty: number;
  wet_or_dry?: 'dry' | 'water';
  unit_price_cents: number;
  pricing_context?: string;
  component_snapshot?: BundleComponentSnapshot | null;
  created_at?: string;
  is_new?: boolean;
  is_deleted?: boolean;
  is_updated?: boolean;
}

// A persisted order_items row as loaded by the modal (joined with units).
// Nullable database columns are typed as nullable here; the assertions in
// buildStagedItemsFromOrderItems keep the existing pass-through of those values
// into StagedItem's non-null optional fields.
export interface PersistedOrderItem {
  id?: string;
  unit_id?: string | null;
  units?: { name?: string | null } | null;
  qty: number;
  wet_or_dry?: 'dry' | 'water' | null;
  unit_price_cents: number;
  created_at?: string;
  product_id?: string | null;
  bundle_id?: string | null;
  item_name?: string | null;
  product_name?: string | null;
  pricing_context?: string | null;
  component_snapshot?: BundleComponentSnapshot | null;
}

// The unit fields used when staging a new inflatable row.
export interface StageableUnit {
  id: string;
  name: string;
  price_dry_cents: number;
  price_water_cents?: number | null;
}

export function buildStagedItemsFromOrderItems(orderItems: PersistedOrderItem[]): StagedItem[] {
  const staged: StagedItem[] = orderItems.map(item => {
    if (item.unit_id && item.units?.name) {
      return {
        id: item.id,
        unit_id: item.unit_id,
        unit_name: item.units.name,
        qty: item.qty,
        // Assertion: a persisted null passes through unchanged.
        wet_or_dry: item.wet_or_dry as StagedItem['wet_or_dry'],
        unit_price_cents: item.unit_price_cents,
        created_at: item.created_at,
        is_new: false,
        is_deleted: false,
      };
    }
    // EE product or package item
    return {
      id: item.id,
      // Assertions: persisted nulls pass through unchanged.
      product_id: item.product_id as StagedItem['product_id'],
      bundle_id: item.bundle_id as StagedItem['bundle_id'],
      product_name: item.item_name || item.product_name || 'Event Essential',
      item_name: item.item_name as StagedItem['item_name'],
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
      pricing_context: item.pricing_context as StagedItem['pricing_context'],
      component_snapshot: item.component_snapshot ?? null,
      created_at: item.created_at,
      is_new: false,
      is_deleted: false,
    };
  });
  return staged;
}

// makeClientId is called exactly once, when the item is built.
export function buildNewInflatableItem(
  unit: StageableUnit,
  mode: 'dry' | 'water',
  makeClientId: () => string,
): StagedItem {
  const price = mode === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents;

  const newItem: StagedItem = {
    client_id: makeClientId(),
    unit_id: unit.id,
    unit_name: unit.name,
    qty: 1,
    wet_or_dry: mode,
    unit_price_cents: price,
    is_new: true,
    is_deleted: false,
  };

  return newItem;
}

export function removeStagedItem(previous: StagedItem[], itemToRemove: StagedItem): StagedItem[] {
  return previous.map(item => {
    const isMatch = item.id
      ? item.id === itemToRemove.id
      : item.client_id
        ? item.client_id === itemToRemove.client_id
        : item.unit_id
          ? item.unit_id === itemToRemove.unit_id && item.wet_or_dry === itemToRemove.wet_or_dry
          : item === itemToRemove;

    if (isMatch) {
      if (item.is_new) {
        // Don't include new items (filter them out)
        return null;
      } else {
        // Mark existing items as deleted
        return { ...item, is_deleted: true };
      }
    }
    return item;
  }).filter((item): item is StagedItem => item !== null);
}

// makeClientId is called only when no row matches AND item.client_id is falsy.
export function addEEProductToStagedItems(
  prev: StagedItem[],
  item: StagedItem,
  makeClientId: () => string,
): StagedItem[] {
  const exactMatch = prev.find((existing: StagedItem) =>
    !existing.is_deleted &&
    existing.product_id === item.product_id &&
    !existing.bundle_id &&
    existing.unit_price_cents === item.unit_price_cents &&
    (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone')
  );
  if (exactMatch) {
    return prev.map((existing: StagedItem) =>
      existing === exactMatch
        ? { ...existing, qty: existing.qty + item.qty, is_updated: true }
        : existing
    );
  }
  return [...prev, { ...item, client_id: item.client_id || makeClientId() }];
}

// makeClientId is called only when no row matches AND item.client_id is falsy.
export function addEEBundleToStagedItems(
  prev: StagedItem[],
  item: StagedItem,
  makeClientId: () => string,
): StagedItem[] {
  const exactMatch = prev.find((existing: StagedItem) =>
    !existing.is_deleted &&
    existing.bundle_id === item.bundle_id &&
    existing.unit_price_cents === item.unit_price_cents &&
    (existing.pricing_context || 'standalone') === (item.pricing_context || 'standalone') &&
    JSON.stringify(existing.component_snapshot || null) === JSON.stringify(item.component_snapshot || null)
  );
  if (exactMatch) {
    return prev.map((existing: StagedItem) =>
      existing === exactMatch
        ? { ...existing, qty: existing.qty + item.qty, is_updated: true }
        : existing
    );
  }
  return [...prev, { ...item, client_id: item.client_id || makeClientId() }];
}

export function updateStagedItemQuantity(
  prev: StagedItem[],
  itemToUpdate: StagedItem,
  qty: number,
): StagedItem[] {
  return prev.map(item => {
    const matches = item.id ? item.id === itemToUpdate.id : item.client_id === itemToUpdate.client_id;
    return matches ? { ...item, qty: Math.max(1, qty), is_updated: true } : item;
  });
}
