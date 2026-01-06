import { Printer } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { OrderSummary } from '../order/OrderSummary';
import { OrderSummaryDisplay } from '../../lib/orderSummary';
import { RentalTerms } from '../waiver/RentalTerms';

interface SimpleInvoiceDisplayProps {
  eventDate: string;
  startWindow: string;
  endWindow: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  locationType: string;
  pickupPreference?: string;
  canUseStakes?: boolean;
  generatorQty?: number;
  orderItems: Array<{
    id?: string;
    unit_name?: string;
    units?: { name: string };
    wet_or_dry: string;
    qty: number;
    unit_price_cents: number;
  }>;
  orderSummary: OrderSummaryDisplay | null;
  taxWaived?: boolean;
  travelFeeWaived?: boolean;
  surfaceFeeWaived?: boolean;
  generatorFeeWaived?: boolean;
  sameDayPickupFeeWaived?: boolean;
  showTip?: boolean;
  onPrint: () => void;
}

export function SimpleInvoiceDisplay({
  eventDate,
  startWindow,
  endWindow,
  addressLine1,
  addressLine2,
  city,
  state,
  zip,
  locationType,
  pickupPreference,
  canUseStakes,
  generatorQty = 0,
  orderItems,
  orderSummary,
  taxWaived = false,
  travelFeeWaived = false,
  surfaceFeeWaived = false,
  generatorFeeWaived = false,
  sameDayPickupFeeWaived = false,
  showTip = false,
  onPrint,
}: SimpleInvoiceDisplayProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-8">
      <div className="text-center mb-8">
        <img
          src="/bounce party club logo.png"
          alt="Bounce Party Club"
          className="h-20 w-auto mx-auto mb-4"
        />
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          Invoice from Bounce Party Club
        </h1>
        <p className="text-slate-600">Review and accept your order details below</p>
      </div>

      <div className="mb-8 p-6 bg-slate-50 rounded-lg">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Event Details</h2>
        <div className="space-y-2 text-sm">
          <p>
            <strong>Date:</strong> {eventDate}
          </p>
          <p>
            <strong>Time:</strong> {startWindow} - {endWindow}
          </p>
          <p>
            <strong>Location:</strong> {addressLine1}, {city}, {state} {zip}
          </p>
          <p>
            <strong>Location Type:</strong> <span className="capitalize">{locationType}</span>
          </p>
          {pickupPreference && (
            <p>
              <strong>Pickup:</strong>{' '}
              {pickupPreference === 'next_day' ? 'Next Morning' : 'Same Day'}
            </p>
          )}
          {canUseStakes === false && (
            <p>
              <strong>Sandbags:</strong> Yes
            </p>
          )}
          {generatorQty > 0 && (
            <p>
              <strong>Generators:</strong> {generatorQty}
            </p>
          )}
        </div>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Order Items</h2>
        <div className="space-y-3">
          {orderItems.map((item, index) => (
            <div
              key={item.id || index}
              className="flex justify-between items-center p-4 bg-slate-50 rounded-lg"
            >
              <div>
                <p className="font-medium text-slate-900">
                  {item.units?.name || item.unit_name || 'Unknown Unit'}
                </p>
                <p className="text-sm text-slate-600 capitalize">
                  {item.wet_or_dry === 'water' ? 'Water Mode' : 'Dry Mode'} × {item.qty}
                </p>
              </div>
              <p className="font-semibold text-slate-900">
                {formatCurrency(item.unit_price_cents * item.qty)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {orderSummary && (
        <div className="mb-8">
          <OrderSummary
            summary={orderSummary}
            showDeposit={true}
            showTip={showTip}
            title="Complete Price Breakdown"
            taxWaived={taxWaived}
            travelFeeWaived={travelFeeWaived}
            surfaceFeeWaived={surfaceFeeWaived}
            generatorFeeWaived={generatorFeeWaived}
            sameDayPickupFeeWaived={sameDayPickupFeeWaived}
          />
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-800">
              <strong>Pricing Notice:</strong> The prices shown are accurate as of{' '}
              {new Date().toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              . Pricing is subject to change and will be confirmed at the time of booking.
            </p>
          </div>
        </div>
      )}

      <div className="mb-8">
        <RentalTerms />
      </div>

      <button
        type="button"
        onClick={onPrint}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center"
      >
        <Printer className="w-5 h-5 mr-2" />
        Print / Save PDF
      </button>
    </div>
  );
}
