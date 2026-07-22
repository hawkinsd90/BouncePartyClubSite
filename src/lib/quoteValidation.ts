import type { QuoteFormData } from '../hooks/useQuoteForm';
import type { UnifiedCartItem, InflatableCartItem, EventEssentialProductCartItem, EventEssentialBundleCartItem } from '../types';

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
  errorSection?: 'cart' | 'address' | 'event' | 'setup';
  errorFieldId?: string;
}

function isInflatable(item: UnifiedCartItem): item is InflatableCartItem {
  return item.item_type === undefined || item.item_type === 'inflatable';
}

function getItemDisplayName(item: UnifiedCartItem): string {
  if (isInflatable(item)) return item.unit_name;
  if (item.item_type === 'event_essential_product') return (item as EventEssentialProductCartItem).product_name;
  if (item.item_type === 'event_essential_bundle') return (item as EventEssentialBundleCartItem).bundle_name;
  return 'Unknown item';
}

export function validateQuote(
  cart: UnifiedCartItem[],
  formData: QuoteFormData
): ValidationResult {
  // 1. Cart validation
  if (cart.length === 0) {
    return {
      isValid: false,
      errorMessage: 'Please add at least one item to your quote.',
      errorSection: 'cart',
    };
  }

  const unavailableItems = cart.filter((item) => item.isAvailable === false);
  if (unavailableItems.length > 0) {
    const unavailableNames = unavailableItems.map(getItemDisplayName).join(', ');
    return {
      isValid: false,
      errorMessage: `The following items are not available for your selected dates: ${unavailableNames}. Please choose different dates or remove these items.`,
      errorSection: 'cart',
    };
  }

  // Check if cart contains any inflatables
  const hasInflatables = cart.some(isInflatable);

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

  if (formData.location_type === 'residential') {
    const validPickup = formData.pickup_preference === 'next_day' || formData.pickup_preference === 'same_day';
    if (!validPickup) {
      return {
        isValid: false,
        errorMessage: 'Please select when you need pickup (Next Morning or Same Day).',
        errorSection: 'event',
        errorFieldId: 'pickup-preference',
      };
    }
  }

  // Inflatable-specific setup validation — only when cart contains inflatables
  if (hasInflatables) {
    if (formData.can_stake == null) {
      return {
        isValid: false,
        errorMessage: 'Please indicate whether we can anchor the inflatable with stakes.',
        errorSection: 'setup',
      };
    }
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
