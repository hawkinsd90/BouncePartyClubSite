import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface ContactData {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  business_name: string;
}

interface CheckoutData {
  quoteData: any;
  priceBreakdown: any;
  cart: any[];
  contactData: ContactData;
  billingAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  smsConsent: boolean;
  cardOnFileConsent: boolean;
  tipAmount: string;
  customTip: string;
}

export function useCheckoutData(userId?: string) {
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

  useEffect(() => {
    async function loadCheckoutData() {
      const savedForm = localStorage.getItem('bpc_quote_form');
      const savedBreakdown = localStorage.getItem('bpc_price_breakdown');
      const savedCart = localStorage.getItem('bpc_cart');
      const savedContactData = localStorage.getItem('bpc_contact_data');
      const savedTip = localStorage.getItem('test_booking_tip');

      if (!savedForm || !savedBreakdown || !savedCart) {
        setLoading(false);
        return;
      }

      const formData = JSON.parse(savedForm);
      setQuoteData(formData);
      setPriceBreakdown(JSON.parse(savedBreakdown));

      const cartData = JSON.parse(savedCart);
      const validCart = cartData.filter((item: any) => {
        const isValid = item.unit_id && typeof item.unit_id === 'string' && item.unit_id !== 'undefined';
        if (!isValid) {
          console.log('Checkout: Filtering out invalid cart item:', item);
        }
        return isValid;
      });

      if (validCart.length !== cartData.length) {
        console.log(`Checkout: Removed ${cartData.length - validCart.length} invalid cart items`);
        localStorage.setItem('bpc_cart', JSON.stringify(validCart));
      }

      setCart(validCart);

      let contactInfoLoaded = false;

      if (savedContactData) {
        console.log('Using contact info from localStorage (test booking or cart)');
        const contactInfo = JSON.parse(savedContactData);
        setContactData({
          first_name: contactInfo.first_name || '',
          last_name: contactInfo.last_name || '',
          email: contactInfo.email || '',
          phone: contactInfo.phone || '',
          business_name: contactInfo.business_name || '',
        });
        contactInfoLoaded = true;
      }

      if (!contactInfoLoaded && userId) {
        try {
          const { data, error } = await supabase.rpc('get_user_order_prefill');

          if (error) {
            console.error('Error fetching user contact data:', error);
          } else if (data && data.length > 0) {
            const userData = data[0];
            if (userData.first_name && userData.email) {
              console.log('Auto-filling contact info with user data from database');
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
        line1: formData.address_line1 || '',
        line2: formData.address_line2 || '',
        city: formData.city || '',
        state: formData.state || '',
        zip: formData.zip || '',
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
