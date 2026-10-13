import { readPortalToken } from './portalToken';

export type ShortPortalLinkResult =
  | { success: true; url: string; shortCode: string }
  | { success: false; error: string };

// Asks the server (portal-link Edge Function) for the order's canonical secure portal short link. This helper never
// creates the token, and portal-link returns only the short code; the short-link resolver (resolve-link) later hands
// the order-bound token to the customer portal, which carries it in the URL fragment (#t=...). Staff (admin/master/crew) are authorized by their
// session; a customer must present proof for this order (their portal token, a Checkout session, or ownership).
// A raw order id is never enough, and no fallback ever produces a /customer-portal/<uuid> URL.
export async function createShortPortalLink(
  orderId: string,
  supabaseClient: any,
  _eventDate?: string | null,
  invoiceToken?: string | null,
  sessionId?: string | null
): Promise<ShortPortalLinkResult> {
  const token = invoiceToken ?? readPortalToken();
  const { data, error } = await supabaseClient.functions.invoke('portal-link', {
    body: {
      orderId,
      ...(token ? { token } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
  });

  if (!error && data?.success && typeof data.shortCode === 'string' && data.shortCode) {
    return {
      success: true,
      url: `${window.location.origin}/i/${data.shortCode}`,
      shortCode: data.shortCode,
    };
  }

  const underlyingError = error?.message || data?.error || 'Short-link generation failed';
  console.error('[createShortPortalLink] Could not get a secure portal link for order:', orderId, underlyingError);
  return { success: false, error: underlyingError };
}
