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
