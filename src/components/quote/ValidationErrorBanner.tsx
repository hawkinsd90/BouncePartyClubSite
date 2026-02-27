import { AlertCircle, X } from 'lucide-react';

interface ValidationErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ValidationErrorBanner({ message, onDismiss }: ValidationErrorBannerProps) {
  return (
    <div
      className="mb-6 w-full mt-4"
      role="alert"
      aria-live="assertive"
      style={{ scrollMarginTop: '100px' }}
    >
      <div className="bg-red-50 border-4 border-red-500 rounded-xl shadow-2xl p-4 sm:p-5 flex items-start gap-3 animate-shake">
        <AlertCircle className="w-6 h-6 sm:w-7 sm:h-7 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-base sm:text-lg font-bold text-red-900 break-words leading-snug">{message}</p>
          <p className="text-xs sm:text-sm text-red-700 mt-2">Please fix this error to continue.</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg p-2 transition-colors flex-shrink-0"
          aria-label="Dismiss error"
        >
          <X className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      </div>
    </div>
  );
}
