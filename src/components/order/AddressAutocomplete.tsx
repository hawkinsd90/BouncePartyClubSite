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

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'gmp-place-autocomplete': any;
    }
  }
}

export function AddressAutocomplete({
  value,
  onSelect,
  placeholder = 'Enter event address',
  required = false,
}: AddressAutocompleteProps) {
  const autocompleteRef = useRef<any>(null);
  const [inputValue, setInputValue] = useState(value);
  const [error, setError] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      console.error('[AddressAutocomplete] No API key configured');
      setError('Address autocomplete not configured');
      return;
    }

    function initAutocomplete() {
      if (!autocompleteRef.current) {
        console.error('[AddressAutocomplete] Autocomplete ref is null');
        return;
      }

      try {
        const autocomplete = autocompleteRef.current;

        // Configure the autocomplete
        autocomplete.componentRestrictions = { country: 'us' };

        // Listen for place selection
        autocomplete.addEventListener('gmp-placeselect', async (event: any) => {
          const place = event.detail.place;

          try {
            // Fetch additional fields we need
            await place.fetchFields({
              fields: ['addressComponents', 'formattedAddress', 'location'],
            });

            if (!place.location) {
              setError('Please select a valid address from the dropdown');
              return;
            }

            const addressComponents = place.addressComponents || [];
            const street_number =
              addressComponents.find((c: any) => c.types.includes('street_number'))?.longText || '';
            const route =
              addressComponents.find((c: any) => c.types.includes('route'))?.longText || '';
            const city =
              addressComponents.find((c: any) => c.types.includes('locality'))?.longText || '';
            const state =
              addressComponents.find((c: any) =>
                c.types.includes('administrative_area_level_1')
              )?.shortText || '';
            const zip =
              addressComponents.find((c: any) => c.types.includes('postal_code'))?.longText || '';

            const result: AddressResult = {
              formatted_address: place.formattedAddress || '',
              street: `${street_number} ${route}`.trim(),
              city,
              state,
              zip,
              lat: place.location.lat(),
              lng: place.location.lng(),
            };

            setInputValue(place.formattedAddress || '');
            setError('');
            onSelect(result);
          } catch (error) {
            console.error('[AddressAutocomplete] Error processing place:', error);
            setError('Error processing selected address');
          }
        });

        setIsLoaded(true);
      } catch (error) {
        console.error('[AddressAutocomplete] Error initializing autocomplete:', error);
        setError('Error initializing address autocomplete');
      }
    }

    // Check if the API is already loaded
    if ((window as any).google?.maps?.places) {
      initAutocomplete();
    } else {
      const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');

      if (existingScript) {
        existingScript.addEventListener('load', initAutocomplete);
      } else {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
          initAutocomplete();
        };
        script.onerror = (e) => {
          console.error('[AddressAutocomplete] Script failed to load:', e);
          setError('Failed to load address autocomplete');
        };
        document.head.appendChild(script);
      }
    }
  }, [onSelect]);

  const handleInput = (e: any) => {
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

  // Fallback to regular input if no API key
  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
    return (
      <div>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => handleInput({ target: e.target })}
            onBlur={handleBlur}
            placeholder={placeholder}
            required={required}
            className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 ${
              error ? 'border-red-500' : 'border-slate-300'
            }`}
          />
        </div>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        <p className="mt-1 text-xs text-amber-600">
          Google Maps API key not configured. Using fallback mode.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 z-10 pointer-events-none" />
        <gmp-place-autocomplete
          ref={autocompleteRef}
          onInput={handleInput}
          onBlur={handleBlur}
          className="address-autocomplete-wrapper"
          style={{
            width: '100%',
            '--gmp-place-autocomplete-input-padding-left': '2.5rem',
            '--gmp-place-autocomplete-input-padding': '0.75rem',
            '--gmp-place-autocomplete-input-border-color': error ? '#ef4444' : '#cbd5e1',
            '--gmp-place-autocomplete-input-border-radius': '0.5rem',
            '--gmp-place-autocomplete-input-font-size': '1rem',
            '--gmp-place-autocomplete-input-focus-border-color': '#3b82f6',
          } as any}
        >
          {inputValue}
        </gmp-place-autocomplete>
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
