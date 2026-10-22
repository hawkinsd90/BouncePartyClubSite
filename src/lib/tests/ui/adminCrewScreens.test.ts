// WP-25 (B17): Admin and Crew screens that matter in daily use on a phone - what a task card says, photo loading that can fail and be retried,
// reasons asked inside the app, file pickers that stay mounted, and settings forms that must not save over what they failed to load.
// PASS - LOCAL AUTOMATED. 320/360/390 passes, the camera/file pickers on iOS and Android, and the two-device checks are REQUIRES HOSTED DEV VERIFICATION.
import { readFileSync } from 'node:fs';
import { balanceDueLabel, equipmentSummary, eventTimeRange, statusLabel } from '../../tasks/taskCardFormat';

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

console.log(`adminCrewScreens: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} admin/crew screen test(s) failed`);
