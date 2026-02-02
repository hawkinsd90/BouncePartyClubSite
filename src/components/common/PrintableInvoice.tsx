import { formatCurrency } from '../../lib/pricing';
import {
  PrintableDocument,
  formatPrintableAddress,
  formatPrintableContact,
  formatPrintablePaymentMethod,
  formatDocumentNumber,
} from '../../lib/printUtils';
import { format } from 'date-fns';

interface PrintableInvoiceProps extends Partial<PrintableDocument> {
  businessName?: string;
  businessLogo?: string;
  businessAddress?: string;
  businessPhone?: string;
  businessEmail?: string;
  showPaymentInfo?: boolean;
  showDepositInfo?: boolean;
  customHeader?: React.ReactNode;
  customFooter?: React.ReactNode;
}

export function PrintableInvoice({
  type = 'invoice',
  documentNumber,
  title,
  date,
  items = [],
  charges = [],
  subtotal = 0,
  tax = 0,
  total = 0,
  contact,
  address,
  payment,
  notes,
  metadata,
  businessName = 'Bounce Party Club',
  businessLogo,
  businessAddress,
  businessPhone,
  businessEmail,
  showPaymentInfo = false,
  showDepositInfo = false,
  customHeader,
  customFooter,
}: PrintableInvoiceProps) {
  const formattedDate = date ? format(new Date(date), 'MMMM d, yyyy') : '';
  const formattedDocNumber = formatDocumentNumber(type, documentNumber);

  return (
    <div className="bg-white p-8 max-w-4xl mx-auto print:p-0">
      {customHeader || (
        <div className="mb-8 pb-6 border-b-2 border-slate-900">
          <div className="flex justify-between items-start">
            <div>
              {businessLogo && (
                <img src={businessLogo} alt={businessName} className="h-16 mb-4" />
              )}
              <h1 className="text-3xl font-bold text-slate-900">{businessName}</h1>
              {businessAddress && (
                <p className="text-slate-600 mt-2 whitespace-pre-line">{businessAddress}</p>
              )}
              {businessPhone && <p className="text-slate-600">{businessPhone}</p>}
              {businessEmail && <p className="text-slate-600">{businessEmail}</p>}
            </div>
            <div className="text-right">
              <h2 className="text-2xl font-bold text-slate-900 uppercase">{title}</h2>
              <p className="text-slate-600 mt-2">
                <span className="font-semibold">{type === 'receipt' ? 'Receipt' : 'Invoice'} #:</span>{' '}
                {formattedDocNumber}
              </p>
              {date && (
                <p className="text-slate-600">
                  <span className="font-semibold">Date:</span> {formattedDate}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {(contact || address) && (
        <div className="mb-8 grid grid-cols-2 gap-8">
          {contact && (
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase mb-2">Bill To</h3>
              <div className="text-slate-700 whitespace-pre-line">{formatPrintableContact(contact)}</div>
            </div>
          )}
          {address && (
            <div>
              <h3 className="text-sm font-bold text-slate-900 uppercase mb-2">Event Location</h3>
              <div className="text-slate-700 whitespace-pre-line">{formatPrintableAddress(address)}</div>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="mb-8">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-slate-900">
                <th className="text-left py-3 font-bold text-slate-900">Item</th>
                <th className="text-center py-3 font-bold text-slate-900">Qty</th>
                <th className="text-right py-3 font-bold text-slate-900">Unit Price</th>
                <th className="text-right py-3 font-bold text-slate-900">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index} className="border-b border-slate-200">
                  <td className="py-3">
                    <div className="font-semibold text-slate-900">{item.name}</div>
                    {item.description && (
                      <div className="text-sm text-slate-600">{item.description}</div>
                    )}
                  </td>
                  <td className="text-center py-3 text-slate-700">{item.quantity || 1}</td>
                  <td className="text-right py-3 text-slate-700">
                    {item.unitPrice ? formatCurrency(item.unitPrice) : '-'}
                  </td>
                  <td className="text-right py-3 font-semibold text-slate-900">
                    {formatCurrency(item.totalPrice || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end mb-8">
        <div className="w-80">
          <div className="flex justify-between py-2 border-b border-slate-200">
            <span className="text-slate-700">Subtotal</span>
            <span className="font-semibold text-slate-900">{formatCurrency(subtotal)}</span>
          </div>

          {charges.map((charge, index) => (
            <div key={index} className="flex justify-between py-2 border-b border-slate-200">
              <div>
                <span className="text-slate-700">{charge.label}</span>
                {charge.description && (
                  <div className="text-xs text-slate-500">{charge.description}</div>
                )}
              </div>
              <span className={`font-semibold ${charge.isNegative ? 'text-green-600' : 'text-slate-900'}`}>
                {charge.isNegative ? '-' : ''}
                {formatCurrency(charge.amount)}
              </span>
            </div>
          ))}

          {tax > 0 && (
            <div className="flex justify-between py-2 border-b border-slate-200">
              <span className="text-slate-700">Tax</span>
              <span className="font-semibold text-slate-900">{formatCurrency(tax)}</span>
            </div>
          )}

          <div className="flex justify-between py-3 border-t-2 border-slate-900 mt-2">
            <span className="text-lg font-bold text-slate-900">Total</span>
            <span className="text-lg font-bold text-slate-900">{formatCurrency(total)}</span>
          </div>

          {showDepositInfo && (metadata as any)?.depositDue && (
            <>
              <div className="flex justify-between py-2 bg-blue-50 px-3 rounded">
                <span className="text-slate-700 font-semibold">Deposit Due</span>
                <span className="font-bold text-blue-900">
                  {formatCurrency((metadata as any).depositDue)}
                </span>
              </div>
              <div className="flex justify-between py-2 px-3">
                <span className="text-slate-700">Balance Due</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency((metadata as any).balanceDue || 0)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {showPaymentInfo && payment && (
        <div className="mb-8 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="text-sm font-bold text-green-900 uppercase mb-2">Payment Information</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-600">Payment Method:</span>
              <span className="ml-2 font-semibold text-slate-900">
                {formatPrintablePaymentMethod(payment)}
              </span>
            </div>
            <div>
              <span className="text-slate-600">Amount Paid:</span>
              <span className="ml-2 font-semibold text-slate-900">
                {formatCurrency(payment.amount)}
              </span>
            </div>
            <div>
              <span className="text-slate-600">Payment Date:</span>
              <span className="ml-2 font-semibold text-slate-900">
                {format(new Date(payment.date), 'MMMM d, yyyy')}
              </span>
            </div>
            <div>
              <span className="text-slate-600">Status:</span>
              <span className="ml-2 font-semibold text-green-600 uppercase">{payment.status}</span>
            </div>
          </div>
        </div>
      )}

      {notes && (
        <div className="mb-8">
          <h3 className="text-sm font-bold text-slate-900 uppercase mb-2">Notes</h3>
          <p className="text-slate-700 whitespace-pre-line">{notes}</p>
        </div>
      )}

      {customFooter || (
        <div className="mt-12 pt-6 border-t border-slate-300 text-center text-sm text-slate-600">
          <p>Thank you for your business!</p>
          {businessPhone && <p className="mt-1">Questions? Contact us at {businessPhone}</p>}
        </div>
      )}
    </div>
  );
}
