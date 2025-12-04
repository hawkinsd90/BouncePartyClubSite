import { formatCurrency } from '../lib/pricing';
import { format } from 'date-fns';

interface PrintableInvoiceProps {
  quoteData: any;
  priceBreakdown: any;
  cart: any[];
  contactData: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    business_name?: string;
  };
  invoiceNumber?: string;
  isPaid?: boolean;
}

export function PrintableInvoice({
  quoteData,
  priceBreakdown,
  cart,
  contactData,
  invoiceNumber,
  isPaid = false,
}: PrintableInvoiceProps) {
  const today = format(new Date(), 'MMMM d, yyyy');

  return (
    <div className="bg-white p-8 max-w-4xl mx-auto" id="printable-invoice">
      <style>
        {`
          @media print {
            body * {
              visibility: hidden;
            }
            #printable-invoice, #printable-invoice * {
              visibility: visible;
            }
            #printable-invoice {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .no-print {
              display: none !important;
            }
          }
        `}
      </style>

      <div className="border-4 border-blue-600 p-8">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-4xl font-bold text-blue-600 mb-2">
              BOUNCE PARTY CLUB
            </h1>
            <p className="text-slate-600">Wayne, Michigan</p>
            <p className="text-slate-600">Phone: (313) 555-0100</p>
            <p className="text-slate-600">Email: info@bouncepartyclub.com</p>
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-bold text-slate-900 mb-2">
              {isPaid ? 'RECEIPT' : 'INVOICE'}
            </h2>
            {invoiceNumber && (
              <p className="text-slate-600 font-mono">#{invoiceNumber}</p>
            )}
            <p className="text-slate-600">{today}</p>
            {isPaid && (
              <span className="inline-block mt-2 bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
                PAID
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-2 uppercase tracking-wider">
              Bill To:
            </h3>
            <div className="text-slate-700">
              {contactData.business_name && (
                <p className="font-bold text-base">
                  {contactData.business_name}
                </p>
              )}
              <p className="font-semibold">
                {contactData.first_name} {contactData.last_name}
              </p>
              <p>{contactData.email}</p>
              <p>{contactData.phone}</p>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-2 uppercase tracking-wider">
              Event Details:
            </h3>
            <div className="text-slate-700">
              <p>
                <span className="font-semibold">Date:</span> {quoteData.event_date}
              </p>
              <p>
                <span className="font-semibold">Time:</span> {quoteData.start_window}
              </p>
              <p>
                <span className="font-semibold">Location:</span>
              </p>
              <p>{quoteData.address_line1}</p>
              {quoteData.address_line2 && <p>{quoteData.address_line2}</p>}
              <p>
                {quoteData.city}, {quoteData.state} {quoteData.zip}
              </p>
              <p className="capitalize">
                <span className="font-semibold">Type:</span> {quoteData.location_type}
              </p>
            </div>
          </div>
        </div>

        <table className="w-full mb-8">
          <thead>
            <tr className="border-b-2 border-slate-900">
              <th className="text-left py-3 text-slate-900 font-bold uppercase text-sm">
                Item Description
              </th>
              <th className="text-right py-3 text-slate-900 font-bold uppercase text-sm">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {cart.map((item: any, index: number) => (
              <tr key={index} className="border-b border-slate-200">
                <td className="py-3 text-slate-700">
                  <div className="font-semibold">{item.unit_name}</div>
                  <div className="text-sm text-slate-500">
                    {item.wet_or_dry === 'water' ? 'Water Setup' : 'Dry Setup'}
                  </div>
                </td>
                <td className="py-3 text-right text-slate-900 font-medium">
                  {formatCurrency(item.unit_price_cents)}
                </td>
              </tr>
            ))}

            <tr className="border-b border-slate-200">
              <td className="py-3 text-slate-700">Rental Subtotal</td>
              <td className="py-3 text-right text-slate-900 font-medium">
                {formatCurrency(priceBreakdown.subtotal_cents)}
              </td>
            </tr>

            {priceBreakdown.travel_fee_cents > 0 && (
              <tr className="border-b border-slate-200">
                <td className="py-3 text-slate-700">
                  {priceBreakdown.travel_fee_display_name || 'Travel Fee'}
                </td>
                <td className="py-3 text-right text-slate-900 font-medium">
                  {formatCurrency(priceBreakdown.travel_fee_cents)}
                </td>
              </tr>
            )}

            {priceBreakdown.surface_fee_cents > 0 && (
              <tr className="border-b border-slate-200">
                <td className="py-3 text-slate-700">Sandbag Fee (Grass/Uneven Surface)</td>
                <td className="py-3 text-right text-slate-900 font-medium">
                  {formatCurrency(priceBreakdown.surface_fee_cents)}
                </td>
              </tr>
            )}

            {priceBreakdown.same_day_pickup_fee_cents > 0 && (
              <tr className="border-b border-slate-200">
                <td className="py-3 text-slate-700">Same-Day Pickup Fee</td>
                <td className="py-3 text-right text-slate-900 font-medium">
                  {formatCurrency(priceBreakdown.same_day_pickup_fee_cents)}
                </td>
              </tr>
            )}

            {priceBreakdown.generator_fee_cents > 0 && (
              <tr className="border-b border-slate-200">
                <td className="py-3 text-slate-700">Generator Rental</td>
                <td className="py-3 text-right text-slate-900 font-medium">
                  {formatCurrency(priceBreakdown.generator_fee_cents)}
                </td>
              </tr>
            )}

            <tr className="border-b border-slate-200">
              <td className="py-3 text-slate-700">Tax (6%)</td>
              <td className="py-3 text-right text-slate-900 font-medium">
                {formatCurrency(priceBreakdown.tax_cents)}
              </td>
            </tr>

            <tr className="border-t-2 border-slate-900">
              <td className="py-4 text-slate-900 font-bold text-lg">TOTAL</td>
              <td className="py-4 text-right text-slate-900 font-bold text-xl">
                {formatCurrency(priceBreakdown.total_cents)}
              </td>
            </tr>
          </tbody>
        </table>

        {!isPaid && (
          <div className="bg-slate-50 border-2 border-slate-300 rounded-lg p-6 mb-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-600 mb-1">Deposit Due Today:</p>
                <p className="text-2xl font-bold text-blue-600">
                  {formatCurrency(priceBreakdown.deposit_due_cents)}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-600 mb-1">Balance Due at Event:</p>
                <p className="text-2xl font-bold text-slate-900">
                  {formatCurrency(priceBreakdown.balance_due_cents)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="border-t-2 border-slate-200 pt-6 mt-8">
          <h3 className="font-bold text-slate-900 mb-3">Terms & Conditions:</h3>
          <div className="text-xs text-slate-600 space-y-2">
            <p>
              • Deposit is required to secure your booking and is non-refundable unless we cancel.
            </p>
            <p>
              • Balance payment is due on the day of the event before equipment is set up.
            </p>
            <p>
              • Customer must provide access to water and electricity (if required) at the event location.
            </p>
            <p>
              • Setup area must be clear and accessible. Additional fees may apply for difficult access.
            </p>
            <p>
              • Inflatables must be supervised by an adult at all times during use.
            </p>
            <p>
              • Weather cancellations made by customer are subject to rescheduling or forfeiture of deposit.
            </p>
            <p>
              • Customer is responsible for any damage to equipment beyond normal wear and tear.
            </p>
          </div>

          <h3 className="font-bold text-slate-900 mb-3 mt-6">SMS Notifications:</h3>
          <div className="text-xs text-slate-600 space-y-2">
            <p>
              By completing this booking, you consent to receive transactional SMS text messages from Bounce Party Club LLC regarding your order, including confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out at any time.
            </p>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-slate-500">
          <p>Thank you for your business!</p>
          <p>For questions, please contact us at info@bouncepartyclub.com</p>
        </div>
      </div>
    </div>
  );
}
