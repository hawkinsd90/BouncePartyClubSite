import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { createLogger } from '../lib/logger';

const log = createLogger('CustomerProfile');

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

const MAX_RETRIES = 6;
const RETRY_DELAY_MS = 800;

export function CustomerProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [sessionData, setSessionData] = useState<SessionData>(getEmptySessionData());
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadProfileAndDefaults = async (userId: string, attempt = 0): Promise<void> => {
    try {
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('id, first_name, last_name, email, phone, business_name, default_address_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (customerError) {
        log.error('Error loading customer profile', customerError);
        setLoading(false);
        return;
      }

      if (!customerData) {
        if (attempt < MAX_RETRIES) {
          retryTimerRef.current = setTimeout(
            () => loadProfileAndDefaults(userId, attempt + 1),
            RETRY_DELAY_MS
          );
          return;
        }

        try {
          const { data: session } = await supabase.auth.getSession();
          if (session?.session?.access_token) {
            const response = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backfill-oauth-customers`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${session.session.access_token}`,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (response.ok) {
              await loadProfileAndDefaults(userId, 0);
              return;
            }
          }
        } catch (backfillError) {
          log.error('Backfill error', backfillError);
        }

        setLoading(false);
        return;
      }

      let defaultAddress: Address | null = null;

      const [addressResult, lastOrderResult] = await Promise.all([
        customerData.default_address_id
          ? supabase
              .from('addresses')
              .select('*')
              .eq('id', customerData.default_address_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('orders')
          .select('address_id, addresses(*)')
          .eq('customer_id', customerData.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (addressResult.data) {
        defaultAddress = {
          id: addressResult.data.id,
          line1: addressResult.data.line1,
          line2: addressResult.data.line2,
          city: addressResult.data.city,
          state: addressResult.data.state,
          zip: addressResult.data.zip,
        };
      } else if (lastOrderResult.data?.addresses) {
        defaultAddress = {
          id: lastOrderResult.data.addresses.id,
          line1: lastOrderResult.data.addresses.line1,
          line2: lastOrderResult.data.addresses.line2,
          city: lastOrderResult.data.addresses.city,
          state: lastOrderResult.data.addresses.state,
          zip: lastOrderResult.data.addresses.zip,
        };
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

      const resolvedAddress = profileData.defaultAddress;

      if (!initialized) {
        setSessionData({
          firstName: profileData.firstName,
          lastName: profileData.lastName,
          email: profileData.email,
          phone: profileData.phone,
          businessName: profileData.businessName || '',
          addressLine1: resolvedAddress?.line1 || '',
          addressLine2: resolvedAddress?.line2 || '',
          city: resolvedAddress?.city || '',
          state: resolvedAddress?.state || '',
          zip: resolvedAddress?.zip || '',
        });
        setInitialized(true);
      } else if (resolvedAddress?.line1) {
        setSessionData(prev => {
          if (prev.addressLine1) return prev;
          return {
            ...prev,
            addressLine1: resolvedAddress.line1,
            addressLine2: resolvedAddress.line2 || '',
            city: resolvedAddress.city || '',
            state: resolvedAddress.state || '',
            zip: resolvedAddress.zip || '',
          };
        });
      }
    } catch (err) {
      log.error('Error in loadProfileAndDefaults', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      setLoading(true);
      setInitialized(false);
      await loadProfileAndDefaults(user.id, 0);
    }
  };

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (user) {
      loadProfileAndDefaults(user.id, 0);
    } else {
      setProfile(null);
      setSessionData(getEmptySessionData());
      setLoading(false);
      setInitialized(false);
    }

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [user]);

  const updateSessionData = (data: Partial<SessionData>) => {
    setSessionData(prev => ({ ...prev, ...data }));
  };

  const resetSessionData = () => {
    if (profile) {
      setSessionData({
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
      });
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
