import { useEffect, useRef } from 'react';
import type { QuoteFormData } from './useQuoteForm';

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

export function useQuotePrefill(
  user: any,
  formData: QuoteFormData,
  callbacks: PrefillCallbacks,
  sessionAddress?: SessionAddress
) {
  const { setAddressInput, updateFormData } = callbacks;
  const hasAppliedRef = useRef(false);

  useEffect(() => {
    if (
      user &&
      !hasAppliedRef.current &&
      !formData.address_line1 &&
      sessionAddress?.addressLine1
    ) {
      hasAppliedRef.current = true;
      const parts = [
        sessionAddress.addressLine1,
        sessionAddress.addressLine2,
        sessionAddress.city,
        sessionAddress.state,
        sessionAddress.zip,
      ].filter(Boolean);
      setAddressInput(parts.join(', '));
      updateFormData({
        address_line1: sessionAddress.addressLine1,
        address_line2: sessionAddress.addressLine2 || '',
        city: sessionAddress.city || 'Detroit',
        state: sessionAddress.state || 'MI',
        zip: sessionAddress.zip || '',
      });
    }
  }, [user, sessionAddress?.addressLine1, formData.address_line1]);

  return {};
}
