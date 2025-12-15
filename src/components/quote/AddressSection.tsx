import { MapPin } from 'lucide-react';
import { AddressAutocomplete } from '../AddressAutocomplete';
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
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
        <MapPin className="w-6 h-6 mr-2 text-blue-600" />
        Event Address
      </h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Street Address *
          </label>
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
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Suite/Unit (Optional - for business locations only)
          </label>
          <input
            type="text"
            value={formData.address_line2}
            onChange={(e) => onFormDataChange({ address_line2: e.target.value })}
            placeholder="Suite 100"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
          />
          <p className="text-xs text-slate-500 mt-1">
            Note: We cannot deliver to apartments
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              City *
            </label>
            <input
              type="text"
              required
              value={formData.city}
              onChange={(e) => onFormDataChange({ city: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              State *
            </label>
            <input
              type="text"
              required
              value={formData.state}
              onChange={(e) => onFormDataChange({ state: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              ZIP Code *
            </label>
            <input
              type="text"
              required
              value={formData.zip}
              onChange={(e) => onFormDataChange({ zip: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
