import { formatCurrency } from '../lib/pricing';
import { OrderSummaryDisplay } from '../lib/orderSummary';

interface OrderSummaryProps {
  summary: OrderSummaryDisplay;
  showDeposit?: boolean;
  showTip?: boolean;
  className?: string;
  title?: string;
}

export function OrderSummary({
  summary,
  showDeposit = true,
  showTip = true,
  className = '',
  title = 'Complete Price Breakdown',
}: OrderSummaryProps) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 ${className}`}>
      {title && (
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>
      )}

      <div className="p-6 space-y-6">
        {summary.items.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
              ITEMS
            </h4>
            <div className="space-y-2">
              {summary.items.map((item, index) => (
                <div key={index} className="flex justify-between text-slate-700">
                  <span>
                    {item.name} ({item.mode})
                    {item.qty > 1 && ` × ${item.qty}`}
                  </span>
                  <span className="font-medium">{formatCurrency(item.lineTotal)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between font-medium">
              <span>Items Subtotal:</span>
              <span>{formatCurrency(summary.subtotal)}</span>
            </div>
          </div>
        )}

        {summary.fees.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
              FEES
            </h4>
            <div className="space-y-2">
              {summary.fees.map((fee, index) => (
                <div key={index} className="flex justify-between text-slate-700">
                  <span>{fee.name}</span>
                  <span className="font-medium">{formatCurrency(fee.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.customFees.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-green-700 uppercase tracking-wider mb-3">
              ADDED
            </h4>
            <div className="space-y-2">
              {summary.customFees.map((fee, index) => (
                <div key={index} className="flex justify-between text-green-700">
                  <span>{fee.name}</span>
                  <span className="font-medium">+{formatCurrency(fee.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.discounts.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-red-700 uppercase tracking-wider mb-3">
              DISCOUNT
            </h4>
            <div className="space-y-2">
              {summary.discounts.map((discount, index) => (
                <div key={index} className="flex justify-between text-red-700">
                  <span>{discount.name}</span>
                  <span className="font-medium">-{formatCurrency(discount.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4 border-t-2 border-slate-300 space-y-2">
          <div className="flex justify-between text-slate-700">
            <span>Tax (6%):</span>
            <span className="font-medium">{formatCurrency(summary.tax)}</span>
          </div>
          <div className="flex justify-between text-slate-900 font-bold text-lg">
            <span>Total:</span>
            <span>{formatCurrency(summary.total)}</span>
          </div>
        </div>

        {showTip && summary.tip > 0 && (
          <div className="pt-4 border-t border-slate-200">
            <div className="flex justify-between text-slate-700">
              <span>Crew Tip:</span>
              <span className="font-medium text-green-600">+{formatCurrency(summary.tip)}</span>
            </div>
            <div className="mt-2 flex justify-between text-slate-900 font-bold">
              <span>Total with Tip:</span>
              <span>{formatCurrency(summary.total + summary.tip)}</span>
            </div>
          </div>
        )}

        {showDeposit && (
          <div className="pt-4 border-t-2 border-slate-300 space-y-2">
            <div className="flex justify-between text-blue-600 font-medium">
              <span>Deposit Due Now:</span>
              <span>{formatCurrency(summary.depositDue)}</span>
            </div>
            {summary.depositPaid > 0 && (
              <div className="flex justify-between text-green-600 font-medium">
                <span>Deposit Paid:</span>
                <span>{formatCurrency(summary.depositPaid)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-700">
              <span>Balance Due After Event:</span>
              <span className="font-medium">{formatCurrency(summary.balanceDue)}</span>
            </div>
          </div>
        )}

        {summary.isMultiDay && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-900">
              <strong>Multi-Day Rental:</strong> This is a multi-day rental. Pickup will be the next day after your event ends.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
