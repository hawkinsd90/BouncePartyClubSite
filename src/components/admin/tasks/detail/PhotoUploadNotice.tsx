import type { UploadNotice } from '../../../../lib/tasks/taskProgress';

interface Props {
  notice: UploadNotice | null;
  onRetry: () => void;
  onDismiss: () => void;
}

const TONES: Record<UploadNotice['tone'], string> = {
  success: 'bg-green-50 border-green-300 text-green-900',
  warning: 'bg-amber-50 border-amber-300 text-amber-900',
  error: 'bg-red-50 border-red-300 text-red-900',
};

// The result of the last photo upload, kept on screen until dismissed. A failed batch offers a one-tap retry with the same photos.
export function PhotoUploadNotice({ notice, onRetry, onDismiss }: Props) {
  if (!notice) return null;
  return (
    <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`border rounded-lg px-3 py-2 mx-4 mb-2 text-sm ${TONES[notice.tone]}`}>
      <p className="whitespace-pre-line break-words">{notice.message}</p>
      <div className="flex flex-wrap gap-2 mt-2">
        {notice.retryCount > 0 && (
          <button type="button" onClick={onRetry} className="min-h-[44px] px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold">
            Try again ({notice.retryCount} photo{notice.retryCount === 1 ? '' : 's'})
          </button>
        )}
        <button type="button" onClick={onDismiss} className="min-h-[44px] px-4 rounded-lg border border-current font-semibold">Dismiss</button>
      </div>
    </div>
  );
}
