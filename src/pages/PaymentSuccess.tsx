import { useEffect } from 'react';

export function PaymentSuccess() {
  useEffect(() => {
    // Try to close the window immediately
    // This works if the window was opened via window.open()
    try {
      if (window.opener) {
        // Notify parent window if possible
        window.opener.postMessage({ type: 'PAYMENT_SUCCESS' }, '*');
      }

      setTimeout(() => {
        window.close();

        // If window.close() doesn't work (e.g., not opened by script),
        // try to navigate back or show a message
        setTimeout(() => {
          // If we're still here, the window didn't close
          // Redirect to home or show a button
          if (window.opener) {
            window.opener.focus();
          }
        }, 500);
      }, 500);
    } catch (e) {
      console.error('Error closing window:', e);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-6xl mb-4">✓</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Complete!</h1>
        <p className="text-gray-600 mb-4">This window will close automatically...</p>
        <button
          onClick={() => window.close()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Close Window
        </button>
      </div>
    </div>
  );
}
