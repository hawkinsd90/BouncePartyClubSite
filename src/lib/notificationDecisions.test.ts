// Notification decision tests, split out of the former stageE4DefectFixes.test.ts. They call the real production helpers.

import { type ShortPortalLinkResult } from './portalShortLink';
import { buildApprovalMessage, decideLotPicturesRequest, decideActionRequiredSms, decideEnRouteReminders } from './notificationDecision';

let passed = 0;
let failed = 0;
function ok(label: string, condition: boolean) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const decision = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'en_route_action_required' });
  ok('17 shouldSend=false on link failure', decision.shouldSendSms === false);
  ok('17 failureRecord exists', decision.failureRecord !== null);
}

{
  // Test with notificationWarning
  const msgOk = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: undefined });
  ok('18 approval success no warning', msgOk === 'Booking approved and customer notified.');
}

// 1. Normal success does not claim a deposit was charged
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: undefined });
  ok('approval-1 success message', msg === 'Booking approved and customer notified.');
  ok('approval-1 no deposit claim', !msg.includes('deposit'));
}

// 2. Zero-deposit success does not claim a deposit was charged
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: undefined, approvalError: undefined });
  ok('approval-2 zero-deposit success', msg === 'Booking approved and customer notified.');
  ok('approval-2 no deposit claim', !msg.includes('deposit'));
}

// 3. Notification failure reports approval success plus notification warning
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'SMS: send returned false' });
  ok('approval-3 warning message', msg === 'Booking approved, but the customer notification failed. Retry the notification from the order.');
  ok('approval-3 no deposit claim', !msg.includes('deposit'));
}

// 4. Approval failure includes the controlled result.error
{
  const msg = buildApprovalMessage({ approvalSuccessful: false, notificationWarning: undefined, approvalError: 'Card declined' });
  ok('approval-4 failure message', msg === 'Error approving order: Card declined');
}

// 4b. Approval failure with no error string
{
  const msg = buildApprovalMessage({ approvalSuccessful: false, notificationWarning: undefined });
  ok('approval-4b failure fallback', msg === 'Error approving order: Unknown error');
}

// 3. SMS returning false does not permit requested-state update
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const d = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: false });
  ok('lot-3 false SMS → no mark', d.shouldMarkRequested === false);
  ok('lot-3 failureRecord exists', d.failureRecord !== null);
  ok('lot-3 channel=sms', d.failureRecord!.channel === 'sms');
}

// 4. SMS success permits requested-state update
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const d = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: true });
  ok('lot-4 success → mark', d.shouldMarkRequested === true);
  ok('lot-4 no failure', d.failureRecord === null);
}

// Lot pictures link failure
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const d = decideLotPicturesRequest({ linkResult, smsSentSuccessfully: false });
  ok('lot-link-fail no mark', d.shouldMarkRequested === false);
  ok('lot-link-fail error', d.failureRecord!.error === 'Link failed');
}

// 5. En Route action-required link failure prevents SMS send
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const d = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'en_route_action_required' });
  ok('enroute-5 shouldSend=false', d.shouldSendSms === false);
  ok('enroute-5 failureRecord', d.failureRecord !== null);
  ok('enroute-5 message_type', d.failureRecord!.message_type === 'en_route_action_required');
}

// 6. Arrived action-required link failure prevents SMS send
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'Link failed' };
  const d = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'arrived_action_required' });
  ok('arrived-6 shouldSend=false', d.shouldSendSms === false);
  ok('arrived-6 failureRecord', d.failureRecord !== null);
}

// 7. En Route without action requirement may send without portal link
{
  const linkResult: ShortPortalLinkResult = { success: false, error: 'No action required' };
  const d = decideActionRequiredSms({ hasActionRequirement: false, linkResult, messageType: 'en_route_action_required' });
  ok('enroute-7 no action → send', d.shouldSendSms === true);
  ok('enroute-7 no failureRecord', d.failureRecord === null);
}

// 7b. En Route with action requirement and successful link → send
{
  const linkResult: ShortPortalLinkResult = { success: true, url: 'https://x.com/i/CODE', shortCode: 'CODE' };
  const d = decideActionRequiredSms({ hasActionRequirement: true, linkResult, messageType: 'en_route_action_required' });
  ok('enroute-7b action+link → send', d.shouldSendSms === true);
}

