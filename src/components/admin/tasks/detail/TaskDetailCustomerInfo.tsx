import { useState, useEffect } from 'react';
import { RotateCcw, ExternalLink } from 'lucide-react';
import { formatCurrency } from '../../../../lib/pricing';
import { Task } from '../../../../hooks/admin/useCalendarTasks';
import { supabase } from '../../../../lib/supabase';
import { RefundAllocationPanel } from '../../orders/refunds/RefundAllocationPanel';

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
  // Payments, refunds and the signed-waiver file link are Admin/Master only. Crew sees status derived from the order and get-waiver-status.
  isAdmin?: boolean;
  // Called after a refund request has been answered, so the calendar can reload the task.
  onRefundChanged?: () => void;
}

export function TaskDetailCustomerInfo({ task, isAdmin = true, onRefundChanged }: Props) {
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [physicalWaiverUrl, setPhysicalWaiverUrl] = useState<string | null>(null);
  // Crew: waiver kind from get-waiver-status (summary only: no file links). 'loading' | 'error' | the kind.
  const [crewWaiver, setCrewWaiver] = useState<'loading' | 'error' | 'digital' | 'paper_with_photo' | 'paper_no_photo' | 'none'>('loading');

  // Crew cannot read the signature rows, so ask the server (it allows crew and, with summaryOnly, hands out no files).
  useEffect(() => {
    if (isAdmin || task.waiverTypeKnown !== false || !task.waiverSigned) return;
    let cancelled = false;
    setCrewWaiver('loading');
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-waiver-status`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: task.orderId, summaryOnly: true }),
        });
        if (!res.ok) throw new Error(`get-waiver-status ${res.status}`);
        const { data } = await res.json();
        if (!cancelled) setCrewWaiver(data?.waiver_type ?? 'none');
      } catch {
        if (!cancelled) setCrewWaiver('error');
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, task.orderId, task.waiverSigned, task.waiverTypeKnown]);

  // Fetch signed URL for physical waiver when task has a paper waiver (Admin only: crew never receives file links)
  useEffect(() => {
    if (!isAdmin || !task.waiverSigned || task.waiverType === 'digital' || task.waiverType === null) {
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
  }, [isAdmin, task.orderId, task.waiverType]);

  const succeededPayments = isAdmin ? (task.payments?.filter(p => p.status === 'succeeded') ?? []) : [];
  // The waiver kind to show: the loaded one for Admin (and for any task whose signature rows were loaded), the server's answer for crew.
  const waiverKind = task.waiverTypeKnown === false && !isAdmin ? crewWaiver : (task.waiverType ?? 'none');

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
        ) : waiverKind === 'loading' ? (
          <div className="text-slate-600 font-semibold text-xs bg-slate-100 border border-slate-200 rounded px-2 py-1">Checking waiver…</div>
        ) : waiverKind === 'error' ? (
          <div className="text-slate-700 font-semibold text-xs bg-slate-100 border border-slate-200 rounded px-2 py-1">Waiver signed — details unavailable right now</div>
        ) : waiverKind === 'digital' ? (
          <div className="text-green-700 font-semibold text-xs bg-green-50 border border-green-200 rounded px-2 py-1">Waiver signed — digital</div>
        ) : waiverKind === 'paper_with_photo' ? (
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
        ) : waiverKind === 'paper_no_photo' ? (
          <div className="text-amber-700 font-semibold text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">Paper waiver — photo missing</div>
        ) : (
          <div className="text-slate-700 font-semibold text-xs bg-slate-100 border border-slate-200 rounded px-2 py-1">Waiver signed</div>
        )}

        {task.balanceDue > 0 && (
          <div className="text-red-700 font-semibold">⚠️ Balance due: {formatCurrency(task.balanceDue)}</div>
        )}

        {!isAdmin && task.total > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-700 space-y-0.5">
            <div className="font-semibold text-slate-700 text-sm">Payment status</div>
            <div>Deposit paid: {formatCurrency(task.depositPaidCents)}</div>
            <div>Balance paid: {formatCurrency(task.balancePaidCents)}</div>
            {task.tipCents > 0 && <div>Tip: {formatCurrency(task.tipCents)}</div>}
            <div className={task.balanceDue > 0 ? 'font-semibold text-red-700' : 'font-semibold text-green-700'}>
              {task.balanceDue > 0 ? `Balance due: ${formatCurrency(task.balanceDue)}` : 'Paid in full'}
            </div>
          </div>
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
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <RefundAllocationPanel
                  orderId={task.orderId}
                  customerName={task.customerName}
                  refreshToken={succeededPayments.map((p) => `${p.id}:${p.status}`).join(',')}
                  onChanged={onRefundChanged}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
