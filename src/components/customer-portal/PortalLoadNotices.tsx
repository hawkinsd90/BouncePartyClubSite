import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';

// Shown when the order could not be loaded at all and nothing is on screen (offline, server trouble). This is NOT "Order Not
// Found": the order may be perfectly fine, so the customer is offered a retry.
export function PortalLoadError({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="text-center bg-white rounded-2xl shadow-2xl p-10 max-w-md border-2 border-slate-100" role="alert">
        <div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <AlertCircle className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-3 tracking-tight">We couldn't load your order</h1>
        <p className="text-slate-600 mb-6">Check your connection and try again. Your order has not been changed.</p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors min-h-[48px]"
        >
          <RefreshCw className="w-5 h-5" />
          Try again
        </button>
        <p className="text-slate-500 text-sm font-semibold mt-6">(313) 889-3860</p>
      </div>
    </div>
  );
}

// A small notice over a screen that is already loaded: the last background refresh failed, so what is shown may be out of date.
export function PortalRefreshNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="fixed top-0 inset-x-0 z-40 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-center gap-3 text-sm text-amber-900" role="status">
      <WifiOff className="w-4 h-4 flex-shrink-0" />
      <span>We couldn't refresh your order. What you see may be out of date.</span>
      <button type="button" onClick={onRetry} className="font-semibold underline min-h-[32px]">
        Retry
      </button>
    </div>
  );
}
