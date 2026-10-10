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
  [SQL, 'Custom is not bounded', [repl('IF v_sel_cents IS NULL OR v_sel_cents < v_dd OR v_sel_cents > v_dd + v_bd THEN', 'IF v_sel_cents IS NULL THEN')]],
  [SQL, 'an already-charged tip is charged again', [repl('v_tip := GREATEST(0, COALESCE(v_order.tip_cents, 0) - v_charged_tip);', 'v_tip := GREATEST(0, COALESCE(v_order.tip_cents, 0));')]],
  [SQL, 'a deposit ignores an existing deposit payment in the ledger', [repl("    IF EXISTS (SELECT 1 FROM public.payments pd WHERE pd.order_id = p_order_id AND pd.type = 'deposit' AND pd.status = 'succeeded' AND pd.amount_cents > 0) THEN", '    IF false THEN')]],

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
  [SQL, 'trust the customer deposit amount', [repl('      ELSE\n        v_dep_comp := v_dd;\n        v_bal_comp := 0;\n      END IF;\n      v_principal := v_dep_comp + v_bal_comp;', '      ELSE\n        v_dep_comp := COALESCE(p_requested_principal_cents, v_dd);\n        v_bal_comp := 0;\n      END IF;\n      v_principal := v_dep_comp + v_bal_comp;')]],
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
  [SQL, 'Custom stores the whole amount as deposit', [repl('          v_dep_comp := LEAST(v_sel_cents, v_dd);\n          v_bal_comp := v_sel_cents - v_dep_comp;', '          v_dep_comp := v_sel_cents;\n          v_bal_comp := 0;')]],
  [SQL, 'Full stores the whole amount as deposit', [repl("        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dd;\n          v_bal_comp := v_bd;", "        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dd + v_bd;\n          v_bal_comp := 0;")]],
  [SQL, 'Full uses the persisted amount for its balance part', [repl("        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dd;\n          v_bal_comp := v_bd;", "        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dd;\n          v_bal_comp := COALESCE(v_sel_cents - v_dd, v_bd);")]],
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
];

// SQL mutants are decided by the database tests; code mutants by the handler tests. Putting the likelier killer first means most
// mutants die in the first test file.
const SQL_FIRST = ['src/lib/paymentOperations.test.ts', 'src/lib/paymentCharging.test.ts'];
const CODE_FIRST = ['src/lib/paymentCharging.test.ts', 'src/lib/paymentOperations.test.ts'];
module.exports = { M, tests: (file) => (file.endsWith('.sql') ? SQL_FIRST : CODE_FIRST) };
