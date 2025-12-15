import { useState } from 'react';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { validateCustomerName, getFullName } from '../../lib/utils';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: string) => Promise<void>;
  action: 'approve' | 'reject';
  title: string;
  description: string;
  customer: { first_name?: string; last_name?: string } | null;
  requireNameConfirmation?: boolean;
  requireReason?: boolean;
  confirmButtonText?: string;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  action,
  title,
  description,
  customer,
  requireNameConfirmation = true,
  requireReason = false,
  confirmButtonText,
}: ConfirmationModalProps) {
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const isApprove = action === 'approve';
  const Icon = isApprove ? CheckCircle : AlertCircle;
  const iconColor = isApprove ? 'text-green-600' : 'text-red-600';
  const borderColor = isApprove ? 'border-green-600' : 'border-red-600';
  const buttonColor = isApprove
    ? 'bg-green-600 hover:bg-green-700'
    : 'bg-red-600 hover:bg-red-700';

  const customerFullName = getFullName(customer);

  const isValid = () => {
    if (requireNameConfirmation && !validateCustomerName(confirmName, customer)) {
      return false;
    }
    if (requireReason && !reason.trim()) {
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid()) return;

    setSubmitting(true);
    try {
      await onConfirm(requireReason ? reason : undefined);
      setConfirmName('');
      setReason('');
      onClose();
    } catch (error) {
      console.error(`Error during ${action}:`, error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className={`bg-white rounded-xl shadow-xl max-w-md w-full border-2 ${borderColor}`}>
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <Icon className={`w-6 h-6 ${iconColor}`} />
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            disabled={submitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-slate-700">{description}</p>

          {requireReason && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Reason {requireReason && '*'}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={4}
                placeholder="Enter reason..."
                required={requireReason}
                disabled={submitting}
              />
            </div>
          )}

          {requireNameConfirmation && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Type "{customerFullName}" to confirm *
              </label>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={customerFullName}
                required
                disabled={submitting}
              />
            </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`flex-1 px-4 py-2 rounded-lg text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonColor}`}
              disabled={!isValid() || submitting}
            >
              {submitting ? 'Processing...' : confirmButtonText || `Confirm ${action}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
