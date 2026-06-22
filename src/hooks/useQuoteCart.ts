import { useState, useEffect, useCallback } from 'react';
import { checkMultipleUnitsAvailability } from '../lib/availability';
import { SafeStorage } from '../lib/safeStorage';
import { supabase } from '../lib/supabase';

interface CartItem {
  unit_id: string;
  unit_name: string;
  wet_or_dry: 'dry' | 'water';
  unit_price_cents: number;
  price_dry_cents?: number;
  price_water_cents?: number;
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

  async function loadCart() {
    const savedCart = SafeStorage.getItem<CartItem[]>(CART_STORAGE_KEY, {
      validate: validateCart,
      expirationDays: 7
    });
    if (!savedCart || savedCart.length === 0) {
      setCart([]);
      return;
    }

    // Hydrate combo items that are missing both price fields (legacy carts)
    const needsHydration = savedCart.filter(
      item => item.is_combo && (item.price_dry_cents == null || item.price_water_cents == null)
    );

    if (needsHydration.length === 0) {
      setCart(savedCart);
      return;
    }

    try {
      const unitIds = [...new Set(needsHydration.map(i => i.unit_id))];
      const { data: units } = await supabase
        .from('units')
        .select('id, price_dry_cents, price_water_cents')
        .in('id', unitIds);

      const priceMap = new Map((units || []).map(u => [u.id, u]));
      const hydrated = savedCart.map(item => {
        if (!item.is_combo || (item.price_dry_cents != null && item.price_water_cents != null)) {
          return item;
        }
        const unit = priceMap.get(item.unit_id);
        if (!unit) return item;
        return {
          ...item,
          price_dry_cents: unit.price_dry_cents,
          price_water_cents: unit.price_water_cents ?? unit.price_dry_cents,
        };
      });

      setCart(hydrated);
      SafeStorage.setItem(CART_STORAGE_KEY, hydrated, { expirationDays: 7 });
    } catch {
      setCart(savedCart);
    }
  }

  function notifyCartUpdate() {
    window.dispatchEvent(new CustomEvent('bpc-cart-updated'));
  }

  function updateCartItem(index: number, updates: Partial<CartItem>) {
    const newCart = [...cart];
    newCart[index] = { ...newCart[index], ...updates };
    setCart(newCart);
    SafeStorage.setItem(CART_STORAGE_KEY, newCart, { expirationDays: 7 });
    notifyCartUpdate();
  }

  function removeFromCart(index: number) {
    const newCart = cart.filter((_, i) => i !== index);
    setCart(newCart);
    SafeStorage.setItem(CART_STORAGE_KEY, newCart, { expirationDays: 7 });
    notifyCartUpdate();
  }

  function clearCart() {
    setCart([]);
    SafeStorage.removeItem(CART_STORAGE_KEY);
    notifyCartUpdate();
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
