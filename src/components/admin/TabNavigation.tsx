export type AdminTab =
  | 'overview'
  | 'pending'
  | 'calendar'
  | 'inventory'
  | 'orders'
  | 'contacts'
  | 'invoices'
  | 'calculator'
  | 'pricing'
  | 'permissions'
  | 'message_templates';

interface TabConfig {
  id: AdminTab;
  label: string;
  badge?: number;
  color?: 'blue' | 'amber';
}

interface TabNavigationProps {
  activeTab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
  pendingCount?: number;
}

export function TabNavigation({ activeTab, onTabChange, pendingCount = 0 }: TabNavigationProps) {
  const tabs: TabConfig[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'pending', label: 'Pending Review', badge: pendingCount, color: 'amber' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'orders', label: 'Orders' },
    { id: 'contacts', label: 'Contacts' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'calculator', label: 'Travel Calculator' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'message_templates', label: 'Message Templates' },
  ];

  return (
    <>
      <div className="md:hidden mb-6">
        <label htmlFor="admin-tab-select" className="block text-sm font-medium text-slate-700 mb-2">
          Navigate to:
        </label>
        <select
          id="admin-tab-select"
          value={activeTab}
          onChange={(e) => onTabChange(e.target.value as AdminTab)}
          className="w-full px-4 py-3 bg-white border-2 border-slate-300 rounded-lg text-slate-900 font-medium focus:outline-none focus:border-blue-500 shadow-sm"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label} {tab.badge ? `(${tab.badge})` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="hidden md:flex gap-2 mb-8 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const color = tab.color || 'blue';
          const activeColor = color === 'amber' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white';
          const hoverColor = color === 'amber' ? 'hover:border-amber-600' : 'hover:border-blue-600';

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors relative ${
                isActive
                  ? activeColor
                  : `bg-white text-slate-700 border border-slate-300 ${hoverColor}`
              }`}
            >
              {tab.label}
              {tab.badge && tab.badge > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
