import { supabase } from './supabase';
import { formatCurrency } from './pricing';
import { formatOrderId } from './utils';

interface TransactionReceiptData {
  transactionType: 'deposit' | 'balance' | 'refund' | 'tip' | 'full_payment';
  orderId: string;
  customerId: string;
  paymentId?: string;
  amountCents: number;
  paymentMethod?: string;
  paymentMethodBrand?: string;
  stripeChargeId?: string;
  stripePaymentIntentId?: string;
  notes?: string;
  receiptGroupId?: string; // For grouping multi-line transactions
}

interface ReceiptEmailData {
  receiptNumber: string;
  transactionType: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  amountCents: number;
  paymentMethod?: string;
  paymentMethodBrand?: string;
  transactionDate: string;
  eventDate?: string;
  notes?: string;
}

/**
 * Logs a financial transaction and creates a receipt record
 * Handles duplicate charge_id gracefully by returning existing receipt
 */
export async function logTransaction(data: TransactionReceiptData): Promise<string | null> {
  try {
    // Pre-check for existing receipt using PRIMARY dedupe key: (payment_intent_id, transaction_type)
    // This prevents collapsing tip into deposit when both share same charge_id
    if (data.stripePaymentIntentId && data.transactionType) {
      const { data: existingReceipt } = await supabase
        .from('transaction_receipts')
        .select('receipt_number')
        .eq('stripe_payment_intent_id', data.stripePaymentIntentId)
        .eq('transaction_type', data.transactionType)
        .maybeSingle();

      if (existingReceipt) {
        console.log('[TransactionReceipt] Receipt already exists for (PI, type):', existingReceipt.receipt_number);
        return existingReceipt.receipt_number;
      }
    }
    // Fallback: if only charge_id is available (no PI or type), check by charge_id
    else if (data.stripeChargeId) {
      const { data: existingReceipt } = await supabase
        .from('transaction_receipts')
        .select('receipt_number')
        .eq('stripe_charge_id', data.stripeChargeId)
        .maybeSingle();

      if (existingReceipt) {
        console.log('[TransactionReceipt] Receipt already exists for charge:', existingReceipt.receipt_number);
        return existingReceipt.receipt_number;
      }
    }

    const { data: receipt, error } = await supabase
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
      .single();

    if (error) {
      // If unique constraint violation, recover using PRIMARY dedupe key
      if (error.code === '23505') {
        console.warn('[TransactionReceipt] Duplicate detected (23505), fetching existing receipt');

        // Try by (payment_intent_id, transaction_type) first (primary dedupe key)
        if (data.stripePaymentIntentId && data.transactionType) {
          const { data: existingReceipt } = await supabase
            .from('transaction_receipts')
            .select('receipt_number')
            .eq('stripe_payment_intent_id', data.stripePaymentIntentId)
            .eq('transaction_type', data.transactionType)
            .maybeSingle();

          if (existingReceipt) {
            return existingReceipt.receipt_number;
          }
        }

        // Fallback to charge_id if PI/type not available
        if (data.stripeChargeId) {
          const { data: existingReceipt } = await supabase
            .from('transaction_receipts')
            .select('receipt_number')
            .eq('stripe_charge_id', data.stripeChargeId)
            .maybeSingle();

          if (existingReceipt) {
            return existingReceipt.receipt_number;
          }
        }
      }

      console.error('[TransactionReceipt] Error logging transaction:', error);
      return null;
    }

    console.log('[TransactionReceipt] Transaction logged:', receipt.receipt_number);
    return receipt.receipt_number;
  } catch (err) {
    console.error('[TransactionReceipt] Exception logging transaction:', err);
    return null;
  }
}

/**
 * Sends transaction receipt to admin email
 */
export async function sendAdminTransactionReceipt(
  receiptNumber: string,
  receiptData: ReceiptEmailData
): Promise<void> {
  try {
    // Get admin email from settings (key-value lookup)
    const { data } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'admin_email')
      .maybeSingle();

    const adminEmail = data?.value;
    if (!adminEmail) {
      console.error('[TransactionReceipt] Admin email not configured');
      return;
    }

    const subject = `Transaction Receipt ${receiptNumber} - ${receiptData.transactionType.toUpperCase()}`;
    const htmlBody = generateAdminReceiptEmail(receiptData);

    // Send email via edge function
    const { error } = await supabase.functions.invoke('send-email', {
      body: {
        to: adminEmail,
        subject,
        html: htmlBody,
      },
    });

    if (error) {
      console.error('[TransactionReceipt] Error sending admin email:', error);
      return;
    }

    // Mark receipt as sent to admin
    await supabase
      .from('transaction_receipts')
      .update({
        receipt_sent_to_admin: true,
        admin_notified_at: new Date().toISOString(),
      })
      .eq('receipt_number', receiptNumber);

    console.log('[TransactionReceipt] Admin receipt email sent:', receiptNumber);
  } catch (err) {
    console.error('[TransactionReceipt] Exception sending admin email:', err);
  }
}

