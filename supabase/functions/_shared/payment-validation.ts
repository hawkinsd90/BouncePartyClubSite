import Stripe from 'npm:stripe@20.0.0';

export interface PaymentMethodValidationResult {
  valid: boolean;
  reason?: string;
  warning?: string;
  needsNewCard?: boolean;
  expMonth?: number;
  expYear?: number;
  last4?: string;
}

export async function validatePaymentMethod(
  paymentMethodId: string,
  stripe: Stripe
): Promise<PaymentMethodValidationResult> {
  try {
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    if (!paymentMethod.customer) {
      return {
        valid: false,
        reason: 'Payment method no longer attached to customer',
        needsNewCard: true,
      };
    }

    if (paymentMethod.type === 'card' && paymentMethod.card) {
      const now = new Date();
      const expYear = paymentMethod.card.exp_year;
      const expMonth = paymentMethod.card.exp_month;
      const expDate = new Date(expYear, expMonth - 1);

      if (expDate < now) {
        return {
          valid: false,
          reason: `Card has expired (${expMonth}/${expYear})`,
          needsNewCard: true,
        };
      }

      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      if (expDate < thirtyDaysFromNow) {
        return {
          valid: true,
          warning: `Card expires soon: ${expMonth}/${expYear}`,
          expMonth,
          expYear,
          last4: paymentMethod.card.last4,
        };
      }

      return {
        valid: true,
        expMonth,
        expYear,
        last4: paymentMethod.card.last4,
      };
    }

    return { valid: true };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'resource_missing') {
      return {
        valid: false,
        reason: 'Payment method not found',
        needsNewCard: true,
      };
    }
    throw error;
  }
}
