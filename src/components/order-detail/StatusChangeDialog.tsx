import { X } from 'lucide-react';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { checkMultipleUnitsAvailability } from '../../lib/availability';
import { showToast } from '../../lib/notifications';
import { validateStatusTransition } from '../../lib/orderStateMachine';

interface StatusChangeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  currentStatus: string;
  pendingStatus: string;
  stagedItems: Array<{
    id?: string;
    unit_id: string;
    unit_name: string;
    qty: number;
    wet_or_dry: 'dry' | 'water';
    is_deleted?: boolean;
  }>;
  eventDate: string;
  eventEndDate: string;
  onStatusChanged: () => void;
}

export function StatusChangeDialog({
  isOpen,
  onClose,
  orderId,
  pendingStatus,
  stagedItems,
  eventDate,
  eventEndDate,
  onStatusChanged
}: StatusChangeDialogProps) {
  const [statusChangeReason, setStatusChangeReason] = useState('');
  const [isChanging, setIsChanging] = useState(false);

  if (!isOpen) return null;

  async function handleConfirm() {
    if (!statusChangeReason.trim()) {
      showToast('Please provide a reason for the status change', 'error');
      return;
    }

    setIsChanging(true);
    try {
      const { data: currentOrder } = await supabase
        .from('orders')
        .select('stripe_payment_method_id, payment_amount_due')
        .eq('id', orderId)
        .single();

      const validation = validateStatusTransition(currentStatus, pendingStatus, currentOrder);
      if (!validation.valid) {
        showToast(validation.reason || 'Invalid status transition', 'error');
        setIsChanging(false);
        return;
      }

      if (pendingStatus === 'confirmed') {
        const activeItems = stagedItems.filter(item => !item.is_deleted);
        const checks = activeItems.map(item => ({
          unitId: item.unit_id,
          wetOrDry: item.wet_or_dry,
          quantity: item.qty,
          eventStartDate: eventDate,
          eventEndDate: eventEndDate,
          excludeOrderId: orderId,
        }));

        const availabilityResults = await checkMultipleUnitsAvailability(checks);
        const conflicts = availabilityResults.filter(result => !result.isAvailable);

        if (conflicts.length > 0) {
          const conflictList = conflicts
            .map(c => {
              const item = activeItems.find(i => i.unit_id === c.unitId);
              return item?.unit_name || 'Unknown unit';
            })
            .join(', ');

          showToast(
            `Cannot confirm order: The following equipment is not available for the selected dates: ${conflictList}. ` +
            'Please adjust the order dates or equipment before confirming.',
            'error'
          );
          setIsChanging(false);
          return;
        }
      }

      // Update order status
      const { error: updateError } = await supabase.from('orders').update({ status: pendingStatus }).eq('id', orderId);
      if (updateError) {
        throw updateError;
      }

      // Add changelog entry
      const { error: changelogError } = await supabase.from('order_changelog').insert({
        order_id: orderId,
        change_type: 'status_change',
        field_name: 'status',
        old_value: null,
        new_value: pendingStatus,
        changed_by: (await supabase.auth.getUser()).data.user?.id,
        reason: statusChangeReason,
      });

      if (changelogError) throw changelogError;

      showToast('Status updated successfully!', 'success');
      setStatusChangeReason('');
      onClose();
      onStatusChanged();
    } catch (error) {
      console.error('Error updating status:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      showToast(`Failed to update status: ${errorMessage}`, 'error');
    } finally {
      setIsChanging(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Confirm Status Change</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">
          You are about to change the status to <strong>{pendingStatus}</strong>.
          Please provide a reason for this change:
        </p>

        <textarea
          value={statusChangeReason}
          onChange={(e) => setStatusChangeReason(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg mb-4"
          rows={3}
          placeholder="Enter reason for status change..."
          disabled={isChanging}
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
            disabled={isChanging}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            disabled={isChanging}
          >
            {isChanging ? 'Updating...' : 'Confirm Change'}
          </button>
        </div>
      </div>
    </div>
  );
}
