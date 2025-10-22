import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import {
  MapPin,
  Clock,
  CheckCircle,
  Camera,
  Navigation,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';

export function Crew() {
  const [stops, setStops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStop, setSelectedStop] = useState<any>(null);

  useEffect(() => {
    loadTodaysStops();
  }, []);

  async function loadTodaysStops() {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('route_stops')
        .select(`
          *,
          orders (
            *,
            customers (first_name, last_name, phone),
            addresses (line1, line2, city, state, zip),
            order_items (
              *,
              units (name)
            )
          )
        `)
        .eq('orders.event_date', today)
        .order('created_at');

      if (error) throw error;
      setStops(data || []);
    } catch (error) {
      console.error('Error loading stops:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateCheckpoint(
    stopId: string,
    checkpoint: string,
    type: 'dropoff' | 'pickup'
  ) {
    try {
      const now = new Date().toISOString();

      await supabase
        .from('route_stops')
        .update({
          checkpoint,
          checkpoint_time: now,
          gps_lat: 0,
          gps_lng: 0,
        })
        .eq('id', stopId);

      const stop = stops.find((s) => s.id === stopId);
      if (!stop || !stop.orders) return;

      const customer = stop.orders.customers;
      let templateKey = '';

      if (checkpoint === 'start_day') {
        templateKey = 'eta_sms';
      } else if (checkpoint === 'arrived') {
        templateKey = 'arrived_sms';
      } else if (checkpoint === 'leave_dropoff') {
        templateKey = 'dropoff_done_sms';
      } else if (checkpoint === 'leave_pickup') {
        templateKey = 'pickup_thanks_sms';
      }

      if (templateKey) {
        await supabase.from('messages').insert({
          order_id: stop.order_id,
          to_phone: customer.phone,
          channel: 'sms',
          template_key: templateKey,
          payload_json: {
            name: `${customer.first_name} ${customer.last_name}`,
            eta: 'Arriving soon',
          },
          status: 'pending',
        });
      }

      await loadTodaysStops();
      setSelectedStop(null);
      alert(`Checkpoint "${checkpoint}" updated successfully!`);
    } catch (error) {
      console.error('Error updating checkpoint:', error);
      alert('Error updating checkpoint');
    }
  }

  const handlePhotoCapture = () => {
    alert(
      'Photo capture would activate camera here. In production, this would use the device camera API or file input.'
    );
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-slate-600">Loading today's route...</p>
        </div>
      </div>
    );
  }

  if (stops.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-4xl font-bold text-slate-900 mb-8">Crew Dashboard</h1>
        <div className="bg-white rounded-xl shadow-md p-8 text-center">
          <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            No Stops Scheduled Today
          </h2>
          <p className="text-slate-600">
            There are no deliveries or pickups scheduled for today.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-slate-900 mb-8">Today's Route</h1>

      <div className="space-y-4">
        {stops.map((stop) => {
          const order = stop.orders;
          if (!order) return null;

          const customer = order.customers;
          const address = order.addresses;
          const isCompleted =
            (stop.type === 'dropoff' && stop.checkpoint === 'leave_dropoff') ||
            (stop.type === 'pickup' && stop.checkpoint === 'leave_pickup');

          return (
            <div
              key={stop.id}
              className={`bg-white rounded-xl shadow-md overflow-hidden ${
                isCompleted ? 'opacity-60' : ''
              }`}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center mb-2">
                      <MapPin className="w-5 h-5 text-blue-600 mr-2" />
                      <h3 className="text-xl font-bold text-slate-900 capitalize">
                        {stop.type}
                      </h3>
                      {isCompleted && (
                        <CheckCircle className="w-5 h-5 text-green-600 ml-2" />
                      )}
                    </div>
                    <p className="text-slate-600 mb-1">
                      {customer?.first_name} {customer?.last_name}
                    </p>
                    <p className="text-sm text-slate-600">
                      {address?.line1}
                      {address?.line2 && `, ${address.line2}`}
                      <br />
                      {address?.city}, {address?.state} {address?.zip}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-600">Order ID</p>
                    <p className="font-mono font-semibold text-slate-900">
                      {order.id.slice(0, 8).toUpperCase()}
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-600">Event Time:</span>
                      <p className="font-semibold text-slate-900">
                        {order.start_window} - {order.end_window}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-600">Contact:</span>
                      <p className="font-semibold text-slate-900">{customer?.phone}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-600">Units:</span>
                      <p className="font-semibold text-slate-900">
                        {order.order_items?.map((item: any) => item.units.name).join(', ')}
                      </p>
                    </div>
                  </div>
                </div>

                {order.special_details && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <p className="text-sm font-semibold text-slate-700 mb-2">Special Details</p>
                    <p className="text-sm text-slate-900 whitespace-pre-wrap">{order.special_details}</p>
                  </div>
                )}

                <div className="flex items-center mb-4 text-sm">
                  <Clock className="w-4 h-4 text-slate-400 mr-2" />
                  <span className="text-slate-600">
                    Status:{' '}
                    <span className="font-semibold text-slate-900 capitalize">
                      {stop.checkpoint === 'none'
                        ? 'Pending'
                        : stop.checkpoint.replace('_', ' ')}
                    </span>
                  </span>
                </div>

                {!isCompleted && (
                  <div className="space-y-3">
                    <button
                      onClick={() => setSelectedStop(stop)}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
                    >
                      Manage Checkpoints
                    </button>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={handlePhotoCapture}
                        className="flex items-center justify-center bg-white border border-slate-300 hover:border-blue-600 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        Photos
                      </button>
                      <button
                        onClick={() =>
                          window.open(
                            `https://maps.google.com/?q=${address?.line1},${address?.city},${address?.state}`,
                            '_blank'
                          )
                        }
                        className="flex items-center justify-center bg-white border border-slate-300 hover:border-blue-600 text-slate-700 font-semibold py-2 px-4 rounded-lg transition-colors"
                      >
                        <Navigation className="w-4 h-4 mr-2" />
                        Navigate
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedStop && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-2xl font-bold text-slate-900 mb-4">
              Update Checkpoint
            </h3>
            <p className="text-slate-600 mb-6">
              Select the current checkpoint status for this {selectedStop.type}:
            </p>

            <div className="space-y-3 mb-6">
              {selectedStop.type === 'dropoff' ? (
                <>
                  <button
                    onClick={() =>
                      updateCheckpoint(selectedStop.id, 'start_day', selectedStop.type)
                    }
                    disabled={selectedStop.checkpoint !== 'none'}
                    className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-900 font-semibold py-3 px-4 rounded-lg transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span>Start Day</span>
                      {selectedStop.checkpoint === 'start_day' && (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Sends ETA to first customers
                    </p>
                  </button>
                  <button
                    onClick={() =>
                      updateCheckpoint(selectedStop.id, 'arrived', selectedStop.type)
                    }
                    disabled={
                      selectedStop.checkpoint === 'leave_dropoff' ||
                      selectedStop.checkpoint === 'leave_pickup'
                    }
                    className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-900 font-semibold py-3 px-4 rounded-lg transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span>Arrived</span>
                      {selectedStop.checkpoint === 'arrived' && (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      Sends arrival SMS + waiver/payment links
                    </p>
                  </button>
                  <button
                    onClick={() =>
                      updateCheckpoint(selectedStop.id, 'leave_dropoff', selectedStop.type)
                    }
                    disabled={selectedStop.checkpoint === 'leave_dropoff'}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-50 disabled:text-slate-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span>Leave (Drop-Off Complete)</span>
                      {selectedStop.checkpoint === 'leave_dropoff' && (
                        <CheckCircle className="w-5 h-5" />
                      )}
                    </div>
                    <p className="text-xs opacity-90 mt-1">
                      Sends have-fun message + on-our-way to next
                    </p>
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() =>
                      updateCheckpoint(selectedStop.id, 'arrived', selectedStop.type)
                    }
                    disabled={selectedStop.checkpoint === 'leave_pickup'}
                    className="w-full bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-slate-900 font-semibold py-3 px-4 rounded-lg transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span>Arrived for Pickup</span>
                      {selectedStop.checkpoint === 'arrived' && (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() =>
                      updateCheckpoint(selectedStop.id, 'leave_pickup', selectedStop.type)
                    }
                    disabled={selectedStop.checkpoint === 'leave_pickup'}
                    className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-50 disabled:text-slate-400 text-white font-semibold py-3 px-4 rounded-lg transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span>Leave (Pickup Complete)</span>
                      {selectedStop.checkpoint === 'leave_pickup' && (
                        <CheckCircle className="w-5 h-5" />
                      )}
                    </div>
                    <p className="text-xs opacity-90 mt-1">
                      Sends thank-you + review request
                    </p>
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => setSelectedStop(null)}
              className="w-full bg-white border border-slate-300 text-slate-700 font-semibold py-2 px-4 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
