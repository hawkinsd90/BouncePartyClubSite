import { supabase } from './supabase';
import { sendEmail } from './notificationService';
import {
  generateConfirmationReceiptEmail,
  generateConfirmationSmsMessage,
  generateRejectionSmsMessage,
} from './orderEmailTemplates';
import { checkMultipleUnitsAvailability } from './availability';
import { formatOrderId } from './utils';
import { logGroupedTransactions } from './transactionReceiptService';

interface ApprovalResult {
  success: boolean;
  error?: string;
}

export async function approveOrder(
  orderId: string,
  sendSms: (message: string) => Promise<boolean>
): Promise<ApprovalResult> {
  try {
    // First, fetch the order and check availability
    const { data: orderData } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', orderId)
      .single();

    if (!orderData) {
      throw new Error('Order not found');
    }

    // Check availability before approving
    const orderItems = (Array.isArray(orderData.order_items) ? orderData.order_items : []) as any[];
    const availabilityChecks = orderItems.map(item => ({
      unitId: item.unit_id,
      eventStartDate: orderData.event_date,
      eventEndDate: orderData.event_end_date || orderData.event_date,
      excludeOrderId: orderId, // Exclude this order from conflict check
    }));

    const availabilityResults = await checkMultipleUnitsAvailability(availabilityChecks);
    const unavailableUnits = availabilityResults.filter(result => !result.isAvailable);

    if (unavailableUnits.length > 0) {
      // Fetch unit names for error message
      const { data: units } = await supabase
        .from('units')
        .select('id, name')
        .in('id', unavailableUnits.map(u => u.unitId));

      const unitNames = unavailableUnits.map(u => {
        const unit = units?.find(unit => unit.id === u.unitId);
        return unit?.name || 'Unknown unit';
      }).join(', ');

      throw new Error(
        `Cannot approve order: The following units are no longer available for the selected dates: ${unitNames}. Please check the calendar for conflicts.`
      );
    }

    // Proceed with charging deposit
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/charge-deposit`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderId }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      console.error('Charge deposit failed:', data);
      // Send decline notification to customer
      try {
        const { data: fullOrder } = await supabase
          .from('orders')
          .select('*, customers(*), addresses(*)')
          .eq('id', orderId)
          .single();

        if (fullOrder?.customers?.email) {
          const portalUrl = `${window.location.origin}/customer-portal/${orderId}`;
          const declineEmailHtml = generateCardDeclinedEmail(fullOrder, portalUrl);
          await sendEmail({
            to: fullOrder.customers.email,
            subject: `Action Required: Payment Declined for Order #${formatOrderId(orderId)}`,
            html: declineEmailHtml,
          });
        }

        if (fullOrder?.customers?.first_name) {
          const declineSms = `Bounce Party Club: Hi ${fullOrder.customers.first_name}, your card was declined for Order #${formatOrderId(orderId)}. Your booking could not be confirmed. Please update your payment method at: ${window.location.origin}/customer-portal/${orderId}`;
          try {
            await sendSms(declineSms);
          } catch (_smsErr) {
            console.error('Failed to send decline SMS');
          }
        }
      } catch (notifyErr) {
        console.error('Failed to send decline notifications:', notifyErr);
      }

      throw new Error(data.error || 'Failed to charge card. Customer has been notified via email and SMS.');
    }

    console.log('Deposit charged successfully:', data);

    // Get payment record to link to transaction receipt
    const { data: paymentRecord } = await supabase
      .from('payments')
      .select('id')
      .eq('stripe_payment_intent_id', data.paymentDetails?.paymentIntentId)
      .maybeSingle();

    // Get customer data for transaction receipt
    const { data: customerData } = await supabase
      .from('customers')
      .select('*')
      .eq('id', orderData.customer_id)
      .single();

    // Use Stripe's actual charge amount as the source of truth for receipts and invoice
    // This prevents drift between what was charged vs what we record in accounting
    const stripeGrossCents = data.paymentDetails?.amountCents ?? null;
    const tipAmountCents = orderData.tip_cents ?? 0;
    const depositAmountCents =
      stripeGrossCents != null
        ? Math.max(0, stripeGrossCents - tipAmountCents)
        : (orderData.customer_selected_payment_cents ?? orderData.deposit_due_cents);
    const paidAmountCents =
      stripeGrossCents != null
        ? stripeGrossCents
        : (depositAmountCents + tipAmountCents);

    // Log deposit transaction and notify admin with grouped receipts
    if (customerData) {
      // Build array of transactions to log (grouped)
      const transactions = [
        {
          transactionType: 'deposit' as const,
          orderId,
          customerId: orderData.customer_id,
          paymentId: paymentRecord?.id,
          amountCents: depositAmountCents,
          paymentMethod: data.paymentDetails?.paymentMethod,
          paymentMethodBrand: data.paymentDetails?.paymentBrand,
          stripeChargeId: data.paymentDetails?.chargeId,
          stripePaymentIntentId: data.paymentDetails?.paymentIntentId,
          notes: `Deposit payment for Order ${formatOrderId(orderId)}`,
        }
      ];

      // Add tip transaction if present
      if (tipAmountCents > 0) {
        transactions.push({
          transactionType: 'tip' as const,
          orderId,
          customerId: orderData.customer_id,
          paymentId: paymentRecord?.id,
          amountCents: tipAmountCents,
          paymentMethod: data.paymentDetails?.paymentMethod,
          paymentMethodBrand: data.paymentDetails?.paymentBrand,
          stripeChargeId: data.paymentDetails?.chargeId,
          stripePaymentIntentId: data.paymentDetails?.paymentIntentId,
          notes: `Crew tip for Order ${formatOrderId(orderId)}`,
        });
      }

      // Log all transactions as a grouped receipt
      await logGroupedTransactions(transactions, orderData, customerData);
    }

    const { data: invoiceNumberData } = await supabase.rpc('generate_invoice_number');
    const invoiceNumber = invoiceNumberData || `INV-${Date.now()}`;

    const totalCents =
      orderData.subtotal_cents +
      orderData.travel_fee_cents +
      (orderData.surface_fee_cents ?? 0) +
      (orderData.same_day_pickup_fee_cents ?? 0) +
      (orderData.tax_cents ?? 0) +
      (orderData.tip_cents ?? 0);

    // Determine invoice status based on payment amount vs total
    const invoiceStatus = paidAmountCents >= totalCents ? 'paid' : (paidAmountCents > 0 ? 'partial' : 'sent');

    await supabase.from('invoices').insert({
      invoice_number: invoiceNumber,
      order_id: orderId,
      customer_id: orderData.customer_id,
      due_date: orderData.event_date,
      status: invoiceStatus,
      subtotal_cents: orderData.subtotal_cents,
      tax_cents: orderData.tax_cents ?? 0,
      travel_fee_cents: orderData.travel_fee_cents ?? 0,
      surface_fee_cents: orderData.surface_fee_cents ?? 0,
      same_day_pickup_fee_cents: orderData.same_day_pickup_fee_cents ?? 0,
      total_cents: totalCents,
      paid_amount_cents: paidAmountCents,
    });

    const { data: orderWithRelations } = await supabase
      .from('orders')
      .select(`*, customers (*), addresses (*), order_items (*, units (*))`)
      .eq('id', orderId)
      .single();

    const customer = orderWithRelations?.customers as any;

    if (customer) {
      const confirmationMessage = generateConfirmationSmsMessage(orderData, customer.first_name);
      try {
        await sendSms(confirmationMessage);
      } catch (smsError) {
        console.error('Error sending confirmation SMS:', smsError);
      }

      await sendConfirmationEmail(orderWithRelations, totalCents);
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error approving order:', error);
    return { success: false, error: error.message || 'Failed to approve order' };
  }
}

