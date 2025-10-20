import { useEffect } from 'react';

export function PaymentSuccess() {
  useEffect(() => {
    // Close this popup window after a short delay
    setTimeout(() => {
      window.close();
    }, 500);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-6xl mb-4">✓</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h1>
        <p className="text-gray-600">This window will close automatically...</p>
      </div>
    </div>
  );
}
