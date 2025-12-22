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
  onChange,
  placeholder = 'Enter event address',
  required = false,
}: AddressAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const autocompleteElementRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  const onChangeRef = useRef(onChange);

  // Keep the refs updated
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
        // Load the Places library
        await google.maps.importLibrary("places");

        console.log('[AddressAutocomplete] Creating PlaceAutocompleteElement...');

        // Create the web component
        const autocompleteElement = document.createElement('gmp-place-autocomplete') as any;
        autocompleteElement.setAttribute('component-restrictions-country', 'us');
        autocompleteElement.setAttribute('placeholder', placeholder);
        if (required) {
          autocompleteElement.setAttribute('required', 'true');
        }

        // Style the component to match our design
        autocompleteElement.style.width = '100%';

        // Add custom CSS to style the internal input
        const style = document.createElement('style');
        style.textContent = `
          gmp-place-autocomplete {
            width: 100%;
            display: block;
          }
          gmp-place-autocomplete input {
            width: 100% !important;
            padding: 0.5rem 0.75rem !important;
            border: 1px solid #d1d5db !important;
            border-radius: 0.375rem !important;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05) !important;
            font-size: 1rem !important;
            line-height: 1.5rem !important;
            color: #111827 !important;
            background-color: #ffffff !important;
            background: #ffffff !important;
          }
          gmp-place-autocomplete input:focus {
            outline: 2px solid #3b82f6 !important;
            outline-offset: 2px !important;
            border-color: #3b82f6 !important;
          }
        `;
        if (!document.getElementById('gmp-autocomplete-styles')) {
          style.id = 'gmp-autocomplete-styles';
          document.head.appendChild(style);
        }

        autocompleteElementRef.current = autocompleteElement;

        // Listen for place selection
        autocompleteElement.addEventListener('gmp-placeselect', async (event: any) => {
          console.log('[AddressAutocomplete] gmp-placeselect event fired!');
          const place = event.target.value;

          console.log('[AddressAutocomplete] Place object:', place);

          if (!place.location) {
            console.error('[AddressAutocomplete] No location found for place');
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

          console.log('[AddressAutocomplete] Parsed address result:', result);
          console.log('[AddressAutocomplete] Calling onSelect callback...');
          setError('');

          // Call onChange first with the formatted address
          if (onChangeRef.current) {
            onChangeRef.current(result.formatted_address);
          }

          // Then call onSelect with the full result
          try {
            onSelectRef.current(result);
            console.log('[AddressAutocomplete] onSelect callback completed successfully');
          } catch (error) {
            console.error('[AddressAutocomplete] Error in onSelect callback:', error);
          }
        });

        // Track input changes for clearing state
        const inputElement = autocompleteElement.querySelector('input');
        if (inputElement) {
          inputElement.addEventListener('input', (e: any) => {
            if (onChangeRef.current) {
              onChangeRef.current(e.target.value);
            }
          });
        }

        // Clear and add the element
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(autocompleteElement);

        console.log('[AddressAutocomplete] PlaceAutocompleteElement initialized successfully');
      } catch (error) {
        console.error('[AddressAutocomplete] Error creating autocomplete:', error);
        setError(`Error initializing address autocomplete: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Wait for importLibrary to be available
    const waitForImportLibrary = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        console.log('[AddressAutocomplete] Checking if importLibrary is available...');

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

          if (window.google?.maps?.importLibrary) {
            clearInterval(checkInterval);
            console.log(`[AddressAutocomplete] ✅ importLibrary became available after ${attempts} attempts!`);
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            console.error('[AddressAutocomplete] ❌ Timeout: importLibrary never became available');
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

      if (window.google?.maps?.importLibrary) {
        console.log('[AddressAutocomplete] importLibrary already available, initializing...');
        await initAutocomplete();
      } else if (existingScript) {
        console.log('[AddressAutocomplete] Script exists but not loaded yet, waiting...');
        try {
          await waitForImportLibrary();
          await initAutocomplete();
        } catch (error) {
          console.error('[AddressAutocomplete] Failed to initialize:', error);
          setError('Failed to initialize address autocomplete');
        }
      } else {
        console.log('[AddressAutocomplete] No existing script, loading new script...');
        // Load the script with the new API loader
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&v=weekly&loading=async`;
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
      // Clean up
      if (autocompleteElementRef.current) {
        autocompleteElementRef.current.remove();
      }
    };
  }, [placeholder, required]);

  // Sync the value prop with the web component's internal input
  useEffect(() => {
    if (autocompleteElementRef.current) {
      const inputElement = autocompleteElementRef.current.querySelector('input');
      if (inputElement && inputElement.value !== value) {
        console.log('[AddressAutocomplete] Syncing value to web component:', value);
        inputElement.value = value;
      }
    }
  }, [value]);

  return (
    <div>
      <div ref={containerRef} />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      {!import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
        <p className="mt-1 text-xs text-amber-600">
          Google Maps API key not configured. Using fallback mode.
        </p>
      )}
    </div>
  );
}
