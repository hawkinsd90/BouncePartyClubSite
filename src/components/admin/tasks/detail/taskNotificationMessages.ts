// Pure customer-facing task message and summary construction, extracted verbatim from
// TaskDetailModal (handleEnRoute, handleArrived, handleDropOffComplete, handlePickupComplete).
//
// Deterministic text only: no Supabase, no fetch, no React, no alerts, no portal-link creation and no
// clock. The caller keeps the workflow sequence (decide whether a portal link is needed, create it at
// the same point as before, then build the message with the result) and injects ETA strings and the
// completion time. Existing copy quirks are preserved on purpose (e.g. the pickup Arrived text tells
// the customer "before we arrive" right after "We have arrived").

import { formatCurrency } from '../../../../lib/pricing';
import type { ShortPortalLinkResult } from '../../../../lib/portal/portalShortLink';
import type { CompletionSummaryData } from './PickupCompletionSummary';

export type TaskType = 'drop-off' | 'pick-up';

export interface EnRouteMessageInput {
  customerName: string;
  taskType: TaskType;
  // Already-formatted ETA window ends (the caller owns the clock and locale formatting).
  etaStart: string;
  etaEnd: string;
  etaDistance: string;
  waiverSigned: boolean;
  balanceDue: number;
  hasPets?: boolean;
  // Caller-computed: drop-off with an unsigned waiver or a balance due.
  hasActionRequirement: boolean;
  // Result of the caller's createShortPortalLink call (a failure placeholder when no link was needed).
  linkResult: ShortPortalLinkResult;
}

export function buildEnRouteMessage(input: EnRouteMessageInput): string {
  const { customerName, taskType, etaStart, etaEnd, etaDistance, waiverSigned, balanceDue, hasPets, hasActionRequirement, linkResult } = input;
  let msg = `Hello ${customerName.split(' ')[0]}! We're on our way to ${taskType === 'drop-off' ? 'deliver' : 'pick up'} your rental. ETA: ${etaStart} - ${etaEnd}`;
  if (etaDistance) msg += ` (${etaDistance} away)`;
  msg += '. ';
  if (hasActionRequirement) {
    msg += '\n\n';
    if (!waiverSigned) msg += '⚠️ IMPORTANT: Your waiver is not signed yet. ';
    if (balanceDue > 0) msg += `⚠️ IMPORTANT: Balance due: ${formatCurrency(balanceDue)}. `;
    if (linkResult.success) {
      msg += `\n\nPlease complete these before we arrive: ${linkResult.url}`;
    }
  }
  if (taskType === 'drop-off') {
    msg += '\n\nPlease ensure there is a clear path for delivery and setup.';
    if (hasPets) {
      msg += ' Please also clear the backyard area of any pet waste before we arrive.';
    }
    msg += ' See you soon!';
  } else {
    if (hasPets) {
      msg += ' Please make sure all pets are secured inside before we arrive.';
    }
  }
  return msg;
}

export interface EnRouteResultInput {
  smsWarning: string | null;
  etaCalcErr: string | null;
  etaMinutes: number;
  etaDistance: string;
  workflowStatusFailed: boolean;
}

export function buildEnRouteResultMessage({ smsWarning, etaCalcErr, etaMinutes, etaDistance, workflowStatusFailed }: EnRouteResultInput): string {
  let successMsg = smsWarning && etaCalcErr ? `En Route saved (fallback ETA), but the customer notification failed.`
    : smsWarning ? `En Route saved, but the customer notification failed.`
    : etaCalcErr ? `En Route saved and customer notified (fallback ETA used).`
    : `En Route saved and customer notified. ETA: ${etaMinutes} min${etaDistance ? ` (${etaDistance})` : ''}.`;
  if (workflowStatusFailed) successMsg += '\n\n⚠️ Portal status may not update — workflow state failed to save.';
  return successMsg;
}

export interface ArrivedMessageInput {
  taskType: TaskType;
  waiverSigned: boolean;
  balanceDue: number;
  hasPets?: boolean;
  // Caller-computed: drop-off with an unsigned waiver or a balance due.
  hasActionRequirement: boolean;
  linkResult: ShortPortalLinkResult;
}

