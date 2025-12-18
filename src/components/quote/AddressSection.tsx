import { MapPin } from 'lucide-react';
import { AddressAutocomplete } from '../order/AddressAutocomplete';
import type { QuoteFormData } from '../../hooks/useQuoteForm';

interface AddressSectionProps {
  formData: QuoteFormData;
  addressInput: string;
  onAddressInputChange: (value: string) => void;
  onFormDataChange: (updates: Partial<QuoteFormData>) => void;
}

export function AddressSection({
  formData,
  addressInput,
  onAddressInputChange,
  onFormDataChange,
}: AddressSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-4 sm:mb-6">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
          <MapPin className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Event Address</h2>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">Street Address *</label>
          <AddressAutocomplete
            value={addressInput}
            onSelect={(address) => {
              onAddressInputChange(address.formatted_address);
              onFormDataChange({
                address_line1: address.street,
                city: address.city,
                state: address.state,
                zip: address.zip,
                lat: address.lat,
                lng: address.lng,
              });
            }}
            placeholder="Enter event address"
            required
          />
        </div>
        <div>
          <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">
            Suite/Unit (Optional - for business locations only)
          </label>
          <input
            type="text"
            value={formData.address_line2}
            onChange={(e) => onFormDataChange({ address_line2: e.target.value })}
            placeholder="Suite 100"
            className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base transition-shadow"
          />
          <p className="text-xs text-slate-500 mt-1.5">Note: We cannot deliver to apartments</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">City *</label>
            <input
              type="text"
              required
              value={formData.city}
              onChange={(e) => onFormDataChange({ city: e.target.value })}
              className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base transition-shadow"
            />
          </div>
          <div>
            <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">State *</label>
            <input
              type="text"
              required
              value={formData.state}
              onChange={(e) => onFormDataChange({ state: e.target.value })}
              className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base transition-shadow"
            />
          </div>
          <div>
            <label className="block text-xs sm:text-sm font-medium text-slate-700 mb-2">ZIP Code *</label>
            <input
              type="text"
              required
              value={formData.zip}
              onChange={(e) => onFormDataChange({ zip: e.target.value })}
              className="w-full px-3 sm:px-4 py-2 sm:py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 text-sm sm:text-base transition-shadow"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
