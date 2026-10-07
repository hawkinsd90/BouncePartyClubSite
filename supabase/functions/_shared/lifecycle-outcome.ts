// Payment-outcome derivation for order-lifecycle's customer-proof path.
//
// A customer (or anonymous browser) must never be able to assert an authoritative payment outcome such as
// "waived" or "charged_now" to confirm an order. For callers that are not staff and not the backend, the outcome is
// derived from the order's own deposit state. The caller's requested value is only kept as a label when the order
// state already agrees with it. When the deposit is still uncollected the result is a value outside the lifecycle
// guard's bypass list, so the existing guard rejects the confirmation.
//
// No imports, so it can be tested outside Deno.

export const UNVERIFIED_CUSTOMER_OUTCOME = "unverified_customer_claim";

export function deriveCustomerOutcome(
  requestedOutcome: unknown,
  depositDueCents: number | null | undefined,
  depositPaidCents: number | null | undefined,
): string {
  const due = typeof depositDueCents === "number" ? depositDueCents : 0;
  const paid = typeof depositPaidCents === "number" ? depositPaidCents : 0;
  const requested = typeof requestedOutcome === "string" ? requestedOutcome : "";

  // Nothing is owed: confirming needs no collected deposit.
  if (due <= 0) {
    return requested === "waived" ? "waived" : "zero_due_with_card";
  }

  // The required deposit is already collected on the order row.
  if (paid >= due) {
    return requested === "charged_now" ? "charged_now" : "already_paid";
  }

  // A deposit is owed and not collected: no client claim can establish otherwise.
  return UNVERIFIED_CUSTOMER_OUTCOME;
}

// ---------------------------------------------------------------------------------------------------------------
// Customer confirmation pathways (Payment Safety A2.2 correction)
// ---------------------------------------------------------------------------------------------------------------
// For an UNTRUSTED caller (order-bound proof only) access to the order is not permission to confirm it. Each customer-facing
// confirmation is a named pathway with its own prerequisites, checked here against the order's stored state; the
// caller-supplied payment outcome string is never trusted. Unknown sources fail closed. Trusted callers (backend, admin,
// master) bypass this and keep their existing behavior.
//
// The pathways are exactly the sources the customer-facing code uses today:
//   customer_approval_already_paid   portal: approve edited order whose deposit is already collected
//   customer_approval_zero_deposit   portal: approve edited order with a $0 deposit and a saved card
//   customer_approval_charge_deposit portal: after charge-deposit collected the deposit
//   invoice_acceptance_no_card       Admin Invoice that needs no card and no deposit
//   invoice_card_saved_fallback      Admin Invoice, $0 deposit, card just saved through Stripe
//   webhook_fallback_admin_invoice   payment-complete page fallback for an Admin Invoice
//   invoice_page_payment             legacy /invoice/view page payment for an Admin Invoice

export const CUSTOMER_CONFIRM_SOURCES: readonly string[] = [
  "customer_approval_already_paid",
  "customer_approval_zero_deposit",
  "customer_approval_charge_deposit",
  "invoice_acceptance_no_card",
  "invoice_card_saved_fallback",
  "webhook_fallback_admin_invoice",
  "invoice_page_payment",
];

// The canonical "a card is saved" rule used by the portal projection and the approval screens.
export function hasSavedCard(order: { stripe_customer_id?: unknown; stripe_payment_method_id?: unknown }): boolean {
  return !!(order.stripe_customer_id && order.stripe_payment_method_id);
}

export interface CustomerConfirmationInput {
  source: unknown;
  order: {
    status?: string | null;
    deposit_due_cents?: number | null;
    deposit_paid_cents?: number | null;
    require_card_on_file?: boolean | null;
    stripe_customer_id?: unknown;
    stripe_payment_method_id?: unknown;
    stripe_payment_status?: string | null;
  };
  // True when the visit holds an invoice-type token, or (owner / Stripe session) the order has a current invoice link.
  hasInvoiceContext: boolean;
}

export type CustomerConfirmationVerdict = { ok: true; outcome: string } | { ok: false; reason: string };

export function evaluateCustomerConfirmation(input: CustomerConfirmationInput): CustomerConfirmationVerdict {
  const { order } = input;
  const source = typeof input.source === "string" ? input.source : "";
  if (!CUSTOMER_CONFIRM_SOURCES.includes(source)) return { ok: false, reason: "source_not_permitted" };

  const status = order.status ?? "";
  const due = typeof order.deposit_due_cents === "number" ? order.deposit_due_cents : 0;
  const paid = typeof order.deposit_paid_cents === "number" ? order.deposit_paid_cents : 0;
  const card = hasSavedCard(order);
  const inStates = (...allowed: string[]) => allowed.includes(status);

  switch (source) {
    case "customer_approval_already_paid":
      if (!inStates("awaiting_customer_approval", "confirmed")) return { ok: false, reason: "state" };
      if (!(paid >= due && (paid > 0 || order.stripe_payment_status === "paid"))) return { ok: false, reason: "deposit_not_collected" };
      return { ok: true, outcome: "already_paid" };

    case "customer_approval_zero_deposit":
      if (!inStates("awaiting_customer_approval")) return { ok: false, reason: "state" };
      if (due !== 0) return { ok: false, reason: "deposit_due" };
      if (!card) return { ok: false, reason: "card_required" };
      return { ok: true, outcome: "zero_due_with_card" };

    case "customer_approval_charge_deposit":
      if (!inStates("awaiting_customer_approval", "confirmed")) return { ok: false, reason: "state" };
      if (!(due > 0 && paid >= due)) return { ok: false, reason: "deposit_not_collected" };
      return { ok: true, outcome: "charged_now" };

    case "invoice_acceptance_no_card":
      if (!input.hasInvoiceContext) return { ok: false, reason: "invoice_context" };
      if (!inStates("draft")) return { ok: false, reason: "state" };
      if (due !== 0 || order.require_card_on_file !== false) return { ok: false, reason: "card_or_deposit_required" };
      return { ok: true, outcome: "waived" };

    case "invoice_card_saved_fallback":
      if (!input.hasInvoiceContext) return { ok: false, reason: "invoice_context" };
      if (!inStates("draft", "confirmed")) return { ok: false, reason: "state" };
      if (due !== 0) return { ok: false, reason: "deposit_due" };
      if (!card) return { ok: false, reason: "card_required" };
      return { ok: true, outcome: "zero_due_with_card" };

    case "webhook_fallback_admin_invoice":
    case "invoice_page_payment": {
      // Admin Invoice payment fallbacks
      if (!input.hasInvoiceContext) return { ok: false, reason: "invoice_context" };
      if (!inStates("draft", "confirmed")) return { ok: false, reason: "state" };
      if (due > 0) return paid >= due ? { ok: true, outcome: "charged_now" } : { ok: false, reason: "deposit_not_collected" };
      return card ? { ok: true, outcome: "zero_due_with_card" } : { ok: false, reason: "card_required" };
    }

    default:
      // Unreachable for an allowlisted source; any other source fails closed (second guard behind the allowlist).
      return { ok: false, reason: "source_not_permitted" };
  }
}
