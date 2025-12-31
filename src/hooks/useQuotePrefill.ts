import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
import type { QuoteFormData } from './useQuoteForm';

const PREFILL_STORAGE_KEY = 'bpc_quote_prefill';
const DUPLICATE_ORDER_FLAG = 'bpc_duplicate_order';

interface PrefillCallbacks {
  setAddressInput: (value: string) => void;
  updateFormData: (updates: Partial<QuoteFormData>) => void;
}

export function useQuotePrefill(user: any, callbacks: PrefillCallbacks) {
  const { setAddressInput, updateFormData } = callbacks;

  useEffect(() => {
    loadPrefillData();
  }, []);

  useEffect(() => {
    if (user) {
      loadPrefillData();
    }
  }, [user]);

  async function loadPrefillData() {
    await loadUserPrefillData();
    loadLocalStoragePrefill();
  }

  async function loadUserPrefillData() {
    if (!user) return;

    try {
      const { data, error } = await supabase.rpc('get_user_order_prefill');

      if (error) {
        console.error('Error fetching user prefill data:', error);
        return;
      }

      if (data && data.length > 0) {
        const userData = data[0];
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

  function loadLocalStoragePrefill() {
    const data = SafeStorage.getItem<any>(PREFILL_STORAGE_KEY);
    if (!data) return;

    try {
      const isDuplicateOrder = SafeStorage.getItem<string>(DUPLICATE_ORDER_FLAG) === 'true';

      if (data.address) {
        setAddressInput(data.address.formatted_address || data.address.street || '');
        updateFormData({
          address_line1: data.address.street || '',
          address_line2: data.address.line2 || '',
          city: data.address.city || 'Detroit',
          state: data.address.state || 'MI',
          zip: data.address.zip || '',
          lat: data.address.lat || 0,
          lng: data.address.lng || 0,
        });
      }

      if (isDuplicateOrder) {
        updateFormData({
          location_type: data.location_type || 'residential',
          pickup_preference: data.pickup_preference || 'next_day',
          can_stake: data.can_stake !== undefined ? data.can_stake : true,
          has_generator: data.has_generator !== undefined ? data.has_generator : false,
          has_pets: data.has_pets !== undefined ? data.has_pets : false,
          special_details: data.special_details || '',
          start_window: data.start_window || '09:00',
          end_window: data.end_window || '17:00',
        });
        SafeStorage.removeItem(DUPLICATE_ORDER_FLAG);
      } else if (data.location_type) {
        updateFormData({
          location_type: data.location_type,
        });
      }

      SafeStorage.removeItem(PREFILL_STORAGE_KEY);
    } catch (error) {
      console.error('Error loading prefill data:', error);
    }
  }

  return { loadPrefillData };
}
