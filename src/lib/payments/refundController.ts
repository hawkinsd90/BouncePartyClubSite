// The behaviour of the shared refund screen, without React: what is loaded, what the Admin has entered, what is being reviewed, what
// was sent, and what has to be resumed.
//
// Rules this enforces:
//   - nothing is sent except by an explicit confirm (or resume) action; loading, refreshing and re-rendering never send anything;
//   - the amounts the Admin may choose come from the database overview, and a refresh that changes them stops the review;
//   - a request is frozen when it is confirmed: while it is unfinished (or its result is not known) it cannot be edited, replaced by
//     another request, or given a new operation key; it can only be resumed, with its own key and its own allocation;
//   - an unfinished refund found in the database (after a reload, or from another Admin's session) is rebuilt from its stored rows,
//     never from a total, and resumed under its stored key; if it cannot be rebuilt with certainty, nothing can be sent for it;
//   - a second click while a request is in flight does nothing.
import {
  allocationSignature, availabilitySnapshot, buildAllocation, formatCents, progressOf, reasonToSend, reconstructStoredRequest, submitBodyForStored,
  centsToInput, isEligible,
  type AllocationInputs, type AllocationLine, type BuiltAllocation, type Component, type OperationProgress, type OverviewOperation, type OverviewPayment,
  type RefundOverview, type StoredRequest, type SubmitBody,
} from './refundAllocationRequest';
import { allocationAttemptFor, classifyRefundResponse, type RefundAttempt, type RefundResponseSummary } from './refundOperationKey';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RefundApi {
  loadOverview(orderId: string): Promise<RefundOverview>;
  // Resolves with the HTTP status and parsed body (null when the body is not JSON); REJECTS when the request could not be made or
  // its answer never arrived.
  submit(body: SubmitBody): Promise<{ status: number; data: any }>;
}

// What a refresh of the overview came to: 'ok' (read, availability as the Admin saw it), 'changed' (read, availability differs) or 'failed'
// (nothing was read, so nothing about the numbers is known to be current).
export type LoadResult = 'ok' | 'changed' | 'failed';

export type Phase = 'loading' | 'load_error' | 'ready' | 'review' | 'submitting' | 'recovery';

export interface ReviewLine { paymentId: string; title: string; depositCents: number; balanceCents: number; tipCents: number; totalCents: number }
export interface ReviewSummary {
  lines: ReviewLine[]; totalCents: number; depositCents: number; balanceCents: number; tipCents: number; paymentsAffected: number; reason: string; allocation: AllocationLine[];
}

// A request that has been confirmed and sent (or is being sent): its key and exact allocation.
export interface FrozenRequest { attempt: RefundAttempt; lines: AllocationLine[]; totalCents: number; reason: string; summary: ReviewSummary }

export interface ResultView {
  kind: RefundResponseSummary['kind'];
  tone: RefundResponseSummary['tone'];
  message: string;
  requestedCents?: number;
  succeededCents?: number;
  pendingCents?: number;
  failedCents?: number;
  unresolvedCents?: number;
}

export interface RecoveryView {
  source: 'stored' | 'local';
  operationKey: string;
  kind: 'allocated' | 'amount_only' | 'manual_review';
  canResume: boolean;
  manualReviewWhy?: string;
  progress: OperationProgress | null;
  lines: Array<{ paymentTitle: string; depositCents: number; balanceCents: number; tipCents: number }>;
  totalCents: number;
}

export interface ControllerState {
  phase: Phase;
  overview: RefundOverview | null;
  loadError: string | null;
  inputs: AllocationInputs;
  reasonValue: string;
  reasonText: string;
  fieldErrors: Record<string, string>;
  formError: string | null;
  notice: string | null;
  review: ReviewSummary | null;
  result: ResultView | null;
  frozen: FrozenRequest | null;
  recoveries: RecoveryView[];
}

const REFRESH_FAILED = 'The refund details could not be refreshed, so this refund cannot be reviewed yet. Your entries are kept. Check your connection and try again.';

