import { useState, useEffect } from 'react';
import { SafeStorage } from '../lib/safeStorage';

export interface QuoteFormData {
  event_date: string;
  event_end_date: string;
  start_window: string;
  end_window: string;
  until_end_of_day: boolean;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  location_type: 'residential' | 'commercial';
  pickup_preference: 'same_day' | 'next_day';
  same_day_responsibility_accepted: boolean;
  overnight_responsibility_accepted: boolean;
  can_stake: boolean;
  has_generator: boolean;
  has_pets: boolean;
  special_details: string;
}

const initialFormData: QuoteFormData = {
  event_date: '',
  event_end_date: '',
  start_window: '09:00',
  end_window: '17:00',
  until_end_of_day: false,
  address_line1: '',
  address_line2: '',
  city: 'Detroit',
  state: 'MI',
  zip: '',
  lat: 0,
  lng: 0,
  location_type: 'residential',
  pickup_preference: 'next_day',
  same_day_responsibility_accepted: false,
  overnight_responsibility_accepted: false,
  can_stake: true,
  has_generator: false,
  has_pets: false,
  special_details: '',
};

const FORM_STORAGE_KEY = 'bpc_quote_form';

export function useQuoteForm() {
  const [formData, setFormData] = useState<QuoteFormData>(initialFormData);
  const [addressInput, setAddressInput] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const prefillData = SafeStorage.getItem<any>('bpc_quote_prefill');
    if (prefillData) {
      applyPrefillData(prefillData);
      SafeStorage.setItem('bpc_prefill_applied', true, { expirationMinutes: 5 });
      SafeStorage.removeItem('bpc_quote_prefill');
    } else {
      loadSavedForm();
    }
    setIsInitialized(true);
  }, []);

  // Auto-save form data whenever it changes (after initial load)
  useEffect(() => {
    if (!isInitialized) return;

    // Debounce the save to avoid excessive writes
    const timeoutId = setTimeout(() => {
      // Only save if there's meaningful data
      if (formData.event_date || formData.address_line1) {
        SafeStorage.setItem(FORM_STORAGE_KEY, formData, { expirationDays: 7 });
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [formData, isInitialized]);

  // Auto-save address input separately for display purposes
  useEffect(() => {
    if (!isInitialized) return;

    const timeoutId = setTimeout(() => {
      if (addressInput) {
        SafeStorage.setItem('bpc_address_input', addressInput, { expirationDays: 7 });
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [addressInput, isInitialized]);

  useEffect(() => {
    if (formData.event_date && !formData.event_end_date) {
      setFormData(prev => ({ ...prev, event_end_date: prev.event_date }));
    }
  }, [formData.event_date]);

  useEffect(() => {
    if (formData.location_type === 'commercial') {
      setFormData(prev => ({ ...prev, pickup_preference: 'same_day' }));
    }
  }, [formData.location_type]);

  useEffect(() => {
    const isSameDayRestricted =
      (formData.location_type === 'residential' && formData.pickup_preference === 'same_day') ||
      formData.location_type === 'commercial';

    if (isSameDayRestricted) {
      setFormData(prev => ({
        ...prev,
        event_end_date: prev.event_date,
        until_end_of_day: false,
        end_window: prev.end_window > '19:00' ? '19:00' : prev.end_window,
      }));
    }
  }, [formData.pickup_preference, formData.location_type, formData.event_date]);

  useEffect(() => {
    async function geocodeAddress() {
      if (formData.city && formData.state && formData.zip && !formData.lat && !formData.lng) {
        try {
          const geocoder = new google.maps.Geocoder();
          const address = `${formData.city}, ${formData.state} ${formData.zip}`;
          const result = await geocoder.geocode({ address });

          if (result.results && result.results[0]) {
            const location = result.results[0].geometry.location;
            const lat = location.lat();
            const lng = location.lng();

            setFormData(prev => ({ ...prev, lat, lng }));
          }
        } catch (error) {
          console.error('Error geocoding address:', error);
        }
      }
    }

    geocodeAddress();
  }, [formData.city, formData.state, formData.zip, formData.lat, formData.lng]);

  function applyPrefillData(prefillData: any) {
    const isDuplicateOrder = SafeStorage.getItem<string>('bpc_duplicate_order') === 'true';

    if (prefillData.event_date) {
      setFormData(prev => ({
        ...prev,
        event_date: prefillData.event_date,
        event_end_date: prefillData.event_date,
      }));
    }

    if (prefillData.address) {
      const addr = prefillData.address;
      setAddressInput(addr.formatted_address || addr.street || '');
      setFormData(prev => ({
        ...prev,
        address_line1: addr.street || '',
        address_line2: addr.line2 || '',
        city: addr.city || 'Detroit',
        state: addr.state || 'MI',
        zip: addr.zip || '',
        lat: addr.lat || 0,
        lng: addr.lng || 0,
      }));
    }

    if (prefillData.location_type) {
      setFormData(prev => ({
        ...prev,
        location_type: prefillData.location_type,
      }));
    }

    if (isDuplicateOrder) {
      setFormData(prev => ({
        ...prev,
        pickup_preference: prefillData.pickup_preference || 'next_day',
        can_stake: prefillData.can_stake !== undefined ? prefillData.can_stake : true,
        has_generator: prefillData.has_generator !== undefined ? prefillData.has_generator : false,
        has_pets: prefillData.has_pets !== undefined ? prefillData.has_pets : false,
        special_details: prefillData.special_details || '',
        start_window: prefillData.start_window || '09:00',
        end_window: prefillData.end_window || '17:00',
      }));
      SafeStorage.removeItem('bpc_duplicate_order');
    }
  }

  function loadSavedForm() {
    const parsedFormData = SafeStorage.getItem<QuoteFormData>(FORM_STORAGE_KEY, {
      expirationDays: 7
    });

    if (parsedFormData) {
      const { same_day_responsibility_accepted, overnight_responsibility_accepted, ...safeFormData } = parsedFormData;
      setFormData(prev => ({
        ...prev,
        ...safeFormData,
      }));

      // Try to load saved address input first, fallback to constructing it
      const savedAddressInput = SafeStorage.getItem<string>('bpc_address_input', {
        expirationDays: 7
      });

      if (savedAddressInput) {
        setAddressInput(savedAddressInput);
      } else if (parsedFormData.address_line1) {
        setAddressInput(
          `${parsedFormData.address_line1}, ${parsedFormData.city}, ${parsedFormData.state} ${parsedFormData.zip}`
        );
      }
    }
  }

  function updateFormData(updates: Partial<QuoteFormData>) {
    setFormData(prev => ({ ...prev, ...updates }));
  }

  function saveFormData() {
    SafeStorage.setItem(FORM_STORAGE_KEY, formData, { expirationDays: 7 });
  }

  function clearForm() {
    setFormData(initialFormData);
    setAddressInput('');
    SafeStorage.removeItem(FORM_STORAGE_KEY);
    SafeStorage.removeItem('bpc_address_input');
    SafeStorage.removeItem('bpc_prefill_applied');
  }

  return {
    formData,
    setFormData,
    updateFormData,
    addressInput,
    setAddressInput,
    saveFormData,
    clearForm,
  };
}
