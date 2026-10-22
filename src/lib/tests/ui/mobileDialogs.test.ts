// WP-23 (B15): dialogs must stay usable on a small screen. Every full-screen overlay in the app either scrolls or its panel is height-capped
// and scrolls, or it is on the short allowlist below (with the reason). A new overlay that does neither fails this test.
// PASS - LOCAL AUTOMATED (source scan). Real phones, landscape and the on-screen keyboard (M-06) are REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { MODAL_PANEL_SCROLL } from '../../core/modalClasses';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}`);
  }
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const files: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx$/.test(f)) files.push(p);
  }
};
walk('src');

// Files that draw a fixed overlay on purpose without a height-capped panel.
const EXEMPT: Record<string, string> = {
  'src/components/common/LoadingSpinner.tsx': 'a spinner, no panel',
  'src/components/AdminCalendar.tsx': 'a small "Loading tasks..." spinner box, no form or buttons',
  'src/components/common/nav/MobileDrawer.tsx': 'the drawer panel scrolls itself (max-h-[100dvh] overflow-y-auto)',
  'src/components/admin/content/photos/PhotoDetailModal.tsx': 'full-screen photo viewer (flex column, image area scrolls)',
  'src/components/pending-order/StreetViewImages.tsx': 'full-screen image viewer',
  'src/components/customer-portal/DeliveryTab.tsx': 'full-screen image lightbox',
  'src/components/customer-portal/LotPicturesTab.tsx': 'full-screen image lightbox',
  'src/components/pending-order/LotPicturesDisplay.tsx': 'full-screen image lightbox',
  'src/pages/UnitDetail.tsx': 'full-screen image lightbox',
};

const isScrollingPanel = (text: string) => /max-h-\[(90|95)d?vh\][^"`']*overflow-y-auto|overflow-y-auto[^"`']*max-h-\[(90|95)d?vh\]|MODAL_PANEL_SCROLL/.test(text);

const offenders: string[] = [];
const checked: string[] = [];
for (const f of files) {
  const lines = read(f).split('\n');
  lines.forEach((line, i) => {
    if (!/fixed inset-0/.test(line)) return;
    const window = lines.slice(i, i + 6).join('\n');
    // the overlay scrolls itself, or the panel right inside it is capped and scrolls
    const compliant = /overflow-y-auto/.test(line) || isScrollingPanel(window);
    checked.push(f);
    if (!compliant && !(f in EXEMPT)) offenders.push(`${f}:${i + 1}`);
  });
}
ok(`every fixed overlay scrolls or is allowlisted (offenders: ${offenders.join(', ') || 'none'})`, offenders.length === 0);
ok('the allowlist only names files that still draw an overlay (no stale entries)', Object.keys(EXEMPT).every((f) => checked.includes(f)));

// the dialogs named in WP-23 use the shared class
const NAMED: Record<string, string> = {
  'src/components/pending-order/AdminRejectionModal.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/admin/content/photos/PromoteToUnitModal.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/admin/content/photos/PromoteToCarouselModal.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/admin/tasks/detail/PickupCompletionSummary.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/order-detail/TaxWaiver.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/shared/FeeWaiver.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/order-detail/TravelFeeManager.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/order-detail/StatusChangeDialog.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/admin/orders/detail-modal/GeneratorLegacyConfirmDialogs.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/common/SimpleConfirmModal.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/customer-portal/PaymentTab.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/customer-portal/CustomerApprovalModal.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/customer-portal/CancelOrderModal.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/customer-portal/CustomerRejectionModal.tsx': 'MODAL_PANEL_SCROLL',
  'src/components/common/PrintModal.tsx': 'MODAL_PANEL_SCROLL',
};
for (const [file, token] of Object.entries(NAMED)) ok(`${file} uses the shared panel class`, read(file).includes(token));
ok('the shared class caps the panel in dynamic viewport units and scrolls', MODAL_PANEL_SCROLL === 'max-h-[90dvh] overflow-y-auto');
ok('no named dialog still uses the old vh cap', Object.keys(NAMED).every((f) => !/max-h-\[90vh\]/.test(read(f))));

// Reject Booking asks again before it rejects and texts the customer
const rej = read('src/components/pending-order/AdminRejectionModal.tsx');
ok('rejection: choosing a reason does NOT reject; it opens a confirmation', /setPending\(reason\)/.test(rej) && !/onClick=\{\(\) => onReject\(reason\)\}/.test(rej) && !/onReject\(reason\)\}\n\s+className="w-full text-left/.test(rej));
ok('rejection: the confirmation names the reason, says the customer is told, and only "Yes, reject" calls onReject', /The customer will be notified/.test(rej) && (rej.match(/onReject\(/g) ?? []).length === 1 && /Yes, reject/.test(rej));
ok('rejection: the custom reason also goes through the confirmation', /setPending\(customReason\.trim\(\)\)/.test(rej));

// PrintModal on a phone
const print = read('src/components/common/PrintModal.tsx');
ok('print preview: header wraps, zoom is hidden on phones, the Print label is short, controls are 44px, the backdrop closes it', /flex flex-wrap justify-between items-center gap-2/.test(print) && /hidden sm:flex items-center gap-2 border/.test(print) && /<span className="sm:hidden">Print<\/span>/.test(print) && (print.match(/min-h-\[44px\]/g) ?? []).length >= 2 && /e\.target === e\.currentTarget && !isProcessing\) onClose\(\)/.test(print));

console.log(`mobileDialogs: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} mobile dialog test(s) failed`);
