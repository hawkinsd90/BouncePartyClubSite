import { Calendar, Clock, CheckCircle } from 'lucide-react';

interface DashboardTabsProps {
  activeTab: 'active' | 'upcoming' | 'past';
  activeOrdersCount: number;
  upcomingOrdersCount: number;
  pastOrdersCount: number;
  onTabChange: (tab: 'active' | 'upcoming' | 'past') => void;
}

export function DashboardTabs({
  activeTab,
  activeOrdersCount,
  upcomingOrdersCount,
  pastOrdersCount,
  onTabChange,
}: DashboardTabsProps) {
  return (
    <div className="border-b border-gray-200 mb-6 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto">
      <nav className="-mb-px flex gap-4 sm:gap-8 min-w-min" aria-label="Tabs">
        <button
          onClick={() => onTabChange('active')}
          className={`
            whitespace-nowrap py-3 md:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-colors
            ${activeTab === 'active'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }
          `}
        >
          <Clock className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
          <span className="hidden sm:inline">Active Orders</span>
          <span className="sm:hidden">Active</span>
          {activeOrdersCount > 0 && (
            <span className={`
              ml-1 sm:ml-2 py-0.5 px-1.5 sm:px-2 rounded-full text-xs font-medium flex-shrink-0
              ${activeTab === 'active' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
            `}>
              {activeOrdersCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onTabChange('upcoming')}
          className={`
            whitespace-nowrap py-3 md:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-colors
            ${activeTab === 'upcoming'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }
          `}
        >
          <Calendar className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
          <span className="hidden sm:inline">Upcoming Orders</span>
          <span className="sm:hidden">Upcoming</span>
          {upcomingOrdersCount > 0 && (
            <span className={`
              ml-1 sm:ml-2 py-0.5 px-1.5 sm:px-2 rounded-full text-xs font-medium flex-shrink-0
              ${activeTab === 'upcoming' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
            `}>
              {upcomingOrdersCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onTabChange('past')}
          className={`
            whitespace-nowrap py-3 md:py-4 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-colors
            ${activeTab === 'past'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }
          `}
        >
          <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
          <span className="hidden sm:inline">Past Orders</span>
          <span className="sm:hidden">Past</span>
          {pastOrdersCount > 0 && (
            <span className={`
              ml-1 sm:ml-2 py-0.5 px-1.5 sm:px-2 rounded-full text-xs font-medium flex-shrink-0
              ${activeTab === 'past' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
            `}>
              {pastOrdersCount}
            </span>
          )}
        </button>
      </nav>
    </div>
  );
}
