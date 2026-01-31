import { formatOrderId } from '../../lib/utils';

interface ApprovalSuccessViewProps {
  orderId: string;
}

export function ApprovalSuccessView({ orderId }: ApprovalSuccessViewProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-2xl w-full bg-white rounded-xl shadow-2xl overflow-hidden border-4 border-green-500">
        <div className="bg-white px-8 py-6 text-center border-b-4 border-green-500">
          <img
            src="/bounce party club logo.png"
            alt="Bounce Party Club"
            className="h-20 w-auto mx-auto mb-4"
          />
          <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-12 h-12 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-green-900">Approval Received!</h1>
        </div>

        <div className="px-8 py-8 text-center">
          <p className="text-lg text-slate-700 mb-6">
            Thank you for approving the changes to your order{' '}
            <strong>#{formatOrderId(orderId)}</strong>.
          </p>

          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
            <h3 className="font-bold text-blue-900 mb-2">What happens next?</h3>
            <ul className="text-left text-blue-800 space-y-2 text-sm">
              <li>
                • Our team will review your approval and finalize the booking details
              </li>
              <li>• You'll receive a confirmation once everything is ready</li>
              <li>
                • We'll send you instructions for signing the waiver and payment
              </li>
              <li>• Contact us at (313) 889-3860 if you have any questions</li>
            </ul>
          </div>

          <p className="text-slate-600">
            You can safely close this window. We'll be in touch soon!
          </p>
        </div>
      </div>
    </div>
  );
}
