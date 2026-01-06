import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { FileText, Calendar, Eye, Edit } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '../../lib/pricing';
import { useSupabaseQuery, useMutation } from '../../hooks/useDataFetch';
import { notifySuccess } from '../../lib/notifications';

interface Invoice {
  id: string;
  order_id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  subtotal_cents: number;
  tax_cents: number;
  travel_fee_cents: number;
  surface_fee_cents: number;
  same_day_pickup_fee_cents: number;
  total_cents: number;
  paid_amount_cents: number;
  travel_total_miles: number | string;
  payment_method: string;
  customers?: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
  orders?: {
    event_date: string;
  } | null;
}

export function InvoicesList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');

  const fetchInvoices = useCallback(async () => {
    const result = await supabase
      .from('invoices')
      .select(`
        *,
        customers (first_name, last_name, email),
        orders (event_date)
      `)
      .order('created_at', { ascending: false });
    return result;
  }, []);

  const { data: invoicesData, loading, refetch } = useSupabaseQuery<any[]>(
    fetchInvoices,
    { errorMessage: 'Failed to load invoices' }
  );

  const invoices = (invoicesData || []) as Invoice[];

  const { mutate: generateInvoice } = useMutation(
    async (orderId: string) => {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*, customers(first_name, last_name, email)')
        .eq('id', orderId)
        .maybeSingle();

      if (orderError) throw orderError;
      if (!order) throw new Error('Order not found');

      const { data: invoiceNumberData } = await supabase.rpc('generate_invoice_number');
      const invoiceNumber = invoiceNumberData || `INV-${Date.now()}`;

      const totalCents = order.subtotal_cents + (order.travel_fee_cents ?? 0) +
                        (order.surface_fee_cents ?? 0) + (order.same_day_pickup_fee_cents ?? 0) + (order.tax_cents ?? 0);

      const { data, error } = await supabase.from('invoices').insert({
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
      }).select().single();

      if (error) throw error;
      return data;
    },
    {
      errorMessage: 'Failed to generate invoice',
      onSuccess: (data: any) => {
        notifySuccess(`Invoice ${data.invoice_number} generated successfully!`);
        refetch();
      },
    }
  );

  function handleGenerateManualInvoice() {
    const orderIdPrompt = prompt('Enter Order ID to generate invoice for:');
    if (!orderIdPrompt) return;
    generateInvoice(orderIdPrompt);
  }

  async function handleViewInvoice(invoice: Invoice) {
    const invoiceDetails = `
BOUNCE PARTY CLUB
Invoice: ${invoice.invoice_number}
Date: ${format(new Date(invoice.invoice_date), 'MMMM d, yyyy')}

Customer: ${invoice.customers?.first_name} ${invoice.customers?.last_name}
Email: ${invoice.customers?.email}
Event Date: ${invoice.orders?.event_date}

CHARGES:
Subtotal: ${formatCurrency(invoice.subtotal_cents)}
Travel Fee${Number(invoice.travel_total_miles) > 0 ? ` (${parseFloat(String(invoice.travel_total_miles)).toFixed(1)} mi)` : ''}: ${formatCurrency(invoice.travel_fee_cents)}
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

  const filteredInvoices = invoices.filter((invoice: Invoice) => {
    if (filter === 'paid') return invoice.status === 'paid';
    if (filter === 'unpaid') return invoice.status !== 'paid' && invoice.status !== 'cancelled';
    if (filter === 'draft') return invoice.status === 'draft';
    return true;
  });

  if (loading) {
    return <div className="text-center py-8">Loading invoices...</div>;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Invoices</h2>
          <p className="text-sm sm:text-base text-slate-600 mt-1">
            {invoices.length} total invoices
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('draft')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium ${
              filter === 'draft'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Draft
          </button>
          <button
            onClick={() => setFilter('unpaid')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium ${
              filter === 'unpaid'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Unpaid
          </button>
          <button
            onClick={() => setFilter('paid')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium ${
              filter === 'paid'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-700 border border-slate-300'
            }`}
          >
            Paid
          </button>
          <button
            onClick={handleGenerateManualInvoice}
            className="bg-green-600 hover:bg-green-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap"
          >
            + Generate Invoice
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Invoice #
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Date
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Total
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Paid
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Balance
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200">
            {filteredInvoices.map((invoice: Invoice) => (
              <tr key={invoice.id} className="hover:bg-slate-50">
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  <div className="flex items-center text-xs sm:text-sm">
                    <FileText className="w-3 sm:w-4 h-3 sm:h-4 mr-1 sm:mr-2 text-slate-400 flex-shrink-0" />
                    <span className="font-medium text-slate-900">{invoice.invoice_number}</span>
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  <div className="text-xs sm:text-sm text-slate-900">
                    {invoice.customers?.first_name} {invoice.customers?.last_name}
                  </div>
                  <div className="text-xs sm:text-sm text-slate-500 truncate max-w-[150px] sm:max-w-none">{invoice.customers?.email}</div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-slate-900">
                  <div className="flex items-center">
                    <Calendar className="w-3 sm:w-4 h-3 sm:h-4 mr-1 sm:mr-2 text-slate-400 flex-shrink-0" />
                    {format(new Date(invoice.invoice_date), 'MMM d, yyyy')}
                  </div>
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm font-medium text-slate-900">
                  {formatCurrency(invoice.total_cents)}
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-green-600">
                  {formatCurrency(invoice.paid_amount_cents)}
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm font-medium text-red-600">
                  {formatCurrency(invoice.total_cents - invoice.paid_amount_cents)}
                </td>
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2 sm:px-2.5 py-0.5 rounded-full text-xs font-medium ${
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
                <td className="px-3 sm:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleViewInvoice(invoice)}
                      className="text-blue-600 hover:text-blue-800 flex items-center"
                    >
                      <Eye className="w-3 sm:w-4 h-3 sm:h-4 mr-1 flex-shrink-0" />
                      <span className="hidden sm:inline">View</span>
                    </button>
                    {invoice.order_id && (
                      <button
                        onClick={() => navigate(`/admin?tab=orders&orderId=${invoice.order_id}`)}
                        className="inline-flex items-center px-2 sm:px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs sm:text-sm"
                        title="Edit Order"
                      >
                        <Edit className="w-3 sm:w-4 h-3 sm:h-4 sm:mr-1 flex-shrink-0" />
                        <span className="hidden sm:inline">Edit</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
