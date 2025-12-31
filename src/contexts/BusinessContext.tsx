import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../lib/supabase';

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
  business_address: '123 Main St, Wayne, MI 48184',
  business_phone: '(313) 889-3860',
  business_email: 'info@bouncepartyclub.com',
  business_website: 'https://bouncepartyclub.com',
  business_license_number: '',
};

const BusinessContext = createContext<BusinessSettings>(defaultSettings);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BusinessSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBusinessSettings();
  }, []);

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

      if (error) {
        console.error('Error loading business settings:', error);
        setLoading(false);
        return;
      }

      if (data && data.length > 0) {
        const newSettings = { ...defaultSettings };
        data.forEach(({ key, value }) => {
          if (key in newSettings) {
            newSettings[key as keyof BusinessSettings] = value || '';
          }
        });
        setSettings(newSettings);
      }
    } catch (error) {
      console.error('Error loading business settings:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return null;
  }

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
