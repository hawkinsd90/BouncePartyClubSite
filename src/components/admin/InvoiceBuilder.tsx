import { useState, useEffect, useMemo } from 'react';
import { Send } from 'lucide-react';
import { OrderSummary } from '../order/OrderSummary';
import { showToast } from '../../lib/notifications';
import { DiscountsManager } from '../order-detail/DiscountsManager';
import { CustomFeesManager } from '../order-detail/CustomFeesManager';
import { EventDetailsEditor } from '../order-detail/EventDetailsEditor';
import { DepositOverride } from '../order-detail/DepositOverride';
import { TaxWaiver } from '../order-detail/TaxWaiver';
import { FeeWaiver } from '../shared/FeeWaiver';
import { ItemsEditor } from '../shared/ItemsEditor';
import { CustomerSelector } from '../invoice/CustomerSelector';
import { NewCustomerForm } from '../invoice/NewCustomerForm';
import { InvoiceSuccessMessage } from '../invoice/InvoiceSuccessMessage';
import { AdminMessageSection } from '../invoice/AdminMessageSection';
import { useInvoiceData } from '../../hooks/useInvoiceData';
import { useInvoicePricing } from '../../hooks/useInvoicePricing';
import { useCartManagement } from '../../hooks/useCartManagement';
import { useCustomerManagement } from '../../hooks/useCustomerManagement';
import { useEventDetails } from '../../hooks/useEventDetails';
import { useDepositOverride } from '../../hooks/useDepositOverride';
import { generateInvoice } from '../../lib/invoiceService';
import { buildInvoiceSummary } from '../../lib/invoiceSummaryBuilder';
import { checkMultipleUnitsAvailability } from '../../lib/availability';

