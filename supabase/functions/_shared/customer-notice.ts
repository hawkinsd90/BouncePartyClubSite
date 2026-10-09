// Order-bound customer notifications sent by the backend on behalf of a customer-facing screen.
//
// The booking confirmation screens used to call the notification relays straight from the browser with the public anon key,
// choosing the recipient, subject and body themselves. The relays now refuse that (see notification-relay.ts). A customer
// screen instead asks an order-proof endpoint (complete-booking, customer-portal-action) to send its confirmation, and the
// endpoint:
//   - has already required proof of the exact order (Stripe session, order token or signed-in owner),
//   - addresses the message to the customer ON THE ORDER, read from the database - never to anything the browser supplied,
//   - calls the relays as the backend (service-role key).
// The browser still supplies the wording (the confirmation templates live in the web app); the most it can do with that is
// put different text in a message to the order's own customer.
//
// Import-free so the Node test harness can load it unchanged.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface CustomerNotice {
  emailSubject?: string;
  emailHtml?: string;
  smsMessage?: string;
}

export interface CustomerNoticeResult {
  emailSent: boolean;
  emailError: string | null;
  smsSent: boolean;
}

export async function sendOrderCustomerNotice(
  db: Db,
  env: { supabaseUrl: string; serviceKey: string },
  orderId: string,
  notice: CustomerNotice,
  fetchFn: typeof fetch,
): Promise<CustomerNoticeResult> {
  const result: CustomerNoticeResult = { emailSent: false, emailError: null, smsSent: false };

  const { data: order } = await db.from("orders").select("id, customers(email, phone)").eq("id", orderId).maybeSingle();
  const customer = order ? (Array.isArray(order.customers) ? order.customers[0] : order.customers) : null;
  if (!customer) {
    result.emailError = "Customer not found";
    return result;
  }

  const headers = { Authorization: `Bearer ${env.serviceKey}`, "Content-Type": "application/json" };

  if (notice.emailHtml !== undefined && notice.emailSubject !== undefined) {
    if (!customer.email) {
      result.emailError = "No customer email on file";
    } else {
      try {
        const res = await fetchFn(`${env.supabaseUrl}/functions/v1/send-email`, {
          method: "POST",
          headers,
          body: JSON.stringify({ to: customer.email, subject: notice.emailSubject, html: notice.emailHtml }),
        });
        if (res.ok) result.emailSent = true;
        else result.emailError = `Email failed (${res.status})`;
      } catch (e) {
        result.emailError = e instanceof Error ? e.message : "Email failed";
      }
    }
  }

  if (notice.smsMessage !== undefined && customer.phone) {
    try {
      const res = await fetchFn(`${env.supabaseUrl}/functions/v1/send-sms-notification`, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: customer.phone, message: notice.smsMessage, orderId }),
      });
      result.smsSent = res.ok;
    } catch {
      result.smsSent = false;
    }
  }

  return result;
}
