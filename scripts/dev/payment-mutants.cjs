// Mutants for payment charging: each one breaks one safety property; a test must fail.
// Run:  node scripts/dev/mutation-runner.cjs scripts/dev/payment-mutants.cjs      (ONLY=<text> to run a few while developing)
const fs = require('fs');
const SQL = 'supabase/migrations/20261019120000_add_payment_operations_and_single_financial_application.sql';
const PO = 'supabase/functions/_shared/payment-operations.ts';
const CD = 'supabase/functions/charge-deposit/index.ts';
const CB = 'supabase/functions/customer-balance-payment/index.ts';
const WH = 'supabase/functions/stripe-webhook/handlers.ts';
const RC = 'supabase/functions/reconcile-balance-payment/index.ts';
const SC = 'supabase/functions/stripe-checkout/index.ts';
const SG = 'supabase/functions/stripe-charge/index.ts';
// Step 3C-A: refund safety and financial write authority
const MIG4 = 'supabase/migrations/20261022120000_refund_safety_and_financial_write_authority.sql';
const MIG5 = 'supabase/migrations/20261023120000_refund_allocation_schema.sql';
const MIG6 = 'supabase/migrations/20261024120000_refund_allocation_reservation.sql';
const RO = 'supabase/functions/_shared/refund-operations.ts';
const SR = 'supabase/functions/stripe-refund/index.ts';
const WHI = 'supabase/functions/stripe-webhook/index.ts';
const OL = 'supabase/functions/order-lifecycle/index.ts';
const OAS = 'src/lib/orders/orderApprovalService.ts';
const UI_PAYMENTS_TAB = 'src/components/order-detail/PaymentsTab.tsx';
const UI_PAY_SECTION = 'src/components/pending-order/PaymentManagementSection.tsx';
const UI_TASK_MODAL = 'src/components/admin/tasks/TaskDetailModal.tsx';
const KEYFILE = 'src/lib/payments/refundOperationKey.ts';
const REQ = 'src/lib/payments/refundAllocationRequest.ts';
const CTL = 'src/lib/payments/refundController.ts';
const PAN = 'src/components/admin/orders/refunds/RefundAllocationPanel.tsx';
const MIG8 = 'supabase/migrations/20261025120000_refund_overview_for_admin.sql';

// exact, unique anchor
const repl = (a, b) => (src) => {
  const n = src.split(a).length - 1;
  if (n === 0) throw new Error('anchor missing: ' + a.slice(0, 80));
  if (n !== 1) throw new Error('anchor not unique (' + n + '): ' + a.slice(0, 80));
  return src.replace(a, () => b);
};
// every occurrence
const replAll = (a, b) => (src) => {
  if (!src.includes(a)) throw new Error('anchor missing: ' + a.slice(0, 80));
  return src.split(a).join(b);
};

