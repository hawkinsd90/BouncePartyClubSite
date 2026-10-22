// Sticky header for the Order Detail modal: order title, customer and date, the
// Skip Customer Approval toggle, the Save button and the close button.
// Presentational: the parent owns all state, the save gating inputs and callbacks.

import { X, Save } from 'lucide-react';
import { format } from 'date-fns';
import { formatOrderId } from '../../../../lib/utils';
import { ORDER_STATUS } from '../../../../lib/constants/statuses';

// Only the order fields the header reads.
interface OrderDetailHeaderOrder {
  id: string;
  status?: string;
  event_date: string;
  customers?: { first_name?: string | null; last_name?: string | null } | null;
}

interface OrderDetailHeaderProps {
  order: OrderDetailHeaderOrder;
  hasChanges: boolean;
  adminOverrideApproval: boolean;
  onAdminOverrideApprovalChange: (checked: boolean) => void;
  saving: boolean;
  pricingPending: boolean;
  pricingIsCurrent: boolean;
  generatorResolutionPending: boolean;
  generatorConfirmOpen: boolean;
  onSave: () => void;
  onClose: () => void;
}

// Why Save is switched off, for the tooltip and screen readers (the button used to just go grey).
function saveBlockedReason(saving: boolean, pricingIsCurrent: boolean, generatorResolutionPending: boolean, generatorConfirmOpen: boolean): string | null {
  if (saving) return 'Saving...';
  if (!pricingIsCurrent) return 'Waiting for the price to finish calculating';
  if (generatorResolutionPending || generatorConfirmOpen) return 'Answer the generator question first';
  return null;
}

export function OrderDetailHeader({
  order,
  hasChanges,
  adminOverrideApproval,
  onAdminOverrideApprovalChange,
  saving,
  pricingPending,
  pricingIsCurrent,
  generatorResolutionPending,
  generatorConfirmOpen,
  onSave,
  onClose,
}: OrderDetailHeaderProps) {
  return (
    <div className="sticky top-0 bg-white border-b border-slate-200 px-3 md:px-6 py-3 md:py-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 md:rounded-t-lg z-10">
      <div className="flex-1 min-w-0">
        <h2 className="text-lg md:text-2xl font-bold text-slate-900 truncate">
          Order #{formatOrderId(order.id)}
        </h2>
        <p className="text-xs md:text-sm text-slate-600 truncate">
          {order.customers?.first_name} {order.customers?.last_name} • {format(new Date(order.event_date + 'T12:00:00'), 'MMM d, yyyy')}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1 md:gap-2 shrink-0 max-w-full">
        {hasChanges && (
          <>
            {order.status !== ORDER_STATUS.DRAFT && (
              <label className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-900 px-2 md:px-3 py-1.5 md:py-2 min-h-[44px] rounded-lg text-xs md:text-sm font-medium cursor-pointer hover:bg-amber-100">
                <input
                  type="checkbox"
                  checked={adminOverrideApproval}
                  onChange={(e) => onAdminOverrideApprovalChange(e.target.checked)}
                  className="w-3.5 h-3.5 md:w-4 md:h-4"
                />
                <span className="hidden lg:inline">Skip Customer Approval</span>
                <span className="lg:hidden">Skip Approval</span>
              </label>
            )}
            <button
              onClick={onSave}
              disabled={saving || !pricingIsCurrent || generatorResolutionPending || generatorConfirmOpen}
              title={saveBlockedReason(saving, pricingIsCurrent, generatorResolutionPending, generatorConfirmOpen) ?? undefined}
              className="flex items-center gap-1 md:gap-2 bg-green-600 hover:bg-green-700 text-white px-3 md:px-4 py-1.5 md:py-2 min-h-[44px] rounded-lg text-sm md:text-base font-medium disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 md:w-4 md:h-4" />
              <span className="hidden sm:inline">{saving ? 'Saving...' : pricingPending ? 'Calculating...' : generatorResolutionPending ? 'Resolving...' : 'Save Changes'}</span>
              <span className="sm:hidden">{saving ? 'Saving' : pricingPending ? 'Pricing' : generatorResolutionPending ? 'Wait' : 'Save'}</span>
            </button>
          </>
        )}
        <button
          onClick={onClose}
          aria-label="Close order"
          className="text-slate-400 hover:text-slate-600 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <X className="w-5 h-5 md:w-6 md:h-6" />
        </button>
      </div>
    </div>
  );
}
