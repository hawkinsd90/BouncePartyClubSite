import { useState } from 'react';
import { MapPin, DollarSign } from 'lucide-react';
import { BusinessAddressTab } from './BusinessAddressTab';
import { PricingRulesTab } from './PricingRulesTab';

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
  apply_taxes_by_default?: boolean;
}

interface PricingSectionProps {
  pricingRules: PricingRules;
}

type TabType = 'address' | 'pricing';

export function PricingSection({ pricingRules: initialRules }: PricingSectionProps) {
  const [activeTab, setActiveTab] = useState<TabType>('address');

  const tabs = [
    { id: 'address' as TabType, label: 'Business Address', icon: MapPin },
    { id: 'pricing' as TabType, label: 'Pricing Rules', icon: DollarSign },
  ];

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-md p-2">
        <div className="flex gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'address' && <BusinessAddressTab />}
      {activeTab === 'pricing' && <PricingRulesTab pricingRules={initialRules} />}
    </div>
  );
}
