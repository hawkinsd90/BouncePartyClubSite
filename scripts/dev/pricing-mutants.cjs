// Mutants for pricing, deposit, catch-up and cash/check: each one breaks one money rule; a test must fail.
// Run:  node scripts/dev/mutation-runner.cjs scripts/dev/pricing-mutants.cjs      (ONLY=<regex> to run a few while developing)
const MIG2 = 'supabase/migrations/20261020120000_deposit_catch_up_and_offline_payment_parity.sql';
const MONEY = 'src/lib/pricing/orderMoney.ts';
const ENGINE = 'src/lib/pricing/orderPricingCalculation.ts';
const UNIFIED = 'src/lib/pricing/unifiedTotals.ts';
const PLAN = 'src/lib/orders/orderChangePlanning.ts';
const RECEIPT = 'supabase/functions/_shared/receipt-order-totals.ts';
const DEPOSIT_UI = 'src/components/order-detail/DepositOverride.tsx';
const MIG3 = 'supabase/migrations/20261021120000_server_authoritative_order_pricing_saves.sql';
const SAVE = 'supabase/functions/_shared/staff-order-save.ts';
const SAVE_INDEX = 'supabase/functions/staff-order-save/index.ts';
const SEND_INVOICE = 'supabase/functions/send-invoice/index.ts';
const CREW = 'src/components/crew/CrewInvoiceBuilder.tsx';
const FEE_DISPLAY = 'src/lib/pricing/orderFeeDisplay.ts';
const STATE = 'src/lib/pricing/orderPricingState.ts';
const STATE_SRV = 'supabase/functions/_shared/booking/orderPricingState.ts';

const repl = (a, b) => (src) => {
  const n = src.split(a).length - 1;
  if (n === 0) throw new Error('anchor missing: ' + a.slice(0, 80));
  if (n !== 1) throw new Error('anchor not unique (' + n + '): ' + a.slice(0, 80));
  return src.replace(a, () => b);
};