export function InvoiceBuilder() {
  const { customers, units, pricingRules, addCustomer } = useInvoiceData();
  const { cartItems, addItemToCart, removeItemFromCart, updateItemQuantity, updateItemPrice, clearCart } =
    useCartManagement();
  const customerManagement = useCustomerManagement();
  const { eventDetails, updateEventDetails, resetEventDetails } = useEventDetails();

  const [discounts, setDiscounts] = useState<any[]>([]);
  const [customFees, setCustomFees] = useState<any[]>([]);
  const [adminMessage, setAdminMessage] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [taxWaived, setTaxWaived] = useState(false);
  const [taxWaiveReason, setTaxWaiveReason] = useState('');
  const [travelFeeWaived, setTravelFeeWaived] = useState(false);
  const [travelFeeWaiveReason, setTravelFeeWaiveReason] = useState('');
  const [sameDayPickupFeeWaived, setSameDayPickupFeeWaived] = useState(false);
  const [sameDayPickupFeeWaiveReason, setSameDayPickupFeeWaiveReason] = useState('');
  const [surfaceFeeWaived, setSurfaceFeeWaived] = useState(false);
  const [surfaceFeeWaiveReason, setSurfaceFeeWaiveReason] = useState('');
  const [generatorFeeWaived, setGeneratorFeeWaived] = useState(false);
  const [generatorFeeWaiveReason, setGeneratorFeeWaiveReason] = useState('');

  const pricing = useInvoicePricing(cartItems, eventDetails, pricingRules, discounts, customFees);
  const deposit = useDepositOverride(pricing.defaultDeposit);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (customerManagement.showCustomerDropdown && !target.closest('.customer-search-container')) {
        customerManagement.setShowCustomerDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customerManagement.showCustomerDropdown]);

  async function handleCreateNewCustomer() {
    const customer = await customerManagement.createNewCustomer(addCustomer);
    if (customer) {
      addCustomer(customer);
    }
  }

  async function handleGenerateInvoice() {
    if (cartItems.length === 0) {
      showToast('Please add at least one item to the cart', 'error');
      return;
    }

    if (!eventDetails.event_date || !eventDetails.address_line1) {
      showToast('Please fill in event details (date and address)', 'error');
      return;
    }

    setSaving(true);
    try {
      // Check availability before creating invoice
      const availabilityChecks = cartItems.map(item => ({
        unitId: item.unit_id,
        eventStartDate: eventDetails.event_date,
        eventEndDate: eventDetails.event_end_date,
      }));

      const availabilityResults = await checkMultipleUnitsAvailability(availabilityChecks);
      const unavailableUnits = availabilityResults.filter(result => !result.isAvailable);

      if (unavailableUnits.length > 0) {
        const unitNames = unavailableUnits.map(u => {
          const unit = units.find(unit => unit.id === u.unitId);
          return unit?.name || 'Unknown unit';
        }).join(', ');

        showToast(
          `Cannot create invoice: The following units are not available for the selected dates: ${unitNames}. Please check the calendar for conflicts.`,
          'error'
        );
        setSaving(false);
        return;
      }

      const customer = customers.find(c => c.id === customerManagement.selectedCustomer);

      const result = await generateInvoice(
        {
          customerId: customerManagement.selectedCustomer || null,
          cartItems,
          eventDetails,
          priceBreakdown: pricing.priceBreakdown,
          subtotal: pricing.subtotal,
          taxCents: adjustedTaxCents,
          depositRequired: deposit.depositRequired,
          totalCents: adjustedTotalCents,
          customDepositCents: deposit.customDepositCents,
          discounts,
          customFees,
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
        },
        customer
      );

      setInvoiceUrl(result.invoiceUrl);

      if (!customerManagement.selectedCustomer) {
        showToast('Invoice created! Copy the link below to send to your customer.', 'success');
      } else {
        showToast(`Invoice sent to ${customer.email} and ${customer.phone}!`, 'success');
      }

      clearCart();
      setDiscounts([]);
      setCustomFees([]);
      deposit.resetDeposit();
      setAdminMessage('');
      setTaxWaived(false);
      setTaxWaiveReason('');
      setTravelFeeWaived(false);
      setTravelFeeWaiveReason('');
      setSameDayPickupFeeWaived(false);
      setSameDayPickupFeeWaiveReason('');
      setSurfaceFeeWaived(false);
      setSurfaceFeeWaiveReason('');
      setGeneratorFeeWaived(false);
      setGeneratorFeeWaiveReason('');
      customerManagement.setSelectedCustomer('');
      resetEventDetails();
    } catch (error) {
      console.error('Error generating invoice:', error);
      showToast('Failed to generate invoice: ' + (error instanceof Error ? error.message : String(error)), 'error');
    } finally {
      setSaving(false);
    }
  }

  const adjustedTaxCents = useMemo(() => {
    if (taxWaived) return 0;

    const travelFee = travelFeeWaived ? 0 : (pricing.priceBreakdown?.travel_fee_cents || 0);
    const surfaceFee = surfaceFeeWaived ? 0 : (pricing.priceBreakdown?.surface_fee_cents || 0);
    const sameDayFee = sameDayPickupFeeWaived ? 0 : (pricing.priceBreakdown?.same_day_pickup_fee_cents || 0);
    const generatorFee = generatorFeeWaived ? 0 : (pricing.priceBreakdown?.generator_fee_cents || 0);

    const adjustedFees = travelFee + surfaceFee + sameDayFee + generatorFee;
    const taxableAmount = Math.max(0, pricing.actualSubtotal + adjustedFees - pricing.discountTotal + pricing.customFeesTotal);
    return Math.round(taxableAmount * 0.06);
  }, [pricing, taxWaived, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived]);

  const adjustedTotalCents = useMemo(() => {
    const travelFee = travelFeeWaived ? 0 : (pricing.priceBreakdown?.travel_fee_cents || 0);
    const surfaceFee = surfaceFeeWaived ? 0 : (pricing.priceBreakdown?.surface_fee_cents || 0);
    const sameDayFee = sameDayPickupFeeWaived ? 0 : (pricing.priceBreakdown?.same_day_pickup_fee_cents || 0);
    const generatorFee = generatorFeeWaived ? 0 : (pricing.priceBreakdown?.generator_fee_cents || 0);

    const adjustedFees = travelFee + surfaceFee + sameDayFee + generatorFee;
    return pricing.actualSubtotal + adjustedFees - pricing.discountTotal + pricing.customFeesTotal + adjustedTaxCents;
  }, [pricing, adjustedTaxCents, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived]);

  const orderSummary = useMemo(
    () =>
      buildInvoiceSummary({
        cartItems,
        priceBreakdown: pricing.priceBreakdown,
        discounts,
        customFees,
        subtotal: pricing.subtotal,
        taxableAmount: pricing.taxableAmount,
        taxCents: adjustedTaxCents,
        totalCents: adjustedTotalCents,
        depositRequired: deposit.depositRequired,
        eventDetails,
        travelFeeWaived,
        sameDayPickupFeeWaived,
        surfaceFeeWaived,
        generatorFeeWaived,
      }),
    [cartItems, pricing, discounts, customFees, deposit.depositRequired, eventDetails, travelFeeWaived, sameDayPickupFeeWaived, surfaceFeeWaived, generatorFeeWaived, adjustedTaxCents, adjustedTotalCents]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Invoice Builder</h2>
        <p className="text-sm sm:text-base text-slate-600 mb-4 sm:mb-6">
          Build a custom invoice for a customer by selecting items and adjusting prices as needed.
        </p>
      </div>

      {invoiceUrl && (
        <InvoiceSuccessMessage invoiceUrl={invoiceUrl} hasSelectedCustomer={!!customerManagement.selectedCustomer} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6 min-w-0">
          <CustomerSelector
            customers={customers}
            selectedCustomer={customerManagement.selectedCustomer}
            customerSearchQuery={customerManagement.customerSearchQuery}
            showDropdown={customerManagement.showCustomerDropdown}
            showNewCustomerForm={customerManagement.showNewCustomerForm}
            onSearchChange={customerManagement.setCustomerSearchQuery}
            onCustomerSelect={customerManagement.setSelectedCustomer}
            onClearCustomer={customerManagement.clearCustomer}
            onToggleNewForm={customerManagement.toggleNewCustomerForm}
            onShowDropdown={customerManagement.setShowCustomerDropdown}
          />

          {customerManagement.showNewCustomerForm && (
            <NewCustomerForm
              newCustomer={customerManagement.newCustomer}
              onChange={customerManagement.setNewCustomer}
              onSubmit={handleCreateNewCustomer}
              onCancel={() => customerManagement.setShowNewCustomerForm(false)}
            />
          )}

          <EventDetailsEditor
            editedOrder={eventDetails}
            pricingRules={pricingRules}
            onOrderChange={updateEventDetails}
            onAddressSelect={result => {
              updateEventDetails({
                address_line1: result.street,
                city: result.city,
                state: result.state,
                zip: result.zip,
                lat: result.lat,
                lng: result.lng,
              });
            }}
            compact={false}
            showUntilEndOfDay={true}
          />

          <ItemsEditor
            items={cartItems}
            units={units}
            onRemoveItem={removeItemFromCart}
            onAddItem={addItemToCart}
            onUpdateQuantity={updateItemQuantity}
            onUpdatePrice={updateItemPrice}
            allowQuantityEdit={true}
            allowPriceEdit={false}
            title="Items"
            removeByIndex={true}
          />
        </div>

        <div className="space-y-4 sm:space-y-6 min-w-0">
          <DiscountsManager discounts={discounts} onDiscountChange={setDiscounts} onMarkChanges={() => {}} />

          <CustomFeesManager customFees={customFees} onFeeChange={setCustomFees} onMarkChanges={() => {}} />

          <DepositOverride
            calculatedDepositCents={pricing.defaultDeposit}
            customDepositCents={deposit.customDepositCents}
            customDepositInput={deposit.customDepositInput}
            onInputChange={deposit.setCustomDepositInput}
            onApply={deposit.applyDepositOverride}
            onClear={deposit.clearDepositOverride}
            compact={false}
            showZeroHint={true}
          />

          <TaxWaiver
            taxCents={pricing.taxCents}
            taxWaived={taxWaived}
            taxWaiveReason={taxWaiveReason}
            onToggle={(reason) => {
              setTaxWaived(!taxWaived);
              setTaxWaiveReason(reason);
            }}
            compact={false}
          />

          <FeeWaiver
            feeName="Travel Fee"
            feeAmount={pricing.priceBreakdown?.travel_fee_cents || 0}
            isWaived={travelFeeWaived}
            waiveReason={travelFeeWaiveReason}
            onToggle={(reason) => {
              setTravelFeeWaived(!travelFeeWaived);
              setTravelFeeWaiveReason(reason);
            }}
            color="orange"
            compact={false}
          />

          {((pricing.priceBreakdown?.same_day_pickup_fee_cents || 0) > 0 || sameDayPickupFeeWaived) && (
            <FeeWaiver
              feeName="Same Day Pickup Fee"
              feeAmount={pricing.priceBreakdown?.same_day_pickup_fee_cents || 0}
              isWaived={sameDayPickupFeeWaived}
              waiveReason={sameDayPickupFeeWaiveReason}
              onToggle={(reason) => {
                setSameDayPickupFeeWaived(!sameDayPickupFeeWaived);
                setSameDayPickupFeeWaiveReason(reason);
              }}
              color="blue"
              compact={false}
            />
          )}

          {((pricing.priceBreakdown?.surface_fee_cents || 0) > 0 || surfaceFeeWaived) && (
            <FeeWaiver
              feeName="Sandbags Fee"
              feeAmount={pricing.priceBreakdown?.surface_fee_cents || 0}
              isWaived={surfaceFeeWaived}
              waiveReason={surfaceFeeWaiveReason}
              onToggle={(reason) => {
                setSurfaceFeeWaived(!surfaceFeeWaived);
                setSurfaceFeeWaiveReason(reason);
              }}
              color="orange"
              compact={false}
            />
          )}

          {((pricing.priceBreakdown?.generator_fee_cents || 0) > 0 || generatorFeeWaived) && (
            <FeeWaiver
              feeName="Generator Fee"
              feeAmount={pricing.priceBreakdown?.generator_fee_cents || 0}
              isWaived={generatorFeeWaived}
              waiveReason={generatorFeeWaiveReason}
              onToggle={(reason) => {
                setGeneratorFeeWaived(!generatorFeeWaived);
                setGeneratorFeeWaiveReason(reason);
              }}
              color="blue"
              compact={false}
            />
          )}


          <AdminMessageSection message={adminMessage} onChange={setAdminMessage} />

          {orderSummary && (
            <OrderSummary
              summary={orderSummary}
              showDeposit={true}
              showTip={false}
              title="Invoice Summary"
              taxWaived={taxWaived}
              travelFeeWaived={travelFeeWaived}
              surfaceFeeWaived={surfaceFeeWaived}
              generatorFeeWaived={generatorFeeWaived}
              sameDayPickupFeeWaived={sameDayPickupFeeWaived}
            />
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-3 sm:p-4 lg:p-6 min-w-0">
            <button
              onClick={handleGenerateInvoice}
              disabled={saving || cartItems.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Send className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
              <span className="truncate">
                {saving
                  ? 'Generating...'
                  : customerManagement.selectedCustomer
                    ? 'Send Invoice to Customer'
                    : 'Generate Shareable Link'}
              </span>
            </button>
            <p className="text-xs text-slate-500 text-center mt-2">
              {customerManagement.selectedCustomer
                ? 'Invoice will be sent via email and SMS'
                : 'A shareable link will be generated for you to send manually'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
