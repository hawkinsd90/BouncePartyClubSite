import Stripe from "npm:stripe@20.0.0";
import { logTransaction } from "../_shared/transaction-logger.ts";
import { sendCheckoutBalanceReceiptEmail, sendDepositReceiptEmail } from "./emails.ts";

export async function invokeLifecycle(
  supabaseClient: any,
  action: string,
  orderId: string,
  source: string,
  paymentOutcome?: string,
  oldStatusHint?: string
): Promise<void> {
  try {
    const { data, error } = await supabaseClient.functions.invoke("order-lifecycle", {
      body: { action, orderId, source, paymentOutcome, ...(oldStatusHint ? { oldStatusHint } : {}) },
    });
    if (error) {
      console.error(`[WEBHOOK] order-lifecycle transport error: action=${action} orderId=${orderId}`, error);
    } else if (data && !data.alreadySent && data && !data.success) {
      console.error(`[WEBHOOK] order-lifecycle returned success=false: action=${action} orderId=${orderId} error=${data.error}`);
    }
  } catch (err) {
    console.error(`[WEBHOOK] order-lifecycle invoke threw (non-fatal): action=${action} orderId=${orderId}`, err);
  }
}

export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  const orderId = session.metadata?.order_id || null;
  const paymentType = session.metadata?.payment_type || "deposit";

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id || null;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;

  const setupIntentId =
    typeof session.setup_intent === "string"
      ? session.setup_intent
      : session.setup_intent?.id || null;

  const paymentMethodId =
    typeof session.payment_method === "string"
      ? session.payment_method
      : null;

  const amountPaid = session.amount_total || 0;

  if (!orderId) {
    console.warn("[WEBHOOK] No order_id in session metadata, skipping");
    return;
  }

  if (session.mode === "setup" && setupIntentId) {
    let actualPaymentMethodId = paymentMethodId;
    try {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      actualPaymentMethodId = typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id || null;
    } catch (err) {
      console.error(`[WEBHOOK] Failed to retrieve SetupIntent ${setupIntentId}:`, err);
    }

    const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);

    let setupCardBrand: string | null = null;
    let setupCardLast4: string | null = null;
    if (actualPaymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(actualPaymentMethodId);
        setupCardBrand = pm.card?.brand || null;
        setupCardLast4 = pm.card?.last4 || null;
      } catch (err) {
        console.error(`[WEBHOOK] Failed to retrieve payment method ${actualPaymentMethodId}:`, err);
      }
    }

    const { data: invoiceLink } = await supabaseClient
      .from("invoice_links")
      .select("id")
      .eq("order_id", orderId)
      .eq("link_type", "invoice")
      .maybeSingle();

    const isAdminInvoice = !!invoiceLink;
    const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

    const { data: setupCurrentOrder } = await supabaseClient
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .maybeSingle();
    const setupSafeToAdvance = ["draft", "quote", "pending_review"].includes(setupCurrentOrder?.status || "");

    const { error: updateError } = await supabaseClient
      .from("orders")
      .update({
        ...(setupSafeToAdvance ? { status: newStatus } : {}),
        stripe_payment_method_id: actualPaymentMethodId,
        stripe_customer_id: stripeCustomerId,
        ...(tipCents > 0 ? { tip_cents: tipCents } : {}),
        ...(setupCardBrand ? { payment_method_brand: setupCardBrand } : {}),
        ...(setupCardLast4 ? { payment_method_last_four: setupCardLast4 } : {}),
      })
      .eq("id", orderId);

    if (updateError) {
      console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
    } else if (setupSafeToAdvance) {
      if (isAdminInvoice) {
        await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_setup_session_admin_invoice", "charged_now", "draft");
      } else {
        await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_setup_session_checkout", undefined, "draft");
      }
    }
    return;
  }

  if (paymentType === "balance") {
    await handleBalancePayment(session, supabaseClient, stripe, orderId, stripeCustomerId, paymentIntentId, amountPaid);
  } else {
    await handleDepositPayment(session, supabaseClient, stripe, orderId, stripeCustomerId, paymentIntentId, paymentMethodId, amountPaid);
  }
}

