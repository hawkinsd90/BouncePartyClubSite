import { useState, useEffect } from 'react';
import { RotateCcw, ExternalLink } from 'lucide-react';
import { formatCurrency } from '../../../lib/pricing';
import { Task } from '../../../hooks/useCalendarTasks';
import { supabase } from '../../../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

function formatTimeStr(time: string): string {
  if (!time || time === 'TBD') return time;
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h)) return time;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

interface Props {
  task: Task;
  onRefund: (amountCents: number, reason: string) => Promise<void>;
  refunding: boolean;
}

export function TaskDetailCustomerInfo({ task, onRefund, refunding }: Props) {
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [physicalWaiverUrl, setPhysicalWaiverUrl] = useState<string | null>(null);

  // Fetch signed URL for physical waiver when task has a paper waiver
  useEffect(() => {
    if (!task.waiverSigned || task.waiverType === 'digital' || task.waiverType === null) {
      setPhysicalWaiverUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-waiver-status`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ orderId: task.orderId }),
        });
        if (!res.ok || cancelled) return;
        const { data } = await res.json();
        if (!cancelled) {
          setPhysicalWaiverUrl(data?.physical_waiver?.signed_url ?? null);
        }
      } catch {
        // non-critical — waiver badge still shows
      }
    })();
    return () => { cancelled = true; };
  }, [task.orderId, task.waiverType]);

  async function handleRefund() {
    const amountCents = Math.round(parseFloat(refundAmount) * 100);
    if (!amountCents || amountCents <= 0 || !refundReason.trim()) return;
    await onRefund(amountCents, refundReason);
    setShowRefundForm(false);
    setRefundAmount('');
    setRefundReason('');
  }

  const succeededPayments = task.payments?.filter(p => p.status === 'succeeded') ?? [];

  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <h3 className="font-bold text-slate-900 mb-3">Customer Information</h3>
      <div className="space-y-2 text-sm">
        <div><span className="font-semibold">Name:</span> {task.customerName}</div>
        <div><span className="font-semibold">Phone:</span> {task.customerPhone}</div>
        <div><span className="font-semibold">Address:</span> {task.address}</div>
        <div><span className="font-semibold">Event Time:</span> {formatTimeStr(task.eventStartTime)} - {formatTimeStr(task.eventEndTime)}</div>

        {!task.waiverSigned ? (
          <div className="text-amber-700 font-semibold text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">Waiver not signed</div>
        ) : task.waiverType === 'digital' ? (
          <div className="text-green-700 font-semibold text-xs bg-green-50 border border-green-200 rounded px-2 py-1">Waiver signed — digital</div>
        ) : task.waiverType === 'paper_with_photo' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-green-700 font-semibold text-xs bg-green-50 border border-green-200 rounded px-2 py-1">Paper waiver — photo on file</div>
            {physicalWaiverUrl && (
              <a
                href={physicalWaiverUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <ExternalLink className="w-3 h-3" />
                View
              </a>
            )}
          </div>
        ) : (
          <div className="text-amber-700 font-semibold text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">Paper waiver — photo missing</div>
        )}

        {task.balanceDue > 0 && (
          <div className="text-red-700 font-semibold">⚠️ Balance due: {formatCurrency(task.balanceDue)}</div>
        )}

        {succeededPayments.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-slate-700">Payments Received:</div>
              <button
                onClick={() => setShowRefundForm(!showRefundForm)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Refund
              </button>
            </div>
            {succeededPayments.map(payment => (
              <div key={payment.id} className="text-xs text-green-700 ml-2">
                ✓ {formatCurrency(payment.amount_cents)} ({payment.type}) -{' '}
                {payment.paid_at
                  ? new Date(payment.paid_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : 'Completed'}
              </div>
            ))}

            {showRefundForm && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Refund Amount ($)</label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={refundAmount}
                    onChange={e => setRefundAmount(e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reason</label>
                  <input
                    type="text"
                    value={refundReason}
                    onChange={e => setRefundReason(e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-slate-300 rounded"
                    placeholder="e.g., Customer request, Weather cancellation"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRefund}
                    disabled={refunding}
                    className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white text-xs font-semibold py-1.5 px-3 rounded"
                  >
                    {refunding ? 'Processing...' : 'Issue Refund'}
                  </button>
                  <button
                    onClick={() => setShowRefundForm(false)}
                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold py-1.5 px-3 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
