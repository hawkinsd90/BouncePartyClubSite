import { useState } from 'react';
import { MODAL_PANEL_SCROLL } from '../../../../lib/core/modalClasses';

interface Props {
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel?: string;
  minLength?: number;
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}

// A reason typed in the app (replaces window.prompt, which is blocked or unusable in some phone browsers and cannot be styled or validated).
export function ReasonModal({ title, description, placeholder, confirmLabel = 'Continue', minLength = 3, busy = false, onSubmit, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < minLength;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[10001] flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-lg shadow-2xl max-w-md w-full p-6 ${MODAL_PANEL_SCROLL}`}>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        {description && <p className="text-sm text-slate-600 mt-1 mb-3 whitespace-pre-line">{description}</p>}
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="reason-modal-input">Reason (required)</label>
        <textarea
          id="reason-modal-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={3}
          placeholder={placeholder}
          className={`w-full px-3 py-2 border rounded-lg text-sm ${touched && tooShort ? 'border-red-500' : 'border-slate-300'}`}
        />
        {touched && tooShort && <p className="text-xs text-red-600 mt-1">Please give a reason ({minLength}+ characters).</p>}
        <div className="flex gap-3 mt-5">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-3 rounded-lg min-h-[48px]">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { setTouched(true); if (!tooShort) onSubmit(reason.trim()); }}
            disabled={busy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 rounded-lg min-h-[48px]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
