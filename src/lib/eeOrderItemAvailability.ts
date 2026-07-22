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

export function buildEventEssentialAvailabilityRequestFromOrderItems(
  orderItems: any[],
): AvailabilityExpansionResult {
  const aggregated = new Map<string, number>();

  for (const item of orderItems) {
    const hasUnitId =
      typeof item.unit_id === 'string' && item.unit_id.trim() !== '';
    const productIdIsNonBlank =
      typeof item.product_id === 'string' && item.product_id.trim() !== '';
    const bundleIdIsNonBlank =
      typeof item.bundle_id === 'string' && item.bundle_id.trim() !== '';

    // Inflatable row — valid nonblank unit_id, ignored by this helper
    if (hasUnitId) continue;

    // Direct Event Essential row: product_id nonblank, bundle_id null/absent
    if (productIdIsNonBlank && !bundleIdIsNonBlank) {
      if (!isPositiveSafeInteger(item.qty)) {
        return {
          status: 'invalid',
          error: 'Cannot approve order: Invalid product quantity.',
        };
      }
      aggregated.set(
        item.product_id,
        (aggregated.get(item.product_id) || 0) + item.qty,
      );
      continue;
    }

    // Package row: bundle_id nonblank, product_id null/absent
    if (bundleIdIsNonBlank && !productIdIsNonBlank) {
      if (!isPositiveSafeInteger(item.qty)) {
        return {
          status: 'invalid',
          error: 'Cannot approve order: Invalid package quantity.',
        };
      }
      if (
        !item.component_snapshot ||
        typeof item.component_snapshot !== 'object' ||
        Array.isArray(item.component_snapshot)
      ) {
        return {
          status: 'invalid',
          error:
            'Cannot approve order: Invalid stored package details — missing component snapshot.',
        };
      }
      const components = item.component_snapshot.components;
      if (!Array.isArray(components) || components.length === 0) {
        return {
          status: 'invalid',
          error:
            'Cannot approve order: Invalid stored package details — empty components.',
        };
      }
      for (const comp of components) {
        if (
          typeof comp.product_id !== 'string' ||
          comp.product_id.trim() === ''
        ) {
          return {
            status: 'invalid',
            error:
              'Cannot approve order: Invalid product ID in package snapshot.',
          };
        }
        if (!isPositiveSafeInteger(comp.quantity_per_bundle)) {
          return {
            status: 'invalid',
            error:
              'Cannot approve order: Invalid component quantity in package snapshot.',
          };
          }
        const qty = comp.quantity_per_bundle * item.qty;
        aggregated.set(
          comp.product_id,
          (aggregated.get(comp.product_id) || 0) + qty,
        );
      }
      continue;
    }

    // Ambiguous: both product_id and bundle_id present
    if (productIdIsNonBlank && bundleIdIsNonBlank) {
      return {
        status: 'invalid',
        error:
          'Cannot approve order: Malformed Event Essentials order item — contains both product and bundle references.',
      };
    }

    // Malformed: neither valid product_id nor valid bundle_id
    return {
      status: 'invalid',
      error:
        'Cannot approve order: Malformed Event Essentials order item — missing product or bundle reference.',
    };
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

export function validateAvailabilityResult(
  requestedProductIds: string[],
  result: AvailabilityResultValidatorInput,
): { ok: boolean; error?: string } {
  if (result.error || !result.data) {
    return {
      ok: false,
      error:
        'Unable to verify Event Essentials availability. Please try again or contact us for assistance.',
    };
  }
  const returnedProductIds = new Set(result.data.map((r: any) => r.product_id));
  for (const reqId of requestedProductIds) {
    if (!returnedProductIds.has(reqId)) {
      return {
        ok: false,
        error:
          'Availability check did not return a result for all requested items. Please try again or contact us for assistance.',
      };
    }
  }
  const allAvailable = result.data.every((r: any) => r.is_allowed === true);
  if (!allAvailable) {
    return {
      ok: false,
      error:
        'One or more Event Essentials items are no longer available for the selected dates.',
    };
  }
  return { ok: true };
}
