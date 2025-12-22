import { useState, useEffect } from 'react';

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

  useEffect(() => {
    loadSavedForm();
  }, []);

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

  function loadSavedForm() {
    const savedFormData = localStorage.getItem(FORM_STORAGE_KEY);
    if (savedFormData) {
      try {
        const parsedFormData = JSON.parse(savedFormData);
        const { same_day_responsibility_accepted, overnight_responsibility_accepted, ...safeFormData } = parsedFormData;
        setFormData(prev => ({
          ...prev,
          ...safeFormData,
        }));

        if (parsedFormData.address_line1) {
          setAddressInput(
            `${parsedFormData.address_line1}, ${parsedFormData.city}, ${parsedFormData.state} ${parsedFormData.zip}`
          );
        }
      } catch (error) {
        console.error('Error loading saved form data:', error);
      }
    }
  }

  function updateFormData(updates: Partial<QuoteFormData>) {
    setFormData(prev => ({ ...prev, ...updates }));
  }

  function saveFormData() {
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(formData));
  }

  function clearForm() {
    setFormData(initialFormData);
    setAddressInput('');
    localStorage.removeItem(FORM_STORAGE_KEY);
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
