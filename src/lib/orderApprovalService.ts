import { supabase } from './supabase';
import {
  generateConfirmationReceiptEmail,
  generateConfirmationSmsMessage,
  generateRejectionSmsMessage,
} from './orderEmailTemplates';

interface ApprovalResult {
  success: boolean;
  error?: string;
}

export async function approveOrder(
  orderId: string,
  sendSms: (message: string) => Promise<boolean>
): Promise<ApprovalResult> {
  try {
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
      throw new Error(data.error || 'Failed to charge card');
    }

    console.log('Deposit charged successfully:', data);

    const { data: orderData } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (!orderData) {
      throw new Error('Order not found');
    }

    const { data: invoiceNumberData } = await supabase.rpc('generate_invoice_number');
    const invoiceNumber = invoiceNumberData || `INV-${Date.now()}`;

    const totalCents =
      orderData.subtotal_cents +
      orderData.travel_fee_cents +
      (orderData.surface_fee_cents ?? 0) +
      (orderData.same_day_pickup_fee_cents ?? 0) +
      (orderData.tax_cents ?? 0);

    await supabase.from('invoices').insert({
      invoice_number: invoiceNumber,
      order_id: orderId,
      customer_id: orderData.customer_id,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: orderData.event_date,
      status: 'sent',
      subtotal_cents: orderData.subtotal_cents,
      tax_cents: orderData.tax_cents ?? 0,
      travel_fee_cents: orderData.travel_fee_cents ?? 0,
      surface_fee_cents: orderData.surface_fee_cents ?? 0,
      same_day_pickup_fee_cents: orderData.same_day_pickup_fee_cents,
      total_cents: totalCents,
      paid_amount_cents:
        (orderData.deposit_paid_cents || 0) + (orderData.balance_paid_cents || 0),
      payment_method: 'card',
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

async function sendConfirmationEmail(orderWithItems: any, totalCents: number) {
  try {
    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('order_id', orderWithItems.id)
      .eq('type', 'deposit')
      .eq('status', 'completed')
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

      const emailApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`;
      await fetch(emailApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: customer.email,
          subject: `Booking Confirmed - Receipt for Order #${orderWithItems.id.slice(0, 8).toUpperCase()}`,
          html: emailHtml,
        }),
      });
    }
  } catch (emailError) {
    console.error('Error sending receipt email:', emailError);
  }
}
