// WP-15 (B12): Event Essentials in the Admin/Crew order screens: surface choice, quantity limits, the invoice preview's pricing rules,
// the morning equipment checklist, and wording that depends on what is in the order.
// PASS - LOCAL AUTOMATED. E-09..E-15 and K-12 on Dev (including the printed/visible wording) are REQUIRES HOSTED DEV VERIFICATION.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { buildChecklist, deliveryCountLabel, type ChecklistTask } from '../../tasks/equipmentChecklist';
import { clampQuantity, maxQtyForKind, MAX_BUNDLE_QTY, MAX_INFLATABLE_QTY, MAX_PRODUCT_QTY, qtyKindOf, quantityLimitMessage } from '../../orders/quantityLimits';
import { hasActiveInflatable, surfaceChoiceProblem, surfaceControlState } from '../../orders/surfaceChoice';
import { generatorExplanation, onlyEventEssentials, overnightResponsibilityNoun, rentalTermsCopy } from '../../orders/equipmentCopy';
import { buildDropOffRulesMessage } from '../../../components/admin/tasks/detail/taskNotificationMessages';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
function eq(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) passed++;
  else {
    failed++;
    console.error(`FAIL ${label} (got ${g}, expected ${w})`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// --- surface -------------------------------------------------------------------------------------------------------------
eq('EE-only order: no surface control', surfaceControlState({ hasInflatables: false, surface: null, canStake: false }), 'hidden');
eq('EE-only order with a stale surface value: still hidden', surfaceControlState({ hasInflatables: false, surface: 'grass' }), 'hidden');
eq('first inflatable added to an EE-only order: the choice is asked, nothing preselected', surfaceControlState({ hasInflatables: true, surface: null, canStake: false }), 'choose');
eq('grass order', surfaceControlState({ hasInflatables: true, surface: 'grass' }), 'grass');
eq('sandbag order', surfaceControlState({ hasInflatables: true, surface: 'cement' }), 'cement');
eq('a screen that tracks can_stake only (invoice builders) behaves as before', [surfaceControlState({ hasInflatables: true, surface: undefined, canStake: true }), surfaceControlState({ hasInflatables: true, surface: undefined, canStake: false })], ['grass', 'cement']);
eq('saving with an inflatable and no surface is refused with a message', surfaceChoiceProblem({ hasInflatables: true, surface: null })?.includes('Choose the setup surface'), true);
eq('saving with a chosen surface is fine', [surfaceChoiceProblem({ hasInflatables: true, surface: 'grass' }), surfaceChoiceProblem({ hasInflatables: true, surface: 'cement' })], [null, null]);
eq('saving an EE-only order needs no surface', surfaceChoiceProblem({ hasInflatables: false, surface: null }), null);
eq('screens that do not track a surface are not blocked', surfaceChoiceProblem({ hasInflatables: true, surface: undefined }), null);
eq('a removed inflatable does not count; an EE line does not count', [hasActiveInflatable([{ unit_id: 'u', is_deleted: true }, { unit_id: null }]), hasActiveInflatable([{ unit_id: 'u' }])], [false, true]);
const editor = read('src/components/order-detail/EventDetailsEditor.tsx');
ok('editor: both layouts hide the control for EE-only and highlight from the real surface (not can_stake)', (editor.match(/surfaceState === 'hidden'/g) ?? []).length === 2 && (editor.match(/grassSelected/g) ?? []).length >= 3 && !/editedOrder\.can_stake\n\s+\?/.test(editor));
ok('editor: the sandbag fee note shows only when sandbags are chosen', (editor.match(/cementSelected && \(/g) ?? []).length === 2 && !/!editedOrder\.can_stake && \(/.test(editor));
ok('order details tab and invoice builder tell the editor whether there is an inflatable', /hasInflatables=\{hasActiveInflatable\(stagedItems\)\}/.test(read('src/components/order-detail/OrderDetailsTab.tsx')) && /hasInflatables=\{cartItems\.length > 0\}/.test(read('src/components/admin/invoices/InvoiceBuilder.tsx')));
const save = read('src/lib/orders/staffOrderSaveRequest.ts');
ok('save: the surface choice is checked before anything else and stops the save', save.indexOf('surfaceChoiceProblem(') > 0 && save.indexOf('surfaceChoiceProblem(') < save.indexOf('availabilityIssues.length > 0'));

// --- quantity limits (client = server) ----------------------------------------------------------------------------------------
eq('limits', [MAX_INFLATABLE_QTY, MAX_BUNDLE_QTY, MAX_PRODUCT_QTY], [50, 99, 500]);
const booking = read('supabase/functions/_shared/booking/bookingInput.ts');
const staff = read('supabase/functions/_shared/orders/staff-order-save.ts');
ok('the customer booking limits are the same numbers', /MAX_INFLATABLE_QTY = 50;/.test(booking) && /MAX_BUNDLE_QTY = 99;/.test(booking) && /MAX_PRODUCT_QTY = 500;/.test(booking));
ok('the staff save uses the same per-kind limits (no single 99 for everything)', /const MAX_INFLATABLE_QTY = 50;/.test(staff) && /const MAX_BUNDLE_QTY = 99;/.test(staff) && /const MAX_PRODUCT_QTY = 500;/.test(staff) && !/MAX_QTY\b/.test(staff) && /it\.kind === "inflatable" \? MAX_INFLATABLE_QTY : it\.kind === "bundle" \? MAX_BUNDLE_QTY : MAX_PRODUCT_QTY/.test(staff));
eq('kind of a line', [qtyKindOf({ unit_id: 'u' }), qtyKindOf({ bundle_id: 'b' }), qtyKindOf({ product_id: 'p' }), qtyKindOf({})], ['inflatable', 'bundle', 'product', 'product']);
eq('max by kind', [maxQtyForKind('inflatable'), maxQtyForKind('bundle'), maxQtyForKind('product')], [50, 99, 500]);
eq('clamp: over the limit is cut with a flag; inside is kept; junk becomes 1', [clampQuantity(600, 500), clampQuantity(12, 500), clampQuantity(0, 500), clampQuantity(NaN, 500), clampQuantity(7.9, 500)], [{ qty: 500, clamped: true }, { qty: 12, clamped: false }, { qty: 1, clamped: false }, { qty: 1, clamped: false }, { qty: 7, clamped: false }]);
ok('the message names the limit', /500/.test(quantityLimitMessage('product', 500)) && /99/.test(quantityLimitMessage('bundle', 99)));
const items = read('src/components/shared/ItemsEditor.tsx');
ok('items editor: the + button stops at the limit and typed values are clamped with a message', /disabled=\{item\.qty >= maxQtyForKind\(qtyKindOf\(item\)\)\}/.test(items) && (items.match(/clampQuantity\(n, limit\)/g) ?? []).length === 2 && (items.match(/showToast\(quantityLimitMessage\(kind, limit\)/g) ?? []).length === 2);
const addEe = read('src/components/order-detail/AddEventEssentialsSection.tsx');
ok('add-EE picker: quantities above the limit are cut and explained', /qty > MAX_PRODUCT_QTY/.test(addEe) && /qty > MAX_BUNDLE_QTY/.test(addEe) && /clampQuantity\(qty, MAX_PRODUCT_QTY\)/.test(addEe));

// --- invoice preview pricing rules ----------------------------------------------------------------------------------------------
const invData = read('src/hooks/invoices/useInvoiceData.ts');
ok('invoice preview mapper carries the setup minimum and the same-day days (it dropped both)', /event_essentials_setup_minimum_cents: r\.event_essentials_setup_minimum_cents/.test(invData) && /same_day_delivery_fee_days: r\.same_day_delivery_fee_days/.test(invData));

// --- checklist ----------------------------------------------------------------------------------------------------------------
const inflatable = (name: string, mode: 'Dry' | 'Water') => `${name} (${mode})`;
const dropEE: ChecklistTask = { type: 'drop-off', items: ['Folding Chair ×20'], surface: 'grass', numInflatables: 0, rawEquipmentItems: [{ kind: 'event_essential', name: 'Folding Chair', qty: 20 } as any] };
const dropBounce: ChecklistTask = { type: 'drop-off', items: [inflatable('Mega Castle', 'Water')], surface: 'grass', numInflatables: 1, rawEquipmentItems: [{ kind: 'inflatable', name: 'Mega Castle', wetOrDry: 'Water', qty: 1 } as any] };
const dropCement: ChecklistTask = { type: 'drop-off', items: [inflatable('Slide', 'Dry'), inflatable('Castle', 'Dry')], surface: 'cement', numInflatables: 2 };
const pickupNext: ChecklistTask = { type: 'pick-up', items: [inflatable('Old Order Castle', 'Dry')], surface: 'grass', numInflatables: 3 };
const c = buildChecklist([dropBounce, dropEE, dropCement, pickupNext]);
eq('only deliveries are counted (the next-day pickup is not)', c.deliveryCount, 3);
eq('bounce houses come from deliveries only', c.bounceHouses.map((b) => b.name), ['Mega Castle', 'Slide', 'Castle']);
eq('stakes are counted for grass inflatables only; the EE-only grass order adds none', c.stakeUnits, 1);
eq('sandbags are counted for cement inflatables', c.sandbagUnits, 2);
eq('Event Essentials are listed', c.eventEssentials.map((e) => e.name), ['Folding Chair']);
eq('an EE-only day shows no stakes or sandbags at all', [buildChecklist([dropEE]).stakeUnits, buildChecklist([dropEE]).sandbagUnits], [0, 0]);
eq('plural wording: 0, 1, 2', [deliveryCountLabel(0), deliveryCountLabel(1), deliveryCountLabel(2)], ['0 deliveries', '1 delivery', '2 deliveries']);
const modal = read('src/components/calendar/EquipmentChecklistModal.tsx');
ok('checklist screen uses the pure summary and no longer builds "deliveryies"', /buildChecklist\(tasks as any\)/.test(modal) && /deliveryCountLabel\(equipment\.deliveryCount\)/.test(modal) && !/'ies'/.test(modal) && /equipment\.stakeUnits > 0/.test(modal) && /equipment\.sandbagUnits > 0/.test(modal));

// --- wording ------------------------------------------------------------------------------------------------------------------------
const fullRules = buildDropOffRulesMessage({ pickupPreference: 'next_day' });
ok('delivery rules text for an order with inflatables (or unknown) is exactly as before', /NO SHOES on the inflatable/.test(fullRules) && /NO HANGING OR CLIMBING ON THE NETS/.test(fullRules) && buildDropOffRulesMessage({ pickupPreference: 'next_day', numInflatables: 2 }) === fullRules);
const eeRules = buildDropOffRulesMessage({ pickupPreference: 'next_day', numInflatables: 0 });
ok('delivery rules text for an EE-only order has no inflatable rules but keeps the responsibility and pickup time', !/inflatable|NETS|SHOES/i.test(eeRules) && /responsible for the equipment until tomorrow morning/.test(eeRules));
ok('same-day pickup time still appears in the EE-only text', /this evening \(6 PM\)/.test(buildDropOffRulesMessage({ pickupPreference: 'same_day', eventEndTime: '6 PM', numInflatables: 0 })));
ok('the task screen passes the inflatable count to the rules text', /buildDropOffRulesMessage\(\{ pickupPreference: task\.pickupPreference, eventEndTime: task\.eventEndTime, numInflatables: task\.numInflatables \}\)/.test(read('src/components/admin/tasks/TaskDetailModal.tsx')));
eq('onlyEventEssentials', [onlyEventEssentials([{ unit_id: null }, { unit_id: null }]), onlyEventEssentials([{ unit_id: 'u' }, { unit_id: null }]), onlyEventEssentials([])], [true, false, false]);
eq('overnight noun: equipment for EE-only, inflatable otherwise', [overnightResponsibilityNoun([{ unit_id: null }]), overnightResponsibilityNoun([{ unit_id: 'u' }]), overnightResponsibilityNoun([{ unit_id: 'u' }, {}])], ['equipment', 'inflatable', 'inflatable']);
ok('rental terms: an inflatable order keeps its deposit sentence word for word', rentalTermsCopy(true).depositSentence('$50.00') === 'This booking requires a minimum $50.00 deposit per inflatable to reserve your event date with Bounce Party Club. The remaining balance is due on or before the day of your event. You may choose to pay the full amount at booking.' && /receive the inflatable/.test(rentalTermsCopy(true).receiveLine) && !!rentalTermsCopy(true).duringPickupLine);
ok('rental terms: an EE-only order has no per-inflatable deposit, no inflatable receipt line, no plugged-in line', !/inflatable/i.test(rentalTermsCopy(false).depositSentence('$50.00')) && !/inflatable/i.test(rentalTermsCopy(false).receiveLine) && rentalTermsCopy(false).duringPickupLine === null);
ok('generator text: inflatable blower wording only when there is an inflatable', /inflatable blower/.test(generatorExplanation(true)) && !/inflatable|blower/i.test(generatorExplanation(false)));
ok('the screens pass the order shape: invoice view, checkout, quote setup', /hasInflatables=\{!onlyEventEssentials\(orderItems\)\}/.test(read('src/components/shared/SimpleInvoiceDisplay.tsx')) && /<RentalTerms hasInflatables=\{hasInflatables\} \/>/.test(read('src/pages/Checkout.tsx')) && /hasInflatables=\{inflatableCart\.length > 0 \|\| cart\.length === 0\}/.test(read('src/pages/Quote.tsx')) && /overnightResponsibilityNoun\(orderItems \?\? \[\]\)/.test(read('src/components/customer-portal/InvoiceAcceptanceView.tsx')));
const setup = read('src/components/quote/SetupDetailsSection.tsx');
ok('quote setup: the stakes question is skipped for an EE-only cart', /\{hasInflatables && \(\n\s+<div className="mb-6">/.test(setup) && /generatorExplanation\(hasInflatables\)/.test(setup));

console.log(`eeOrderManagement: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} Event Essentials order management test(s) failed`);
