import { Edit2, AlertTriangle, CheckCircle } from 'lucide-react';
import { formatCurrency } from '../../lib/pricing';
import { OrderSummary } from '../order/OrderSummary';
import { EventDetailsEditor } from './EventDetailsEditor';
import { ItemsEditor } from '../shared/ItemsEditor';
import { DiscountsManager } from './DiscountsManager';
import { CustomFeesManager } from './CustomFeesManager';
import { DepositOverride } from './DepositOverride';
import { AdminMessage } from './AdminMessage';
import { TaxWaiver } from './TaxWaiver';
import { FeeWaiver } from '../shared/FeeWaiver';

interface OrderDetailsTabProps {
  order: any;
  checkingAvailability: boolean;
  availabilityIssues: any[];
  stagedItems: any[];
  editedOrder: any;
  pricingRules: any;
  availableUnits: any[];
  currentOrderSummary: any;
  updatedOrderSummary: any;
  hasChanges: boolean;
  calculatedPricing: any;
  customDepositCents: number | null;
  discounts: any[];
  customFees: any[];
  customDepositInput: string;
  adminMessage: string;
  taxWaived: boolean;
  taxWaiveReason?: string;
  travelFeeWaived: boolean;
  travelFeeWaiveReason?: string;
  sameDayPickupFeeWaived: boolean;
  sameDayPickupFeeWaiveReason?: string;
  surfaceFeeWaived: boolean;
  surfaceFeeWaiveReason?: string;
  generatorFeeWaived: boolean;
  generatorFeeWaiveReason?: string;
  onOrderChange: (updates: any) => void;
  onAddressSelect: (result: any) => void;
  onRemoveItem: (item: any) => void;
  onAddItem: (unit: any, mode: 'dry' | 'water') => void;
  onDiscountsChange: (discounts: any[]) => void;
  onFeesChange: (fees: any[]) => void;
  onDepositInputChange: (value: string) => void;
  onDepositApply: (amountCents: number) => void;
  onDepositClear: () => void;
  onAdminMessageChange: (value: string) => void;
  onTaxWaivedToggle: (reason: string) => void;
  onTravelFeeWaivedToggle: (reason: string) => void;
  onSameDayPickupFeeWaivedToggle: (reason: string) => void;
  onSurfaceFeeWaivedToggle: (reason: string) => void;
  onGeneratorFeeWaivedToggle: (reason: string) => void;
  onStatusChange: (status: string) => void;
  onMarkChanges: () => void;
}

