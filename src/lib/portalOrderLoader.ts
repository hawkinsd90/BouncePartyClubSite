// Loads one Customer Portal order through the secure server endpoint and shapes it for the UI.
//
// Kept separate from the React hook so the whole decision table (ok / unchanged since last poll / secure access
// required / error) can be tested without a renderer. It reads no database table: everything comes from
// customer-portal-data, which proves the visitor holds a valid order-bound token or owns the order.

import { buildOrderSummaryData, formatOrderSummary, OrderSummaryDisplay } from './orderSummary';
import { fetchPortalData, PortalAccessError, PortalDeliveryState, PortalPayload } from './customerPortalApi';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OrderData {
  order: any;
  changelog: any[];
  orderItems: any[];
  discounts: any[];
  customFees: any[];
  invoiceLink: PortalPayload['invoiceLink'];
  orderSummary: OrderSummaryDisplay | null;
  lotPictures: any[];
  pictures: any[];
  delivery: PortalDeliveryState | null;
  viewer: 'token' | 'owner' | 'service' | 'staff';
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type PortalLoadOutcome =
  | { kind: 'ok'; result: OrderData; signature: string }
  | { kind: 'unchanged' }
  | { kind: 'access_required' }
  | { kind: 'error' };

export interface PortalLoaderDeps {
  fetchData: typeof fetchPortalData;
  buildSummary: typeof buildOrderSummaryData;
}

const defaultDeps: PortalLoaderDeps = { fetchData: fetchPortalData, buildSummary: buildOrderSummaryData };

export async function loadPortalOrder(
  orderId: string,
  token: string | null,
  options: { previousSignature?: string; silent?: boolean } = {},
  deps: PortalLoaderDeps = defaultDeps,
): Promise<PortalLoadOutcome> {
  try {
    const { viewer, data: payload } = await deps.fetchData(orderId, token, {
      sections: ['core', 'summary', 'changelog', 'invoiceLink', 'lotPictures', 'pictures', 'delivery'],
    });
    const order = payload.order;
    if (!order) return { kind: 'error' };

    // A background refresh that changed nothing must not re-render the portal (and reset what the customer is doing).
    const signature = JSON.stringify(payload);
    if (options.silent && signature === options.previousSignature) return { kind: 'unchanged' };

    const summaryData = await deps.buildSummary(
      {
        order,
        items: payload.orderItems ?? [],
        discounts: payload.discounts ?? [],
        customFees: payload.customFees ?? [],
        pricing: payload.pricing ?? null,
      },
      { persistTravelMiles: false },
    );

    if (order.tax_waived) {
      order.tax_cents = 0;
    }

    return {
      kind: 'ok',
      signature,
      result: {
        order,
        changelog: payload.changelog ?? [],
        orderItems: summaryData?.items || [],
        discounts: summaryData?.discounts || [],
        customFees: summaryData?.customFees || [],
        invoiceLink: payload.invoiceLink ?? null,
        orderSummary: summaryData ? formatOrderSummary(summaryData) : null,
        lotPictures: payload.lotPictures ?? [],
        pictures: payload.pictures ?? [],
        delivery: payload.delivery ?? null,
        viewer,
      },
    };
  } catch (error) {
    if (error instanceof PortalAccessError) return { kind: 'access_required' };
    return { kind: 'error' };
  }
}
