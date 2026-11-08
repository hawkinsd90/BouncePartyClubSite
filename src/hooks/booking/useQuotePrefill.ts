import { useEffect, useRef } from 'react';
import type { QuoteFormData } from './useQuoteForm';
import { hasSelectedAddress } from '../../lib/booking/addressEdit';

interface SessionAddress {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
}

interface PrefillCallbacks {
  setAddressInput: (value: string) => void;
  updateFormData: (updates: Partial<QuoteFormData>) => void;
}

/**
 * The form fields set from the saved profile address (WP-P1-12, F-40). The street, city, state and ZIP always come from the profile. The
 * coordinates are kept ONLY when the form already holds this same street with chosen coordinates; otherwise they are cleared, because coordinates
 * left over from a different address (a stored form from an earlier booking) would price the new street from the wrong place, and cleared
 * coordinates are what makes the Quote look the saved street up again (useQuoteForm).
 */
export function buildProfileAddressUpdate(
  current: Pick<QuoteFormData, 'address_line1' | 'lat' | 'lng'>,
  sessionAddress: SessionAddress,
): Partial<QuoteFormData> {
  const sameStreetWithCoordinates = current.address_line1 === sessionAddress.addressLine1 && hasSelectedAddress(current);
  return {
    address_line1: sessionAddress.addressLine1,
    address_line2: sessionAddress.addressLine2 || '',
    city: sessionAddress.city || 'Detroit',
    state: sessionAddress.state || 'MI',
    zip: sessionAddress.zip || '',
    ...(sameStreetWithCoordinates ? {} : { lat: 0, lng: 0, picked_locality: null }),
  };
}

export function useQuotePrefill(
  user: unknown,
  formData: QuoteFormData,
  callbacks: PrefillCallbacks,
  sessionAddress?: SessionAddress
) {
  const { setAddressInput, updateFormData } = callbacks;
  const hasAppliedRef = useRef(false);

  useEffect(() => {
    if (!user || hasAppliedRef.current || !sessionAddress?.addressLine1) return;

    // The DB-backed profile default address is the canonical source.
    // Apply it even if the form already has an address from stale SafeStorage,
    // because the stored form data may be from a previous session and the user
    // expects their saved profile address to appear on first load.
    hasAppliedRef.current = true;
    const parts = [
      sessionAddress.addressLine1,
      sessionAddress.addressLine2,
      sessionAddress.city,
      sessionAddress.state,
      sessionAddress.zip,
    ].filter(Boolean);
    setAddressInput(parts.join(', '));
    updateFormData(buildProfileAddressUpdate(formData, sessionAddress));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot: applies the saved default address the first time it appears
  }, [user, sessionAddress?.addressLine1]);

  return {};
}
