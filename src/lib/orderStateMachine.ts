import { ORDER_STATUS } from './constants/statuses';

interface StatusTransition {
  from: string;
  to: string[];
  requiredChecks?: Array<(order: any) => { valid: boolean; reason?: string }>;
}

const VALID_TRANSITIONS: StatusTransition[] = [
  {
    from: ORDER_STATUS.DRAFT,
    to: [ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID]
  },
  {
    from: ORDER_STATUS.PENDING,
    to: [ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL, ORDER_STATUS.CANCELLED, ORDER_STATUS.VOID],
  },
  {
    from: ORDER_STATUS.AWAITING_CUSTOMER_APPROVAL,
    to: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PENDING, ORDER_STATUS.CANCELLED],
  },
  {
    from: ORDER_STATUS.CONFIRMED,
    to: [ORDER_STATUS.SETUP_IN_PROGRESS, ORDER_STATUS.CANCELLED],
    requiredChecks: [
      (order) => ({
        valid: !!order.stripe_payment_method_id || order.payment_amount_due === 0,
        reason: 'Cannot confirm order without payment method on file (unless payment is $0)'
      })
    ]
  },
  {
    from: ORDER_STATUS.SETUP_IN_PROGRESS,
    to: [ORDER_STATUS.ON_THE_WAY, ORDER_STATUS.SETUP_COMPLETED, ORDER_STATUS.CONFIRMED]
  },
  {
    from: ORDER_STATUS.ON_THE_WAY,
    to: [ORDER_STATUS.SETUP_COMPLETED, ORDER_STATUS.SETUP_IN_PROGRESS]
  },
  {
    from: ORDER_STATUS.SETUP_COMPLETED,
    to: [ORDER_STATUS.PICKUP_IN_PROGRESS]
  },
  {
    from: ORDER_STATUS.PICKUP_IN_PROGRESS,
    to: [ORDER_STATUS.ON_THE_WAY_BACK, ORDER_STATUS.SETUP_COMPLETED]
  },
  {
    from: ORDER_STATUS.ON_THE_WAY_BACK,
    to: [ORDER_STATUS.COMPLETED, ORDER_STATUS.PICKUP_IN_PROGRESS]
  },
  {
    from: ORDER_STATUS.COMPLETED,
    to: []
  },
  {
    from: ORDER_STATUS.CANCELLED,
    to: []
  },
  {
    from: ORDER_STATUS.VOID,
    to: []
  }
];

export function validateStatusTransition(
  currentStatus: string,
  newStatus: string,
  order?: any
): { valid: boolean; reason?: string } {
  if (currentStatus === newStatus) {
    return { valid: true };
  }

  const transition = VALID_TRANSITIONS.find(t => t.from === currentStatus);

  if (!transition) {
    return { valid: false, reason: `Unknown status: ${currentStatus}` };
  }

  if (!transition.to.includes(newStatus)) {
    return {
      valid: false,
      reason: `Cannot transition from "${currentStatus}" to "${newStatus}". Valid transitions: ${transition.to.join(', ')}`
    };
  }

  if (transition.requiredChecks && order) {
    for (const check of transition.requiredChecks) {
      const result = check(order);
      if (!result.valid) {
        return result;
      }
    }
  }

  return { valid: true };
}

export function getAvailableStatuses(currentStatus: string): string[] {
  const transition = VALID_TRANSITIONS.find(t => t.from === currentStatus);
  return transition?.to || [];
}

export function formatStatusName(status: string): string {
  return status
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
