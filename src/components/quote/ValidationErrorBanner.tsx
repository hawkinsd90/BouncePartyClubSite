import { AlertCircle, X } from 'lucide-react';

interface ValidationErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ValidationErrorBanner({ message, onDismiss }: ValidationErrorBannerProps) {
  return (
    <div
      className="fixed top-20 left-1/2 -translate-x-1/2 z-[9998] w-[calc(100%-2rem)] max-w-2xl"
      style={{
        position: 'fixed',
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9998,
      }}
      role="alert"
      aria-live="assertive"
    >
      <div className="bg-red-50 border-4 border-red-500 rounded-xl shadow-2xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
        <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm sm:text-base font-bold text-red-900 break-words">{message}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-red-600 hover:text-red-800 hover:bg-red-100 rounded-lg p-1.5 transition-colors flex-shrink-0"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>
    </div>
  );
}
