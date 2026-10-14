// Differential tests for the pure Quote submit gate (quoteSubmitGate.ts).
//
// `oracleHandleSubmit` is a verbatim copy of Quote.handleSubmit's decision sequence as it stood before the
// extraction, with every side effect (the state setters inside flushSync, the debug info, scrollToField,
// scrollToSection, saveFormData, savePriceBreakdown, trackEvent, navigate) replaced by a recorder, and the
// async availability request replaced by a provided result. The oracle never calls the new module.
// `applyGateFailure` is a copy of the thin helper the page uses to apply a returned failure, recording the
// same side effects, so old and new are compared as complete ordered side-effect logs.

import { validateQuote } from '../../quoteValidation';
import { validateCartPackageSnapshots } from '../../packageDisplay';
import { composeUnifiedQuoteTotals } from '../../unifiedTotals';
import { parseBookingDepositSettings } from '../../depositCalculation';
import { evaluateQuoteSubmitGate, evaluateAvailabilityRecheck } from '../../quoteSubmitGate';
import type { QuoteSubmitGateFailure, QuoteSubmitGateInput } from '../../quoteSubmitGate';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
let compared = 0;

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every((k) => same(ra[k], rb[k]));
  }
  return false;
}

function ok(label: string, cond: boolean) {
  if (cond) { passed++; } else { failed++; console.error(`FAIL ${label}`); }
}

