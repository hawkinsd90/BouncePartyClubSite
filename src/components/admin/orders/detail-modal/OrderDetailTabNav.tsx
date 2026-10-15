// Tab navigation for the Order Detail modal (mobile dropdown + desktop tabs).
// Presentational: the parent owns the active section state.

import { Truck, MessageSquare, FileText, History, CreditCard } from 'lucide-react';

export type OrderDetailSection = 'details' | 'workflow' | 'notes' | 'changelog' | 'payments';

interface OrderDetailTabNavProps {
  activeSection: OrderDetailSection;
  onChange: (section: OrderDetailSection) => void;
}

export function OrderDetailTabNav({ activeSection, onChange }: OrderDetailTabNavProps) {
  return (
    <div className="px-3 md:px-6 py-3 md:py-4 border-b border-slate-200 bg-slate-50">
      {/* Mobile Dropdown */}
      <div className="md:hidden">
        <select
          value={activeSection}
          onChange={(e) => onChange(e.target.value as OrderDetailSection)}
          className="w-full px-3 py-2 bg-white border-2 border-slate-300 rounded-lg text-slate-900 font-medium focus:outline-none focus:border-blue-500"
        >
          <option value="details">Details</option>
          <option value="workflow">Workflow</option>
          <option value="payments">Payments</option>
          <option value="notes">Notes</option>
          <option value="changelog">Changelog</option>
        </select>
      </div>

      {/* Desktop Tabs */}
      <div className="hidden md:flex space-x-1">
        {(['details', 'workflow', 'payments', 'notes', 'changelog'] as const).map(section => (
          <button
            key={section}
            onClick={() => onChange(section)}
            className={`px-4 py-2 font-medium rounded-t-lg transition-colors ${
              activeSection === section
                ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {section === 'details' && <FileText className="w-4 h-4 inline mr-2" />}
            {section === 'workflow' && <Truck className="w-4 h-4 inline mr-2" />}
            {section === 'payments' && <CreditCard className="w-4 h-4 inline mr-2" />}
            {section === 'notes' && <MessageSquare className="w-4 h-4 inline mr-2" />}
            {section === 'changelog' && <History className="w-4 h-4 inline mr-2" />}
            {section.charAt(0).toUpperCase() + section.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
