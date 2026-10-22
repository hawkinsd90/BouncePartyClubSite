import { useState, useEffect, useRef } from 'react';
import { useRefetchOnReturn } from '../core/useRefetchOnReturn';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';
import { format, startOfMonth, endOfMonth, addDays } from 'date-fns';
import { ORDER_STATUS } from '../../lib/constants/statuses';
import { type OperationalEquipmentItem } from '../../lib/tasks/operationalEquipment';
import { loadGeneratorCategoryProductIds } from '../../lib/eventEssentials/customerGeneratorCart';
import { buildCalendarTasks, calendarOrdersSelect, type PickupReadiness } from '../../lib/tasks/calendarTaskAssembly';
import { useAuth } from '../../contexts/AuthContext';
import { shouldRaiseLoading } from '../../lib/core/loadingPolicy';

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
  // The order_items rows loaded for the order (select '*, units(name)').
  rawOrderItems: Array<Database['public']['Tables']['order_items']['Row'] & { units?: { name: string } | null }>;
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
  // False when the signature rows were not loaded (crew): waiverType is then unknown, not "missing".
  waiverTypeKnown?: boolean;
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
  const { isAdmin } = useAuth();
  // Read at load time so realtime callbacks and retries never use a stale role.
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;
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
      // A change made by someone else (or by this screen) refreshes quietly: no spinner, so open modals keep their unsaved work.
      loadTasksForMonth(currentMonthRef.current, { background: true });
    }, 1000);
  });

  // Realtime can miss events (a phone that slept, a table that is not published on this project): reload quietly when the person comes back.
  useRefetchOnReturn(() => { void loadTasksForMonth(currentMonthRef.current, { background: true }); });

  const firstRoleRef = useRef(true);
  useEffect(() => {
    loadTasksForMonth(currentMonth);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads the month; role changes are reloaded by the separate [isAdmin] effect
  }, [currentMonth]);

  // The first load can run before the roles are known: load again, quietly, once the role is resolved.
  useEffect(() => {
    if (firstRoleRef.current) {
      firstRoleRef.current = false;
      return;
    }
    loadTasksForMonth(currentMonthRef.current, { background: true });
    // Only a change of role reloads; the loader itself is re-created on every render and must not be a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

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

  // `background` loads (realtime changes, manual reload, a role resolving) never raise `loading`: the calendar and any open modal
  // stay mounted. Only the first load and a month change show the spinner.
  async function loadTasksForMonth(month: Date, options: { background?: boolean } = {}) {
    const background = !!options.background;
    if (isLoadingRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    isLoadingRef.current = true;
    pendingRefreshRef.current = false;
    if (shouldRaiseLoading({ background, hasData: false })) setLoading(true);
    try {
      const monthStart = startOfMonth(month);
      const monthEnd = endOfMonth(month);

      // We need to fetch orders that have either:
      // 1. Event date within the month (for drop-offs)
      // 2. Pickup date within the month (event date could be previous month)
      // Since pickup can be event_date or event_date + 1, we need to query from monthStart - 1 day
      const queryStart = addDays(monthStart, -1);

      // The select string depends on the role, so the row type is not inferred; the assembly reads rows as loose objects anyway.
      const { data: ordersData, error } = await supabase
        .from('orders')
        .select(calendarOrdersSelect(isAdminRef.current) as '*')
        .gte('event_date', format(queryStart, 'yyyy-MM-dd'))
        .lte('event_date', format(monthEnd, 'yyyy-MM-dd'))
        .in('status', [ORDER_STATUS.CONFIRMED, ORDER_STATUS.IN_PROGRESS, ORDER_STATUS.COMPLETED, ORDER_STATUS.PENDING])
        .order('event_date', { ascending: true });

      if (error) throw error;
      const orders = ordersData as unknown as Array<{ id: string } & Record<string, unknown>> | null;

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
        loadTasksForMonth(currentMonthRef.current, { background: true });
      }
    }
  }

  return { tasks, loading, reload: () => loadTasksForMonth(currentMonthRef.current, { background: true }) };
}