async function handleBalancePayment(
  session: Stripe.Checkout.Session,
  supabaseClient: any,
  stripe: Stripe,
  orderId: string,
  stripeCustomerId: string | null,
  piId: string | null,
  amountPaid: number
): Promise<void> {
  let latestChargeId: string | null = null;
  let paymentMethodType: string | null = null;
  let paymentBrand: string | null = null;
  let paymentLast4: string | null = null;
  let expandedPaymentMethodId: string | null = null;

  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId, {
        expand: ['payment_method', 'latest_charge'],
      });

      latestChargeId =
        typeof pi.latest_charge === "string"
          ? pi.latest_charge
          : pi.latest_charge?.id || null;

      const pm = pi.payment_method;
      if (pm && typeof pm === 'object') {
        // @ts-ignore -- pm is expanded PaymentMethod
        paymentMethodType = pm.type || null;
        // @ts-ignore -- pm is expanded PaymentMethod
        expandedPaymentMethodId = pm.id || null;
        // @ts-ignore -- pm is expanded PaymentMethod
        if (pm.card) {
          // @ts-ignore -- pm is expanded PaymentMethod
          paymentBrand = pm.card.brand || null;
          // @ts-ignore -- pm is expanded PaymentMethod
          paymentLast4 = pm.card.last4 || null;
        }
      }
    } catch (err) {
      console.error("[WEBHOOK] Failed to retrieve PI with expansions:", err);
    }
  }

  let stripeFee = 0;
  let stripeNet = amountPaid;
  let currency = 'usd';

  if (latestChargeId) {
    try {
      const charge = await stripe.charges.retrieve(latestChargeId, {
        expand: ['balance_transaction'],
      });

      currency = charge.currency || 'usd';

      const balanceTx = charge.balance_transaction;
      if (balanceTx && typeof balanceTx === 'object') {
        // @ts-ignore -- balanceTx is expanded BalanceTransaction
        stripeFee = balanceTx.fee || 0;
        // @ts-ignore -- balanceTx is expanded BalanceTransaction
        stripeNet = balanceTx.net || amountPaid;
      } else {
        console.warn('[WEBHOOK] balance_transaction was not expanded; fee tracking may be inaccurate', {
          latestChargeId,
          balance_transaction: charge.balance_transaction,
        });
      }
    } catch (err) {
      console.error('[WEBHOOK] Failed to retrieve charge fee data:', err);
    }
  }

  const balanceTipCents = parseInt(session.metadata?.tip_cents || "0", 10);
  const safeTipCents = Number.isFinite(balanceTipCents) ? balanceTipCents : 0;
  const balanceOnly = Math.max(0, amountPaid - safeTipCents);

  if (!piId) {
    console.error("[WEBHOOK] Balance payment has no PaymentIntent ID — cannot record safely");
    return;
  }

  const { data: paymentRecord, error: balancePaymentInsertError } = await supabaseClient
    .from("payments")
    .insert({
      order_id: orderId,
      stripe_payment_intent_id: piId,
      amount_cents: amountPaid,
      type: "balance",
      status: "succeeded",
      paid_at: new Date().toISOString(),
      payment_method: paymentMethodType,
      payment_brand: paymentBrand,
      payment_last4: paymentLast4,
      stripe_fee_amount: stripeFee,
      stripe_net_amount: stripeNet,
      currency: currency,
      order_financials_applied: false,
    })
    .select('id')
    .maybeSingle();

  if (balancePaymentInsertError) {
    if (balancePaymentInsertError.code === "23505") {
      console.warn("[WEBHOOK] 23505 on balance insert — delegating to RPC", { orderId, piId });
      const { data: repairRows, error: repairErr } = await supabaseClient
        .rpc("apply_balance_payment_financials", {
          p_pi_id: piId,
          p_order_id: orderId,
          p_balance_cents: balanceOnly,
          p_tip_cents: safeTipCents,
          p_pm_id: expandedPaymentMethodId || null,
          p_customer_id: stripeCustomerId || null,
        });
      if (repairErr) {
        console.error("[WEBHOOK] apply_balance_payment_financials failed on 23505 path", { orderId, piId, repairErr });
        throw new Error(`apply_balance_payment_financials failed (23505 path): ${repairErr.message}`);
      }
      const _r = Array.isArray(repairRows) ? repairRows[0] : repairRows;
      void _r;

      const { data: existingPayment23505 } = await supabaseClient
        .from("payments")
        .select("id, order_id")
        .eq("stripe_payment_intent_id", piId)
        .eq("order_id", orderId)
        .maybeSingle();

      try {
        const { data: order23505 } = await supabaseClient
          .from("orders")
          .select(`
            customer_id, event_date,
            subtotal_cents, travel_fee_cents, surface_fee_cents,
            same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
            travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived,
            generator_fee_waived, tax_waived,
            deposit_paid_cents, balance_due_cents,
            addresses(line1, city, state, zip),
            order_items(qty, unit_price_cents, units(name)),
            customers(email, first_name, last_name)
          `)
          .eq("id", orderId)
          .maybeSingle();

        if (order23505 && existingPayment23505) {
          await logTransaction(supabaseClient, {
            transactionType: 'balance',
            orderId,
            customerId: order23505.customer_id,
            paymentId: existingPayment23505.id,
            amountCents: amountPaid,
            paymentMethod: paymentMethodType,
            paymentMethodBrand: paymentBrand,
            stripeChargeId: latestChargeId,
            stripePaymentIntentId: piId,
            notes: 'Customer portal balance payment',
          });
        }

        const customer23505 = Array.isArray(order23505?.customers) ? order23505.customers[0] : order23505?.customers;
        if (customer23505?.email) {
          const { data: bizSettings23505 } = await supabaseClient
            .from("admin_settings")
            .select("key, value")
            .in("key", ["business_name", "business_phone", "logo_url"]);
          const biz23505: Record<string, string> = {};
          bizSettings23505?.forEach((s: { key: string; value: string | null }) => { if (s.value) biz23505[s.key] = s.value; });
          await sendCheckoutBalanceReceiptEmail(
            supabaseClient, orderId, order23505, customer23505, biz23505,
            amountPaid, balanceOnly, safeTipCents, paymentBrand, paymentLast4
          );
        }
      } catch (emailErr23505) {
        console.warn("[WEBHOOK] Failed to send 23505-path balance receipt email:", emailErr23505);
      }
      return;
    }
    console.error("[WEBHOOK] CRITICAL: Failed to insert balance payment row", { orderId, piId, balancePaymentInsertError });
    throw new Error(`Balance payment insert failed: ${balancePaymentInsertError.message}`);
  }

  const { data: applyRows, error: applyErr } = await supabaseClient
    .rpc("apply_balance_payment_financials", {
      p_pi_id: piId,
      p_order_id: orderId,
      p_balance_cents: balanceOnly,
      p_tip_cents: safeTipCents,
      p_pm_id: expandedPaymentMethodId || null,
      p_customer_id: stripeCustomerId || null,
    });
  if (applyErr) {
    console.error("[WEBHOOK] CRITICAL: apply_balance_payment_financials failed", { orderId, piId, applyErr });
    throw new Error(`apply_balance_payment_financials failed: ${applyErr.message}`);
  }

  const _applyResult = Array.isArray(applyRows) ? applyRows[0] : applyRows;
  void _applyResult;

  if (paymentBrand || paymentLast4 || expandedPaymentMethodId) {
    await supabaseClient
      .from("orders")
      .update({
        ...(expandedPaymentMethodId ? { stripe_payment_method_id: expandedPaymentMethodId } : {}),
        ...(paymentBrand ? { payment_method_brand: paymentBrand } : {}),
        ...(paymentLast4 ? { payment_method_last_four: paymentLast4 } : {}),
      })
      .eq("id", orderId);
  }

  const { data: order } = await supabaseClient
    .from("orders")
    .select(`
      customer_id, event_date,
      subtotal_cents, travel_fee_cents, surface_fee_cents,
      same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
      travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived,
      generator_fee_waived, tax_waived,
      deposit_paid_cents, balance_due_cents,
      addresses(line1, city, state, zip),
      order_items(qty, unit_price_cents, units(name)),
      customers(email, first_name, last_name)
    `)
    .eq("id", orderId)
    .maybeSingle();

  if (order && paymentRecord) {
    await logTransaction(supabaseClient, {
      transactionType: 'balance',
      orderId,
      customerId: order.customer_id,
      paymentId: paymentRecord.id,
      amountCents: amountPaid,
      paymentMethod: paymentMethodType,
      paymentMethodBrand: paymentBrand,
      stripeChargeId: latestChargeId,
      stripePaymentIntentId: piId,
      notes: 'Customer portal balance payment',
    });
  }

  try {
    const customer = Array.isArray(order?.customers) ? order.customers[0] : order?.customers;
    if (customer?.email) {
      const { data: bizSettings } = await supabaseClient
        .from("admin_settings")
        .select("key, value")
        .in("key", ["business_name", "business_phone", "logo_url"]);
      const biz: Record<string, string> = {};
      bizSettings?.forEach((s: { key: string; value: string | null }) => {
        if (s.value) biz[s.key] = s.value;
      });
      await sendCheckoutBalanceReceiptEmail(
        supabaseClient, orderId, order, customer, biz,
        amountPaid, balanceOnly, safeTipCents, paymentBrand, paymentLast4
      );
    }
  } catch (emailErr) {
    console.warn("[WEBHOOK] Failed to send checkout balance receipt email:", emailErr);
  }
}

