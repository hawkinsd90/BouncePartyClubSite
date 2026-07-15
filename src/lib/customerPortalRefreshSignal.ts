import { supabase } from './supabase';

const SEND_TIMEOUT_MS = 3000;

export async function notifyPortalRefresh(orderId: string): Promise<{ delivered: boolean }> {
  const channel = supabase.channel(`portal-order-${orderId}`);

  let delivered = false;

  try {
    const readyPromise = new Promise<void>((resolve) => {
      const sub = channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') resolve();
      });
      // Resolve after a short delay even if not subscribed — best-effort
      setTimeout(() => resolve(), 200);
      void sub;
    });

    await Promise.race([
      readyPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('subscribe timeout')), SEND_TIMEOUT_MS)),
    ]);

    const sendResult = await channel.send({
      type: 'broadcast',
      event: 'order_updated',
      payload: { id: orderId },
    });

    delivered = sendResult === 'ok';
    if (!delivered) {
      console.warn('[customerPortalRefreshSignal] broadcast send returned non-ok:', sendResult);
    }
  } catch (err) {
    console.warn('[customerPortalRefreshSignal] broadcast failed (non-fatal):', err instanceof Error ? err.message : 'unknown');
  } finally {
    supabase.removeChannel(channel);
  }

  return { delivered };
}
