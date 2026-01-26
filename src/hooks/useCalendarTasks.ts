import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatOrderId } from '../lib/utils';
import { format, startOfMonth, endOfMonth, parseISO, addDays } from 'date-fns';

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
  waiverSigned: boolean;
  balanceDue: number;
  pickupPreference?: string;
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
    sortOrder: number;
    deliveryImages?: string[];
    damageImages?: string[];
    etaSent: boolean;
  };
}

export function useCalendarTasks(currentMonth: Date) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTasks();

    const channel = supabase
      .channel('orders-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
        },
        () => {
          loadTasks();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_status',
        },
        () => {
          loadTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentMonth]);

  async function loadTasks() {
    setLoading(true);
    try {
      const monthStart = startOfMonth(currentMonth);
      const monthEnd = endOfMonth(currentMonth);

      const { data: orders, error } = await supabase
        .from('orders')
        .select(`
          *,
          customers (first_name, last_name, phone, email),
          addresses (line1, city, state, zip),
          payments (id, amount_cents, status, paid_at, type)
        `)
        .gte('event_date', format(monthStart, 'yyyy-MM-dd'))
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

      const { data: taskStatuses } = await supabase
        .from('task_status')
        .select('*')
        .gte('task_date', format(monthStart, 'yyyy-MM-dd'))
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

        const orderItemsForOrder = orderItems?.filter(item => item.order_id === order.id) || [];

        const items = orderItemsForOrder
          .map(item => `${(item.units as any)?.name || 'Unknown'} (${item.wet_or_dry === 'water' ? 'Water' : 'Dry'})`);

        const equipmentIds = orderItemsForOrder
          .map(item => item.unit_id)
          .filter((id): id is string => !!id);

        const numInflatables = orderItemsForOrder
          .reduce((sum, item) => sum + (item.qty || 1), 0);

        const total = order.subtotal_cents +
                     (order.generator_fee_cents || 0) +
                     order.travel_fee_cents +
                     order.surface_fee_cents +
                     (order.same_day_pickup_fee_cents || 0) +
                     order.tax_cents;

        const balanceDue = (order.deposit_due_cents || 0) + (order.balance_due_cents || 0) -
                          ((order.deposit_paid_cents || 0) + (order.balance_paid_cents || 0));

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
          waiverSigned: !!order.waiver_signed_at,
          balanceDue,
          pickupPreference: order.pickup_preference,
          payments: order.payments as any || [],
          taskStatus: dropOffStatus ? {
            id: dropOffStatus.id,
            status: dropOffStatus.status,
            sortOrder: dropOffStatus.sort_order || 0,
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
          waiverSigned: !!order.waiver_signed_at,
          balanceDue,
          pickupPreference: order.pickup_preference,
          payments: order.payments as any || [],
          taskStatus: pickUpStatus ? {
            id: pickUpStatus.id,
            status: pickUpStatus.status,
            sortOrder: pickUpStatus.sort_order || 0,
            deliveryImages: (pickUpStatus.delivery_images as any) || [],
            damageImages: (pickUpStatus.damage_images as any) || [],
            etaSent: pickUpStatus.eta_sent || false,
          } : undefined,
        });
      }

      setTasks(generatedTasks);
    } catch (error) {
      console.error('Error loading tasks:', error);
    } finally {
      setLoading(false);
    }
  }

  return { tasks, loading, reload: loadTasks };
}