async function handleDepositPayment(
  session: Stripe.Checkout.Session,
  supabaseClient: any,
  stripe: Stripe,
  orderId: string,
  stripeCustomerId: string | null,
  paymentIntentId: string | null,
  paymentMethodId: string | null,
  amountPaid: number
): Promise<void> {
  const tipCents = parseInt(session.metadata?.tip_cents || "0", 10);
  const depositOnly = Math.max(0, amountPaid - (Number.isFinite(tipCents) ? tipCents : 0));

  let depositCardBrand: string | null = null;
  let depositCardLast4: string | null = null;
  if (paymentMethodId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      depositCardBrand = pm.card?.brand || null;
      depositCardLast4 = pm.card?.last4 || null;
    } catch (err) {
      console.error("[WEBHOOK] Failed to retrieve PM for deposit:", err);
    }
  }

  const { data: invoiceLink } = await supabaseClient
    .from("invoice_links")
    .select("id")
    .eq("order_id", orderId)
    .eq("link_type", "invoice")
    .maybeSingle();

  const isAdminInvoice = !!invoiceLink;
  const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

  const { data: currentOrder } = await supabaseClient
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  const safeToAdvanceStatus = ["draft", "quote", "pending_review"].includes(currentOrder?.status || "");

  const { error: updateError } = await supabaseClient
    .from("orders")
    .update({
      ...(safeToAdvanceStatus ? { status: newStatus } : {}),
      stripe_payment_status: "paid",
      ...(paymentMethodId ? { stripe_payment_method_id: paymentMethodId } : {}),
      ...(stripeCustomerId ? { stripe_customer_id: stripeCustomerId } : {}),
      deposit_paid_cents: depositOnly,
      ...(tipCents > 0 ? { tip_cents: tipCents } : {}),
      ...(depositCardBrand ? { payment_method_brand: depositCardBrand } : {}),
      ...(depositCardLast4 ? { payment_method_last_four: depositCardLast4 } : {}),
    })
    .eq("id", orderId);

  if (updateError) {
    console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
  } else if (safeToAdvanceStatus) {
    if (isAdminInvoice) {
      await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_checkout_deposit_admin_invoice", "charged_now", "draft");
    } else {
      await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_checkout_deposit_standard", undefined, "draft");
    }
  }

  if (paymentIntentId) {
    await supabaseClient
      .from("payments")
      .update({
        status: "succeeded",
        paid_at: new Date().toISOString(),
      })
      .eq("stripe_payment_intent_id", paymentIntentId);
  }

  try {
    const { data: depositOrder } = await supabaseClient
      .from("orders")
      .select(`
        customer_id, event_date,
        subtotal_cents, travel_fee_cents, surface_fee_cents,
        same_day_pickup_fee_cents, generator_fee_cents, tax_cents,
        travel_fee_waived, surface_fee_waived, same_day_pickup_fee_waived,
        generator_fee_waived, tax_waived,
        balance_due_cents,
        addresses(line1, city, state, zip),
        order_items(qty, unit_price_cents, units(name)),
        customers(email, first_name, last_name)
      `)
      .eq("id", orderId)
      .maybeSingle();
    const depositCustomer = Array.isArray(depositOrder?.customers) ? depositOrder.customers[0] : depositOrder?.customers;
    if (depositCustomer?.email) {
      const { data: depositBizSettings } = await supabaseClient
        .from("admin_settings")
        .select("key, value")
        .in("key", ["business_name", "business_phone", "logo_url"]);
      const depositBiz: Record<string, string> = {};
      depositBizSettings?.forEach((s: { key: string; value: string | null }) => { if (s.value) depositBiz[s.key] = s.value; });
      await sendDepositReceiptEmail(
        supabaseClient, orderId, depositOrder, depositCustomer, depositBiz,
        amountPaid, depositOnly, tipCents, depositCardBrand, depositCardLast4
      );
    }
  } catch (depositEmailErr) {
    console.warn("[WEBHOOK] Failed to send deposit receipt email:", depositEmailErr);
  }
}

