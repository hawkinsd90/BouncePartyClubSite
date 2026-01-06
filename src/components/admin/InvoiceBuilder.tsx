import { useState, useEffect } from 'react';
import { Send, AlertCircle } from 'lucide-react';
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
import { AdminMessage } from '../order-detail/AdminMessage';
import { useInvoiceData } from '../../hooks/useInvoiceData';
import { usePricing } from '../../hooks/usePricing';
import { useCartManagement } from '../../hooks/useCartManagement';
import { useCustomerManagement } from '../../hooks/useCustomerManagement';
import { useEventDetails } from '../../hooks/useEventDetails';
import { generateInvoice } from '../../lib/invoiceService';
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
  const [customDepositCents, setCustomDepositCents] = useState<number | null>(null);
  const [customDepositInput, setCustomDepositInput] = useState('');
  const [availabilityIssues, setAvailabilityIssues] = useState<any[]>([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const { orderSummary, calculatedPricing, calculatePricing } = usePricing();

  // Calculate pricing whenever dependencies change
  useEffect(() => {
    if (
      cartItems.length > 0 &&
      pricingRules &&
      eventDetails.address_zip &&
      eventDetails.event_date &&
      eventDetails.event_end_date
    ) {
      const items = cartItems.map(item => ({
        unit_id: item.unit_id,
        unit_name: item.unit_name,
        qty: item.qty,
        wet_or_dry: item.mode,
        unit_price_cents: item.adjusted_price_cents,
      }));

      calculatePricing({
        items,
        eventDetails: {
          event_date: eventDetails.event_date,
          event_end_date: eventDetails.event_end_date,
          location_type: eventDetails.location_type as 'residential' | 'commercial',
          surface: eventDetails.surface as 'grass' | 'cement',
          pickup_preference: eventDetails.pickup_preference,
          generator_qty: eventDetails.generator_qty,
          address_line1: eventDetails.address_line1,
          address_city: eventDetails.city,
          address_state: eventDetails.state,
          address_zip: eventDetails.zip,
          lat: eventDetails.lat,
          lng: eventDetails.lng,
        },
        discounts,
        customFees,
        customDepositCents,
        pricingRules,
        feeWaivers: {
          taxWaived,
          travelFeeWaived,
          sameDayPickupFeeWaived,
          surfaceFeeWaived,
          generatorFeeWaived,
        },
      });
    }
  }, [
    cartItems,
    eventDetails,
    discounts,
    customFees,
    customDepositCents,
    pricingRules,
    taxWaived,
    travelFeeWaived,
    sameDayPickupFeeWaived,
    surfaceFeeWaived,
    generatorFeeWaived,
    calculatePricing,
  ]);

  // Check availability whenever cart items or dates change
  useEffect(() => {
    checkAvailability();
  }, [cartItems, eventDetails.event_date, eventDetails.event_end_date]);

  async function checkAvailability() {
    if (!eventDetails.event_date || !eventDetails.event_end_date || cartItems.length === 0) {
      setAvailabilityIssues([]);
      return;
    }

    setCheckingAvailability(true);
    try {
      const checks = cartItems.map(item => ({
        unitId: item.unit_id,
        eventStartDate: eventDetails.event_date,
        eventEndDate: eventDetails.event_end_date,
      }));

      const results = await checkMultipleUnitsAvailability(checks);
      const issues = results
        .filter(result => !result.isAvailable)
        .map(result => {
          const item = cartItems.find(i => i.unit_id === result.unitId);
          return {
            unitName: item?.unit_name || 'Unknown',
            unitId: result.unitId,
            conflicts: result.conflictingOrders,
          };
        });

      setAvailabilityIssues(issues);
    } catch (error) {
      console.error('Error checking availability:', error);
    } finally {
      setCheckingAvailability(false);
    }
  }

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

      if (!calculatedPricing) {
        showToast('Pricing calculation in progress. Please wait...', 'error');
        return;
      }

      const customer = customers.find(c => c.id === customerManagement.selectedCustomer);

      const result = await generateInvoice(
        {
          customerId: customerManagement.selectedCustomer || null,
          cartItems,
          eventDetails,
          priceBreakdown: {
            subtotal_cents: calculatedPricing.subtotal_cents,
            travel_fee_cents: calculatedPricing.travel_fee_cents,
            travel_total_miles: calculatedPricing.travel_total_miles,
            surface_fee_cents: calculatedPricing.surface_fee_cents,
            same_day_pickup_fee_cents: calculatedPricing.same_day_pickup_fee_cents,
            generator_fee_cents: calculatedPricing.generator_fee_cents,
          },
          subtotal: calculatedPricing.subtotal_cents,
          taxCents: calculatedPricing.tax_cents,
          depositRequired: calculatedPricing.deposit_due_cents,
          totalCents: calculatedPricing.total_cents,
          customDepositCents,
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
      setCustomDepositCents(null);
      setCustomDepositInput('');
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
            compact={true}
            showUntilEndOfDay={true}
          />

          {checkingAvailability && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">Checking availability...</p>
            </div>
          )}

          {availabilityIssues.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-semibold text-red-900 mb-2">Availability Conflicts</h4>
                  <p className="text-sm text-red-800 mb-3">
                    The following units are not available for the selected dates:
                  </p>
                  <ul className="space-y-2">
                    {availabilityIssues.map((issue, index) => (
                      <li key={index} className="text-sm">
                        <span className="font-medium text-red-900">{issue.unitName}</span>
                        <span className="text-red-700"> - Conflicts with {issue.conflicts.length} order(s)</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-red-700 mt-3">
                    Please remove these items or select different dates to proceed.
                  </p>
                </div>
              </div>
            </div>
          )}

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
            calculatedDepositCents={calculatedPricing?.deposit_due_cents || 0}
            customDepositCents={customDepositCents}
            customDepositInput={customDepositInput}
            onInputChange={setCustomDepositInput}
            onApply={(amountCents) => setCustomDepositCents(amountCents)}
            onClear={() => {
              setCustomDepositCents(null);
              setCustomDepositInput('');
            }}
            compact={true}
            showZeroHint={true}
          />

          <TaxWaiver
            taxCents={calculatedPricing?.tax_cents || 0}
            taxWaived={taxWaived}
            taxWaiveReason={taxWaiveReason}
            onToggle={(reason) => {
              setTaxWaived(!taxWaived);
              setTaxWaiveReason(reason);
            }}
            compact={true}
          />

          <FeeWaiver
            feeName="Travel Fee"
            feeAmount={calculatedPricing?.travel_fee_cents || 0}
            isWaived={travelFeeWaived}
            waiveReason={travelFeeWaiveReason}
            onToggle={(reason) => {
              setTravelFeeWaived(!travelFeeWaived);
              setTravelFeeWaiveReason(reason);
            }}
            color="orange"
            compact={true}
          />

          {(calculatedPricing?.same_day_pickup_fee_cents || 0) > 0 && (
            <FeeWaiver
              feeName="Same Day Pickup Fee"
              feeAmount={calculatedPricing?.same_day_pickup_fee_cents || 0}
              isWaived={sameDayPickupFeeWaived}
              waiveReason={sameDayPickupFeeWaiveReason}
              onToggle={(reason) => {
                setSameDayPickupFeeWaived(!sameDayPickupFeeWaived);
                setSameDayPickupFeeWaiveReason(reason);
              }}
              color="blue"
              compact={true}
            />
          )}

          {(calculatedPricing?.surface_fee_cents || 0) > 0 && (
            <FeeWaiver
              feeName="Sandbags Fee"
              feeAmount={calculatedPricing?.surface_fee_cents || 0}
              isWaived={surfaceFeeWaived}
              waiveReason={surfaceFeeWaiveReason}
              onToggle={(reason) => {
                setSurfaceFeeWaived(!surfaceFeeWaived);
                setSurfaceFeeWaiveReason(reason);
              }}
              color="orange"
              compact={true}
            />
          )}

          {(calculatedPricing?.generator_fee_cents || 0) > 0 && (
            <FeeWaiver
              feeName="Generator Fee"
              feeAmount={calculatedPricing?.generator_fee_cents || 0}
              isWaived={generatorFeeWaived}
              waiveReason={generatorFeeWaiveReason}
              onToggle={(reason) => {
                setGeneratorFeeWaived(!generatorFeeWaived);
                setGeneratorFeeWaiveReason(reason);
              }}
              color="blue"
              compact={true}
            />
          )}


          <AdminMessage value={adminMessage} onChange={setAdminMessage} compact={true} variant="invoice" />

          {orderSummary && (
            <OrderSummary
              summary={orderSummary}
              showDeposit={true}
              showTip={false}
              title="Invoice Summary"
              customDepositCents={customDepositCents}
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
              disabled={saving || cartItems.length === 0 || availabilityIssues.length > 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg transition-colors flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              <Send className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
              <span className="truncate">
                {saving
                  ? 'Generating...'
                  : availabilityIssues.length > 0
                    ? 'Resolve Availability Issues'
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