// 9. Email failure is reported separately (buildApprovalMessage with email-only error)
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'Email: SMTP timeout' });
  ok('approval-9 email failure in warning', msg.includes('notification failed'));
}

// 10. SMS failure is reported separately
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'SMS: send returned false' });
  ok('approval-10 sms failure in warning', msg.includes('notification failed'));
}

// 11. Approval remains successful when notification fails
{
  const msg = buildApprovalMessage({ approvalSuccessful: true, notificationWarning: 'SMS: failed' });
  ok('approval-11 approval successful', msg.includes('Booking approved'));
  ok('approval-11 notification failed', msg.includes('notification failed'));
}

// 45. Short-link failure: no SMS, all reminders false, failure recorded
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: false,
    hasActionRequirement: true,
    waiverSigned: false,
    balanceDue: 100,
    messageType: 'en_route_action_required',
    failureError: 'Unauthorized: crew cannot create order short links',
  });
  ok('45 eta false', d.etaSent === false);
  ok('45 waiver false', d.waiverReminderSent === false);
  ok('45 payment false', d.paymentReminderSent === false);
  ok('45 failure recorded', d.failureRecord !== null);
  if (d.failureRecord) {
    ok('45 channel sms', d.failureRecord.channel === 'sms');
    ok('45 message_type', d.failureRecord.message_type === 'en_route_action_required');
  }
}

// 46. SMS endpoint non-OK: reminders false, failure recorded
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: false,
    hasActionRequirement: true,
    waiverSigned: true,
    balanceDue: 0,
    messageType: 'en_route',
    failureError: 'SMS endpoint returned 500',
  });
  ok('46 eta false', d.etaSent === false);
  ok('46 waiver false', d.waiverReminderSent === false);
  ok('46 payment false', d.paymentReminderSent === false);
  ok('46 failure recorded', d.failureRecord !== null);
}

// 47. SMS network exception: reminders false, failure recorded
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: false,
    hasActionRequirement: true,
    waiverSigned: false,
    balanceDue: 50,
    messageType: 'arrived_action_required',
    failureError: 'Network error',
  });
  ok('47 eta false', d.etaSent === false);
  ok('47 waiver false', d.waiverReminderSent === false);
  ok('47 payment false', d.paymentReminderSent === false);
  ok('47 failure recorded', d.failureRecord !== null);
}

// 48. Successful action-required SMS: relevant reminders true
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: true,
    hasActionRequirement: true,
    waiverSigned: false,
    balanceDue: 100,
    messageType: 'en_route_action_required',
  });
  ok('48 eta true', d.etaSent === true);
  ok('48 waiver true', d.waiverReminderSent === true);
  ok('48 payment true', d.paymentReminderSent === true);
  ok('48 no failure', d.failureRecord === null);
}

// 49. Successful normal SMS, no action requirement: eta true, reminders false
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: true,
    hasActionRequirement: false,
    waiverSigned: true,
    balanceDue: 0,
    messageType: 'en_route',
  });
  ok('49 eta true', d.etaSent === true);
  ok('49 waiver false', d.waiverReminderSent === false);
  ok('49 payment false', d.paymentReminderSent === false);
  ok('49 no failure', d.failureRecord === null);
}

// 50. Successful SMS, waiver signed but balance due: payment reminder true only
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: true,
    hasActionRequirement: true,
    waiverSigned: true,
    balanceDue: 200,
    messageType: 'arrived_action_required',
  });
  ok('50 eta true', d.etaSent === true);
  ok('50 waiver false', d.waiverReminderSent === false);
  ok('50 payment true', d.paymentReminderSent === true);
}

// 51. Pickup ETA SMS (no action requirement): eta true, waiver/payment false even with unsigned waiver and balance due
{
  const d = decideEnRouteReminders({
    smsSentSuccessfully: true,
    hasActionRequirement: false,
    waiverSigned: false,
    balanceDue: 10000,
    messageType: 'en_route',
  });
  ok('51 eta true', d.etaSent === true);
  ok('51 waiver false', d.waiverReminderSent === false);
  ok('51 payment false', d.paymentReminderSent === false);
  ok('51 no failure', d.failureRecord === null);
}

console.log(`\nNotification decision tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
