import { FileText } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { OrderSummary } from '../order/OrderSummary';
import { OrderSummaryDisplay } from '../../lib/orderSummary';

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
  surface?: string;
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
  onViewPrintableInvoice: () => void;
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
  surface,
  generatorQty = 0,
  orderItems,
  orderSummary,
  taxWaived = false,
  travelFeeWaived = false,
  surfaceFeeWaived = false,
  generatorFeeWaived = false,
  sameDayPickupFeeWaived = false,
  showTip = false,
  onViewPrintableInvoice,
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
          {surface === 'grass' && (
            <p>
              <strong>Sandbags:</strong> Required for grass setup
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
          <button
            type="button"
            onClick={onViewPrintableInvoice}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center mt-4"
          >
            <FileText className="w-5 h-5 mr-2" />
            View as Invoice / Print PDF
          </button>
        </div>
      )}
    </div>
  );
}