export function buildArrivedMessage(input: ArrivedMessageInput): string {
  const { taskType, waiverSigned, balanceDue, hasPets, hasActionRequirement, linkResult } = input;
  let msg = `We have arrived at your location! `;
  if (hasActionRequirement) {
    msg += '\n\n⚠️ Before we unload:\n';
    if (!waiverSigned) msg += '• Please sign the waiver\n';
    if (balanceDue > 0) msg += `• Complete payment (${formatCurrency(balanceDue)})\n`;
    if (linkResult.success) {
      msg += `\nComplete at: ${linkResult.url}\n\n`;
    }
  }
  if (taskType === 'drop-off') {
    msg += 'Please:\n• Put up any animals\n• Be ready to inspect the equipment\n• Approve the setup location';
    if (hasPets) {
      msg += '\n• Make sure all pets are secured inside';
    }
  } else {
    msg += "We'll begin pickup shortly.";
    if (hasPets) {
      msg += ' Please make sure all pets are secured inside before we arrive.';
    }
    msg += ' Thank you for using Bounce Party Club!';
  }
  return msg;
}

export function buildArrivedResultMessage({ smsWarn, workflowStatusFailed }: { smsWarn: string | null; workflowStatusFailed: boolean }): string {
  let arrivedMsg = smsWarn ? `Arrived saved, but the customer notification failed.` : 'Arrived and customer notified successfully!';
  if (workflowStatusFailed) arrivedMsg += '\n\n⚠️ Portal status may not update — workflow state failed to save.';
  return arrivedMsg;
}

export function buildDropOffRulesMessage({ pickupPreference, eventEndTime }: { pickupPreference?: string; eventEndTime?: string }): string {
  const pickupTime = pickupPreference === 'same_day' ? `this evening (${eventEndTime || 'after your event'})` : 'tomorrow morning';
  return `Equipment has been delivered! You are now responsible for the equipment until ${pickupTime}.\n\n⚠️ IMPORTANT RULES:\n• NO SHOES on the inflatable\n• NO FOOD or DRINKS\n• NO SHARP OBJECTS\n• NO HANGING OR CLIMBING ON THE NETS\n• Adult supervision required at all times\n\nEnjoy your event! 🎉`;
}

export function buildDropOffResultMessage({ smsWarn, workflowStatusFailed }: { smsWarn: string | null; workflowStatusFailed: boolean }): string {
  let dropOffMsg = smsWarn ? `Delivery marked complete. Warning: ${smsWarn}.` : 'Delivery completed and customer notified!';
  if (workflowStatusFailed) dropOffMsg += '\n\n⚠️ Portal will not show "Delivered" — workflow state failed to save.';
  return dropOffMsg;
}

export interface PickupSummaryTask {
  orderNumber: string;
  customerName: string;
  total: number;
  depositPaidCents: number;
  balancePaidCents: number;
  tipCents: number;
  balanceDue: number;
  waiverSigned: boolean;
  payments?: Array<{ status: string; payment_method?: string | null }>;
}

// Pickup completion summary. `completionTime` is injected so this stays deterministic.
export function buildPickupCompletionSummary(task: PickupSummaryTask, hasBalance: boolean, completionTime: Date): CompletionSummaryData {
  const paymentMethods = [...new Set(
    (task.payments || [])
      .filter((p) => p.status === 'paid' || p.status === 'succeeded')
      .map((p) => {
        const method = (p.payment_method || '').toLowerCase();
        if (method === 'cash') return 'Cash';
        if (method === 'check') return 'Check';
        return 'Card';
      })
  )];

  return {
    orderNumber: task.orderNumber,
    customerName: task.customerName,
    totalCents: task.total,
    depositPaidCents: task.depositPaidCents,
    balancePaidCents: task.balancePaidCents,
    tipCents: task.tipCents,
    remainingBalanceCents: hasBalance ? task.balanceDue : 0,
    paymentMethods,
    waiverSigned: task.waiverSigned,
    completionTime,
    hadBalanceWarning: hasBalance,
  };
}
