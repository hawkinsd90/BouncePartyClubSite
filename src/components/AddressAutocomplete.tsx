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

    console.log('[AddressAutocomplete] Initializing... API key present:', !!apiKey);

    if (!apiKey) {
      console.error('[AddressAutocomplete] No API key configured');
      setError('Address autocomplete not configured');
      return;
    }

    function initAutocomplete() {
      console.log('[AddressAutocomplete] initAutocomplete called');
      console.log('[AddressAutocomplete] inputRef.current:', inputRef.current);
      console.log('[AddressAutocomplete] window.google exists:', !!window.google);
      console.log('[AddressAutocomplete] window.google.maps exists:', !!window.google?.maps);
      console.log('[AddressAutocomplete] window.google.maps.places exists:', !!window.google?.maps?.places);

      if (!inputRef.current) {
        console.error('[AddressAutocomplete] Input ref is null');
        return;
      }

      if (!window.google?.maps?.places?.Autocomplete) {
        console.error('[AddressAutocomplete] Google Maps Places API not available');
        setError('Google Maps failed to load');
        return;
      }

      try {
        console.log('[AddressAutocomplete] Creating Autocomplete...');
        const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'us' },
          fields: ['address_components', 'formatted_address', 'geometry'],
        });
        console.log('[AddressAutocomplete] Autocomplete created successfully');

        autocomplete.addListener('place_changed', () => {
          console.log('[AddressAutocomplete] Place changed');
          const place = autocomplete.getPlace();
          console.log('[AddressAutocomplete] Place:', place);

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

          console.log('[AddressAutocomplete] Result:', result);
          setInputValue(place.formatted_address || '');
          setError('');
          onSelect(result);
        });

        autocompleteRef.current = autocomplete;
        console.log('[AddressAutocomplete] Setup complete');
      } catch (error) {
        console.error('[AddressAutocomplete] Error creating autocomplete:', error);
        setError('Error initializing address autocomplete');
      }
    }

    // Check if Google Maps is already loaded
    if (window.google?.maps?.places?.Autocomplete) {
      console.log('[AddressAutocomplete] Google Maps already loaded');
      initAutocomplete();
    } else {
      const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');

      if (existingScript) {
        console.log('[AddressAutocomplete] Script tag exists, waiting for load...');
        existingScript.addEventListener('load', initAutocomplete);
      } else {
        console.log('[AddressAutocomplete] Loading Google Maps script...');
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          console.log('[AddressAutocomplete] Script loaded successfully');
          initAutocomplete();
        };
        script.onerror = (e) => {
          console.error('[AddressAutocomplete] Script failed to load:', e);
          setError('Failed to load address autocomplete');
        };
        document.head.appendChild(script);
        console.log('[AddressAutocomplete] Script tag added to head');
      }
    }

    return () => {
      if (autocompleteRef.current && window.google?.maps?.event) {
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
