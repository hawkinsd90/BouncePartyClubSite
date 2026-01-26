import { useState, useEffect } from 'react';
import { MapPin, Save, Edit2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { notifyError, notifySuccess } from '../../lib/notifications';
import { AddressAutocomplete } from '../order/AddressAutocomplete';

interface BusinessAddressTabProps {
  onAddressUpdate?: () => void;
}

interface AddressData {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
}

export function BusinessAddressTab({ onAddressUpdate }: BusinessAddressTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [address, setAddress] = useState<AddressData>({
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
    lat: 0,
    lng: 0,
  });
  const [editedAddress, setEditedAddress] = useState<AddressData>(address);

  useEffect(() => {
    loadAddress();
  }, []);

  const loadAddress = async () => {
    try {
      const { data, error } = await supabase
        .from('admin_settings')
        .select('key, value')
        .in('key', [
          'home_address_line1',
          'home_address_line2',
          'home_address_city',
          'home_address_state',
          'home_address_zip',
          'home_address_lat',
          'home_address_lng',
        ]);

      if (error) throw error;

      const addressData: AddressData = {
        line1: '',
        line2: '',
        city: '',
        state: '',
        zip: '',
        lat: 0,
        lng: 0,
      };

      data?.forEach((setting) => {
        switch (setting.key) {
          case 'home_address_line1':
            addressData.line1 = setting.value || '';
            break;
          case 'home_address_line2':
            addressData.line2 = setting.value || '';
            break;
          case 'home_address_city':
            addressData.city = setting.value || '';
            break;
          case 'home_address_state':
            addressData.state = setting.value || '';
            break;
          case 'home_address_zip':
            addressData.zip = setting.value || '';
            break;
          case 'home_address_lat':
            addressData.lat = parseFloat(setting.value || '0');
            break;
          case 'home_address_lng':
            addressData.lng = parseFloat(setting.value || '0');
            break;
        }
      });

      setAddress(addressData);
      setEditedAddress(addressData);
    } catch (error: any) {
      notifyError('Failed to load business address: ' + error.message);
    }
  };

  const handleAddressSelect = (result: google.maps.places.PlaceResult) => {
    if (!result.geometry?.location) return;

    const addressComponents = result.address_components || [];
    const getComponent = (type: string) =>
      addressComponents.find((c) => c.types.includes(type))?.long_name || '';

    const streetNumber = getComponent('street_number');
    const route = getComponent('route');
    const line1 = `${streetNumber} ${route}`.trim();

    setEditedAddress({
      line1,
      line2: '',
      city: getComponent('locality') || getComponent('sublocality'),
      state: getComponent('administrative_area_level_1'),
      zip: getComponent('postal_code'),
      lat: result.geometry.location.lat(),
      lng: result.geometry.location.lng(),
    });
  };

  const handleSave = async () => {
    if (!editedAddress.line1 || !editedAddress.city || !editedAddress.state || !editedAddress.zip) {
      notifyError('Please fill in all required address fields');
      return;
    }

    if (!editedAddress.lat || !editedAddress.lng) {
      notifyError('Please select an address from the autocomplete dropdown to ensure accurate coordinates');
      return;
    }

    setSaving(true);
    try {
      const updates = [
        { key: 'home_address_line1', value: editedAddress.line1 },
        { key: 'home_address_line2', value: editedAddress.line2 },
        { key: 'home_address_city', value: editedAddress.city },
        { key: 'home_address_state', value: editedAddress.state },
        { key: 'home_address_zip', value: editedAddress.zip },
        { key: 'home_address_lat', value: editedAddress.lat.toString() },
        { key: 'home_address_lng', value: editedAddress.lng.toString() },
      ];

      for (const update of updates) {
        const { error } = await supabase
          .from('admin_settings')
          .upsert({
            key: update.key,
            value: update.value,
            updated_at: new Date().toISOString(),
          });

        if (error) throw error;
      }

      setAddress(editedAddress);
      setIsEditing(false);
      notifySuccess('Business address updated successfully');

      if (onAddressUpdate) {
        onAddressUpdate();
      }
    } catch (error: any) {
      notifyError('Failed to save address: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedAddress(address);
    setIsEditing(false);
  };

  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MapPin className="w-6 h-6 text-blue-600" />
          <h2 className="text-2xl font-bold text-slate-900">Business Address</h2>
        </div>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            <Edit2 className="w-4 h-4 mr-2" />
            Edit Address
          </button>
        )}
        {isEditing && (
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center bg-slate-500 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-900">
            <strong>Important:</strong> This address is used as the starting point for all travel fee
            calculations and determines your base service radius. All distance measurements will be calculated
            from this location.
          </p>
        </div>

        {isEditing ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Search Address <span className="text-red-600">*</span>
              </label>
              <AddressAutocomplete onAddressSelect={handleAddressSelect} />
              <p className="text-xs text-slate-600 mt-1">
                Start typing to search for your business address
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Address Line 1 <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={editedAddress.line1}
                onChange={(e) => setEditedAddress({ ...editedAddress, line1: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="123 Main St"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Address Line 2</label>
              <input
                type="text"
                value={editedAddress.line2}
                onChange={(e) => setEditedAddress({ ...editedAddress, line2: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Suite 100"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  City <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={editedAddress.city}
                  onChange={(e) => setEditedAddress({ ...editedAddress, city: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="City"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  State <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={editedAddress.state}
                  onChange={(e) => setEditedAddress({ ...editedAddress, state: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="MI"
                  maxLength={2}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                ZIP Code <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={editedAddress.zip}
                onChange={(e) => setEditedAddress({ ...editedAddress, zip: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="48184"
              />
            </div>

            {editedAddress.lat !== 0 && editedAddress.lng !== 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-900">
                  <strong>Coordinates confirmed:</strong> {editedAddress.lat.toFixed(6)},{' '}
                  {editedAddress.lng.toFixed(6)}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Address</p>
              <p className="text-slate-900">{address.line1}</p>
              {address.line2 && <p className="text-slate-900">{address.line2}</p>}
              <p className="text-slate-900">
                {address.city}, {address.state} {address.zip}
              </p>
            </div>

            {address.lat !== 0 && address.lng !== 0 && (
              <div>
                <p className="text-sm font-medium text-slate-700">Coordinates</p>
                <p className="text-sm text-slate-600">
                  {address.lat.toFixed(6)}, {address.lng.toFixed(6)}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
