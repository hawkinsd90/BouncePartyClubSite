import { formatCurrency } from '../lib/pricing';
import { OrderSummaryDisplay } from '../lib/orderSummary';
import { TrendingUp } from 'lucide-react';

interface ChangelogEntry {
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
}

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
  changelog?: ChangelogEntry[];
}

export function OrderSummary({
  summary,
  showDeposit = true,
  showTip = true,
  className = '',
  title = 'Complete Price Breakdown',
  compactMode: _compactMode = false,
  highlightNewItems: _highlightNewItems = false,
  comparisonTotal,
  customDepositCents,
  changelog = [],
}: OrderSummaryProps) {
  const hasChanged = (fieldName: string) => {
    return changelog.some(c => c.field_changed === fieldName);
  };

  const getOldValue = (fieldName: string) => {
    const change = changelog.find(c => c.field_changed === fieldName);
    return change?.old_value || null;
  };

  const addedItems = changelog.filter(c => c.field_changed === 'order_items' && c.new_value && !c.old_value);

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
              {summary.items.map((item, index) => {
                const isNew = addedItems.some(change =>
                  change.new_value?.includes(item.name)
                );
                return (
                  <div key={index} className="flex justify-between text-slate-700">
                    <span className="flex items-center gap-2">
                      {item.name} ({item.mode}) × {item.qty}
                      {isNew && (
                        <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-semibold">NEW</span>
                      )}
                    </span>
                    <span className={`font-medium ${isNew ? 'text-blue-700' : ''}`}>
                      {formatCurrency(item.lineTotal)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Consolidated fees section in compact mode */}
        <div className="pt-3 border-t border-slate-200 space-y-2">
          <div className={`flex justify-between ${hasChanged('subtotal') ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
            <span className="text-slate-700 font-medium">Items Subtotal:</span>
            <div className="flex items-center gap-2">
              {hasChanged('subtotal') && getOldValue('subtotal') && (
                <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('subtotal')!))}</span>
              )}
              <span className={`font-semibold ${hasChanged('subtotal') ? 'text-blue-700' : 'text-slate-900'}`}>
                {formatCurrency(summary.subtotal)}
              </span>
            </div>
          </div>

          {summary.fees.map((fee, index) => {
            const fieldMap: Record<string, string> = {
              'Travel Fee': 'travel_fee',
              'Surface Fee (Sandbags)': 'surface_fee',
              'Generators': 'generator_fee',
              'Same-Day Pickup Fee': 'same_day_pickup_fee',
            };
            const fieldName = fieldMap[fee.name] || '';
            const changed = fieldName && hasChanged(fieldName);
            const oldVal = changed ? getOldValue(fieldName) : null;

            return (
              <div key={index} className={`flex justify-between ${changed ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
                <span className="text-slate-700 flex items-center gap-2">
                  {fee.name}
                  {changed && <TrendingUp className="w-4 h-4 text-blue-600" />}
                </span>
                <div className="flex items-center gap-2">
                  {changed && oldVal && (
                    <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(oldVal))}</span>
                  )}
                  <span className={`font-medium ${changed ? 'text-blue-700' : 'text-slate-900'}`}>
                    {formatCurrency(fee.amount)}
                  </span>
                </div>
              </div>
            );
          })}

          {summary.customFees.map((fee, index) => (
            <div key={index} className="flex justify-between">
              <span className="text-slate-700 flex items-center gap-2">
                {fee.name}
                <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-semibold">ADDED</span>
              </span>
              <span className="font-medium text-slate-900">{formatCurrency(fee.amount)}</span>
            </div>
          ))}

          {summary.discounts.map((discount, index) => (
            <div key={index} className="flex justify-between">
              <span className="text-green-700">Discount:</span>
              <span className="font-medium text-green-700">-{formatCurrency(discount.amount)}</span>
            </div>
          ))}

          <div className={`flex justify-between ${hasChanged('tax') ? 'bg-blue-50 -mx-2 px-2 py-1 rounded' : ''}`}>
            <span className="text-slate-700">Tax (6%):</span>
            <div className="flex items-center gap-2">
              {hasChanged('tax') && getOldValue('tax') && (
                <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('tax')!))}</span>
              )}
              {comparisonTotal !== undefined && comparisonTotal !== summary.total && !hasChanged('tax') && (
                <span className="line-through text-slate-400 mr-2">{formatCurrency(Math.round(comparisonTotal * 0.06))}</span>
              )}
              <span className={`font-medium ${hasChanged('tax') ? 'text-blue-700' : 'text-slate-900'}`}>
                {formatCurrency(summary.tax)}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-3 border-t-2 border-slate-300 space-y-2">
          <div className="flex justify-between text-slate-900 font-bold text-lg">
            <span>Total:</span>
            <div className="flex items-center gap-2">
              {hasChanged('total') && getOldValue('total') && (
                <span className="text-sm text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('total')!))}</span>
              )}
              {comparisonTotal !== undefined && comparisonTotal !== summary.total && !hasChanged('total') && (
                <span className="line-through text-slate-400 mr-2 text-base">{formatCurrency(comparisonTotal)}</span>
              )}
              <span className={`font-bold text-xl ${hasChanged('total') ? 'text-blue-700' : 'text-slate-900'}`}>
                {formatCurrency(summary.total)}
              </span>
            </div>
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
            <div className="flex justify-between text-green-700 font-medium">
              <span className="font-semibold">Deposit Due Now:</span>
              <div className="flex items-center gap-2">
                {hasChanged('deposit_due') && getOldValue('deposit_due') && (
                  <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('deposit_due')!))}</span>
                )}
                <span className="text-green-700 font-bold text-base">
                  {formatCurrency(customDepositCents !== null && customDepositCents !== undefined ? customDepositCents : summary.depositDue)}
                  {customDepositCents !== null && customDepositCents !== undefined && customDepositCents !== summary.depositDue && (
                    <span className="ml-1 text-xs bg-amber-600 text-white px-1 py-0.5 rounded">OVERRIDE</span>
                  )}
                </span>
              </div>
            </div>
            {summary.depositPaid > 0 && (
              <div className="flex justify-between text-green-600 font-medium">
                <span>Deposit Paid:</span>
                <span>{formatCurrency(summary.depositPaid)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-600">Balance Due After Event:</span>
              <div className="flex items-center gap-2">
                {hasChanged('balance_due') && getOldValue('balance_due') && (
                  <span className="text-xs text-slate-400 line-through">{formatCurrency(parseInt(getOldValue('balance_due')!))}</span>
                )}
                <span className="text-slate-700 font-semibold">
                  {formatCurrency(customDepositCents !== null && customDepositCents !== undefined
                    ? summary.total - customDepositCents
                    : summary.balanceDue)}
                </span>
              </div>
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
