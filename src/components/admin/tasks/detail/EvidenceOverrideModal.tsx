import { useState } from 'react';
import { MODAL_PANEL_SCROLL } from '../../../../lib/core/modalClasses';
import { ShieldAlert } from 'lucide-react';
import { MIN_OVERRIDE_REASON, overrideReasonProblem } from '../../../../lib/tasks/evidenceRule';

interface Props {
  kind: 'delivery' | 'pickup';
  busy?: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}

// Admin/Master only (the caller shows it only to them; the database refuses anyone else). Asks for the reason that is recorded with the override.
export function EvidenceOverrideModal({ kind, busy = false, onSubmit, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const problem = overrideReasonProblem(reason);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[10001] flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Complete without a photo" className={`bg-white rounded-lg shadow-2xl max-w-md w-full p-6 ${MODAL_PANEL_SCROLL}`}>
        <div className="flex items-start gap-3 mb-4">
          <ShieldAlert className="w-7 h-7 text-amber-600 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Complete without a {kind} photo?</h3>
            <p className="text-sm text-slate-600 mt-1">
              No photo has been taken. As an Admin you can release this task anyway. Your name, the time and your reason are recorded.
            </p>
          </div>
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="evidence-override-reason">Reason (required)</label>
        <textarea
          id="evidence-override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          rows={3}
          className={`w-full px-3 py-2 border rounded-lg text-sm ${touched && problem ? 'border-red-500' : 'border-slate-300'}`}
          placeholder="e.g. Customer asked us not to photograph the yard"
        />
        {touched && problem && <p className="text-xs text-red-600 mt-1">{problem}</p>}
        <p className="text-xs text-slate-500 mt-1">At least {MIN_OVERRIDE_REASON} characters.</p>
        <div className="flex gap-3 mt-5">
          <button type="button" onClick={onCancel} disabled={busy} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold py-3 rounded-lg min-h-[48px]">
            Go back
          </button>
          <button
            type="button"
            onClick={() => { setTouched(true); if (!problem) onSubmit(reason.trim()); }}
            disabled={busy}
            className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white font-semibold py-3 rounded-lg min-h-[48px]"
          >
            {busy ? 'Recording...' : 'Override and continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
