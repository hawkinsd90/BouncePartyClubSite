import { useState, useEffect, useCallback } from 'react';
import { checkMultipleUnitsAvailability } from '../lib/availability';

interface CartItem {
  unit_id: string;
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  qty: number;
  is_combo?: boolean;
  isAvailable?: boolean;
}

const CART_STORAGE_KEY = 'bpc_cart';

export function useQuoteCart() {
  const [cart, setCart] = useState<CartItem[]>([]);

  useEffect(() => {
    loadCart();
  }, []);

  function loadCart() {
    const savedCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    const validCart = savedCart.filter((item: any) => {
      const isValid = item.unit_id && typeof item.unit_id === 'string' && item.unit_id !== 'undefined';
      if (!isValid) {
        console.log('Filtering out invalid cart item:', item);
      }
      return isValid;
    });

    if (validCart.length !== savedCart.length) {
      console.log(`Removed ${savedCart.length - validCart.length} invalid cart items`);
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(validCart));
    }

    setCart(validCart);
  }

  function updateCartItem(index: number, updates: Partial<CartItem>) {
    const newCart = [...cart];
    newCart[index] = { ...newCart[index], ...updates };
    setCart(newCart);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(newCart));
  }

  function removeFromCart(index: number) {
    const newCart = cart.filter((_, i) => i !== index);
    setCart(newCart);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(newCart));
  }

  function clearCart() {
    setCart([]);
    localStorage.removeItem(CART_STORAGE_KEY);
  }

  const checkCartAvailability = useCallback(
    async (eventStartDate: string, eventEndDate: string) => {
      if (!eventStartDate || !eventEndDate || cart.length === 0) {
        return;
      }

      const checks = cart.map(item => ({
        unitId: item.unit_id,
        eventStartDate,
        eventEndDate,
      }));

      const results = await checkMultipleUnitsAvailability(checks);

      const updatedCart = cart.map((item, index) => ({
        ...item,
        isAvailable: results[index]?.isAvailable ?? true,
      }));

      setCart(updatedCart);
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(updatedCart));
    },
    [cart]
  );

  return {
    cart,
    updateCartItem,
    removeFromCart,
    clearCart,
    checkCartAvailability,
  };
}
