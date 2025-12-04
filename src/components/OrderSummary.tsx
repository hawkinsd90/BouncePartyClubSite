import { formatCurrency } from '../lib/pricing';
import { OrderSummaryDisplay } from '../lib/orderSummary';

interface OrderSummaryProps {
  summary: OrderSummaryDisplay;
  showDeposit?: boolean;
  showTip?: boolean;
  className?: string;
  title?: React.ReactNode;
  compactMode?: boolean;
  highlightNewItems?: boolean;
  comparisonTotal?: number;
  customDepositCents?: number | null;
}

export function OrderSummary({
  summary,
  showDeposit = true,
  showTip = true,
  className = '',
  title = 'Complete Price Breakdown',
  compactMode = false,
  highlightNewItems = false,
  comparisonTotal,
  customDepositCents,
}: OrderSummaryProps) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 ${className}`}>
      {title && (
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        </div>
      )}

      <div className="p-6 space-y-4">
        {summary.items.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3">
              ITEMS
            </h4>
            <div className="space-y-2">
              {summary.items.map((item, index) => (
                <div key={index} className="flex justify-between text-slate-700">
                  <span>
                    {item.name} ({item.mode}) × {item.qty}
                    {highlightNewItems && item.isNew && (
                      <span className="ml-2 text-xs bg-green-600 text-white px-1.5 py-0.5 rounded">NEW</span>
                    )}
                  </span>
                  <span className={`font-medium ${highlightNewItems && item.isNew ? 'text-blue-700' : ''}`}>
                    {formatCurrency(item.lineTotal)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Consolidated fees section in compact mode */}
        <div className="pt-3 border-t border-slate-200 space-y-2">
          <div className="flex justify-between text-slate-700">
            <span>Items Subtotal:</span>
            <span className="font-medium">{formatCurrency(summary.subtotal)}</span>
          </div>

          {summary.fees.map((fee, index) => (
            <div key={index} className="flex justify-between text-slate-700">
              <span>{fee.name} {fee.name.includes('mi') ? '' : '( mi)'}:</span>
              <span className="font-medium">{formatCurrency(fee.amount)}</span>
            </div>
          ))}

          {summary.customFees.map((fee, index) => (
            <div key={index} className="flex justify-between text-slate-700">
              <span className="text-slate-700">{fee.name}:</span>
              <span className="font-medium text-green-700">+{formatCurrency(fee.amount)}</span>
            </div>
          ))}

          {summary.discounts.map((discount, index) => (
            <div key={index} className="flex justify-between text-slate-700">
              <span className="text-slate-700">{discount.name}:</span>
              <span className="font-medium text-red-600">-{formatCurrency(discount.amount)}</span>
            </div>
          ))}

          <div className="flex justify-between text-slate-700">
            <span>Tax (6%):</span>
            <span className="font-medium">
              {comparisonTotal !== undefined && comparisonTotal !== summary.total && (
                <span className="line-through text-slate-400 mr-2">{formatCurrency(Math.round(comparisonTotal * 0.06))}</span>
              )}
              {formatCurrency(summary.tax)}
            </span>
          </div>
        </div>

        <div className="pt-3 border-t-2 border-slate-300 space-y-2">
          <div className="flex justify-between text-slate-900 font-bold text-lg">
            <span>Total:</span>
            <span>
              {comparisonTotal !== undefined && comparisonTotal !== summary.total && (
                <span className="line-through text-slate-400 mr-2 text-base">{formatCurrency(comparisonTotal)}</span>
              )}
              {formatCurrency(summary.total)}
            </span>
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
              <span>Deposit Due{customDepositCents !== null && customDepositCents !== undefined ? '' : ' Now'}:</span>
              <span>
                {formatCurrency(customDepositCents !== null && customDepositCents !== undefined ? customDepositCents : summary.depositDue)}
                {customDepositCents !== null && customDepositCents !== undefined && customDepositCents !== summary.depositDue && (
                  <span className="ml-1 text-xs bg-amber-600 text-white px-1 py-0.5 rounded">OVERRIDE</span>
                )}
              </span>
            </div>
            {summary.depositPaid > 0 && (
              <div className="flex justify-between text-green-600 font-medium">
                <span>Deposit Paid:</span>
                <span>{formatCurrency(summary.depositPaid)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-700">
              <span>Balance Due{customDepositCents !== null && customDepositCents !== undefined ? '' : ' After Event'}:</span>
              <span className="font-medium">
                {formatCurrency(customDepositCents !== null && customDepositCents !== undefined
                  ? summary.total - customDepositCents
                  : summary.balanceDue)}
              </span>
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
