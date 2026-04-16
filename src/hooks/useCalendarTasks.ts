import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { formatOrderId } from '../lib/utils';
import { format, startOfMonth, endOfMonth, parseISO, addDays } from 'date-fns';

export type PickupReadiness = 'projected' | 'blocked' | 'ready' | 'completed';

export interface Task {
  id: string;
  orderId: string;
  type: 'drop-off' | 'pick-up';
  date: Date;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address: string;
  items: string[];
  equipmentIds: string[];
  numInflatables: number;
  eventStartTime: string;
  eventEndTime: string;
  notes?: string;
  status: string;
  total: number;
  depositPaidCents: number;
  balancePaidCents: number;
  tipCents: number;
  waiverSigned: boolean;
  balanceDue: number;
  pickupPreference?: string;
  surface?: string;
  lat?: number;
  lng?: number;
  stripePaymentMethodId?: string | null;
  paymentMethodBrand?: string | null;
  paymentMethodLastFour?: string | null;
  payments?: Array<{
    id: string;
    amount_cents: number;
    status: string;
    paid_at: string | null;
    type: string;
  }>;
  taskStatus?: {
    id: string;
    status: string;
    sortOrder: number | null;
    completedTime: string | null;
    deliveryImages?: string[];
    damageImages?: string[];
    etaSent: boolean;
  };
  pickupReadiness?: PickupReadiness;
  pickupBlockReason?: string;
}

export function derivePickupReadiness(
  orderStatus: string,
  dropOffTaskStatus: string | null,
  pickUpTaskStatus: string | null,
  balanceDue: number
): PickupReadiness {
  if (pickUpTaskStatus === 'completed') return 'completed';
  // pending_review orders are not yet confirmed — treat pickup as planning-only
  if (orderStatus === 'pending_review') return 'projected';
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
    if (orderStatus === 'pending_review') return 'Order not yet confirmed';
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

export function useCalendarTasks(currentMonth: Date) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  // Always holds the latest currentMonth so realtime callbacks never capture a stale value
  const currentMonthRef = useRef<Date>(currentMonth);
  currentMonthRef.current = currentMonth;

  // Stable debounced callback: created once, reads currentMonthRef at call time
  const debouncedLoadTasksRef = useRef(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      loadTasksForMonth(currentMonthRef.current);
    }, 1000);
  });

  useEffect(() => {
    loadTasksForMonth(currentMonth);
  }, [currentMonth]);

  useEffect(() => {
    const channel = supabase
      .channel('orders-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        debouncedLoadTasksRef.current
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_status',
        },
        debouncedLoadTasksRef.current
      )
      .subscribe();

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadTasksForMonth(month: Date) {
    if (isLoadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isLoadingRef.current = true;
    pendingRefreshRef.current = false;
    setLoading(true);
    try {
      const monthStart = startOfMonth(month);
      const monthEnd = endOfMonth(month);

      // We need to fetch orders that have either:
      // 1. Event date within the month (for drop-offs)
      // 2. Pickup date within the month (event date could be previous month)
      // Since pickup can be event_date or event_date + 1, we need to query from monthStart - 1 day
      const queryStart = addDays(monthStart, -1);

      const { data: orders, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (first_name, last_name, phone, email),
          addresses (line1, city, state, zip, lat, lng),
          payments (id, amount_cents, status, paid_at, type)
        `)
        .gte('event_date', format(queryStart, 'yyyy-MM-dd'))
        .lte('event_date', format(monthEnd, 'yyyy-MM-dd'))
        .in('status', ['confirmed', 'in_progress', 'completed', 'pending_review'])
        .order('event_date', { ascending: true });

      if (error) throw error;

      if (!orders) {
        setTasks([]);
        return;
      }

      const { data: orderItems } = await supabase
        .from('order_items')
        .select('*, units(name)')
        .in('order_id', orders.map(o => o.id));

      // Expand the task_status window to match the order fetch window.
      // Orders starting on monthStart-1 can have next-day pickups on monthStart,
      // and their drop-off task_status has task_date = monthStart-1. Without this
      // expansion, that drop-off status is missed and the pickup is misclassified
      // as 'projected' even when the drop-off is actually completed.
      const { data: taskStatuses } = await supabase
        .from('task_status')
        .select('id, order_id, task_type, task_date, status, sort_order, completed_time, delivery_images, damage_images, eta_sent')
        .gte('task_date', format(queryStart, 'yyyy-MM-dd'))
        .lte('task_date', format(monthEnd, 'yyyy-MM-dd'));

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

        const items = orderItemsForOrder
          .map(item => `${(item.units as any)?.name || 'Unknown'} (${item.wet_or_dry === 'water' ? 'Water' : 'Dry'})`);

        const equipmentIds = orderItemsForOrder
          .map(item => item.unit_id)
          .filter((id): id is string => !!id);

        const numInflatables = orderItemsForOrder
          .reduce((sum, item) => sum + (item.qty || 1), 0);

        const total = (order.balance_due_cents || 0) + (order.deposit_due_cents || 0);

        // Use the DB-stored balance_due_cents (which correctly accounts for deposit,
        // custom fees, discounts, and all pricing) minus any balance already paid.
        // This avoids raw-field math that misses custom fees and uses non-existent columns.
        const balanceDue = Math.max(0, (order.balance_due_cents || 0) - (order.balance_paid_cents || 0));

        const dropOffStatus = taskStatuses?.find(
          ts => ts.order_id === order.id && ts.task_type === 'drop-off'
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
          balanceDue,
          stripePaymentMethodId: order.stripe_payment_method_id || null,
          paymentMethodBrand: order.payment_method_brand || null,
          paymentMethodLastFour: order.payment_method_last_four || null,
          pickupPreference: order.pickup_preference,
          surface: order.surface,
          lat,
          lng,
          payments: order.payments as any || [],
          taskStatus: dropOffStatus ? {
            id: dropOffStatus.id,
            status: dropOffStatus.status,
            sortOrder: dropOffStatus.sort_order,
            completedTime: dropOffStatus.completed_time ?? null,
            deliveryImages: (dropOffStatus.delivery_images as any) || [],
            damageImages: (dropOffStatus.damage_images as any) || [],
            etaSent: dropOffStatus.eta_sent || false,
          } : undefined,
        });

        const pickupDate = order.pickup_preference === 'same_day'
          ? eventDate
          : addDays(eventDate, 1);

        const pickUpStatus = taskStatuses?.find(
          ts => ts.order_id === order.id && ts.task_type === 'pick-up'
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
          balanceDue,
          stripePaymentMethodId: order.stripe_payment_method_id || null,
          paymentMethodBrand: order.payment_method_brand || null,
          paymentMethodLastFour: order.payment_method_last_four || null,
          pickupPreference: order.pickup_preference,
          surface: order.surface,
          lat,
          lng,
          payments: order.payments as any || [],
          taskStatus: pickUpStatus ? {
            id: pickUpStatus.id,
            status: pickUpStatus.status,
            sortOrder: pickUpStatus.sort_order,
            completedTime: pickUpStatus.completed_time ?? null,
            deliveryImages: (pickUpStatus.delivery_images as any) || [],
            damageImages: (pickUpStatus.damage_images as any) || [],
            etaSent: pickUpStatus.eta_sent || false,
          } : undefined,
          pickupReadiness,
          pickupBlockReason,
        });
      }

      setTasks(generatedTasks);
    } catch (error) {
      console.error('Error loading tasks:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        loadTasksForMonth(currentMonthRef.current);
      }
    }
  }

  return { tasks, loading, reload: () => loadTasksForMonth(currentMonthRef.current) };
}
