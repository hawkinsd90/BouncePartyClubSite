import { useState, useEffect, useCallback } from 'react';
import { checkMultipleUnitsAvailability } from '../lib/availability';
import { SafeStorage } from '../lib/safeStorage';

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

const validateCart = (data: any): boolean => {
  return Array.isArray(data) && data.every(item =>
    item.unit_id &&
    typeof item.unit_id === 'string' &&
    item.unit_id !== 'undefined' &&
    typeof item.qty === 'number' &&
    ['dry', 'water'].includes(item.wet_or_dry)
  );
};

export function useQuoteCart() {
  const [cart, setCart] = useState<CartItem[]>([]);

  useEffect(() => {
    loadCart();
  }, []);

  function loadCart() {
    const savedCart = SafeStorage.getItem<CartItem[]>(CART_STORAGE_KEY, {
      validate: validateCart,
      expirationDays: 7
    });
    setCart(savedCart || []);
  }

  function updateCartItem(index: number, updates: Partial<CartItem>) {
    const newCart = [...cart];
    newCart[index] = { ...newCart[index], ...updates };
    setCart(newCart);
    SafeStorage.setItem(CART_STORAGE_KEY, newCart, { expirationDays: 7 });
  }

  function removeFromCart(index: number) {
    const newCart = cart.filter((_, i) => i !== index);
    setCart(newCart);
    SafeStorage.setItem(CART_STORAGE_KEY, newCart, { expirationDays: 7 });
  }

  function clearCart() {
    setCart([]);
    SafeStorage.removeItem(CART_STORAGE_KEY);
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
      SafeStorage.setItem(CART_STORAGE_KEY, updatedCart, { expirationDays: 7 });
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
