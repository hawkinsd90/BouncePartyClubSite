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
}

export function buildApprovalMessage(input: ApprovalMessageInput): string {
  if (input.approvalSuccessful && !input.notificationWarning) {
    return 'Booking approved, deposit charged, and customer notified.';
  }
  if (input.approvalSuccessful && input.notificationWarning) {
    return 'Booking approved and deposit charged, but the customer notification failed. Retry the notification from the order.';
  }
  return 'Failed to approve order.';
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
