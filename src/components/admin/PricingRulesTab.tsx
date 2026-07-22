import { useState, useEffect } from 'react';
import { CreditCard as Edit2, Save, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notifyError, notifySuccess } from '../../lib/notifications';
import { calculateEEOnlyDepositCents } from '../../lib/depositCalculation';
import { validateEEDepositSettingsInput, parseMoneyInput } from '../../lib/moneySettings';

interface PricingRules {
  id: string;
  base_radius_miles: number;
  per_mile_after_base_cents: number;
  surface_sandbag_fee_cents: number;
  deposit_per_unit_cents?: number;
  included_cities?: string[] | null;
  generator_fee_single_cents?: number;
  generator_fee_multiple_cents?: number;
  same_day_pickup_fee_cents?: number;
  same_day_weekday_delivery_fee_cents?: number;
  apply_taxes_by_default?: boolean;
  ee_only_deposit_base_threshold_cents?: number;
  ee_only_deposit_base_cents?: number;
  ee_only_deposit_subtotal_step_cents?: number;
  ee_only_deposit_step_cents?: number;
}

interface PricingRulesTabProps {
  pricingRules: PricingRules;
}

export function PricingRulesTab({ pricingRules: initialRules }: PricingRulesTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editedRules, setEditedRules] = useState(initialRules);
  const [applyTravelFeeByDefault, setApplyTravelFeeByDefault] = useState(true);

  const [displayValues, setDisplayValues] = useState({
    perMile: '',
    sandbag: '',
    deposit: '',
    generatorSingle: '',
    generatorMultiple: '',
    sameDayPickup: '',
    sameDayWeekdayDelivery: '',
    eeBaseThreshold: '',
    eeBaseDeposit: '',
    eeStepSize: '',
    eeStepDeposit: '',
  });
  const [eeErrors, setEeErrors] = useState<Record<string, string>>({});

  const eeSettings = {
    eeOnlyDepositBaseThresholdCents: editedRules.ee_only_deposit_base_threshold_cents ?? 20000,
    eeOnlyDepositBaseCents: editedRules.ee_only_deposit_base_cents ?? 5000,
    eeOnlyDepositSubtotalStepCents: editedRules.ee_only_deposit_subtotal_step_cents ?? 10000,
    eeOnlyDepositStepCents: editedRules.ee_only_deposit_step_cents ?? 5000,
  };

  const preview150 = calculateEEOnlyDepositCents(15000, 15000, eeSettings);
  const preview250 = calculateEEOnlyDepositCents(25000, 25000, eeSettings);
  const preview500 = calculateEEOnlyDepositCents(50000, 50000, eeSettings);
  const preview150Cents = preview150.status === 'calculated' ? preview150.depositCents : null;
  const preview250Cents = preview250.status === 'calculated' ? preview250.depositCents : null;
  const preview500Cents = preview500.status === 'calculated' ? preview500.depositCents : null;

  useEffect(() => {
    loadTravelFeeDefault();
  }, []);

  const loadTravelFeeDefault = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'apply_travel_fee_by_default')
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setApplyTravelFeeByDefault(data.value === 'true');
      }
    } catch (error: any) {
      console.error('Error loading travel fee default:', error);
    }
  };

  const handleSave = async () => {
    // Validate EE-only deposit settings before any save
    const eeValidation = validateEEDepositSettingsInput({
      eeBaseThreshold: displayValues.eeBaseThreshold,
      eeBaseDeposit: displayValues.eeBaseDeposit,
      eeStepSize: displayValues.eeStepSize,
      eeStepDeposit: displayValues.eeStepDeposit,
    });
    if (!eeValidation.ok) {
      setEeErrors(eeValidation.errors);
      notifyError('Please fix the Event Essentials deposit settings before saving.');
      return;
    }
    setEeErrors({});

    setSaving(true);
    try {
      const { error: pricingError } = await supabase
        .from('pricing_rules')
        .update({
          base_radius_miles: editedRules.base_radius_miles,
          per_mile_after_base_cents: editedRules.per_mile_after_base_cents,
          surface_sandbag_fee_cents: editedRules.surface_sandbag_fee_cents,
          deposit_per_unit_cents: editedRules.deposit_per_unit_cents || 5000,
          included_cities: editedRules.included_cities,
          generator_fee_single_cents: editedRules.generator_fee_single_cents || 10000,
          generator_fee_multiple_cents: editedRules.generator_fee_multiple_cents || 7500,
          same_day_pickup_fee_cents: editedRules.same_day_pickup_fee_cents || 0,
          same_day_weekday_delivery_fee_cents: editedRules.same_day_weekday_delivery_fee_cents || 0,
          apply_taxes_by_default: editedRules.apply_taxes_by_default ?? true,
          ee_only_deposit_base_threshold_cents: eeValidation.settings!.ee_only_deposit_base_threshold_cents,
          ee_only_deposit_base_cents: eeValidation.settings!.ee_only_deposit_base_cents,
          ee_only_deposit_subtotal_step_cents: eeValidation.settings!.ee_only_deposit_subtotal_step_cents,
          ee_only_deposit_step_cents: eeValidation.settings!.ee_only_deposit_step_cents,
        })
        .eq('id', editedRules.id);

      if (pricingError) throw pricingError;

      const { error: travelError } = await supabase
        .from('admin_settings')
        .upsert({
          key: 'apply_travel_fee_by_default',
          value: applyTravelFeeByDefault.toString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'key'
        });

      if (travelError) throw travelError;

      notifySuccess('Pricing settings updated successfully');
      setIsEditing(false);
      window.location.reload();
    } catch (error: any) {
      notifyError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedRules(initialRules);
    setEeErrors({});
    loadTravelFeeDefault();
    setIsEditing(false);
  };

  const handleStartEdit = () => {
    setDisplayValues({
      perMile: (editedRules.per_mile_after_base_cents / 100).toFixed(2),
      sandbag: (editedRules.surface_sandbag_fee_cents / 100).toFixed(2),
      deposit: ((editedRules.deposit_per_unit_cents || 5000) / 100).toFixed(2),
      generatorSingle: ((editedRules.generator_fee_single_cents || 10000) / 100).toFixed(2),
      generatorMultiple: ((editedRules.generator_fee_multiple_cents || 7500) / 100).toFixed(2),
      sameDayPickup: ((editedRules.same_day_pickup_fee_cents || 0) / 100).toFixed(2),
      sameDayWeekdayDelivery: ((editedRules.same_day_weekday_delivery_fee_cents || 0) / 100).toFixed(2),
      eeBaseThreshold: ((editedRules.ee_only_deposit_base_threshold_cents || 20000) / 100).toFixed(2),
      eeBaseDeposit: ((editedRules.ee_only_deposit_base_cents || 5000) / 100).toFixed(2),
      eeStepSize: ((editedRules.ee_only_deposit_subtotal_step_cents || 10000) / 100).toFixed(2),
      eeStepDeposit: ((editedRules.ee_only_deposit_step_cents || 5000) / 100).toFixed(2),
    });
    setIsEditing(true);
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Pricing Configuration</h2>
        {!isEditing && (
          <button
            onClick={handleStartEdit}
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

      <div className="space-y-4">
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
          <p className="text-xs text-slate-500 mt-1">
            Distance from your business address where no travel fee is charged
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Per Mile After Base (in dollars)
          </label>
          <input
            type="text"
            value={isEditing ? displayValues.perMile : `${(editedRules.per_mile_after_base_cents / 100).toFixed(2)}`}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = parseMoneyInput(value);
              setDisplayValues({ ...displayValues, perMile: value });
              setEditedRules({ ...editedRules, per_mile_after_base_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.per_mile_after_base_cents });
            }}
            readOnly={!isEditing}
            className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
              isEditing ? 'bg-white' : 'bg-slate-50'
            }`}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Travel Fee Settings
          </label>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={applyTravelFeeByDefault}
                onChange={(e) => setApplyTravelFeeByDefault(e.target.checked)}
                disabled={!isEditing}
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-slate-900">Apply Travel Fee by Default</span>
                <p className="text-xs text-slate-600 mt-1">
                  When checked, travel fee will automatically be applied to all new orders based on distance. You can still waive or apply travel fees on individual orders if needed.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Sandbag Fee (in dollars)
          </label>
          <input
            type="text"
            value={isEditing ? displayValues.sandbag : `${(editedRules.surface_sandbag_fee_cents / 100).toFixed(2)}`}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = parseMoneyInput(value);
              setDisplayValues({ ...displayValues, sandbag: value });
              setEditedRules({ ...editedRules, surface_sandbag_fee_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.surface_sandbag_fee_cents });
            }}
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
            type="text"
            value={isEditing ? displayValues.deposit : `${((editedRules.deposit_per_unit_cents || 5000) / 100).toFixed(2)}`}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = parseMoneyInput(value);
              setDisplayValues({ ...displayValues, deposit: value });
              setEditedRules({ ...editedRules, deposit_per_unit_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.deposit_per_unit_cents });
            }}
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
            First Generator Fee (in dollars)
          </label>
          <input
            type="text"
            value={isEditing ? displayValues.generatorSingle : `${((editedRules.generator_fee_single_cents || 10000) / 100).toFixed(2)}`}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = parseMoneyInput(value);
              setDisplayValues({ ...displayValues, generatorSingle: value });
              setEditedRules({ ...editedRules, generator_fee_single_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.generator_fee_single_cents });
            }}
            readOnly={!isEditing}
            className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
              isEditing ? 'bg-white' : 'bg-slate-50'
            }`}
          />
          <p className="text-xs text-slate-500 mt-1">
            Fee for the first generator in an order
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Additional Generator Fee (in dollars each)
          </label>
          <input
            type="text"
            value={isEditing ? displayValues.generatorMultiple : `${((editedRules.generator_fee_multiple_cents || 7500) / 100).toFixed(2)}`}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = parseMoneyInput(value);
              setDisplayValues({ ...displayValues, generatorMultiple: value });
              setEditedRules({ ...editedRules, generator_fee_multiple_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.generator_fee_multiple_cents });
            }}
            readOnly={!isEditing}
            className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
              isEditing ? 'bg-white' : 'bg-slate-50'
            }`}
          />
          <p className="text-xs text-slate-500 mt-1">
            Fee for each additional generator after the first
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Same Day Pickup Fee (in dollars)
          </label>
          <input
            type="text"
            value={isEditing ? displayValues.sameDayPickup : `${((editedRules.same_day_pickup_fee_cents || 0) / 100).toFixed(2)}`}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = parseMoneyInput(value);
              setDisplayValues({ ...displayValues, sameDayPickup: value });
              setEditedRules({ ...editedRules, same_day_pickup_fee_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.same_day_pickup_fee_cents });
            }}
            readOnly={!isEditing}
            className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
              isEditing ? 'bg-white' : 'bg-slate-50'
            }`}
          />
          <p className="text-xs text-slate-500 mt-1">
            Additional fee for same-day pickup requests
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Same Day Weekday Delivery Fee (in dollars)
          </label>
          <input
            type="text"
            value={isEditing ? displayValues.sameDayWeekdayDelivery : `${((editedRules.same_day_weekday_delivery_fee_cents || 0) / 100).toFixed(2)}`}
            onChange={(e) => {
              const value = e.target.value;
              const parsed = parseMoneyInput(value);
              setDisplayValues({ ...displayValues, sameDayWeekdayDelivery: value });
              setEditedRules({ ...editedRules, same_day_weekday_delivery_fee_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.same_day_weekday_delivery_fee_cents });
            }}
            readOnly={!isEditing}
            className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${
              isEditing ? 'bg-white' : 'bg-slate-50'
            }`}
          />
          <p className="text-xs text-slate-500 mt-1">
            Additional fee applied when the event date is today and falls on a weekday
          </p>
        </div>

        <div className="border-t-2 border-slate-200 pt-6 mt-6">
          <label className="block text-lg font-bold text-slate-900 mb-2">
            Event Essentials-Only Deposit
          </label>
          <p className="text-xs text-slate-500 mb-4">
            Required deposit for orders with zero inflatables. The deposit is based on the Event Essentials subtotal only (travel, tax, fees, and discounts do not affect the tier).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Base Threshold (in dollars)
              </label>
              <input
                type="text"
                value={isEditing ? displayValues.eeBaseThreshold : `${((editedRules.ee_only_deposit_base_threshold_cents || 20000) / 100).toFixed(2)}`}
                onChange={(e) => {
                  const value = e.target.value;
                  const parsed = parseMoneyInput(value);
                  setDisplayValues({ ...displayValues, eeBaseThreshold: value });
                  setEditedRules({ ...editedRules, ee_only_deposit_base_threshold_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.ee_only_deposit_base_threshold_cents });
                }}
                readOnly={!isEditing}
                className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
              />
              <p className="text-xs text-slate-500 mt-1">EE subtotal at or below this amount uses the base deposit</p>
              {eeErrors.eeBaseThreshold && <p className="text-xs text-red-600 mt-1">{eeErrors.eeBaseThreshold}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Base Deposit (in dollars)
              </label>
              <input
                type="text"
                value={isEditing ? displayValues.eeBaseDeposit : `${((editedRules.ee_only_deposit_base_cents || 5000) / 100).toFixed(2)}`}
                onChange={(e) => {
                  const value = e.target.value;
                  const parsed = parseMoneyInput(value);
                  setDisplayValues({ ...displayValues, eeBaseDeposit: value });
                  setEditedRules({ ...editedRules, ee_only_deposit_base_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.ee_only_deposit_base_cents });
                }}
                readOnly={!isEditing}
                className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
              />
              <p className="text-xs text-slate-500 mt-1">Required deposit when subtotal is at or below the threshold</p>
              {eeErrors.eeBaseDeposit && <p className="text-xs text-red-600 mt-1">{eeErrors.eeBaseDeposit}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Step Size (in dollars)
              </label>
              <input
                type="text"
                value={isEditing ? displayValues.eeStepSize : `${((editedRules.ee_only_deposit_subtotal_step_cents || 10000) / 100).toFixed(2)}`}
                onChange={(e) => {
                  const value = e.target.value;
                  const parsed = parseMoneyInput(value);
                  setDisplayValues({ ...displayValues, eeStepSize: value });
                  setEditedRules({ ...editedRules, ee_only_deposit_subtotal_step_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.ee_only_deposit_subtotal_step_cents });
                }}
                readOnly={!isEditing}
                className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
              />
              <p className="text-xs text-slate-500 mt-1">Each additional step of EE subtotal adds one more deposit tier</p>
              {eeErrors.eeStepSize && <p className="text-xs text-red-600 mt-1">{eeErrors.eeStepSize}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Step Deposit (in dollars)
              </label>
              <input
                type="text"
                value={isEditing ? displayValues.eeStepDeposit : `${((editedRules.ee_only_deposit_step_cents || 5000) / 100).toFixed(2)}`}
                onChange={(e) => {
                  const value = e.target.value;
                  const parsed = parseMoneyInput(value);
                  setDisplayValues({ ...displayValues, eeStepDeposit: value });
                  setEditedRules({ ...editedRules, ee_only_deposit_step_cents: parsed.ok ? (parsed.cents ?? 0) : editedRules.ee_only_deposit_step_cents });
                }}
                readOnly={!isEditing}
                className={`w-full px-4 py-2 border border-slate-300 rounded-lg ${isEditing ? 'bg-white' : 'bg-slate-50'}`}
              />
              <p className="text-xs text-slate-500 mt-1">Additional deposit amount per tier above the threshold</p>
              {eeErrors.eeStepDeposit && <p className="text-xs text-red-600 mt-1">{eeErrors.eeStepDeposit}</p>}
            </div>
          </div>

          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-slate-700 mb-2">Live Preview</p>
            <div className="space-y-1 text-sm text-slate-600">
              <div className="flex justify-between">
                <span>EE Subtotal $150.00:</span>
                <span className="font-semibold text-slate-900">
                  {preview150Cents !== null ? `${(preview150Cents / 100).toFixed(2)}` : <span className="text-red-600 text-xs">Invalid configuration</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span>EE Subtotal $250.00:</span>
                <span className="font-semibold text-slate-900">
                  {preview250Cents !== null ? `${(preview250Cents / 100).toFixed(2)}` : <span className="text-red-600 text-xs">Invalid configuration</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span>EE Subtotal $500.00:</span>
                <span className="font-semibold text-slate-900">
                  {preview500Cents !== null ? `${(preview500Cents / 100).toFixed(2)}` : <span className="text-red-600 text-xs">Invalid configuration</span>}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Tax Settings
          </label>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={editedRules.apply_taxes_by_default ?? true}
                onChange={(e) => setEditedRules({ ...editedRules, apply_taxes_by_default: e.target.checked })}
                disabled={!isEditing}
                className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-slate-900">Apply Taxes by Default</span>
                <p className="text-xs text-slate-600 mt-1">
                  When checked, taxes will automatically be applied to all new orders. You can still waive taxes on individual orders if needed.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Free Travel Cities
          </label>
          <p className="text-xs text-slate-500 mb-3">
            Cities that will have FREE travel fees regardless of distance.
          </p>

          {isEditing && (
            <div className="mb-3">
              <input
                type="text"
                list="city-suggestions"
                placeholder="Type city name and press Enter..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                    e.preventDefault();
                    const newCity = e.currentTarget.value.trim();
                    const currentCities = editedRules.included_cities || [];
                    if (!currentCities.includes(newCity)) {
                      setEditedRules({
                        ...editedRules,
                        included_cities: [...currentCities, newCity]
                      });
                    }
                    e.currentTarget.value = '';
                  }
                }}
                className="w-full px-4 py-2 border-2 border-slate-300 rounded-lg focus:border-blue-500 focus:outline-none"
              />
              <datalist id="city-suggestions">
                {(editedRules.included_cities || []).map((city, index) => (
                  <option key={index} value={city} />
                ))}
              </datalist>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(editedRules.included_cities || []).length === 0 ? (
              <p className="text-slate-500 italic">No free travel cities configured</p>
            ) : (
              (editedRules.included_cities || []).map((city, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-800 rounded-lg border-2 border-blue-300 font-semibold"
                >
                  {city}
                  {isEditing && (
                    <button
                      onClick={() => {
                        const newCities = (editedRules.included_cities || []).filter((_, i) => i !== index);
                        setEditedRules({
                          ...editedRules,
                          included_cities: newCities
                        });
                      }}
                      className="text-blue-600 hover:text-blue-900 hover:bg-blue-200 rounded-full p-1"
                      title="Remove city"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
