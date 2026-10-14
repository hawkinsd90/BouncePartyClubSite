// Pure calendar task assembly, extracted verbatim from useCalendarTasks.loadTasksForMonth.
//
// Given the rows the hook already loaded (orders, order items, task statuses) and the generator category
// product ids, builds the drop-off and pick-up Task objects, in order: for each order, drop-off then pick-up.
// No Supabase, no React, no clock. Current quirks are preserved on purpose, including that the pick-up date
// is derived from event_date alone (same day, or the next day) and ignores event_end_date.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { format, parseISO, addDays } from 'date-fns';
import { formatOrderId } from '../utils';
import { ORDER_STATUS } from '../constants/statuses';
import { formatOperationalEquipment } from './operationalEquipment';
import { aggregateOrderEquipment } from '../eventEssentials/customerGeneratorCart';
import type { Task } from '../../hooks/useCalendarTasks';

export type PickupReadiness = 'projected' | 'blocked' | 'ready' | 'completed';

export function deriveWaiverType(
  waiverSignedAt: string | null,
  signatures: Array<{
    electronic_consent_given: boolean;
    physical_waiver_storage_path: string | null;
    physical_waiver_upload_source?: string | null;
  }>
): 'digital' | 'paper_with_photo' | 'paper_no_photo' | null {
  if (!waiverSignedAt) return null;
  if (!signatures || signatures.length === 0) return null;
  // Scan all rows — digital takes priority across the entire set
  if (signatures.some(s => s.electronic_consent_given)) return 'digital';
  if (signatures.some(s => s.physical_waiver_storage_path)) return 'paper_with_photo';
  if (signatures.some(s => s.physical_waiver_upload_source === 'admin_no_photo')) return 'paper_no_photo';
  return null;
}

export function derivePickupReadiness(
  orderStatus: string,
  dropOffTaskStatus: string | null,
  pickUpTaskStatus: string | null,
  balanceDue: number
): PickupReadiness {
  if (pickUpTaskStatus === 'completed') return 'completed';
  // pending_review orders are not yet confirmed — treat pickup as planning-only
  if (orderStatus === ORDER_STATUS.PENDING) return 'projected';
  if (dropOffTaskStatus !== 'completed') return 'projected';
  if (balanceDue > 0) return 'blocked';
  return 'ready';
}

export function derivePickupBlockReason(
  readiness: PickupReadiness,
  dropOffTaskStatus: string | null,
  balanceDue: number,
  orderStatus?: string
): string | undefined {
  if (readiness === 'projected') {
    if (orderStatus === ORDER_STATUS.PENDING) return 'Order not yet confirmed';
    if (!dropOffTaskStatus || dropOffTaskStatus === 'pending') return 'Drop-off not yet started';
    if (dropOffTaskStatus === 'en_route') return 'Drop-off in progress';
    if (dropOffTaskStatus === 'arrived') return 'Drop-off in progress';
    return 'Drop-off not yet completed';
  }
  if (readiness === 'blocked') {
    return `Unpaid balance: $${(balanceDue / 100).toFixed(2)}`;
  }
  return undefined;
}

export interface CalendarTaskAssemblyInput {
  // Rows exactly as the hook loaded them (orders with customers/addresses/payments/order_signatures joined).
  orders: any[];
  // `null` when the order_items query returned no data (the hook ignores that query's error).
  orderItems: any[] | null;
  // `null` when the task_status query returned no data.
  taskStatuses: any[] | null;
  generatorCategoryProductIds: Set<string>;
}

// The task_status row -> Task.taskStatus projection (identical for drop-off and pick-up).
function projectTaskStatusRow(row: any): NonNullable<Task['taskStatus']> {
  return {
    id: row.id,
    status: row.status,
    sortOrder: row.sort_order,
    completedTime: row.completed_time ?? null,
    deliveryImages: (row.delivery_images as any) || [],
    damageImages: (row.damage_images as any) || [],
    etaSent: row.eta_sent || false,
  };
}

