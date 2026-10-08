/* eslint-disable @typescript-eslint/no-explicit-any */
// GENERATED COPY of src/lib/eeOrderItemAvailability.ts. Do not edit here.
// Edit the source and run: node node_modules/jiti/bin/jiti.js src/lib/bookingSharedCopy.ts --write
// A test fails if this file differs from its source. Used by create-booking so the server prices exactly like the Quote.

// Stage E4 — Pure production helper for expanding Event Essentials order items
// into product availability requests. Used by both approveOrder/forceApproveOrder
// and createOrderBeforePayment to ensure identical validation.

export type AvailabilityExpansionResult =
  | {
      status: 'ready';
      productQuantities: Array<{ product_id: string; quantity: number }>;
    }
  | {
      status: 'invalid';
      error: string;
    };

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNonBlankString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function isValidIdentityValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return true;
  return false;
}

export function buildEventEssentialAvailabilityRequestFromOrderItems(
  orderItems: any[],
): AvailabilityExpansionResult {
  const aggregated = new Map<string, number>();

  for (const item of orderItems) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { status: 'invalid', error: 'Invalid stored order item.' };
    }

    if (!isValidIdentityValue(item.unit_id) || !isValidIdentityValue(item.product_id) || !isValidIdentityValue(item.bundle_id)) {
      return { status: 'invalid', error: 'Invalid stored order item.' };
    }

    const hasUnitId = isNonBlankString(item.unit_id);
    const hasProductId = isNonBlankString(item.product_id);
    const hasBundleId = isNonBlankString(item.bundle_id);

    const identityCount =
      (hasUnitId ? 1 : 0) + (hasProductId ? 1 : 0) + (hasBundleId ? 1 : 0);

    if (identityCount === 0) {
      return { status: 'invalid', error: 'Invalid stored order item.' };
    }
    if (identityCount > 1) {
      return { status: 'invalid', error: 'Invalid stored order item.' };
    }

    // Inflatable row — valid nonblank unit_id, excluded from EE request
    if (hasUnitId) continue;

    // Direct Event Essential row: product_id nonblank, unit_id and bundle_id blank/null
    if (hasProductId) {
      if (!isPositiveSafeInteger(item.qty)) {
        return { status: 'invalid', error: 'Invalid stored order item.' };
      }
      const existing = aggregated.get(item.product_id) || 0;
      if (!Number.isSafeInteger(existing + item.qty)) {
        return { status: 'invalid', error: 'Invalid stored order item.' };
      }
      aggregated.set(item.product_id, existing + item.qty);
      continue;
    }

    // Package row: bundle_id nonblank, unit_id and product_id blank/null
    if (hasBundleId) {
      if (!isPositiveSafeInteger(item.qty)) {
        return { status: 'invalid', error: 'Invalid stored order item.' };
      }
      if (
        !item.component_snapshot ||
        typeof item.component_snapshot !== 'object' ||
        Array.isArray(item.component_snapshot)
      ) {
        return { status: 'invalid', error: 'Invalid stored order item.' };
      }
      const components = item.component_snapshot.components;
      if (!Array.isArray(components) || components.length === 0) {
        return { status: 'invalid', error: 'Invalid stored order item.' };
      }
      for (const comp of components) {
        if (!isNonBlankString(comp.product_id)) {
          return { status: 'invalid', error: 'Invalid stored order item.' };
        }
        if (!isPositiveSafeInteger(comp.quantity_per_bundle)) {
          return { status: 'invalid', error: 'Invalid stored order item.' };
        }
        if (!Number.isSafeInteger(comp.quantity_per_bundle * item.qty)) {
          return { status: 'invalid', error: 'Invalid stored order item.' };
        }
        const addedQty = comp.quantity_per_bundle * item.qty;
        const existing = aggregated.get(comp.product_id) || 0;
        if (!Number.isSafeInteger(existing + addedQty)) {
          return { status: 'invalid', error: 'Invalid stored order item.' };
        }
        aggregated.set(comp.product_id, existing + addedQty);
      }
      continue;
    }

    return { status: 'invalid', error: 'Invalid stored order item.' };
  }

  return {
    status: 'ready',
    productQuantities: Array.from(aggregated.entries()).map(
      ([product_id, quantity]) => ({ product_id, quantity }),
    ),
  };
}

export interface AvailabilityResultValidatorInput {
  error?: string | null;
  data?: any[] | null;
}

export type AvailabilityValidationStatus = 'ok' | 'unavailable' | 'invalid';