const emptyEntry = () => ({ deposit: '', balance: '', tip: '' });

export class RefundController {
  state: ControllerState;
  private listeners = new Set<() => void>();
  private inFlight = false;
  private viewed = '';
  // Counts every request this controller has actually sent (tests and diagnostics).
  sentCount = 0;

  constructor(private api: RefundApi, readonly orderId: string) {
    this.state = {
      phase: 'loading', overview: null, loadError: null, inputs: {}, reasonValue: 'cancellation', reasonText: '', fieldErrors: {}, formError: null, notice: null,
      review: null, result: null, frozen: null, recoveries: [],
    };
  }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private set(patch: Partial<ControllerState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }

  // ---- reading ---------------------------------------------------------------------------------------------------
  // Reads the overview. Says whether it was read and whether what is available to refund changed since the Admin last saw it.
  // Never sends anything.
  // `afterOwnRequest`: the change was made by this screen's own request, so it is not reported as a surprise.
  async load(afterOwnRequest = false): Promise<LoadResult> {
    const first = this.state.overview === null;
    if (first) this.set({ phase: 'loading', loadError: null });
    let overview: RefundOverview;
    try {
      overview = await this.api.loadOverview(this.orderId);
    } catch (e: any) {
      if (this.state.overview === null) {
        this.set({ phase: 'load_error', loadError: String(e?.message ?? e ?? 'The refund details could not be loaded.') });
      } else if (this.state.phase === 'review') {
        // A confirmation shown on numbers that can no longer be checked is not a confirmation: back to editing (entries kept).
        this.set({ phase: 'ready', review: null, notice: null, formError: REFRESH_FAILED });
      } else {
        this.set({ notice: 'The refund details could not be refreshed. Check your connection and try again.' });
      }
      return 'failed';
    }
    const snap = availabilitySnapshot(overview);
    const changed = !afterOwnRequest && !first && this.viewed !== '' && snap !== this.viewed;
    this.viewed = snap;
    const recoveries = this.computeRecoveries(overview, this.state.frozen);
    // A stored operation that is no longer unfinished ends the local copy of it (the database is the record).
    let frozen = this.state.frozen;
    let finishedNotice: string | null = null;
    if (frozen && overview.operations.some((o) => o.operation_key === frozen!.attempt.key && !o.unfinished)) {
      frozen = null;
      finishedNotice = 'The refund you submitted has finished. See the refund history for what was refunded.';
    }
    this.set({
      overview, loadError: null, frozen,
      recoveries: this.computeRecoveries(overview, frozen),
      phase: recoveries.length > 0 ? 'recovery' : (this.state.phase === 'review' || this.state.phase === 'submitting' ? this.state.phase : 'ready'),
      notice: changed ? 'The amounts available to refund have changed. Please review them before continuing.' : (finishedNotice ?? this.state.notice),
      result: finishedNotice ? null : this.state.result,
      review: changed ? null : this.state.review,
    });
    if (changed && this.state.phase === 'review') this.set({ phase: 'ready' });
    return changed ? 'changed' : 'ok';
  }

  private titleFor(overview: RefundOverview, paymentId: string): string {
    const p = overview.payments.find((x) => x.id.toLowerCase() === paymentId.toLowerCase());
    return p ? `${(p.type ?? 'payment').replace(/_/g, ' ')}${p.payment_brand && p.payment_last4 ? ` · ${p.payment_brand} •••• ${p.payment_last4}` : ''}` : 'Payment';
  }

