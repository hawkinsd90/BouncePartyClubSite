import { useNavigate, useSearchParams } from 'react-router-dom';
import { XCircle } from 'lucide-react';

export function PaymentCanceled() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');

  const handleRetry = () => {
    navigate('/checkout');
  };

  const handleCancel = () => {
    navigate('/quote');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-10 text-center max-w-md border-2 border-slate-100">
        <div className="flex justify-center mb-6">
          <img
            src="/bounce party club logo.png"
            alt="Bounce Party Club"
            className="h-24 w-auto"
          />
        </div>
        <div className="w-20 h-20 bg-gradient-to-br from-red-400 to-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <XCircle className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-3 tracking-tight">Payment Canceled</h1>
        <p className="text-gray-600 mb-6">
          You canceled the payment process. Your order has not been completed.
        </p>
        {orderId && (
          <p className="text-sm text-gray-500 mb-6">
            Order ID: {orderId.slice(0, 8).toUpperCase()}
          </p>
        )}
        <div className="flex gap-4 justify-center">
          <button
            onClick={handleCancel}
            className="px-8 py-3 bg-slate-200 text-slate-700 rounded-xl hover:bg-slate-300 font-bold transition-all shadow-md"
          >
            Back to Cart
          </button>
          <button
            onClick={handleRetry}
            className="px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-bold transition-all shadow-lg hover:shadow-xl"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}
