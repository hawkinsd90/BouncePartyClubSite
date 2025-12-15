export function PaymentLoadingState() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-8">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          Finalizing your booking…
        </h1>
        <p className="text-slate-600 text-sm">
          We're confirming your card details and saving your booking request. This only takes a moment.
        </p>
      </div>
    </div>
  );
}