export function validateAvailabilityResult(
  requestedProductIds: string[],
  result: AvailabilityResultValidatorInput,
): { ok: boolean; error?: string; status: AvailabilityValidationStatus } {
  if (result.error || !result.data) {
    return {
      ok: false,
      status: 'invalid',
      error:
        'Unable to verify Event Essentials availability. Please try again or contact us for assistance.',
    };
  }
  // Validate each returned row shape BEFORE building the returned-product-ID set:
  // product_id must be a non-blank string, is_allowed must be a boolean
  for (const row of result.data) {
    if (typeof row.product_id !== 'string' || row.product_id.trim() === '') {
      return {
        ok: false,
        status: 'invalid',
        error:
          'Availability check returned a malformed result. Please try again or contact us for assistance.',
      };
    }
    if (typeof row.is_allowed !== 'boolean') {
      return {
        ok: false,
        status: 'invalid',
        error:
          'Availability check returned a malformed result. Please try again or contact us for assistance.',
      };
    }
  }
  const returnedProductIds = new Set(result.data.map((r: any) => r.product_id));
  for (const reqId of requestedProductIds) {
    if (!returnedProductIds.has(reqId)) {
      return {
        ok: false,
        status: 'invalid',
        error:
          'Availability check did not return a result for all requested items. Please try again or contact us for assistance.',
      };
    }
  }
  const allAvailable = result.data.every((r: any) => r.is_allowed === true);
  if (!allAvailable) {
    return {
      ok: false,
      status: 'unavailable',
      error:
        'One or more Event Essentials items are no longer available for the selected dates.',
    };
  }
  return { ok: true, status: 'ok' };
}

// ---------------------------------------------------------------------------
// Shared availability core: expand -> (dates) -> query -> validate.
//
// Ten Event Essentials flows used to repeat this sequence by hand (invoice builder x2,
// order detail, customer approval modal, invoice acceptance, add-Event-Essentials picker x2,
// admin Generator resolution, order approval, order creation). This function owns ONLY the
// sequence and returns neutral data. Each caller keeps what is feature-specific:
// - which items it projects and how it resolves its dates (the `end || start` fallback is
//   NOT shared: the order detail modal and Generator resolution pass the end date as-is),
// - the order id to exclude (null / undefined for none),
// - every message, toast, issue row, thrown error and state setter,
// - every loading flag, request id, stale guard and try/catch.
//
// Nothing here catches: a rejected or throwing query propagates to the caller exactly as the
// inline sequence did. An empty requirement skips the query and is ok (callers that never
// guarded for it always include a validated candidate, so their expansion is never empty).
// `requireDates` (opt-in) returns missing_dates AFTER the expansion check, matching the
// picker's order of checks; other callers pass their dates straight to the query as before.
//
// The query is injected so this module stays pure and Node-testable; the bound version used
// by the app is checkEventEssentialsAvailability in queries/products.ts.
// ---------------------------------------------------------------------------

export interface EventEssentialsAvailabilityQueryResult {
  data?: unknown[] | null;
  error?: string | null;
}

export type EventEssentialsAvailabilityQuery = (
  requestedItems: Array<{ product_id: string; quantity: number }>,
  startDate: string,
  endDate: string,
  excludeOrderId?: string | null,
) => Promise<EventEssentialsAvailabilityQueryResult>;

export type EventEssentialsAvailabilityCheck =
  | { ok: true; productQuantities: Array<{ product_id: string; quantity: number }> }
  // The items could not be expanded into a product requirement.
  | { ok: false; kind: 'invalid_requirement'; error: string }
  // requireDates was set and a date was missing (never returned unless requested).
  | { ok: false; kind: 'missing_dates'; error: string }
  // The query failed, returned nothing, or returned a malformed/incomplete result.
  // `error` is validateAvailabilityResult's message; `queryError` is the raw query error
  // (null when the query itself did not report one).
  | { ok: false; kind: 'unverifiable'; error: string | undefined; queryError: string | null }
  // The query succeeded and at least one requested product is not allowed.
  | { ok: false; kind: 'unavailable'; error: string | undefined };

export async function checkEventEssentialsAvailabilityWith(
  query: EventEssentialsAvailabilityQuery,
  input: {
    items: unknown[];
    eventDate: string;
    eventEndDate: string;
    excludeOrderId?: string | null;
    requireDates?: boolean;
  },
): Promise<EventEssentialsAvailabilityCheck> {
  const expansion = buildEventEssentialAvailabilityRequestFromOrderItems(input.items);
  if (expansion.status !== 'ready') {
    return { ok: false, kind: 'invalid_requirement', error: expansion.error };
  }

  if (input.requireDates && (!input.eventDate || !input.eventEndDate)) {
    return { ok: false, kind: 'missing_dates', error: 'Event dates are required to check availability.' };
  }

  if (expansion.productQuantities.length === 0) {
    return { ok: true, productQuantities: expansion.productQuantities };
  }

  const result = await query(
    expansion.productQuantities,
    input.eventDate,
    input.eventEndDate,
    input.excludeOrderId,
  );

  const validation = validateAvailabilityResult(
    expansion.productQuantities.map((item) => item.product_id),
    result,
  );
  if (validation.ok) {
    return { ok: true, productQuantities: expansion.productQuantities };
  }
  if (validation.status === 'unavailable') {
    return { ok: false, kind: 'unavailable', error: validation.error };
  }
  return { ok: false, kind: 'unverifiable', error: validation.error, queryError: result.error || null };
}
