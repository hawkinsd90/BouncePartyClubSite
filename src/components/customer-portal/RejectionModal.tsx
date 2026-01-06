import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';

interface RejectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onSuccess: () => void;
}

export function RejectionModal({ isOpen, onClose, order, onSuccess }: RejectionModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
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
        .update({ status: 'voided' })
        .eq('id', order.id);

      if (updateError) throw updateError;

      const { error: logError } = await supabase.from('order_changelog').insert({
        order_id: order.id,
        change_type: 'status_change',
        field_changed: 'status',
        old_value: order.status,
        new_value: 'voided',
        reason: reason ? `Customer rejected changes: ${reason}` : 'Customer rejected order changes via portal',
      });

      if (logError) console.error('Error logging rejection:', logError);

      showToast('Order has been cancelled.', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error rejecting order:', error);
      showToast('Failed to reject order. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-bold text-red-900 mb-3">Reject Changes & Cancel Order</h3>
          <p className="text-sm md:text-base text-slate-700 mb-4">
            Are you sure you want to reject these changes? This will cancel your order.
          </p>
          <p className="text-sm text-slate-600 mb-4">
            If you have questions, please call us at{' '}
            <a href="tel:+13138893860" className="text-blue-600 font-semibold">
              (313) 889-3860
            </a>{' '}
            instead.
          </p>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              To confirm, enter your full name: <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={`${order.customers?.first_name || 'Unknown'} ${order.customers?.last_name || ''}`}
              className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-red-500 text-sm md:text-base"
            />
            <p className="text-xs text-slate-500 mt-1">
              Must match: {order.customers?.first_name || 'Unknown'} {order.customers?.last_name || ''}
            </p>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Reason for rejection (optional):
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Let us know why you're rejecting these changes..."
              rows={3}
              className="w-full px-3 py-2 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-red-500 resize-none text-sm md:text-base"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                setConfirmName('');
                setReason('');
                onClose();
              }}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!confirmName.trim() || submitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed text-white font-bold py-2.5 md:py-3 px-4 rounded-lg transition-colors text-sm md:text-base"
            >
              {submitting ? 'Processing...' : 'Confirm Rejection'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
