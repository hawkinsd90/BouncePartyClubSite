import { X, ChevronUp, ChevronDown, RefreshCw, ExternalLink, ArrowLeft } from 'lucide-react';

interface Props {
  isDropOff: boolean;
  currentStatus: string;
  statusColor: string;
  orderNumber: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  stopNumber: number;
  activeStopsCount: number;
  refreshing: boolean;
  lastUpdated: Date;
  onBack?: () => void;
  onClose: () => void;
  // The admin order screen is Admin/Master only; crew sees the order number as plain text.
  canOpenOrder?: boolean;
  onOpenOrder: () => void;
  onReorder: (direction: 'up' | 'down') => void;
  onRefreshClick: () => void;
}

export function TaskDetailHeader({
  isDropOff, currentStatus, statusColor, orderNumber, canMoveUp, canMoveDown, stopNumber, activeStopsCount,
  refreshing, lastUpdated, onBack, onClose, canOpenOrder = true, onOpenOrder, onReorder, onRefreshClick,
}: Props) {
  return (
    <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium text-sm mb-3 -ml-1 px-1 py-1 hover:bg-blue-50 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to day view</span>
        </button>
      )}
      <div className="flex justify-between items-start">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900">
              {isDropOff ? 'Delivery' : 'Pickup'}
            </h2>
            <span className={`text-xs px-2 py-1 rounded-full font-semibold ${statusColor}`}>
              {currentStatus.toUpperCase()}
            </span>
          </div>
          {canOpenOrder ? (
            <button onClick={onOpenOrder} className="text-sm text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1">
              Order #{orderNumber}
              <ExternalLink className="w-3 h-3" />
            </button>
          ) : (
            <span className="text-sm text-slate-600">Order #{orderNumber}</span>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <div className="flex gap-2">
              <button onClick={() => onReorder('up')} disabled={!canMoveUp} className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed" title="Move up in route"><ChevronUp className="w-4 h-4" /></button>
              <button onClick={() => onReorder('down')} disabled={!canMoveDown} className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 disabled:cursor-not-allowed" title="Move down in route"><ChevronDown className="w-4 h-4" /></button>
            </div>
            {stopNumber > 0 && (
              <span className="text-xs text-slate-500">Stop #{stopNumber} of {activeStopsCount}</span>
            )}
            <button onClick={onRefreshClick} disabled={refreshing} className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : `Updated ${Math.floor((Date.now() - lastUpdated.getTime()) / 1000)}s ago`}</span>
            </button>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"><X className="w-6 h-6" /></button>
      </div>
    </div>
  );
}
