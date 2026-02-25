import type { QuoteFormData } from '../hooks/useQuoteForm';

interface CartItem {
  unit_name: string;
  isAvailable?: boolean;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  errorSection?: 'cart' | 'address' | 'event' | 'setup';
}

export function validateQuote(
  cart: CartItem[],
  formData: QuoteFormData
): ValidationResult {
  if (cart.length === 0) {
    return {
      isValid: false,
      errorMessage: 'Please add at least one inflatable to your quote.',
      errorSection: 'cart',
    };
  }

  const unavailableItems = cart.filter((item) => item.isAvailable === false);
  if (unavailableItems.length > 0) {
    const unavailableNames = unavailableItems.map((item) => item.unit_name).join(', ');
    return {
      isValid: false,
      errorMessage: `The following inflatables are not available for your selected dates: ${unavailableNames}. Please choose different dates or remove these items.`,
      errorSection: 'cart',
    };
  }

  if (
    formData.location_type === 'residential' &&
    formData.pickup_preference === 'next_day' &&
    !formData.overnight_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the overnight responsibility agreement.',
      errorSection: 'setup',
    };
  }

  if (
    formData.pickup_preference === 'same_day' &&
    !formData.same_day_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the responsibility agreement for same-day pickup.',
      errorSection: 'setup',
    };
  }

  return { isValid: true };
}
