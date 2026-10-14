// Browser client for the Customer Portal server boundary (Payment Safety A2.2).
//
// Reads go through the customer-portal-data Edge Function and customer mutations through customer-portal-action. The
// browser sends only the order id, the portal/invoice token it was given (if any) and, for actions, a named action with
// its payload. Who the caller is (token holder, signed-in owner) is decided on the server; the browser's session is sent
// automatically by supabase.functions.invoke. No table, column or filter is ever chosen here.

import { supabase } from '../supabase';

export type PortalSection = 'core' | 'summary' | 'changelog' | 'invoiceLink' | 'lotPictures' | 'pictures' | 'delivery' | 'payment';

export interface PortalDeliveryState {
  delivery_images: string[];
  status: string | null;
  completed_time: string | null;
  updated_at: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PortalPayload {
  order?: any;
  orderItems?: any[];
  discounts?: any[];
  customFees?: any[];
  pricing?: any | null;
  changelog?: any[];
  invoiceLink?: { id: string; link_type: string; customer_filled: boolean | null; deposit_cents: number | null; expires_at: string | null } | null;
  lotPictures?: any[];
  pictures?: any[];
  delivery?: PortalDeliveryState | null;
  payment?: any | null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface PortalReadResult {
  viewer: 'token' | 'owner' | 'service' | 'staff';
  data: PortalPayload;
}

// The server answers every "you may not see this order" case identically (403). The UI treats it as "secure access
// required" and offers a new secure link.
export class PortalAccessError extends Error {
  constructor() {
    super('access_required');
    this.name = 'PortalAccessError';
  }
}

export class PortalUnavailableError extends Error {
  constructor() {
    super('portal_unavailable');
    this.name = 'PortalUnavailableError';
  }
}

export class PortalActionError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.name = 'PortalActionError';
    this.code = code;
  }
}

function statusOf(error: unknown): number | null {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  return typeof status === 'number' ? status : null;
}

export async function fetchPortalData(
  orderId: string,
  token: string | null | undefined,
  options: { sections?: PortalSection[]; paymentId?: string } = {},
): Promise<PortalReadResult> {
  const { data, error } = await supabase.functions.invoke('customer-portal-data', {
    body: {
      orderId,
      ...(token ? { token } : {}),
      ...(options.sections ? { sections: options.sections } : {}),
      ...(options.paymentId ? { paymentId: options.paymentId } : {}),
    },
  });
  if (error) {
    if (statusOf(error) === 403) throw new PortalAccessError();
    throw new PortalUnavailableError();
  }
  if (!data?.success) throw new PortalUnavailableError();
  return { viewer: data.viewer, data: data.data as PortalPayload };
}

export async function portalAction<T = Record<string, unknown>>(
  orderId: string,
  token: string | null | undefined,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('customer-portal-action', {
    body: { orderId, ...(token ? { token } : {}), action, payload },
  });
  if (error) {
    let code = 'unavailable';
    const status = statusOf(error);
    if (status === 403) code = 'access_required';
    else {
      try {
        const body = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
        if (body?.error) code = body.error;
      } catch {
        /* keep the generic code */
      }
    }
    throw new PortalActionError(code);
  }
  if (!data?.success) throw new PortalActionError(data?.error || 'unavailable');
  return data as T;
}
