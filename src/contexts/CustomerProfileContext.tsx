import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';

interface Address {
  id: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
}

interface CustomerProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  businessName?: string | null;
  defaultAddress?: Address | null;
}

interface SessionData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  businessName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
}

interface CustomerProfileContextType {
  profile: CustomerProfile | null;
  sessionData: SessionData;
  updateSessionData: (data: Partial<SessionData>) => void;
  resetSessionData: () => void;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

const CustomerProfileContext = createContext<CustomerProfileContextType | undefined>(undefined);

const getEmptySessionData = (): SessionData => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  businessName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
});

export function CustomerProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [sessionData, setSessionData] = useState<SessionData>(getEmptySessionData());
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const loadProfileAndDefaults = async (userId: string) => {
    try {
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('id, first_name, last_name, email, phone, business_name, default_address_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (customerError) {
        console.error('Error loading customer profile:', customerError);
        return;
      }

      if (!customerData) {
        console.log('No customer record found, attempting to backfill...');
        try {
          const { data: session } = await supabase.auth.getSession();
          if (session?.session?.access_token) {
            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backfill-oauth-customers`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.session.access_token}`,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (response.ok) {
              const result = await response.json();
              console.log('Customer backfill result:', result);

              await loadProfileAndDefaults(userId);
              return;
            }
          }
        } catch (backfillError) {
          console.error('Error backfilling customer:', backfillError);
        }
        return;
      }

      let defaultAddress: Address | null = null;

      if (customerData.default_address_id) {
        const { data: addressData } = await supabase
          .from('addresses')
          .select('*')
          .eq('id', customerData.default_address_id)
          .maybeSingle();

        if (addressData) {
          defaultAddress = {
            id: addressData.id,
            line1: addressData.line1,
            line2: addressData.line2,
            city: addressData.city,
            state: addressData.state,
            zip: addressData.zip,
          };
        }
      }

      if (!defaultAddress) {
        const { data: lastOrder } = await supabase
          .from('orders')
          .select('address_id, addresses(*)')
          .eq('customer_id', customerData.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastOrder?.addresses) {
          defaultAddress = {
            id: lastOrder.addresses.id,
            line1: lastOrder.addresses.line1,
            line2: lastOrder.addresses.line2,
            city: lastOrder.addresses.city,
            state: lastOrder.addresses.state,
            zip: lastOrder.addresses.zip,
          };
        }
      }

      const profileData: CustomerProfile = {
        id: customerData.id,
        firstName: customerData.first_name,
        lastName: customerData.last_name,
        email: customerData.email,
        phone: customerData.phone,
        businessName: customerData.business_name,
        defaultAddress,
      };

      setProfile(profileData);

      if (!initialized) {
        const newSessionData: SessionData = {
          firstName: profileData.firstName,
          lastName: profileData.lastName,
          email: profileData.email,
          phone: profileData.phone,
          businessName: profileData.businessName || '',
          addressLine1: profileData.defaultAddress?.line1 || '',
          addressLine2: profileData.defaultAddress?.line2 || '',
          city: profileData.defaultAddress?.city || '',
          state: profileData.defaultAddress?.state || '',
          zip: profileData.defaultAddress?.zip || '',
        };
        setSessionData(newSessionData);
        setInitialized(true);
      }
    } catch (err) {
      console.error('Error in loadProfileAndDefaults:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      setLoading(true);
      await loadProfileAndDefaults(user.id);
    }
  };

  useEffect(() => {
    if (user) {
      loadProfileAndDefaults(user.id);
    } else {
      setProfile(null);
      setSessionData(getEmptySessionData());
      setLoading(false);
      setInitialized(false);
    }
  }, [user]);

  const updateSessionData = (data: Partial<SessionData>) => {
    setSessionData(prev => ({ ...prev, ...data }));
  };

  const resetSessionData = () => {
    if (profile) {
      const newSessionData: SessionData = {
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        phone: profile.phone,
        businessName: profile.businessName || '',
        addressLine1: profile.defaultAddress?.line1 || '',
        addressLine2: profile.defaultAddress?.line2 || '',
        city: profile.defaultAddress?.city || '',
        state: profile.defaultAddress?.state || '',
        zip: profile.defaultAddress?.zip || '',
      };
      setSessionData(newSessionData);
    } else {
      setSessionData(getEmptySessionData());
    }
  };

  return (
    <CustomerProfileContext.Provider
      value={{
        profile,
        sessionData,
        updateSessionData,
        resetSessionData,
        loading,
        refreshProfile,
      }}
    >
      {children}
    </CustomerProfileContext.Provider>
  );
}

export function useCustomerProfile() {
  const context = useContext(CustomerProfileContext);
  if (context === undefined) {
    throw new Error('useCustomerProfile must be used within a CustomerProfileProvider');
  }
  return context;
}
