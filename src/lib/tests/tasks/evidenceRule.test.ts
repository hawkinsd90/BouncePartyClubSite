// NI-11 / WP-32 (B11): the screen side of the required delivery / pickup photo. The database side (trigger, override, roles) is
// executed in security/taskEvidenceEnforcement.test.ts. PASS - LOCAL AUTOMATED.
// A crew member completing real tasks with and without a photo on hosted Dev is REQUIRES HOSTED DEV VERIFICATION (G22).
import { readFileSync } from 'node:fs';
import { decideEvidence, isEvidenceRequiredError, overrideReasonProblem, parseEvidenceState, photoRequiredMessage } from '../../tasks/evidenceRule';

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

const blockedState = { required: true, photo_count: 0, overridden: false, can_complete: false };
const okState = { required: true, photo_count: 2, overridden: false, can_complete: true };

// --- state parsing -------------------------------------------------------------------------------------------------------
eq('a full state parses', parseEvidenceState({ required: true, photo_count: 1, overridden: false, can_complete: true }), { required: true, photo_count: 1, overridden: false, can_complete: true });
eq('missing optional fields get safe values', parseEvidenceState({ required: true, can_complete: false }), { required: true, photo_count: 0, overridden: false, can_complete: false });
eq('null / junk is no state', [parseEvidenceState(null), parseEvidenceState('x'), parseEvidenceState({ required: 'yes' })], [null, null, null]);

// --- decisions ------------------------------------------------------------------------------------------------------------
eq('photo present: proceed', decideEvidence(okState, 'delivery', false), { action: 'proceed' });
eq('not required (setting off): proceed', decideEvidence({ ...blockedState, required: false, can_complete: true }, 'pickup', false), { action: 'proceed' });
eq('already overridden: proceed', decideEvidence({ ...blockedState, overridden: true, can_complete: true }, 'delivery', false), { action: 'proceed' });
eq('lookup failed or function missing (null): proceed, the database decides', decideEvidence(null, 'delivery', false), { action: 'proceed' });
eq('crew without a photo is blocked, with the delivery wording', decideEvidence(blockedState, 'delivery', false), { action: 'blocked', message: photoRequiredMessage('delivery') });
eq('crew without a photo is blocked, with the pickup wording', decideEvidence(blockedState, 'pickup', false), { action: 'blocked', message: photoRequiredMessage('pickup') });
eq('an Admin without a photo is offered the override', decideEvidence(blockedState, 'delivery', true), { action: 'offer_override', message: photoRequiredMessage('delivery') });
ok('the messages tell crew what to do', /Photos button/.test(photoRequiredMessage('delivery')) && /pickup/.test(photoRequiredMessage('pickup')));

// --- override reason + error recognition --------------------------------------------------------------------------------------
eq('reason too short', overrideReasonProblem('too short') !== null, true);
eq('reason of spaces only', overrideReasonProblem('            ') !== null, true);
eq('reason long enough', overrideReasonProblem('Customer asked us not to photograph'), null);
eq('the database refusal is recognised by message or hint', [isEvidenceRequiredError({ message: 'EVIDENCE_REQUIRED: a photo of the delivery is required' }), isEvidenceRequiredError({ message: 'x', hint: 'EVIDENCE_REQUIRED' }), isEvidenceRequiredError({ message: 'permission denied' }), isEvidenceRequiredError(null)], [true, true, false, false]);

// --- wiring in the task screen ---------------------------------------------------------------------------------------------
const modal = read('src/components/admin/tasks/TaskDetailModal.tsx');
const dropOff = modal.slice(modal.indexOf('async function handleDropOffComplete'), modal.indexOf('async function handlePickupComplete'));
const pickup = modal.slice(modal.indexOf('async function handlePickupComplete'), modal.indexOf('async function handleReorder'));
ok('delivery: mileage gate, then the photo gate, then the confirmation, then the customer text', dropOff.indexOf("passesStartMileageGate('drop_off')") < dropOff.indexOf("passesEvidenceGate('delivery')") && dropOff.indexOf("passesEvidenceGate('delivery')") < dropOff.indexOf('showConfirm(') && dropOff.indexOf("passesEvidenceGate('delivery')") < dropOff.indexOf('postTaskSms('));
ok('pickup: the photo gate runs before the customer text/email and before the order workflow is touched', pickup.indexOf("passesEvidenceGate('pickup')") > 0 && pickup.indexOf("passesEvidenceGate('pickup')") < pickup.indexOf('send-sms-notification') && pickup.indexOf("passesEvidenceGate('pickup')") < pickup.indexOf("workflow_status: 'pickup_in_progress'"));
ok('the gate asks the database for the task state and treats a failed lookup as "let the database decide"', /rpc\('get_task_evidence_state'/.test(modal) && /if \(!error\) state = parseEvidenceState\(data\)/.test(modal));
ok('only the Admin branch can open the override, and it records through the Admin-only function', /decision\.action === 'blocked'/.test(modal) && /rpc\('override_task_evidence'/.test(modal) && /decideEvidence\(state, kind, isAdmin\)/.test(modal));
ok('a refusal from the database at the final update gives a plain message (both flows)', (modal.match(/isEvidenceRequiredError\(taskErr\)/g) ?? []).length === 2);
ok('the override dialog needs a reason and says it is recorded', /Reason \(required\)/.test(read('src/components/admin/tasks/detail/EvidenceOverrideModal.tsx')) && /recorded/.test(read('src/components/admin/tasks/detail/EvidenceOverrideModal.tsx')) && /overrideReasonProblem\(reason\)/.test(read('src/components/admin/tasks/detail/EvidenceOverrideModal.tsx')));
ok('the override dialog is mounted inside the task screen', /<EvidenceOverrideModal/.test(modal));

console.log(`evidenceRule: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} evidence rule test(s) failed`);