export function buildCalendarTasks({ orders, orderItems, taskStatuses, generatorCategoryProductIds }: CalendarTaskAssemblyInput): Task[] {
  const generatedTasks: Task[] = [];

  for (const order of orders) {
    const eventDate = parseISO(order.event_date);
    const customer = order.customers as any;
    const customerName = customer
      ? `${customer.first_name} ${customer.last_name}`
      : 'Unknown Customer';

    const addr = order.addresses as any;
    const address = addr
      ? `${addr.line1}, ${addr.city}, ${addr.state} ${addr.zip}`
      : 'No address';
    const lat: number | undefined = addr?.lat != null ? Number(addr.lat) : undefined;
    const lng: number | undefined = addr?.lng != null ? Number(addr.lng) : undefined;

    const orderItemsForOrder = orderItems?.filter(item => item.order_id === order.id) || [];

    const legacyGeneratorQty = order.generator_qty || 0;
    const equipmentItems = formatOperationalEquipment(orderItemsForOrder, legacyGeneratorQty);
    const items = equipmentItems.map(e => e.kind === 'inflatable' ? `${e.name} (${e.wetOrDry})` : `${e.name} ×${e.qty}`);
    const equipmentIds = orderItemsForOrder.filter((i: any) => i.unit_id).map((i: any) => i.unit_id);
    const numInflatables = orderItemsForOrder.filter((i: any) => i.unit_id).reduce((s: number, i: any) => s + (i.qty || 1), 0);
    const { totalGeneratorQty } = aggregateOrderEquipment({
      orderItems: orderItemsForOrder,
      legacyGeneratorQty,
      generatorCategoryProductIds,
    });

    const total = order.total_cents || 0;

    const balanceDue = Math.max(0, order.balance_due_cents || 0);

    const eventDateStr = format(eventDate, 'yyyy-MM-dd');
    const dropOffStatus = taskStatuses?.find(
      ts => ts.order_id === order.id && ts.task_type === 'drop-off' && ts.task_date === eventDateStr
    );

    generatedTasks.push({
      id: `${order.id}-dropoff`,
      orderId: order.id,
      type: 'drop-off',
      date: eventDate,
      orderNumber: formatOrderId(order.id),
      customerName,
      customerPhone: customer?.phone || 'No phone',
      customerEmail: customer?.email || '',
      address,
      items,
      rawOrderItems: orderItemsForOrder,
      rawEquipmentItems: equipmentItems,
      equipmentIds,
      numInflatables,
      eventStartTime: order.start_window || 'TBD',
      eventEndTime: order.end_window || 'TBD',
      notes: order.special_details || undefined,
      status: order.status,
      total,
      depositPaidCents: order.deposit_paid_cents || 0,
      balancePaidCents: order.balance_paid_cents || 0,
      tipCents: order.tip_cents || 0,
      waiverSigned: !!order.waiver_signed_at,
      waiverType: deriveWaiverType(
        order.waiver_signed_at,
        (order.order_signatures as any[]) ?? []
      ),
      balanceDue,
      stripePaymentMethodId: order.stripe_payment_method_id || null,
      paymentMethodBrand: order.payment_method_brand || null,
      paymentMethodLastFour: order.payment_method_last_four || null,
      pickupPreference: order.pickup_preference,
      surface: order.surface,
      lat,
      lng,
      generatorQty: totalGeneratorQty,
      hasPets: order.has_pets || false,
      payments: order.payments as any || [],
      taskStatus: dropOffStatus ? projectTaskStatusRow(dropOffStatus) : undefined,
    });

    const pickupDate = order.pickup_preference === 'same_day'
      ? eventDate
      : addDays(eventDate, 1);

    const pickupDateStr = format(pickupDate, 'yyyy-MM-dd');
    const pickUpStatus = taskStatuses?.find(
      ts => ts.order_id === order.id && ts.task_type === 'pick-up' && ts.task_date === pickupDateStr
    );

    const pickupReadiness = derivePickupReadiness(
      order.status,
      dropOffStatus?.status ?? null,
      pickUpStatus?.status ?? null,
      balanceDue
    );

    const pickupBlockReason = derivePickupBlockReason(pickupReadiness, dropOffStatus?.status ?? null, balanceDue, order.status);

    generatedTasks.push({
      id: `${order.id}-pickup`,
      orderId: order.id,
      type: 'pick-up',
      date: pickupDate,
      orderNumber: formatOrderId(order.id),
      customerName,
      customerPhone: customer?.phone || 'No phone',
      customerEmail: customer?.email || '',
      address,
      items,
      rawOrderItems: orderItemsForOrder,
      rawEquipmentItems: equipmentItems,
      equipmentIds,
      numInflatables,
      eventStartTime: order.start_window || 'TBD',
      eventEndTime: order.end_window || 'TBD',
      notes: order.special_details || undefined,
      status: order.status,
      total,
      depositPaidCents: order.deposit_paid_cents || 0,
      balancePaidCents: order.balance_paid_cents || 0,
      tipCents: order.tip_cents || 0,
      waiverSigned: !!order.waiver_signed_at,
      waiverType: deriveWaiverType(
        order.waiver_signed_at,
        (order.order_signatures as any[]) ?? []
      ),
      balanceDue,
      stripePaymentMethodId: order.stripe_payment_method_id || null,
      paymentMethodBrand: order.payment_method_brand || null,
      paymentMethodLastFour: order.payment_method_last_four || null,
      pickupPreference: order.pickup_preference,
      surface: order.surface,
      lat,
      lng,
      generatorQty: totalGeneratorQty,
      hasPets: order.has_pets || false,
      payments: order.payments as any || [],
      taskStatus: pickUpStatus ? projectTaskStatusRow(pickUpStatus) : undefined,
      pickupReadiness,
      pickupBlockReason,
    });
  }

  return generatedTasks;
}
