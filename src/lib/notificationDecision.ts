// Narrow production orchestration for notification send decisions.
//
// Used by callers and tests to determine whether a notification should be sent
// given a short-link result, and to produce the correct notification-failure
// record when sending is skipped.

import type { ShortPortalLinkResult } from './utils';

export interface NotificationDecision {
  shouldSend: boolean;
  failureRecord: { channel: string; message_type: string; error: string } | null;
}

export function decideNotificationSend(input: {
  linkResult: ShortPortalLinkResult;
  channel: string;
  messageType: string;
}): NotificationDecision {
  if (input.linkResult.success) {
    return { shouldSend: true, failureRecord: null };
  }

  return {
    shouldSend: false,
    failureRecord: {
      channel: input.channel,
      message_type: input.messageType,
      error: input.linkResult.error,
    },
  };
}

export interface ApprovalNotificationResult {
  approvalSuccessful: boolean;
  notificationSuccessful: boolean;
  notificationError: string | null;
  message: string;
}

export function buildApprovalResultMessage(input: {
  approvalSuccessful: boolean;
  notificationSuccessful: boolean;
  notificationError: string | null;
}): string {
  if (input.approvalSuccessful && input.notificationSuccessful) {
    return 'Order approved and deposit charged. Customer notified via SMS and email.';
  }
  if (input.approvalSuccessful && !input.notificationSuccessful) {
    return `Order approved and deposit charged, but the confirmation notification failed. Retry the notification from the order.`;
  }
  return 'Order approval failed.';
}

export function decideLotPicturesRequest(input: {
  linkResult: ShortPortalLinkResult;
  smsSentSuccessfully: boolean;
}): { shouldMarkRequested: boolean; failureRecord: { channel: string; message_type: string; error: string } | null } {
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
