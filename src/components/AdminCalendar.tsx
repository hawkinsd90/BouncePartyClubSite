import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronLeft, ChevronRight, Package, TruckIcon, X, MapPin, Clock, User, Phone, MousePointer, Route } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO, addDays } from 'date-fns';
import { formatCurrency } from '../lib/pricing';
import { TaskDetailModal } from './TaskDetailModal';
import { optimizeMorningRoute, type MorningRouteStop } from '../lib/routeOptimization';

interface Task {
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
  taskStatus?: {
    id: string;
    status: string;
    sortOrder: number;
    deliveryImages?: string[];
    damageImages?: string[];
    etaSent: boolean;
  };
}

export function AdminCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [optimizing, setOptimizing] = useState(false);

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
          addresses (line1, city, state, zip)
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
        const customerName = order.customers
          ? `${order.customers.first_name} ${order.customers.last_name}`
          : 'Unknown Customer';

        const address = order.addresses
          ? `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state} ${order.addresses.zip}`
          : 'No address';

        const orderItemsForOrder = orderItems?.filter(item => item.order_id === order.id) || [];

        const items = orderItemsForOrder
          .map(item => `${item.units?.name || 'Unknown'} (${item.wet_or_dry === 'water' ? 'Water' : 'Dry'})`);

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
          orderNumber: order.id.slice(0, 8).toUpperCase(),
          customerName,
          customerPhone: order.customers?.phone || 'No phone',
          customerEmail: order.customers?.email || '',
          address,
          items,
          equipmentIds,
          numInflatables,
          eventStartTime: order.start_window || 'TBD',
          eventEndTime: order.end_window || 'TBD',
          notes: order.special_details,
          status: order.status,
          total,
          waiverSigned: !!order.waiver_signed_at,
          balanceDue,
          pickupPreference: order.pickup_preference,
          taskStatus: dropOffStatus ? {
            id: dropOffStatus.id,
            status: dropOffStatus.status,
            sortOrder: dropOffStatus.sort_order || 0,
            deliveryImages: dropOffStatus.delivery_images || [],
            damageImages: dropOffStatus.damage_images || [],
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
          orderNumber: order.id.slice(0, 8).toUpperCase(),
          customerName,
          customerPhone: order.customers?.phone || 'No phone',
          customerEmail: order.customers?.email || '',
          address,
          items,
          equipmentIds,
          numInflatables,
          eventStartTime: order.start_window || 'TBD',
          eventEndTime: order.end_window || 'TBD',
          notes: order.special_details,
          status: order.status,
          total,
          waiverSigned: !!order.waiver_signed_at,
          balanceDue,
          pickupPreference: order.pickup_preference,
          taskStatus: pickUpStatus ? {
            id: pickUpStatus.id,
            status: pickUpStatus.status,
            sortOrder: pickUpStatus.sort_order || 0,
            deliveryImages: pickUpStatus.delivery_images || [],
            damageImages: pickUpStatus.damage_images || [],
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

  function getTasksForDate(date: Date): Task[] {
    return tasks.filter(task => isSameDay(task.date, date));
  }

  async function optimizeMorningRouteForDay() {
    if (!selectedDate) return;

    setOptimizing(true);
    try {
      const selectedDayTasks = getTasksForDate(selectedDate);

      const dropOffTasks = selectedDayTasks.filter(t => t.type === 'drop-off');

      const morningPickUpTasks = selectedDayTasks.filter(t => {
        return t.type === 'pick-up' && t.pickupPreference === 'next_day';
      });

      const morningTasks = [...morningPickUpTasks, ...dropOffTasks];

      if (morningTasks.length < 2) {
        alert('Need at least 2 stops to optimize the morning route');
        return;
      }

      for (const task of morningTasks) {
        if (!task.taskStatus) {
          const { data, error } = await supabase
            .from('task_status')
            .insert({
              order_id: task.orderId,
              task_type: task.type,
              status: 'pending',
              sort_order: 0,
              task_date: format(selectedDate, 'yyyy-MM-dd'),
            })
            .select()
            .single();

          if (error) {
            console.error('Error creating task status:', error);
          } else if (data) {
            task.taskStatus = {
              id: data.id,
              status: data.status,
              sortOrder: data.sort_order || 0,
              deliveryImages: [],
              damageImages: [],
              etaSent: false,
            };
          }
        }
      }

      const morningRouteStops: MorningRouteStop[] = morningTasks.map(task => ({
        id: task.taskStatus?.id || '',
        taskId: task.id,
        orderId: task.orderId,
        address: task.address,
        type: task.type,
        eventStartTime: task.eventStartTime,
        equipmentIds: task.equipmentIds,
        numInflatables: task.numInflatables,
      }));

      const optimizedStops = await optimizeMorningRoute(morningRouteStops);

      let lateStops = 0;
      for (const stop of optimizedStops) {
        if (stop.id) {
          const { error } = await supabase
            .from('task_status')
            .update({ sort_order: stop.sortOrder })
            .eq('id', stop.id);

          if (error) {
            console.error('Error updating sort order:', error);
          }

          if (stop.estimatedLateness && stop.estimatedLateness > 0) {
            lateStops++;
          }
        }
      }

      await loadTasks();

      const pickupCount = optimizedStops.filter(s => s.type === 'pick-up').length;
      const dropOffCount = optimizedStops.filter(s => s.type === 'drop-off').length;

      let message = `Morning route optimized! ${optimizedStops.length} stops:\n`;
      message += `- ${pickupCount} pickup(s)\n`;
      message += `- ${dropOffCount} drop-off(s)\n`;
      message += `\nDeparture: 6:30 AM from home base.`;

      if (lateStops > 0) {
        message += `\n\nWarning: ${lateStops} stop(s) may be late even with optimal routing.`;
      }

      alert(message);
    } catch (error) {
      console.error('Error optimizing morning route:', error);
      alert(`Failed to optimize route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setOptimizing(false);
    }
  }

  function handleDateClick(date: Date) {
    setSelectedDate(date);
    setShowDayModal(true);
  }

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const startDayOfWeek = monthStart.getDay();
  const emptyDays = Array(startDayOfWeek).fill(null);

  const selectedDayTasks = selectedDate ? getTasksForDate(selectedDate) : [];
  const dropOffTasks = selectedDayTasks.filter(t => t.type === 'drop-off');
  const pickUpTasks = selectedDayTasks.filter(t => t.type === 'pick-up');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Event Calendar</h2>
        <div className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-base sm:text-lg font-semibold text-slate-900 min-w-[160px] sm:min-w-[200px] text-center">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="ml-2 sm:ml-4 px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm sm:text-base"
          >
            Today
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-100 border-b border-slate-200">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="py-3 px-2 text-center font-semibold text-slate-700 text-sm">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {emptyDays.map((_, index) => (
            <div key={`empty-${index}`} className="aspect-square border border-slate-100 bg-slate-50" />
          ))}

          {calendarDays.map(day => {
            const dayTasks = getTasksForDate(day);
            const isToday = isSameDay(day, new Date());
            const dropOffs = dayTasks.filter(t => t.type === 'drop-off').length;
            const pickUps = dayTasks.filter(t => t.type === 'pick-up').length;

            return (
              <div
                key={day.toISOString()}
                onClick={() => dayTasks.length > 0 && handleDateClick(day)}
                className={`aspect-square border border-slate-100 p-2 ${
                  dayTasks.length > 0 ? 'cursor-pointer hover:bg-blue-50' : ''
                } ${isToday ? 'bg-blue-50' : 'bg-white'} transition-colors relative`}
              >
                <div className={`text-sm font-semibold mb-1 ${
                  isToday ? 'text-blue-600' : 'text-slate-700'
                }`}>
                  {format(day, 'd')}
                </div>

                {dayTasks.length > 0 && (
                  <div className="space-y-1">
                    {dropOffs > 0 && (
                      <div className="flex items-center gap-1 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                        <TruckIcon className="w-3 h-3" />
                        <span className="font-semibold">{dropOffs}</span>
                      </div>
                    )}
                    {pickUps > 0 && (
                      <div className="flex items-center gap-1 text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                        <Package className="w-3 h-3" />
                        <span className="font-semibold">{pickUps}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-50 rounded-lg p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 border-2 border-green-500 rounded"></div>
          <span className="text-slate-700">Drop-off / Delivery</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-orange-100 border-2 border-orange-500 rounded"></div>
          <span className="text-slate-700">Pick-up / Retrieval</span>
        </div>
      </div>

      {showDayModal && selectedDate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center z-10">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">
                  {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  {selectedDayTasks.length} task{selectedDayTasks.length !== 1 ? 's' : ''} scheduled
                </p>
              </div>
              <button
                onClick={() => setShowDayModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-4">
                <p className="text-sm text-blue-900 flex items-center gap-2">
                  <MousePointer className="w-4 h-4" />
                  Click on any task below to view details and take action
                </p>
              </div>

              {dropOffTasks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base sm:text-lg font-bold text-green-900 flex items-center gap-2">
                      <TruckIcon className="w-5 h-5" />
                      Drop-offs / Deliveries ({dropOffTasks.length})
                    </h3>
                    {dropOffTasks.length >= 1 && (
                      <button
                        onClick={() => optimizeMorningRouteForDay()}
                        disabled={optimizing}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Route className="w-4 h-4" />
                        {optimizing ? 'Optimizing...' : 'Optimize Morning Route'}
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {dropOffTasks
                      .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0))
                      .map((task, idx) => (
                      <div
                        key={task.id}
                        onClick={() => {
                          setSelectedTask(task);
                          setShowDayModal(false);
                        }}
                        className="bg-green-50 border-2 border-green-200 rounded-lg p-3 sm:p-4 cursor-pointer hover:bg-green-100 transition-colors relative">
                        <div className="absolute top-2 right-2 bg-green-700 text-white text-xs font-bold px-2 py-1 rounded">
                          Stop #{idx + 1}
                        </div>
                        <div className="flex justify-between items-start mb-3 pr-16">
                          <div>
                            <h4 className="font-bold text-slate-900 text-base sm:text-lg">
                              Order #{task.orderNumber}
                            </h4>
                            <div className="flex gap-2 mt-1 flex-wrap">
                              <span className={`inline-block text-xs px-2 py-1 rounded-full ${
                                task.taskStatus?.status === 'completed' ? 'bg-green-600 text-white' :
                                task.taskStatus?.status === 'arrived' ? 'bg-yellow-600 text-white' :
                                task.taskStatus?.status === 'en_route' ? 'bg-blue-600 text-white' :
                                'bg-slate-200 text-slate-700'
                              }`}>
                                {task.taskStatus?.status?.toUpperCase() || 'PENDING'}
                              </span>
                              {!task.waiverSigned && (
                                <span className="inline-block text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                                  NO WAIVER
                                </span>
                              )}
                              {task.balanceDue > 0 && (
                                <span className="inline-block text-xs px-2 py-1 rounded-full bg-red-100 text-red-800">
                                  ${(task.balanceDue / 100).toFixed(0)} DUE
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <User className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <div className="font-semibold text-slate-900">{task.customerName}</div>
                                <div className="text-slate-600 text-xs">{task.customerPhone}</div>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700 text-xs">{task.address}</div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Clock className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700 text-xs">
                                <div>Event: {task.eventStartTime} - {task.eventEndTime}</div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-slate-700 mb-2">Equipment:</div>
                            <ul className="text-xs text-slate-700 space-y-1">
                              {task.items.slice(0, 3).map((item, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="text-green-600">•</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        {task.notes && (
                          <div className="mt-3 pt-3 border-t border-green-300">
                            <div className="text-xs font-semibold text-slate-700 mb-1">Notes:</div>
                            <div className="text-sm text-slate-700 whitespace-pre-wrap">{task.notes}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pickUpTasks.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base sm:text-lg font-bold text-orange-900 flex items-center gap-2">
                      <Package className="w-5 h-5" />
                      Pick-ups / Retrievals ({pickUpTasks.length})
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {pickUpTasks
                      .sort((a, b) => (a.taskStatus?.sortOrder || 0) - (b.taskStatus?.sortOrder || 0))
                      .map((task, idx) => (
                      <div
                        key={task.id}
                        onClick={() => {
                          setSelectedTask(task);
                          setShowDayModal(false);
                        }}
                        className="bg-orange-50 border-2 border-orange-200 rounded-lg p-3 sm:p-4 cursor-pointer hover:bg-orange-100 transition-colors relative">
                        <div className="absolute top-2 right-2 bg-orange-700 text-white text-xs font-bold px-2 py-1 rounded">
                          Stop #{idx + 1}
                        </div>
                        <div className="flex justify-between items-start mb-3 pr-16">
                          <div>
                            <h4 className="font-bold text-slate-900 text-base sm:text-lg">
                              Order #{task.orderNumber}
                            </h4>
                            <div className="flex gap-2 mt-1 flex-wrap">
                              <span className={`inline-block text-xs px-2 py-1 rounded-full ${
                                task.taskStatus?.status === 'completed' ? 'bg-green-600 text-white' :
                                task.taskStatus?.status === 'arrived' ? 'bg-yellow-600 text-white' :
                                task.taskStatus?.status === 'en_route' ? 'bg-blue-600 text-white' :
                                'bg-slate-200 text-slate-700'
                              }`}>
                                {task.taskStatus?.status?.toUpperCase() || 'PENDING'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <User className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <div className="font-semibold text-slate-900">{task.customerName}</div>
                                <div className="text-slate-600 text-xs">{task.customerPhone}</div>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <MapPin className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700 text-xs">{task.address}</div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Clock className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700 text-xs">
                                <div>Event: {task.eventStartTime} - {task.eventEndTime}</div>
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-slate-700 mb-2">Equipment:</div>
                            <ul className="text-xs text-slate-700 space-y-1">
                              {task.items.slice(0, 3).map((item, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="text-orange-600">•</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        {task.notes && (
                          <div className="mt-3 pt-3 border-t border-orange-300">
                            <div className="text-xs font-semibold text-slate-700 mb-1">Notes:</div>
                            <div className="text-xs text-slate-700 whitespace-pre-wrap line-clamp-2">{task.notes}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedDayTasks.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  No tasks scheduled for this day
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-slate-600">Loading calendar...</p>
        </div>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          allTasks={getTasksForDate(selectedTask.date)}
          onClose={() => setSelectedTask(null)}
          onUpdate={() => {
            setSelectedTask(null);
            loadTasks();
          }}
        />
      )}
    </div>
  );
}
