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
  paymentMethod?: string;
  paymentBrand?: string;
  paymentLast4?: string;
}

export function PrintableInvoice({
  quoteData,
  priceBreakdown,
  cart,
  contactData,
  invoiceNumber,
  isPaid = false,
  paymentMethod,
  paymentBrand,
  paymentLast4,
}: PrintableInvoiceProps) {
  const today = format(new Date(), 'MMMM d, yyyy');

  const formatPaymentMethod = () => {
    if (!paymentMethod) return null;

    if (paymentMethod === 'card' && paymentBrand && paymentLast4) {
      const brandName = paymentBrand.charAt(0).toUpperCase() + paymentBrand.slice(1);
      return `${brandName} •••• ${paymentLast4}`;
    }

    const methodMap: Record<string, string> = {
      card: 'Card',
      apple_pay: 'Apple Pay',
      google_pay: 'Google Pay',
      link: 'Link',
      cash: 'Cash',
      us_bank_account: 'Bank Account',
    };

    return methodMap[paymentMethod] || paymentMethod;
  };

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
          <div className="flex items-start gap-4">
            <img
              src="/image copy copy copy.png"
              alt="Bounce Party Club Logo"
              className="w-20 h-20 object-contain"
            />
            <div>
              <h1 className="text-4xl font-bold text-blue-600 mb-2">
                BOUNCE PARTY CLUB
              </h1>
              <p className="text-slate-600">Wayne, Michigan</p>
              <p className="text-slate-600">Phone: (313) 889-3860</p>
              <p className="text-slate-600">Email: bouncepartyclubllc@gmail.com</p>
            </div>
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
              <>
                <span className="inline-block mt-2 bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-semibold">
                  PAID
                </span>
                {formatPaymentMethod() && (
                  <p className="text-sm text-slate-600 mt-2">
                    {formatPaymentMethod()}
                  </p>
                )}
              </>
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
          <h3 className="font-bold text-slate-900 mb-4 text-base">Rental Terms & Policies</h3>

          <div className="space-y-4 text-xs">
            <div>
              <h4 className="font-semibold text-slate-900 mb-2">Deposit Information</h4>
              <p className="text-slate-700 leading-relaxed mb-2">
                This booking requires a minimum $50 deposit per inflatable to reserve your event date with Bounce Party Club. The remaining balance is due on or before the day of your event. You may choose to pay the full amount at booking.
              </p>
              <p className="font-medium text-slate-900 mb-2">Cancellation & Weather Policy Summary</p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 mb-2">
                <li>Deposits and payments are subject to the terms of the Bounce Party Club Rental Agreement and Liability Waiver.</li>
                <li>Refund eligibility is limited and depends on cancellation timing.</li>
                <li>Weather-related cancellations receive a one-time reschedule, not a refund.</li>
                <li>No refunds are issued once delivery or setup has begun.</li>
              </ul>
              <p className="text-slate-600 italic">
                Full cancellation and refund terms are outlined in the waiver you will be required to review and sign before final payment.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <h4 className="font-semibold text-slate-900 mb-2">Setup & Pickup Expectations</h4>
              <p className="font-medium text-slate-900 mb-1">Before Setup:</p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600 mb-2">
                <li>The event yard should be reasonably maintained, including clear grass, no trash, and no pet waste in the setup area</li>
                <li>We require access to a standard electrical outlet within 50 feet. If unavailable, a $35 generator rental fee applies</li>
                <li>We guarantee all deliveries will occur before 12:00 PM (noon) on the day of the event</li>
                <li>An adult must be present between 7:00 AM and 12:00 PM to receive the inflatable and review safety information with our team</li>
              </ul>
              <p className="font-medium text-slate-900 mb-1">During Pickup:</p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>Please ensure the inflatable remains plugged in and fully inflated for the duration of the rental period until Bounce Party Club staff arrives for pickup, unless specified otherwise</li>
                <li><strong>Residential Areas:</strong> The following morning between 6:00 AM and 1:30 PM</li>
                <li><strong>Commercial / High-Risk Areas</strong> (parks, churches, schools, etc.): Same-day pickup by 7:00 PM</li>
              </ul>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <h4 className="font-semibold text-slate-900 mb-2">Waiver Requirement</h4>
              <p className="text-slate-600 leading-relaxed">
                All renters must sign the Bounce Party Club waiver before setup begins. This protects both the renter and the business by outlining terms of safe and responsible use.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <h4 className="font-semibold text-slate-900 mb-2">Damage and Loss Responsibility</h4>
              <p className="text-slate-600 leading-relaxed">
                Renter is responsible for damages beyond normal wear and tear. Refer to the signed waiver for full terms and conditions regarding liability.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <h4 className="font-semibold text-slate-900 mb-2">SMS Notifications</h4>
              <p className="text-slate-600 leading-relaxed">
                By completing this booking, you consent to receive transactional SMS text messages from Bounce Party Club LLC regarding your order, including confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out at any time.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-sm text-slate-500">
          <p>Thank you for your business!</p>
          <p>For questions, please contact us at (313) 889-3860 or bouncepartyclubllc@gmail.com</p>
        </div>
      </div>
    </div>
  );
}