const M = [
  // ---------------------------------------------------------------- the pricing formula
  [ENGINE, 'setup fee is added to the required deposit', [repl('        eventEssentialsSubtotalCents: eeSubtotalCents,\n        orderTotalCents: finalTotalCents,', '        eventEssentialsSubtotalCents: eeSubtotalCents + effectiveSetupFeeCents,\n        orderTotalCents: finalTotalCents,')]],
  [ENGINE, 'setup fee is left out of the total', [repl('    setup_fee_cents: effectiveSetupFeeCents,\n  };\n  const beforeTax', '    setup_fee_cents: 0,\n  };\n  const beforeTax')]],
  [MONEY, 'setup fee is left out of the taxable amount', [repl('    wholeCentsOrZero(components.generator_fee_cents) +\n    wholeCentsOrZero(components.setup_fee_cents);', '    wholeCentsOrZero(components.generator_fee_cents);')]],
  [MONEY, 'weekday delivery fee is counted twice', [repl('    wholeCentsOrZero(components.same_day_weekday_delivery_fee_cents);', '    wholeCentsOrZero(components.same_day_weekday_delivery_fee_cents) * 2;')]],
  [MONEY, 'same-day pickup fee is counted twice', [repl('    wholeCentsOrZero(components.same_day_pickup_fee_cents) +', '    wholeCentsOrZero(components.same_day_pickup_fee_cents) * 2 +')]],
  [MONEY, 'a fixed and a percentage discount are both applied', [repl('  if (typeof amount === \'number\' && Number.isFinite(amount) && amount > 0) return Math.round(amount);', '  if (typeof amount === \'number\' && Number.isFinite(amount) && amount > 0 && !(discount.percentage && discount.percentage > 0)) return Math.round(amount);')]],
  [MONEY, 'a percentage discount uses a different base', [repl('  const discountCents = sumEffectiveDiscountsCents(discounts, subtotal, preDiscountCents);', '  const discountCents = sumEffectiveDiscountsCents(discounts, preDiscountCents, preDiscountCents);')]],
  [MONEY, 'discounts are not capped at what there is to discount', [repl('  return Math.max(0, Math.min(sum, Math.max(0, Math.trunc(capCents))));', '  return Math.max(0, sum);')]],
  [MONEY, 'a negative discount amount counts', [repl("  if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) return Math.round(amount);", "  if (typeof amount === 'number' && Number.isFinite(amount) && amount !== 0) return Math.round(amount);")]],
  [MONEY, 'tax is applied when the effective policy disables it', [repl('  return byDefault ? !toggled : toggled;', '  return true;')]],
  [MONEY, 'the tax toggle does not invert when the default is off', [repl('  return byDefault ? !toggled : toggled;', '  return !toggled;')]],
  [MONEY, 'tax is added twice to the total', [repl('    totalCents: preDiscountCents - discountCents + tax,', '    totalCents: preDiscountCents - discountCents + tax + tax,')]],
  [MONEY, 'a different tax rate is used', [repl('export const SALES_TAX_RATE = 0.06;', 'export const SALES_TAX_RATE = 0.07;')]],
  [MONEY, 'the taxable amount may go negative', [repl('    taxableAfterDiscountCents: Math.max(0, taxableBeforeDiscountCents - discountCents),', '    taxableAfterDiscountCents: taxableBeforeDiscountCents - discountCents,')]],
  [MONEY, 'a negative custom fee acts as a discount', [repl('  return typeof value === \'number\' && Number.isSafeInteger(value) && value >= 0;', '  return typeof value === \'number\' && Number.isSafeInteger(value);')]],
  [MONEY, 'a fractional custom fee is accepted', [repl('  return typeof value === \'number\' && Number.isSafeInteger(value) && value >= 0;', '  return typeof value === \'number\' && Number.isFinite(value) && value >= 0;')]],
  [UNIFIED, 'the Quote rounds the equipment tax and the Event Essentials tax separately', [repl('  const taxCents = input.taxApplied ? calculateSalesTaxCents(taxableSubtotalCents) : 0;', '  const taxCents = input.taxApplied ? calculateSalesTaxCents(bd.subtotal_cents + travelFeeCents + surfaceFeeCents + generatorFeeCents) + calculateSalesTaxCents(eventEssentialsSubtotalCents + setupFeeCents) : 0;')]],
  [UNIFIED, 'the Quote leaves the setup fee out of the total', [repl('bd.total_cents - bd.tax_cents + eventEssentialsSubtotalCents + setupFeeCents + taxCents', 'bd.total_cents - bd.tax_cents + eventEssentialsSubtotalCents + taxCents')]],

  // ---------------------------------------------------------------- historical snapshot
  [ENGINE, 'an unchanged historical order is repriced at today\'s catalog rules', [repl('  const subtotalWithEE = equipmentSnapshotUnchanged\n', '  const subtotalWithEE = false\n')]],
  [ENGINE, 'the surface fee is re-read from today\'s rules for an unchanged order', [repl('  const originalSurfaceFeeCents = surfaceSnapshotUnchanged\n', '  const originalSurfaceFeeCents = false\n')]],
  [ENGINE, 'a stored same-day pickup fee is re-read from today\'s rules', [repl('  const originalSameDayPickupFeeCents = useSavedSameDayFee\n', '  const originalSameDayPickupFeeCents = false\n')]],
  [ENGINE, 'the stored formula deposit is re-read from today\'s per-unit rule', [repl('  if (reuseStoredDeposit) {\n    calculatedDepositDueCents', '  if (false) {\n    calculatedDepositDueCents')]],
  [ENGINE, 'the stored tax decision is ignored when the business default changes', [repl('    if (storedBase > 0) taxEnabled = existingOrder.tax_cents > 0;', '')]],
  [ENGINE, 'a stored travel explanation is re-read from today\'s rules', [repl('const savedTravelDetail = useSavedTravelFee && existingOrder\n', 'const savedTravelDetail = false && existingOrder\n')]],

  // ---------------------------------------------------------------- deposit override
  [ENGINE, 'an explicit zero deposit override is treated as no override', [repl('  const rawDepositDueCents = customDepositCents !== null ? customDepositCents : calculatedDepositDueCents;', '  const rawDepositDueCents = customDepositCents ? customDepositCents : calculatedDepositDueCents;')]],
  [DEPOSIT_UI, 'a blank deposit override field becomes a zero deposit', [repl("    if (inputValue === '') {\n      showToast('Enter an amount. Type 0 for no deposit, or leave the override off to use the normal deposit.', 'error');\n      return;\n    }", "    if (inputValue === '') {\n      onApply(0);\n      return;\n    }")]],
  [PLAN, 'the deposit override is not saved with the order', [repl("    if ((customDepositCents ?? null) !== (order.custom_deposit_cents ?? null)) {\n      changes.custom_deposit_cents = customDepositCents;", "    if (false) {\n      changes.custom_deposit_cents = customDepositCents;")]],
  [PLAN, 'a zero deposit override is dropped when saving', [repl("      changes.custom_deposit_cents = customDepositCents;\n      logs.push(['custom_deposit'", "      changes.custom_deposit_cents = customDepositCents || null;\n      logs.push(['custom_deposit'")]],
  [PLAN, 'a waived catch-up leaves the raised deposit due', [repl("      changes.deposit_due_cents = depositPaidCents;\n      changes.custom_deposit_cents = depositPaidCents;", "      changes.custom_deposit_cents = depositPaidCents;")]],

  // ---------------------------------------------------------------- displays and receipts
  [RECEIPT, 'a receipt total leaves the weekday delivery fee out', [repl('    total: b.totalCents,', '    total: b.totalCents - (o.same_day_weekday_delivery_fee_cents || 0),')]],

  // ---------------------------------------------------------------- deposit catch-up (database)
  [MIG2, 'catch-up charges the whole deposit instead of the remaining deposit', [repl('      v_dep_rem := GREATEST(0, v_dd - v_dp);\n      IF v_dep_rem <= 0 THEN', '      v_dep_rem := v_dd;\n      IF v_dep_rem <= 0 THEN')]],
  [MIG2, 'the deposit principal paid is read as the sum of all payments', [repl('  SELECT COALESCE(SUM(p.deposit_principal_cents), 0) INTO v_sum', '  SELECT COALESCE(SUM(p.amount_cents), 0) INTO v_sum')]],
  [MIG2, 'the existing deposit principal is ignored', [repl("  RETURN jsonb_build_object('status', 'known', 'deposit_principal_paid_cents', v_sum);", "  RETURN jsonb_build_object('status', 'known', 'deposit_principal_paid_cents', 0);")]],
  [MIG2, 'a tip is subtracted from the required deposit', [repl('      v_dep_rem := GREATEST(0, v_dd - v_dp);\n      IF v_dep_rem <= 0 THEN', '      v_dep_rem := GREATEST(0, v_dd - v_dp - COALESCE(v_order.tip_cents, 0));\n      IF v_dep_rem <= 0 THEN')]],
  [MIG2, 'a lowered deposit is not recognised as already paid', [repl('  IF v_dp >= v_dd THEN', '  IF false THEN'), repl('      v_dep_rem := GREATEST(0, v_dd - v_dp);\n      IF v_dep_rem <= 0 THEN\n        v_err := jsonb_build_object(\'outcome\', \'already_paid\');\n        EXIT derive;\n      END IF;', '      v_dep_rem := v_dd - v_dp;')]],
  [MIG2, 'the customer\'s browser amount chooses the catch-up', [repl('      v_dep_rem := GREATEST(0, v_dd - v_dp);\n      IF v_dep_rem <= 0 THEN', '      v_dep_rem := COALESCE(p_requested_principal_cents, GREATEST(0, v_dd - v_dp));\n      IF v_dep_rem <= 0 THEN')]],
  [MIG2, 'an unclassified legacy payment is guessed instead of failing closed', [repl('p.amount_cents > 0 AND p.deposit_principal_cents IS NULL\n  ) THEN\n    RETURN jsonb_build_object(\'status\', \'unclassified_payment\'', 'p.amount_cents > 0 AND false\n  ) THEN\n    RETURN jsonb_build_object(\'status\', \'unclassified_payment\'')]],
  [MIG2, 'refund activity does not fail closed', [repl('  IF v_refunded > 0 OR EXISTS (', '  IF false AND EXISTS (')]],
  [MIG2, 'a ledger that disagrees with the order does not fail closed', [repl('  IF v_sum <> v_order_dp THEN', '  IF false THEN')]],
  [MIG2, 'an unapplied payment does not fail closed', [repl("p.amount_cents > 0 AND COALESCE(p.order_financials_applied, false) = false\n  ) THEN\n    RETURN jsonb_build_object('status', 'unapplied_payment'", "p.amount_cents > 0 AND false\n  ) THEN\n    RETURN jsonb_build_object('status', 'unapplied_payment'")]],
  [MIG2, 'a catch-up recharges the stored tip', [repl('          v_tip := GREATEST(0, COALESCE(v_order.tip_cents, 0) - v_charged_tip);', '          v_tip := GREATEST(0, COALESCE(v_order.tip_cents, 0));')]],
  [MIG2, 'Full charges the whole deposit again', [repl("        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dep_rem;", "        ELSIF v_sel_type = 'full' THEN\n          v_dep_comp := v_dd;")]],
  [MIG2, 'Custom is not bounded by the remaining principal', [repl('OR v_sel_cents - v_paid > v_dep_rem + v_bd THEN', 'OR false THEN')]],
  [MIG2, 'Custom may be less than the remaining deposit', [repl('v_sel_cents - v_paid < v_dep_rem OR', 'false OR')]],
  [MIG2, 'Custom ignores the principal already paid', [repl('          v_paid := v_dp + COALESCE(v_order.balance_paid_cents, 0);', '          v_paid := 0;')]],

  // ---------------------------------------------------------------- cash and check (database)
  [MIG2, 'cash accepts more than the remaining principal', [repl('  IF p_amount_cents > v_remaining THEN', '  IF false THEN')]],
  [MIG2, 'cash counts the tip against the principal', [repl('  IF p_amount_cents > v_remaining THEN', '  IF p_amount_cents + v_tip > v_remaining THEN')]],
  [MIG2, 'cash ignores the unpaid deposit when computing what is owed', [repl('  v_remaining := v_dep_rem + v_bd;', '  v_remaining := v_bd;')]],
  [MIG2, 'cash classifies the whole payment as deposit', [repl('  v_dep_comp := LEAST(p_amount_cents, v_dep_rem);', '  v_dep_comp := p_amount_cents;')]],
  [MIG2, 'cash writes a payment with no components', [repl('    principal_amount_cents, tip_amount_cents, deposit_principal_cents, balance_principal_cents, order_financials_applied\n  ) VALUES (\n    p_order_id, v_payment_type, p_amount_cents + v_tip, \'succeeded\', now(), p_method,\n    p_amount_cents, v_tip, v_dep_comp, v_bal_comp, true', '    order_financials_applied\n  ) VALUES (\n    p_order_id, v_payment_type, p_amount_cents + v_tip, \'succeeded\', now(), p_method,\n    true')]],
  [MIG2, 'cash is recorded while an online payment is open', [repl("  IF EXISTS (SELECT 1 FROM public.payments p WHERE p.order_id = p_order_id AND p.operation_key IS NOT NULL AND p.status = 'pending') THEN", '  IF false THEN')]],
  [MIG2, 'cash adds the tip to the balance paid', [repl('    balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_comp,', '    balance_paid_cents = COALESCE(balance_paid_cents, 0) + v_bal_comp + v_tip,')]],
  [MIG2, 'a negative custom fee is allowed by the database', [repl('CHECK (amount_cents >= 0) NOT VALID;', 'CHECK (true) NOT VALID;')]],
  [MIG2, 'a discount over 100 percent is allowed by the database', [repl('COALESCE(percentage, 0) <= 100)', 'true)')]],
  // ---------------------------------------------------------------- the server is the author of staff pricing
  [SAVE, 'Admin save trusts the browser subtotal', [repl('  const calculatedPricing = priced.calculatedPricing;\n\n  // ---- the address', '  const calculatedPricing = priced.calculatedPricing;\n  if (typeof (raw.clientPricing as Any)?.subtotal_cents === "number") (calculatedPricing as Any).subtotal_cents = (raw.clientPricing as Any).subtotal_cents;\n\n  // ---- the address')]],
  [SAVE, 'Admin save trusts the browser tax', [repl('  const calculatedPricing = priced.calculatedPricing;\n\n  // ---- the address', '  const calculatedPricing = priced.calculatedPricing;\n  if (typeof (raw.clientPricing as Any)?.tax_cents === "number") (calculatedPricing as Any).tax_cents = (raw.clientPricing as Any).tax_cents;\n\n  // ---- the address')]],
  [SAVE, 'Admin save trusts the browser deposit', [repl('  const calculatedPricing = priced.calculatedPricing;\n\n  // ---- the address', '  const calculatedPricing = priced.calculatedPricing;\n  if (typeof (raw.clientPricing as Any)?.deposit_due_cents === "number") (calculatedPricing as Any).deposit_due_cents = (raw.clientPricing as Any).deposit_due_cents;\n\n  // ---- the address')]],
  [SAVE, 'Admin save trusts the browser total', [repl('} as Any, { calculateTotal: storedOrderTotalCents });', '} as Any, { calculateTotal: () => Number((raw.clientPricing as Any)?.total_cents ?? 0) });')]],
  [SAVE, 'Admin save trusts the browser balance', [repl('  const logs = [\n    ...plan.itemOperations', '  if (typeof (raw.clientPricing as Any)?.balance_due_cents === "number") (finalized.changes as Any).balance_due_cents = (raw.clientPricing as Any).balance_due_cents;\n  const logs = [\n    ...plan.itemOperations')]],
  [SAVE, 'Admin save accepts a browser price field', [repl('  const extra = onlyKeys(raw, SAVE_KEYS);', '  const extra = null as string | null;')]],
  [SAVE, 'Admin save accepts a browser line price', [repl('  const itemIntents = parseItems(raw.items, false);', '  const itemIntents = parseItems(raw.items, true);')]],
  [SAVE, 'Admin Invoice accepts a browser price field', [repl('  const extra = onlyKeys(raw, INVOICE_KEYS);', '  const extra = null as string | null;')]],
  [SAVE, 'Admin Invoice accepts a browser subtotal', [repl('    subtotal_cents: p.subtotal_cents, travel_fee_cents: p.travel_fee_cents,', '    subtotal_cents: Number((raw.clientPricing as Any)?.subtotal_cents ?? p.subtotal_cents), travel_fee_cents: p.travel_fee_cents,')]],
  [SAVE, 'Admin Invoice accepts a browser deposit', [repl('    deposit_due_cents: p.deposit_due_cents, deposit_required: p.deposit_due_cents > 0, balance_due_cents: p.balance_due_cents,', '    deposit_due_cents: Number((raw.clientPricing as Any)?.deposit_due_cents ?? p.deposit_due_cents), deposit_required: p.deposit_due_cents > 0, balance_due_cents: p.balance_due_cents,')]],
  [CREW, 'Crew builder sends its own browser total again', [repl('          customDepositCents: null,\n          discounts: [],', '          customDepositCents: null,\n          totalCents: pricing.totalCents,\n          discounts: [],')]],
  [SAVE, 'a stale Admin save overwrites newer pricing', [repl('  if (!sameOrderPricingState(raw.expectedState as unknown as OrderPricingState, currentState)) {', '  if (false) {')]],
  [MIG3, 'the database does not re-check staleness under the order lock', [repl("  IF NOT (to_jsonb(v_order) @> COALESCE(p_expected_state->'columns', '{}'::jsonb))\n", '  IF false\n')]],
  [SAVE, 'an existing order is repriced from today\'s rules on every save', [repl('    existingOrder: existingOrder as Any,', '    existingOrder: undefined,')]],
  [SAVE_INDEX, 'Crew may save edits to existing orders', [repl('action === "save_changes" ? STAFF_ADMIN_ROLES : INVOICE_SENDER_ROLES', 'INVOICE_SENDER_ROLES')]],
  [SAVE_INDEX, 'a customer may author a staff save', [repl('requireRoles(caller, action === "save_changes" ? STAFF_ADMIN_ROLES : INVOICE_SENDER_ROLES', 'requireRoles(caller, [...INVOICE_SENDER_ROLES, "customer"]')]],
  [SEND_INVOICE, 'send-invoice trusts the deposit the caller sends', [repl("    const { orderId, customerEmail, customerPhone, customerName } = await req.json();", "    const { orderId, depositCents: rawDepositCents, customerEmail, customerPhone, customerName } = await req.json();"), repl("    const depositCents = Number.isFinite(Number(order.deposit_due_cents)) ? Number(order.deposit_due_cents) : 0;", "    const depositCents = Number.isFinite(Number(rawDepositCents)) ? Number(rawDepositCents) : 0;")]],
  [MIG3, 'a staff session may write the balance due directly', [repl('     OR NEW.balance_due_cents IS DISTINCT FROM OLD.balance_due_cents\n', '')]],
  [MIG3, 'a staff session may write the subtotal directly', [repl('  IF NEW.subtotal_cents IS DISTINCT FROM OLD.subtotal_cents\n', '  IF false\n')]],
  [MIG3, 'a staff session may write the deposit override directly', [repl('     OR NEW.custom_deposit_cents IS DISTINCT FROM OLD.custom_deposit_cents\n', '')]],
  [MIG3, 'the pricing guard exempts staff sessions', [repl("  IF current_user NOT IN ('authenticated', 'anon') THEN", '  IF true THEN')]],
  [MIG3, 'a staff session may create an order with a price', [repl("  IF TG_OP = 'INSERT' THEN\n    IF COALESCE(NEW.subtotal_cents, 0) <> 0", "  IF TG_OP = 'INSERT' THEN\n    RETURN NEW;\n    IF COALESCE(NEW.subtotal_cents, 0) <> 0")]],
  [MIG3, 'the staff save can write payment columns', [repl("'customer_view_updated_at', 'waived_fee_amounts_cents'\n  ];", "'customer_view_updated_at', 'waived_fee_amounts_cents', 'deposit_paid_cents'\n  ];")]],
  [MIG3, 'a staff invoice can be created in any status', [repl("  IF COALESCE(p_order->>'status', '') <> 'draft' THEN", '  IF false THEN')]],
  [MIG3, 'the staff save function is executable by authenticated', [repl('GRANT EXECUTE ON FUNCTION public.apply_staff_order_save(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.apply_staff_order_save(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO service_role, authenticated;')]],
  // ---------------------------------------------------------------- waived fee amounts are history, not today's rule
  [FEE_DISPLAY, 'a waived fee with no stored amount shows today\'s figure', [repl('    unknown.push(key);\n    return 0;', '    return 5000;')]],
  [ENGINE, 'the editor rebuilds an unknown waived amount from today\'s rules', [repl('      waivedAmountUnknown.push(key);\n      return 0;', '      return computedOriginal;')]],
  [ENGINE, 'a kept waived amount is replaced by today\'s rule on every edit', [repl('    if (existingOrder && wasWaived && basisUnchanged) {', '    if (false) {')]],
  [SAVE, 'the amount of a waived fee is not kept with the order', [repl('  if (JSON.stringify(keptWaived) !== JSON.stringify(storedWaived)) plan.changes.waived_fee_amounts_cents = keptWaived;', '')]],
  // ---------------------------------------------------------------- offline payments confirm only when the deposit is satisfied
  [MIG2, 'a partial cash or check deposit confirms the order', [repl("WHEN v_order.status IN ('awaiting_customer_approval', 'pending_review') AND (v_dd <= 0 OR v_new_dp >= v_dd) THEN 'confirmed'", "WHEN v_order.status IN ('awaiting_customer_approval', 'pending_review') THEN 'confirmed'")]],
  [MIG2, 'offline confirmation ignores the deposit this payment just paid', [repl("AND (v_dd <= 0 OR v_new_dp >= v_dd) THEN 'confirmed'", "AND (v_dd <= 0 OR v_dp >= v_dd) THEN 'confirmed'")]],
  [MIG2, 'a negative offline tip is silently turned into zero', [repl("  IF v_tip < 0 THEN\n    RAISE EXCEPTION 'tip_cents must not be negative';\n  END IF;", '  IF v_tip < 0 THEN v_tip := 0; END IF;')]],
  // ================================================================ round C: the database is the wall, Crew is narrowed, the stale state is complete, the server measures the distance
  [MIG3, 'an Admin session can write order_items directly', [repl("REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated, anon;\n", ''), repl("DROP POLICY IF EXISTS \"Admin and master manage order items\" ON public.order_items;\n", '')]],
  [MIG3, 'a Crew session can INSERT into order_items directly', [repl("REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM authenticated, anon;", "REVOKE UPDATE, DELETE ON public.order_items FROM authenticated, anon;"), repl("DROP POLICY IF EXISTS \"Crew create order items\" ON public.order_items;\n", '')]],
  [MIG3, 'an Admin session can write order_discounts directly', [repl("REVOKE INSERT, UPDATE, DELETE ON public.order_discounts FROM authenticated, anon;\n", ''), repl("DROP POLICY IF EXISTS \"Admin and master manage order discounts\" ON public.order_discounts;\n", '')]],
  [MIG3, 'a Crew session can INSERT into order_discounts directly', [repl("REVOKE INSERT, UPDATE, DELETE ON public.order_discounts FROM authenticated, anon;", "REVOKE UPDATE, DELETE ON public.order_discounts FROM authenticated, anon;"), repl("DROP POLICY IF EXISTS \"Crew create order discounts\" ON public.order_discounts;\n", '')]],
  [MIG3, 'an Admin session can write order_custom_fees directly', [repl("REVOKE INSERT, UPDATE, DELETE ON public.order_custom_fees FROM authenticated, anon;\n", ''), repl("DROP POLICY IF EXISTS \"Admin and master manage order custom fees\" ON public.order_custom_fees;\n", '')]],
  [MIG3, 'a Crew session can INSERT into order_custom_fees directly', [repl("REVOKE INSERT, UPDATE, DELETE ON public.order_custom_fees FROM authenticated, anon;", "REVOKE UPDATE, DELETE ON public.order_custom_fees FROM authenticated, anon;"), repl("DROP POLICY IF EXISTS \"Crew create order custom fees\" ON public.order_custom_fees;\n", '')]],
  [MIG3, 'an Admin session can create a zero-dollar draft order directly', [repl('REVOKE INSERT, DELETE ON public.orders FROM authenticated, anon;', 'REVOKE DELETE ON public.orders FROM authenticated, anon;')]],
  [MIG3, 'a Crew session can create a draft order directly', [repl('REVOKE INSERT, DELETE ON public.orders FROM authenticated, anon;', 'REVOKE DELETE ON public.orders FROM authenticated, anon;'), repl('DROP POLICY IF EXISTS "Crew create draft orders" ON public.orders;\n', '')]],
  [MIG3, 'an Admin session can delete an order directly', [repl('REVOKE INSERT, DELETE ON public.orders FROM authenticated, anon;', 'REVOKE INSERT ON public.orders FROM authenticated, anon;')]],
  [MIG3, 'a staff session may write orders.event_essentials_subtotal_cents directly', [repl("     OR NEW.event_essentials_subtotal_cents IS DISTINCT FROM OLD.event_essentials_subtotal_cents\n", '')]],
  [MIG3, 'a staff session may write orders.travel_total_miles directly', [repl("     OR NEW.travel_total_miles IS DISTINCT FROM OLD.travel_total_miles\n", '')]],
  [MIG3, 'a staff session may write orders.travel_base_radius_miles directly', [repl("     OR NEW.travel_base_radius_miles IS DISTINCT FROM OLD.travel_base_radius_miles\n", '')]],
  [MIG3, 'a staff session may write orders.travel_chargeable_miles directly', [repl("     OR NEW.travel_chargeable_miles IS DISTINCT FROM OLD.travel_chargeable_miles\n", '')]],
  [MIG3, 'a staff session may write orders.travel_per_mile_cents directly', [repl("     OR NEW.travel_per_mile_cents IS DISTINCT FROM OLD.travel_per_mile_cents\n", '')]],
  [MIG3, 'a staff session may write orders.travel_is_flat_fee directly', [repl("     OR NEW.travel_is_flat_fee IS DISTINCT FROM OLD.travel_is_flat_fee\n", '')]],
  [MIG3, 'a staff session may write orders.travel_fee_cents directly', [repl("     OR NEW.travel_fee_cents IS DISTINCT FROM OLD.travel_fee_cents\n", '')]],
  [MIG3, 'a staff session may write orders.surface_fee_cents directly', [repl("     OR NEW.surface_fee_cents IS DISTINCT FROM OLD.surface_fee_cents\n", '')]],
  [MIG3, 'a staff session may write orders.same_day_pickup_fee_cents directly', [repl("     OR NEW.same_day_pickup_fee_cents IS DISTINCT FROM OLD.same_day_pickup_fee_cents\n", '')]],
  [MIG3, 'a staff session may write orders.same_day_weekday_delivery_fee_cents directly', [repl("     OR NEW.same_day_weekday_delivery_fee_cents IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_cents\n", '')]],
  [MIG3, 'a staff session may write orders.generator_fee_cents directly', [repl("     OR NEW.generator_fee_cents IS DISTINCT FROM OLD.generator_fee_cents\n", '')]],
  [MIG3, 'a staff session may write orders.setup_fee_cents directly', [repl("     OR NEW.setup_fee_cents IS DISTINCT FROM OLD.setup_fee_cents\n", '')]],
  [MIG3, 'a staff session may write orders.tax_cents directly', [repl("     OR NEW.tax_cents IS DISTINCT FROM OLD.tax_cents\n", '')]],
  [MIG3, 'a staff session may write orders.deposit_due_cents directly', [repl("     OR NEW.deposit_due_cents IS DISTINCT FROM OLD.deposit_due_cents\n", '')]],
  [MIG3, 'a staff session may write orders.waived_fee_amounts_cents directly', [repl("     OR NEW.waived_fee_amounts_cents IS DISTINCT FROM OLD.waived_fee_amounts_cents\n", '')]],
  [MIG3, 'a staff session may write orders.deposit_paid_cents directly', [repl("     OR NEW.deposit_paid_cents IS DISTINCT FROM OLD.deposit_paid_cents\n", '')]],
  [MIG3, 'a staff session may write orders.balance_paid_cents directly', [repl("     OR NEW.balance_paid_cents IS DISTINCT FROM OLD.balance_paid_cents\n", '')]],
  [MIG3, 'a staff session may write orders.tip_cents directly', [repl("     OR NEW.tip_cents IS DISTINCT FROM OLD.tip_cents\n", '')]],
  [MIG3, 'a staff session may write orders.damage_charged_cents directly', [repl("     OR NEW.damage_charged_cents IS DISTINCT FROM OLD.damage_charged_cents\n", '')]],
  [MIG3, 'a staff session may write orders.total_refunded_cents directly', [repl("     OR NEW.total_refunded_cents IS DISTINCT FROM OLD.total_refunded_cents\n", '')]],
  [MIG3, 'a staff session may write orders.tax_waived directly', [repl("     OR NEW.tax_waived IS DISTINCT FROM OLD.tax_waived\n", '')]],
  [MIG3, 'a staff session may write orders.tax_waive_reason directly', [repl("     OR NEW.tax_waive_reason IS DISTINCT FROM OLD.tax_waive_reason\n", '')]],
  [MIG3, 'a staff session may write orders.travel_fee_waived directly', [repl("     OR NEW.travel_fee_waived IS DISTINCT FROM OLD.travel_fee_waived\n", '')]],
  [MIG3, 'a staff session may write orders.travel_fee_waive_reason directly', [repl("     OR NEW.travel_fee_waive_reason IS DISTINCT FROM OLD.travel_fee_waive_reason\n", '')]],
  [MIG3, 'a staff session may write orders.surface_fee_waived directly', [repl("     OR NEW.surface_fee_waived IS DISTINCT FROM OLD.surface_fee_waived\n", '')]],
  [MIG3, 'a staff session may write orders.surface_fee_waive_reason directly', [repl("     OR NEW.surface_fee_waive_reason IS DISTINCT FROM OLD.surface_fee_waive_reason\n", '')]],
  [MIG3, 'a staff session may write orders.generator_fee_waived directly', [repl("     OR NEW.generator_fee_waived IS DISTINCT FROM OLD.generator_fee_waived\n", '')]],
  [MIG3, 'a staff session may write orders.generator_fee_waive_reason directly', [repl("     OR NEW.generator_fee_waive_reason IS DISTINCT FROM OLD.generator_fee_waive_reason\n", '')]],
  [MIG3, 'a staff session may write orders.same_day_pickup_fee_waived directly', [repl("     OR NEW.same_day_pickup_fee_waived IS DISTINCT FROM OLD.same_day_pickup_fee_waived\n", '')]],
  [MIG3, 'a staff session may write orders.same_day_pickup_fee_waive_reason directly', [repl("     OR NEW.same_day_pickup_fee_waive_reason IS DISTINCT FROM OLD.same_day_pickup_fee_waive_reason\n", '')]],
  [MIG3, 'a staff session may write orders.same_day_weekday_delivery_fee_waived directly', [repl("     OR NEW.same_day_weekday_delivery_fee_waived IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_waived\n", '')]],
  [MIG3, 'a staff session may write the weekday delivery waiver reason directly', [repl("     OR NEW.same_day_weekday_delivery_fee_waive_reason IS DISTINCT FROM OLD.same_day_weekday_delivery_fee_waive_reason\n", '')]],
  [MIG3, 'an order may be created with orders.event_essentials_subtotal_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.event_essentials_subtotal_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.travel_fee_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.travel_fee_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.surface_fee_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.surface_fee_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.same_day_pickup_fee_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.same_day_pickup_fee_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.same_day_weekday_delivery_fee_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.same_day_weekday_delivery_fee_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.generator_fee_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.generator_fee_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.setup_fee_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.setup_fee_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.tax_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.tax_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.deposit_due_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.deposit_due_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.balance_due_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.balance_due_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.travel_total_miles set (if INSERT were granted)', [repl("       OR COALESCE(NEW.travel_total_miles, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.deposit_paid_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.deposit_paid_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.balance_paid_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.balance_paid_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.tip_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.tip_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.damage_charged_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.damage_charged_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.total_refunded_cents set (if INSERT were granted)', [repl("       OR COALESCE(NEW.total_refunded_cents, 0) <> 0\n", '')]],
  [MIG3, 'an order may be created with orders.tax_waived set (if INSERT were granted)', [repl("       OR COALESCE(NEW.tax_waived, false)\n", '')]],
  [MIG3, 'an order may be created with orders.travel_fee_waived set (if INSERT were granted)', [repl("       OR COALESCE(NEW.travel_fee_waived, false)\n", '')]],
  [MIG3, 'an order may be created with orders.surface_fee_waived set (if INSERT were granted)', [repl("       OR COALESCE(NEW.surface_fee_waived, false)\n", '')]],
  [MIG3, 'an order may be created with orders.generator_fee_waived set (if INSERT were granted)', [repl("       OR COALESCE(NEW.generator_fee_waived, false)\n", '')]],
  [MIG3, 'an order may be created with orders.same_day_pickup_fee_waived set (if INSERT were granted)', [repl("       OR COALESCE(NEW.same_day_pickup_fee_waived, false)\n", '')]],
  [MIG3, 'an order may be created with orders.same_day_weekday_delivery_fee_waived set (if INSERT were granted)', [repl("       OR COALESCE(NEW.same_day_weekday_delivery_fee_waived, false)\n", '')]],
  [MIG3, 'an order may be created with a custom deposit (if INSERT were granted)', [repl("       OR NEW.custom_deposit_cents IS NOT NULL\n", '')]],
  [MIG3, 'an order may be created with waived amounts (if INSERT were granted)', [repl("       OR NEW.waived_fee_amounts_cents IS NOT NULL THEN", '       OR false THEN')]],
  [MIG3, 'the database accepts a waived-amount object that is merely a subset of the stored one', [repl("     OR ((p_expected_state->'columns') ? 'waived_fee_amounts_cents'\n         AND to_jsonb(v_order)->'waived_fee_amounts_cents' IS DISTINCT FROM (p_expected_state->'columns')->'waived_fee_amounts_cents')\n", '')]],
  [SAVE, 'every caller may override prices (the capability is always true)', [repl('  const canOverride = deps.canOverridePricing === true;', '  const canOverride = true;')]],
  [SAVE, 'the override capability defaults to allowed', [repl('  const canOverride = deps.canOverridePricing === true;', '  const canOverride = deps.canOverridePricing !== false;')]],
  [SAVE, 'Crew may add a discount', [repl('    if (discountsIn.length > 0) return forbiddenField("discounts");\n', '')]],
  [SAVE, 'Crew may add a custom fee', [repl('    if (feesIn.length > 0) return forbiddenField("customFees");\n', '')]],
  [SAVE, 'Crew may waive a fee', [repl("    for (const k of WAIVER_KEYS) if (waivers[k].waived || waivers[k].reason.trim() !== \"\") return forbiddenField(`waivers.${k}`);\n", '')]],
  [SAVE, 'Crew may supply a waiver reason without a waiver', [repl("if (waivers[k].waived || waivers[k].reason.trim() !== \"\") return forbiddenField", "if (waivers[k].waived) return forbiddenField")]],
  [SAVE, 'Crew may set a custom deposit', [repl('    if (customDeposit !== null) return forbiddenField("customDepositCents");\n', '')]],
  [SAVE, 'Crew may set a custom setup fee', [repl('    if (customSetup !== null) return forbiddenField("customSetupFeeCents");\n', '')]],
  [SAVE, 'Crew may opt out of card on file', [repl('    if (raw.requireCardOnFile === false) return forbiddenField("requireCardOnFile");\n', '')]],
  [SAVE, 'Crew may set an adjusted line price', [repl('const created = newLine(canOverride ? it : withoutPrice, catalog,', 'const created = newLine(it, catalog,')]],
  [SAVE, 'Crew line price is only compared when it is lower than the catalog', [repl('requestedPrice !== created.unit_price_cents) return forbiddenField', 'requestedPrice < created.unit_price_cents) return forbiddenField'), repl('const created = newLine(canOverride ? it : withoutPrice, catalog,', 'const created = newLine(it, catalog,')]],
  [SAVE, 'a staff order edit is allowed without the capability', [repl('  if (deps.canOverridePricing !== true) return json(403, { success: false, code: "FORBIDDEN", error: "Forbidden: staff access required." });\n', '')]],
  [SAVE, 'the override capability can be claimed in the request body', [repl('const INVOICE_KEYS = ["customerId",', 'const INVOICE_KEYS = ["canOverridePricing", "customerId",'), repl('  const canOverride = deps.canOverridePricing === true;', '  const canOverride = deps.canOverridePricing === true || raw.canOverridePricing === true;')]],
  [SAVE_INDEX, 'Crew is given the override capability by the Edge Function', [repl('canOverridePricing: isStaffAdmin(caller)', 'canOverridePricing: true')]],
  [SAVE_INDEX, 'the invoice path grants the override capability to its callers', [repl('canOverridePricing: isStaffAdmin(caller)', 'canOverridePricing: isStaffAdmin(caller) || action === "create_invoice"')]],
  [SAVE_INDEX, 'the override capability comes from the request body', [repl('canOverridePricing: isStaffAdmin(caller)', 'canOverridePricing: isStaffAdmin(caller) || body.canOverridePricing === true')]],
  [STATE, "a view older than a change to tax_waived is not stale", [repl("  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n", "  'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to tax_waive_reason is not stale", [repl("  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n", "  'tax_waived', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to travel_fee_waived is not stale", [repl("  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n", "  'tax_waived', 'tax_waive_reason', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to travel_fee_waive_reason is not stale", [repl("  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n", "  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'surface_fee_waived', 'surface_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to surface_fee_waived is not stale", [repl("  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n", "  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to surface_fee_waive_reason is not stale", [repl("  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n", "  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived',\n")]],
  [STATE, "a view older than a change to generator_fee_waived is not stale", [repl("  'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',\n", "  'generator_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to generator_fee_waive_reason is not stale", [repl("  'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',\n", "  'generator_fee_waived', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to same_day_pickup_fee_waived is not stale", [repl("  'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',\n", "  'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to same_day_pickup_fee_waive_reason is not stale", [repl("  'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waived', 'same_day_pickup_fee_waive_reason',\n", "  'generator_fee_waived', 'generator_fee_waive_reason', 'same_day_pickup_fee_waived',\n")]],
  [STATE, "a view older than a change to same_day_weekday_delivery_fee_waived is not stale", [repl("  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',\n", "  'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',\n")]],
  [STATE, "a view older than a change to same_day_weekday_delivery_fee_waive_reason is not stale", [repl("  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',\n", "  'same_day_weekday_delivery_fee_waived', 'waived_fee_amounts_cents',\n")]],
  [STATE, "a view older than a change to waived_fee_amounts_cents is not stale", [repl("  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',\n", "  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason',\n")]],
  [STATE, "a view older than a change to travel_total_miles is not stale", [repl("  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n", "  'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n")]],
  [STATE, "a view older than a change to travel_base_radius_miles is not stale", [repl("  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n", "  'travel_total_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n")]],
  [STATE, "a view older than a change to travel_chargeable_miles is not stale", [repl("  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n", "  'travel_total_miles', 'travel_base_radius_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n")]],
  [STATE, "a view older than a change to travel_per_mile_cents is not stale", [repl("  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n", "  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_is_flat_fee',\n")]],
  [STATE, "a view older than a change to travel_is_flat_fee is not stale", [repl("  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n", "  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents',\n")]],
  [STATE_SRV, "the server state omits waived_fee_amounts_cents (every save would look stale)", [repl("  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',\n", "  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason',\n")]],
  [STATE_SRV, "the server state omits travel_total_miles (every save would look stale)", [repl("  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n", "  'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n")]],
  [STATE_SRV, "the server state omits tax_waived (every save would look stale)", [repl("  'tax_waived', 'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n", "  'tax_waive_reason', 'travel_fee_waived', 'travel_fee_waive_reason', 'surface_fee_waived', 'surface_fee_waive_reason',\n")]],
  [STATE_SRV, "the server state omits travel_is_flat_fee (every save would look stale)", [repl("  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents', 'travel_is_flat_fee',\n", "  'travel_total_miles', 'travel_base_radius_miles', 'travel_chargeable_miles', 'travel_per_mile_cents',\n")]],
  [STATE_SRV, "the server state omits same_day_weekday_delivery_fee_waive_reason (every save would look stale)", [repl("  'same_day_weekday_delivery_fee_waived', 'same_day_weekday_delivery_fee_waive_reason', 'waived_fee_amounts_cents',\n", "  'same_day_weekday_delivery_fee_waived', 'waived_fee_amounts_cents',\n")]],
  [STATE, 'waived amounts are compared by object identity', [repl("if (!(key in current.columns) || JSON.stringify(expected.columns[key]) !== JSON.stringify(current.columns[key])) return false;", "if (!(key in current.columns) || expected.columns[key] !== current.columns[key]) return false;")]],
  [STATE, 'waived amounts keep their key order', [repl("return Object.fromEntries(Object.keys(v).sort().map(", "return Object.fromEntries(Object.keys(v).map(")]],
  [STATE, 'a numeric column is compared as the text the browser happened to receive', [repl("if (NUMERIC_COLUMNS.has(key) && (typeof v === 'string' || typeof v === 'number') && Number.isFinite(Number(v))) return Number(v);", '')]],
  [STATE, 'an object column is flattened to text', [repl("if (OBJECT_COLUMNS.has(key) && typeof v === 'object') {", "if (false) {")]],
  [SAVE, 'a browser mileage field controls the travel fee on an invoice', [repl('"requireCardOnFile", "clientPricing"] as const;', '"requireCardOnFile", "clientPricing", "measuredDistanceMiles"] as const;'), repl('  const distance = await resolveDistance(deps, params, parsedEvent);\n', '  const distance = await resolveDistance(deps, params, parsedEvent);\n  if (distance.ok && typeof (raw as Any).measuredDistanceMiles === "number") distance.miles = (raw as Any).measuredDistanceMiles;\n')]],
  [SAVE, 'a browser mileage field controls the travel fee on an edit', [repl('"parks", "clientPricing"] as const;', '"parks", "clientPricing", "measuredDistanceMiles"] as const;'), repl('  const distance = await resolveDistance(deps, params, edited);\n', '  const distance = await resolveDistance(deps, params, edited);\n  if (distance.ok && typeof (raw as Any).measuredDistanceMiles === "number") distance.miles = (raw as Any).measuredDistanceMiles;\n')]],
  [SAVE, 'an unchanged address is measured again (the stored travel snapshot is not reused)', [repl(' || sameAddressText(e, existing.addresses))) {', ')) {')]],
  [SAVE, 'a distance that cannot be measured is guessed as zero', [repl('  if (miles === null || !Number.isFinite(miles) || miles < 0 || miles > MAX_DISTANCE_MILES) return { ok: false };', '  if (miles === null) miles = 0;\n  if (!Number.isFinite(miles) || miles < 0 || miles > MAX_DISTANCE_MILES) return { ok: false };')]],
  [SAVE, 'an implausibly large measured distance is accepted', [repl(' || miles < 0 || miles > MAX_DISTANCE_MILES) return { ok: false };', ' || miles < 0) return { ok: false };')]],
  [SAVE, 'a negative measured distance is accepted', [repl(' || miles < 0 || miles > MAX_DISTANCE_MILES) return { ok: false };', ' || miles > MAX_DISTANCE_MILES) return { ok: false };')]],
  [SAVE, 'a non-finite measured distance is accepted', [repl('!Number.isFinite(miles) || miles < 0', 'miles < 0')]],
  [SAVE, 'the measured address is the browser coordinates, not the address text', [repl('  const destination = [e.address_line1,', "  const destination = e.address_lat !== null && e.address_lng !== null ? `${e.address_lat},${e.address_lng}` : [e.address_line1,")]],
  [SAVE, 'the distance is measured from the wrong origin', [repl("encodeURIComponent(`${HOME_BASE.lat},${HOME_BASE.lng}`)", "encodeURIComponent(`${HOME_BASE.lng},${HOME_BASE.lat}`)")]],
  [SAVE, 'meters are converted to miles wrongly', [repl('const METERS_PER_MILE = 1609.34;', 'const METERS_PER_MILE = 1000;')]],
  [SAVE, 'a Google lookup without a key is trusted anyway', [repl('    if (!opts.apiKey || !destination.trim()) return null;', '    if (!destination.trim()) return null;')]],
  [SAVE, 'a failed Google response is read as zero miles', [repl('      if (!resp.ok) return null;', '      if (!resp.ok) return 0;')]],
  [SAVE, 'a Google outage is read as zero miles', [repl('    } catch {\n      return null;\n    }\n  };\n}', '    } catch {\n      return 0;\n    }\n  };\n}')]],
  [SAVE, 'an unavailable distance still creates the invoice', [repl('  const distance = await resolveDistance(deps, params, parsedEvent);\n  if (!distance.ok) return json(503,', '  const distance = await resolveDistance(deps, params, parsedEvent);\n  if (false) return json(503,')]],
  ["src/components/admin/orders/OrderDetailModal.tsx", 'the order modal writes computed miles back to the order', [repl('            // Display only: the miles are never written back from the browser (the server owns the travel snapshot).', "            await supabase.from('orders').update({ travel_total_miles: travelMiles }).eq('id', order.id);")]],
  ["src/lib/orders/orderSummaryLoader.ts", 'the summary loader writes computed miles back to the order', [repl('            if (travelMiles <= 0) {', "            supabase.from('orders').update({ travel_total_miles: travelMiles }).eq('id', orderId);\n            if (travelMiles <= 0) {")]],
  ["src/lib/payments/invoiceService.ts", 'the invoice request sends the browser mileage again', [repl('    requireCardOnFile: invoiceData.requireCardOnFile !== false,\n  };', '    requireCardOnFile: invoiceData.requireCardOnFile !== false,\n    measuredDistanceMiles: 0,\n  };')]],
  ["src/lib/orders/staffOrderSaveRequest.ts", 'the editor writes an order discount row directly', [repl("import { showToast } from '../toasts';", "import { showToast } from '../toasts';\nimport { supabase } from '../supabase';\nvoid supabase.from('order_discounts').insert({ amount_cents: 1 });")]],
  ["src/lib/orders/staffOrderSaveRequest.ts", 'the editor creates an order row directly', [repl("import { showToast } from '../toasts';", "import { showToast } from '../toasts';\nimport { supabase } from '../supabase';\nvoid supabase.from('orders').insert({ subtotal_cents: 1 });")]],
];

// guard_order_pricing_authority is RESTATED (with the payment-state flags added) by the refund-safety migration, which sorts after
// the pricing migration, so a mutant on the pricing migration's copy would be dead code. These mutants target the live copy.
const MIG4_GUARD = /staff session may|may write orders.|order may be created|pricing guard exempts|weekday delivery waiver reason directly/;
for (const m of M) if (m[0] === MIG3 && MIG4_GUARD.test(m[1])) m[0] = 'supabase/migrations/20261022120000_refund_safety_and_financial_write_authority.sql';

const PURE = ['src/lib/tests/pricing/orderMoney.test.ts', 'src/lib/tests/pricing/pricingReconciliation.test.ts', 'src/lib/tests/pricing/orderPricingCalculation.test.ts', 'src/lib/tests/orders/orderChangePlanning.test.ts', 'src/lib/tests/eventEssentials/eventEssentialsMoney.test.ts'];
const SQL = ['src/lib/tests/payments/paymentOperations.test.ts', 'src/lib/tests/payments/paymentCharging.test.ts'];
const SERVER = ['src/lib/tests/orders/staffOrderSave.test.ts', 'src/lib/tests/pricing/pricingReconciliation.test.ts'];
const BROWSER_SRC = ['src/lib/tests/pricing/pricingReconciliation.test.ts', 'src/lib/tests/security/customerPortalAccess.test.ts'];
module.exports = {
  M,
  tests: (file) => {
    if (file.includes('20261022')) return ['src/lib/tests/orders/staffOrderSave.test.ts', 'src/lib/tests/security/coreDatabaseAccess.test.ts', 'src/lib/tests/pricing/pricingReconciliation.test.ts'];
    if (file.endsWith('.sql')) return file.includes('20261021') ? ['src/lib/tests/orders/staffOrderSave.test.ts', 'src/lib/tests/security/coreDatabaseAccess.test.ts', 'src/lib/tests/pricing/pricingReconciliation.test.ts', 'src/lib/tests/payments/paymentOperations.test.ts'] : SQL;
    if (file.includes('orderPricingState')) return SERVER;
    if (/OrderDetailModal|orderSummaryLoader\.ts|invoiceService|staffOrderSaveRequest/.test(file)) return BROWSER_SRC;
    if (file.endsWith('receipt-order-totals.ts')) return ['src/lib/tests/payments/paymentCharging.test.ts', ...PURE];
    if (file.includes('staff-order-save') || file.includes('send-invoice') || file.includes('CrewInvoiceBuilder')) return SERVER;
    if (file.endsWith('orderFeeDisplay.ts')) return ['src/lib/tests/pricing/pricingReconciliation.test.ts', 'src/lib/tests/orders/staffOrderSave.test.ts'];
    return PURE;
  },
};
