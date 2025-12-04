import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ChevronLeft, ChevronRight, Package, TruckIcon, X, MapPin, Clock, User, Phone } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, parseISO, addDays } from 'date-fns';
import { formatCurrency } from '../lib/pricing';

interface Task {
  id: string;
  orderId: string;
  type: 'drop-off' | 'pick-up';
  date: Date;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  items: string[];
  timeWindow: string;
  notes?: string;
  status: string;
  total: number;
}

export function AdminCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);

  useEffect(() => {
    loadTasks();
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
          customers (first_name, last_name, phone),
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

      const generatedTasks: Task[] = [];

      for (const order of orders) {
        const eventDate = parseISO(order.event_date);
        const customerName = order.customers
          ? `${order.customers.first_name} ${order.customers.last_name}`
          : 'Unknown Customer';

        const address = order.addresses
          ? `${order.addresses.line1}, ${order.addresses.city}, ${order.addresses.state} ${order.addresses.zip}`
          : 'No address';

        const items = orderItems
          ?.filter(item => item.order_id === order.id)
          .map(item => `${item.units?.name || 'Unknown'} (${item.wet_or_dry === 'water' ? 'Water' : 'Dry'})`) || [];

        const total = order.subtotal_cents +
                     (order.generator_fee_cents || 0) +
                     order.travel_fee_cents +
                     order.surface_fee_cents +
                     (order.same_day_pickup_fee_cents || 0) +
                     order.tax_cents;

        generatedTasks.push({
          id: `${order.id}-dropoff`,
          orderId: order.id,
          type: 'drop-off',
          date: eventDate,
          orderNumber: order.id.slice(0, 8).toUpperCase(),
          customerName,
          customerPhone: order.customers?.phone || 'No phone',
          address,
          items,
          timeWindow: order.start_window || 'TBD',
          notes: order.special_details,
          status: order.status,
          total,
        });

        const pickupDate = order.pickup_preference === 'same_day'
          ? eventDate
          : addDays(eventDate, 1);

        generatedTasks.push({
          id: `${order.id}-pickup`,
          orderId: order.id,
          type: 'pick-up',
          date: pickupDate,
          orderNumber: order.id.slice(0, 8).toUpperCase(),
          customerName,
          customerPhone: order.customers?.phone || 'No phone',
          address,
          items,
          timeWindow: order.pickup_preference === 'same_day' ? order.end_window || 'After event' : 'Morning',
          notes: order.special_details,
          status: order.status,
          total,
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
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Event Calendar</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-lg font-semibold text-slate-900 min-w-[200px] text-center">
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
            className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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

      <div className="bg-slate-50 rounded-lg p-4 flex items-center justify-center gap-8">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 border-2 border-green-500 rounded"></div>
          <span className="text-sm text-slate-700">Drop-off / Delivery</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-orange-100 border-2 border-orange-500 rounded"></div>
          <span className="text-sm text-slate-700">Pick-up / Retrieval</span>
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

            <div className="p-6 space-y-6">
              {dropOffTasks.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-green-900 mb-4 flex items-center gap-2">
                    <TruckIcon className="w-5 h-5" />
                    Drop-offs / Deliveries ({dropOffTasks.length})
                  </h3>
                  <div className="space-y-3">
                    {dropOffTasks.map(task => (
                      <div key={task.id} className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-bold text-slate-900 text-lg">
                              Order #{task.orderNumber}
                            </h4>
                            <span className={`inline-block text-xs px-2 py-1 rounded-full mt-1 ${
                              task.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                              task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                              task.status === 'completed' ? 'bg-green-100 text-green-800' :
                              'bg-slate-100 text-slate-800'
                            }`}>
                              {task.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-green-900">
                              {formatCurrency(task.total)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <div className="flex items-start gap-2 text-sm mb-2">
                              <User className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <div className="font-semibold text-slate-900">{task.customerName}</div>
                                <div className="text-slate-600">{task.customerPhone}</div>
                              </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm mb-2">
                              <MapPin className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700">{task.address}</div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                              <Clock className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700">Delivery: {task.timeWindow}</div>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-slate-700 mb-2">Equipment:</div>
                            <ul className="text-sm text-slate-700 space-y-1">
                              {task.items.map((item, idx) => (
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
                  <h3 className="text-lg font-bold text-orange-900 mb-4 flex items-center gap-2">
                    <Package className="w-5 h-5" />
                    Pick-ups / Retrievals ({pickUpTasks.length})
                  </h3>
                  <div className="space-y-3">
                    {pickUpTasks.map(task => (
                      <div key={task.id} className="bg-orange-50 border-2 border-orange-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <h4 className="font-bold text-slate-900 text-lg">
                              Order #{task.orderNumber}
                            </h4>
                            <span className={`inline-block text-xs px-2 py-1 rounded-full mt-1 ${
                              task.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                              task.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                              task.status === 'completed' ? 'bg-green-100 text-green-800' :
                              'bg-slate-100 text-slate-800'
                            }`}>
                              {task.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-orange-900">
                              {formatCurrency(task.total)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <div className="flex items-start gap-2 text-sm mb-2">
                              <User className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <div className="font-semibold text-slate-900">{task.customerName}</div>
                                <div className="text-slate-600">{task.customerPhone}</div>
                              </div>
                            </div>
                            <div className="flex items-start gap-2 text-sm mb-2">
                              <MapPin className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700">{task.address}</div>
                            </div>
                            <div className="flex items-start gap-2 text-sm">
                              <Clock className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
                              <div className="text-slate-700">Pick-up: {task.timeWindow}</div>
                            </div>
                          </div>

                          <div>
                            <div className="text-xs font-semibold text-slate-700 mb-2">Equipment:</div>
                            <ul className="text-sm text-slate-700 space-y-1">
                              {task.items.map((item, idx) => (
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
                            <div className="text-sm text-slate-700 whitespace-pre-wrap">{task.notes}</div>
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
    </div>
  );
}