const M = [
  // ---------------------------------------------------------------- the database decides the amounts
  [CD, 'charge-deposit passes the browser amount for a deposit', [replAll('requestedPrincipalCents: isBalanceCharge ? (requestPaymentAmountCents as number) : null,', 'requestedPrincipalCents: typeof requestPaymentAmountCents === "number" ? requestPaymentAmountCents : null,')]],
  [SQL, 'accept a negative tip', [repl('(p_requested_tip_cents IS NOT NULL AND (p_requested_tip_cents < 0 OR p_requested_tip_cents > v_max))', '(p_requested_tip_cents IS NOT NULL AND p_requested_tip_cents > v_max)')]],
  [SQL, 'accept a negative requested principal', [repl('(p_requested_principal_cents IS NOT NULL AND (p_requested_principal_cents < 0 OR p_requested_principal_cents > v_max))', '(p_requested_principal_cents IS NOT NULL AND p_requested_principal_cents > v_max)')]],
  [CD, 'charge-deposit lets a negative or fractional tip through', [repl('    if (requestTipCents !== undefined && requestTipCents !== null && !isCents(requestTipCents)) {\n      return reply(400, { success: false, code: "INVALID_TIP", error: "Invalid tip amount." });\n    }\n', '')]],
  [CD, 'charge-deposit lets a negative or fractional amount through', [repl('    if (requestPaymentAmountCents !== undefined && requestPaymentAmountCents !== null && !isCents(requestPaymentAmountCents)) {\n      return reply(400, { success: false, code: "INVALID_AMOUNT", error: "Invalid payment amount." });\n    }\n', '')]],
  [PO, 'whole-cent validation accepts any number', [repl('return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_PAYMENT_CENTS;', 'return typeof value === "number";')]],
  [CB, 'customer balance no longer validates the tip', [repl('|| !isCents(rawTipCents)) {', '|| false) {')]],
  [CB, 'customer balance no longer validates the amount', [repl('|| !isCents(amountCents) ||', '|| false ||')]],

  // ---------------------------------------------------------------- uniqueness
  [SQL, 'remove the one-open-operation-per-order rule', [repl("CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_operation_per_order\n  ON public.payments (order_id)\n  WHERE operation_key IS NOT NULL AND status = 'pending';\n", '')]],
  [SQL, 'remove operation-key uniqueness', [repl('CREATE UNIQUE INDEX IF NOT EXISTS payments_operation_key_unique\n  ON public.payments (operation_key)\n  WHERE operation_key IS NOT NULL;\n', '')]],
  [SQL, 'remove PaymentIntent uniqueness', [repl('CREATE UNIQUE INDEX IF NOT EXISTS payments_original_payment_intent_unique\n  ON public.payments (stripe_payment_intent_id)\n  WHERE stripe_payment_intent_id IS NOT NULL AND refunded_payment_id IS NULL AND amount_cents > 0;\n', '')]],
  [SQL, 'PaymentIntent uniqueness also covers refund rows', [repl('WHERE stripe_payment_intent_id IS NOT NULL AND refunded_payment_id IS NULL AND amount_cents > 0;', 'WHERE stripe_payment_intent_id IS NOT NULL;')]],
  [SQL, 'remove Checkout Session uniqueness', [repl('CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_session_unique\n  ON public.payments (stripe_checkout_session_id)\n  WHERE stripe_checkout_session_id IS NOT NULL;\n', '')]],
  [SQL, 'drop the principal + tip = gross constraint', [repl('AND principal_amount_cents + tip_amount_cents = amount_cents', 'AND true')]],

  // ---------------------------------------------------------------- idempotency
  [PO, 'a fresh Stripe idempotency key on every retry', [repl('return `${op.operationKey}:${scope}`;', 'return `${op.operationKey}:${scope}:${Math.random()}`;')]],
  [PO, 'no Stripe idempotency key on the charge', [repl('        { idempotencyKey: operationIdempotencyKey(op, "pi") },\n', '')]],
  [CB, 'no Stripe idempotency key on the Checkout Session', [repl('  }, { idempotencyKey: operationIdempotencyKey(op, "cs") });', '  });')]],
  [PO, 'an unknown provider error closes the operation as failed', [repl('    // Unknown: keep the operation (and its key) so the retry resumes it instead of creating a second charge.\n    await releaseOperation(db, op, null);', '    await releaseOperation(db, op, "failed");')]],
  [PO, 'a declined card leaves the operation open', [repl('    if (cls === "declined") {\n      await releaseOperation(db, op, "failed");', '    if (cls === "declined") {\n      await releaseOperation(db, op, null);')]],
  [PO, 'blind create beyond the idempotency window', [repl('} else if (op.providerAttemptedAt && ageSeconds(op.providerAttemptedAt) > IDEMPOTENCY_REPLAY_SECONDS) {', '} else if (false) {')]],

  // ---------------------------------------------------------------- claim ownership / lease
  [SQL, 'finalize ignores who owns the claim', [repl("    IF v_op.claim_id IS DISTINCT FROM p_claim_id THEN\n      RETURN jsonb_build_object('outcome', 'not_owner', 'applied', false);\n    END IF;\n", '')]],
  [SQL, 'release ignores who owns the claim', [repl("      failed_at = CASE WHEN p_final_status = 'failed' THEN now() ELSE failed_at END\n  WHERE id = p_payment_id\n    AND operation_key IS NOT NULL\n    AND status = 'pending'\n    AND claim_id = p_claim_id\n    AND COALESCE(order_financials_applied, false) = false;", "      failed_at = CASE WHEN p_final_status = 'failed' THEN now() ELSE failed_at END\n  WHERE id = p_payment_id\n    AND operation_key IS NOT NULL\n    AND status = 'pending'\n    AND COALESCE(order_financials_applied, false) = false;")]],
  [SQL, 'record-provider ignores who owns the claim', [repl("      AND claim_id = p_claim_id\n      AND (p_payment_intent_id IS NULL", "      AND (p_payment_intent_id IS NULL")]],
  [SQL, 'a stale claim is never taken over', [repl('       AND v_op.claimed_at IS NOT NULL\n       AND v_op.claimed_at > now() - make_interval(secs => p_stale_seconds) THEN', '       AND v_op.claimed_at IS NOT NULL THEN')]],
  [SQL, 'a live claim can be taken over by anyone', [repl('    IF v_op.claim_id IS NOT NULL\n       AND v_op.claim_id <> p_claim_id', '    IF false AND v_op.claim_id IS NOT NULL\n       AND v_op.claim_id <> p_claim_id')]],
  [SQL, 'the open-operation lookup finds nothing', [repl("  WHERE order_id = p_order_id AND operation_key IS NOT NULL AND status = 'pending'\n  ORDER BY created_at", "  WHERE order_id = p_order_id AND operation_key IS NOT NULL AND status = 'pending-never'\n  ORDER BY created_at")]],
  [SQL, 'the claim does not lock the order row', [repl('SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;', 'SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;')]],
  [SQL, 'release accepts any final status', [repl("(p_final_status IS NOT NULL AND p_final_status NOT IN ('failed', 'cancelled'))", 'false')]],
  [SQL, 'release can close an operation that was already applied', [repl("      failed_at = CASE WHEN p_final_status = 'failed' THEN now() ELSE failed_at END\n  WHERE id = p_payment_id\n    AND operation_key IS NOT NULL\n    AND status = 'pending'\n    AND claim_id = p_claim_id\n    AND COALESCE(order_financials_applied, false) = false;", "      failed_at = CASE WHEN p_final_status = 'failed' THEN now() ELSE failed_at END\n  WHERE id = p_payment_id\n    AND operation_key IS NOT NULL\n    AND status = 'pending'\n    AND claim_id = p_claim_id;")]],
  [PO, 'an unexpected failure drops the operation instead of releasing the lease', [repl('    await releaseOperation(db, op, null);\n    return { kind: "unconfirmed", code: "PAYMENT_STATUS_UNKNOWN", paymentIntentId: null };', '    return { kind: "unconfirmed", code: "PAYMENT_STATUS_UNKNOWN", paymentIntentId: null };')]],
  [CD, 'charge-deposit keeps the lease after an unexpected failure', [repl('      await releaseOperation(supabaseForRelease, ownedOp, null);', '      void supabaseForRelease;')]],

  // ---------------------------------------------------------------- single financial application
  [SQL, 'remove the already-applied guard', [repl('  IF COALESCE(v_op.order_financials_applied, false) THEN\n    IF p_claim_id IS NULL', '  IF false THEN\n    IF p_claim_id IS NULL')]],
  [WH, 'the webhook notifies even when it did not apply the payment', [repl('  if (!fin.applied) return "already_applied";\n', '')]],
  [CD, 'charge-deposit notifies even when the webhook applied the payment', [repl('    if (fin.applied && !isBalance) {', '    if (!isBalance) {')]],
  [CB, 'customer-balance-payment notifies even when it did not apply the payment', [repl('          if (fin.applied) {\n            if (order.customer_id) {', '          if (true) {\n            if (order.customer_id) {')]],
  [RC, 'reconcile notifies even when the payment was already applied', [repl('    if (!fin.applied) {\n      return new Response(', '    if (false) {\n      return new Response(')]],
  [SQL, 'finalize applies the amount the provider reported without checking the operation', [repl("  IF p_amount_received <> v_op.amount_cents THEN\n    RETURN jsonb_build_object('outcome', 'amount_mismatch', 'applied', false, 'expected_cents', v_op.amount_cents);\n  END IF;\n", '')]],
  [SQL, 'an Admin balance charge erases the stored tip', [repl('tip_cents = COALESCE(tip_cents, 0) + v_tip,', 'tip_cents = v_tip,')]],
  [SQL, 'a deposit lowers the stored tip', [repl('tip_cents = GREATEST(COALESCE(tip_cents, 0), v_charged_tip),', 'tip_cents = v_charged_tip,')]],
  [SQL, 'a deposit payment does not confirm a draft invoice', [repl("IF v_order.status IN ('draft', 'quote', 'pending_review', 'awaiting_customer_approval') THEN\n      v_new_status := 'confirmed';", "IF v_order.status IN ('quote', 'pending_review', 'awaiting_customer_approval') THEN\n      v_new_status := 'confirmed';")]],
  [SQL, 'the provider path trusts any operation key', [repl("  ELSE\n    IF v_op.operation_key IS DISTINCT FROM p_operation_key THEN\n      RETURN jsonb_build_object('outcome', 'not_found');\n    END IF;\n  END IF;", '  END IF;')]],

  // ---------------------------------------------------------------- derivation rules
  [SQL, 'staff may charge any order status', [repl("      IF v_order.status <> 'pending_review' THEN", '      IF false THEN')]],
  [SQL, 'a customer may charge a draft that is not an invoice', [repl("ELSIF v_order.status = 'draft' AND EXISTS (SELECT 1 FROM public.invoice_links il WHERE il.order_id = p_order_id AND il.link_type = 'invoice') THEN", "ELSIF v_order.status = 'draft' THEN")]],
  [SQL, 'Custom is not bounded', [repl('IF v_sel_cents IS NULL OR v_sel_cents - v_paid < v_dep_rem OR v_sel_cents - v_paid > v_dep_rem + v_bd THEN', 'IF v_sel_cents IS NULL THEN')]],
  [SQL, 'an already-charged tip is charged again', [repl('v_tip := GREATEST(0, COALESCE(v_order.tip_cents, 0) - v_charged_tip);', 'v_tip := GREATEST(0, COALESCE(v_order.tip_cents, 0));')]],
  [SQL, 'a deposit ignores an existing deposit payment in the ledger', [repl("      ELSIF EXISTS (SELECT 1 FROM public.payments pd WHERE pd.order_id = p_order_id AND pd.type = 'deposit' AND pd.status = 'succeeded' AND pd.amount_cents > 0) THEN", '      ELSIF false THEN')]],

  // ---------------------------------------------------------------- card save is not payment
  [WH, 'a card saved on an Admin Invoice confirms it (checkout session) even with a deposit due', [repl('    const newStatus = isAdminInvoice ? (principalOutstanding ? null : "confirmed") : "pending_review";\n    const setupSafeToAdvance', '    const newStatus = isAdminInvoice ? "confirmed" : "pending_review";\n    const setupSafeToAdvance')]],
  [WH, 'a card saved on an Admin Invoice confirms it (setup intent) even with a deposit due', [repl('  const newStatus = isAdminInvoice ? (principalOutstanding ? null : "confirmed") : "pending_review";\n  const siSafeToAdvance', '  const newStatus = isAdminInvoice ? "confirmed" : "pending_review";\n  const siSafeToAdvance')]],
  [WH, 'only one invoice link is tolerated', [repl('    .eq("link_type", "invoice")\n    .limit(1);', '    .eq("link_type", "invoice")\n    .maybeSingle();')]],
  [WH, 'a PaymentIntent with no operation is applied from its raw amount', [repl('    await reportUnmatchedPayment(supabaseClient, orderId, paymentIntent.id, `a successful ${paymentType} payment of ${paymentIntent.amount_received || 0} cents has no payment operation and no ledger row`);', '    await supabaseClient.from("orders").update({ balance_paid_cents: paymentIntent.amount_received || 0 }).eq("id", orderId);')]],
  [WH, 'payment_failed closes any payment', [repl('    .eq("stripe_payment_intent_id", paymentIntent.id)\n    .eq("status", "pending")\n    .is("stripe_checkout_session_id", null);', '    .eq("stripe_payment_intent_id", paymentIntent.id);')]],
  [WH, 'payment_failed closes an open Checkout operation', [repl('    .eq("status", "pending")\n    .is("stripe_checkout_session_id", null);', '    .eq("status", "pending");')]],
  [WH, 'an unpaid Checkout Session is applied', [repl('    if (session.payment_status !== "paid") {', '    if (false) {')]],
  [WH, 'a failed finalize is swallowed by the webhook', [repl('  if (fin.outcome === "error") {', '  if (false) {')]],
  [WH, 'a webhook amount mismatch is applied anyway', [repl('  if (!fin.ok) {\n    await reportUnmatchedPayment(supabaseClient, p.orderId, reference, `a successful ${p.source} payment could not be applied (${fin.outcome})`);\n    return "refused";\n  }', '  if (false) {\n    return "refused";\n  }')]],
  [PO, 'a failed finalize is treated as success', [repl('    if (!fin.ok) {\n      // The money moved but is not applied yet.', '    if (false) {\n      // The money moved but is not applied yet.')]],
  [PO, 'finalize reports an error as ok', [repl('ok: outcome === "applied" || outcome === "already_applied",', 'ok: outcome === "applied" || outcome === "already_applied" || outcome === "error",')]],

  // ---------------------------------------------------------------- Checkout operations
  [PO, 'an open Checkout Session is not expired when replaced', [repl('      await stripe.checkout.sessions.expire(op.checkoutSessionId);\n', '')]],
  [PO, 'a paid Checkout Session is not settled before a new payment starts', [repl('  if (session?.payment_status === "paid") {\n    const pi = session.payment_intent', '  if (false) {\n    const pi = session.payment_intent')]],
  [CB, 'an unresolved card attempt does not block Checkout', [repl('    if (cardAttemptPossible) {\n      // The card path was tried', '    if (false) {\n      // The card path was tried')]],
  [CB, 'a lost card charge is not looked up before Checkout is offered', [repl('    if (cardAttemptPossible && op.providerAttemptedAt && !op.providerPaymentIntentId) {\n      await adoptProviderPaymentIntent(supabaseClient, stripe, op);\n    }', '')]],
  [CB, 'Checkout is not given the operation metadata', [repl('    payment_operation_key: op.operationKey,\n    payment_id: op.paymentId,\n  };', '  };')]],
  [RC, 'reconcile applies a session that names no operation', [repl('    if (!operationKey || !operationPaymentId) {', '    if (false) {')]],

  // ---------------------------------------------------------------- authorization and retired paths
  [CD, 'a customer may run a balance charge through charge-deposit', [repl('      if (requestSelectedPaymentType === "balance") {\n        console.warn', '      if (false) {\n        console.warn')]],
  [CD, 'every caller is treated as a customer', [replAll('actor: staffCaller ? "staff" : "customer",', 'actor: "customer",')]],
  [CD, 'a customer\'s selection is ignored', [replAll('useSelection: !staffCaller,', 'useSelection: false,')]],
  [CD, 'the deposit the customer was shown is not checked', [replAll('expectedDepositDueCents: !staffCaller && isCents(requestExpectedDepositDueCents) ? requestExpectedDepositDueCents : null,', 'expectedDepositDueCents: null,')]],
  [SC, 'stripe-checkout payment mode is available again', [repl('    if (setupMode !== true && bookingMode !== true) {', '    if (false) {')]],
  [SG, 'stripe-charge answers again', [repl('{ status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },', '{ status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },')]],
  // ---------------------------------------------------------------- amounts re-derived (new anchors)
  [SQL, 'trust the customer deposit amount', [repl('      ELSE\n        v_dep_comp := v_dep_rem;\n        v_bal_comp := 0;\n      END IF;\n      v_principal := v_dep_comp + v_bal_comp;', '      ELSE\n        v_dep_comp := COALESCE(p_requested_principal_cents, v_dep_rem);\n        v_bal_comp := 0;\n      END IF;\n      v_principal := v_dep_comp + v_bal_comp;')]],
  [SQL, 'trust a balance amount without the server cap', [repl("      IF p_requested_principal_cents > v_bd THEN\n        v_err := jsonb_build_object('outcome', 'over_balance', 'balance_due_cents', v_bd);\n        EXIT derive;\n      END IF;\n", '')]],
  [SQL, 'recovery can over-apply a balance', [repl('v_bal_applied := LEAST(v_op.balance_principal_cents, v_bd);', 'v_bal_applied := v_op.balance_principal_cents;')]],
  [SQL, 'recovery can over-apply a deposit', [repl('v_dep_applied := LEAST(v_op.deposit_principal_cents, v_dep_rem);', 'v_dep_applied := v_op.deposit_principal_cents;')]],
  [SQL, 'catch-up is charged as a whole deposit', [(src) => { const r = /      IF v_dp > 0 THEN[\s\S]*?EXIT derive;\n      END IF;\n/; if (!r.test(src)) throw new Error('anchor missing: catch-up'); return src.replace(r, ''); }]],
  [SQL, 'a stale customer page is not detected', [(src) => { const r = /      IF p_expected_deposit_due_cents IS NOT NULL AND p_expected_deposit_due_cents <> v_dd THEN[\s\S]*?EXIT derive;\n      END IF;\n/; if (!r.test(src)) throw new Error('anchor missing: expected'); return src.replace(r, ''); }]],
  [SQL, 'a customer may charge a booking request awaiting review', [repl("        IF v_order.status = 'awaiting_customer_approval' THEN\n          NULL;", "        IF v_order.status IN ('awaiting_customer_approval', 'pending_review') THEN\n          NULL;")]],
  [SQL, 'a tip the ledger cannot classify is guessed into a charge', [repl('        IF v_legacy THEN\n          v_tip := 0;', '        IF false THEN\n          v_tip := 0;')]],
  [PO, 'an open Checkout Session is reused for a different request', [repl('const sameWanted = !op.stale && wanted !== null && wanted.principalCents === op.principalCents && wanted.tipCents === op.tipCents;', 'const sameWanted = true;')]],
  [PO, 'a STALE Checkout operation is offered again', [repl('const sameWanted = !op.stale && wanted !== null', 'const sameWanted = wanted !== null')]],

  // ---------------------------------------------------------------- deposit / balance allocation
  [SQL, 'Full principal goes entirely into deposit_paid', [repl("SET deposit_paid_cents = v_dp + v_dep_applied,\n        balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_applied,\n        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),\n        stripe_payment_status = 'paid',", "SET deposit_paid_cents = v_dp + v_dep_applied + v_bal_applied,\n        balance_paid_cents = COALESCE(balance_paid_cents, 0),\n        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),\n        stripe_payment_status = 'paid',")]],
  [SQL, 'a Full/Custom payment does not increment balance_paid', [repl("balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_applied,\n        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),\n        stripe_payment_status = 'paid',", "balance_paid_cents = COALESCE(balance_paid_cents, 0),\n        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),\n        stripe_payment_status = 'paid',")]],
  [SQL, 'a balance payment reduces balance_due without incrementing balance_paid', [repl("balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_applied,\n        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),\n        tip_cents = COALESCE(tip_cents, 0) + v_tip,", "balance_paid_cents = COALESCE(balance_paid_cents, 0),\n        balance_due_cents = GREATEST(0, v_bd - v_bal_applied),\n        tip_cents = COALESCE(tip_cents, 0) + v_tip,")]],
  [SQL, 'a balance payment increments balance_paid but not down balance_due', [repl("balance_due_cents = GREATEST(0, v_bd - v_bal_applied),\n        tip_cents = COALESCE(tip_cents, 0) + v_tip,", "balance_due_cents = v_bd,\n        tip_cents = COALESCE(tip_cents, 0) + v_tip,")]],
  [SQL, 'the tip is applied as balance principal', [repl('v_bal_applied := LEAST(v_op.balance_principal_cents, v_bd);', 'v_bal_applied := LEAST(v_op.balance_principal_cents + v_tip, v_bd);')]],
  [SQL, 'the tip is applied as deposit principal', [repl('v_dep_applied := LEAST(v_op.deposit_principal_cents, v_dep_rem);', 'v_dep_applied := LEAST(v_op.deposit_principal_cents + v_tip, v_dep_rem);')]],
  [SQL, 'Custom stores the whole amount as deposit', [repl('          v_dep_comp := LEAST(v_sel_cents - v_paid, v_dep_rem);\n          v_bal_comp := (v_sel_cents - v_paid) - v_dep_comp;', '          v_dep_comp := v_sel_cents - v_paid;\n          v_bal_comp := 0;')]],
  [SQL, 'Full stores the whole amount as deposit', [repl("        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dep_rem;\n          v_bal_comp := v_bd;", "        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dep_rem + v_bd;\n          v_bal_comp := 0;")]],
  [SQL, 'Full uses the persisted amount for its balance part', [repl("        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dep_rem;\n          v_bal_comp := v_bd;", "        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dep_rem;\n          v_bal_comp := COALESCE(v_sel_cents - v_dd, v_bd);")]],
  [SQL, 'a balance payment is stored as deposit', [repl('      v_dep_comp := 0;\n      v_bal_comp := p_requested_principal_cents;', '      v_dep_comp := p_requested_principal_cents;\n      v_bal_comp := 0;')]],
  [SQL, 'the components are not required to add up', [repl('          AND deposit_principal_cents + balance_principal_cents = principal_amount_cents\n', '')]],
  [SQL, 'principal and tip are not required to add up to the gross', [repl('          AND principal_amount_cents + tip_amount_cents = amount_cents\n', '')]],
  [SQL, 'the operation row stores a principal that is not the sum of its parts', [repl('    v_principal, v_dep_comp, v_bal_comp, v_tip,\n    p_claim_id, now(), false', '    v_principal, v_dep_comp, v_bal_comp + 1, v_tip,\n    p_claim_id, now(), false')]],

  // ---------------------------------------------------------------- stale operations
  [SQL, 'an old operation is resumed without revalidating anything', [repl('    IF v_op.stripe_payment_intent_id IS NOT NULL THEN\n      -- A provider charge already exists', '    IF true THEN\n      -- A provider charge already exists')]],
  [SQL, 'an old operation is resumed after the deposit or balance changed', [repl("    IF v_op.principal_amount_cents IS DISTINCT FROM v_principal\n       OR v_op.deposit_principal_cents IS DISTINCT FROM v_dep_comp\n       OR v_op.balance_principal_cents IS DISTINCT FROM v_bal_comp\n       OR v_op.tip_amount_cents IS DISTINCT FROM v_tip THEN", '    IF false THEN')]],
  [SQL, 'an old operation is resumed after only its split changed', [repl("    IF v_op.principal_amount_cents IS DISTINCT FROM v_principal\n       OR v_op.deposit_principal_cents IS DISTINCT FROM v_dep_comp\n       OR v_op.balance_principal_cents IS DISTINCT FROM v_bal_comp\n       OR v_op.tip_amount_cents IS DISTINCT FROM v_tip THEN", "    IF v_op.principal_amount_cents IS DISTINCT FROM v_principal\n       OR v_op.tip_amount_cents IS DISTINCT FROM v_tip THEN")]],
  [SQL, 'an old operation is resumed after the tip changed', [repl("\n       OR v_op.tip_amount_cents IS DISTINCT FROM v_tip THEN\n      RETURN v_op_json || jsonb_build_object('outcome', 'stale_operation', 'reason', 'order_changed');", " THEN\n      RETURN v_op_json || jsonb_build_object('outcome', 'stale_operation', 'reason', 'order_changed');")]],
  [SQL, 'a cancelled, voided or otherwise unpayable order\'s operation is resumed', [repl("    IF v_err IS NOT NULL THEN\n      RETURN v_op_json || jsonb_build_object('outcome', 'stale_operation', 'reason', v_err->>'outcome', 'detail', v_err);\n    END IF;\n", ''), repl("    IF v_op.principal_amount_cents IS DISTINCT FROM v_principal\n       OR v_op.deposit_principal_cents IS DISTINCT FROM v_dep_comp\n       OR v_op.balance_principal_cents IS DISTINCT FROM v_bal_comp\n       OR v_op.tip_amount_cents IS DISTINCT FROM v_tip THEN", '    IF false THEN')]],
  [SQL, 'an old balance operation is resumed after the balance decreased', [repl("    IF v_err IS NOT NULL THEN\n      RETURN v_op_json || jsonb_build_object('outcome', 'stale_operation', 'reason', v_err->>'outcome', 'detail', v_err);\n    END IF;\n", ''), repl("    IF v_op.principal_amount_cents IS DISTINCT FROM v_principal\n       OR v_op.deposit_principal_cents IS DISTINCT FROM v_dep_comp\n       OR v_op.balance_principal_cents IS DISTINCT FROM v_bal_comp\n       OR v_op.tip_amount_cents IS DISTINCT FROM v_tip THEN", '    IF false THEN')]],
  [PO, 'a stale operation is handed back for charging without any check', [repl('    const op = operationFromClaim(r, p.claimId, true, true);\n', '    const op = operationFromClaim(r, p.claimId, true, false);\n    return { ok: true, op };\n')]],
  [PO, 'a stale operation may create a provider charge and rely on the finalizer clamp', [repl('    const op = operationFromClaim(r, p.claimId, true, true);\n', '    const op = operationFromClaim(r, p.claimId, true, false);\n    return { ok: true, op };\n'), repl('  if (op.stale && !op.providerPaymentIntentId) {', '  if (false) {')]],
  [PO, 'the last-line guard against a stale create is removed (the claim wrapper is intact)', [repl('  if (op.stale && !op.providerPaymentIntentId) {', '  if (false) {')]],
  [PO, 'a stale operation is not closed when nothing was charged', [repl('      await releaseOperation(db, op, "cancelled");\n      return { ok: false, outcome: refusal, detail: { stale: true, reason } };', '      await releaseOperation(db, op, null);\n      return { ok: false, outcome: refusal, detail: { stale: true, reason } };')]],
  [PO, 'a lost provider charge is not looked up before a stale operation is closed', [repl('const lookup: ProviderLookup = stripe ? await adoptProviderPaymentIntent(db, stripe, op) : { kind: "unknown", reason: "no_provider_client" };', 'const lookup: ProviderLookup = { kind: "unknown", reason: "skipped" };')]],
  [PO, 'age-based cancellation is reintroduced for stale operations', [repl('    if (!op.providerAttemptedAt) {\n      await releaseOperation(db, op, "cancelled");', '    if (!op.providerAttemptedAt || ageSeconds(op.createdAt) >= 120) {\n      await releaseOperation(db, op, "cancelled");')]],

  // ---------------------------------------------------------------- the state barrier
  [SQL, 'remove the payment-state barrier', [repl("DROP TRIGGER IF EXISTS trg_guard_payment_authoritative_order_changes ON public.orders;\nCREATE TRIGGER trg_guard_payment_authoritative_order_changes\n  BEFORE UPDATE OF status, deposit_due_cents, deposit_paid_cents, balance_due_cents, balance_paid_cents, tip_cents,\n                   customer_selected_payment_type, customer_selected_payment_cents\n  ON public.orders\n  FOR EACH ROW\n  EXECUTE FUNCTION public.guard_payment_authoritative_order_changes();\n", '')]],
  [SQL, 'the barrier does not exempt the finalize of its own operation', [repl("        AND p.id::text IS DISTINCT FROM current_setting('bpc.finalizing_payment_id', true)\n", '')]],
  [SQL, 'the barrier is open to any finalize announcement', [repl("        AND p.id::text IS DISTINCT FROM current_setting('bpc.finalizing_payment_id', true)\n", "        AND current_setting('bpc.finalizing_payment_id', true) IS NULL\n")]],
  [SQL, 'the barrier ignores the lease age', [repl("        AND p.claimed_at > now() - interval '300 seconds'\n", '')]],
  [SQL, 'the barrier does not watch the deposit due', [repl('  IF NEW.status IS DISTINCT FROM OLD.status\n     OR NEW.deposit_due_cents IS DISTINCT FROM OLD.deposit_due_cents\n', '  IF NEW.status IS DISTINCT FROM OLD.status\n')]],
  [SQL, 'the barrier does not watch the balance due', [repl('     OR NEW.balance_due_cents IS DISTINCT FROM OLD.balance_due_cents\n', '')]],
  [SQL, 'the barrier does not watch the status', [repl('  IF NEW.status IS DISTINCT FROM OLD.status\n     OR NEW.deposit_due_cents', '  IF false\n     OR NEW.deposit_due_cents')]],
  [SQL, 'the barrier does not watch the persisted selection', [repl("     OR NEW.customer_selected_payment_type IS DISTINCT FROM OLD.customer_selected_payment_type\n     OR NEW.customer_selected_payment_cents IS DISTINCT FROM OLD.customer_selected_payment_cents THEN", '     THEN')]],
  [SQL, 'the barrier does not watch the order tip (comparison removed)', [repl('     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n', '')]],
  [SQL, 'the barrier trigger no longer fires for the payment-authoritative columns', [repl('  BEFORE UPDATE OF status, deposit_due_cents, deposit_paid_cents, balance_due_cents, balance_paid_cents, tip_cents,\n                   customer_selected_payment_type, customer_selected_payment_cents\n', '  BEFORE UPDATE OF admin_message\n')]],
  [SQL, 'finalize does not announce itself to the barrier', [repl("  PERFORM set_config('bpc.finalizing_payment_id', v_op.id::text, true);\n", '')]],
  // ---------------------------------------------------------------- provider ambiguity
  [PO, 'a search exception is treated as NOT_FOUND', [repl('    return { kind: "unknown", reason: "lookup_failed" };', '    return { kind: "not_found" };')]],
  [PO, 'a malformed search answer is treated as NOT_FOUND', [repl('if (!res || !Array.isArray(res.data)) return { kind: "unknown", reason: "malformed_response" };', 'if (!res || !Array.isArray(res.data)) return { kind: "not_found" };')]],
  [PO, 'a failure to record the found PaymentIntent is treated as NOT_FOUND', [repl('return saved ? look : { kind: "unknown", reason: "could_not_save_provider_id" };', 'return saved ? look : { kind: "not_found" };')]],
  [PO, 'a search miss closes the attempted operation', [repl('    if (lookup.kind === "found") return { ok: true, op };\n    await releaseOperation(db, op, null);', '    if (lookup.kind === "found") return { ok: true, op };\n    if (lookup.kind === "not_found") {\n      await releaseOperation(db, op, "cancelled");\n      return { ok: false, outcome: refusal, detail: { stale: true, reason } };\n    }\n    await releaseOperation(db, op, null);')]],
  [PO, 'any lookup that is not FOUND closes the attempted operation', [repl('    if (lookup.kind === "found") return { ok: true, op };\n    await releaseOperation(db, op, null);\n    return { ok: false, outcome: "payment_status_unknown"', '    if (lookup.kind === "found") return { ok: true, op };\n    await releaseOperation(db, op, "cancelled");\n    return { ok: false, outcome: refusal, detail: { stale: true, reason } };\n    return { ok: false, outcome: "payment_status_unknown"')]],
  [PO, 'the attempted state is ignored: every stale operation is cancelled', [repl('    if (!op.providerAttemptedAt) {\n      await releaseOperation(db, op, "cancelled");', '    if (true) {\n      await releaseOperation(db, op, "cancelled");')]],
  [PO, 'the operation age (created_at) is used as the attempt age', [repl('} else if (op.providerAttemptedAt && ageSeconds(op.providerAttemptedAt) > IDEMPOTENCY_REPLAY_SECONDS) {', '} else if (ageSeconds(op.createdAt) > IDEMPOTENCY_REPLAY_SECONDS) {')]],
  [PO, 'the attempt is not marked before the provider create', [repl('if (!op.providerAttemptedAt && !(await markProviderAttempt(db, op))) {', 'if (false) {')]],
  [PO, 'a failed attempt marker does not stop the provider create', [repl('      if (!op.providerAttemptedAt && !(await markProviderAttempt(db, op))) {\n        await releaseOperation(db, op, null);\n        return { kind: "unconfirmed", code: "PAYMENT_STATUS_UNKNOWN", paymentIntentId: null };\n      }\n', '      if (!op.providerAttemptedAt) await markProviderAttempt(db, op);\n')]],
  [PO, 'the aged-attempt branch creates blindly when the lookup misses', [repl('      if (look.kind !== "found") {\n        await releaseOperation(db, op, null);\n        return { kind: "unconfirmed", code: "PAYMENT_STATUS_UNKNOWN", paymentIntentId: null };\n      }\n      pi = await stripe.paymentIntents.retrieve(op.providerPaymentIntentId as string);', '      if (look.kind !== "found") {\n        await releaseOperation(db, op, "failed");\n        return { kind: "invalid", message: "expired" };\n      }\n      pi = await stripe.paymentIntents.retrieve(op.providerPaymentIntentId as string);')]],
  [CB, 'Checkout is offered over an attempted card operation', [repl('if (op.providerPaymentIntentId || op.providerAttemptedAt) {', 'if (op.providerPaymentIntentId) {')]],
  [SQL, 'the attempt marker ignores who owns the claim', [repl("    AND status = 'pending'\n    AND claim_id = p_claim_id\n    AND COALESCE(order_financials_applied, false) = false;\n\n  GET DIAGNOSTICS v_rows = ROW_COUNT;\n  RETURN v_rows = 1;\nEND;\n$$;\n\n-- ---------------------------------------------------------------------------------------------------------------------\n-- release_payment_operation", "    AND status = 'pending'\n    AND COALESCE(order_financials_applied, false) = false;\n\n  GET DIAGNOSTICS v_rows = ROW_COUNT;\n  RETURN v_rows = 1;\nEND;\n$$;\n\n-- ---------------------------------------------------------------------------------------------------------------------\n-- release_payment_operation")]],
  [SQL, 'the attempt marker overwrites the first attempt time', [repl('SET provider_attempted_at = COALESCE(provider_attempted_at, now())', 'SET provider_attempted_at = now()')]],
  [SQL, 'the attempt marker can mark a closed operation', [repl("  SET provider_attempted_at = COALESCE(provider_attempted_at, now())\n  WHERE id = p_payment_id\n    AND operation_key IS NOT NULL\n    AND status = 'pending'\n", "  SET provider_attempted_at = COALESCE(provider_attempted_at, now())\n  WHERE id = p_payment_id\n    AND operation_key IS NOT NULL\n")]],
  [SQL, 'the attempt marker is executable by authenticated', [repl('GRANT EXECUTE ON FUNCTION public.mark_payment_operation_provider_attempt(uuid, uuid) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.mark_payment_operation_provider_attempt(uuid, uuid) TO service_role, authenticated;')]],
  [SQL, 'the claim does not report when the operation was attempted', [repl("      'provider_attempted_at', v_op.provider_attempted_at,\n", '')]],
  // ---------------------------------------------------------------- the order tip under the barrier
  [SQL, 'the barrier trigger does not fire for tip changes', [repl('balance_paid_cents, tip_cents,\n                   customer_selected_payment_type, customer_selected_payment_cents\n  ON public.orders', 'balance_paid_cents,\n                   customer_selected_payment_type, customer_selected_payment_cents\n  ON public.orders')]],
  [SQL, 'a tip increase is allowed during a live lease', [repl('     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n', '     OR NEW.tip_cents < OLD.tip_cents\n')]],
  [SQL, 'a tip decrease is allowed during a live lease', [repl('     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n', '     OR NEW.tip_cents > OLD.tip_cents\n')]],
  [SQL, 'the finalize of the operation cannot change its tip', [repl("        AND p.id::text IS DISTINCT FROM current_setting('bpc.finalizing_payment_id', true)\n    ) THEN", "        AND (p.id::text IS DISTINCT FROM current_setting('bpc.finalizing_payment_id', true) OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents)\n    ) THEN")]],
  [SQL, 'the barrier blocks unrelated admin_message changes', [repl('     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n', '     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n     OR NEW.admin_message IS DISTINCT FROM OLD.admin_message\n'), repl('balance_paid_cents, tip_cents,\n                   customer_selected_payment_type', 'balance_paid_cents, tip_cents, admin_message,\n                   customer_selected_payment_type')]],
  [SQL, 'the barrier blocks saved-card metadata changes', [repl('     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n', '     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n     OR NEW.stripe_payment_method_id IS DISTINCT FROM OLD.stripe_payment_method_id\n'), repl('balance_paid_cents, tip_cents,\n                   customer_selected_payment_type', 'balance_paid_cents, tip_cents, stripe_payment_method_id,\n                   customer_selected_payment_type')]],
  // ================================================================ Step 3C-A: refund idempotency, reservation, recovery, webhook, write authority
  [RO, 'a Stripe refund request carries no idempotency key', [repl("      { idempotencyKey: row.provider_idempotency_key },\n", '')]],
  [RO, 'a retry builds a new idempotency key each time (a retry creates a second provider refund)', [repl('{ idempotencyKey: row.provider_idempotency_key }', "{ idempotencyKey: row.provider_idempotency_key + ':' + Math.random() }")]],
  [RO, 'an unknown Stripe outcome is treated as a definitive failure (the reservation is released while the refund may exist)', [repl("return t === \"StripeInvalidRequestError\" || t === \"StripeAuthenticationError\" || t === \"StripePermissionError\";", 'return true;')]],
  [RO, 'a Stripe rejection is never recognised (a rejected refund stays reserved forever)', [repl("return t === \"StripeInvalidRequestError\" || t === \"StripeAuthenticationError\" || t === \"StripePermissionError\";", 'return false;')]],
  [RO, 'a refund does not name its row in the Stripe metadata (a lost result cannot be found again)', [repl('bpc_refund_id: row.id, ', '')]],
  [RO, 'a succeeded or failed row is sent to Stripe again', [repl('  if (row.status !== "pending") return { row, halt: false };', '')]],
  [RO, 'a Stripe refund that could not be recorded locally is dropped instead of kept pending', [repl("  return { row: { ...row, stripe_refund_id: refund?.id ?? null, unresolved: true }, halt: false };", "  return { row: { ...row, status: 'failed' }, halt: false };")]],
  [RO, 'the amount of the refund comes from the browser total instead of the reservation', [repl('amount: row.amount_cents,', 'amount: row.amount_cents + 1,')]],
  [MIG4, 'the refund reservation is not taken under the order lock', [repl("  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('outcome', 'order_not_found');", "  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;\n  IF NOT FOUND THEN\n    RETURN jsonb_build_object('outcome', 'order_not_found');")]],
  [MIG4, 'a refund may exceed what is refundable', [repl("IF p_amount_cents > v_max THEN\n    RETURN jsonb_build_object('outcome', 'exceeds_refundable'", "IF false THEN\n    RETURN jsonb_build_object('outcome', 'exceeds_refundable'")]],
  [MIG4, 'the per-payment allocation ignores earlier refunds of that payment', [repl('v_avail := GREATEST(0, v_pay.amount_cents - v_linked);', 'v_avail := v_pay.amount_cents;')]],
  [MIG4, 'failed refunds keep consuming the refundable amount', [repl("FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');", 'FROM public.order_refunds WHERE order_id = p_order_id;')]],
  [MIG4, 'failed refunds keep consuming a payment\'s refundable amount', [repl("FROM public.order_refunds WHERE payment_id = v_pay.id AND status IN ('pending', 'succeeded');", 'FROM public.order_refunds WHERE payment_id = v_pay.id;')]],
  [MIG4, 'pending refunds do not reserve their amount', [repl("FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');", "FROM public.order_refunds WHERE order_id = p_order_id AND status = 'succeeded';")]],
  [MIG4, 'the same operation key reserves again (a duplicate submission creates a second refund)', [repl("  IF FOUND THEN\n    IF v_existing.order_id IS DISTINCT FROM p_order_id", "  IF false THEN\n    IF v_existing.order_id IS DISTINCT FROM p_order_id")]],
  [MIG4, 'an operation key reused for a different amount is accepted', [repl('OR v_existing.request_amount_cents IS DISTINCT FROM p_amount_cents THEN', 'THEN')]],
  [MIG4, 'legacy refund rows no longer reserve (only rows of the new ledger do)', [repl("FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded');", "FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded') AND ledger_version = 2;")]],
  [MIG4, 'a pending provider status is treated as succeeded', [repl("    ELSE 'pending'\n  END\n$$;", "    ELSE 'succeeded'\n  END\n$$;")]],
  [MIG4, 'a failed provider status is treated as pending', [repl("    WHEN 'failed' THEN 'failed'\n", '')]],
  [MIG4, 'a repeated success event applies the refund again', [repl("  IF r.status = p_new_status THEN\n    RETURN jsonb_build_object('outcome', 'unchanged'", "  IF false THEN\n    RETURN jsonb_build_object('outcome', 'unchanged'"), repl('IF r.ledger_version = 2 AND r.total_applied IS NOT TRUE AND r.order_id IS NOT NULL THEN', 'IF r.ledger_version = 2 AND r.order_id IS NOT NULL THEN')]],
  [MIG4, 'a failed refund can be revived by a later success event', [repl("  IF r.status = 'failed' THEN\n    -- A refund that failed does not come back", "  IF false THEN\n    -- A refund that failed does not come back")]],
  [MIG4, 'a succeeded refund that later fails is not reversed in the order total', [repl('UPDATE public.orders SET total_refunded_cents = GREATEST(0, COALESCE(total_refunded_cents, 0) - r.amount_cents) WHERE id = r.order_id;', '')]],
  [MIG4, 'a succeeded refund does not increase the order total', [repl('UPDATE public.orders SET total_refunded_cents = COALESCE(total_refunded_cents, 0) + r.amount_cents WHERE id = r.order_id;', '')]],
  [MIG4, 'a succeeded refund is not written to the payments ledger', [repl("      IF r.payment_id IS NOT NULL AND r.stripe_refund_id IS NOT NULL THEN\n        SELECT * INTO orig", "      IF false THEN\n        SELECT * INTO orig")]],
  [MIG4, 'a legacy refund row changes the order total when its status settles', [repl('IF r.ledger_version = 2 AND r.total_applied IS NOT TRUE AND r.order_id IS NOT NULL THEN', 'IF r.total_applied IS NOT TRUE AND r.order_id IS NOT NULL THEN')]],
  [MIG4, 'the provider event does not find our row through the refund metadata', [repl("IF p_bpc_refund_id IS NOT NULL AND p_bpc_refund_id ~ '^[0-9a-fA-F-]{36}$' THEN", 'IF false THEN')]],
  [MIG4, 'an event whose amount disagrees with the row is applied anyway', [repl('    IF r.amount_cents <> p_amount_cents THEN', '    IF false THEN')]],
  [MIG4, 'a negative refund row can be chosen as the original payment', [repl("    AND status = 'succeeded' AND amount_cents > 0 AND refunded_payment_id IS NULL\n  ORDER BY created_at LIMIT 1;", "    AND status = 'succeeded'\n  ORDER BY created_at DESC LIMIT 1;")]],
  [MIG4, 'a refund made outside the application is not recorded', [repl("  IF NOT FOUND THEN\n    RETURN jsonb_build_object('outcome', 'no_original_payment');\n  END IF;", "  IF true THEN\n    RETURN jsonb_build_object('outcome', 'no_original_payment');\n  END IF;")]],
  [MIG4, 'a webhook delivered twice records an outside refund twice', [repl("  SELECT * INTO r FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id LIMIT 1;\n  IF r.id IS NOT NULL THEN\n    RETURN public._apply_refund_transition(r.id, v_new, p_failure_reason);\n  END IF;\n", ''), repl("  EXCEPTION WHEN unique_violation THEN\n    SELECT id INTO v_id FROM public.order_refunds WHERE stripe_refund_id = p_stripe_refund_id LIMIT 1;", "  EXCEPTION WHEN unique_violation THEN\n    v_id := gen_random_uuid();")]],
  [MIG4, 'cancelling an order leaves payment attempts that never reached the provider open', [repl("  AFTER UPDATE OF status ON public.orders\n  FOR EACH ROW\n  EXECUTE FUNCTION public.cancel_unattempted_payments_on_order_close();", "  AFTER UPDATE OF admin_message ON public.orders\n  FOR EACH ROW\n  EXECUTE FUNCTION public.cancel_unattempted_payments_on_order_close();")]],
  [MIG4, 'cancelling an order also cancels a payment whose provider request may have started', [repl("      AND provider_attempted_at IS NULL;", ';')]],
  [MIG4, 'cancelling an order also cancels a payment that already has a PaymentIntent', [repl("      AND stripe_payment_intent_id IS NULL\n      AND stripe_checkout_session_id IS NULL", "      AND stripe_checkout_session_id IS NULL")]],
  [MIG4, 'a payment applied to a closed order leaves no note', [repl("  IF v_status IN ('cancelled', 'void') THEN\n    INSERT INTO public.order_changelog", "  IF false THEN\n    INSERT INTO public.order_changelog")]],
  [MIG4, 'an Admin session can INSERT a payment row', [repl("DROP POLICY IF EXISTS \"Admins can insert payments\" ON public.payments;\n", ''), repl('REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated, anon;', 'REVOKE UPDATE, DELETE ON public.payments FROM authenticated, anon;')]],
  [MIG4, 'an Admin session can UPDATE a payment row', [repl("DROP POLICY IF EXISTS \"Admins can update payments\" ON public.payments;\n", ''), repl('REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated, anon;', 'REVOKE INSERT, DELETE ON public.payments FROM authenticated, anon;')]],
  [MIG4, 'an Admin session can INSERT a refund row', [repl("DROP POLICY IF EXISTS \"Admins can manage refunds\" ON public.order_refunds;\n", ''), repl('REVOKE INSERT, UPDATE, DELETE ON public.order_refunds FROM authenticated;', 'REVOKE UPDATE, DELETE ON public.order_refunds FROM authenticated;')]],
  [MIG4, 'an Admin session can UPDATE or DELETE a refund row', [repl("DROP POLICY IF EXISTS \"Admins can manage refunds\" ON public.order_refunds;\n", ''), repl('REVOKE INSERT, UPDATE, DELETE ON public.order_refunds FROM authenticated;', 'REVOKE INSERT ON public.order_refunds FROM authenticated;')]],
  [MIG4, 'an anonymous session keeps access to the refund table', [repl('REVOKE ALL ON public.order_refunds FROM anon;', '')]],
  [MIG4, 'the order guard allows a direct change of the payment status', [repl("     OR NEW.stripe_payment_status IS DISTINCT FROM OLD.stripe_payment_status\n", '')]],
  [MIG4, 'the order guard allows a direct change of the payment lock', [repl("     OR NEW.payment_lock IS DISTINCT FROM OLD.payment_lock THEN", '     OR false THEN')]],
  [MIG4, 'the refund reservation function is executable by authenticated', [repl('GRANT EXECUTE ON FUNCTION public.reserve_refund_operation(uuid, text, integer, text, uuid) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.reserve_refund_operation(uuid, text, integer, text, uuid) TO authenticated, service_role;')]],
  [MIG4, 'the provider-event function is executable by authenticated', [repl('GRANT EXECUTE ON FUNCTION public.apply_provider_refund_event(text, text, integer, text, text, text, text) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.apply_provider_refund_event(text, text, integer, text, text, text, text) TO authenticated, service_role;')]],
  [MIG4, 'the internal refund transition is executable by authenticated', [repl('REVOKE ALL ON FUNCTION public._apply_refund_transition(uuid, text, text) FROM PUBLIC, anon, authenticated;', '')]],
  [SR, 'a Crew member can request a refund', [repl('requireRoles(caller, STAFF_ADMIN_ROLES,', 'requireRoles(caller, [...STAFF_ADMIN_ROLES, "crew"],')]],
  [SR, 'the refund function drops the operation key', [repl('operationKey: body.operationKey, ', '')]],
  [WH, 'the webhook records a refund from the cumulative amount of the charge', [repl("  for (const refund of refunds.data) {\n    await recordProviderRefund(refund, supabaseClient);", "  for (const refund of refunds.data) {\n    await recordProviderRefund({ ...refund, amount: (charge as any).amount_refunded ?? 0 }, supabaseClient);")]],
  [WH, 'the webhook records only the first refund of a charge', [repl("  for (const refund of refunds.data) {\n    await recordProviderRefund(refund, supabaseClient);\n  }", "  for (const refund of refunds.data.slice(0, 1)) {\n    await recordProviderRefund(refund, supabaseClient);\n  }")]],
  [RO, 'the webhook records a refund against the wrong payment intent', [repl("    p_payment_intent_id: pi,", "    p_payment_intent_id: null,")]],
  [WHI, 'the webhook does not route refund.created', [repl("    case \"refund.created\":\n", '')]],
  [WHI, 'the webhook does not route refund.updated', [repl("    case \"refund.updated\":\n", '')]],
  [WHI, 'the webhook does not route refund.failed', [repl("    case \"refund.failed\":\n", '')]],
  [WHI, 'the webhook does not route charge.refund.updated', [repl("    case \"charge.refund.updated\":\n", '')]],
  [WHI, 'charge.refunded is routed without the Stripe client (it cannot list the refunds)', [repl("await handleChargeRefunded(event.data.object as Stripe.Charge, supabaseClient, stripe);", "await handleChargeRefunded(event.data.object as Stripe.Charge, supabaseClient, undefined as unknown as Stripe);")]],
  [OL, 'the waived-deposit marker is written for an untrusted caller', [repl('trustedCaller && requestedOutcome === "waived"', 'requestedOutcome === "waived"')]],
  [OAS, 'order rejection cancels payments from the browser again', [repl("    // Payment attempts that never reached the provider are cancelled by the database when the order is cancelled; an attempt that", "    await supabase.from('payments').update({ status: 'cancelled' }).eq('order_id', order.id);\n    // Payment attempts that never reached the provider are cancelled by the database when the order is cancelled; an attempt that")]],
  [OAS, 'the zero-deposit approval writes the payment status from the browser again', [repl("        // order-lifecycle's enterConfirmed below; a browser session cannot write payment-state columns.\n        .update({ status: ORDER_STATUS.CONFIRMED })", "        // order-lifecycle's enterConfirmed below; a browser session cannot write payment-state columns.\n        .update({ status: ORDER_STATUS.CONFIRMED, stripe_payment_status: 'paid' })")]],
  // ================================================================ Step 3C-A final correction: marker, exhaustive lookup, retry identity, other sessions, history
  [RO, 'a refund is sent without the provider-attempt marker', [repl('  if (!(marked || (markerFailed && alreadyMarked))) return', '  if (false) return')]],
  [RO, 'a failed marker write is read as written', [repl("    if (res?.error) markerFailed = true;\n    else marked = res?.data === true;", '    marked = true;')]],
  [RO, 'a false marker result is accepted', [repl('marked = res?.data === true;', 'marked = res?.data !== undefined;')]],
  [RO, 'a marker call that throws lets the refund go out', [repl("  } catch {\n    markerFailed = true;\n  }", "  } catch {\n    marked = true;\n  }")]],
  [RO, 'a failed marker is forgiven even when no earlier marker exists', [repl('(markerFailed && alreadyMarked)', 'markerFailed')]],
  [MIG4, 'the marker is written for a refund that already has a provider id', [repl("WHERE id = p_refund_id AND status = 'pending' AND stripe_refund_id IS NULL;", 'WHERE id = p_refund_id;')]],
  [RO, 'an aged request is re-sent after an inconclusive lookup', [repl('if (!look.complete && age > IDEMPOTENCY_SAFE_MS) return', 'if (false) return')]],
  [RO, 'a full first page without a match is read as complete absence', [repl('if (list.has_more !== true || data.length === 0) return { found: null, complete: false };', 'return { found: null, complete: true };')]],
  [RO, 'a listing without has_more is read as complete', [repl('if (list.has_more !== true || data.length === 0) return { found: null, complete: false };', 'if (list.has_more !== true) return { found: null, complete: true };')]],
  [RO, 'a failed listing page is read as complete absence', [repl("    } catch {\n      return { found: null, complete: false };\n    }\n    const data", "    } catch {\n      return { found: null, complete: true };\n    }\n    const data")]],
  [RO, 'too many pages are read as complete absence', [repl("  return { found: null, complete: false };\n}\n\nasync function record", "  return { found: null, complete: true };\n}\n\nasync function record")]],
  [RO, 'the lookup matches any refund that carries a row id', [repl('r?.metadata?.bpc_refund_id === rowId', 'r?.metadata?.bpc_refund_id !== undefined')]],
  [RO, 'the lookup never follows to the next page', [repl('    startingAfter = data[data.length - 1]?.id;', '    startingAfter = undefined;')]],
  [RO, 'an unfinished operation with a rejected portion is reported as final', [repl('if (!final && (unresolvedCents > 0 || failedCents > 0)) {', 'if (false) {')]],
  [RO, 'a pending portion is treated as finished', [repl('const final = pendingCents === 0 && unresolvedCents === 0;', 'const final = unresolvedCents === 0;')]],
  [RO, 'a final partial failure is reported as success', [repl('if (failedCents > 0) return json(207', 'if (failedCents > 1e12) return json(207')]],
  [RO, 'an unfinished operation reports success although a portion was rejected', [repl('success: failedCents === 0, code: "REFUND_UNRESOLVED"', 'success: true, code: "REFUND_UNRESOLVED"')]],
  [KEYFILE, 'the browser forgets the key after a final partial failure', [repl("kind: 'partial', tone: 'error', keepKey: true,", "kind: 'partial', tone: 'error', keepKey: false,")]],
  [KEYFILE, 'the browser forgets the key while a portion is unresolved', [repl("return { kind: 'unresolved', tone: 'warning', keepKey: true, message: `This refund is not finished.", "return { kind: 'unresolved', tone: 'warning', keepKey: false, message: `This refund is not finished.")]],
  [KEYFILE, 'the browser does not take over an unsettled request', [repl('      adopt: { key: data.resumeOperationKey, amountCents: data.resumeAmountCents },\n', '')]],
  [KEYFILE, 'a rejected refund keeps its key (a fresh press could never be a fresh request)', [repl("return { kind: 'failed', tone: 'error', keepKey: false,", "return { kind: 'failed', tone: 'error', keepKey: true,")]],
  [MIG4, 'an unsettled request does not block another one', [repl("  IF FOUND THEN\n    RETURN jsonb_build_object('outcome', 'unsettled_operation'", "  IF false THEN\n    RETURN jsonb_build_object('outcome', 'unsettled_operation'")]],
  [MIG4, 'a request is released by age even though a provider request may have started', [repl("WHERE x.operation_key = o.operation_key AND (x.stripe_refund_id IS NOT NULL OR x.provider_attempted_at IS NOT NULL OR x.status = 'succeeded')", "WHERE x.operation_key = o.operation_key AND (x.stripe_refund_id IS NOT NULL OR x.status = 'succeeded')")]],
  [MIG4, 'a partly sent operation is released portion by portion', [repl("    AND NOT EXISTS (\n      SELECT 1 FROM public.order_refunds x\n      WHERE x.operation_key = o.operation_key AND (x.stripe_refund_id IS NOT NULL OR x.provider_attempted_at IS NOT NULL OR x.status = 'succeeded')\n    );", ';')]],
  [MIG4, 'an unsent request is never released', [repl("    AND o.created_at < now() - interval '15 minutes'", "    AND o.created_at < now() - interval '15 years'")]],
  [MIG4, 'a request that never reached Stripe is released at once', [repl("    AND o.created_at < now() - interval '15 minutes'", "    AND o.created_at < now() + interval '1 hour'")]],
  [RO, 'the answer does not name the unsettled request', [repl('resumeOperationKey: r.operation_key, resumeAmountCents: r.request_amount_cents', 'resumeOperationKey: null, resumeAmountCents: null')]],
  [MIG4, 'an ambiguous history is allocated by inference', [repl('IF v_pay_count > 1 AND EXISTS (', 'IF false AND EXISTS (')]],
  [MIG4, 'a single-payment history is refused as ambiguous', [repl('IF v_pay_count > 1 AND EXISTS (', 'IF v_pay_count > 0 AND EXISTS (')]],
  [OL, 'the waived marker is written although a deposit is owed', [repl('source === "admin_approve_zero_deposit" && depositDue === 0', 'source === "admin_approve_zero_deposit"')]],
  [OL, 'any trusted source writes the waived marker', [repl('requestedOutcome === "waived" && source === "admin_approve_zero_deposit" && depositDue === 0', 'requestedOutcome === "waived" && depositDue === 0')]],
  // ================================================================ refund accounting database foundation (allocation columns + order_net_financials)
  [MIG5, "the allocation rule lets components through without a version", [repl("COALESCE(allocation_version, 0) = 1", "allocation_version = 1")]],
  [MIG5, "a negative deposit component is allowed", [repl("        AND deposit_principal_refunded_cents >= 0\n", "")]],
  [MIG5, "a negative balance component is allowed", [repl("        AND balance_principal_refunded_cents >= 0\n", "")]],
  [MIG5, "a negative tip component is allowed", [repl("        AND tip_refunded_cents >= 0\n", "")]],
  [MIG5, "a negative unclassified component is allowed", [repl("        AND unclassified_refunded_cents >= 0\n", "")]],
  [MIG5, "components may fall short of the refund amount", [repl("+ tip_refunded_cents::bigint + unclassified_refunded_cents::bigint = amount_cents::bigint", "+ tip_refunded_cents::bigint + unclassified_refunded_cents::bigint <= amount_cents::bigint")]],
  [MIG5, "components may exceed the refund amount", [repl("+ tip_refunded_cents::bigint + unclassified_refunded_cents::bigint = amount_cents::bigint", "+ tip_refunded_cents::bigint + unclassified_refunded_cents::bigint >= amount_cents::bigint")]],
  [MIG5, "a blank allocation signature is allowed", [repl("        AND btrim(request_allocation) <> ''\n", "")]],
  [MIG5, "a missing component is allowed", [repl("        AND balance_principal_refunded_cents IS NOT NULL\n", "")]],
  [MIG5, "an existing amount-only refund row becomes invalid", [repl("allocation_version IS NULL\n        AND deposit_principal_refunded_cents IS NULL", "allocation_version IS NOT NULL\n        AND deposit_principal_refunded_cents IS NULL")]],
  [MIG5, "the allocation constraint is left unvalidated", [repl("ALTER TABLE public.order_refunds VALIDATE CONSTRAINT order_refunds_allocation_shape;\n", "")]],
  [MIG5, "pending payments count as collected", [repl("      AND p.status = 'succeeded' AND p.amount_cents > 0\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL", "      AND p.status IN ('succeeded', 'pending') AND p.amount_cents > 0\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL")]],
  [MIG5, "a historic refunded-status payment counts as collected", [repl("      AND p.status = 'succeeded' AND p.amount_cents > 0\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL", "      AND p.status IN ('succeeded', 'refunded') AND p.amount_cents > 0\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL")]],
  [MIG5, "negative refund copies count as payments", [repl("      AND p.status = 'succeeded' AND p.amount_cents > 0\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL", "      AND p.status = 'succeeded' AND p.amount_cents <> 0\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL")]],
  [MIG5, "cash and check payments are left out", [repl("      AND p.status = 'succeeded' AND p.amount_cents > 0\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL", "      AND p.status = 'succeeded' AND p.amount_cents > 0 AND p.stripe_payment_intent_id IS NOT NULL\n      AND p.refunded_payment_id IS NULL AND p.stripe_refund_id IS NULL")]],
  [MIG5, "a refund is subtracted twice (the order_refunds row and its negative payment copy)", [repl("'recorded_net_cash_retained_cents', gross_recorded - total_succeeded,", "'recorded_net_cash_retained_cents', gross_recorded - total_succeeded - refund_copy_cents,")]],
  [MIG5, "pending refunds reduce the net figures", [repl("COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0)::bigint AS total_succeeded", "COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('succeeded', 'pending')), 0)::bigint AS total_succeeded")]],
  [MIG5, "failed refunds reduce the net figures", [repl("COALESCE(SUM(amount_cents) FILTER (WHERE status = 'succeeded'), 0)::bigint AS total_succeeded", "COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'pending'), 0)::bigint AS total_succeeded")]],
  [MIG5, "an unclassified refund is not reported as unclassified", [repl("ELSE amount_cents END) FILTER (WHERE status = 'succeeded'), 0)::bigint AS unclassified_succeeded", "ELSE 0 END) FILTER (WHERE status = 'succeeded'), 0)::bigint AS unclassified_succeeded")]],
  [MIG5, "exact net principal is returned even when classification is incomplete", [repl("'net_principal_exact_cents', CASE WHEN complete THEN known_net_deposit + known_net_balance END,", "'net_principal_exact_cents', known_net_deposit + known_net_balance,")]],
  [MIG5, "exact net tips are returned even when classification is incomplete", [repl("'net_tips_exact_cents', CASE WHEN complete THEN known_net_tips END,", "'net_tips_exact_cents', known_net_tips,")]],
  [MIG5, "completeness ignores unclassified payments", [repl("(unclassified_gross = 0 AND unclassified_succeeded", "(unclassified_succeeded")]],
  [MIG5, "completeness ignores unclassified refunds", [repl("AND unclassified_succeeded = 0 AND historic_unsettled = 0", "AND historic_unsettled = 0")]],
  [MIG5, "completeness ignores historic unsettled refunds", [repl("AND historic_unsettled = 0 AND legacy_refunded_status_payments = 0", "AND legacy_refunded_status_payments = 0")]],
  [MIG5, "completeness ignores historic refunded-status payments", [repl("AND legacy_refunded_status_payments = 0\n        AND duplicate_refund_ids = 0", "\n        AND duplicate_refund_ids = 0")]],
  [MIG5, "completeness ignores a provider refund recorded twice", [repl("\n        AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0\n        AND NOT (", "\n        AND unbacked_refund_copy_cents = 0\n        AND NOT (")]],
  [MIG5, "completeness ignores an inconsistent ledger", [repl("AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0\n        AND NOT (known_net_deposit < 0 OR known_net_balance < 0 OR known_net_tips < 0 OR gross_recorded - total_succeeded < 0)) AS complete", "AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0) AS complete")]],
  [MIG5, "the net deposit principal adds the refund instead of subtracting it", [repl("(pagg.known_gross_deposit - ragg.deposit_refunded) AS known_net_deposit", "(pagg.known_gross_deposit + ragg.deposit_refunded) AS known_net_deposit")]],
  [MIG5, "the net tips add the refund instead of subtracting it", [repl("(pagg.known_gross_tips - ragg.tips_refunded) AS known_net_tips", "(pagg.known_gross_tips + ragg.tips_refunded) AS known_net_tips")]],
  [MIG5, "offline payments are not flagged as recorded-only", [repl("COALESCE(BOOL_OR(stripe_payment_intent_id IS NULL), false) AS offline_payments_present", "false AS offline_payments_present")]],
  [MIG5, "offline refunds are claimed to be tracked", [repl("'offline_refunds_tracked', false,", "'offline_refunds_tracked', true,")]],
  [MIG5, "the cached principal comparison is inverted", [repl("COALESCE(cached_deposit_paid_cents, 0) + COALESCE(cached_balance_paid_cents, 0) = known_gross_principal", "COALESCE(cached_deposit_paid_cents, 0) + COALESCE(cached_balance_paid_cents, 0) <> known_gross_principal")]],
  [MIG5, "anyone may read the net figures", [repl("AND (current_user = 'service_role' OR public.is_admin())", "AND (true OR current_user = 'service_role' OR public.is_admin())")]],
  [MIG5, "an Admin may not read the net figures", [repl("AND (current_user = 'service_role' OR public.is_admin())", "AND (current_user = 'service_role')")]],
  [MIG5, "the service role may not read the net figures", [repl("AND (current_user = 'service_role' OR public.is_admin())", "AND (public.is_admin())")]],
  [MIG5, "the net function runs with the owner rights", [repl("STABLE\nSECURITY INVOKER", "STABLE\nSECURITY DEFINER")]],
  [MIG5, "anonymous may execute the net function", [repl("GRANT EXECUTE ON FUNCTION public.order_net_financials(uuid) TO authenticated, service_role;", "GRANT EXECUTE ON FUNCTION public.order_net_financials(uuid) TO anon, authenticated, service_role;")]],
  [MIG5, "completeness ignores a negative payment row no refund backs", [repl("AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0\n", "AND duplicate_refund_ids = 0\n")]],
  [MIG5, "a negative copy is backed whatever its amount", [repl("OR x.refund_amount <> -x.amount_cents OR x.rn > 1), 0)::bigint AS unbacked_refund_copy_cents", "OR x.rn > 1), 0)::bigint AS unbacked_refund_copy_cents")]],
  [MIG5, "an unlinked negative payment row is treated as backed", [repl("FILTER (WHERE x.refund_amount IS NULL OR", "FILTER (WHERE false AND x.refund_amount IS NULL OR")]],
  [MIG5, "a missing negative copy makes the order inexact", [repl("AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0\n", "AND duplicate_refund_ids = 0 AND unbacked_refund_copy_cents = 0 AND missing_refund_copy_cents = 0\n")]],
  [MIG5, "a second copy of the same provider refund is also treated as backed", [repl(" OR x.rn > 1), 0)::bigint AS unbacked_refund_copy_cents", "), 0)::bigint AS unbacked_refund_copy_cents")]],
  [MIG5, "the copy to back is chosen by age, not by matching amount", [repl("ORDER BY (m.amount_cents = -c.amount_cents) DESC NULLS LAST, c.created_at, c.id", "ORDER BY c.created_at, c.id")]],
  [MIG5, "a refund counts as having a copy whatever the copy's amount", [repl("AND c.status = 'succeeded'\n          AND c.amount_cents = -r.amount_cents", "AND c.status = 'succeeded'")]],
  [MIG5, "duplicate copies are not counted", [repl("COUNT(*) FILTER (WHERE x.stripe_refund_id IS NOT NULL AND x.rn > 1)::bigint AS duplicate_refund_copies", "0::bigint AS duplicate_refund_copies")]],
  [MIG5, "copies are matched to a refund of a different provider id", [repl("AND r.stripe_refund_id = c.stripe_refund_id\n        ORDER BY", "AND r.stripe_refund_id IS NOT NULL\n        ORDER BY")]],
  // ================================================================ allocation-aware refund reservation
  [MIG6, "the allocation reservation does not lock the order", [repl("SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;", "SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;")]],
  [MIG6, "capacity ignores pending refunds", [repl("WHERE payment_id = v_p.id AND status IN ('pending', 'succeeded');", "WHERE payment_id = v_p.id AND status IN ('succeeded');")]],
  [MIG6, "capacity ignores succeeded refunds", [repl("WHERE payment_id = v_p.id AND status IN ('pending', 'succeeded');", "WHERE payment_id = v_p.id AND status IN ('pending');")]],
  [MIG6, "capacity counts failed refunds as used", [repl("WHERE payment_id = v_p.id AND status IN ('pending', 'succeeded');", "WHERE payment_id = v_p.id AND status IN ('pending', 'succeeded', 'failed');")]],
  [MIG6, "a negative component is accepted", [repl("IF v_num < 0 THEN", "IF false THEN")]],
  [MIG6, "a fractional component is accepted", [repl("IF v_num <> trunc(v_num) THEN", "IF false THEN")]],
  [MIG6, "a zero-total line is accepted", [repl("IF v_c[1] + v_c[2] + v_c[3] = 0 THEN", "IF false THEN")]],
  [MIG6, "the same payment may appear twice", [repl("IF v_pid = ANY (v_seen) THEN", "IF false THEN")]],
  [MIG6, "a browser total that disagrees is accepted", [repl("IF p_expected_total_cents IS NOT NULL AND p_expected_total_cents::bigint <> v_total THEN", "IF false THEN")]],
  [MIG6, "deposit principal capacity is not enforced", [repl("IF v_line.d > v_rem_dep THEN", "IF false THEN")]],
  [MIG6, "balance principal capacity is not enforced", [repl("IF v_line.b > v_rem_bal THEN", "IF false THEN")]],
  [MIG6, "tip capacity is not enforced", [repl("IF v_line.t > v_rem_tip THEN", "IF false THEN")]],
  [MIG6, "the payment total capacity is not enforced", [repl("IF v_line_total > v_rem_total THEN", "IF false THEN")]],
  [MIG6, "a payment of another order is accepted", [repl("IF v_p.order_id IS DISTINCT FROM p_order_id THEN", "IF false THEN")]],
  [MIG6, "a payment that is not succeeded is accepted", [repl("IF v_p.status IS DISTINCT FROM 'succeeded' THEN", "IF false THEN")]],
  [MIG6, "an unclassified original payment is accepted", [repl("IF v_p.principal_amount_cents IS NULL OR v_p.deposit_principal_cents IS NULL OR v_p.balance_principal_cents IS NULL OR v_p.tip_amount_cents IS NULL THEN", "IF false THEN")]],
  [MIG6, "unclassified historical refunds are ignored", [repl("IF v_line.d > GREATEST(0, v_rem_dep - v_unknown) OR v_line.b > GREATEST(0, v_rem_bal - v_unknown) OR v_line.t > GREATEST(0, v_rem_tip - v_unknown) THEN", "IF false THEN")]],
  [MIG6, "unclassified historical refunds do not count as unknown", [repl("COALESCE(SUM(CASE WHEN allocation_version = 1 THEN unclassified_refunded_cents ELSE amount_cents END), 0)", "COALESCE(SUM(CASE WHEN allocation_version = 1 THEN unclassified_refunded_cents ELSE 0 END), 0)")]],
  [MIG6, "the unknown amount is not applied to deposit principal", [repl("v_line.d > GREATEST(0, v_rem_dep - v_unknown)", "v_line.d > v_rem_dep")]],
  [MIG6, "the unknown amount is not applied to balance principal", [repl("v_line.b > GREATEST(0, v_rem_bal - v_unknown)", "v_line.b > v_rem_bal")]],
  [MIG6, "the unknown amount is not applied to the tip", [repl("v_line.t > GREATEST(0, v_rem_tip - v_unknown)", "v_line.t > v_rem_tip")]],
  [MIG6, "older unlinked refunds on several payments are ignored", [repl("IF v_unlinked > 0 AND v_refundable_count > 1 THEN", "IF false THEN")]],
  [MIG6, "a changed allocation under the same key is accepted", [repl("IF v_existing.request_allocation IS DISTINCT FROM v_sig THEN", "IF false THEN")]],
  [MIG6, "an allocation may be attached to an amount-only operation", [repl("IF v_existing.allocation_version IS NULL THEN", "IF false THEN")]],
  [MIG6, "an identical retry reserves again", [repl("LIMIT 1;\n  IF FOUND THEN\n    IF v_existing.order_id IS DISTINCT FROM p_order_id THEN", "LIMIT 1;\n  IF false THEN\n    IF v_existing.order_id IS DISTINCT FROM p_order_id THEN")]],
  [MIG6, "the request identity depends on the order of the lines", [repl("'|' ORDER BY (e->>'p') COLLATE \"C\")", "'|')")]],
  [MIG6, "an operation whose provider request may have started is released by age", [repl("(x.stripe_refund_id IS NOT NULL OR x.provider_attempted_at IS NOT NULL OR x.status = 'succeeded')", "(x.stripe_refund_id IS NOT NULL OR x.status = 'succeeded')")]],
  [MIG6, "an unsent operation is never released", [repl("AND o.created_at < now() - interval '15 minutes'", "AND o.created_at < now() - interval '15 years'")]],
  [MIG6, "an unsettled earlier operation does not block a new request", [repl("IF FOUND THEN\n    RETURN jsonb_build_object('outcome', 'unsettled_operation'", "IF false THEN\n    RETURN jsonb_build_object('outcome', 'unsettled_operation'")]],
  [MIG6, "an untrusted role may reserve", [repl("GRANT EXECUTE ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) TO service_role;", "GRANT EXECUTE ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) TO authenticated, service_role;")]],
  [MIG6, "anonymous may reserve", [repl("REVOKE ALL ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) FROM PUBLIC, anon, authenticated;", "REVOKE ALL ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) FROM PUBLIC, authenticated;\nGRANT EXECUTE ON FUNCTION public.reserve_refund_allocation(uuid, text, jsonb, text, uuid, integer) TO anon;")]],
  // ================================================================ Stripe refund allocation integration
  [RO, "an allocation request is sent to the amount-only reservation", [repl("const reserved = allocationMode\n    ? await db.rpc(\"reserve_refund_allocation\", {", "const reserved = false\n    ? await db.rpc(\"reserve_refund_allocation\", {")]],
  [RO, "a declared total that disagrees with the allocations is not refused by the function", [repl("if (declaredTotal !== total) return bad(\"total_mismatch\", \"ALLOCATION_TOTAL_MISMATCH\");", "")]],
  [RO, "a negative allocation component is passed on", [repl("if (v < 0) return bad(\"component_negative\");", "")]],
  [RO, "a fractional allocation component is passed on", [repl("if (!Number.isInteger(v)) return bad(\"component_fractional\");", "")]],
  [RO, "a duplicate payment in the allocation is passed on", [repl("if (seen.has(id)) return bad(\"duplicate_payment\");", "")]],
  [RO, "an unknown allocation field is passed on", [repl("if (keys.some((k) => !ALLOCATION_FIELDS.includes(k))) return bad(\"unknown_field\");", "")]],
  [RO, "an empty allocation list is passed on", [repl("if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ALLOCATION_LINES) return bad(\"allocations_required\");", "if (!Array.isArray(raw) || raw.length > MAX_ALLOCATION_LINES) return bad(\"allocations_required\");")]],
  [RO, "a reserved row with another idempotency key is used", [repl("if (x.provider_idempotency_key !== `refund:${operationKey}:${x.operation_index}`) return fail;", "")]],
  [RO, "a reserved row without a PaymentIntent is used", [repl("if (typeof x.stripe_payment_intent_id !== \"string\" || !x.stripe_payment_intent_id) return fail;", "")]],
  [RO, "a reserved row without an allocation is used", [repl("if (x.allocation_version !== 1) return fail;", "")]],
  [RO, "a reserved row whose components disagree with its amount is used", [repl("if ((d as number) + (b as number) + (t as number) + (u as number) !== x.amount_cents) return fail;", "")]],
  [RO, "an incomplete reservation answer does not stop the refund", [repl("if (!sound.ok) return json(500, { success: false, code: \"REFUND_RESERVATION_FAILED\", error: \"The refund could not be started. Nothing was refunded.\" });", "")]],
  [RO, "an allocation key conflict is ignored", [repl("case \"key_conflict\": return json(409, { success: false, code: \"OPERATION_KEY_REUSED\", error: \"That operation key was already used for a different refund request.\", ...(typeof r.detail === \"string\" ? { detail: r.detail } : {}) });", "case \"key_conflict\": break;")]],
  [RO, "the response reports a browser total instead of the reserved one", [repl("requestedCents: total, ...(allocationMode", "requestedCents: amount, ...(allocationMode")]],
  [RO, "a fully rejected allocation request is reported as partial", [repl("if (failedCents === total) return json(422,", "if (failedCents === amount) return json(422,")]],
  [RO, "the tip capacity error is reported as the deposit one", [repl("code: \"TIP_CAPACITY_EXCEEDED\"", "code: \"DEPOSIT_CAPACITY_EXCEEDED\"")]],
  [RO, "an unsettled allocation operation is not named for resumption", [repl("resumeOperationKey: r.operation_key, resumeAmountCents: r.request_amount_cents", "resumeOperationKey: null, resumeAmountCents: null")]],
  [SR, "the refund function drops the allocations", [repl("...(Object.prototype.hasOwnProperty.call(body, \"allocations\") ? { allocations: body.allocations } : {}),", "")]],
  [SR, "the refund function takes the actor from the request body", [repl("actorId: gate.userId,", "actorId: typeof body.actorId === \"string\" ? body.actorId : gate.userId,")]],
  [RO, "the reserved deposit principal is not compared with the request", [repl("d !== asked.depositPrincipalCents || ", ""), repl("if (used.size !== wanted.size || total !== wantedTotal) return fail;", "if (used.size !== wanted.size) return fail;")]],
  [RO, "the reserved balance principal is not compared with the request", [repl("b !== asked.balancePrincipalCents || ", ""), repl("if (used.size !== wanted.size || total !== wantedTotal) return fail;", "if (used.size !== wanted.size) return fail;")]],
  [RO, "the reserved tip is not compared with the request", [repl("t !== asked.tipCents || ", ""), repl("if (used.size !== wanted.size || total !== wantedTotal) return fail;", "if (used.size !== wanted.size) return fail;")]],
  [RO, "a nonzero unclassified component is accepted", [repl(" || u !== 0) return fail;", ") return fail;"), repl("if (used.size !== wanted.size || total !== wantedTotal) return fail;", "if (used.size !== wanted.size) return fail;")]],
  [RO, "a reservation identity that is not the requested one is accepted", [repl("if (signature !== expectedSignature) return fail;", "")]],
  [RO, "rows in another order than the database fixes are accepted", [repl("if (pid !== sorted[i].paymentId) return fail;", "")]],
  [RO, "the number of reserved rows is not compared with the number of lines", [repl("if (rows.length !== sorted.length) return fail;", ""), repl("if (pid !== sorted[i].paymentId) return fail;", "if (!sorted[i]) return fail;")]],
  // ================================================================ shared Admin refund screen (request building, stored-refund reading, controller, overview)
  [REQ, "an amount with three decimals is accepted", [repl("if (frac.length > 2) return { ok: false, error: 'Use at most two decimal places (whole cents).' };", "")]],
  [REQ, "an entry above the available amount is accepted", [repl("if (parsed.cents > limit) { fieldErrors[fieldId(p.id, c)] = `More than the ${formatCents(limit)} available.`; continue; }", "if (false) { continue; }")]],
  [REQ, "an entry above the available amount is quietly reduced", [repl("if (parsed.cents > limit) { fieldErrors[fieldId(p.id, c)] = `More than the ${formatCents(limit)} available.`; continue; }", "if (parsed.cents > limit) { cents[c] = limit; continue; }")]],
  [REQ, "the payment total limit is not checked", [repl("if (lineTotal > p.remaining_total_cents && ", "if (false && ")]],
  [REQ, "an empty line is sent", [repl("    if (lineTotal > 0) {\n      lines.push", "    if (true) {\n      lines.push")]],
  [REQ, "a payment that cannot be refunded by component is included", [repl("    if (!isEligible(p)) continue;\n", "")]],
  [REQ, "the number of payments in one refund is not limited", [repl("else if (lines.length > MAX_ALLOCATION_LINES) formError", "else if (false) formError")]],
  [REQ, "the request identity depends on the order of the lines", [repl("  const sorted = canonicalLines(lines);\n  const total", "  const sorted = lines;\n  const total")]],
  [REQ, "a stored refund the database did not verify is rebuilt", [repl("if (op.verified !== true) return review('The stored refund rows do not form one complete, consistent refund.');", "")]],
  [REQ, "a stored refund that does not add up to its total is rebuilt", [repl("if (sum !== op.request_amount_cents) return review('The stored refund rows do not add up to the requested total.');", "")]],
  [REQ, "a stored refund whose identity does not match is rebuilt", [repl("if (allocationSignature(lines) !== op.request_allocation) return review('The stored refund does not match its recorded identity.');", "")]],
  [REQ, "a stored row with an unclassified part is rebuilt", [repl(" || r.unclassified_cents !== 0) return review('A stored refund row has an incomplete allocation.');", ") return review('A stored refund row has an incomplete allocation.');")]],
  [REQ, "a refund Stripe has accepted is shown as not yet sent", [repl("if (r.stripe_refund_id) return 'pending';", "if (r.stripe_refund_id) return 'succeeded';")]],
  [CTL, "the refund screen sends no operation key", [repl("operationKey: attempt.key, reason: r.reason", "operationKey: '', reason: r.reason")]],
  [CTL, "the refund screen makes a new key on every confirmation", [repl("allocationAttemptFor(this.state.frozen?.attempt ?? null,", "allocationAttemptFor(null,")]],
  [CTL, "a second click while a request is in flight sends again", [repl("if (this.state.phase !== 'review' || !this.state.review || this.inFlight) return;", "if (!this.state.review) return;"), repl("    if (this.inFlight) return;\n    this.inFlight = true;", "    this.inFlight = true;")]],
  [CTL, "a request that is being resumed or reviewed can be edited", [repl("private get editable(): boolean { return this.state.phase === 'ready'; }", "private get editable(): boolean { return true; }")]],
  [CTL, "a request with an unknown result is forgotten", [repl("if (outcome.kind === 'unresolved' && frozen && frozen.attempt.key === body.operationKey) {\n      // keep", "if (false) {\n      // keep")]],
  [CTL, "resuming uses a new operation key", [repl("body = { orderId: this.orderId, operationKey: f.attempt.key,", "body = { orderId: this.orderId, operationKey: 'newkey-00000000',")]],
  [CTL, "a stored allocated refund is resumed as an amount only", [repl("body = submitBodyForStored(this.orderId, op, stored);", "body = { orderId: this.orderId, operationKey: op.operation_key, reason: stored.kind === 'manual_review' ? 'x' : stored.reason, amountCents: op.request_amount_cents };")]],
  [CTL, "a refund that cannot be rebuilt can be resumed", [repl("kind: 'manual_review', canResume: false, manualReviewWhy", "kind: 'manual_review', canResume: true, manualReviewWhy")]],
  [CTL, "a change in what is available does not stop the review", [repl("const changed = !afterOwnRequest && !first && this.viewed !== '' && snap !== this.viewed;", "const changed = false;")]],
  [CTL, "an unfinished refund does not stop a new one", [repl("phase: recoveries.length > 0 ? 'recovery'", "phase: false ? 'recovery'")]],
  [CTL, "loading sends a request by itself", [repl("    if (changed && this.state.phase === 'review') this.set({ phase: 'ready' });\n    return changed ? 'changed' : 'ok';", "    if (!afterOwnRequest && this.state.recoveries.length > 0 && this.state.recoveries[0].canResume) await this.resume(this.state.recoveries[0].operationKey);\n    return changed ? 'changed' : 'ok';")]],
  [KEYFILE, "a changed allocation keeps the old key", [repl("previous.signature === signature", "true")]],
  [KEYFILE, "the same allocation for another order keeps the key", [repl("previous.orderId === orderId && previous.signature === signature", "previous.signature === signature")]],
  [PAN, "a pending refund is shown as returned money", [repl("{st === 'succeeded' ? '-' : ''}", "{'-'}")]],
  [MIG8, "pending refunds do not reduce what is available", [repl("FROM public.order_refunds r WHERE r.payment_id = p.id AND r.status IN ('pending', 'succeeded')", "FROM public.order_refunds r WHERE r.payment_id = p.id AND r.status IN ('succeeded')")]],
  [MIG8, "refunds of unknown composition do not reduce what is available (deposit)", [repl("LEAST(c.dep - c.s_d - c.p_d - c.unknown, c.rem_total)", "LEAST(c.dep - c.s_d - c.p_d, c.rem_total)")]],
  [MIG8, "refunds of unknown composition do not reduce what is available (tip)", [repl("LEAST(c.tip - c.s_t - c.p_t - c.unknown, c.rem_total)", "LEAST(c.tip - c.s_t - c.p_t, c.rem_total)")]],
  [MIG8, "refunds of unknown composition do not reduce what is available (balance)", [repl("LEAST(c.bal - c.s_b - c.p_b - c.unknown, c.rem_total)", "LEAST(c.bal - c.s_b - c.p_b, c.rem_total)")]],
  [MIG8, "older unlinked refunds beside several payments are ignored", [repl("WHEN (SELECT n FROM refundable_n) > 1 AND (SELECT cents FROM unl) > 0 THEN 'history_ambiguous'", "WHEN false THEN 'history_ambiguous'")]],
  [MIG8, "a payment with no recorded split is offered", [repl("WHEN NOT per.classified THEN 'unclassified'", "WHEN false THEN 'unclassified'")]],
  [MIG8, "a cash payment is offered", [repl("WHEN NOT per.refundable THEN 'not_refundable'", "WHEN false THEN 'not_refundable'")]],
  [MIG8, "a stored refund with a different identity is called verified", [repl("AND MAX(r.request_allocation) = 'v1|total=' || SUM(r.amount_cents)::text || '|' ||", "AND true OR MAX(r.request_allocation) = 'v1|total=' || SUM(r.amount_cents)::text || '|' ||")]],
  [MIG8, "anyone may read the refund overview", [repl("AND (current_user = 'service_role' OR public.is_admin())", "AND (true OR current_user = 'service_role' OR public.is_admin())")]],
  [MIG8, "the refund overview runs with the owner rights", [repl("STABLE\nSECURITY INVOKER", "STABLE\nSECURITY DEFINER")]],
  [MIG8, "anonymous may read the refund overview", [repl("GRANT EXECUTE ON FUNCTION public.order_refund_overview(uuid) TO authenticated, service_role;", "GRANT EXECUTE ON FUNCTION public.order_refund_overview(uuid) TO anon, authenticated, service_role;")]],
  [CTL, "a failed refresh lets the review continue", [repl("if (loaded === 'failed') {\n      // Nothing was read", "if (false) {\n      // Nothing was read")]],
  [CTL, "a failed refresh leaves a confirmation on screen", [repl("} else if (this.state.phase === 'review') {\n        // A confirmation shown", "} else if (false) {\n        // A confirmation shown")]],
  [CTL, "a failed refresh is reported as a change in availability", [repl("      return 'failed';", "      return 'changed';")]],
  [CTL, "a changed availability does not interrupt the review", [repl("if (loaded === 'changed' || this.state.phase !== 'ready') return;", "if (this.state.phase !== 'ready') return;")]],
];

