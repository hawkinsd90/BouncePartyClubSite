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
  overnight_holiday_only: boolean;
  same_day_matrix_json: Array<{
    units: string;
    generator: boolean;
    subtotal_ge_cents: number;
    fee_cents: number;
  }>;
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
          deposit_per_unit_cents: editedRules.deposit_per_unit_cents || 10000,
          overnight_holiday_only: editedRules.overnight_holiday_only,
          same_day_matrix_json: editedRules.same_day_matrix_json,
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

  const updateSameDayFee = (index: number, field: string, value: any) => {
    const newMatrix = [...editedRules.same_day_matrix_json];
    newMatrix[index] = { ...newMatrix[index], [field]: value };
    setEditedRules({ ...editedRules, same_day_matrix_json: newMatrix });
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
              value={((editedRules.deposit_per_unit_cents || 10000) / 100).toFixed(2)}
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
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Overnight Holiday Only
            </label>
            <select
              value={editedRules.overnight_holiday_only ? 'yes' : 'no'}
              onChange={(e) => setEditedRules({ ...editedRules, overnight_holiday_only: e.target.value === 'yes' })}
              disabled={!isEditing}
              className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
                isEditing ? 'bg-white' : 'bg-slate-50'
              }`}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Same-Day Pickup Fee Matrix
          </label>
          <p className="text-xs text-slate-500 mb-3">
            Configure fees for same-day pickups based on number of units and generator requirement
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border border-slate-200 rounded-lg">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Units
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Generator
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Min Subtotal ($)
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Fee ($)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {editedRules.same_day_matrix_json.map((rule, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2 text-sm text-slate-900">
                      {isEditing ? (
                        <input
                          type="text"
                          value={rule.units}
                          onChange={(e) => updateSameDayFee(idx, 'units', e.target.value)}
                          className="w-full px-2 py-1 border border-slate-300 rounded"
                        />
                      ) : (
                        rule.units
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-900">
                      {isEditing ? (
                        <select
                          value={rule.generator ? 'yes' : 'no'}
                          onChange={(e) => updateSameDayFee(idx, 'generator', e.target.value === 'yes')}
                          className="w-full px-2 py-1 border border-slate-300 rounded"
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      ) : (
                        rule.generator ? 'Yes' : 'No'
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-900">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={(rule.subtotal_ge_cents / 100).toFixed(2)}
                          onChange={(e) => updateSameDayFee(idx, 'subtotal_ge_cents', Math.round(Number(e.target.value) * 100))}
                          className="w-full px-2 py-1 border border-slate-300 rounded"
                        />
                      ) : (
                        formatCurrency(rule.subtotal_ge_cents)
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-slate-900">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.01"
                          value={(rule.fee_cents / 100).toFixed(2)}
                          onChange={(e) => updateSameDayFee(idx, 'fee_cents', Math.round(Number(e.target.value) * 100))}
                          className="w-full px-2 py-1 border border-slate-300 rounded"
                        />
                      ) : (
                        formatCurrency(rule.fee_cents)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
