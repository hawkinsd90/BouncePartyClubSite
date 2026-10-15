// Confirmation dialogs shown when the admin adds a legacy Generator to an order
// that has no Event Essentials Generator available. Presentational: the parent
// owns the pending state and the ownership-checked callbacks.

import { SimpleConfirmModal } from '../../../common/SimpleConfirmModal';

interface GeneratorLegacyConfirmDialogsProps {
  pending: { additionalQty: number; isWaived: boolean } | null;
  onConfirm: () => void;
  onRemoveWaiver: () => void;
  onCancel: () => void;
}

export function GeneratorLegacyConfirmDialogs({
  pending,
  onConfirm,
  onRemoveWaiver,
  onCancel,
}: GeneratorLegacyConfirmDialogsProps) {
  return (
    <>
      {pending && !pending.isWaived && (
        <SimpleConfirmModal
          isOpen={true}
          onClose={onCancel}
          onConfirm={onConfirm}
          title="Add Legacy Generator"
          message={`No Event Essentials Generator is available for this order. ${pending.additionalQty === 1 ? '1 additional legacy Generator will be added' : `${pending.additionalQty} additional legacy Generators will be added`}, and the aggregate legacy Generator fee will be recalculated using the current pricing rules.`}
          confirmText="Add Generator"
          cancelText="Cancel"
          variant="info"
        />
      )}

      {pending && pending.isWaived && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full border-2 border-orange-600">
            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-900">Generator Fee Waiver</h2>
            </div>
            <div className="p-6">
              <p className="text-slate-700 mb-6">
                No Event Essentials Generator is available. The existing Generator fee is currently waived. {pending.additionalQty === 1 ? '1 additional legacy Generator will be added' : `${pending.additionalQty} additional legacy Generators will be added`}. Adding a legacy Generator requires an explicit choice about the waiver.
              </p>
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={onConfirm}
                  className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors"
                >
                  Keep Generator Fee Waived
                </button>
                <button
                  type="button"
                  onClick={onRemoveWaiver}
                  className="w-full px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
                >
                  Remove Generator Fee Waiver
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
