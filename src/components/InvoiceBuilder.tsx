import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/pricing';
import { Plus, Trash2, DollarSign, Percent, Save } from 'lucide-react';

export function InvoiceBuilder() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [discountType, setDiscountType] = useState<'dollar' | 'percent'>('dollar');
  const [discountValue, setDiscountValue] = useState('0');
  const [waiveDeposit, setWaiveDeposit] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [customersRes, unitsRes] = await Promise.all([
      supabase.from('customers').select('*').order('last_name'),
      supabase.from('units').select('*').eq('active', true).order('name'),
    ]);

    if (customersRes.data) setCustomers(customersRes.data);
    if (unitsRes.data) setUnits(unitsRes.data);
  }

  function addItemToCart(unit: any, mode: 'dry' | 'water') {
    const price = mode === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents;

    setCartItems([
      ...cartItems,
      {
        id: crypto.randomUUID(),
        unit_id: unit.id,
        unit_name: unit.name,
        mode,
        price_cents: price,
        adjusted_price_cents: price,
        qty: 1,
      },
    ]);
  }

  function removeItemFromCart(itemId: string) {
    setCartItems(cartItems.filter(item => item.id !== itemId));
  }

  function updateItemQuantity(itemId: string, qty: number) {
    setCartItems(
      cartItems.map(item =>
        item.id === itemId ? { ...item, qty: Math.max(1, qty) } : item
      )
    );
  }

  function updateItemPrice(itemId: string, priceCents: number) {
    setCartItems(
      cartItems.map(item =>
        item.id === itemId ? { ...item, adjusted_price_cents: priceCents } : item
      )
    );
  }

  const subtotal = cartItems.reduce((sum, item) => sum + item.adjusted_price_cents * item.qty, 0);

  let discountAmount = 0;
  if (discountType === 'dollar') {
    discountAmount = Math.round(parseFloat(discountValue || '0') * 100);
  } else {
    discountAmount = Math.round(subtotal * (parseFloat(discountValue || '0') / 100));
  }

  const totalAfterDiscount = Math.max(0, subtotal - discountAmount);
  const depositRequired = waiveDeposit ? 0 : Math.round(totalAfterDiscount * 0.5);

  async function handleGenerateInvoice() {
    if (!selectedCustomer) {
      alert('Please select a customer');
      return;
    }

    if (cartItems.length === 0) {
      alert('Please add at least one item to the cart');
      return;
    }

    setSaving(true);
    try {
      alert('Invoice generation feature coming soon - will create order and invoice records');
    } catch (error) {
      console.error('Error generating invoice:', error);
      alert('Failed to generate invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-6">Invoice Builder</h2>
        <p className="text-slate-600 mb-6">
          Build a custom invoice for a customer by selecting items and adjusting prices as needed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Select Customer</h3>
            <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a customer...</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.first_name} {customer.last_name} - {customer.email}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Available Units</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {units.map(unit => (
                <div key={unit.id} className="border border-slate-200 rounded-lg p-3">
                  <p className="font-medium text-slate-900 text-sm">{unit.name}</p>
                  <p className="text-xs text-slate-600 mb-2">{unit.dimensions}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addItemToCart(unit, 'dry')}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded"
                    >
                      Dry {formatCurrency(unit.price_dry_cents)}
                    </button>
                    {unit.price_water_cents && (
                      <button
                        onClick={() => addItemToCart(unit, 'water')}
                        className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white text-xs py-1 px-2 rounded"
                      >
                        Water {formatCurrency(unit.price_water_cents)}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Cart Items</h3>
            {cartItems.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No items in cart</p>
            ) : (
              <div className="space-y-3">
                {cartItems.map(item => (
                  <div key={item.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-slate-900">{item.unit_name}</p>
                        <p className="text-xs text-slate-600 capitalize">{item.mode} Mode</p>
                      </div>
                      <button
                        onClick={() => removeItemFromCart(item.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">Quantity</label>
                        <input
                          type="number"
                          min="1"
                          value={item.qty}
                          onChange={(e) => updateItemQuantity(item.id, parseInt(e.target.value))}
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">Price Each</label>
                        <input
                          type="number"
                          step="0.01"
                          value={(item.adjusted_price_cents / 100).toFixed(2)}
                          onChange={(e) => updateItemPrice(item.id, Math.round(parseFloat(e.target.value) * 100))}
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-right">
                      <span className="text-sm text-slate-600">Line Total: </span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(item.adjusted_price_cents * item.qty)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Discounts & Adjustments</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Discount Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDiscountType('dollar')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border-2 transition-colors ${
                      discountType === 'dollar'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    <DollarSign className="w-4 h-4" />
                    Dollar
                  </button>
                  <button
                    onClick={() => setDiscountType('percent')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border-2 transition-colors ${
                      discountType === 'percent'
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-300 text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    <Percent className="w-4 h-4" />
                    Percent
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Discount Amount {discountType === 'percent' && '(%)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="waive-deposit"
                  checked={waiveDeposit}
                  onChange={(e) => setWaiveDeposit(e.target.checked)}
                  className="mr-2"
                />
                <label htmlFor="waive-deposit" className="text-sm text-slate-700">
                  Waive Deposit (Full payment required)
                </label>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Invoice Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Subtotal:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(subtotal)}</span>
              </div>

              {discountAmount > 0 && (
                <div className="flex justify-between text-red-700">
                  <span>Discount:</span>
                  <span className="font-semibold">-{formatCurrency(discountAmount)}</span>
                </div>
              )}

              <div className="flex justify-between pt-2 border-t border-blue-300">
                <span className="font-semibold text-slate-900">Total:</span>
                <span className="text-xl font-bold text-blue-600">{formatCurrency(totalAfterDiscount)}</span>
              </div>

              <div className="flex justify-between pt-2 border-t border-blue-300">
                <span className="text-slate-600">Deposit {waiveDeposit && '(Waived)'}:</span>
                <span className="font-semibold text-green-700">{formatCurrency(depositRequired)}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-600">Balance Due:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(totalAfterDiscount - depositRequired)}</span>
              </div>
            </div>

            <button
              onClick={handleGenerateInvoice}
              disabled={saving || !selectedCustomer || cartItems.length === 0}
              className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Save className="w-5 h-5" />
              {saving ? 'Generating...' : 'Generate Invoice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
