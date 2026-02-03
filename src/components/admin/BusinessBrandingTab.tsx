import { useState, useEffect } from 'react';
import { Building2, Save, AlertCircle, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/notifications';
import { AddressAutocomplete } from '../order/AddressAutocomplete';

interface BusinessSettings {
  business_name: string;
  business_name_short: string;
  business_legal_entity: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  instagram_url: string;
  facebook_url: string;
  business_license_number: string;
}

interface TravelAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
}

export function BusinessBrandingTab() {
  const [settings, setSettings] = useState<BusinessSettings>({
    business_name: '',
    business_name_short: '',
    business_legal_entity: '',
    business_address: '',
    business_phone: '',
    business_email: '',
    instagram_url: '',
    facebook_url: '',
    business_license_number: '',
  });
  const [travelAddress, setTravelAddress] = useState<TravelAddress>({
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
    lat: 0,
    lng: 0,
  });
  const [useBusinessAddress, setUseBusinessAddress] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', [
          'business_name',
          'business_name_short',
          'business_legal_entity',
          'business_address',
          'business_phone',
          'business_email',
          'instagram_url',
          'facebook_url',
          'business_license_number',
          'home_address_line1',
          'home_address_line2',
          'home_address_city',
          'home_address_state',
          'home_address_zip',
          'home_address_lat',
          'home_address_lng',
          'use_business_address_for_travel',
        ]);

      if (error) throw error;

      if (data) {
        const loadedSettings = { ...settings };
        const loadedAddress = { ...travelAddress };
        let useBusinessAddrForTravel = true;

        data.forEach(({ key, value }) => {
          if (key in loadedSettings) {
            loadedSettings[key as keyof BusinessSettings] = value || '';
          }

          switch (key) {
            case 'home_address_line1':
              loadedAddress.line1 = value || '';
              break;
            case 'home_address_line2':
              loadedAddress.line2 = value || '';
              break;
            case 'home_address_city':
              loadedAddress.city = value || '';
              break;
            case 'home_address_state':
              loadedAddress.state = value || '';
              break;
            case 'home_address_zip':
              loadedAddress.zip = value || '';
              break;
            case 'home_address_lat':
              loadedAddress.lat = parseFloat(value || '0');
              break;
            case 'home_address_lng':
              loadedAddress.lng = parseFloat(value || '0');
              break;
            case 'use_business_address_for_travel':
              useBusinessAddrForTravel = value === 'true';
              break;
          }
        });

        setSettings(loadedSettings);
        setTravelAddress(loadedAddress);
        setUseBusinessAddress(useBusinessAddrForTravel);
      }
    } catch (error: any) {
      showToast('Error loading business settings: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    const effectiveTravelAddress = useBusinessAddress ? parseBusinessAddress() : travelAddress;

    if (!effectiveTravelAddress.line1 || !effectiveTravelAddress.city || !effectiveTravelAddress.state || !effectiveTravelAddress.zip) {
      showToast('Please fill in all address fields', 'error');
      return;
    }

    if (!effectiveTravelAddress.lat || !effectiveTravelAddress.lng) {
      showToast('Please select an address from the autocomplete dropdown to ensure accurate coordinates', 'error');
      return;
    }

    setSaving(true);
    try {
      const updates = [
        ...Object.entries(settings).map(([key, value]) => ({
          key,
          value,
        })),
        { key: 'home_address_line1', value: effectiveTravelAddress.line1 },
        { key: 'home_address_line2', value: effectiveTravelAddress.line2 },
        { key: 'home_address_city', value: effectiveTravelAddress.city },
        { key: 'home_address_state', value: effectiveTravelAddress.state },
        { key: 'home_address_zip', value: effectiveTravelAddress.zip },
        { key: 'home_address_lat', value: effectiveTravelAddress.lat.toString() },
        { key: 'home_address_lng', value: effectiveTravelAddress.lng.toString() },
        { key: 'use_business_address_for_travel', value: useBusinessAddress.toString() },
      ];

      for (const { key, value } of updates) {
        const { error } = await supabase
          .from('admin_settings')
          .upsert({ key, value, description: getDescription(key) }, { onConflict: 'key' });

        if (error) throw error;
      }

      showToast('Business branding settings saved successfully', 'success');
      window.location.reload();
    } catch (error: any) {
      showToast('Error saving settings: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function parseBusinessAddress(): TravelAddress {
    return travelAddress;
  }

  function getDescription(key: string): string {
    const descriptions: Record<string, string> = {
      business_name: 'Legal business name used in contracts and waivers',
      business_name_short: 'Short business name for SMS and emails',
      business_legal_entity: 'Full legal entity name including business structure',
      business_address: 'Physical business address for contracts',
      business_phone: 'Primary business phone number',
      business_email: 'Primary business email address',
      instagram_url: 'Instagram profile URL',
      facebook_url: 'Facebook page URL',
      business_license_number: 'Business license or registration number',
      home_address_line1: 'Travel calculation starting point - Address line 1',
      home_address_line2: 'Travel calculation starting point - Address line 2',
      home_address_city: 'Travel calculation starting point - City',
      home_address_state: 'Travel calculation starting point - State',
      home_address_zip: 'Travel calculation starting point - ZIP code',
      home_address_lat: 'Travel calculation starting point - Latitude',
      home_address_lng: 'Travel calculation starting point - Longitude',
      use_business_address_for_travel: 'Whether to use business address for travel calculations',
    };
    return descriptions[key] || '';
  }

  function handleAddressSelect(result: google.maps.places.PlaceResult) {
    if (!result.geometry?.location) return;

    const addressComponents = result.address_components || [];
    const getComponent = (type: string) =>
      addressComponents.find((c) => c.types.includes(type))?.long_name || '';

    const streetNumber = getComponent('street_number');
    const route = getComponent('route');
    const line1 = `${streetNumber} ${route}`.trim();

    setTravelAddress({
      line1,
      line2: '',
      city: getComponent('locality') || getComponent('sublocality'),
      state: getComponent('administrative_area_level_1'),
      zip: getComponent('postal_code'),
      lat: result.geometry.location.lat(),
      lng: result.geometry.location.lng(),
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
          <p className="text-slate-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center mb-6">
          <Building2 className="w-6 h-6 text-blue-600 mr-2" />
          <h2 className="text-2xl font-bold text-slate-900">Business Branding</h2>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">White-Label Configuration</p>
              <p>
                These settings control how your business name appears throughout the application,
                including contracts, waivers, emails, SMS messages, and customer-facing pages.
                Changes will take effect after saving and refreshing the page.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Name (Short) *
            </label>
            <input
              type="text"
              value={settings.business_name_short}
              onChange={(e) => setSettings({ ...settings, business_name_short: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Bounce Party Club"
            />
            <p className="text-xs text-slate-500 mt-1">
              Used in SMS, emails, and general display
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Legal Entity Name *
            </label>
            <input
              type="text"
              value={settings.business_legal_entity}
              onChange={(e) => setSettings({ ...settings, business_legal_entity: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Bounce Party Club LLC"
            />
            <p className="text-xs text-slate-500 mt-1">
              Full legal name used in contracts and waivers
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Address *
            </label>
            {useBusinessAddress ? (
              <>
                <AddressAutocomplete
                  value=""
                  onSelect={(result) => {
                    if (!result.geometry?.location) return;
                    const formatted = result.formatted_address || '';
                    setSettings({ ...settings, business_address: formatted });

                    // Update travel address with parsed components
                    const addressComponents = result.address_components || [];
                    const getComponent = (type: string) =>
                      addressComponents.find((c) => c.types.includes(type))?.long_name || '';
                    const streetNumber = getComponent('street_number');
                    const route = getComponent('route');
                    const line1 = `${streetNumber} ${route}`.trim();

                    setTravelAddress({
                      line1,
                      line2: '',
                      city: getComponent('locality') || getComponent('sublocality'),
                      state: getComponent('administrative_area_level_1'),
                      zip: getComponent('postal_code'),
                      lat: result.geometry.location.lat(),
                      lng: result.geometry.location.lng(),
                    });
                  }}
                />
                <input
                  type="text"
                  value={settings.business_address}
                  onChange={(e) => setSettings({ ...settings, business_address: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mt-2"
                  placeholder="4426 Woodward St, Wayne, MI 48184"
                />
              </>
            ) : (
              <input
                type="text"
                value={settings.business_address}
                onChange={(e) => setSettings({ ...settings, business_address: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="4426 Woodward St, Wayne, MI 48184"
              />
            )}
            <p className="text-xs text-slate-500 mt-1">
              {useBusinessAddress
                ? 'Use autocomplete to search, then adjust if needed. This will be used for travel calculations.'
                : 'Physical address for contracts and correspondence'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Phone *
            </label>
            <input
              type="tel"
              value={settings.business_phone}
              onChange={(e) => setSettings({ ...settings, business_phone: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="(555) 123-4567"
            />
            <p className="text-xs text-slate-500 mt-1">
              Primary phone number for customer contact
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business Email *
            </label>
            <input
              type="email"
              value={settings.business_email}
              onChange={(e) => setSettings({ ...settings, business_email: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="admin@bouncepartyclub.com"
            />
            <p className="text-xs text-slate-500 mt-1">
              Primary email for customer correspondence
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Instagram URL
            </label>
            <input
              type="url"
              value={settings.instagram_url}
              onChange={(e) => setSettings({ ...settings, instagram_url: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="http://instagram.com/bouncepartyclub"
            />
            <p className="text-xs text-slate-500 mt-1">
              Your Instagram profile URL
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Facebook URL
            </label>
            <input
              type="url"
              value={settings.facebook_url}
              onChange={(e) => setSettings({ ...settings, facebook_url: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://www.facebook.com/bouncepartyclub"
            />
            <p className="text-xs text-slate-500 mt-1">
              Your Facebook page URL
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Business License Number
            </label>
            <input
              type="text"
              value={settings.business_license_number}
              onChange={(e) => setSettings({ ...settings, business_license_number: e.target.value })}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Optional"
            />
            <p className="text-xs text-slate-500 mt-1">
              Optional: Business license or registration number
            </p>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t border-slate-200">
          <div className="flex items-center mb-4">
            <MapPin className="w-6 h-6 text-blue-600 mr-2" />
            <h3 className="text-xl font-bold text-slate-900">Travel Calculation Address</h3>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">Important</p>
                <p>
                  This address is used as the starting point for all travel fee calculations and determines
                  your base service radius. All distance measurements will be calculated from this location.
                </p>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={useBusinessAddress}
                onChange={(e) => setUseBusinessAddress(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm font-medium text-slate-700">
                Use business address for travel calculations
              </span>
            </label>
            <p className="text-xs text-slate-500 mt-1 ml-6">
              When checked, your business address will automatically be used for all distance calculations
            </p>
          </div>

          {!useBusinessAddress && (
            <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Search Address *
              </label>
              <AddressAutocomplete value="" onSelect={handleAddressSelect} />
              <p className="text-xs text-slate-600 mt-1">
                Start typing to search for your address with Google Maps
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Address Line 1 *
                </label>
                <input
                  type="text"
                  value={travelAddress.line1}
                  onChange={(e) => setTravelAddress({ ...travelAddress, line1: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="4426 Woodward St"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Address Line 2
                </label>
                <input
                  type="text"
                  value={travelAddress.line2}
                  onChange={(e) => setTravelAddress({ ...travelAddress, line2: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Suite, Unit, etc."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  City *
                </label>
                <input
                  type="text"
                  value={travelAddress.city}
                  onChange={(e) => setTravelAddress({ ...travelAddress, city: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Wayne"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  State *
                </label>
                <input
                  type="text"
                  value={travelAddress.state}
                  onChange={(e) => setTravelAddress({ ...travelAddress, state: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="MI"
                  maxLength={2}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  ZIP Code *
                </label>
                <input
                  type="text"
                  value={travelAddress.zip}
                  onChange={(e) => setTravelAddress({ ...travelAddress, zip: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="48184"
                />
              </div>

              <div>
                {travelAddress.lat !== 0 && travelAddress.lng !== 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm text-green-900">
                      <strong>Coordinates:</strong> {travelAddress.lat.toFixed(6)}, {travelAddress.lng.toFixed(6)}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