export async function handlePaymentIntentSucceeded(
  paymentIntent: Stripe.PaymentIntent,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  const orderId = paymentIntent.metadata?.order_id || null;
  const paymentType = paymentIntent.metadata?.payment_type || null;

  let paymentMethodType: string | null = null;
  let paymentBrand: string | null = null;
  let paymentLast4: string | null = null;

  if (paymentIntent.payment_method) {
    const pm = await stripe.paymentMethods.retrieve(
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : paymentIntent.payment_method.id
    );
    paymentMethodType = pm.type || null;
    if (pm.card) {
      paymentBrand = pm.card.brand || null;
      paymentLast4 = pm.card.last4 || null;
    }
  }

  await supabaseClient
    .from("payments")
    .update({
      status: "succeeded",
      paid_at: new Date().toISOString(),
      payment_method: paymentMethodType,
      payment_brand: paymentBrand,
      payment_last4: paymentLast4
    })
    .eq("stripe_payment_intent_id", paymentIntent.id);

  if (!orderId) return;

  const paymentMethodId =
    typeof paymentIntent.payment_method === "string"
      ? paymentIntent.payment_method
      : paymentIntent.payment_method?.id || null;

  const stripeCustomerId =
    typeof paymentIntent.customer === "string"
      ? paymentIntent.customer
      : paymentIntent.customer?.id || null;

  const amountReceived = paymentIntent.amount_received || 0;

  if (paymentType === "balance") {
    const tipCentsFromMeta = parseInt(paymentIntent.metadata?.tip_cents || "0", 10) || 0;
    const balanceOnlyFromMeta = Math.max(0, amountReceived - tipCentsFromMeta);

    const { data: piApplyRows, error: piApplyErr } = await supabaseClient
      .rpc("apply_balance_payment_financials", {
        p_pi_id: paymentIntent.id,
        p_order_id: orderId,
        p_balance_cents: balanceOnlyFromMeta,
        p_tip_cents: tipCentsFromMeta,
        p_pm_id: paymentMethodId || null,
        p_customer_id: stripeCustomerId || null,
      });

    if (piApplyErr) {
      console.error("[WEBHOOK] pi.succeeded apply_balance_payment_financials failed", { orderId, piId: paymentIntent.id, piApplyErr });
      throw new Error(`apply_balance_payment_financials failed (pi.succeeded): ${piApplyErr.message}`);
    }
    const r = Array.isArray(piApplyRows) ? piApplyRows[0] : piApplyRows;
    void r;
  } else if (paymentType === "deposit") {
    const { data: depositOrder } = await supabaseClient
      .from("orders")
      .select("tip_cents, deposit_paid_cents, stripe_payment_status, status")
      .eq("id", orderId)
      .maybeSingle();

    const { data: invoiceLink } = await supabaseClient
      .from("invoice_links")
      .select("id")
      .eq("order_id", orderId)
      .eq("link_type", "invoice")
      .maybeSingle();

    const isAdminInvoice = !!invoiceLink;
    const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

    const alreadyRecordedByCheckout =
      depositOrder?.stripe_payment_status === "paid" &&
      (depositOrder?.deposit_paid_cents || 0) > 0;

    const piDepositSafeToAdvance = ["draft", "quote", "pending_review"].includes(depositOrder?.status || "");

    if (!alreadyRecordedByCheckout) {
      const storedTipCents = depositOrder?.tip_cents || 0;
      const depositOnlyFromPI = Math.max(0, amountReceived - storedTipCents);

      const { error: piDepositUpdateError } = await supabaseClient
        .from("orders")
        .update({
          ...(piDepositSafeToAdvance ? { status: newStatus } : {}),
          stripe_payment_status: "paid",
          stripe_payment_method_id: paymentMethodId,
          stripe_customer_id: stripeCustomerId,
          deposit_paid_cents: depositOnlyFromPI,
          ...(paymentBrand ? { payment_method_brand: paymentBrand } : {}),
          ...(paymentLast4 ? { payment_method_last_four: paymentLast4 } : {}),
        })
        .eq("id", orderId);

      if (piDepositUpdateError) {
        console.error(`[WEBHOOK] Failed to update order ${orderId} for pi deposit:`, piDepositUpdateError);
      } else if (piDepositSafeToAdvance) {
        if (isAdminInvoice) {
          await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_pi_deposit_admin_invoice", "charged_now", "draft");
        } else {
          await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_pi_deposit_standard", undefined, "draft");
        }
      }
    } else {
      if (paymentBrand || paymentLast4) {
        await supabaseClient
          .from("orders")
          .update({
            ...(paymentBrand ? { payment_method_brand: paymentBrand } : {}),
            ...(paymentLast4 ? { payment_method_last_four: paymentLast4 } : {}),
          })
          .eq("id", orderId);
      }
    }
  }
}

