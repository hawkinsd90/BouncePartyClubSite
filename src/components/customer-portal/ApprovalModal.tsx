import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onSuccess: () => void;
}

export function ApprovalModal({ isOpen, onClose, order, onSuccess }: ApprovalModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  async function handleConfirm() {
    const expectedName = `${order.customers?.first_name || ''} ${order.customers?.last_name || ''}`.trim().toLowerCase();
    const enteredName = confirmName.trim().toLowerCase();

    if (enteredName !== expectedName) {
      showToast('Name does not match. Please enter your full name exactly as shown.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'confirmed' })
        .eq('id', order.id);

      if (updateError) throw updateError;

      const { error: logError } = await supabase.from('order_changelog').insert({
        order_id: order.id,
        change_type: 'status_change',
        field_name: 'status',
        old_value: order.status,
        new_value: 'confirmed',
        notes: 'Customer approved order changes via portal',
      });

      if (logError) console.error('Error logging approval:', logError);

      showToast('Order approved successfully!', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error approving order:', error);
      showToast('Failed to approve order. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-bold text-green-900 mb-3">Approve Order Changes</h3>
          <p className="text-sm md:text-base text-slate-700 mb-4">
            By approving these changes, you confirm that you have reviewed and accept the updated order details.
          </p>

          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              To confirm, enter your full name: <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={`${order.customers?.first_name || 'Unknown'} ${order.customers?.last_name || ''}`}
              className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-green-500 text-sm md:text-base"
            />
            <p className="text-xs text-slate-500 mt-1">
              Must match: {order.customers?.first_name || 'Unknown'} {order.customers?.last_name || ''}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                setConfirmName('');
                onClose();
              }}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!confirmName.trim() || submitting}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-bold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
            >
              {submitting ? 'Processing...' : 'Confirm Approval'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