export async function forceApproveOrder(orderId: string): Promise<ApprovalResult> {
  try {
    // Fetch the order and check availability
    const { data: orderData } = await supabase
      .from('orders')
      .select('*, order_items (*)')
      .eq('id', orderId)
      .single();

    if (!orderData) {
      throw new Error('Order not found');
    }

    // Check availability before force approving
    const orderItems = (Array.isArray(orderData.order_items) ? orderData.order_items : []) as any[];
    const availabilityChecks = orderItems.map(item => ({
      unitId: item.unit_id,
      eventStartDate: orderData.event_date,
      eventEndDate: orderData.event_end_date || orderData.event_date,
      excludeOrderId: orderId, // Exclude this order from conflict check
    }));

    const availabilityResults = await checkMultipleUnitsAvailability(availabilityChecks);
    const unavailableUnits = availabilityResults.filter(result => !result.isAvailable);

    if (unavailableUnits.length > 0) {
      // Fetch unit names for error message
      const { data: units } = await supabase
        .from('units')
        .select('id, name')
        .in('id', unavailableUnits.map(u => u.unitId));

      const unitNames = unavailableUnits.map(u => {
        const unit = units?.find(unit => unit.id === u.unitId);
        return unit?.name || 'Unknown unit';
      }).join(', ');

      throw new Error(
        `Cannot force approve order: The following units are not available: ${unitNames}. There are conflicting bookings for these dates.`
      );
    }

    // Proceed with force approval
    const { error } = await supabase
      .from('orders')
      .update({ status: 'confirmed' })
      .eq('id', orderId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error('Error force approving order:', error);
    return { success: false, error: error.message || 'Failed to force approve order' };
  }
}

export async function rejectOrder(
  order: any,
  reason: string,
  sendSms: (message: string) => Promise<boolean>
): Promise<ApprovalResult> {
  try {
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', order.id);

    if (error) throw error;

    await supabase
      .from('payments')
      .update({ status: 'cancelled' })
      .eq('order_id', order.id)
      .eq('status', 'pending');

    const rejectionMessage = generateRejectionSmsMessage(order, order.customers?.first_name, reason);

    try {
      await sendSms(rejectionMessage);
    } catch (smsError) {
      console.error('Error sending rejection SMS:', smsError);
      throw new Error('Booking rejected (SMS notification failed - please contact customer manually).');
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error rejecting order:', error);
    return { success: false, error: error.message || 'Failed to reject order' };
  }
}

function generateCardDeclinedEmail(order: any, portalUrl: string): string {
  const firstName = order.customers?.first_name || 'Customer';
  const shortId = order.id.replace(/-/g, '').toUpperCase().slice(0, 8);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;border:1px solid #fecaca;">
  <tr>
    <td align="center" style="padding:24px 40px 16px;border-bottom:2px solid #fecaca;background-color:#fef2f2;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;color:#dc2626;font-size:24px;font-weight:bold;">Payment Declined</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px;">
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">Hi ${firstName},</p>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">
        We were unable to process your payment for Order <strong>#${shortId}</strong>. Your card was declined and your booking could not be confirmed.
      </p>
      <p style="margin:0 0 24px;color:#374151;font-size:15px;">
        To save your booking, please visit your customer portal to update your payment method and try again.
      </p>
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${portalUrl}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 36px;border-radius:6px;">Update Payment Method</a>
      </div>
      <p style="margin:0;color:#6b7280;font-size:13px;text-align:center;">If you have questions, please call us at (313) 889-3860.</p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

async function sendConfirmationEmail(orderWithItems: any, totalCents: number) {
  try {
    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderWithItems.id)
      .eq('type', 'deposit')
      .eq('status', 'succeeded')
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const customer = orderWithItems?.customers as any;
    const address = orderWithItems?.addresses as any;
    const items = (orderWithItems?.order_items as any) || [];

    if (customer?.email) {
      const emailHtml = generateConfirmationReceiptEmail({
        order: orderWithItems,
        customer,
        address,
        items,
        payment,
        totalCents,
      });

      await sendEmail({
        to: customer.email,
        subject: `Booking Confirmed - Receipt for Order #${formatOrderId(orderWithItems.id)}`,
        html: emailHtml,
      });
    }
  } catch (emailError) {
    console.error('Error sending receipt email:', emailError);
  }
}
