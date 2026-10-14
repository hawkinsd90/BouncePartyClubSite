// The one refund screen used by every Admin refund entry point (Single Order -> Payments, Pending Order -> Payment Management, and the
// Calendar task). It shows, per original card payment, what was collected as deposit / remaining balance / tip, what has been refunded
// or is being refunded, and what can still be refunded; lets the Admin choose how much of each to return; shows a confirmation; and
// resumes an unfinished refund exactly as it was made. All behaviour lives in RefundController; this file only draws it.
//
// The numbers come from the database (order_refund_overview) and the database decides every refund: this screen cannot authorize one.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { RotateCcw, RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { RefundController, type ControllerState, type RefundApi, type RecoveryView } from '../../../lib/payments/refundController';
import {
  COMPONENT_LABEL, REFUND_REASONS, ROW_STATE_LABEL, buildAllocation, componentSummary, fieldId, formatCents, isEligible, paymentTitle, rowState,
  type Component, type OverviewPayment, type OverviewRow,
} from '../../../lib/payments/refundAllocationRequest';

const COMPONENTS: Component[] = ['deposit', 'balance', 'tip'];

// The two server calls are loaded only when the panel is used, so the screen's logic and drawing never depend on the browser client.
const lazyApi: RefundApi = {
  loadOverview: async (id) => (await import('../../../lib/payments/refundClient')).loadRefundOverview(id),
  submit: async (body) => (await import('../../../lib/payments/refundClient')).submitRefundRequest(body),
};

const TONE: Record<string, string> = {
  success: 'bg-green-50 border-green-200 text-green-900',
  warning: 'bg-amber-50 border-amber-300 text-amber-900',
  error: 'bg-red-50 border-red-200 text-red-900',
};

export interface RefundViewHandlers {
  onInput: (paymentId: string, c: Component, text: string) => void;
  onMax: (paymentId: string, c: Component) => void;
  onReason: (value: string, text?: string) => void;
  onReview: () => void;
  onBack: () => void;
  onConfirm: () => void;
  onResume: (operationKey: string) => void;
  onRetryLoad: () => void;
  onDismiss: () => void;
}

function Money({ cents }: { cents: number }) {
  return <span className="tabular-nums">{formatCents(cents)}</span>;
}

