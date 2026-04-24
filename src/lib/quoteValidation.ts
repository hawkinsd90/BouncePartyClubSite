import type { QuoteFormData } from '../hooks/useQuoteForm';

interface CartItem {
  unit_name: string;
  isAvailable?: boolean;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  errorSection?: 'cart' | 'address' | 'event' | 'setup';
  errorFieldId?: string;
}

export function validateQuote(
  cart: CartItem[],
  formData: QuoteFormData
): ValidationResult {
  // 1. Cart validation
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

  // 2. Address validation
  if (!formData.address_line1 || formData.address_line1.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a street address for the event location.',
      errorSection: 'address',
      errorFieldId: 'address-input',
    };
  }

  if (!formData.city || formData.city.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a city for the event location.',
      errorSection: 'address',
      errorFieldId: 'city-input',
    };
  }

  if (!formData.state || formData.state.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a state for the event location.',
      errorSection: 'address',
      errorFieldId: 'state-input',
    };
  }

  if (!formData.zip || formData.zip.trim() === '') {
    return {
      isValid: false,
      errorMessage: 'Please enter a ZIP code for the event location.',
      errorSection: 'address',
      errorFieldId: 'zip-input',
    };
  }

  // 3. Event type / setup required selections
  if (formData.location_type == null) {
    return {
      isValid: false,
      errorMessage: 'Please select an event type (Residential or Commercial).',
      errorSection: 'event',
    };
  }

  if (formData.location_type === 'residential' && formData.pickup_preference == null) {
    return {
      isValid: false,
      errorMessage: 'Please select when you need pickup (Next Morning or Same Day).',
      errorSection: 'event',
    };
  }

  if (formData.can_stake == null) {
    return {
      isValid: false,
      errorMessage: 'Please indicate whether we can anchor the inflatable with stakes.',
      errorSection: 'setup',
    };
  }

  // 4. Event date/time validation
  if (!formData.event_date) {
    return {
      isValid: false,
      errorMessage: 'Please select an event start date.',
      errorSection: 'event',
      errorFieldId: 'event-start-date',
    };
  }

  if (!formData.event_end_date) {
    return {
      isValid: false,
      errorMessage: 'Please select an event end date.',
      errorSection: 'event',
      errorFieldId: 'event-end-date',
    };
  }

  if (!formData.start_window) {
    return {
      isValid: false,
      errorMessage: 'Please select an event start time.',
      errorSection: 'event',
      errorFieldId: 'start-time',
    };
  }

  if (!formData.end_window) {
    return {
      isValid: false,
      errorMessage: 'Please select an event end time.',
      errorSection: 'event',
      errorFieldId: 'end-time',
    };
  }

  // 5. Responsibility agreement validation (last, after user inputs)
  if (
    formData.location_type === 'residential' &&
    formData.pickup_preference === 'next_day' &&
    !formData.overnight_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the overnight responsibility agreement.',
      errorSection: 'event',
      errorFieldId: 'overnight-responsibility-checkbox',
    };
  }

  if (
    formData.pickup_preference === 'same_day' &&
    !formData.same_day_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the responsibility agreement for same-day pickup.',
      errorSection: 'event',
      errorFieldId: 'same-day-responsibility-checkbox',
    };
  }

  if (
    formData.location_type === 'commercial' &&
    !formData.same_day_responsibility_accepted
  ) {
    return {
      isValid: false,
      errorMessage: 'Please accept the responsibility agreement for commercial events.',
      errorSection: 'event',
      errorFieldId: 'commercial-responsibility-checkbox',
    };
  }

  return { isValid: true };
}
