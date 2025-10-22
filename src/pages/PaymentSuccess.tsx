import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { CheckCircle, Loader2 } from 'lucide-react';

interface OrderDetails {
  id: string;
  event_date: string;
  deposit_amount: number;
  total_price: number;
  customer_email: string;
  customer_name: string;
}

export function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [processing, setProcessing] = useState(true);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);

  useEffect(() => {
    const orderIdFromUrl = searchParams.get('orderId');

    if (!orderIdFromUrl) {
      console.error('Missing orderId');
      setProcessing(false);
      return;
    }

    const fetchOrderDetails = async () => {
      try {
        const { data: order, error } = await supabase
          .from('orders')
          .select('id, event_date, deposit_amount, total_price, customer_email, customer_name')
          .eq('id', orderIdFromUrl)
          .maybeSingle();

        if (error) throw error;

        if (order) {
          setOrderDetails(order);
        }
      } catch (error) {
        console.error('Error fetching order details:', error);
      } finally {
        setProcessing(false);
      }
    };

    fetchOrderDetails();
  }, [searchParams]);

  const handleContinue = () => {
    localStorage.removeItem('bpc_cart');
    localStorage.removeItem('bpc_quote_form');
    localStorage.removeItem('bpc_price_breakdown');
    navigate('/');
  };

  if (processing) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!orderDetails) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600">Unable to load order details.</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  const eventDate = new Date(orderDetails.event_date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const balanceDue = orderDetails.total_price - orderDetails.deposit_amount;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="bg-white text-center max-w-lg w-full py-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500 mb-6 animate-[scale-in_0.3s_ease-out]">
          <CheckCircle className="w-12 h-12 text-white" strokeWidth={2.5} />
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-4">Payment Successful!</h1>

        <p className="text-gray-700 text-base mb-6 leading-relaxed px-4">
          Thank you for choosing Bounce Party Club. Your deposit has been paid and your booking is now pending admin review for final confirmation.
        </p>

        <div className="bg-gray-50 rounded-lg p-6 mb-6 text-left">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500 mb-1">Order ID:</p>
              <p className="font-semibold text-gray-900">{orderDetails.id.slice(0, 8).toUpperCase()}</p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Event Date:</p>
              <p className="font-semibold text-gray-900">{eventDate}</p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Deposit Paid:</p>
              <p className="font-semibold text-green-600">${orderDetails.deposit_amount.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Balance Due:</p>
              <p className="font-semibold text-gray-900">${balanceDue.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <p className="text-gray-600 text-sm mb-4 px-4">
          A confirmation email has been sent to <span className="font-medium text-gray-900">{orderDetails.customer_email}</span>.
        </p>

        <p className="text-gray-600 text-sm mb-6 px-4">
          Our admin team will review your booking request and contact you within 24 hours to confirm your delivery time window and finalize your reservation details.
        </p>

        <div className="border-t border-gray-200 pt-6 mb-6">
          <p className="text-lg font-semibold text-gray-900 mb-2">Thank You!</p>
          <p className="text-gray-600 text-sm px-4">
            Thank you for choosing Bounce Party Club to bring energy and excitement to your event! We can't wait to help make your celebration unforgettable.
          </p>
          <p className="text-gray-600 text-sm mt-2 px-4">
            If you have any questions, contact us at <span className="font-medium">(313) 889-3860</span> or visit us at <span className="font-medium">4426 Woodland St, Wayne, MI 48184</span>.
          </p>
        </div>

        <button
          onClick={handleContinue}
          className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors text-base"
        >
          Return to Home
        </button>
      </div>
    </div>
  );
}
