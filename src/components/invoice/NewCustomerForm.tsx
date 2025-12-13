interface NewCustomerFormProps {
  newCustomer: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    business_name: string;
  };
  onChange: (customer: any) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function NewCustomerForm({ newCustomer, onChange, onSubmit, onCancel }: NewCustomerFormProps) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
      <h4 className="font-semibold text-slate-900 mb-2">New Customer</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="text"
          placeholder="First Name"
          value={newCustomer.first_name}
          onChange={(e) => onChange({ ...newCustomer, first_name: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
        <input
          type="text"
          placeholder="Last Name"
          value={newCustomer.last_name}
          onChange={(e) => onChange({ ...newCustomer, last_name: e.target.value })}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
      </div>
      <input
        type="email"
        placeholder="Email"
        value={newCustomer.email}
        onChange={(e) => onChange({ ...newCustomer, email: e.target.value })}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
      />
      <input
        type="tel"
        placeholder="Phone"
        value={newCustomer.phone}
        onChange={(e) => onChange({ ...newCustomer, phone: e.target.value })}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
      />
      <input
        type="text"
        placeholder="Business Name (optional)"
        value={newCustomer.business_name}
        onChange={(e) => onChange({ ...newCustomer, business_name: e.target.value })}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
        >
          Create Customer
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