export function OrderDetailsTab({
  order,
  checkingAvailability,
  availabilityIssues,
  stagedItems,
  editedOrder,
  pricingRules,
  availableUnits,
  currentOrderSummary,
  updatedOrderSummary,
  hasChanges,
  calculatedPricing,
  customDepositCents,
  discounts,
  customFees,
  customDepositInput,
  adminMessage,
  taxWaived,
  taxWaiveReason,
  travelFeeWaived,
  travelFeeWaiveReason,
  sameDayPickupFeeWaived,
  sameDayPickupFeeWaiveReason,
  surfaceFeeWaived,
  surfaceFeeWaiveReason,
  generatorFeeWaived,
  generatorFeeWaiveReason,
  onOrderChange,
  onAddressSelect,
  onRemoveItem,
  onAddItem,
  onDiscountsChange,
  onFeesChange,
  onDepositInputChange,
  onDepositApply,
  onDepositClear,
  onAdminMessageChange,
  onTaxWaivedToggle,
  onTravelFeeWaivedToggle,
  onSameDayPickupFeeWaivedToggle,
  onSurfaceFeeWaivedToggle,
  onGeneratorFeeWaivedToggle,
  onStatusChange,
  onMarkChanges,
}: OrderDetailsTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Edit2 className="w-4 h-4 text-amber-700" />
          <h3 className="font-semibold text-amber-900">Edit Mode Active</h3>
        </div>
        <p className="text-sm text-amber-700">
          Make changes to order details and items below. Click "Save Changes" to apply all changes at once.
          The order status will be set to "Awaiting Customer Approval" when saved.
        </p>
      </div>

      {checkingAvailability && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-700"></div>
            <p className="text-sm text-blue-700">Checking unit availability...</p>
          </div>
        </div>
      )}

      {!checkingAvailability && availabilityIssues.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-700" />
            <h3 className="font-semibold text-red-900">Availability Conflict</h3>
          </div>
          <p className="text-sm text-red-700 mb-2">
            The following units are not available for the selected dates:
          </p>
          <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
            {availabilityIssues.map((issue, idx) => (
              <li key={idx}>
                <span className="font-medium">{issue.unitName}</span>
                {issue.conflicts && issue.conflicts.length > 0 && (
                  <span className="text-xs">
                    {' '}(conflicts with {issue.conflicts.length} other order{issue.conflicts.length > 1 ? 's' : ''})
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-red-600 mt-2">
            Please adjust the dates or remove the conflicting items before saving.
          </p>
        </div>
      )}

      {(() => {
        const itemsChanged = stagedItems.some(item => item.is_new || item.is_deleted);
        const finalDepositCents = customDepositCents !== null ? customDepositCents : (calculatedPricing?.deposit_due_cents || order.deposit_due_cents);
        const currentPaidAmount = order.stripe_amount_paid_cents || 0;
        const originalTotal = order.subtotal_cents + (order.generator_fee_cents || 0) + order.travel_fee_cents + order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents;
        const newTotal = calculatedPricing?.total_cents || originalTotal;

        const willClearPayment = itemsChanged ||
          (order.stripe_payment_intent_id && (
            finalDepositCents > currentPaidAmount ||
            (currentPaidAmount >= originalTotal && newTotal > currentPaidAmount)
          ));

        return willClearPayment && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-purple-700" />
              <h3 className="font-semibold text-purple-900">Payment Information Will Be Cleared</h3>
            </div>
            <p className="text-sm text-purple-700 mb-2">
              {itemsChanged
                ? "Since you're adding or removing units, the saved payment method will be cleared."
                : finalDepositCents > currentPaidAmount
                ? `The new deposit (${formatCurrency(finalDepositCents)}) is higher than the amount already paid (${formatCurrency(currentPaidAmount)}), so the payment method will be cleared.`
                : `The customer paid the full amount (${formatCurrency(currentPaidAmount)}), but the new total (${formatCurrency(newTotal)}) exceeds this, so the payment method will be cleared.`
              }
            </p>
            <p className="text-xs text-purple-600">
              The customer will be asked to provide payment information again when they approve the changes.
            </p>
          </div>
        );
      })()}

      {!checkingAvailability && availabilityIssues.length === 0 && stagedItems.filter(i => !i.is_deleted).length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-700" />
            <p className="text-sm text-green-700 font-medium">All units are available for the selected dates</p>
          </div>
        </div>
      )}

      <EventDetailsEditor
        editedOrder={editedOrder}
        pricingRules={pricingRules}
        onOrderChange={onOrderChange}
        onAddressSelect={onAddressSelect}
      />

      <ItemsEditor
        items={stagedItems}
        units={availableUnits}
        onRemoveItem={onRemoveItem}
        onAddItem={onAddItem}
        title="Order Items"
        removeByIndex={false}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {currentOrderSummary && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg">
            <OrderSummary
              summary={currentOrderSummary}
              title="Current Pricing"
              showDeposit={true}
              showTip={order.tip_cents > 0}
              taxWaived={order.tax_waived || false}
              travelFeeWaived={order.travel_fee_waived || false}
              surfaceFeeWaived={order.surface_fee_waived || false}
              generatorFeeWaived={order.generator_fee_waived || false}
              sameDayPickupFeeWaived={order.same_day_pickup_fee_waived || false}
            />
          </div>
        )}

        {updatedOrderSummary && hasChanges && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg">
            <OrderSummary
              summary={updatedOrderSummary}
              title={
                <>
                  Updated Pricing
                  <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded whitespace-nowrap">Changes Pending</span>
                </>
              }
              showDeposit={true}
              showTip={order.tip_cents > 0}
              highlightNewItems={true}
              comparisonTotal={currentOrderSummary?.total}
              customDepositCents={customDepositCents}
              taxWaived={taxWaived}
              travelFeeWaived={travelFeeWaived}
              surfaceFeeWaived={surfaceFeeWaived}
              generatorFeeWaived={generatorFeeWaived}
              sameDayPickupFeeWaived={sameDayPickupFeeWaived}
            />
          </div>
        )}
      </div>

      <DiscountsManager
        discounts={discounts}
        onDiscountChange={onDiscountsChange}
        onMarkChanges={onMarkChanges}
      />

      <CustomFeesManager
        customFees={customFees}
        onFeeChange={onFeesChange}
        onMarkChanges={onMarkChanges}
      />

      <DepositOverride
        calculatedDepositCents={calculatedPricing?.deposit_due_cents || order.deposit_due_cents}
        customDepositCents={customDepositCents}
        customDepositInput={customDepositInput}
        onInputChange={onDepositInputChange}
        onApply={onDepositApply}
        onClear={onDepositClear}
      />

      <TaxWaiver
        taxCents={calculatedPricing?.tax_cents || order.tax_cents}
        taxWaived={taxWaived}
        taxWaiveReason={taxWaiveReason}
        onToggle={onTaxWaivedToggle}
        applyTaxesByDefault={pricingRules?.apply_taxes_by_default ?? true}
        originalOrderTaxCents={order.tax_cents}
      />

      {((calculatedPricing?.travel_fee_cents || 0) > 0 || (order.travel_fee_cents || 0) > 0 || travelFeeWaived) && (
        <FeeWaiver
          feeName="Travel Fee"
          feeAmount={calculatedPricing?.travel_fee_cents || order.travel_fee_cents || 0}
          isWaived={travelFeeWaived}
          waiveReason={travelFeeWaiveReason}
          onToggle={onTravelFeeWaivedToggle}
          color="orange"
        />
      )}

      {((calculatedPricing?.same_day_pickup_fee_cents || 0) > 0 || (order.same_day_pickup_fee_cents || 0) > 0 || sameDayPickupFeeWaived) && (
        <FeeWaiver
          feeName="Same Day Pickup Fee"
          feeAmount={calculatedPricing?.same_day_pickup_fee_cents || order.same_day_pickup_fee_cents || 0}
          isWaived={sameDayPickupFeeWaived}
          waiveReason={sameDayPickupFeeWaiveReason}
          onToggle={onSameDayPickupFeeWaivedToggle}
          color="blue"
        />
      )}

      {((calculatedPricing?.surface_fee_cents || 0) > 0 || (order.surface_fee_cents || 0) > 0 || surfaceFeeWaived) && (
        <FeeWaiver
          feeName="Surface Fee (Sandbags)"
          feeAmount={calculatedPricing?.surface_fee_cents || order.surface_fee_cents || 0}
          isWaived={surfaceFeeWaived}
          waiveReason={surfaceFeeWaiveReason}
          onToggle={onSurfaceFeeWaivedToggle}
          color="orange"
        />
      )}

      {((editedOrder.generator_qty || 0) > 0 || (order.generator_qty || 0) > 0 || generatorFeeWaived) && (
        <FeeWaiver
          feeName="Generator Fee"
          feeAmount={calculatedPricing?.generator_fee_cents || order.generator_fee_cents || 0}
          isWaived={generatorFeeWaived}
          waiveReason={generatorFeeWaiveReason}
          onToggle={onGeneratorFeeWaivedToggle}
          color="blue"
        />
      )}

      <AdminMessage
        value={adminMessage}
        onChange={onAdminMessageChange}
      />

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <h3 className="font-semibold text-slate-900 mb-3">Order Status</h3>
        <div className="flex flex-wrap gap-2">
          {['pending', 'awaiting_customer_approval', 'confirmed', 'in_progress', 'completed', 'cancelled', 'void'].map(status => (
            <button
              key={status}
              onClick={() => onStatusChange(status)}
              className={`px-3 py-1 rounded text-sm font-medium ${
                order.status === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {status.replace(/_/g, ' ').toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
