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
