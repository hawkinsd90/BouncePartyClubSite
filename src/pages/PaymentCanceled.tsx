import { useNavigate, useSearchParams } from 'react-router-dom';
import { XCircle } from 'lucide-react';

export function PaymentCanceled() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');

  const handleRetry = () => {
    if (orderId) {
      navigate(`/checkout/${orderId}`);
    } else {
      navigate('/quote');
    }
  };


  const handleCancel = () => {
    navigate('/quote');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-md">
        <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Canceled</h1>
        <p className="text-gray-600 mb-6">
          You canceled the payment process. Your order has not been completed.
        </p>
        {orderId && (
          <p className="text-sm text-gray-500 mb-6">
            Order ID: {orderId.slice(0, 8).toUpperCase()}
          </p>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleCancel}
            className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium transition-colors"
          >
            Back to Cart
          </button>
          <button
            onClick={handleRetry}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}
