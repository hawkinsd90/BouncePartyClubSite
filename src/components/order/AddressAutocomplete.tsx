import { useEffect, useRef, useState } from 'react';

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
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

export function AddressAutocomplete({
  value,
  onSelect,
  onChange,
  placeholder = 'Enter event address',
  required = false,
}: AddressAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState(value);
  const [error, setError] = useState('');
  const autocompleteRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);

  // Keep the ref updated
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

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

    async function initAutocomplete() {
      if (!containerRef.current) {
        console.error('[AddressAutocomplete] Container ref is null');
        return;
      }

      try {
        // Load the Places library using the modern importLibrary method
        const { PlaceAutocompleteElement } = await google.maps.importLibrary("places") as google.maps.PlacesLibrary;

        // Create the new PlaceAutocompleteElement
        const autocomplete = new PlaceAutocompleteElement({
          componentRestrictions: { country: 'us' },
        });

        autocomplete.addEventListener('gmp-placeselect', async (event: any) => {
          const place = event.place;

          if (!place.location) {
            console.log('[AddressAutocomplete] No location in place');
            setError('Please select a valid address from the dropdown');
            return;
          }

          await place.fetchFields({
            fields: ['addressComponents', 'formattedAddress', 'location']
          });

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

          console.log('[AddressAutocomplete] Address selected:', result);
          setInputValue(place.formattedAddress || '');
          setError('');
          onSelectRef.current(result);
        });

        // Set placeholder attribute
        autocomplete.setAttribute('placeholder', placeholder || 'Enter event address');

        // Add CSS to style the component
        if (!document.getElementById('gmp-autocomplete-styles')) {
          const styleSheet = document.createElement('style');
          styleSheet.id = 'gmp-autocomplete-styles';
          styleSheet.textContent = `
            gmp-place-autocomplete {
              width: 100%;
              display: block;
            }
          `;
          document.head.appendChild(styleSheet);
        }

        // Clear container and append
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(autocomplete);

        autocompleteRef.current = autocomplete;
      } catch (error) {
        console.error('[AddressAutocomplete] Error creating autocomplete:', error);
        setError('Error initializing address autocomplete');
      }
    }

    // Check if API is loaded
    const checkAndInit = async () => {
      if (window.google?.maps) {
        await initAutocomplete();
      } else {
        // Load the script with loading=async
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&loading=async`;
        script.async = true;
        script.defer = true;
        script.onload = () => initAutocomplete();
        script.onerror = (e) => {
          console.error('[AddressAutocomplete] Script failed to load:', e);
          setError('Failed to load address autocomplete');
        };
        document.head.appendChild(script);
      }
    };

    checkAndInit();

    return () => {
      if (autocompleteRef.current) {
        autocompleteRef.current.remove();
      }
    };
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className={`w-full ${error ? 'border-red-500' : ''}`}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <p className="mt-1 text-xs text-amber-600">
          Google Maps API key not configured. Using fallback mode.
        </p>
      )}
    </div>
  );
}