export async function handlePaymentIntentFailed(
  paymentIntent: Stripe.PaymentIntent,
  supabaseClient: any
): Promise<void> {
  await supabaseClient
    .from("payments")
    .update({
      status: "failed",
      failed_at: new Date().toISOString()
    })
    .eq("stripe_payment_intent_id", paymentIntent.id);
}

export async function handleChargeRefunded(
  charge: Stripe.Charge,
  supabaseClient: any
): Promise<void> {
  const paymentIntentId = charge.payment_intent as string;

  const { data: originalPayment } = await supabaseClient
    .from("payments")
    .select("id, order_id, payment_method, payment_brand")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (!originalPayment?.order_id) return;

  const refundAmountCents = charge.amount_refunded || 0;
  const refundAmountSigned = -Math.abs(refundAmountCents);
  const refundId = (charge.refunds?.data?.[0]?.id as string) || null;

  const { data: order } = await supabaseClient
    .from("orders")
    .select("customer_id")
    .eq("id", originalPayment.order_id)
    .single();

  const { data: refundPayment } = await supabaseClient
    .from("payments")
    .insert({
      order_id: originalPayment.order_id,
      stripe_payment_intent_id: paymentIntentId,
      amount_cents: refundAmountSigned,
      type: "refund",
      status: "succeeded",
      paid_at: new Date().toISOString(),
      payment_method: originalPayment.payment_method,
      payment_brand: originalPayment.payment_brand,
      refunded_payment_id: originalPayment.id,
      stripe_fee_amount: 0,
      stripe_net_amount: refundAmountSigned,
      currency: 'usd',
    })
    .select('id')
    .maybeSingle();

  if (order && refundPayment) {
    await logTransaction(supabaseClient, {
      transactionType: 'refund',
      orderId: originalPayment.order_id,
      customerId: order.customer_id,
      paymentId: refundPayment.id,
      amountCents: refundAmountSigned,
      paymentMethod: originalPayment.payment_method,
      paymentMethodBrand: originalPayment.payment_brand,
      stripeChargeId: charge.id,
      stripePaymentIntentId: paymentIntentId,
      notes: `Refund for charge ${charge.id}${charge.refund_reason ? ` - ${charge.refund_reason}` : ''}`,
    });
  }

  await supabaseClient.from("order_refunds").insert({
    order_id: originalPayment.order_id,
    amount_cents: refundAmountCents,
    reason: charge.refund_reason || "refund",
    stripe_refund_id: refundId,
    refunded_by: null,
    status: charge.refunded ? "succeeded" : "pending",
  });
}

