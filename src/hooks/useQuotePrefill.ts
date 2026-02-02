import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
import type { QuoteFormData } from './useQuoteForm';

interface PrefillCallbacks {
  setAddressInput: (value: string) => void;
  updateFormData: (updates: Partial<QuoteFormData>) => void;
}

export function useQuotePrefill(user: any, formData: QuoteFormData, callbacks: PrefillCallbacks) {
  const { setAddressInput, updateFormData } = callbacks;
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    const hasPrefillData = localStorage.getItem('bpc_quote_prefill');
    const wasPrefillApplied = SafeStorage.getItem('bpc_prefill_applied');
    if (!hasLoadedRef.current && !hasPrefillData && !wasPrefillApplied && !formData.address_line1) {
      loadPrefillData();
      hasLoadedRef.current = true;
    }
  }, []);

  useEffect(() => {
    const hasPrefillData = localStorage.getItem('bpc_quote_prefill');
    const wasPrefillApplied = SafeStorage.getItem('bpc_prefill_applied');
    if (user && !hasLoadedRef.current && !hasPrefillData && !wasPrefillApplied && !formData.address_line1) {
      loadPrefillData();
      hasLoadedRef.current = true;
    }
  }, [user]);

  async function loadPrefillData() {
    await loadUserPrefillData();
  }

  async function loadUserPrefillData() {
    if (!user) return;

    try {
      const { data, error } = await supabase.rpc('get_user_order_prefill');

      if (error) {
        console.error('Error fetching user prefill data:', error);
        return;
      }

      if (data && (data as any).length > 0) {
        const userData = (data as any)[0];
        console.log('Auto-filling form with user data:', userData);

        if (userData.address_line1 || userData.city) {
          const addressParts = [
            userData.address_line1,
            userData.city,
            userData.state,
            userData.zip,
          ].filter(Boolean);

          if (addressParts.length > 0) {
            setAddressInput(addressParts.join(', '));
            updateFormData({
              address_line1: userData.address_line1 || '',
              address_line2: userData.address_line2 || '',
              city: userData.city || 'Detroit',
              state: userData.state || 'MI',
              zip: userData.zip || '',
              lat: userData.lat ? Number(userData.lat) : 0,
              lng: userData.lng ? Number(userData.lng) : 0,
            });
          }
        }
      }
    } catch (error) {
      console.error('Error loading user prefill data:', error);
    }
  }

  return { loadPrefillData };
}
