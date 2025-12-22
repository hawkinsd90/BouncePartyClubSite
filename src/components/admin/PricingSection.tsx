import { useState } from 'react';
import { formatCurrency } from '../../lib/pricing';
import { Edit2, Save, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/notifications';

interface PricingRules {
  id: string;
  base_radius_miles: number;
  per_mile_after_base_cents: number;
  surface_sandbag_fee_cents: number;
  deposit_per_unit_cents?: number;
  included_cities?: string[] | null;
}

interface PricingSectionProps {
  pricingRules: PricingRules;
}

export function PricingSection({ pricingRules: initialRules }: PricingSectionProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedRules, setEditedRules] = useState(initialRules);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('pricing_rules')
        .update({
          base_radius_miles: editedRules.base_radius_miles,
          per_mile_after_base_cents: editedRules.per_mile_after_base_cents,
          surface_sandbag_fee_cents: editedRules.surface_sandbag_fee_cents,
          deposit_per_unit_cents: editedRules.deposit_per_unit_cents || 5000,
          included_cities: editedRules.included_cities,
        })
        .eq('id', editedRules.id);

      if (error) throw error;

      notify('Pricing settings updated successfully', 'success');
      setIsEditing(false);
      window.location.reload();
    } catch (error: any) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedRules(initialRules);
    setIsEditing(false);
  };

  const handleCitiesChange = (value: string) => {
    const cities = value.split(',').map(c => c.trim()).filter(c => c.length > 0);
    setEditedRules({ ...editedRules, included_cities: cities.length > 0 ? cities : null });
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Pricing Configuration</h2>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Edit Pricing
          </button>
        )}
        {isEditing && (
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Base Radius (miles)
            </label>
            <input
              type="number"
              value={editedRules.base_radius_miles}
              onChange={(e) => setEditedRules({ ...editedRules, base_radius_miles: Number(e.target.value) })}
              readOnly={!isEditing}
              className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
                isEditing ? 'bg-white' : 'bg-slate-50'
              }`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Per Mile After Base (in dollars)
            </label>
            <input
              type="number"
              step="0.01"
              value={(editedRules.per_mile_after_base_cents / 100).toFixed(2)}
              onChange={(e) => setEditedRules({ ...editedRules, per_mile_after_base_cents: Math.round(Number(e.target.value) * 100) })}
              readOnly={!isEditing}
              className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
                isEditing ? 'bg-white' : 'bg-slate-50'
              }`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Sandbag Fee (in dollars)
            </label>
            <input
              type="number"
              step="0.01"
              value={(editedRules.surface_sandbag_fee_cents / 100).toFixed(2)}
              onChange={(e) => setEditedRules({ ...editedRules, surface_sandbag_fee_cents: Math.round(Number(e.target.value) * 100) })}
              readOnly={!isEditing}
              className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
                isEditing ? 'bg-white' : 'bg-slate-50'
              }`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Deposit Per Unit (in dollars)
            </label>
            <input
              type="number"
              step="0.01"
              value={((editedRules.deposit_per_unit_cents || 5000) / 100).toFixed(2)}
              onChange={(e) => setEditedRules({ ...editedRules, deposit_per_unit_cents: Math.round(Number(e.target.value) * 100) })}
              readOnly={!isEditing}
              className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
                isEditing ? 'bg-white' : 'bg-slate-50'
              }`}
            />
            <p className="text-xs text-slate-500 mt-1">
              This deposit amount will be reflected in waivers and throughout the system
            </p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Free Travel Cities
          </label>
          <p className="text-xs text-slate-500 mb-3">
            Enter city names separated by commas (e.g., Detroit, Dearborn). These cities will have FREE travel fees regardless of distance.
          </p>
          <input
            type="text"
            value={editedRules.included_cities?.join(', ') || ''}
            onChange={(e) => handleCitiesChange(e.target.value)}
            placeholder="Detroit, Dearborn, Ann Arbor"
            readOnly={!isEditing}
            className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
              isEditing ? 'bg-white' : 'bg-slate-50'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
