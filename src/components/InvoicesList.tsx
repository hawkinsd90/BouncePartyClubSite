import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Calendar, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../lib/pricing';

export function InvoicesList() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadInvoices();
  }, []);

  async function loadInvoices() {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('invoices')
        .select(`
          *,
          customers (first_name, last_name, email),
          orders (event_date)
        `)
        .order('created_at', { ascending: false });

      if (data) setInvoices(data);
    } catch (error) {
      console.error('Error loading invoices:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerateManualInvoice() {
    const orderIdPrompt = prompt('Enter Order ID to generate invoice for:');
    if (!orderIdPrompt) return;

    try {
      const { data: order } = await supabase
        .from('orders')
        .select('*, customers(first_name, last_name, email)')
        .eq('id', orderIdPrompt)
        .maybeSingle();

      if (!order) {
        alert('Order not found');
        return;
      }

      const { data: invoiceNumberData } = await supabase.rpc('generate_invoice_number');
      const invoiceNumber = invoiceNumberData || `INV-${Date.now()}`;

      const totalCents = order.subtotal_cents + order.travel_fee_cents +
                        order.surface_fee_cents + order.same_day_pickup_fee_cents + order.tax_cents;

      await supabase.from('invoices').insert({
        invoice_number: invoiceNumber,
        order_id: order.id,
        customer_id: order.customer_id,
        invoice_date: new Date().toISOString().split('T')[0],
        due_date: order.event_date,
        status: 'draft',
        subtotal_cents: order.subtotal_cents,
        tax_cents: order.tax_cents,
        travel_fee_cents: order.travel_fee_cents,
        surface_fee_cents: order.surface_fee_cents,
        same_day_pickup_fee_cents: order.same_day_pickup_fee_cents,
        total_cents: totalCents,
        paid_amount_cents: order.deposit_paid_cents || 0,
        payment_method: 'card',
      });

      alert(`Invoice ${invoiceNumber} generated successfully!`);
      loadInvoices();
    } catch (error) {
      console.error('Error generating invoice:', error);
      alert('Failed to generate invoice');
    }
  }

  async function handleViewInvoice(invoice: any) {
    const invoiceDetails = `
BOUNCE PARTY CLUB
Invoice: ${invoice.invoice_number}
Date: ${format(new Date(invoice.invoice_date), 'MMMM d, yyyy')}

Customer: ${invoice.customers?.first_name} ${invoice.customers?.last_name}
Email: ${invoice.customers?.email}
Event Date: ${invoice.orders?.event_date}

CHARGES:
Subtotal: ${formatCurrency(invoice.subtotal_cents)}
Travel Fee: ${formatCurrency(invoice.travel_fee_cents)}
Surface Fee: ${formatCurrency(invoice.surface_fee_cents)}
Same Day Pickup: ${formatCurrency(invoice.same_day_pickup_fee_cents)}
Tax: ${formatCurrency(invoice.tax_cents)}

TOTAL: ${formatCurrency(invoice.total_cents)}
Paid: ${formatCurrency(invoice.paid_amount_cents)}
Balance Due: ${formatCurrency(invoice.total_cents - invoice.paid_amount_cents)}

Status: ${invoice.status.toUpperCase()}
Payment Method: ${invoice.payment_method || 'N/A'}
    `.trim();

    alert(invoiceDetails);
  }

  const filteredInvoices = invoices.filter(invoice => {
    if (filter === 'paid') return invoice.status === 'paid';
    if (filter === 'unpaid') return invoice.status !== 'paid' && invoice.status !== 'cancelled';
    if (filter === 'draft') return invoice.status === 'draft';
    return true;
  });

  if (loading) {
    return <div className="text-center py-8">Loading invoices...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Invoices</h2>
          <p className="text-slate-600 mt-1">
            {invoices.length} total invoices
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('draft')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === 'draft'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Draft
          </button>
          <button
            onClick={() => setFilter('unpaid')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === 'unpaid'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Unpaid
          </button>
          <button
            onClick={() => setFilter('paid')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              filter === 'paid'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Paid
          </button>
          <button
            onClick={handleGenerateManualInvoice}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + Generate Invoice
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Invoice #
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Total
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Paid
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Balance
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {filteredInvoices.map((invoice) => (
              <tr key={invoice.id} className="hover:bg-slate-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-sm">
                    <FileText className="w-4 h-4 mr-2 text-slate-400" />
                    <span className="font-medium text-slate-900">{invoice.invoice_number}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-slate-900">
                    {invoice.customers?.first_name} {invoice.customers?.last_name}
                  </div>
                  <div className="text-sm text-slate-500">{invoice.customers?.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                  <div className="flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-slate-400" />
                    {format(new Date(invoice.invoice_date), 'MMM d, yyyy')}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                  {formatCurrency(invoice.total_cents)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                  {formatCurrency(invoice.paid_amount_cents)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-600">
                  {formatCurrency(invoice.total_cents - invoice.paid_amount_cents)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    invoice.status === 'paid'
                      ? 'bg-green-100 text-green-800'
                      : invoice.status === 'sent'
                      ? 'bg-blue-100 text-blue-800'
                      : invoice.status === 'draft'
                      ? 'bg-slate-100 text-slate-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {invoice.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <button
                    onClick={() => handleViewInvoice(invoice)}
                    className="text-blue-600 hover:text-blue-800 flex items-center"
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
