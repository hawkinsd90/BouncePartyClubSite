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
        await google.maps.importLibrary("places");

        // Wait for the custom element to be defined (with timeout)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout waiting for gmp-place-autocomplete')), 10000)
        );
        await Promise.race([
          customElements.whenDefined('gmp-place-autocomplete'),
          timeoutPromise
        ]);

        // Create the PlaceAutocompleteElement web component
        const autocompleteElement = document.createElement('gmp-place-autocomplete') as any;

        // Set attributes
        autocompleteElement.setAttribute('placeholder', placeholder);
        autocompleteElement.setAttribute('country', 'us');

        // Track if we're currently selecting a place
        let isSelectingPlace = false;
        let lastSelectedAddress = '';

        // Listen for place selection
        autocompleteElement.addEventListener('gmp-placeselect', async (event: any) => {
          console.log('[AddressAutocomplete] gmp-placeselect event fired!', event);
          isSelectingPlace = true;
          const place = event.place;

          if (!place) {
            console.log('[AddressAutocomplete] No place in event');
            isSelectingPlace = false;
            return;
          }

          console.log('[AddressAutocomplete] Fetching place fields...');
          // Fetch the required fields
          await place.fetchFields({
            fields: ['addressComponents', 'formattedAddress', 'location']
          });

          console.log('[AddressAutocomplete] Place fields fetched:', {
            formattedAddress: place.formattedAddress,
            hasLocation: !!place.location,
            addressComponents: place.addressComponents
          });

          if (!place.location) {
            console.error('[AddressAutocomplete] No location found for place');
            setError('Please select a valid address from the dropdown');
            isSelectingPlace = false;
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

          lastSelectedAddress = result.formatted_address;
          console.log('[AddressAutocomplete] Parsed address result:', result);
          console.log('[AddressAutocomplete] Calling onSelect callback...');
          setError('');
          onSelectRef.current(result);
          console.log('[AddressAutocomplete] onSelect callback completed');

          // Longer delay to ensure all events complete
          setTimeout(() => {
            isSelectingPlace = false;
          }, 500);
        });

        // Listen for input changes
        if (onChange) {
          autocompleteElement.addEventListener('input', (event: any) => {
            const inputElement = event.target?.querySelector?.('input') || event.target;
            const value = inputElement?.value || '';

            console.log('[AddressAutocomplete] Input event fired, value:', value, 'isSelectingPlace:', isSelectingPlace, 'lastSelected:', lastSelectedAddress);

            // Don't call onChange if we're in the middle of selecting a place
            // or if the value matches what we just selected
            if (isSelectingPlace || value === lastSelectedAddress) {
              console.log('[AddressAutocomplete] Ignoring input event - place selection in progress or value matches selected');
              return;
            }

            onChange(value);
          });
        }

        // Add global styles for the autocomplete element
        if (!document.getElementById('gmp-autocomplete-styles')) {
          const styleSheet = document.createElement('style');
          styleSheet.id = 'gmp-autocomplete-styles';
          styleSheet.textContent = `
            gmp-place-autocomplete {
              width: 100%;
              display: block;
              background: white;
            }
            gmp-place-autocomplete::part(input) {
              background-color: white !important;
              color: #1f2937 !important;
            }
          `;
          document.head.appendChild(styleSheet);
        }

        // Set CSS custom properties via inline style attribute
        autocompleteElement.setAttribute('style', `
          width: 100%;
          --gmp-input-background-color: white;
          --gmp-input-text-color: #1f2937;
          --gmp-input-border-color: #d1d5db;
          --gmp-input-border-radius: 0.375rem;
          --gmp-input-padding: 0.5rem 0.75rem;
          --gmp-input-font-size: 0.875rem;
          --gmp-input-font-family: system-ui, -apple-system, sans-serif;
        `);

        // Clear container and append the element
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(autocompleteElement);
        autocompleteElementRef.current = autocompleteElement;
      } catch (error) {
        console.error('[AddressAutocomplete] Error creating autocomplete:', error);
        setError(`Error initializing address autocomplete: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Wait for importLibrary to be available
    const waitForImportLibrary = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        console.log('[AddressAutocomplete] Checking if importLibrary is available...');
        console.log('[AddressAutocomplete] window.google exists:', !!window.google);
        console.log('[AddressAutocomplete] window.google.maps exists:', !!window.google?.maps);
        console.log('[AddressAutocomplete] window.google.maps.importLibrary exists:', !!window.google?.maps?.importLibrary);

        if (window.google?.maps?.importLibrary) {
          console.log('[AddressAutocomplete] importLibrary already available!');
          resolve();
          return;
        }

        console.log('[AddressAutocomplete] Starting polling for importLibrary...');
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max
        const checkInterval = setInterval(() => {
          attempts++;
          console.log(`[AddressAutocomplete] Poll attempt ${attempts}/${maxAttempts}...`);
          console.log('[AddressAutocomplete] window.google:', !!window.google);
          console.log('[AddressAutocomplete] window.google.maps:', !!window.google?.maps);
          console.log('[AddressAutocomplete] window.google.maps.importLibrary:', !!window.google?.maps?.importLibrary);

          if (window.google?.maps?.importLibrary) {
            clearInterval(checkInterval);
            console.log(`[AddressAutocomplete] ✅ importLibrary became available after ${attempts} attempts!`);
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            console.error('[AddressAutocomplete] ❌ Timeout: importLibrary never became available');
            console.error('[AddressAutocomplete] Final state - window.google:', window.google);
            console.error('[AddressAutocomplete] Final state - window.google.maps:', window.google?.maps);
            reject(new Error('Timeout waiting for Google Maps API'));
          }
        }, 100);
      });
    };

    // Check if API is loaded
    const checkAndInit = async () => {
      console.log('[AddressAutocomplete] checkAndInit called');
      const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
      console.log('[AddressAutocomplete] Existing script found:', !!existingScript);
      if (existingScript) {
        console.log('[AddressAutocomplete] Existing script src:', existingScript.getAttribute('src'));
      }

      if (window.google?.maps?.importLibrary) {
        console.log('[AddressAutocomplete] importLibrary already available, initializing...');
        await initAutocomplete();
      } else if (existingScript) {
        console.log('[AddressAutocomplete] Script exists but not loaded yet, waiting for load event...');
        existingScript.addEventListener('load', async () => {
          console.log('[AddressAutocomplete] Script load event fired!');
          try {
            await waitForImportLibrary();
            await initAutocomplete();
          } catch (error) {
            console.error('[AddressAutocomplete] Failed to initialize:', error);
            setError('Failed to initialize address autocomplete');
          }
        });
      } else {
        console.log('[AddressAutocomplete] No existing script, loading new script...');
        // Load the script with the new API loader
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async`;
        console.log('[AddressAutocomplete] Script src:', script.src);
        script.async = true;
        script.defer = true;
        script.onload = async () => {
          console.log('[AddressAutocomplete] Script onload fired!');
          try {
            await waitForImportLibrary();
            await initAutocomplete();
          } catch (error) {
            console.error('[AddressAutocomplete] Failed to initialize:', error);
            setError('Failed to initialize address autocomplete');
          }
        };
        script.onerror = (e) => {
          console.error('[AddressAutocomplete] Script failed to load:', e);
          setError('Failed to load address autocomplete');
        };
        document.head.appendChild(script);
        console.log('[AddressAutocomplete] Script appended to head');
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