  private computeRecoveries(overview: RefundOverview, frozen: FrozenRequest | null): RecoveryView[] {
    const out: RecoveryView[] = [];
    for (const op of overview.operations.filter((o) => o.unfinished)) {
      const stored = reconstructStoredRequest(op);
      const progress = progressOf(op);
      if (stored.kind === 'manual_review') {
        out.push({ source: 'stored', operationKey: op.operation_key, kind: 'manual_review', canResume: false, manualReviewWhy: stored.why, progress, lines: [], totalCents: op.request_amount_cents });
      } else if (stored.kind === 'amount_only') {
        out.push({ source: 'stored', operationKey: op.operation_key, kind: 'amount_only', canResume: true, progress, lines: [], totalCents: stored.totalCents });
      } else {
        out.push({
          source: 'stored', operationKey: op.operation_key, kind: 'allocated', canResume: true, progress, totalCents: stored.totalCents,
          lines: stored.lines.map((l) => ({ paymentTitle: this.titleFor(overview, l.paymentId), depositCents: l.depositPrincipalCents, balanceCents: l.balancePrincipalCents, tipCents: l.tipCents })),
        });
      }
    }
    if (frozen && !out.some((r) => r.operationKey === frozen.attempt.key)) {
      out.push({
        source: 'local', operationKey: frozen.attempt.key, kind: 'allocated', canResume: true, progress: null, totalCents: frozen.totalCents,
        lines: frozen.summary.lines.map((l) => ({ paymentTitle: l.title, depositCents: l.depositCents, balanceCents: l.balanceCents, tipCents: l.tipCents })),
      });
    }
    return out;
  }

  // ---- editing (only when nothing is unfinished) -------------------------------------------------------------------
  private get editable(): boolean { return this.state.phase === 'ready'; }

  setInput(paymentId: string, c: Component, text: string) {
    if (!this.editable) return;
    const cur = this.state.inputs[paymentId] ?? emptyEntry();
    const fieldErrors = { ...this.state.fieldErrors };
    delete fieldErrors[`${paymentId}.${c}`];
    this.set({ inputs: { ...this.state.inputs, [paymentId]: { ...cur, [c]: text } }, fieldErrors, formError: null, notice: null });
  }

  // The most that component of that payment can return, as typed text. Nothing is ever filled in automatically.
  setMax(paymentId: string, c: Component) {
    const p = this.state.overview?.payments.find((x) => x.id === paymentId);
    if (!p || !isEligible(p)) return;
    this.setInput(paymentId, c, centsToInput(p.available[`${c}_cents` as 'deposit_cents']));
  }

  setReason(value: string, text?: string) {
    if (!this.editable) return;
    this.set({ reasonValue: value, reasonText: text ?? this.state.reasonText, formError: null });
  }

  built(): BuiltAllocation | null {
    return this.state.overview ? buildAllocation(this.state.overview.payments, this.state.inputs) : null;
  }

  // ---- review ------------------------------------------------------------------------------------------------------
  // Refreshes the numbers, checks the entries against them, and shows the Admin exactly what would be refunded. Sends nothing.
  async review(): Promise<void> {
    if (!this.editable || this.inFlight) return;
    const loaded = await this.load();
    if (loaded === 'failed') {
      // Nothing was read: the numbers on screen may be out of date, so the Admin cannot reach a confirmation. The entries stay.
      this.set({ phase: 'ready', review: null, notice: null, formError: REFRESH_FAILED });
      return;
    }
    if (loaded === 'changed' || this.state.phase !== 'ready') return;
    const overview = this.state.overview as RefundOverview;
    const built = buildAllocation(overview.payments, this.state.inputs);
    const reason = reasonToSend(this.state.reasonValue, this.state.reasonText);
    const formError = built.formError ?? (!reason.ok ? reason.error : null);
    if (!built.ok || !reason.ok) {
      this.set({ fieldErrors: built.fieldErrors, formError, review: null, notice: null });
      return;
    }
    const lines: ReviewLine[] = built.lines.map((l) => ({
      paymentId: l.paymentId, title: this.titleFor(overview, l.paymentId), depositCents: l.depositPrincipalCents, balanceCents: l.balancePrincipalCents, tipCents: l.tipCents,
      totalCents: l.depositPrincipalCents + l.balancePrincipalCents + l.tipCents,
    }));
    this.set({
      fieldErrors: {}, formError: null, notice: null, phase: 'review', result: null,
      review: { lines, totalCents: built.totalCents, depositCents: built.depositCents, balanceCents: built.balanceCents, tipCents: built.tipCents, paymentsAffected: built.paymentsAffected, reason: reason.reason, allocation: built.lines },
    });
  }

