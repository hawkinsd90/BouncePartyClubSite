// WP-25 (B17): Admin and Crew screens that matter in daily use on a phone - what a task card says, photo loading that can fail and be retried,
// reasons asked inside the app, file pickers that stay mounted, and settings forms that must not save over what they failed to load.
// PASS - LOCAL AUTOMATED. 320/360/390 passes, the camera/file pickers on iOS and Android, and the two-device checks are REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync } from 'node:fs';
import { balanceDueLabel, equipmentSummary, eventTimeRange, statusLabel } from '../../tasks/taskCardFormat';
import { buttonLabel, workingLabel } from '../../tasks/taskProgress';
import { invoiceBlockedReason } from '../../payments/invoiceReadiness';
import { filterCustomers } from '../../core/customerSearch';

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

// --- task card text ----------------------------------------------------------------------------------------------------------
eq('three or fewer equipment lines: all shown, nothing "more"', equipmentSummary(['a', 'b', 'c']), { shown: ['a', 'b', 'c'], more: 0 });
eq('more than three: the first three and a count of the rest (they used to vanish)', equipmentSummary(['a', 'b', 'c', 'd', 'e']), { shown: ['a', 'b', 'c'], more: 2 });
eq('no equipment', equipmentSummary([]), { shown: [], more: 0 });
eq('balance keeps the cents', [balanceDueLabel(2450), balanceDueLabel(2500), balanceDueLabel(5), balanceDueLabel(0)], ['$24.50 DUE', '$25.00 DUE', '$0.05 DUE', '$0.00 DUE']);
eq('a negative balance never prints a minus', balanceDueLabel(-100), '$0.00 DUE');
eq('status words are readable', [statusLabel('en_route'), statusLabel('arrived'), statusLabel('completed'), statusLabel(undefined), statusLabel(null)], ['EN ROUTE', 'ARRIVED', 'COMPLETED', 'PENDING', 'PENDING']);
eq('times read as 12-hour times', eventTimeRange('10:00', '14:30'), '10:00 AM - 2:30 PM');
eq('missing or TBD times read TBD, never a blank or "undefined"', [eventTimeRange('TBD', 'TBD'), eventTimeRange(null, '14:00'), eventTimeRange('', undefined), eventTimeRange('soon', '10:00')], ['TBD - TBD', 'TBD - 2:00 PM', 'TBD - TBD', 'TBD - 10:00 AM']);
const card = read('src/components/calendar/TaskCard.tsx');
ok('the task card uses these rules', /statusLabel\(task\.taskStatus\?\.status\)/.test(card) && /balanceDueLabel\(task\.balanceDue\)/.test(card) && /eventTimeRange\(task\.eventStartTime, task\.eventEndTime\)/.test(card) && /equipmentSummary\(task\.items\)\.more > 0/.test(card) && !/toFixed\(0\)/.test(card) && !/items\.slice\(0, 3\)/.test(card));
const day = read('src/components/calendar/DayViewModal.tsx');
ok('the day view mileage row wraps instead of overflowing', /flex flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-white rounded-lg/.test(day) && /flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-600/.test(day) && !/shrink-0">\n\s+\{log\.start_mileage/.test(day));

// --- photos: a failed lookup is shown and can be retried ---------------------------------------------------------------------------
const api = read('src/lib/tasks/taskEvidenceApi.ts');
ok('the evidence lookup reports a failure (offline, server error, bad answer) instead of hiding it', /fetchTaskEvidenceViewsChecked/.test(api) && (api.match(/failed = true;/g) ?? []).length === 2 && /return \{ views: out, failed \};/.test(api));
ok('the old function still exists for other callers', /export async function fetchTaskEvidenceViews\(/.test(api) && /\(await fetchTaskEvidenceViewsChecked\(taskStatusIds\)\)\.views/.test(api));
const hook = read('src/hooks/admin/useTaskEvidenceUrls.ts');
ok('the hook has loading / ready / error states and a retry that refetches', /status: 'idle' \| 'loading' \| 'ready' \| 'error'/.test(hook) && /status: failed \|\| !entry \? 'error' : 'ready'/.test(hook) && /setAttempt\(\(n\) => n \+ 1\)/.test(hook) && /\|\$\{attempt\}`/.test(hook));
const grid = read('src/components/admin/tasks/detail/TaskDetailPhotosGrid.tsx');
ok('the photo grid says when photos could not load and offers Try again; missing tiles read "Photo unavailable"', /urls\.status === 'error'/.test(grid) && /The photos could not be loaded\./.test(grid) && /onClick=\{urls\.retry\}/.test(grid) && /Photo unavailable/.test(grid) && /loading="lazy"/.test(grid));

// --- the task screen -------------------------------------------------------------------------------------------------------------
const modal = read('src/components/admin/tasks/TaskDetailModal.tsx');
ok('no window.prompt: the paper-waiver reason is asked in a dialog', !/window\.prompt/.test(modal) && /<ReasonModal/.test(modal) && /new Promise<string \| null>\(\(resolve\) => setPaperWaiverAsk/.test(modal));
ok('the paper waiver still requires a non-empty reason', /if \(!overrideReason \|\| !overrideReason\.trim\(\)\) return;/.test(modal));
ok('file pickers are mounted in the page, not created on the fly', !/document\.createElement\('input'\)/.test(modal) && /ref=\{photoInputRef\}/.test(modal) && /ref=\{waiverInputRef\}/.test(modal) && /photoInputRef\.current\?\.click\(\)/.test(modal) && /waiverInputRef\.current\?\.click\(\)/.test(modal));
ok('a picker is reset after use so the same file can be chosen again', (modal.match(/e\.target\.value = '';/g) ?? []).length === 2);
const reason = read('src/components/admin/tasks/detail/ReasonModal.tsx');
ok('the reason dialog validates, scrolls on small screens and uses 48px buttons', /minLength/.test(reason) && /MODAL_PANEL_SCROLL/.test(reason) && (reason.match(/min-h-\[48px\]/g) ?? []).length === 2);

// --- settings forms ----------------------------------------------------------------------------------------------------------------
const brand = read('src/components/admin/settings/BusinessBrandingTab.tsx');
ok('Business Branding cannot save over settings it failed to load', /const \[loadFailed, setLoadFailed\] = useState\(false\)/.test(brand) && /setLoadFailed\(true\);\n\s+showToast\('Error loading business settings/.test(brand) && /if \(loadFailed\) \{\n\s+showToast\([^\n]+\n\s+return;/.test(brand) && /disabled=\{saving \|\| loadFailed\}/.test(brand));
ok('...and says so, with a way to try again', /The saved settings could not be loaded\./.test(brand) && /Saving is turned off/.test(brand) && /void loadSettings\(\)/.test(brand));

// =============================================================================================================================
// WP-25 completion pass: the rest of the admin / crew phone screens (calendar, task screen, orders, pending order, catalog admin,
// forms that must not save over what failed to load). PASS - LOCAL AUTOMATED. 320/360/390 passes and real taps are REQUIRES HOSTED DEV VERIFICATION.
// =============================================================================================================================

// --- task progress (pure) -----------------------------------------------------------------------------------------------------------
eq('working label names the running action', [workingLabel('en_route', false), workingLabel('arrived', false), workingLabel('drop_off', false), workingLabel('pickup', false)], ['Sending En Route notice...', 'Sending Arrived notice...', 'Completing delivery...', 'Completing pickup...']);
eq('working label: uploads show only when no action runs; nothing otherwise', [workingLabel(null, true), workingLabel(null, false), workingLabel('arrived', true)], ['Uploading photos...', null, 'Sending Arrived notice...']);
eq('button label swaps only for the active button', [buttonLabel('En Route', 'Working...', true), buttonLabel('En Route', 'Working...', false)], ['Working...', 'En Route']);
const bar = read('src/components/admin/tasks/detail/TaskDetailMobileActionBar.tsx');
const actions = read('src/components/admin/tasks/detail/TaskDetailActions.tsx');
ok('both action sets show a status line and busy button text', /workingLabel\(busyAction, uploadingImages\)/.test(bar) && /workingLabel\(busyAction, uploadingImages\)/.test(actions) && /role="status"/.test(bar) && /role="status"/.test(actions) && (bar.match(/buttonLabel\(/g) ?? []).length === 5 && (actions.match(/buttonLabel\(/g) ?? []).length === 4);
ok('the modal records which action is running and clears it in every finally', (modal.match(/setBusyAction\('(en_route|arrived|drop_off|pickup)'\)/g) ?? []).length === 4 && (modal.match(/finally \{ setProcessing\(false\); setBusyAction\(null\); \}/g) ?? []).length === 4);
ok('the header and the phone action bar share ONE sticky block (the bar no longer guesses the header height with top-[60px])', !/top-\[60px\]/.test(bar) && /sticky top-0 z-10 flex-shrink-0 bg-white/.test(modal) && !/sticky/.test(read('src/components/admin/tasks/detail/TaskDetailHeader.tsx')));
ok('reordering is a toast (not a blocking alert) and cannot be double-tapped', /showToast\(`Task moved \$\{direction\}`, 'success'/.test(modal) && /showToast\('Failed to reorder: '/.test(modal) && !/showAlert\(`Task moved/.test(modal) && /if \(reordering\) return;/.test(modal) && /canMoveUp=\{canMoveUp && !reordering\}/.test(modal));

// --- calendar ------------------------------------------------------------------------------------------------------------------------
const calHeader = read('src/components/calendar/CalendarHeader.tsx');
ok('calendar header wraps on a narrow phone and has labelled 44px buttons', /flex flex-wrap items-center gap-2 sm:gap-4/.test(calHeader) && /aria-label="Previous month"/.test(calHeader) && /aria-label="Next month"/.test(calHeader) && !/min-w-\[160px\]/.test(calHeader) && (calHeader.match(/min-h-\[44px\]/g) ?? []).length === 3);
const calGrid = read('src/components/calendar/CalendarGrid.tsx');
ok('calendar day cells are keyboard / screen-reader operable and clip nothing', /role=\{dayTasks\.length > 0 \? 'button' : undefined\}/.test(calGrid) && /onKeyDown=/.test(calGrid) && /aria-label=\{dayTasks\.length > 0/.test(calGrid) && /min-w-0 overflow-hidden/.test(calGrid));
ok('day view: one scroll (dvh), 44px controls, wrapping mileage and route buttons', /max-h-\[90dvh\] overflow-y-auto overscroll-contain/.test(day) && /aria-label="Close day view"/.test(day) && /flex flex-wrap gap-2/.test(day) && /flex flex-row flex-wrap gap-2/.test(day) && !/max-h-\[90vh\]/.test(day));

// --- orders list ----------------------------------------------------------------------------------------------------------------------
const orders = read('src/components/admin/orders/OrdersManager.tsx');
const cards = read('src/components/admin/orders/OrderListCards.tsx');
ok('orders list: cards below md, the 1000px table only from md', /<OrderListCards/.test(orders) && /hidden md:block bg-white rounded-lg shadow overflow-x-auto/.test(orders) && /md:hidden/.test(cards));
ok('order cards open the order and keep the phone as its own control', /onClick=\{\(\) => onOpen\(order\.id\)\}/.test(cards) && /<PhoneLink phone=/.test(cards) && /min-h-\[44px\]/.test(cards));
ok('status pills scroll the chosen one into view', /tabStripRef/.test(orders) && /scrollIntoView\?\.\(\{ inline: 'center', block: 'nearest' \}\)/.test(orders) && /data-tab-key=\{tab\.key\}/.test(orders) && /flex-shrink-0/.test(orders));
ok('order search rows wrap and use phone-sized controls', /flex flex-col sm:flex-row gap-3 max-w-xl/.test(orders) && /aria-label="Search orders"/.test(orders) && /flex flex-wrap items-center justify-between gap-3 mb-4/.test(orders));

// --- single order / pending card -----------------------------------------------------------------------------------------------------
const single = read('src/components/admin/orders/SingleOrderView.tsx');
ok('single order: a refresh keeps the screen and open dialogs (only the first load shows the spinner) and errors show as a banner', /if \(loading && !order\) \{/.test(single) && /if \(!order\) \{/.test(single) && /The order could not be refreshed/.test(single) && !/if \(error \|\| !order\)/.test(single));
ok('single order: wrapping UUID chip with a 44px copy button; clipboard fallback copies the link just made', /select-all break-all min-w-0/.test(single) && /aria-label="Copy order UUID"/.test(single) && /let url = shortUrl;\n\s+try \{/.test(single) && /el\.value = url;/.test(single));
const pending = read('src/components/admin/orders/PendingOrderCard.tsx');
ok('pending card: reloads the SMS thread when the admin returns (the table is not published for realtime) and uses toasts for small confirmations', /useRefetchOnReturn\(loadSmsConversations, 45000\)/.test(pending) && /showToast\('SMS sent\.'/.test(pending) && /showToast\('Payment link copied to clipboard\.'/.test(pending) && !/alert\('SMS sent successfully!'\)/.test(pending) && !/alert\('Payment link copied/.test(pending));
ok('pending card action buttons stack on very narrow screens and are 48px', /flex flex-col min-\[400px\]:flex-row gap-3/.test(pending) && (pending.match(/min-h-\[48px\]/g) ?? []).length >= 4);
const refetchHook = read('src/hooks/core/useRefetchOnReturn.ts');
ok('refetch hook: visibility, focus and online, optional interval, never while hidden, always cleaned up', /visibilitychange/.test(refetchHook) && /'focus'/.test(refetchHook) && /'online'/.test(refetchHook) && /visibilityState === 'hidden'/.test(refetchHook) && /clearInterval/.test(refetchHook) && (refetchHook.match(/removeEventListener/g) ?? []).length === 3);
const sms = read('src/components/pending-order/SmsConversation.tsx');
ok('SMS thread: opens on the newest message, taller scroll box, toast instead of alert, 44px reply buttons, 16px reply text', /el\.scrollTop = el\.scrollHeight/.test(sms) && /max-h-60 overflow-y-auto overscroll-contain/.test(sms) && /showToast\('SMS sent\.'/.test(sms) && !/alert\('SMS sent/.test(sms) && /text-base sm:text-sm/.test(sms) && (sms.match(/min-h-\[44px\]/g) ?? []).length >= 3);
const payLink = read('src/components/pending-order/PaymentLinkSection.tsx');
ok('payment link: stacks on a phone, selectable link, 44px buttons', /flex flex-col sm:flex-row gap-2 mb-2/.test(payLink) && /onFocus=\{\(e\) => e\.currentTarget\.select\(\)\}/.test(payLink) && (payLink.match(/min-h-\[44px\]/g) ?? []).length === 3);
const orderInfo = read('src/components/pending-order/OrderInfoSection.tsx');
ok('order info: the four-up facts grid is two-up on a phone; Edit is 44px', /grid-cols-2 sm:grid-cols-4/.test(orderInfo) && !/grid grid-cols-4 gap-4/.test(orderInfo) && /min-h-\[44px\] bg-blue-600/.test(orderInfo));
const detailHeader = read('src/components/admin/orders/detail-modal/OrderDetailHeader.tsx');
ok('order detail header wraps; Save says why it is off; labels do not collapse to "..."', /flex flex-wrap items-center justify-between gap-x-3 gap-y-2/.test(detailHeader) && /saveBlockedReason\(/.test(detailHeader) && /Waiting for the price to finish calculating/.test(detailHeader) && !/'\.\.\.'/.test(detailHeader) && /aria-label="Close order"/.test(detailHeader));
const detailModal = read('src/components/admin/orders/OrderDetailModal.tsx');
ok('order detail modal scrolls once on a phone (the inner scroll box exists from md only)', /md:max-h-\[calc\(100dvh-300px\)\] md:overflow-y-auto/.test(detailModal) && !/max-h-\[calc\(100vh-200px\)\]/.test(detailModal));
const floating = read('src/components/admin/orders/AdminFloatingOrderHeader.tsx');
ok('floating order header wraps its facts and has a 44px Edit', /gap-x-4 gap-y-2/.test(floating) && /min-h-\[44px\]/.test(floating) && /justify-end gap-2 sm:gap-3/.test(floating));

// --- catalog admin ---------------------------------------------------------------------------------------------------------------------
const eeAdmin = read('src/components/admin/catalog/event-essentials/EventEssentialsAdmin.tsx');
ok('Event Essentials admin: the three-tab strip fits (full width, scrolls if needed, 44px tabs); Packages is not clipped', /w-full sm:w-fit overflow-x-auto/.test(eeAdmin) && (eeAdmin.match(/role="tab"/g) ?? []).length === 3 && (eeAdmin.match(/min-h-\[44px\]/g) ?? []).length === 3 && !/w-fit"/.test(eeAdmin));
const menuGroups = read('src/components/admin/catalog/menu-groups/MenuGroupList.tsx');
ok('menu group rows stack on a phone with 44px, labelled actions', /flex flex-col sm:flex-row sm:items-start sm:justify-between/.test(menuGroups) && (menuGroups.match(/w-11 h-11 sm:w-8 sm:h-8/g) ?? []).length === 4 && (menuGroups.match(/aria-label=\{`(Move|Edit|Delete) \$\{group\.title\}/g) ?? []).length >= 3);
const products = read('src/components/admin/catalog/event-essentials/ProductManager.tsx');
ok('product cards wrap badges and actions (44px)', /flex flex-wrap items-center gap-2 mb-3/.test(products) && /flex flex-wrap items-center gap-2">\n\s+<button\n\s+onClick=\{\(\) => handleEditProduct/.test(products) && (products.match(/min-h-\[44px\] text-xs/g) ?? []).length === 3);
const categories = read('src/components/admin/catalog/event-essentials/CategoryManager.tsx');
ok('category mobile cards wrap badges and use 44px actions', /flex flex-wrap items-center gap-2 mb-3/.test(categories) && (categories.match(/min-h-\[44px\] text-xs/g) ?? []).length >= 5);
const filterBar = read('src/components/admin/content/photos/PhotoFilterBar.tsx');
ok('photo filter bar: chips get their own row on a phone, 16px search text, 44px controls', /flex flex-wrap items-center gap-2/.test(filterBar) && /basis-full sm:basis-0 sm:flex-1 min-w-0/.test(filterBar) && /text-base sm:text-sm text-slate-900/.test(filterBar) && (filterBar.match(/min-h-\[44px\]/g) ?? []).length >= 4);
const photoModal = read('src/components/admin/content/photos/PhotoDetailModal.tsx');
ok('photo viewer: the details panel scrolls on its own so the photo is never squeezed out; 44px close', /max-h-\[50dvh\] overflow-y-auto overscroll-contain/.test(photoModal) && /min-h-\[30dvh\]/.test(photoModal) && /w-11 h-11/.test(photoModal));
const unitForm = read('src/pages/UnitForm.tsx');
ok('unit form: a failed load shows an error and Try again and NEVER the empty form (saving it would overwrite the unit)', /const \[loadError, setLoadError\]/.test(unitForm) && /unitRes\.error \|\| mediaRes\.error \|\| !unitRes\.data/.test(unitForm) && /isEdit && \(loadingUnit \|\| loadError\)/.test(unitForm) && /empty form cannot replace the saved unit/.test(unitForm) && /<\/form>\n\s+<\/div>\n\s+<\/>\)\}/.test(unitForm));
ok('unit form: the Indoor / Outdoor / Active row wraps', /flex flex-wrap gap-x-4 gap-y-1/.test(unitForm));

// --- invoices, customers, crew ----------------------------------------------------------------------------------------------------------
eq('invoice blocked reasons', [
  invoiceBlockedReason({ saving: false, hasNoActiveItems: true }),
  invoiceBlockedReason({ saving: false, hasNoActiveItems: false, checkingAvailability: true }),
  invoiceBlockedReason({ saving: false, hasNoActiveItems: false, hasAvailabilityIssues: true }),
  invoiceBlockedReason({ saving: false, hasNoActiveItems: false, generatorResolutionPending: true }),
  invoiceBlockedReason({ saving: false, hasNoActiveItems: false, pricingIsCurrent: false }),
  invoiceBlockedReason({ saving: false, hasNoActiveItems: false, pricingIsCurrent: true }),
  invoiceBlockedReason({ saving: true, hasNoActiveItems: true }),
], ['Add at least one item to turn on this button.', 'Checking availability...', 'Some items are not available for these dates. Fix the availability notice above.', 'Answer the generator question above first.', 'The price is still calculating. It will turn on in a moment.', null, null]);
const actionsBar = read('src/components/admin/invoices/builder/InvoiceActions.tsx');
ok('invoice actions: the reason is shown and tied to the button', /invoiceBlockedReason\(\{ saving, hasNoActiveItems, hasAvailabilityIssues, generatorResolutionPending, checkingAvailability, pricingIsCurrent \}\)/.test(actionsBar) && /aria-describedby=\{blockedReason \? 'invoice-blocked-reason' : undefined\}/.test(actionsBar) && /id="invoice-blocked-reason"/.test(actionsBar));
const success = read('src/components/invoice/InvoiceSuccessMessage.tsx');
ok('invoice success banner scrolls into view, announces itself and survives a refused clipboard', /scrollIntoView\?\.\(\{ behavior: 'smooth', block: 'start' \}\)/.test(success) && /role="status"/.test(success) && /await navigator\.clipboard\.writeText\(invoiceUrl\)/.test(success) && /inputRef\.current\?\.select\(\)/.test(success));
for (const f of ['src/components/admin/invoices/InvoiceBuilder.tsx', 'src/components/crew/CrewInvoiceBuilder.tsx']) {
  const src = read(f);
  ok(f + ': no crash after a successful send when the customer row is not loaded; outside-tap uses pointer events', /customer\?\.email \?\? 'the customer'/.test(src) && !/\$\{customer\.email\}/.test(src) && /addEventListener\('pointerdown'/.test(src) && !/'mousedown'/.test(src));
}
const crewInvoice = read('src/components/crew/CrewInvoiceBuilder.tsx');
ok('crew invoice builder says why the button is off', /invoiceBlockedReason\(\{ saving, hasNoActiveItems: cartItems\.length === 0 \}\)/.test(crewInvoice));
const crewPage = read('src/pages/Crew.tsx');
ok('Crew tabs stay mounted once opened (a half-written invoice and the open day view survive a tab switch)', /hidden=\{activeTab !== 'calendar'\}/.test(crewPage) && /invoiceOpened && <div hidden=\{activeTab !== 'invoice'\}>/.test(crewPage) && !/activeTab === 'calendar' && <AdminCalendar/.test(crewPage) && /role="tab"/.test(crewPage));
const tabNav = read('src/components/admin/TabNavigation.tsx');
ok('admin tab strip: the badge is not clipped by the scroll box and shows 99+', /overflow-x-auto pt-3 pr-3/.test(tabNav) && /min-w-\[1\.5rem\] h-6 px-1/.test(tabNav) && /tab\.badge > 99 \? '99\+'/.test(tabNav));
const customerSel = read('src/components/invoice/CustomerSelector.tsx');
const mk = (i: number) => ({ id: 'c' + i, first_name: 'Ann' + i, last_name: 'Lee', email: 'a' + i + '@x.com', phone: null, business_name: i === 3 ? 'Acme Rentals' : null });
const many = Array.from({ length: 120 }, (_, i) => mk(i));
eq('customer picker caps the list and reports the total', [filterCustomers(many, '').shown.length, filterCustomers(many, '').total], [50, 120]);
eq('customer picker matches name, email, phone, business; null email/phone do not crash', [filterCustomers(many, 'acme').shown.map((c) => c.id), filterCustomers(many, 'A7@X').shown.map((c) => c.id), filterCustomers([{ id: 'z', email: null, phone: null }], 'q').total], [['c3'], ['c7'], 0]);
ok('customer picker uses the shared filter, says when more exist, and has 44px rows', /filterCustomers\(customers, customerSearchQuery\)/.test(customerSel) && /Showing the first/.test(customerSel) && /min-h-\[44px\] break-words/.test(customerSel) && !/customer\.email\.toLowerCase\(\)/.test(customerSel));
const contacts = read('src/components/admin/customers/ContactsList.tsx');
ok('contacts: searchable, error state with retry, 44px icon buttons with names', /filterCustomers\(allContacts, search, Number\.MAX_SAFE_INTEGER\)/.test(contacts) && /aria-label="Search contacts"/.test(contacts) && /Contacts could not be loaded\./.test(contacts) && /aria-label=\{`Edit \$\{contact\.first_name\}/.test(contacts) && /aria-label=\{`Delete \$\{contact\.first_name\}/.test(contacts));
const itemsEd = read('src/components/shared/ItemsEditor.tsx');
ok('items editor: an emptied / half-typed price never stores NaN; +/- buttons are 36px on a phone', /Number\.isFinite\(dollars\) \|\| dollars < 0\) return;/.test(itemsEd) && !/Math\.round\(parseFloat\(e\.target\.value\) \* 100\)/.test(itemsEd) && (itemsEd.match(/w-9 h-9 sm:w-6 sm:h-6/g) ?? []).length === 2);
const eventEd = read('src/components/order-detail/EventDetailsEditor.tsx');
ok('generator quantity box stays mounted while availability resolves (it used to be swapped for a message, dropping the keyboard after every digit)', /aria-busy=\{generatorResolutionPending \? true : undefined\}/.test(eventEd) && /generatorResolutionPending && \(\n\s+<p role="status"/.test(eventEd) && !/\) : generatorResolutionPending \? \(/.test(eventEd));
const gcal = read('src/components/admin/settings/GoogleCalendarSettings.tsx');
ok('Google Calendar settings: a failed load turns Save off and says so; every write is checked (no false "Saved")', /const \[loadFailed, setLoadFailed\] = useState\(false\)/.test(gcal) && /if \(error\) \{\n\s+setLoadFailed\(true\);/.test(gcal) && /disabled=\{saving \|\| !hasAnyValue \|\| loadFailed\}/.test(gcal) && /if \(writeError\) throw writeError;/.test(gcal) && /if \(lookupError\) throw lookupError;/.test(gcal));

// --- reload when the person comes back (V-RT1 / V-RT2 / V-RT3: some tables are not published for realtime) ----------------------------------------
const calHook = read('src/hooks/admin/useCalendarTasks.ts');
ok('calendar reloads quietly (no spinner, open dialogs stay) when the page is shown again', /useRefetchOnReturn\(\(\) => \{ void loadTasksForMonth\(currentMonthRef\.current, \{ background: true \}\); \}\);/.test(calHook));
const lotPics = read('src/components/pending-order/LotPicturesDisplay.tsx');
ok('lot pictures reload when the admin returns to the page', /useRefetchOnReturn\(\(\) => \{ void loadPictures\(\); \}\);/.test(lotPics));

console.log(`adminCrewScreens: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} admin/crew screen test(s) failed`);