export async function handleSetupIntentSucceeded(
  setupIntent: Stripe.SetupIntent,
  supabaseClient: any,
  stripe: Stripe
): Promise<void> {
  const orderId = setupIntent.metadata?.order_id || null;

  if (!orderId) {
    console.warn("[WEBHOOK] No order_id in setup_intent metadata, skipping");
    return;
  }

  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id || null;

  const stripeCustomerId =
    typeof setupIntent.customer === "string"
      ? setupIntent.customer
      : setupIntent.customer?.id || null;

  let siCardBrand: string | null = null;
  let siCardLast4: string | null = null;
  if (paymentMethodId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      siCardBrand = pm.card?.brand || null;
      siCardLast4 = pm.card?.last4 || null;
    } catch (err) {
      console.error(`[WEBHOOK] Failed to retrieve payment method ${paymentMethodId}:`, err);
    }
  }

  const { data: invoiceLink } = await supabaseClient
    .from("invoice_links")
    .select("id")
    .eq("order_id", orderId)
    .eq("link_type", "invoice")
    .maybeSingle();

  const isAdminInvoice = !!invoiceLink;
  const newStatus = isAdminInvoice ? "confirmed" : "pending_review";

  const { data: siCurrentOrder } = await supabaseClient
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  const siSafeToAdvance = ["draft", "quote", "pending_review"].includes(siCurrentOrder?.status || "");

  const { error: updateError } = await supabaseClient
    .from("orders")
    .update({
      ...(siSafeToAdvance ? { status: newStatus } : {}),
      stripe_payment_method_id: paymentMethodId,
      stripe_customer_id: stripeCustomerId,
      ...(siCardBrand ? { payment_method_brand: siCardBrand } : {}),
      ...(siCardLast4 ? { payment_method_last_four: siCardLast4 } : {}),
    })
    .eq("id", orderId);

  if (updateError) {
    console.error(`[WEBHOOK] Error updating order ${orderId}:`, updateError);
  } else if (siSafeToAdvance) {
    if (isAdminInvoice) {
      await invokeLifecycle(supabaseClient, "enter_confirmed", orderId, "webhook_setup_intent_admin_invoice", "zero_due_with_card", "draft");
    } else {
      await invokeLifecycle(supabaseClient, "enter_pending_review", orderId, "webhook_setup_intent_standard", undefined, "draft");
    }
  }
}
