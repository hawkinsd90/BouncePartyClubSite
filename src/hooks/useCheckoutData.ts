import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { SafeStorage } from '../lib/safeStorage';
import { useAuth } from '../contexts/AuthContext';
import { useCustomerProfile } from '../contexts/CustomerProfileContext';

interface ContactData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
}

export function useCheckoutData(userId?: string) {
  const { user } = useAuth();
  const { sessionData, loading: profileLoading } = useCustomerProfile();
  const [quoteData, setQuoteData] = useState<any>(null);
  const [priceBreakdown, setPriceBreakdown] = useState<any>(null);
  const [cart, setCart] = useState<any[]>([]);
  const [contactData, setContactData] = useState<ContactData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    business_name: '',
  });
  const [billingAddress, setBillingAddress] = useState({
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
  });
  const [smsConsent, setSmsConsent] = useState(false);
  const [cardOnFileConsent, setCardOnFileConsent] = useState(false);
  const [tipAmount, setTipAmount] = useState<'none' | '10' | '15' | '20' | 'custom'>('none');
  const [customTip, setCustomTip] = useState('');
  const [loading, setLoading] = useState(true);
  const [profileApplied, setProfileApplied] = useState(false);

  useEffect(() => {
    if (user && !profileLoading && !profileApplied && sessionData.firstName) {
      if (!contactData.first_name) {
        setContactData({
          first_name: sessionData.firstName,
          last_name: sessionData.lastName,
          email: sessionData.email,
          phone: sessionData.phone,
          business_name: sessionData.businessName,
        });
      }
      if (!billingAddress.line1 && sessionData.addressLine1) {
        setBillingAddress({
          line1: sessionData.addressLine1,
          line2: sessionData.addressLine2,
          city: sessionData.city,
          state: sessionData.state,
          zip: sessionData.zip,
        });
      }
      setProfileApplied(true);
    }
  }, [user, profileLoading, sessionData, profileApplied, contactData.first_name, billingAddress.line1]);

  useEffect(() => {
    async function loadCheckoutData() {
      const savedForm = SafeStorage.getItem<any>('bpc_quote_form');
      const savedBreakdown = SafeStorage.getItem<any>('bpc_price_breakdown');
      const savedCart = SafeStorage.getItem<any[]>('bpc_cart');
      const savedContactData = SafeStorage.getItem<ContactData>('bpc_contact_data');
      const savedTip = SafeStorage.getItem<string>('test_booking_tip');

      if (!savedForm || !savedBreakdown || !savedCart) {
        setLoading(false);
        return;
      }

      setQuoteData(savedForm);
      setPriceBreakdown(savedBreakdown);

      const validCart = savedCart.filter((item: any) => {
        const isValid = item.unit_id && typeof item.unit_id === 'string' && item.unit_id !== 'undefined';
        if (!isValid) {
          // console.log('Checkout: Filtering out invalid cart item:', item);
        }
        return isValid;
      });

      if (validCart.length !== savedCart.length) {
        // console.log(`Checkout: Removed ${savedCart.length - validCart.length} invalid cart items`);
        SafeStorage.setItem('bpc_cart', validCart, { expirationDays: 7 });
      }

      setCart(validCart);

      let contactInfoLoaded = false;

      if (savedContactData) {
        // console.log('Using contact info from localStorage (test booking or cart)');
        setContactData({
          first_name: savedContactData.first_name || '',
          last_name: savedContactData.last_name || '',
          email: savedContactData.email || '',
          phone: savedContactData.phone || '',
          business_name: savedContactData.business_name || '',
        });
        contactInfoLoaded = true;
      }

      if (!contactInfoLoaded && userId) {
        try {
          const { data, error } = await supabase.rpc('get_user_order_prefill');

          if (error) {
            console.error('Error fetching user contact data:', error);
          } else if (data && (data as any).length > 0) {
            const userData = (data as any)[0];
            if (userData.first_name && userData.email) {
              // console.log('Auto-filling contact info with user data from database');
              setContactData({
                first_name: userData.first_name || '',
                last_name: userData.last_name || '',
                email: userData.email || '',
                phone: userData.phone || '',
                business_name: '',
              });
            }
          }
        } catch (error) {
          console.error('Error loading user contact data:', error);
        }
      }

      if (savedContactData) {
        setSmsConsent(true);
        setCardOnFileConsent(true);
      }

      if (savedTip) {
        const tipCents = parseInt(savedTip, 10);
        setCustomTip((tipCents / 100).toFixed(2));
        setTipAmount('custom');
        localStorage.removeItem('test_booking_tip');
      }

      setBillingAddress({
        line1: savedForm.address_line1 || '',
        line2: savedForm.address_line2 || '',
        city: savedForm.city || '',
        state: savedForm.state || '',
        zip: savedForm.zip || '',
      });

      setLoading(false);
    }

    loadCheckoutData();
  }, [userId]);

  return {
    quoteData,
    priceBreakdown,
    cart,
    contactData,
    setContactData,
    billingAddress,
    setBillingAddress,
    smsConsent,
    setSmsConsent,
    cardOnFileConsent,
    setCardOnFileConsent,
    tipAmount,
    setTipAmount,
    customTip,
    setCustomTip,
    loading,
  };
}
