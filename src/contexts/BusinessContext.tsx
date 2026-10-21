import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { getBusinessAddressText, getPublicBusinessSettings } from '../lib/core/adminSettingsCache';

export interface BusinessSettings {
  business_name: string;
  business_name_short: string;
  business_legal_entity: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  business_website: string;
  business_license_number: string;
}

const defaultSettings: BusinessSettings = {
  business_name: 'Bounce Party Club',
  business_name_short: 'Bounce Party Club',
  business_legal_entity: 'Bounce Party Club LLC',
  business_address: '',
  business_phone: '(313) 889-3860',
  business_email: 'info@bouncepartyclub.com',
  business_website: 'https://bouncepartyclub.com',
  business_license_number: '',
};

const BusinessContext = createContext<BusinessSettings>(defaultSettings);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings);

  useEffect(() => {
    let cancelled = false;

    async function loadBusinessSettings() {
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
            'business_website',
            'business_license_number',
          ]);

        if (cancelled) return;

        // Signed-out visitors hold no privilege on admin_settings (the table also holds provider credentials), so this read may be
        // refused for them. That is not a failure: the public values come from get_public_business_settings via the address helper
        // below, exactly as when the read used to return no rows. Any other error is still reported.
        const refusedForVisitor = error && (error.code === '42501' || /permission denied/i.test(error.message ?? ''));
        if (error && !refusedForVisitor) {
          console.error('Error loading business settings:', error);
          return;
        }

        const newSettings = { ...defaultSettings };

        if (!error && data && data.length > 0) {
          data.forEach(({ key, value }) => {
            if (key in newSettings) {
              newSettings[key as keyof BusinessSettings] = value || '';
            }
          });
        }

        // Visitors cannot read admin_settings; take the public fields from the public RPC instead of the hard-coded defaults,
        // so edited business name, phone and e-mail reach signed-out pages too. Only keys that RPC exposes are used.
        if (refusedForVisitor) {
          const pub = await getPublicBusinessSettings();
          if (pub.business_name) newSettings.business_name = pub.business_name;
          if (pub.business_phone) newSettings.business_phone = pub.business_phone;
          if (pub.business_email) newSettings.business_email = pub.business_email;
        }

        // Load business address using the centralized helper
        const businessAddress = await getBusinessAddressText();

        if (cancelled) return;

        newSettings.business_address = businessAddress;

        setSettings(newSettings);
      } catch (error) {
        if (!cancelled) {
          console.error('Error loading business settings:', error);
        }
      }
    }

    loadBusinessSettings();

    return () => { cancelled = true; };
  }, []);

  return (
    <BusinessContext.Provider value={settings}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinessSettings() {
  const context = useContext(BusinessContext);
  if (!context) {
    throw new Error('useBusinessSettings must be used within BusinessProvider');
  }
  return context;
}
