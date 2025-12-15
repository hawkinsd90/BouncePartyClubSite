import { useNavigate } from 'react-router-dom';
import { formatCurrency } from '../../lib/pricing';
import { Edit2 } from 'lucide-react';

interface PricingRules {
  base_radius_miles: number;
  per_mile_after_base_cents: number;
  surface_sandbag_fee_cents: number;
  residential_multiplier: number;
  commercial_multiplier: number;
  overnight_holiday_only: boolean;
  included_city_list_json: string[];
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

export function PricingSection({ pricingRules }: PricingSectionProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Pricing Configuration</h2>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Base Radius (miles)
            </label>
            <input
              type="number"
              value={pricingRules.base_radius_miles}
              readOnly
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Per Mile After Base
            </label>
            <input
              type="text"
              value={formatCurrency(pricingRules.per_mile_after_base_cents)}
              readOnly
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Sandbag Fee
            </label>
            <input
              type="text"
              value={formatCurrency(pricingRules.surface_sandbag_fee_cents)}
              readOnly
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Residential Multiplier
            </label>
            <input
              type="text"
              value={pricingRules.residential_multiplier}
              readOnly
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Commercial Multiplier
            </label>
            <input
              type="text"
              value={pricingRules.commercial_multiplier}
              readOnly
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Overnight Holiday Only
            </label>
            <input
              type="text"
              value={pricingRules.overnight_holiday_only ? 'Yes' : 'No'}
              readOnly
              className="w-full px-4 py-2 border border-slate-300 rounded-lg bg-slate-50"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Included Cities
          </label>
          <div className="flex flex-wrap gap-2">
            {pricingRules.included_city_list_json.map((city: string) => (
              <span
                key={city}
                className="inline-flex px-3 py-1 bg-blue-100 text-blue-800 text-sm font-semibold rounded"
              >
                {city}
              </span>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Same-Day Pickup Fee Matrix
          </label>
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
                    Min Subtotal
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    Fee
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pricingRules.same_day_matrix_json.map((rule, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2 text-sm text-slate-900">{rule.units}</td>
                    <td className="px-4 py-2 text-sm text-slate-900">
                      {rule.generator ? 'Yes' : 'No'}
                    </td>
                    <td className="px-4 py-2 text-sm text-slate-900">
                      {formatCurrency(rule.subtotal_ge_cents)}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-slate-900">
                      {formatCurrency(rule.fee_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => navigate('/admin/pricing/edit')}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Edit Pricing
          </button>
        </div>
      </div>
    </div>
  );
}
