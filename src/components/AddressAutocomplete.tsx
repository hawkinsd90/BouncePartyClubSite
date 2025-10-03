import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

interface AddressResult {
  formatted_address: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
}

interface AddressAutocompleteProps {
  value: string;
  onSelect: (address: AddressResult) => void;
  placeholder?: string;
  required?: boolean;
}

export function AddressAutocomplete({
  value,
  onSelect,
  placeholder = 'Enter event address',
  required = false,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(value);
  const [error, setError] = useState('');
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      console.warn('Google Maps API key not configured');
      return;
    }

    if (!window.google) {
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = initAutocomplete;
      document.head.appendChild(script);
    } else {
      initAutocomplete();
    }

    function initAutocomplete() {
      if (!inputRef.current || !window.google) return;

      const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'us' },
        fields: ['address_components', 'formatted_address', 'geometry'],
      });

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();

        if (!place.geometry || !place.geometry.location) {
          setError('Please select a valid address from the dropdown');
          return;
        }

        const addressComponents = place.address_components || [];
        const street_number =
          addressComponents.find((c) => c.types.includes('street_number'))?.long_name || '';
        const route =
          addressComponents.find((c) => c.types.includes('route'))?.long_name || '';
        const city =
          addressComponents.find((c) => c.types.includes('locality'))?.long_name || '';
        const state =
          addressComponents.find((c) =>
            c.types.includes('administrative_area_level_1')
          )?.short_name || '';
        const zip =
          addressComponents.find((c) => c.types.includes('postal_code'))?.long_name || '';

        const result: AddressResult = {
          formatted_address: place.formatted_address || '',
          street: `${street_number} ${route}`.trim(),
          city,
          state,
          zip,
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
        };

        setInputValue(place.formatted_address || '');
        setError('');
        onSelect(result);
      });

      autocompleteRef.current = autocomplete;
    }

    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [onSelect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && newValue) {
      onSelect({
        formatted_address: newValue,
        street: newValue,
        city: 'Detroit',
        state: 'MI',
        zip: '48201',
        lat: 42.3314,
        lng: -83.0458,
      });
      setError('');
    } else if (error) {
      setError('Please select a valid address from the dropdown');
    }
  };

  const handleBlur = () => {
    if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
      return;
    }
    if (required && !value && inputValue) {
      setError('Please select a valid address from the dropdown');
    }
  };

  return (
    <div>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 ${
            error ? 'border-red-500' : 'border-slate-300'
          }`}
        />
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <p className="mt-1 text-xs text-amber-600">
          Google Maps API key not configured. Using fallback mode.
        </p>
      )}
    </div>
  );
}