function PaymentCard({ p, state, h }: { p: OverviewPayment; state: ControllerState; h: RefundViewHandlers }) {
  const entry = state.inputs[p.id] ?? { deposit: '', balance: '', tip: '' };
  const eligible = isEligible(p);
  const refundedTotal = p.refunded.deposit_cents + p.refunded.balance_cents + p.refunded.tip_cents + (p.refunded.unclassified_cents ?? 0);
  const pendingTotal = p.pending.deposit_cents + p.pending.balance_cents + p.pending.tip_cents + (p.pending.unclassified_cents ?? 0);
  const locked = state.phase !== 'ready';
  return (
    <div className="border border-slate-200 rounded-lg p-3 sm:p-4 bg-white" data-testid="refund-payment">
      <div className="font-semibold text-slate-900 text-sm break-words">{paymentTitle(p)}</div>
      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs text-slate-600">
        <div><dt>Collected</dt><dd className="font-medium text-slate-900"><Money cents={p.amount_cents} /></dd></div>
        <div><dt>Refunded</dt><dd className="font-medium text-slate-900"><Money cents={refundedTotal} /></dd></div>
        <div><dt>Pending refund</dt><dd className="font-medium text-slate-900"><Money cents={pendingTotal} /></dd></div>
        <div><dt>Available to refund</dt><dd className="font-semibold text-slate-900"><Money cents={eligible ? p.remaining_total_cents : 0} /></dd></div>
      </dl>
      {p.has_unclassified_history && (
        <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
          An earlier refund on this payment has no recorded breakdown. {UNKNOWN_NOTE}
        </p>
      )}
      {!eligible ? (
        <p className="mt-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-2" role="note">
          {p.reason_unavailable === 'unclassified'
            ? 'Component-level refunding is unavailable for this payment: its deposit, balance and tip split was not recorded.'
            : p.reason_unavailable === 'history_ambiguous'
              ? 'Earlier refunds on this order were not linked to a payment, so this payment cannot be checked for a refund. This needs manual review.'
              : 'This payment cannot be refunded through Stripe.'}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {COMPONENTS.map((c) => {
            const collected = c === 'deposit' ? p.deposit_cents : c === 'balance' ? p.balance_cents : p.tip_cents;
            const available = p.available[`${c}_cents` as 'deposit_cents'];
            if (collected <= 0) return null;
            const id = `refund-${p.id}-${c}`;
            const err = state.fieldErrors[fieldId(p.id, c)];
            return (
              <div key={c}>
                <label htmlFor={id} className="block text-sm font-medium text-slate-800">{COMPONENT_LABEL[c]} (refund amount)</label>
                <div className="text-xs text-slate-500 mb-1">Available to refund: <Money cents={available} /> of <Money cents={collected} /> collected</div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" aria-hidden="true">$</span>
                    <input
                      id={id}
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={entry[c]}
                      disabled={locked}
                      onChange={(e) => h.onInput(p.id, c, e.target.value)}
                      placeholder="0.00"
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? `${id}-error` : undefined}
                      className="w-full min-h-[44px] pl-7 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={locked || available <= 0}
                    onClick={() => h.onMax(p.id, c)}
                    aria-label={`Refund the maximum available ${COMPONENT_LABEL[c].toLowerCase()}, ${formatCents(available)}`}
                    className="min-h-[44px] px-3 text-sm font-medium text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:text-slate-400 disabled:border-slate-200"
                  >
                    Max
                  </button>
                </div>
                {err && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const UNKNOWN_NOTE = 'Part of what can be refunded from it cannot be confirmed, so only the amounts shown are available.';

function RecoveryCard({ r, busy, h }: { r: RecoveryView; busy: boolean; h: RefundViewHandlers }) {
  const pr = r.progress;
  return (
    <div className="border-2 border-amber-300 bg-amber-50 rounded-lg p-3 sm:p-4" role="region" aria-label="Refund in progress" data-testid="refund-recovery">
      <div className="flex items-start gap-2">
        <Clock className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h4 className="font-semibold text-amber-900">Refund in progress — resume existing refund</h4>
          <p className="text-sm text-amber-900 mt-1">
            A refund of <Money cents={r.totalCents} /> has not finished. It must be finished before another refund can be started. Resuming never refunds anything twice.
          </p>
        </div>
      </div>
      {r.kind === 'manual_review' ? (
        <p className="mt-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded p-2" role="alert">
          This refund needs manual review: it cannot be rebuilt with certainty from what is on record ({r.manualReviewWhy}). It cannot be resumed here, and no new refund can be started until it is settled in Stripe and the order history.
        </p>
      ) : (
        <>
          {r.kind === 'amount_only' ? (
            <p className="mt-3 text-sm text-slate-700">This is an earlier refund of <Money cents={r.totalCents} /> made without a deposit / balance / tip breakdown. It can be resumed as it was.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm text-slate-800">
              {r.lines.map((l, i) => (
                <li key={i} className="break-words">
                  <span className="font-medium">{l.paymentTitle}</span>:{' '}
                  {[l.depositCents > 0 ? `${formatCents(l.depositCents)} deposit` : null, l.balanceCents > 0 ? `${formatCents(l.balanceCents)} remaining balance` : null, l.tipCents > 0 ? `${formatCents(l.tipCents)} tip` : null].filter(Boolean).join(' · ')}
                </li>
              ))}
            </ul>
          )}
          {pr ? (
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs text-slate-700">
              <div><dt>Requested</dt><dd className="font-semibold text-slate-900"><Money cents={pr.requestedCents} /></dd></div>
              <div><dt>Refunded</dt><dd className="font-semibold text-slate-900"><Money cents={pr.succeededCents} /></dd></div>
              <div><dt>Pending at Stripe</dt><dd className="font-semibold text-slate-900"><Money cents={pr.pendingCents + pr.reservedCents} /></dd></div>
              <div><dt>Result not yet known</dt><dd className="font-semibold text-slate-900"><Money cents={pr.unresolvedCents} /></dd></div>
              <div><dt>Failed</dt><dd className="font-semibold text-slate-900"><Money cents={pr.failedCents} /></dd></div>
            </dl>
          ) : (
            <p className="mt-3 text-xs text-slate-600">The answer to this request was not received. Resuming checks with Stripe before anything is sent again.</p>
          )}
          <button
            type="button"
            disabled={busy || !r.canResume}
            aria-busy={busy}
            onClick={() => h.onResume(r.operationKey)}
            className="mt-3 w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white font-semibold px-4 py-2 rounded-lg text-sm"
          >
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="w-4 h-4" aria-hidden="true" />}
            {busy ? 'Resuming…' : 'Resume Existing Refund'}
          </button>
        </>
      )}
    </div>
  );
}

function HistoryList({ rows, payments }: { rows: OverviewRow[]; payments: OverviewPayment[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-600">No refunds have been made on this order.</p>;
  return (
    <ul className="space-y-2" aria-label="Refund history">
      {rows.map((r) => {
        const st = rowState(r);
        const pay = payments.find((p) => p.id === r.payment_id);
        const reason = REFUND_REASONS.find((x) => x.value === r.reason)?.label ?? r.reason;
        return (
          <li key={r.id} className="border border-slate-200 rounded-lg p-3 text-sm bg-white" data-testid="refund-history-row">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900">{componentSummary(r)}</div>
                <div className="text-xs text-slate-500 break-words">
                  {[pay ? paymentTitle(pay) : null, reason, r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={`font-semibold ${st === 'succeeded' ? 'text-red-700' : 'text-slate-500'}`}>{st === 'succeeded' ? '-' : ''}<Money cents={r.amount_cents} /></div>
                <div className={`text-xs ${st === 'failed' ? 'text-red-700' : st === 'succeeded' ? 'text-green-700' : 'text-amber-700'}`}>{ROW_STATE_LABEL[st]}</div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Pure drawing of a controller state (also what the rendering tests use).
export function RefundAllocationView({ state, handlers: h, showHistory = true, customerName }: { state: ControllerState; handlers: RefundViewHandlers; showHistory?: boolean; customerName?: string }) {
  const o = state.overview;
  const busy = state.phase === 'submitting';
  if (state.phase === 'loading' || (!o && state.phase !== 'load_error')) {
    return <p role="status" className="text-sm text-slate-600">Loading refund details…</p>;
  }
  if (state.phase === 'load_error' || !o) {
    return (
      <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
        <p>{state.loadError || 'The refund details could not be loaded.'}</p>
        <button type="button" onClick={h.onRetryLoad} className="mt-2 min-h-[44px] px-3 border border-red-300 rounded-lg font-medium">Try again</button>
      </div>
    );
  }
  const refundable = o.payments.filter((p) => p.refundable);
  const others = o.payments.filter((p) => !p.refundable);
  const built = buildAllocation(o.payments, state.inputs);
  const hasRecovery = state.recoveries.length > 0;
  return (
    <div className="space-y-4" data-testid="refund-panel">
      {state.notice && <div role="status" className="bg-blue-50 border border-blue-200 text-blue-900 rounded-lg p-3 text-sm">{state.notice}</div>}

      {state.result && (
        <div role={state.result.tone === 'success' ? 'status' : 'alert'} className={`border rounded-lg p-3 text-sm ${TONE[state.result.tone]}`} data-testid="refund-result">
          <div className="flex items-start gap-2">
            {state.result.tone === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="break-words">{state.result.message}</p>
              {state.result.requestedCents !== undefined && (state.result.kind === 'partial' || state.result.kind === 'unresolved' || state.result.kind === 'pending') && (
                <p className="mt-1 text-xs">
                  Requested <Money cents={state.result.requestedCents} />
                  {typeof state.result.succeededCents === 'number' && <> · refunded <Money cents={state.result.succeededCents} /></>}
                  {typeof state.result.pendingCents === 'number' && state.result.pendingCents > 0 && <> · pending <Money cents={state.result.pendingCents} /></>}
                  {typeof state.result.unresolvedCents === 'number' && state.result.unresolvedCents > 0 && <> · not yet known <Money cents={state.result.unresolvedCents} /></>}
                  {typeof state.result.failedCents === 'number' && state.result.failedCents > 0 && <> · failed <Money cents={state.result.failedCents} /></>}
                </p>
              )}
              <button type="button" onClick={h.onDismiss} className="mt-2 text-xs underline">Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {hasRecovery ? (
        state.recoveries.map((r) => <RecoveryCard key={r.operationKey} r={r} busy={busy} h={h} />)
      ) : (
        <>
          <div>
            <h4 className="font-semibold text-slate-900 mb-2">Refundable Payments</h4>
            {refundable.length === 0 ? (
              <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded p-3">There are no successful card payments on this order to refund.</p>
            ) : (
              <div className="space-y-3">{refundable.map((p) => <PaymentCard key={p.id} p={p} state={state} h={h} />)}</div>
            )}
            {others.length > 0 && <p className="mt-2 text-xs text-slate-500">Cash and check payments cannot be refunded here.</p>}
          </div>

          {refundable.some(isEligible) && !state.review && (
            <>
              <div className="border border-slate-200 rounded-lg p-3 sm:p-4 bg-slate-50" aria-label="Refund summary">
                <h4 className="font-semibold text-slate-900 mb-2">Refund Summary</h4>
                <dl className="grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-slate-600">Deposit</dt><dd className="text-right"><Money cents={built.depositCents} /></dd>
                  <dt className="text-slate-600">Remaining Balance</dt><dd className="text-right"><Money cents={built.balanceCents} /></dd>
                  <dt className="text-slate-600">Tip</dt><dd className="text-right"><Money cents={built.tipCents} /></dd>
                  <dt className="font-semibold text-slate-900 border-t border-slate-300 pt-1">Total Refund</dt><dd className="text-right font-semibold border-t border-slate-300 pt-1"><Money cents={built.totalCents} /></dd>
                </dl>
              </div>
              <div>
                <label htmlFor="refund-reason" className="block text-sm font-medium text-slate-800 mb-1">Reason for refund</label>
                <select
                  id="refund-reason"
                  value={state.reasonValue}
                  onChange={(e) => h.onReason(e.target.value)}
                  className="w-full min-h-[44px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {REFUND_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {state.reasonValue === 'other' && (
                  <input
                    type="text"
                    aria-label="Describe the reason for the refund"
                    maxLength={500}
                    value={state.reasonText}
                    onChange={(e) => h.onReason('other', e.target.value)}
                    placeholder="Describe the reason"
                    className="mt-2 w-full min-h-[44px] border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </div>
              {state.formError && <p role="alert" className="text-sm text-red-700">{state.formError}</p>}
              <button
                type="button"
                onClick={h.onReview}
                disabled={busy}
                className="w-full min-h-[44px] bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white font-semibold px-4 py-2 rounded-lg text-sm"
              >
                Review Refund
              </button>
              <p className="text-xs text-slate-500">Nothing is refunded until you confirm on the next step.</p>
            </>
          )}

          {state.review && (state.phase === 'review' || state.phase === 'submitting') && (
            <div className="border-2 border-red-300 bg-red-50 rounded-lg p-3 sm:p-4" role="region" aria-label="Confirm refund" data-testid="refund-confirm">
              <h4 className="font-semibold text-red-900">Refund <Money cents={state.review.totalCents} />{customerName ? <> to {customerName}</> : null}?</h4>
              <ul className="mt-2 space-y-1 text-sm text-slate-900">
                {state.review.depositCents > 0 && <li><Money cents={state.review.depositCents} /> from deposit</li>}
                {state.review.balanceCents > 0 && <li><Money cents={state.review.balanceCents} /> from remaining balance</li>}
                {state.review.tipCents > 0 && <li><Money cents={state.review.tipCents} /> from tip</li>}
              </ul>
              <p className="mt-2 text-xs text-slate-700">{state.review.paymentsAffected} payment{state.review.paymentsAffected === 1 ? '' : 's'} affected:</p>
              <ul className="mt-1 space-y-1 text-xs text-slate-700">
                {state.review.lines.map((l) => (
                  <li key={l.paymentId} className="break-words">
                    {l.title}: <Money cents={l.totalCents} />
                    {' ('}{[l.depositCents > 0 ? `${formatCents(l.depositCents)} deposit` : null, l.balanceCents > 0 ? `${formatCents(l.balanceCents)} remaining balance` : null, l.tipCents > 0 ? `${formatCents(l.tipCents)} tip` : null].filter(Boolean).join(', ')}{')'}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-700">Reason: {REFUND_REASONS.find((r) => r.value === state.review!.reason)?.label ?? state.review.reason}. This cannot be undone.</p>
              <div className="mt-3 flex flex-col-reverse sm:flex-row gap-2">
                <button type="button" onClick={h.onBack} disabled={busy} className="min-h-[44px] px-4 py-2 border border-slate-300 bg-white rounded-lg text-sm font-medium text-slate-700 disabled:opacity-50">Back</button>
                <button
                  type="button"
                  onClick={h.onConfirm}
                  disabled={busy}
                  aria-busy={busy}
                  className="min-h-[44px] flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white font-semibold px-4 py-2 rounded-lg text-sm"
                >
                  {busy && <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  {busy ? 'Processing…' : `Confirm ${formatCents(state.review.totalCents)} Refund`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showHistory && (
        <div>
          <h4 className="font-semibold text-slate-900 mb-2">Refund History</h4>
          <HistoryList rows={o.refunds} payments={o.payments} />
        </div>
      )}
    </div>
  );
}

export interface RefundAllocationPanelProps {
  orderId: string;
  customerName?: string;
  // Called after a refund request has been answered (so the page can reload its payments / order).
  onChanged?: () => void;
  // Changing this re-reads the refund details (e.g. when the page's payments were reloaded). It never sends anything.
  refreshToken?: unknown;
  // The refund history of the order; turn off where the page already shows its own.
  showHistory?: boolean;
  // Overridable for tests; the default talks to the signed-in session.
  api?: RefundApi;
}

export function RefundAllocationPanel({ orderId, customerName, onChanged, refreshToken, showHistory = true, api }: RefundAllocationPanelProps) {
  const ref = useRef<RefundController | null>(null);
  if (!ref.current || ref.current.orderId !== orderId) ref.current = new RefundController(api ?? lazyApi, orderId);
  const c = ref.current;
  const state = useSyncExternalStore(
    (fn) => c.subscribe(fn),
    () => c.state,
    () => c.state,
  );
  const first = useRef(true);
  useEffect(() => {
    // Opening the panel reads the refund details; it never sends a refund.
    void c.load();
  }, [c]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    void c.load();
  }, [refreshToken, c]);
  const lastResult = useRef<unknown>(null);
  useEffect(() => {
    if (state.result && state.result !== lastResult.current) {
      lastResult.current = state.result;
      onChanged?.();
    }
  }, [state.result, onChanged]);

  const handlers: RefundViewHandlers = useMemo(() => ({
    onInput: (id, comp, text) => c.setInput(id, comp, text),
    onMax: (id, comp) => c.setMax(id, comp),
    onReason: (v, t) => c.setReason(v, t),
    onReview: () => { void c.review(); },
    onBack: () => c.cancelReview(),
    onConfirm: () => { void c.confirm(); },
    onResume: (key) => { void c.resume(key); },
    onRetryLoad: () => { void c.load(); },
    onDismiss: () => c.dismissResult(),
  }), [c]);

  return <RefundAllocationView state={state} handlers={handlers} showHistory={showHistory} customerName={customerName} />;
}

export default RefundAllocationPanel;