/**
 * Generates HTML email for admin transaction receipt
 */
function generateAdminReceiptEmail(data: ReceiptEmailData): string {
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

  return `
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
        <div class="receipt-number">${data.receiptNumber}</div>

        <div class="alert">
          <strong>⚡ Transaction Type:</strong> ${transactionTypeLabel}
        </div>

        <div class="amount">${formatCurrency(data.amountCents)}</div>

        <div class="detail-row">
          <span class="label">Order Number</span>
          <span class="value">#${data.orderNumber}</span>
        </div>

        <div class="detail-row">
          <span class="label">Customer</span>
          <span class="value">${data.customerName}</span>
        </div>

        <div class="detail-row">
          <span class="label">Customer Email</span>
          <span class="value">${data.customerEmail}</span>
        </div>

        <div class="detail-row">
          <span class="label">Payment Method</span>
          <span class="value">${paymentMethodDisplay}</span>
        </div>

        <div class="detail-row">
          <span class="label">Transaction Date</span>
          <span class="value">${data.transactionDate}</span>
        </div>

        ${data.eventDate ? `
        <div class="detail-row">
          <span class="label">Event Date</span>
          <span class="value">${data.eventDate}</span>
        </div>
        ` : ''}

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
}

/**
 * Logs multiple transactions as a grouped receipt (e.g., deposit + tip)
 * Returns the receipt group ID and all receipt numbers
 */
export async function logGroupedTransactions(
  transactions: TransactionReceiptData[],
  orderData: any,
  customerData: any
): Promise<{ groupId: string; receiptNumbers: string[] } | null> {
  if (transactions.length === 0) {
    return null;
  }

  try {
    // Generate a single receipt group ID for all transactions
    const receiptGroupId = crypto.randomUUID();

    const receiptNumbers: string[] = [];

    // Log all transactions with the same group ID
    for (const transaction of transactions) {
      const receiptNumber = await logTransaction({
        ...transaction,
        receiptGroupId,
      });

      if (receiptNumber) {
        receiptNumbers.push(receiptNumber);
      }
    }

    if (receiptNumbers.length === 0) {
      console.error('[TransactionReceipt] No receipts were created for grouped transaction');
      return null;
    }

    // Send a single grouped admin notification
    await sendGroupedAdminNotification(
      receiptGroupId,
      receiptNumbers,
      transactions,
      orderData,
      customerData
    );

    console.log(`[TransactionReceipt] Grouped transaction logged: ${receiptNumbers.length} receipts in group ${receiptGroupId}`);

    return { groupId: receiptGroupId, receiptNumbers };
  } catch (err) {
    console.error('[TransactionReceipt] Exception logging grouped transaction:', err);
    return null;
  }
}

/**
 * Sends a single admin notification for grouped receipts
 */
async function sendGroupedAdminNotification(
  groupId: string,
  receiptNumbers: string[],
  transactions: TransactionReceiptData[],
  orderData: any,
  customerData: any
): Promise<void> {
  try {
    // Get admin email from settings (key-value lookup)
    const { data } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'admin_email')
      .maybeSingle();

    const adminEmail = data?.value;
    if (!adminEmail) {
      console.error('[TransactionReceipt] Admin email not configured');
      return;
    }

    const totalAmount = transactions.reduce((sum, t) => sum + t.amountCents, 0);
    const subject = `Grouped Transaction Receipt - ${receiptNumbers.length} Items - ${formatCurrency(totalAmount)}`;
    const htmlBody = generateGroupedReceiptEmail(
      groupId,
      receiptNumbers,
      transactions,
      orderData,
      customerData
    );

    // Send email via edge function
    const { error } = await supabase.functions.invoke('send-email', {
      body: {
        to: adminEmail,
        subject,
        html: htmlBody,
      },
    });

    if (error) {
      console.error('[TransactionReceipt] Error sending grouped admin email:', error);
      return;
    }

    // Mark all receipts as sent to admin
    await supabase
      .from('transaction_receipts')
      .update({
        receipt_sent_to_admin: true,
        admin_notified_at: new Date().toISOString(),
      })
      .in('receipt_number', receiptNumbers);

    console.log('[TransactionReceipt] Grouped admin receipt email sent');
  } catch (err) {
    console.error('[TransactionReceipt] Exception sending grouped admin email:', err);
  }
}

/**
 * Generates HTML email for grouped transaction receipt
 */
function generateGroupedReceiptEmail(
  groupId: string,
  receiptNumbers: string[],
  transactions: TransactionReceiptData[],
  orderData: any,
  customerData: any
): string {
  const totalAmount = transactions.reduce((sum, t) => sum + t.amountCents, 0);
  const orderNumber = formatOrderId(orderData.id);
  const customerName = `${customerData.first_name} ${customerData.last_name}`;
  const transactionDate = new Date().toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const lineItemsHtml = transactions.map((t, index) => {
    const typeLabel = {
      deposit: 'Deposit',
      balance: 'Balance Payment',
      full_payment: 'Full Payment',
      tip: 'Crew Tip',
      refund: 'Refund',
    }[t.transactionType] || t.transactionType;

    return `
      <div style="display: flex; justify-content: space-between; padding: 10px; background: ${index % 2 === 0 ? '#f9fafb' : 'white'};">
        <div>
          <strong>${typeLabel}</strong>
          <div style="font-size: 12px; color: #666;">${receiptNumbers[index]}</div>
        </div>
        <div style="font-weight: bold; color: #10b981;">${formatCurrency(t.amountCents)}</div>
      </div>
    `;
  }).join('');

  return `
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
    .group-id { font-size: 14px; color: #667eea; text-align: center; margin-bottom: 10px; }
    .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e0e0e0; }
    .detail-row:last-child { border-bottom: none; }
    .label { font-weight: 600; color: #555; }
    .value { color: #333; text-align: right; }
    .total-amount { font-size: 36px; font-weight: bold; color: #10b981; text-align: center; margin: 20px 0; padding: 15px; background: #f0fdf4; border-radius: 8px; }
    .line-items { margin: 20px 0; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
    .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; color: #666; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💳 Grouped Transaction Receipt</h1>
      <p style="margin: 5px 0 0; opacity: 0.9;">Bounce Party Club - Admin Notification</p>
    </div>

    <div class="content">
      <div class="receipt-box">
        <div class="group-id">Group ID: ${groupId}</div>

        <div class="alert">
          <strong>⚡ ${transactions.length} Transaction${transactions.length > 1 ? 's' : ''} Processed</strong>
        </div>

        <div class="total-amount">
          Total: ${formatCurrency(totalAmount)}
        </div>

        <div class="detail-row">
          <span class="label">Order Number</span>
          <span class="value">#${orderNumber}</span>
        </div>

        <div class="detail-row">
          <span class="label">Customer</span>
          <span class="value">${customerName}</span>
        </div>

        <div class="detail-row">
          <span class="label">Customer Email</span>
          <span class="value">${customerData.email}</span>
        </div>

        <div class="detail-row">
          <span class="label">Transaction Date</span>
          <span class="value">${transactionDate}</span>
        </div>

        <div style="margin-top: 20px;">
          <div style="font-weight: 600; color: #555; margin-bottom: 10px;">Line Items:</div>
          <div class="line-items">
            ${lineItemsHtml}
          </div>
        </div>
      </div>

      <div style="background: #e0e7ff; border-radius: 8px; padding: 15px; margin-top: 20px;">
        <p style="margin: 0; color: #3730a3; font-size: 14px;">
          <strong>📊 Action Required:</strong> This grouped transaction has been logged in your system.
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
}

/**
 * Comprehensive transaction logging with admin notification
 */
export async function logAndNotifyTransaction(
  transactionData: TransactionReceiptData,
  orderData: any,
  customerData: any
): Promise<string | null> {
  // Log transaction
  const receiptNumber = await logTransaction(transactionData);

  if (!receiptNumber) {
    return null;
  }

  // Prepare receipt email data
  const receiptEmailData: ReceiptEmailData = {
    receiptNumber,
    transactionType: transactionData.transactionType,
    orderNumber: formatOrderId(orderData.id),
    customerName: `${customerData.first_name} ${customerData.last_name}`,
    customerEmail: customerData.email,
    amountCents: transactionData.amountCents,
    paymentMethod: transactionData.paymentMethod,
    paymentMethodBrand: transactionData.paymentMethodBrand,
    transactionDate: new Date().toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }),
    eventDate: orderData.event_date ? new Date(orderData.event_date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }) : undefined,
    notes: transactionData.notes,
  };

  // Send admin notification (don't await - fire and forget)
  sendAdminTransactionReceipt(receiptNumber, receiptEmailData).catch(err => {
    console.error('[TransactionReceipt] Failed to send admin notification:', err);
  });

  return receiptNumber;
}
