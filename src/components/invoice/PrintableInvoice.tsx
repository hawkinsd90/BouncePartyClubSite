import { formatCurrency } from '../../lib/pricing';
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
  taxWaived?: boolean;
  travelFeeWaived?: boolean;
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
  taxWaived = false,
  travelFeeWaived = false,
}: PrintableInvoiceProps) {
  const today = format(new Date(), 'MMMM d, yyyy');

  // Use the deposit from priceBreakdown instead of fetching from database
  const depositAmount = formatCurrency(priceBreakdown?.deposit_due_cents || 5000);

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
    <div className="bg-white p-8 max-w-5xl mx-auto" id="printable-invoice">
      <div className="border border-slate-200 rounded-lg shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-8">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-4">
              <img
                src="/bounce party club logo.png"
                alt="Bounce Party Club Logo"
                className="w-24 h-24 bg-white rounded-lg p-2 shadow-md"
              />
              <div>
                <h1 className="text-3xl font-bold mb-1">
                  BOUNCE PARTY CLUB
                </h1>
                <p className="text-blue-100 text-sm">Wayne, Michigan</p>
                <p className="text-blue-100 text-sm">Phone: (313) 889-3860</p>
                <p className="text-blue-100 text-sm">Email: bouncepartyclubllc@gmail.com</p>
              </div>
            </div>
            <div className="text-right">
              <h2 className="text-4xl font-bold mb-2">
                {isPaid ? 'RECEIPT' : 'INVOICE'}
              </h2>
              {invoiceNumber && (
                <p className="text-blue-100 font-mono text-sm">#{invoiceNumber}</p>
              )}
              <p className="text-blue-100 text-sm">{today}</p>
              {isPaid && (
                <>
                  <span className="inline-block mt-2 bg-green-500 text-white px-4 py-1.5 rounded-full text-sm font-semibold shadow-md">
                    PAID
                  </span>
                  {formatPaymentMethod() && (
                    <p className="text-sm text-blue-100 mt-2">
                      {formatPaymentMethod()}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="p-8">
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div className="bg-slate-50 p-6 rounded-lg">
              <h3 className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                <div className="w-1 h-4 bg-blue-600 rounded"></div>
                Bill To
              </h3>
              <div className="text-slate-700 space-y-1">
                {contactData.business_name && (
                  <p className="font-bold text-base text-slate-900">
                    {contactData.business_name}
                  </p>
                )}
                <p className="font-semibold text-slate-900">
                  {contactData.first_name} {contactData.last_name}
                </p>
                <p className="text-sm">{contactData.email}</p>
                <p className="text-sm">{contactData.phone}</p>
              </div>
            </div>
            <div className="bg-slate-50 p-6 rounded-lg">
              <h3 className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                <div className="w-1 h-4 bg-blue-600 rounded"></div>
                Event Details
              </h3>
              <div className="text-slate-700 space-y-1">
                <p className="text-sm">
                  <span className="font-semibold text-slate-900">Date:</span> {quoteData.event_date}
                </p>
                <p className="text-sm">
                  <span className="font-semibold text-slate-900">Time:</span> {quoteData.start_window}
                </p>
                <p className="text-sm font-semibold text-slate-900 mt-2">Location:</p>
                <p className="text-sm">{quoteData.address_line1}</p>
                {quoteData.address_line2 && <p className="text-sm">{quoteData.address_line2}</p>}
                <p className="text-sm">
                  {quoteData.city}, {quoteData.state} {quoteData.zip}
                </p>
                <p className="capitalize text-sm">
                  <span className="font-semibold text-slate-900">Location Type:</span> {quoteData.location_type}
                </p>
                {quoteData.pickup_preference && (
                  <p className="text-sm">
                    <span className="font-semibold text-slate-900">Pickup:</span>{' '}
                    {quoteData.pickup_preference === 'next_day' ? 'Next Morning' : 'Same Day'}
                  </p>
                )}
                {quoteData.surface === 'grass' && (
                  <p className="text-sm">
                    <span className="font-semibold text-slate-900">Sandbags:</span> Required for grass setup
                  </p>
                )}
                {quoteData.generator_qty > 0 && (
                  <p className="text-sm">
                    <span className="font-semibold text-slate-900">Generators:</span>{' '}
                    {quoteData.generator_qty}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mb-8">
            <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white py-3 px-6 rounded-t-lg">
              <div className="grid grid-cols-2">
                <div className="font-bold uppercase text-xs tracking-wider">Item Description</div>
                <div className="font-bold uppercase text-xs tracking-wider text-right">Amount</div>
              </div>
            </div>
            <div className="border border-t-0 border-slate-200 rounded-b-lg overflow-hidden">
              {cart.map((item: any, index: number) => (
                <div key={index} className="grid grid-cols-2 py-4 px-6 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <div className="text-slate-700">
                    <div className="font-semibold text-slate-900">{item.unit_name}</div>
                    <div className="text-sm text-slate-500">
                      {item.wet_or_dry === 'water' ? 'Water Setup' : 'Dry Setup'}
                    </div>
                  </div>
                  <div className="text-right text-slate-900 font-semibold">
                    {formatCurrency(item.unit_price_cents)}
                  </div>
                </div>
              ))}

              <div className="grid grid-cols-2 py-3 px-6 border-b border-slate-100 bg-slate-50">
                <div className="text-slate-700 font-medium">Rental Subtotal</div>
                <div className="text-right text-slate-900 font-semibold">
                  {formatCurrency(priceBreakdown.subtotal_cents)}
                </div>
              </div>

              {(priceBreakdown.travel_fee_cents > 0 || travelFeeWaived) && (
                <div className="grid grid-cols-2 py-3 px-6 border-b border-slate-100">
                  <div className="text-slate-700 flex items-center gap-2">
                    {priceBreakdown.travel_fee_display_name || 'Travel Fee'}
                  </div>
                  <div className="text-right font-medium flex items-center justify-end gap-2">
                    <span className={travelFeeWaived ? 'line-through text-red-600' : 'text-slate-900'}>
                      {formatCurrency(priceBreakdown.travel_fee_cents)}
                    </span>
                    {travelFeeWaived && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">WAIVED</span>
                    )}
                  </div>
                </div>
              )}

              {priceBreakdown.surface_fee_cents > 0 && (
                <div className="grid grid-cols-2 py-3 px-6 border-b border-slate-100">
                  <div className="text-slate-700">Sandbag Fee (Grass/Uneven Surface)</div>
                  <div className="text-right text-slate-900 font-medium">
                    {formatCurrency(priceBreakdown.surface_fee_cents)}
                  </div>
                </div>
              )}

              {priceBreakdown.same_day_pickup_fee_cents > 0 && (
                <div className="grid grid-cols-2 py-3 px-6 border-b border-slate-100">
                  <div className="text-slate-700">Same-Day Pickup Fee</div>
                  <div className="text-right text-slate-900 font-medium">
                    {formatCurrency(priceBreakdown.same_day_pickup_fee_cents)}
                  </div>
                </div>
              )}

              {priceBreakdown.generator_fee_cents > 0 && (
                <div className="grid grid-cols-2 py-3 px-6 border-b border-slate-100">
                  <div className="text-slate-700">Generator Rental</div>
                  <div className="text-right text-slate-900 font-medium">
                    {formatCurrency(priceBreakdown.generator_fee_cents)}
                  </div>
                </div>
              )}

              {(priceBreakdown.tax_cents > 0 || taxWaived) && (
                <div className="grid grid-cols-2 py-3 px-6 border-b border-slate-100">
                  <div className="text-slate-700">Tax (6%)</div>
                  <div className="text-right font-medium flex items-center justify-end gap-2">
                    <span className={taxWaived ? 'line-through text-red-600' : 'text-slate-900'}>
                      {formatCurrency(priceBreakdown.tax_cents)}
                    </span>
                    {taxWaived && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">WAIVED</span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 py-5 px-6 bg-gradient-to-r from-blue-50 to-blue-100">
                <div className="text-slate-900 font-bold text-lg">TOTAL</div>
                <div className="text-right text-blue-700 font-bold text-2xl">
                  {formatCurrency(priceBreakdown.total_cents)}
                </div>
              </div>
            </div>
          </div>

          {!isPaid && (
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-200 rounded-lg p-6 mb-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <p className="text-xs text-slate-600 mb-2 uppercase tracking-wider font-semibold">Deposit Due Today</p>
                  <p className="text-3xl font-bold text-blue-600">
                    {formatCurrency(priceBreakdown.deposit_due_cents)}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-4 shadow-sm">
                  <p className="text-xs text-slate-600 mb-2 uppercase tracking-wider font-semibold">Balance Due at Event</p>
                  <p className="text-3xl font-bold text-slate-900">
                    {formatCurrency(priceBreakdown.balance_due_cents)}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-50 rounded-lg p-6 mt-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-blue-600 rounded"></div>
              <h3 className="font-bold text-slate-900 text-lg">Rental Terms & Policies</h3>
            </div>

            <div className="space-y-4 text-xs">
              <div className="bg-white p-4 rounded-lg border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Deposit Information
                </h4>
                <p className="text-slate-700 leading-relaxed mb-2">
                  This booking requires a minimum {depositAmount} deposit per inflatable to reserve your event date with Bounce Party Club. The remaining balance is due on or before the day of your event. You may choose to pay the full amount at booking.
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

              <div className="bg-white p-4 rounded-lg border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Setup & Pickup Expectations
                </h4>
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

              <div className="bg-white p-4 rounded-lg border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Waiver Requirement
                </h4>
                <p className="text-slate-600 leading-relaxed">
                  All renters must sign the Bounce Party Club waiver before setup begins. This protects both the renter and the business by outlining terms of safe and responsible use.
                </p>
              </div>

              <div className="bg-white p-4 rounded-lg border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  Damage and Loss Responsibility
                </h4>
                <p className="text-slate-600 leading-relaxed">
                  Renter is responsible for damages beyond normal wear and tear. Refer to the signed waiver for full terms and conditions regarding liability.
                </p>
              </div>

              <div className="bg-white p-4 rounded-lg border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  SMS Notifications
                </h4>
                <p className="text-slate-600 leading-relaxed">
                  By completing this booking, you consent to receive transactional SMS text messages from Bounce Party Club LLC regarding your order, including confirmations, delivery updates, and service notifications. Message frequency varies. Message and data rates may apply. Reply STOP to opt-out at any time.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 text-center border-t border-slate-200 pt-6">
            <p className="text-slate-900 font-semibold mb-1">Thank you for your business!</p>
            <p className="text-sm text-slate-600">For questions, please contact us at (313) 889-3860 or bouncepartyclubllc@gmail.com</p>
          </div>
        </div>
      </div>
    </div>
  );
}
