interface CustomerInfo {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
}

interface CustomerInfoFormProps {
  customerInfo: CustomerInfo;
  onChange: (info: CustomerInfo) => void;
}

export function CustomerInfoForm({ customerInfo, onChange }: CustomerInfoFormProps) {
  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-slate-900 mb-4">Your Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            First Name *
          </label>
          <input
            type="text"
            required
            value={customerInfo.first_name}
            onChange={(e) =>
              onChange({ ...customerInfo, first_name: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Last Name *
          </label>
          <input
            type="text"
            required
            value={customerInfo.last_name}
            onChange={(e) =>
              onChange({ ...customerInfo, last_name: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Email *
          </label>
          <input
            type="email"
            required
            value={customerInfo.email}
            onChange={(e) =>
              onChange({ ...customerInfo, email: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Phone *
          </label>
          <input
            type="tel"
            required
            value={customerInfo.phone}
            onChange={(e) =>
              onChange({ ...customerInfo, phone: e.target.value })
            }
            placeholder="(313) 555-0123"
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Business Name (Optional)
          </label>
          <input
            type="text"
            value={customerInfo.business_name}
            onChange={(e) =>
              onChange({ ...customerInfo, business_name: e.target.value })
            }
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>
    </div>
  );
}
