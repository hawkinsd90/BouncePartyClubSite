import { MapPin } from 'lucide-react';

interface BillingAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

interface BillingAddressFormProps {
  billingAddress: BillingAddress;
  billingSameAsEvent: boolean;
  quoteData: any;
  onBillingAddressChange: (address: BillingAddress) => void;
  onBillingSameAsEventChange: (same: boolean) => void;
}

export function BillingAddressForm({
  billingAddress,
  billingSameAsEvent,
  quoteData,
  onBillingAddressChange,
  onBillingSameAsEventChange,
}: BillingAddressFormProps) {
  const handleCheckboxChange = (checked: boolean) => {
    onBillingSameAsEventChange(checked);
    if (checked) {
      onBillingAddressChange({
        line1: quoteData.address_line1 || '',
        line2: quoteData.address_line2 || '',
        city: quoteData.city || '',
        state: quoteData.state || '',
        zip: quoteData.zip || '',
      });
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center">
        <MapPin className="w-6 h-6 mr-2 text-blue-600" />
        Billing Address
      </h2>

      <label className="flex items-center mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={billingSameAsEvent}
          onChange={(e) => handleCheckboxChange(e.target.checked)}
          className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500 mr-3"
        />
        <span className="text-sm text-slate-700">
          Billing address is the same as event address
        </span>
      </label>

      {!billingSameAsEvent && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Street Address *
            </label>
            <input
              type="text"
              required
              value={billingAddress.line1}
              onChange={(e) =>
                onBillingAddressChange({ ...billingAddress, line1: e.target.value })
              }
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Apt/Suite (Optional)
            </label>
            <input
              type="text"
              value={billingAddress.line2}
              onChange={(e) =>
                onBillingAddressChange({ ...billingAddress, line2: e.target.value })
              }
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                City *
              </label>
              <input
                type="text"
                required
                value={billingAddress.city}
                onChange={(e) =>
                  onBillingAddressChange({ ...billingAddress, city: e.target.value })
                }
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
                value={billingAddress.state}
                onChange={(e) =>
                  onBillingAddressChange({ ...billingAddress, state: e.target.value })
                }
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                ZIP *
              </label>
              <input
                type="text"
                required
                value={billingAddress.zip}
                onChange={(e) =>
                  onBillingAddressChange({ ...billingAddress, zip: e.target.value })
                }
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900"
              />
            </div>
          </div>
        </div>
      )}

      {billingSameAsEvent && (
        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
          <p className="text-sm text-slate-700">
            <strong>Event Address:</strong>
          </p>
          <p className="text-sm text-slate-600 mt-1">
            {quoteData.address_line1}
            {quoteData.address_line2 && `, ${quoteData.address_line2}`}
          </p>
          <p className="text-sm text-slate-600">
            {quoteData.city}, {quoteData.state} {quoteData.zip}
          </p>
        </div>
      )}
    </div>
  );
}
