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
  const [error, setError] = useState('');
  const autocompleteElementRef = useRef<HTMLElement | null>(null);
  const onSelectRef = useRef(onSelect);

  // Keep the ref updated
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

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
        // Load the Places library to ensure the web component is available
        console.log('[AddressAutocomplete] Loading Places library...');
        await google.maps.importLibrary("places");
        console.log('[AddressAutocomplete] Places library loaded');

        // Wait for the custom element to be defined (with timeout)
        console.log('[AddressAutocomplete] Waiting for gmp-place-autocomplete to be defined...');
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for gmp-place-autocomplete')), 10000)
        );
        await Promise.race([
          customElements.whenDefined('gmp-place-autocomplete'),
          timeoutPromise
        ]);
        console.log('[AddressAutocomplete] gmp-place-autocomplete is defined');

        // Create the PlaceAutocompleteElement web component
        const autocompleteElement = document.createElement('gmp-place-autocomplete') as any;
        console.log('[AddressAutocomplete] Created element:', autocompleteElement);

        // Set attributes
        autocompleteElement.setAttribute('placeholder', placeholder);
        autocompleteElement.setAttribute('country', 'us');

        // Listen for place selection
        autocompleteElement.addEventListener('gmp-placeselect', async (event: any) => {
          const place = event.place;

          if (!place) {
            console.log('[AddressAutocomplete] No place in event');
            return;
          }

          // Fetch the required fields
          await place.fetchFields({
            fields: ['addressComponents', 'formattedAddress', 'location']
          });

          if (!place.location) {
            console.log('[AddressAutocomplete] No location in place');
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

          console.log('[AddressAutocomplete] Address selected:', result);
          setError('');
          onSelectRef.current(result);
        });

        // Add global styles for the autocomplete element
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

        // Clear container and append the element
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(autocompleteElement);
        autocompleteElementRef.current = autocompleteElement;

        console.log('[AddressAutocomplete] PlaceAutocompleteElement initialized');
      } catch (error) {
        console.error('[AddressAutocomplete] Error creating autocomplete:', error);
        console.error('[AddressAutocomplete] Error details:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        });
        setError(`Error initializing address autocomplete: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Check if API is loaded
    const checkAndInit = async () => {
      const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');

      if (window.google?.maps) {
        await initAutocomplete();
      } else if (existingScript) {
        existingScript.addEventListener('load', initAutocomplete);
      } else {
        // Load the script
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
      if (autocompleteElementRef.current) {
        autocompleteElementRef.current.remove();
      }
    };
  }, [placeholder]);

  return (
    <div>
      <div ref={containerRef} className="w-full" />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <p className="mt-1 text-xs text-amber-600">
          Google Maps API key not configured. Using fallback mode.
        </p>
      )}
    </div>
  );
}
