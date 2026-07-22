// Production orchestration helpers for notification send decisions.
//
// These helpers are wired into the actual production callers:
// - buildApprovalMessage: PendingOrderCard.handleApprove
// - decideLotPicturesRequest: PendingOrderCard onPromptCustomer
// - decideActionRequiredSms: TaskDetailModal handleEnRoute/handleArrived

import type { ShortPortalLinkResult } from './utils';

export interface ApprovalMessageInput {
  approvalSuccessful: boolean;
  notificationWarning: string | undefined;
  approvalError?: string;
}

export function buildApprovalMessage(input: ApprovalMessageInput): string {
  if (!input.approvalSuccessful) {
    return `Error approving order: ${input.approvalError || 'Unknown error'}`;
  }
  if (input.notificationWarning) {
    return 'Booking approved, but the customer notification failed. Retry the notification from the order.';
  }
  return 'Booking approved and customer notified.';
}

export interface LotPicturesDecision {
  shouldMarkRequested: boolean;
  failureRecord: { channel: string; message_type: string; error: string } | null;
}

export function decideLotPicturesRequest(input: {
  linkResult: ShortPortalLinkResult;
  smsSentSuccessfully: boolean;
}): LotPicturesDecision {
  if (input.linkResult.success && input.smsSentSuccessfully) {
    return { shouldMarkRequested: true, failureRecord: null };
  }

  const error = !input.linkResult.success
    ? input.linkResult.error
    : 'SMS send failed';

  return {
    shouldMarkRequested: false,
    failureRecord: {
      channel: 'sms',
      message_type: 'lot_pictures_request',
      error,
    },
  };
}

export interface ActionRequiredSmsDecision {
  shouldSendSms: boolean;
  failureRecord: { channel: string; message_type: string; error: string } | null;
}

export function decideActionRequiredSms(input: {
  hasActionRequirement: boolean;
  linkResult: ShortPortalLinkResult;
  messageType: string;
}): ActionRequiredSmsDecision {
  if (!input.hasActionRequirement) {
    return { shouldSendSms: true, failureRecord: null };
  }

  if (input.linkResult.success) {
    return { shouldSendSms: true, failureRecord: null };
  }

  return {
    shouldSendSms: false,
    failureRecord: {
      channel: 'sms',
      message_type: input.messageType,
      error: input.linkResult.error,
    },
  };
}

export interface EnRouteReminderDecision {
  etaSent: boolean;
  waiverReminderSent: boolean;
  paymentReminderSent: boolean;
  failureRecord: { channel: string; message_type: string; error: string } | null;
}

export function decideEnRouteReminders(input: {
  smsSentSuccessfully: boolean;
  waiverSigned: boolean;
  balanceDue: number;
  messageType: string;
  failureError?: string;
}): EnRouteReminderDecision {
  if (input.smsSentSuccessfully) {
    return {
      etaSent: true,
      waiverReminderSent: !input.waiverSigned,
      paymentReminderSent: input.balanceDue > 0,
      failureRecord: null,
    };
  }

  return {
    etaSent: false,
    waiverReminderSent: false,
    paymentReminderSent: false,
    failureRecord: {
      channel: 'sms',
      message_type: input.messageType,
      error: input.failureError || 'SMS send failed',
    },
  };
}
