import { useState, useEffect } from 'react';
import { X, Package, ShieldAlert, Check, AlertTriangle, Sun, Droplets, Layers } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { AdminPhoto } from '../../../hooks/useAdminPhotos';

interface Unit {
  id: string;
  name: string;
  is_combo: boolean;
}

type TargetMode = 'dry' | 'water' | 'both';

interface PromoteToUnitModalProps {
  photo: AdminPhoto;
  onClose: () => void;
  onSuccess: () => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const MODE_OPTIONS: { value: TargetMode; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: 'dry',
    label: 'Dry Side',
    icon: <Sun className="w-4 h-4" />,
    description: 'Appears in dry mode gallery only',
  },
  {
    value: 'water',
    label: 'Wet Side',
    icon: <Droplets className="w-4 h-4" />,
    description: 'Appears in wet mode gallery only',
  },
  {
    value: 'both',
    label: 'Both',
    icon: <Layers className="w-4 h-4" />,
    description: 'Appears in both dry and wet galleries',
  },
];

export function PromoteToUnitModal({ photo, onClose, onSuccess }: PromoteToUnitModalProps) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [orderUnits, setOrderUnits] = useState<Unit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>('dry');
  const [consentChecked, setConsentChecked] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isDelivery = photo.source === 'delivery';

  useEffect(() => {
    async function loadUnits() {
      setLoadingUnits(true);
      try {
        const [allUnitsRes, orderItemsRes] = await Promise.all([
          supabase
            .from('units')
            .select('id, name, is_combo')
            .eq('active', true)
            .order('name'),
          photo.order_id
            ? supabase
                .from('order_items')
                .select('unit_id, units(id, name, is_combo)')
                .eq('order_id', photo.order_id)
            : Promise.resolve({ data: [], error: null }),
        ]);

        const all: Unit[] = (allUnitsRes.data ?? []).map((u: { id: string; name: string; is_combo: boolean }) => ({
          id: u.id,
          name: u.name,
          is_combo: u.is_combo ?? false,
        }));

        // Extract units from this order
        const fromOrder: Unit[] = [];
        const fromOrderIds = new Set<string>();
        for (const item of (orderItemsRes.data ?? []) as Array<{ unit_id: string; units: { id: string; name: string; is_combo: boolean } | null }>) {
          const u = item.units;
          if (u && !fromOrderIds.has(u.id)) {
            fromOrder.push({ id: u.id, name: u.name, is_combo: u.is_combo ?? false });
            fromOrderIds.add(u.id);
          }
        }

        setOrderUnits(fromOrder);
        setUnits(all);

        // Pre-select: prefer the single order unit if only one
        if (fromOrder.length === 1) {
          setSelectedUnitId(fromOrder[0].id);
          setSelectedUnit(fromOrder[0]);
        }
      } finally {
        setLoadingUnits(false);
      }
    }
    loadUnits();
  }, [photo.order_id]);

  // When selected unit changes, update selectedUnit object and reset mode to 'dry'
  function handleUnitChange(unitId: string) {
    setSelectedUnitId(unitId);
    if (!unitId) {
      setSelectedUnit(null);
      setTargetMode('dry');
      return;
    }
    const allUnits = [...orderUnits, ...units];
    const found = allUnits.find(u => u.id === unitId) ?? null;
    setSelectedUnit(found);
    setTargetMode('dry');
  }

  const isCombo = selectedUnit?.is_combo ?? false;

  async function handlePromote() {
    if (!selectedUnitId || !consentChecked || promoting) return;
    setPromoting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/promote-media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          Apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          source_type: photo.source,
          source_id: photo.id,
          action: 'unit',
          target_unit_id: selectedUnitId,
          target_mode: isCombo ? targetMode : 'dry',
          consent_confirmed: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Promotion failed (${res.status})`);

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promotion failed');
    } finally {
      setPromoting(false);
    }
  }

  // Units to display in the dropdown — order units listed first then remaining
  const orderUnitIds = new Set(orderUnits.map(u => u.id));
  const remainingUnits = units.filter(u => !orderUnitIds.has(u.id));

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-600" />
            <h2 className="text-base font-bold text-slate-900">Add to Unit Gallery</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Photo preview */}
          <div className="flex gap-4 items-start">
            <img
              src={photo.public_url}
              alt={photo.file_name}
              className="w-20 h-20 rounded-xl object-cover border border-slate-200 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{photo.file_name}</p>
              {photo.customer_name && (
                <p className="text-xs text-slate-500 mt-0.5">{photo.customer_name}</p>
              )}
              {photo.order_event_date && (
                <p className="text-xs text-slate-400">
                  {new Date(photo.order_event_date + 'T12:00:00').toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </p>
              )}
            </div>
          </div>

          {/* Delivery warning */}
          {isDelivery && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-snug">
                <span className="font-bold">Delivery proof photo.</span> These are operational records
                that may include customer property, addresses, people, or vehicles. Review carefully
                before promoting to the unit gallery.
              </p>
            </div>
          )}

          {/* Unit selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Select unit <span className="text-red-500">*</span>
            </label>
            {loadingUnits ? (
              <div className="h-11 bg-slate-100 rounded-xl animate-pulse" />
            ) : (
              <select
                value={selectedUnitId}
                onChange={e => handleUnitChange(e.target.value)}
                className="w-full h-11 px-3 border border-slate-300 rounded-xl text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <option value="">— Choose a unit —</option>
                {orderUnits.length > 0 && (
                  <optgroup label="On this order">
                    {orderUnits.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.is_combo ? ' (Combo)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {remainingUnits.length > 0 && (
                  <optgroup label={orderUnits.length > 0 ? 'All other units' : 'All units'}>
                    {remainingUnits.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name}{u.is_combo ? ' (Combo)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </div>

          {/* Mode selector — only shown for combo units */}
          {isCombo && selectedUnitId && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Add to gallery side
              </label>
              <p className="text-xs text-slate-500 mb-3">
                This is a combo unit with both dry and wet configurations. Choose which gallery this photo should appear in.
              </p>
              <div className="grid grid-cols-3 gap-2">
                {MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTargetMode(opt.value)}
                    className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 text-xs font-semibold transition-all ${
                      targetMode === opt.value
                        ? opt.value === 'dry'
                          ? 'border-sky-500 bg-sky-50 text-sky-700'
                          : opt.value === 'water'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className={
                      targetMode === opt.value
                        ? opt.value === 'dry' ? 'text-sky-600' : opt.value === 'water' ? 'text-blue-600' : 'text-teal-600'
                        : 'text-slate-400'
                    }>
                      {opt.icon}
                    </span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {MODE_OPTIONS.find(o => o.value === targetMode)?.description}
              </p>
            </div>
          )}

          {/* Consent checkbox */}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <div className="mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={e => setConsentChecked(e.target.checked)}
                className="sr-only"
              />
              <div
                onClick={() => setConsentChecked(v => !v)}
                className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                  consentChecked
                    ? 'bg-sky-600 border-sky-600'
                    : 'bg-white border-slate-300'
                }`}
              >
                {consentChecked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </div>
            </div>
            <p className="text-xs text-slate-700 leading-snug">
              {isDelivery ? (
                <>
                  <span className="font-semibold">Delivery photo marketing review.</span>{' '}
                  I confirm this delivery photo does not show sensitive or private customer details
                  such as people, children, license plates, house numbers, private address details,
                  or damage/evidence concerns, and the customer has not opted out of media use.
                </>
              ) : (
                <>
                  <span className="font-semibold">Marketing use confirmation.</span>{' '}
                  I confirm this image does not show sensitive or private customer information,
                  and the customer has not opted out of media use.
                </>
              )}
            </p>
          </label>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <Check className="w-4 h-4 text-green-600 shrink-0" />
              <p className="text-xs text-green-800 font-semibold">Photo added to unit gallery successfully!</p>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-3 px-5 pb-6 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePromote}
            disabled={!selectedUnitId || !consentChecked || promoting || success}
            className="flex-1 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors"
          >
            {promoting ? 'Adding...' : 'Add to Gallery'}
          </button>
        </div>
      </div>
    </div>
  );
}
