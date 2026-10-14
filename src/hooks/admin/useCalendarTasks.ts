import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { format, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { ORDER_STATUS } from '../../lib/constants/statuses';
import { type OperationalEquipmentItem } from '../../lib/tasks/operationalEquipment';
import { loadGeneratorCategoryProductIds } from '../../lib/eventEssentials/customerGeneratorCart';
import { buildCalendarTasks, type PickupReadiness } from '../../lib/tasks/calendarTaskAssembly';

export type { PickupReadiness };
export { derivePickupReadiness, derivePickupBlockReason } from '../../lib/tasks/calendarTaskAssembly';

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
  rawOrderItems: any[];
  rawEquipmentItems: OperationalEquipmentItem[];
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
  waiverType?: 'digital' | 'paper_with_photo' | 'paper_no_photo' | null;
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
  generatorQty?: number;
  hasPets?: boolean;
  pickupReadiness?: PickupReadiness;
  pickupBlockReason?: string;
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
          payments (id, amount_cents, status, paid_at, type),
          order_signatures!order_signatures_order_id_fkey (electronic_consent_given, waiver_version, physical_waiver_storage_path, physical_waiver_upload_source)
        `)
        .gte('event_date', format(queryStart, 'yyyy-MM-dd'))
        .lte('event_date', format(monthEnd, 'yyyy-MM-dd'))
        .in('status', [ORDER_STATUS.CONFIRMED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED, ORDER_STATUS.PENDING])
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

      // Load generator category product IDs inside the task load so every
      // refresh (initial, month change, manual, realtime) uses the same
      // authoritative IDs. The helper caches its result, so this does not
      // create a per-order query.
      let generatorCategoryProductIds: Set<string>;
      try {
        generatorCategoryProductIds = await loadGeneratorCategoryProductIds();
      } catch {
        // Fail the task refresh — do NOT publish legacy-only quantities.
        // Previously loaded tasks remain intact.
        throw new Error('Generator category lookup failed; task refresh aborted.');
      }

      const generatedTasks: Task[] = buildCalendarTasks({
        orders,
        orderItems: orderItems ?? null,
        taskStatuses: taskStatuses ?? null,
        generatorCategoryProductIds,
      });

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