function eq(label: string, actual: unknown, expected: unknown) {
  if (same(actual, expected)) { passed++; } else {
    failed++;
    console.error(`FAIL ${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  }
}

// ---------------------------------------------------------------------------
// Old decision sequence, with recorded side effects
// ---------------------------------------------------------------------------
type Effect = any[];

interface OldInput extends QuoteSubmitGateInput {
  debugMode: boolean;
  recheck: { cart: any[]; eventEssentialsCheckFailed: boolean };
}

async function oracleHandleSubmit(i: OldInput): Promise<Effect[]> {
  const fx: Effect[] = [];
  const flushSync = (fn: () => void) => fn();
  const setValidationError = (m: string | null) => fx.push(['setValidationError', m]);
  const setValidationErrorFieldId = (m: string | null) => fx.push(['setValidationErrorFieldId', m]);
  const setShowBottomToast = (b: boolean) => fx.push(['setShowBottomToast', b]);
  const setDebugInfo = (d: any) => fx.push(['setDebugInfo', { ...d, timestamp: 'T' }]);
  const scrollToField = (id: string) => fx.push(['scrollToField', id]);
  const scrollToSection = (s: string) => fx.push(['scrollToSection', s]);
  const { cart, formData, dateChangeAvailabilityError, eventEssentialsRepricing, pricingRulesLoading, pricingRulesError, pricingRules, priceBreakdown, debugMode } = i;
  const generatorCheckbox = { legacyConversionNeeded: i.legacyConversionNeeded };

  const validation = validateQuote(cart, formData);
  if (!validation.isValid) {
    const errorMessage = validation.errorMessage || 'Please fix the errors below';

    flushSync(() => {
      setValidationError(errorMessage);
      setValidationErrorFieldId(validation.errorFieldId || null);
      setShowBottomToast(true);

      if (debugMode) {
        setDebugInfo({
          timestamp: new Date().toISOString(),
          validationFailed: true,
          errorSection: validation.errorSection || null,
          scrollAttempted: false,
          refFound: false,
          scrollTop: null,
          elementTop: null,
        });
      }
    });

    if (validation.errorFieldId) {
      scrollToField(validation.errorFieldId);
    } else if (validation.errorSection) {
      scrollToSection(validation.errorSection);
    }

    return fx;
  }

  if (dateChangeAvailabilityError) {
    flushSync(() => {
      setValidationError(dateChangeAvailabilityError);
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    scrollToSection('cart');
    return fx;
  }

  if (eventEssentialsRepricing.validationPending) {
    flushSync(() => {
      setValidationError('Please wait while your Event Essential items are being verified.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    scrollToSection('cart');
    return fx;
  }

  if (eventEssentialsRepricing.validationFailed) {
    flushSync(() => {
      setValidationError('Unable to verify your Event Essential items. Please try again.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    scrollToSection('cart');
    return fx;
  }

  if (eventEssentialsRepricing.hasBlockingIssues) {
    flushSync(() => {
      setValidationError('Please resolve the unavailable Event Essential items before continuing.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    scrollToSection('cart');
    return fx;
  }

  if (generatorCheckbox.legacyConversionNeeded) {
    flushSync(() => {
      setValidationError('Your saved Generator selection needs to be reviewed before continuing.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    scrollToSection('setup');
    return fx;
  }

  const packageValidation = validateCartPackageSnapshots(cart as any[]);
  if (!packageValidation.ok) {
    flushSync(() => {
      setValidationError('Package details could not be verified. Please remove and re-add the package or contact us.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    scrollToSection('cart');
    return fx;
  }

  if (pricingRulesLoading) {
    flushSync(() => {
      setValidationError('Loading pricing configuration. Please wait a moment and try again.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    return fx;
  }

  if (pricingRulesError || !pricingRules) {
    flushSync(() => {
      setValidationError('Unable to load pricing configuration. Please refresh the page or contact us for assistance.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    return fx;
  }

  if (priceBreakdown && pricingRules) {
    const parsedSettings = parseBookingDepositSettings(pricingRules);
    if (parsedSettings.status !== 'ready') {
      flushSync(() => {
        setValidationError(`Unable to calculate deposit: ${parsedSettings.error} Please contact us for assistance.`);
        setValidationErrorFieldId(null);
        setShowBottomToast(true);
      });
      return fx;
    }
    const preTotals = composeUnifiedQuoteTotals({
      inflatableBreakdown: priceBreakdown,
      cart,
      taxApplied: priceBreakdown.tax_applied ?? true,
      eeOnlyDepositSettings: parsedSettings.eventEssentialsDepositSettings,
      inflatableDepositPerUnitCents: parsedSettings.inflatableDepositPerUnitCents,
      setupMinimumCents: pricingRules.event_essentials_setup_minimum_cents ?? 15000,
    });
    if (preTotals.depositError) {
      flushSync(() => {
        setValidationError(`Unable to calculate deposit: ${preTotals.depositError}. Please contact us for assistance.`);
        setValidationErrorFieldId(null);
        setShowBottomToast(true);
      });
      return fx;
    }
  }

  const availabilityResult = i.recheck; // await checkAllCartAvailability(...) in the page

  if (availabilityResult.eventEssentialsCheckFailed) {
    flushSync(() => {
      setValidationError('Unable to check Event Essentials availability right now. Please try again.');
      setValidationErrorFieldId(null);
      setShowBottomToast(true);
    });
    scrollToSection('cart');
    return fx;
  }

  const stillUnavailable = availabilityResult.cart.filter((item: any) => item.isAvailable === false);
  if (stillUnavailable.length > 0) {
    const unavailableNames = stillUnavailable.map((item: any) => {
      if (item.item_type === 'event_essential_bundle') return item.bundle_name;
      if (item.item_type === 'event_essential_product') return item.product_name;
      return item.unit_name;
    }).join(', ');
    const errorMessage = `Sorry, the following items were just booked: ${unavailableNames}. Please choose different dates or remove these items.`;

    flushSync(() => {
      setValidationError(errorMessage);
      setValidationErrorFieldId(null);
      setShowBottomToast(true);

      if (debugMode) {
        setDebugInfo({
          timestamp: new Date().toISOString(),
          validationFailed: true,
          errorSection: 'cart',
          scrollAttempted: false,
          refFound: false,
          scrollTop: null,
          elementTop: null,
        });
      }
    });

    scrollToSection('cart');
    return fx;
  }

  fx.push(['saveFormData']);
  fx.push(['savePriceBreakdown']);
  fx.push(['trackEvent', 'cart_submitted']);
  fx.push(['navigate', '/checkout']);
  return fx;
}

// ---------------------------------------------------------------------------
// New path: gate + recheck evaluation + the page's thin failure applier (recording)
// ---------------------------------------------------------------------------
function applyGateFailure(fx: Effect[], failure: QuoteSubmitGateFailure, debugMode: boolean) {
  const flushSync = (fn: () => void) => fn();
  flushSync(() => {
    fx.push(['setValidationError', failure.message]);
    fx.push(['setValidationErrorFieldId', failure.fieldId]);
    fx.push(['setShowBottomToast', true]);
    if (debugMode && failure.debugSection !== undefined) {
      fx.push(['setDebugInfo', {
        timestamp: 'T', validationFailed: true, errorSection: failure.debugSection, scrollAttempted: false, refFound: false, scrollTop: null, elementTop: null,
      }]);
    }
  });
  if (failure.scroll?.kind === 'field') fx.push(['scrollToField', failure.scroll.id]);
  else if (failure.scroll?.kind === 'section') fx.push(['scrollToSection', failure.scroll.section]);
}

async function newHandleSubmit(i: OldInput): Promise<Effect[]> {
  const fx: Effect[] = [];
  const gate = evaluateQuoteSubmitGate(i);
  if (!gate.ok) { applyGateFailure(fx, gate, i.debugMode); return fx; }
  const recheck = evaluateAvailabilityRecheck(i.recheck);
  if (!recheck.ok) { applyGateFailure(fx, recheck, i.debugMode); return fx; }
  fx.push(['saveFormData']);
  fx.push(['savePriceBreakdown']);
  fx.push(['trackEvent', 'cart_submitted']);
  fx.push(['navigate', '/checkout']);
  return fx;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FORM: any = {
  event_date: '2026-07-04', event_end_date: '2026-07-04', start_window: '09:00', end_window: '11:00', until_end_of_day: false,
  address_line1: '1 Main St', address_line2: '', city: 'Tulsa', state: 'OK', zip: '74101', lat: 1, lng: 1, location_type: 'residential',
  pickup_preference: 'next_day', same_day_responsibility_accepted: false, overnight_responsibility_accepted: true, can_stake: true,
  has_generator: false, generator_qty: 0, has_pets: false, special_details: '',
};
const RULES: any = {
  deposit_per_unit_cents: 5000, ee_only_deposit_base_threshold_cents: 10000, ee_only_deposit_base_cents: 2500,
  ee_only_deposit_subtotal_step_cents: 5000, ee_only_deposit_step_cents: 1000, event_essentials_setup_minimum_cents: 15000,
};
const BREAKDOWN: any = {
  subtotal_cents: 20000, travel_fee_cents: 1500, surface_fee_cents: 0, same_day_pickup_fee_cents: 0, same_day_weekday_delivery_fee_cents: 0,
  generator_fee_cents: 0, tax_cents: 1290, total_cents: 22790, tax_applied: true,
};
const inflatable = (over: any = {}) => ({ unit_id: 'u1', unit_name: 'Castle', wet_or_dry: 'dry', unit_price_cents: 20000, qty: 1, ...over });
const bundleOk = { item_type: 'event_essential_bundle', bundle_id: 'b1', bundle_name: 'Pack', unit_price_cents: 9000, qty: 1, component_snapshot: { components: [{ product_id: 'p1', product_name: 'Tables', quantity_per_bundle: 2 }] }, pricing_context: 'standalone' };
const bundleBad = { item_type: 'event_essential_bundle', bundle_id: 'b1', bundle_name: 'Pack', unit_price_cents: 9000, qty: 0, component_snapshot: null, pricing_context: 'standalone' };
const product = (over: any = {}) => ({ item_type: 'event_essential_product', product_id: 'p1', product_name: 'Tables', unit_price_cents: 1500, qty: 2, pricing_context: 'standalone', ...over });

function base(over: Partial<OldInput> = {}): OldInput {
  return {
    cart: [inflatable()] as any, formData: { ...FORM }, dateChangeAvailabilityError: null,
    eventEssentialsRepricing: { validationPending: false, validationFailed: false, hasBlockingIssues: false },
    legacyConversionNeeded: false, pricingRulesLoading: false, pricingRulesError: null, pricingRules: { ...RULES }, priceBreakdown: { ...BREAKDOWN },
    debugMode: true, recheck: { cart: [inflatable()], eventEssentialsCheckFailed: false },
    ...over,
  };
}

async function compare(label: string, input: OldInput) {
  compared++;
  const [o, n] = await Promise.all([oracleHandleSubmit(JSON.parse(JSON.stringify({ ...input, cart: input.cart })) ), newHandleSubmit(JSON.parse(JSON.stringify(input)))]);
  ok(`${label}: identical ordered side effects (debug on)`, same(o, n));
  const off = { ...input, debugMode: false };
  const [o2, n2] = await Promise.all([oracleHandleSubmit(JSON.parse(JSON.stringify(off))), newHandleSubmit(JSON.parse(JSON.stringify(off)))]);
  ok(`${label}: identical ordered side effects (debug off)`, same(o2, n2));
  return n;
}

(async () => {
  // ---- success ----
  {
    const fx = await compare('success', base());
    eq('success: proceeds to save, track and navigate, nothing else', fx, [['saveFormData'], ['savePriceBreakdown'], ['trackEvent', 'cart_submitted'], ['navigate', '/checkout']]);
  }

  // ---- each failure family, pinned by hand ----
  const msgFx = (fx: Effect[]) => fx.filter((e) => e[0] === 'setValidationError' || e[0] === 'setValidationErrorFieldId' || e[0] === 'scrollToField' || e[0] === 'scrollToSection' || e[0] === 'setDebugInfo').map((e) => e[0] === 'setDebugInfo' ? ['setDebugInfo', e[1].errorSection] : e);
  const fam: Array<[string, Partial<OldInput>, Effect[]]> = [
    ['1 validateQuote: field error', { formData: { ...FORM, city: '' } }, [['setValidationError', 'Please enter a city for the event location.'], ['setValidationErrorFieldId', 'city-input'], ['setDebugInfo', 'address'], ['scrollToField', 'city-input']]],
    ['1 validateQuote: section-only error', { formData: { ...FORM, location_type: null } }, [['setValidationError', 'Please select an event type (Residential or Commercial).'], ['setValidationErrorFieldId', null], ['setDebugInfo', 'event'], ['scrollToSection', 'event']]],
    ['1 validateQuote: empty cart', { cart: [] }, [['setValidationError', 'Please add at least one item to your quote.'], ['setValidationErrorFieldId', null], ['setDebugInfo', 'cart'], ['scrollToSection', 'cart']]],
    ['2 date-change availability error', { dateChangeAvailabilityError: 'Items not available for the new dates.' }, [['setValidationError', 'Items not available for the new dates.'], ['setValidationErrorFieldId', null], ['scrollToSection', 'cart']]],
    ['3 EE repricing pending', { eventEssentialsRepricing: { validationPending: true, validationFailed: false, hasBlockingIssues: false } }, [['setValidationError', 'Please wait while your Event Essential items are being verified.'], ['setValidationErrorFieldId', null], ['scrollToSection', 'cart']]],
    ['4 EE repricing failed', { eventEssentialsRepricing: { validationPending: false, validationFailed: true, hasBlockingIssues: false } }, [['setValidationError', 'Unable to verify your Event Essential items. Please try again.'], ['setValidationErrorFieldId', null], ['scrollToSection', 'cart']]],
    ['5 EE blocking issues', { eventEssentialsRepricing: { validationPending: false, validationFailed: false, hasBlockingIssues: true } }, [['setValidationError', 'Please resolve the unavailable Event Essential items before continuing.'], ['setValidationErrorFieldId', null], ['scrollToSection', 'cart']]],
    ['6 generator legacy conversion', { legacyConversionNeeded: true }, [['setValidationError', 'Your saved Generator selection needs to be reviewed before continuing.'], ['setValidationErrorFieldId', null], ['scrollToSection', 'setup']]],
    ['7 package snapshot invalid', { cart: [inflatable(), bundleBad] as any }, [['setValidationError', 'Package details could not be verified. Please remove and re-add the package or contact us.'], ['setValidationErrorFieldId', null], ['scrollToSection', 'cart']]],
    ['8 pricing rules loading', { pricingRulesLoading: true }, [['setValidationError', 'Loading pricing configuration. Please wait a moment and try again.'], ['setValidationErrorFieldId', null]]],
    ['9a pricing rules error', { pricingRulesError: new Error('x') as any }, [['setValidationError', 'Unable to load pricing configuration. Please refresh the page or contact us for assistance.'], ['setValidationErrorFieldId', null]]],
    ['9b pricing rules missing', { pricingRules: null }, [['setValidationError', 'Unable to load pricing configuration. Please refresh the page or contact us for assistance.'], ['setValidationErrorFieldId', null]]],
    ['10a deposit settings invalid', { pricingRules: { ...RULES, deposit_per_unit_cents: 0 } }, [['setValidationError', 'Unable to calculate deposit: Invalid deposit configuration: deposit per unit must be a positive integer. Please contact us for assistance.'], ['setValidationErrorFieldId', null]]],
    ['10b deposit calculation error', { cart: [inflatable({ qty: 1.5 })] as any }, [['setValidationError', 'Unable to calculate deposit: Invalid inflatable quantity. Please contact us for assistance.'], ['setValidationErrorFieldId', null]]],
    ['11a recheck: EE check failed', { recheck: { cart: [inflatable()], eventEssentialsCheckFailed: true } }, [['setValidationError', 'Unable to check Event Essentials availability right now. Please try again.'], ['setValidationErrorFieldId', null], ['scrollToSection', 'cart']]],
    ['11b recheck: just booked (names by item type)', { recheck: { cart: [inflatable({ isAvailable: false }), { ...bundleOk, isAvailable: false }, product({ isAvailable: false }), inflatable({ unit_name: 'Slide', isAvailable: true })], eventEssentialsCheckFailed: false } }, [['setValidationError', 'Sorry, the following items were just booked: Castle, Pack, Tables. Please choose different dates or remove these items.'], ['setValidationErrorFieldId', null], ['setDebugInfo', 'cart'], ['scrollToSection', 'cart']]],
  ];
  for (const [label, over, expected] of fam) {
    const fx = await compare(label, base(over));
    eq(`${label}: pinned messages, field id, debug section and scroll`, msgFx(fx), expected);
    ok(`${label}: banner toast shown`, fx.some((e) => e[0] === 'setShowBottomToast' && e[1] === true));
    ok(`${label}: never proceeds`, !fx.some((e) => e[0] === 'navigate' || e[0] === 'saveFormData'));
  }

  // ---- debug asymmetry preserved: debugSection only for validateQuote and the final "just booked" failure ----
  for (const [label, over] of fam) {
    const gate = evaluateQuoteSubmitGate(base(over));
    const recheck = evaluateAvailabilityRecheck(base(over).recheck as any);
    const result = !gate.ok ? gate : recheck;
    const expectDebug = label.startsWith('1 ') || label === '11b recheck: just booked (names by item type)';
    ok(`${label}: debugSection ${expectDebug ? 'present' : 'absent'}`, !result.ok && (('debugSection' in result) === expectDebug));
  }

  // ---- precedence: every combination of the ten sync conditions (first match must win) ----
  {
    const conds: Array<(o: OldInput) => void> = [
      (o) => { o.formData = { ...FORM, city: '' }; },
      (o) => { o.dateChangeAvailabilityError = 'date change'; },
      (o) => { o.eventEssentialsRepricing = { ...o.eventEssentialsRepricing, validationPending: true }; },
      (o) => { o.eventEssentialsRepricing = { ...o.eventEssentialsRepricing, validationFailed: true }; },
      (o) => { o.eventEssentialsRepricing = { ...o.eventEssentialsRepricing, hasBlockingIssues: true }; },
      (o) => { o.legacyConversionNeeded = true; },
      (o) => { o.cart = [...o.cart, bundleBad] as any; },
      (o) => { o.pricingRulesLoading = true; },
      (o) => { o.pricingRules = null; },
      (o) => { o.pricingRules = o.pricingRules ? { ...RULES, ee_only_deposit_base_cents: -1 } : null; },
    ];
    for (let mask = 0; mask < (1 << conds.length); mask++) {
      const o = base();
      conds.forEach((c, k) => { if (mask & (1 << k)) c(o); });
      const fx = await compare(`precedence mask ${mask}`, o);
      if (mask === 0) continue;
      const firstBit = Array.from({ length: conds.length }, (_, k) => k).find((k) => mask & (1 << k)) as number;
      // The lowest set bit corresponds to the earliest check in the sequence (bit 9, the deposit settings, is last).
      const expectedMsg = ['Please enter a city for the event location.', 'date change', 'Please wait while your Event Essential items are being verified.', 'Unable to verify your Event Essential items. Please try again.', 'Please resolve the unavailable Event Essential items before continuing.', 'Your saved Generator selection needs to be reviewed before continuing.', 'Package details could not be verified. Please remove and re-add the package or contact us.', 'Loading pricing configuration. Please wait a moment and try again.', 'Unable to load pricing configuration. Please refresh the page or contact us for assistance.', 'Unable to calculate deposit: Invalid deposit configuration: base deposit must be a positive integer. Please contact us for assistance.'][firstBit];
      ok(`precedence mask ${mask}: earliest condition wins`, fx.find((e) => e[0] === 'setValidationError')?.[1] === expectedMsg);
    }
  }

  // ---- recheck variants combined with passing / failing sync gates ----
  {
    for (const eeFail of [false, true]) {
      for (const unavailable of [[], [inflatable({ isAvailable: false })], [product({ isAvailable: false }), { ...bundleOk, isAvailable: false }]]) {
        for (const syncFail of [false, true]) {
          await compare(`recheck eeFail=${eeFail} unavailable=${unavailable.length} syncFail=${syncFail}`, base({ formData: syncFail ? { ...FORM, zip: '' } : { ...FORM }, recheck: { cart: [inflatable(), ...unavailable] as any, eventEssentialsCheckFailed: eeFail } }));
        }
      }
    }
    const items = [inflatable({ isAvailable: undefined }), inflatable({ isAvailable: true }), inflatable({ isAvailable: false, unit_name: 'Only' })];
    const r = evaluateAvailabilityRecheck({ cart: items as any, eventEssentialsCheckFailed: false });
    ok('recheck: only items with isAvailable === false count', !r.ok && r.message.includes(': Only.'));
    ok('recheck: all available is ok', evaluateAvailabilityRecheck({ cart: [inflatable()] as any, eventEssentialsCheckFailed: false }).ok === true);
    const failedAndUnavailable = evaluateAvailabilityRecheck({ cart: [inflatable({ isAvailable: false })] as any, eventEssentialsCheckFailed: true });
    ok('recheck: a failed EE check wins over unavailable items and has no debug section', !failedAndUnavailable.ok && failedAndUnavailable.message.startsWith('Unable to check') && !('debugSection' in failedAndUnavailable));
  }

  // ---- seeded grid over form variants, carts and rules ----
  {
    let s = 20261007;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    for (let n = 0; n < 400; n++) {
      const form = { ...FORM, ...pick([{}, { city: '' }, { state: ' ' }, { zip: '' }, { location_type: null }, { pickup_preference: null }, { can_stake: null }, { event_date: '' }, { event_end_date: '' }, { start_window: '' }, { end_window: '' }, { overnight_responsibility_accepted: false }, { pickup_preference: 'same_day', same_day_responsibility_accepted: false }, { location_type: 'commercial', same_day_responsibility_accepted: false }]) };
      const cart = pick([[inflatable()], [], [inflatable({ isAvailable: false })], [product()], [product(), bundleOk], [inflatable(), bundleBad], [inflatable({ qty: 2.5 })], [product({ isAvailable: false }), bundleBad]]);
      await compare(`grid ${n}`, base({
        cart: cart as any, formData: form,
        dateChangeAvailabilityError: pick([null, null, 'date change']),
        eventEssentialsRepricing: { validationPending: rnd() < 0.15, validationFailed: rnd() < 0.15, hasBlockingIssues: rnd() < 0.15 },
        legacyConversionNeeded: rnd() < 0.15, pricingRulesLoading: rnd() < 0.1, pricingRulesError: pick([null, null, null, new Error('e')]) as any,
        pricingRules: pick([{ ...RULES }, { ...RULES }, null, { ...RULES, deposit_per_unit_cents: -5 }, { ...RULES, ee_only_deposit_step_cents: 0 }]) as any,
        priceBreakdown: pick([{ ...BREAKDOWN }, { ...BREAKDOWN, tax_applied: false }, null]) as any,
        recheck: { cart: pick([[inflatable()], [inflatable({ isAvailable: false })], [product({ isAvailable: false })], [{ ...bundleOk, isAvailable: false }]]) as any, eventEssentialsCheckFailed: rnd() < 0.15 },
      }));
    }
  }

  console.log(`Quote submit gate differential tests: ${passed} passed, ${failed} failed (${compared} compared scenarios)`);
  if (failed > 0) throw new Error(`${failed} quote submit gate test(s) failed`);
})();