// The claim function is REPLACED by the second migration, so a mutant on the claim text of the first migration would be dead code.
// These mutants therefore target the live (second-migration) claim.
const LIVE_CLAIM = ["accept a negative tip","accept a negative requested principal","a stale claim is never taken over","a live claim can be taken over by anyone","staff may charge any order status","a customer may charge a draft that is not an invoice","Custom is not bounded","an already-charged tip is charged again","a deposit ignores an existing deposit payment in the ledger","trust the customer deposit amount","trust a balance amount without the server cap","catch-up is charged as a whole deposit","a stale customer page is not detected","a customer may charge a booking request awaiting review","a tip the ledger cannot classify is guessed into a charge","Custom stores the whole amount as deposit","Full stores the whole amount as deposit","Full uses the persisted amount for its balance part","a balance payment is stored as deposit","the operation row stores a principal that is not the sum of its parts","an old operation is resumed without revalidating anything","an old operation is resumed after the deposit or balance changed","an old operation is resumed after only its split changed","an old operation is resumed after the tip changed","a cancelled, voided or otherwise unpayable order's operation is resumed","an old balance operation is resumed after the balance decreased","the claim does not report when the operation was attempted"];
const SQL2 = 'supabase/migrations/20261020120000_deposit_catch_up_and_offline_payment_parity.sql';
for (const m of M) if (m[0] === SQL && LIVE_CLAIM.includes(m[1])) m[0] = SQL2;

