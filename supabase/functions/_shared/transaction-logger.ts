import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import { formatOrderId } from "./format-order-id.ts";

interface TransactionLogData {
  transactionType: 'deposit' | 'balance' | 'refund' | 'tip' | 'full_payment';
  orderId: string;
  customerId: string;
  paymentId?: string;
  amountCents: number;
  paymentMethod?: string | null;
  paymentMethodBrand?: string | null;
  stripeChargeId?: string | null;
  stripePaymentIntentId?: string | null;
  notes?: string;
  receiptGroupId?: string; // For grouping multi-line transactions
}

/**
 * Logs a transaction and sends admin notification email
 */
export async function logTransaction(
  supabaseClient: SupabaseClient,
  data: TransactionLogData
): Promise<string | null> {
  try {
    // Insert transaction receipt
    const { data: receipt, error } = await supabaseClient
      .from('transaction_receipts')
      .insert({
        transaction_type: data.transactionType,
        order_id: data.orderId,
        customer_id: data.customerId,
        payment_id: data.paymentId,
        amount_cents: data.amountCents,
        payment_method: data.paymentMethod,
        payment_method_brand: data.paymentMethodBrand,
        stripe_charge_id: data.stripeChargeId,
        stripe_payment_intent_id: data.stripePaymentIntentId,
        notes: data.notes,
        receipt_group_id: data.receiptGroupId,
      })
      .select('receipt_number')
      .maybeSingle();

    if (error) {
      console.error('[TransactionLogger] Error logging transaction:', error);
      return null;
    }

    if (!receipt) {
      // Unique constraint violation swallowed by maybeSingle — another writer
      // already inserted this receipt. Non-fatal; return null.
      console.warn('[TransactionLogger] Receipt insert returned no row (likely duplicate).');
      return null;
    }

    const receiptNumber = receipt.receipt_number;
    console.log('[TransactionLogger] Transaction logged:', receiptNumber);

    // Send admin notification asynchronously (fire and forget)
    sendAdminNotification(supabaseClient, receiptNumber, data).catch(err => {
      console.error('[TransactionLogger] Failed to send admin notification:', err);
    });

    return receiptNumber;
  } catch (err) {
    console.error('[TransactionLogger] Exception logging transaction:', err);
    return null;
  }
}

/**
 * Sends admin email notification for transaction
 */
async function sendAdminNotification(
  supabaseClient: SupabaseClient,
  receiptNumber: string,
  data: TransactionLogData
): Promise<void> {
  try {
    // Get admin email from settings (key-value lookup)
    const { data: adminEmailSetting } = await supabaseClient
      .from('admin_settings')
      .select('value')
      .eq('key', 'admin_email')
      .maybeSingle();

    const adminEmail = adminEmailSetting?.value;
    if (!adminEmail) {
      console.error('[TransactionLogger] Admin email not configured');
      return;
    }

    // Get order and customer details
    const { data: order } = await supabaseClient
      .from('orders')
      .select('*, customers(*)')
      .eq('id', data.orderId)
      .maybeSingle();

    if (!order || !order.customers) {
      console.error('[TransactionLogger] Order or customer not found');
      return;
    }

    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers;

    const transactionTypeLabel = {
      deposit: 'Deposit Payment',
      balance: 'Balance Payment',
      full_payment: 'Full Payment',
      tip: 'Tip Payment',
      refund: 'Refund',
    }[data.transactionType] || data.transactionType;

    const paymentMethodDisplay = data.paymentMethodBrand
      ? `${data.paymentMethod} (${data.paymentMethodBrand})`
      : data.paymentMethod || 'N/A';

    const amountFormatted = `$${(data.amountCents / 100).toFixed(2)}`;
    const eventDate = order.event_date
      ? new Date(order.event_date + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : 'N/A';

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f8f9fa; padding: 30px; border: 1px solid #e0e0e0; }
    .receipt-box { background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .receipt-number { font-size: 28px; font-weight: bold; color: #667eea; text-align: center; margin-bottom: 20px; }
    .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
    .detail-row:last-child { border-bottom: none; }
    .label { font-weight: 600; color: #555; }
    .value { color: #333; text-align: right; }
    .amount { font-size: 32px; font-weight: bold; color: #10b981; text-align: center; margin: 20px 0; }
    .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💳 Transaction Receipt</h1>
      <p style="margin: 5px 0 0; opacity: 0.9;">Bounce Party Club - Admin Notification</p>
    </div>

    <div class="content">
      <div class="receipt-box">
        <div class="receipt-number">${receiptNumber}</div>

        <div class="alert">
          <strong>⚡ Transaction Type:</strong> ${transactionTypeLabel}
        </div>

        <div class="amount">${amountFormatted}</div>

        <div class="detail-row">
          <span class="label">Order Number</span>
          <span class="value">#${formatOrderId(order.id)}</span>
        </div>

        <div class="detail-row">
          <span class="label">Customer</span>
          <span class="value">${customer.first_name} ${customer.last_name}</span>
        </div>

        <div class="detail-row">
          <span class="label">Customer Email</span>
          <span class="value">${customer.email}</span>
        </div>

        <div class="detail-row">
          <span class="label">Payment Method</span>
          <span class="value">${paymentMethodDisplay}</span>
        </div>

        <div class="detail-row">
          <span class="label">Transaction Date</span>
          <span class="value">${new Date().toLocaleString()}</span>
        </div>

        <div class="detail-row">
          <span class="label">Event Date</span>
          <span class="value">${eventDate}</span>
        </div>

        ${data.notes ? `
        <div class="detail-row">
          <span class="label">Notes</span>
          <span class="value">${data.notes}</span>
        </div>
        ` : ''}
      </div>

      <div style="background: #e0e7ff; border-radius: 8px; padding: 15px; margin-top: 20px;">
        <p style="margin: 0; color: #3730a3; font-size: 14px;">
          <strong>📊 Action Required:</strong> This transaction has been logged in your system.
          Review the order details in your admin dashboard for complete information.
        </p>
      </div>
    </div>

    <div class="footer">
      <p>This is an automated notification from Bounce Party Club Transaction System</p>
      <p style="font-size: 12px; color: #999;">Receipt generated at ${new Date().toLocaleString()}</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    // Send email
    await supabaseClient.functions.invoke('send-email', {
      body: {
        to: adminEmail,
        subject: `Transaction Receipt ${receiptNumber} - ${transactionTypeLabel}`,
        html: htmlBody,
      },
    });

    // Mark receipt as sent
    await supabaseClient
      .from('transaction_receipts')
      .update({
        receipt_sent_to_admin: true,
        admin_notified_at: new Date().toISOString(),
      })
      .eq('receipt_number', receiptNumber);

    console.log('[TransactionLogger] Admin notification sent:', receiptNumber);
  } catch (err) {
    console.error('[TransactionLogger] Exception sending admin notification:', err);
    throw err;
  }
}
