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
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
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
      if (!inputRef.current) {
        console.error('[AddressAutocomplete] Input ref is null');
        return;
      }

      try {
        // Load the Places library
        const placesLib = await google.maps.importLibrary("places") as google.maps.PlacesLibrary;

        console.log('[AddressAutocomplete] Creating Autocomplete instance...');

        // Create traditional Autocomplete on the input element
        const autocomplete = new placesLib.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'us' },
          fields: ['address_components', 'formatted_address', 'geometry']
        });

        autocompleteRef.current = autocomplete;
        console.log('[AddressAutocomplete] Autocomplete instance created');

        // Listen for place selection
        autocomplete.addListener('place_changed', () => {
          console.log('[AddressAutocomplete] place_changed event fired!');
          const place = autocomplete.getPlace();

          console.log('[AddressAutocomplete] Place object:', place);

          if (!place.geometry || !place.geometry.location) {
            console.error('[AddressAutocomplete] No geometry found for place');
            setError('Please select a valid address from the dropdown');
            return;
          }

          const addressComponents = place.address_components || [];
          const street_number =
            addressComponents.find((c: any) => c.types.includes('street_number'))?.long_name || '';
          const route =
            addressComponents.find((c: any) => c.types.includes('route'))?.long_name || '';
          const city =
            addressComponents.find((c: any) => c.types.includes('locality'))?.long_name || '';
          const state =
            addressComponents.find((c: any) =>
              c.types.includes('administrative_area_level_1')
            )?.short_name || '';
          const zip =
            addressComponents.find((c: any) => c.types.includes('postal_code'))?.long_name || '';

          const result: AddressResult = {
            formatted_address: place.formatted_address || '',
            street: `${street_number} ${route}`.trim(),
            city,
            state,
            zip,
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
          };

          console.log('[AddressAutocomplete] Parsed address result:', result);
          console.log('[AddressAutocomplete] Calling onSelect callback...');
          setError('');

          // Call the callback
          try {
            onSelectRef.current(result);
            console.log('[AddressAutocomplete] onSelect callback completed successfully');
          } catch (error) {
            console.error('[AddressAutocomplete] Error in onSelect callback:', error);
          }
        });

        console.log('[AddressAutocomplete] Autocomplete initialized successfully');
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
      // Clean up autocomplete listeners
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [placeholder]);

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
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