// SQL mutants are decided by the database tests; code mutants by the handler tests. Putting the likelier killer first means most
// mutants die in the first test file.
const SQL_FIRST = ['src/lib/tests/payments/paymentOperations.test.ts', 'src/lib/tests/payments/paymentCharging.test.ts'];
const CODE_FIRST = ['src/lib/tests/payments/paymentCharging.test.ts', 'src/lib/tests/payments/paymentOperations.test.ts'];
const REFUND_TESTS = ['src/lib/tests/payments/refundSafety.test.ts'];
const AUTHORITY_TESTS = ['src/lib/tests/payments/refundSafety.test.ts', 'src/lib/tests/security/coreDatabaseAccess.test.ts'];
const ALLOCATION_TESTS = ['src/lib/tests/payments/refundAllocation.test.ts', 'src/lib/tests/security/coreDatabaseAccess.test.ts'];
const ACCOUNTING_TESTS = ['src/lib/tests/payments/refundAccounting.test.ts', 'src/lib/tests/security/coreDatabaseAccess.test.ts'];
module.exports = {
  M,
  tests: (file) => {
    if (file.includes('20261025')) return ALLOCATION_TESTS;
    if (/refundAllocationRequest|refundController|RefundAllocationPanel/.test(file)) return ['src/lib/tests/payments/refundAllocationUi.test.ts', 'src/lib/tests/payments/refundSafety.test.ts'];
    if (file.endsWith('refundOperationKey.ts')) return ['src/lib/tests/payments/refundAllocationUi.test.ts', 'src/lib/tests/payments/refundSafety.test.ts'];
    if (file.includes('20261024')) return ALLOCATION_TESTS;
    if (file.includes('20261023')) return ACCOUNTING_TESTS;
    if (file.includes('20261022')) return AUTHORITY_TESTS;
    if (file.endsWith('order-lifecycle/index.ts')) return [...REFUND_TESTS, 'src/lib/tests/security/customerPortalAccess.test.ts'];
    if (file.endsWith('refund-operations.ts') || file.endsWith('refundOperationKey.ts') || file.endsWith('stripe-refund/index.ts') || file.endsWith('stripe-webhook/index.ts')) return REFUND_TESTS;
    if (file.endsWith('orderApprovalService.ts') || /PaymentsTab|PaymentManagementSection|TaskDetailModal/.test(file)) return REFUND_TESTS;
    if (file.endsWith('stripe-webhook/handlers.ts')) return [...CODE_FIRST, ...REFUND_TESTS];
    return file.endsWith('.sql') ? SQL_FIRST : CODE_FIRST;
  },
};
