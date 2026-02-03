import { supabase } from './supabase';
import { sendEmail } from './notificationService';
import {
  generateConfirmationReceiptEmail,
  generateConfirmationSmsMessage,
  generateRejectionSmsMessage,
} from './orderEmailTemplates';
import { checkMultipleUnitsAvailability } from './availability';
import { formatOrderId } from './utils';

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
      throw new Error(data.error || 'Failed to charge card');
    }

    console.log('Deposit charged successfully:', data);

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
      due_date: orderData.event_date,
      paid_at: null,
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
