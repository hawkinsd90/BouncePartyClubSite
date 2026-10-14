// Refund allocation: money parsing, the request an Admin builds, its identity, and the reading of stored refund operations.
//
// Everything here is integer cents and pure (no React, no network), so the same code is used by every refund screen and is tested
// directly. The numbers it works from (what each payment can still return) come from the database (`order_refund_overview`); this
// module only checks the Admin's entries against them to give helpful messages. The refund function and `reserve_refund_allocation`
// repeat every rule and decide: nothing here authorizes a refund.

export const MAX_ALLOCATION_LINES = 20;
export const MAX_REFUND_CENTS = 99_999_999;

export const REFUND_REASONS = [
  { value: 'cancellation', label: 'Order Cancellation' },
  { value: 'requested_by_customer', label: 'Customer Request' },
  { value: 'duplicate', label: 'Duplicate Charge' },
  { value: 'fraudulent', label: 'Fraudulent Charge' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------------------------------
export type MoneyParse = { ok: true; cents: number } | { ok: false; error: string };

// Dollars typed by a person -> whole cents, by exact decimal parsing (no floating point). An empty entry is zero.
export function parseDollars(input: string): MoneyParse {
  if (typeof input !== 'string') return { ok: false, error: 'Enter an amount in dollars, like 25.00.' };
  const t = input.trim();
  if (t === '') return { ok: true, cents: 0 };
  if (t.startsWith('-')) return { ok: false, error: 'An amount cannot be negative.' };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return { ok: false, error: 'Enter an amount in dollars, like 25.00 (digits and one decimal point only).' };
  const [whole = '', frac = ''] = t.split('.');
  if (t.endsWith('.')) return { ok: false, error: 'Enter an amount in dollars, like 25.00.' };
  if (frac.length > 2) return { ok: false, error: 'Use at most two decimal places (whole cents).' };
  const wholeDigits = whole.replace(/^0+(?=\d)/, '');
  if (wholeDigits.length > 6) return { ok: false, error: 'That amount is too large.' };
  const cents = Number(wholeDigits === '' ? '0' : wholeDigits) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_REFUND_CENTS) return { ok: false, error: 'That amount is too large.' };
  return { ok: true, cents };
}

export function formatCents(cents: number): string {
  const c = Math.trunc(Number.isFinite(cents) ? cents : 0);
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${c < 0 ? '-' : ''}$${dollars}.${rest < 10 ? '0' : ''}${rest}`;
}

// Whole cents -> the text shown in an input ("75.00").
export function centsToInput(cents: number): string {
  const abs = Math.max(0, Math.trunc(cents));
  const rest = abs % 100;
  return `${Math.floor(abs / 100)}.${rest < 10 ? '0' : ''}${rest}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// What the database says about the order (order_refund_overview)
// ---------------------------------------------------------------------------------------------------------------------
export interface ComponentCents { deposit_cents: number; balance_cents: number; tip_cents: number; unclassified_cents?: number }

export interface OverviewPayment {
  id: string;
  type: string | null;
  paid_at: string | null;
  created_at: string | null;
  amount_cents: number;
  payment_method: string | null;
  payment_brand: string | null;
  payment_last4: string | null;
  refundable: boolean;
  classified: boolean;
  deposit_cents: number;
  balance_cents: number;
  tip_cents: number;
  refunded: ComponentCents;
  pending: ComponentCents;
  remaining_total_cents: number;
  has_unclassified_history: boolean;
  reason_unavailable: null | 'not_refundable' | 'unclassified' | 'history_ambiguous';
  available: ComponentCents;
}

export interface OverviewRow {
  id: string;
  operation_index?: number;
  payment_id: string | null;
  amount_cents: number;
  status: string;
  stripe_refund_id: string | null;
  provider_attempted: boolean;
  failure_reason?: string | null;
  created_at: string;
  reason: string | null;
  deposit_cents: number | null;
  balance_cents: number | null;
  tip_cents: number | null;
  unclassified_cents: number | null;
  allocation_version: number | null;
  operation_key?: string | null;
  source?: string | null;
}

export interface OverviewOperation {
  operation_key: string;
  created_at: string;
  kind: 'amount_only' | 'allocated' | 'mixed';
  unfinished: boolean;
  verified: boolean;
  request_amount_cents: number;
  request_allocation: string | null;
  rows: OverviewRow[];
}

export interface RefundOverview {
  order_id: string;
  payments: OverviewPayment[];
  operations: OverviewOperation[];
  refunds: OverviewRow[];
  unlinked_history_cents: number;
  refundable_payment_count: number;
}

const COMPONENTS = ['deposit', 'balance', 'tip'] as const;
export type Component = typeof COMPONENTS[number];
export const COMPONENT_LABEL: Record<Component, string> = { deposit: 'Deposit', balance: 'Remaining Balance', tip: 'Tip' };
const availKey = (c: Component) => `${c}_cents` as 'deposit_cents' | 'balance_cents' | 'tip_cents';

export function isEligible(p: OverviewPayment): boolean {
  return p.refundable && p.classified && p.reason_unavailable === null;
}

// What the screen showed, as one string: if it differs after a refresh, the Admin must look again before anything is sent.
export function availabilitySnapshot(o: RefundOverview | null): string {
  if (!o) return '';
  return o.payments.map((p) => `${p.id}:${p.reason_unavailable ?? ''}:${p.available.deposit_cents}:${p.available.balance_cents}:${p.available.tip_cents}:${p.remaining_total_cents}`).join('|')
    + `#${o.operations.filter((x) => x.unfinished).map((x) => x.operation_key).join(',')}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The request an Admin builds
// ---------------------------------------------------------------------------------------------------------------------
export interface AllocationLine { paymentId: string; depositPrincipalCents: number; balancePrincipalCents: number; tipCents: number }
export type AllocationInputs = Record<string, { deposit: string; balance: string; tip: string }>;

export interface BuiltAllocation {
  ok: boolean;
  lines: AllocationLine[];
  totalCents: number;
  depositCents: number;
  balanceCents: number;
  tipCents: number;
  paymentsAffected: number;
  fieldErrors: Record<string, string>;
  formError: string | null;
}

export const fieldId = (paymentId: string, c: Component) => `${paymentId}.${c}`;

// Entries -> lines. Only eligible payments are read; a line with nothing in it is left out; every entry is checked against what the
// database says is available. Nothing is adjusted or moved between payments or components: a problem is reported, never "fixed".
export function buildAllocation(payments: OverviewPayment[], inputs: AllocationInputs): BuiltAllocation {
  const fieldErrors: Record<string, string> = {};
  const lines: AllocationLine[] = [];
  let dep = 0, bal = 0, tip = 0;
  for (const p of payments) {
    if (!isEligible(p)) continue;
    const entry = inputs[p.id] ?? { deposit: '', balance: '', tip: '' };
    const cents: Record<Component, number> = { deposit: 0, balance: 0, tip: 0 };
    for (const c of COMPONENTS) {
      const parsed = parseDollars(entry[c]);
      if (!parsed.ok) { fieldErrors[fieldId(p.id, c)] = parsed.error; continue; }
      const limit = p.available[availKey(c)];
      if (parsed.cents > limit) { fieldErrors[fieldId(p.id, c)] = `More than the ${formatCents(limit)} available.`; continue; }
      cents[c] = parsed.cents;
    }
    const lineTotal = cents.deposit + cents.balance + cents.tip;
    if (lineTotal > p.remaining_total_cents && !Object.keys(fieldErrors).some((k) => k.startsWith(`${p.id}.`))) {
      fieldErrors[fieldId(p.id, 'deposit')] = `This payment can return at most ${formatCents(p.remaining_total_cents)} in total.`;
    }
    if (lineTotal > 0) {
      lines.push({ paymentId: p.id.toLowerCase(), depositPrincipalCents: cents.deposit, balancePrincipalCents: cents.balance, tipCents: cents.tip });
      dep += cents.deposit; bal += cents.balance; tip += cents.tip;
    }
  }
  const totalCents = dep + bal + tip;
  let formError: string | null = null;
  if (Object.keys(fieldErrors).length === 0) {
    if (totalCents <= 0) formError = 'Enter an amount to refund.';
    else if (lines.length > MAX_ALLOCATION_LINES) formError = `A single refund can include at most ${MAX_ALLOCATION_LINES} payments.`;
    else if (totalCents > MAX_REFUND_CENTS) formError = 'That total is too large.';
  }
  const canonical = canonicalLines(lines);
  return { ok: Object.keys(fieldErrors).length === 0 && formError === null, lines: canonical, totalCents, depositCents: dep, balanceCents: bal, tipCents: tip, paymentsAffected: lines.length, fieldErrors, formError };
}

// Lines in the order the database uses (by payment id), so the same refund always has the same shape.
export function canonicalLines(lines: AllocationLine[]): AllocationLine[] {
  return [...lines].sort((a, b) => (a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0));
}

// The identity the database records for a request (it computes the same string; this one is only used to recognise a retry).
export function allocationSignature(lines: AllocationLine[]): string {
  const sorted = canonicalLines(lines);
  const total = sorted.reduce((a, l) => a + l.depositPrincipalCents + l.balancePrincipalCents + l.tipCents, 0);
  return `v1|total=${total}|${sorted.map((l) => `${l.paymentId}:${l.depositPrincipalCents}:${l.balancePrincipalCents}:${l.tipCents}`).join('|')}`;
}

export function reasonToSend(reasonValue: string, reasonText: string): { ok: true; reason: string } | { ok: false; error: string } {
  if (reasonValue === 'other') {
    const t = reasonText.trim();
    if (!t) return { ok: false, error: 'Please describe the reason for the refund.' };
    return { ok: true, reason: t.slice(0, 500) };
  }
  if (!REFUND_REASONS.some((r) => r.value === reasonValue)) return { ok: false, error: 'Please choose a reason for the refund.' };
  return { ok: true, reason: reasonValue };
}

export interface SubmitBody {
  orderId: string;
  operationKey: string;
  reason: string;
  amountCents: number;
  allocations?: AllocationLine[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a stored operation
// ---------------------------------------------------------------------------------------------------------------------
export type StoredRequest =
  | { kind: 'allocated'; lines: AllocationLine[]; totalCents: number; reason: string }
  | { kind: 'amount_only'; totalCents: number; reason: string }
  | { kind: 'manual_review'; why: string };

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

// The request an unfinished operation was made with, rebuilt ONLY from its stored rows and only if everything agrees: the database's
// own verdict, the complete set of rows, the stored components, the request total and the stored identity. Anything less is a
// manual-review case: the screen then offers no way to send a refund for it.
export function reconstructStoredRequest(op: OverviewOperation): StoredRequest {
  const review = (why: string): StoredRequest => ({ kind: 'manual_review', why });
  if (!op || !Array.isArray(op.rows) || op.rows.length === 0) return review('The stored refund has no rows.');
  if (op.verified !== true) return review('The stored refund rows do not form one complete, consistent refund.');
  if (!isCents(op.request_amount_cents) || op.request_amount_cents <= 0) return review('The stored refund has no valid total.');
  const reasons = new Set(op.rows.map((r) => r.reason ?? ''));
  if (reasons.size !== 1) return review('The stored refund rows disagree about the reason.');
  const reason = (op.rows[0].reason ?? '').slice(0, 500);
  const rows = [...op.rows].sort((a, b) => (a.operation_index ?? 0) - (b.operation_index ?? 0));
  if (!rows.every((r, i) => r.operation_index === i && isCents(r.amount_cents) && r.amount_cents > 0)) return review('The stored refund rows are incomplete.');
  const sum = rows.reduce((a, r) => a + r.amount_cents, 0);
  if (sum !== op.request_amount_cents) return review('The stored refund rows do not add up to the requested total.');

  if (op.kind === 'amount_only') {
    if (!rows.every((r) => r.allocation_version === null)) return review('The stored refund mixes allocated and unallocated rows.');
    return { kind: 'amount_only', totalCents: op.request_amount_cents, reason };
  }
  if (op.kind !== 'allocated') return review('The stored refund mixes allocated and unallocated rows.');

  const lines: AllocationLine[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.allocation_version !== 1 || typeof r.payment_id !== 'string' || !r.payment_id) return review('A stored refund row has no recorded allocation.');
    const id = r.payment_id.toLowerCase();
    if (seen.has(id)) return review('A payment appears twice in the stored refund.');
    seen.add(id);
    if (!isCents(r.deposit_cents) || !isCents(r.balance_cents) || !isCents(r.tip_cents) || r.unclassified_cents !== 0) return review('A stored refund row has an incomplete allocation.');
    if (r.deposit_cents + r.balance_cents + r.tip_cents !== r.amount_cents) return review('A stored refund row does not add up.');
    lines.push({ paymentId: id, depositPrincipalCents: r.deposit_cents, balancePrincipalCents: r.balance_cents, tipCents: r.tip_cents });
  }
  if (allocationSignature(lines) !== op.request_allocation) return review('The stored refund does not match its recorded identity.');
  return { kind: 'allocated', lines: canonicalLines(lines), totalCents: op.request_amount_cents, reason };
}

export function submitBodyForStored(orderId: string, op: OverviewOperation, stored: StoredRequest): SubmitBody | null {
  if (stored.kind === 'allocated') return { orderId, operationKey: op.operation_key, reason: stored.reason, amountCents: stored.totalCents, allocations: stored.lines };
  if (stored.kind === 'amount_only') return { orderId, operationKey: op.operation_key, reason: stored.reason, amountCents: stored.totalCents };
  return null;
}

export interface OperationProgress { requestedCents: number; succeededCents: number; pendingCents: number; failedCents: number; unresolvedCents: number; reservedCents: number }

// pending = Stripe has it and has not finished; unresolved = a request may have been sent and the answer is not known;
// reserved = held for the refund but nothing has been sent yet.
export function rowState(r: Pick<OverviewRow, 'status' | 'stripe_refund_id' | 'provider_attempted'>): 'succeeded' | 'failed' | 'pending' | 'unresolved' | 'reserved' {
  if (r.status === 'succeeded') return 'succeeded';
  if (r.status === 'failed') return 'failed';
  if (r.stripe_refund_id) return 'pending';
  return r.provider_attempted ? 'unresolved' : 'reserved';
}

export function progressOf(op: OverviewOperation): OperationProgress {
  const out: OperationProgress = { requestedCents: op.request_amount_cents, succeededCents: 0, pendingCents: 0, failedCents: 0, unresolvedCents: 0, reservedCents: 0 };
  for (const r of op.rows) {
    const s = rowState(r);
    if (s === 'succeeded') out.succeededCents += r.amount_cents;
    else if (s === 'failed') out.failedCents += r.amount_cents;
    else if (s === 'pending') out.pendingCents += r.amount_cents;
    else if (s === 'unresolved') out.unresolvedCents += r.amount_cents;
    else out.reservedCents += r.amount_cents;
  }
  return out;
}

export const ROW_STATE_LABEL: Record<ReturnType<typeof rowState>, string> = {
  succeeded: 'Refunded',
  failed: 'Failed',
  pending: 'Pending at Stripe',
  unresolved: 'Result not yet known',
  reserved: 'Reserved, not yet sent',
};

export const UNKNOWN_ALLOCATION_TEXT = 'Allocation unavailable — historical refund';

// "$75.00 deposit · $25.00 tip" for a refund row that was allocated, or the historical-refund notice.
export function componentSummary(r: Pick<OverviewRow, 'allocation_version' | 'deposit_cents' | 'balance_cents' | 'tip_cents' | 'unclassified_cents'>): string {
  if (r.allocation_version !== 1) return UNKNOWN_ALLOCATION_TEXT;
  const parts: string[] = [];
  if ((r.deposit_cents ?? 0) > 0) parts.push(`${formatCents(r.deposit_cents as number)} deposit`);
  if ((r.balance_cents ?? 0) > 0) parts.push(`${formatCents(r.balance_cents as number)} remaining balance`);
  if ((r.tip_cents ?? 0) > 0) parts.push(`${formatCents(r.tip_cents as number)} tip`);
  if ((r.unclassified_cents ?? 0) > 0) parts.push(`${formatCents(r.unclassified_cents as number)} not classified`);
  return parts.join(' · ') || UNKNOWN_ALLOCATION_TEXT;
}

export function paymentTitle(p: OverviewPayment): string {
  const type = p.type ? p.type.replace(/_/g, ' ') : 'payment';
  const card = p.payment_brand && p.payment_last4 ? `${p.payment_brand} •••• ${p.payment_last4}` : p.payment_method === 'card' || !p.payment_method ? 'Card' : p.payment_method;
  const when = p.paid_at || p.created_at;
  const date = when ? new Date(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return [type.charAt(0).toUpperCase() + type.slice(1), card, date].filter(Boolean).join(' · ');
}