  cancelReview() {
    if (this.state.phase === 'review') this.set({ phase: 'ready', review: null });
  }

  // ---- sending (explicit actions only) -------------------------------------------------------------------------------
  async confirm(): Promise<void> {
    if (this.state.phase !== 'review' || !this.state.review || this.inFlight) return;
    const r = this.state.review;
    const signature = allocationSignature(r.allocation);
    // The same allocation keeps its key; a different one is a different request (and only reachable when nothing is unfinished).
    const attempt = allocationAttemptFor(this.state.frozen?.attempt ?? null, this.orderId, signature, r.totalCents);
    const frozen: FrozenRequest = { attempt, lines: r.allocation, totalCents: r.totalCents, reason: r.reason, summary: r };
    this.set({ frozen });
    await this.send({ orderId: this.orderId, operationKey: attempt.key, reason: r.reason, amountCents: r.totalCents, allocations: r.allocation });
  }

  // Resumes an unfinished refund under ITS key with ITS allocation (rebuilt from the stored rows, or the frozen local request).
  async resume(operationKey: string): Promise<void> {
    if (this.inFlight || this.state.phase !== 'recovery') return;
    const overview = this.state.overview;
    const op: OverviewOperation | undefined = overview?.operations.find((o) => o.operation_key === operationKey && o.unfinished);
    let body: SubmitBody | null = null;
    if (op) {
      const stored: StoredRequest = reconstructStoredRequest(op);
      body = submitBodyForStored(this.orderId, op, stored);
    } else if (this.state.frozen && this.state.frozen.attempt.key === operationKey) {
      const f = this.state.frozen;
      body = { orderId: this.orderId, operationKey: f.attempt.key, reason: f.reason, amountCents: f.totalCents, allocations: f.lines };
    }
    if (!body) return;
    await this.send(body);
  }

  private async send(body: SubmitBody): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const wasPhase = this.state.phase;
    this.set({ phase: 'submitting', notice: null });
    let status = 0;
    let data: any = null;
    try {
      this.sentCount++;
      const res = await this.api.submit(body);
      status = res.status;
      data = res.data;
    } catch {
      // The request may or may not have reached the server: the request identity is kept, and nothing is assumed.
      status = 0;
      data = null;
    }
    const outcome = classifyRefundResponse(status, data);
    const result: ResultView = {
      kind: outcome.kind, tone: outcome.tone, message: outcome.message,
      requestedCents: typeof data?.requestedCents === 'number' ? data.requestedCents : body.amountCents,
      succeededCents: data?.succeededCents, pendingCents: data?.pendingCents, failedCents: data?.failedCents, unresolvedCents: data?.unresolvedCents,
    };
    // Which requests stay frozen: those whose outcome is not final (unknown, or still being processed).
    let frozen = this.state.frozen;
    if (outcome.kind === 'unresolved' && frozen && frozen.attempt.key === body.operationKey) {
      // keep
    } else if (outcome.kind === 'unsettled') {
      // some other refund on this order is unfinished: this request was not started
      frozen = frozen && frozen.attempt.key === body.operationKey ? null : frozen;
    } else if (frozen && frozen.attempt.key === body.operationKey) {
      frozen = null;
    }
    this.inFlight = false;
    this.set({ frozen, result, phase: wasPhase === 'recovery' ? 'recovery' : 'ready', review: null });
    if (outcome.kind === 'succeeded' || outcome.kind === 'pending' || outcome.kind === 'partial') this.set({ inputs: {}, reasonText: '' });
    await this.load(true);
    // After the refresh the phase follows the database: unfinished refunds mean recovery; otherwise the form is available again.
    if (this.state.recoveries.length === 0 && this.state.phase !== 'ready') this.set({ phase: 'ready' });
  }

  dismissResult() { this.set({ result: null }); }
}

export { formatCents };
export type { OverviewPayment };
