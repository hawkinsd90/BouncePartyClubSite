import { useState, useEffect, useMemo } from 'react';
import { Send } from 'lucide-react';
import { OrderSummary } from '../order/OrderSummary';
import { showToast } from '../../lib/notifications';
import { EventDetailsEditor } from '../order-detail/EventDetailsEditor';
import { DepositOverride } from '../order-detail/DepositOverride';
import { TaxWaiver } from '../order-detail/TaxWaiver';
import { CustomerSelector } from '../invoice/CustomerSelector';
import { NewCustomerForm } from '../invoice/NewCustomerForm';
import { CartItemsList } from '../invoice/CartItemsList';
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

export function CrewInvoiceBuilder() {
  const { customers, units, pricingRules, addCustomer } = useInvoiceData();
  const { cartItems, addItemToCart, removeItemFromCart, updateItemQuantity, updateItemPrice, clearCart } =
    useCartManagement();
  const customerManagement = useCustomerManagement();
  const { eventDetails, updateEventDetails, resetEventDetails } = useEventDetails();

  const [adminMessage, setAdminMessage] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [taxWaived, setTaxWaived] = useState(false);

  const pricing = useInvoicePricing(cartItems, eventDetails, pricingRules, [], []);
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
      const customer = customers.find(c => c.id === customerManagement.selectedCustomer);

      const result = await generateInvoice(
        {
          customerId: customerManagement.selectedCustomer || null,
          cartItems,
          eventDetails,
          priceBreakdown: pricing.priceBreakdown,
          subtotal: pricing.subtotal,
          taxCents: pricing.taxCents,
          depositRequired: deposit.depositRequired,
          totalCents: pricing.totalCents,
          customDepositCents: deposit.customDepositCents,
          discounts: [],
          customFees: [],
          adminMessage,
          taxWaived,
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
      deposit.resetDeposit();
      setAdminMessage('');
      setTaxWaived(false);
      customerManagement.setSelectedCustomer('');
      resetEventDetails();
    } catch (error) {
      console.error('Error generating invoice:', error);
      showToast('Failed to generate invoice: ' + (error instanceof Error ? error.message : String(error)), 'error');
    } finally {
      setSaving(false);
    }
  }

  const orderSummary = useMemo(
    () =>
      buildInvoiceSummary({
        cartItems,
        priceBreakdown: pricing.priceBreakdown,
        discounts: [],
        customFees: [],
        subtotal: pricing.subtotal,
        taxableAmount: pricing.taxableAmount,
        taxCents: pricing.taxCents,
        totalCents: pricing.totalCents,
        depositRequired: deposit.depositRequired,
        eventDetails,
      }),
    [cartItems, pricing, deposit.depositRequired, eventDetails]
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6">Invoice Builder</h2>
        <p className="text-sm sm:text-base text-slate-600 mb-4 sm:mb-6">
          Build a custom invoice for a customer by selecting items and adjusting prices as needed.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800">
            <strong>Note:</strong> To add discounts or custom fees to an invoice, please ask an admin to create the invoice.
          </p>
        </div>
      </div>

      {invoiceUrl && (
        <InvoiceSuccessMessage invoiceUrl={invoiceUrl} hasSelectedCustomer={!!customerManagement.selectedCustomer} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
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

          <CartItemsList
            cartItems={cartItems}
            units={units}
            onRemoveItem={removeItemFromCart}
            onUpdateQuantity={updateItemQuantity}
            onUpdatePrice={updateItemPrice}
            onAddUnit={addItemToCart}
          />
        </div>

        <div className="space-y-4 sm:space-y-6">
          <DepositOverride
            calculatedDepositCents={pricing.defaultDeposit}
            customDepositCents={deposit.customDepositCents}
            customDepositInput={deposit.customDepositInput}
            onInputChange={deposit.setCustomDepositInput}
            onApply={deposit.applyDepositOverride}
            onClear={deposit.clearDepositOverride}
            compact={true}
            showZeroHint={true}
          />

          <TaxWaiver
            taxCents={pricing.taxCents}
            taxWaived={taxWaived}
            onToggle={() => setTaxWaived(!taxWaived)}
            compact={true}
          />

          <AdminMessageSection message={adminMessage} onChange={setAdminMessage} />

          {orderSummary && (
            <OrderSummary
              summary={orderSummary}
              showDeposit={true}
              showTip={false}
              title="Invoice Summary"
              taxWaived={taxWaived}
            />
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-6">
            <button
              onClick={handleGenerateInvoice}
              disabled={saving || cartItems.length === 0}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Send className="w-5 h-5" />
              {saving
                ? 'Generating...'
                : customerManagement.selectedCustomer
                  ? 'Send Invoice to Customer'
                  : 'Generate Shareable Link'}
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
