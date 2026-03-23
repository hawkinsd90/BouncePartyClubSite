import { useState, useEffect } from 'react';
import { X, Car, Zap } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';
import { Task } from '../../hooks/useCalendarTasks';
import { loadGoogleMapsAPI } from '../../lib/googleMaps';
import { getHomeBaseAddress } from '../../lib/adminSettingsCache';
import { sortTasksByOrder, isTaskActiveRouteStop } from '../../lib/calendarUtils';

interface MileageModalProps {
  isOpen: boolean;
  date: Date;
  type: 'start' | 'end';
  tasks?: Task[];
  onClose: () => void;
  onSuccess: () => void;
}

export function MileageModal({ isOpen, date, type, tasks = [], onClose, onSuccess }: MileageModalProps) {
  const [mileage, setMileage] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [existingLog, setExistingLog] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadExistingLog();
    }
  }, [isOpen, date]);

  async function loadExistingLog() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const dateStr = date.toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('daily_mileage_logs')
        .select('*')
        .eq('date', dateStr)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setExistingLog(data);
        if (type === 'start' && data.start_mileage) {
          setMileage(data.start_mileage.toString());
        } else if (type === 'end' && data.end_mileage) {
          setMileage(data.end_mileage.toString());
        }
        if (data.notes) setNotes(data.notes);
      }
    } catch (error) {
      console.error('Error loading mileage log:', error);
    }
  }

  async function handleAutoCalculate() {
    if (!existingLog?.start_mileage) {
      showToast('Start of day mileage must be recorded before auto-calculating', 'error');
      return;
    }

    const routeTasks = sortTasksByOrder(tasks.filter(t => isTaskActiveRouteStop(t) || t.taskStatus?.status === 'completed'));
    const taskAddresses = routeTasks
      .filter(t => t.address && t.address.trim())
      .map(t => t.address.trim());

    if (taskAddresses.length === 0) {
      showToast('No task addresses found for today\'s route', 'error');
      return;
    }

    setCalculating(true);
    try {
      await loadGoogleMapsAPI();

      if (!window.google?.maps) {
        throw new Error('Google Maps is not available');
      }

      const homeBase = await getHomeBaseAddress();
      const allAddresses = [homeBase.address, ...taskAddresses, homeBase.address];

      let totalMeters = 0;
      const service = new google.maps.DistanceMatrixService();

      for (let i = 0; i < allAddresses.length - 1; i++) {
        const result = await new Promise<number>((resolve, reject) => {
          service.getDistanceMatrix(
            {
              origins: [allAddresses[i]],
              destinations: [allAddresses[i + 1]],
              travelMode: google.maps.TravelMode.DRIVING,
              unitSystem: google.maps.UnitSystem.IMPERIAL,
            },
            (response, status) => {
              if (status !== 'OK' || !response) {
                reject(new Error(`Distance Matrix error: ${status}`));
                return;
              }
              const element = response.rows[0]?.elements[0];
              if (element?.status !== 'OK') {
                reject(new Error(`Could not calculate distance for segment ${i + 1}`));
                return;
              }
              resolve(element.distance.value);
            }
          );
        });
        totalMeters += result;
      }

      const totalMiles = totalMeters * 0.000621371;
      const calculatedEndMileage = existingLog.start_mileage + totalMiles;
      setMileage(calculatedEndMileage.toFixed(1));
      showToast(`Calculated ${totalMiles.toFixed(1)} miles for today's route (${taskAddresses.length} stops)`, 'success');
    } catch (error: any) {
      console.error('Error calculating mileage:', error);
      showToast(error.message || 'Failed to calculate route mileage', 'error');
    } finally {
      setCalculating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const mileageNum = parseFloat(mileage);
    if (!mileageNum || mileageNum < 0) {
      showToast('Please enter a valid mileage reading', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const dateStr = date.toISOString().split('T')[0];
      const now = new Date().toISOString();

      const updateData: any = {
        date: dateStr,
        user_id: user.id,
        notes,
      };

      if (type === 'start') {
        updateData.start_mileage = mileageNum;
        updateData.start_time = now;
      } else {
        updateData.end_mileage = mileageNum;
        updateData.end_time = now;
      }

      const { error } = await supabase
        .from('daily_mileage_logs')
        .upsert(updateData, {
          onConflict: 'date,user_id',
        });

      if (error) throw error;

      showToast(
        `${type === 'start' ? 'Starting' : 'Ending'} mileage recorded successfully`,
        'success'
      );
      onSuccess();
    } catch (error: any) {
      console.error('Error saving mileage:', error);
      showToast(error.message || 'Failed to save mileage', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  const canAutoCalculate = type === 'end' && !!existingLog?.start_mileage;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <Car className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-slate-900">
              {type === 'start' ? 'Start of Day' : 'End of Day'} Mileage
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-slate-700">
                Odometer Reading <span className="text-red-600">*</span>
              </label>
              {canAutoCalculate && (
                <button
                  type="button"
                  onClick={handleAutoCalculate}
                  disabled={calculating}
                  className="flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {calculating ? 'Calculating...' : 'Auto-Calculate'}
                </button>
              )}
            </div>
            <input
              type="number"
              step="0.1"
              min="0"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="Enter current mileage"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
              autoFocus
            />
            <p className="text-xs text-slate-500 mt-1">
              {type === 'start'
                ? 'Enter your odometer reading before starting your route'
                : 'Enter your odometer reading after completing all tasks'}
            </p>
          </div>

          {canAutoCalculate && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
              <strong>Auto-Calculate</strong> computes mileage from base to each task stop in route order, then back to base. Requires Google Maps.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about the day..."
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {existingLog && type === 'end' && existingLog.start_mileage && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-900">
                <strong>Start mileage:</strong> {existingLog.start_mileage} miles
              </p>
              {mileage && parseFloat(mileage) > existingLog.start_mileage && (
                <p className="text-sm text-blue-900 mt-1">
                  <strong>Distance traveled:</strong>{' '}
                  {(parseFloat(mileage) - existingLog.start_mileage).toFixed(1)} miles
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-medium rounded-lg transition-colors"
            >
              {submitting ? 'Saving...' : 'Save Mileage'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
