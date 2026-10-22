import { Search, UserPlus, X } from 'lucide-react';
import { filterCustomers, type PickableCustomer } from '../../lib/core/customerSearch';

interface CustomerSelectorProps {
  customers: PickableCustomer[];
  selectedCustomer: string;
  customerSearchQuery: string;
  showDropdown: boolean;
  showNewCustomerForm: boolean;
  onSearchChange: (query: string) => void;
  onCustomerSelect: (customerId: string) => void;
  onClearCustomer: () => void;
  onToggleNewForm: () => void;
  onShowDropdown: (show: boolean) => void;
}

export function CustomerSelector({
  customers,
  selectedCustomer,
  customerSearchQuery,
  showDropdown,
  showNewCustomerForm,
  onSearchChange,
  onCustomerSelect,
  onClearCustomer,
  onToggleNewForm,
  onShowDropdown,
}: CustomerSelectorProps) {
  const selectedCustomerObj = customers.find(c => c.id === selectedCustomer);

  const { shown: filteredCustomers, total: matchCount } = filterCustomers(customers, customerSearchQuery);

  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
        <h3 className="text-base sm:text-lg font-semibold text-slate-900">Select Customer</h3>
        <button
          onClick={onToggleNewForm}
          className="flex items-center justify-center gap-1 sm:gap-2 px-3 py-2 min-h-[44px] bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm rounded-lg transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          New Customer
        </button>
      </div>

      {selectedCustomerObj ? (
        <div className="mb-3">
          <div className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="min-w-0 break-words">
              <p className="font-medium text-slate-900">
                {selectedCustomerObj.first_name} {selectedCustomerObj.last_name}
              </p>
              <p className="text-sm text-slate-600">{selectedCustomerObj.email}</p>
              {selectedCustomerObj.business_name && (
                <p className="text-sm text-slate-600">{selectedCustomerObj.business_name}</p>
              )}
            </div>
            <button
              onClick={onClearCustomer}
              aria-label="Choose a different customer"
              className="text-red-600 hover:text-red-700 flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative mb-3 customer-search-container">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search customers by name, email, phone, or business..."
              value={customerSearchQuery}
              onChange={(e) => {
                onSearchChange(e.target.value);
                onShowDropdown(true);
              }}
              onFocus={() => onShowDropdown(true)}
              aria-label="Search customers"
              autoComplete="off"
              className="w-full pl-10 pr-4 py-2 min-h-[44px] text-base sm:text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {showDropdown && filteredCustomers.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {filteredCustomers.map(customer => (
                <button
                  key={customer.id}
                  onClick={() => {
                    onCustomerSelect(customer.id);
                    onShowDropdown(false);
                  }}
                  className="w-full text-left px-4 py-3 min-h-[44px] break-words hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                >
                  <p className="font-medium text-slate-900">
                    {customer.first_name} {customer.last_name}
                  </p>
                  <p className="text-sm text-slate-600">{customer.email}</p>
                  {customer.phone && (
                    <p className="text-sm text-slate-500">{customer.phone}</p>
                  )}
                  {customer.business_name && (
                    <p className="text-sm text-blue-600">{customer.business_name}</p>
                  )}
                </button>
              ))}
              {matchCount > filteredCustomers.length && (
                <p className="px-4 py-2 text-xs text-slate-500 bg-slate-50">Showing the first {filteredCustomers.length} of {matchCount}. Type more of the name, email or phone to narrow the list.</p>
              )}
            </div>
          )}
        </div>
      )}

      {!showNewCustomerForm && !selectedCustomer && (
        <p className="text-xs sm:text-sm text-slate-500">
          Select an existing customer or create a new one. Leave blank to send a link for customer to fill in their info.
        </p>
      )}
    </div>
  );
}
