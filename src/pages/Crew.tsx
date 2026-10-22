import { useState } from 'react';
import { Calendar, FileText } from 'lucide-react';
import { AdminCalendar } from '../components/AdminCalendar';
import { CrewInvoiceBuilder } from '../components/crew/CrewInvoiceBuilder';

type TabType = 'calendar' | 'invoice';

export function Crew() {
  const [activeTab, setActiveTab] = useState<TabType>('calendar');
  // Both tabs stay mounted once opened (hidden, not removed), so a half-written invoice or an open day view survives a switch to the other tab.
  const [invoiceOpened, setInvoiceOpened] = useState(false);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8">
      <h1 className="text-2xl sm:text-4xl font-bold text-slate-900 mb-4 sm:mb-6">Crew Dashboard</h1>

      <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
        <div className="border-b border-slate-200">
          <nav className="flex -mb-px" role="tablist" aria-label="Crew sections">
            <button
              onClick={() => setActiveTab('calendar')}
              role="tab"
              aria-selected={activeTab === 'calendar'}
              className={`flex-1 sm:flex-none justify-center px-4 sm:px-6 py-4 min-h-[48px] text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors ${
                activeTab === 'calendar'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Calendar className="w-5 h-5" />
              Calendar
            </button>
            <button
              onClick={() => { setInvoiceOpened(true); setActiveTab('invoice'); }}
              role="tab"
              aria-selected={activeTab === 'invoice'}
              className={`flex-1 sm:flex-none justify-center px-4 sm:px-6 py-4 min-h-[48px] text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors ${
                activeTab === 'invoice'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <FileText className="w-5 h-5" />
              Invoice
            </button>
          </nav>
        </div>

        <div className="p-3 sm:p-6">
          <div hidden={activeTab !== 'calendar'}><AdminCalendar /></div>
          {invoiceOpened && <div hidden={activeTab !== 'invoice'}><CrewInvoiceBuilder /></div>}
        </div>
      </div>
    </div>
  );
}
