import { useState, useEffect, useCallback } from 'react';
import { checkMultipleUnitsAvailability } from '../lib/availability';
import { SafeStorage } from '../lib/safeStorage';
import { supabase } from '../lib/supabase';
import { checkProductAvailability } from '../lib/queries/products';
import {
  normalizeCartItems,
  isInflatableCartItem,
  isEventEssentialProductCartItem,
  isEventEssentialBundleCartItem,
  expandCartToProductQuantities,
  mapProductAvailabilityToItem,
  mapBundleAvailabilityToItem,
} from '../lib/unifiedCart';
import type {
  UnifiedCartItem,
  InflatableCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
} from '../types';

const CART_STORAGE_KEY = 'bpc_cart';

export function useQuoteCart() {
  const [cart, setCart] = useState<UnifiedCartItem[]>([]);

  useEffect(() => {
    loadCart();
  }, []);

  async function loadCart() {
    const savedCart = SafeStorage.getItem<unknown>(CART_STORAGE_KEY, {
      expirationDays: 7,
    });
    if (!savedCart) {
      setCart([]);
      return;
    }

    const normalized = normalizeCartItems(savedCart);

    if (normalized.length === 0) {
      setCart([]);
      return;
    }

    const rawArrayLen = Array.isArray(savedCart) ? (savedCart as unknown[]).length : -1;
    if (normalized.length !== rawArrayLen) {
      SafeStorage.setItem(CART_STORAGE_KEY, normalized, { expirationDays: 7 });
    }

    const needsHydration = normalized.filter(
      (item): item is InflatableCartItem =>
        isInflatableCartItem(item) &&
        item.is_combo === true &&
        (item.price_dry_cents == null || item.price_water_cents == null)
    );

    if (needsHydration.length === 0) {
      setCart(normalized);
      return;
    }

    try {
      const unitIds = [...new Set(needsHydration.map((i) => i.unit_id))];
      const { data: units } = await supabase
        .from('units')
        .select('id, price_dry_cents, price_water_cents')
        .in('id', unitIds);

      const priceMap = new Map((units || []).map((u) => [u.id, u]));
      const hydrated = normalized.map((item) => {
        if (
          !isInflatableCartItem(item) ||
          !item.is_combo ||
          (item.price_dry_cents != null && item.price_water_cents != null)
        ) {
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
      setCart(normalized);
    }
  }

  function notifyCartUpdate() {
    window.dispatchEvent(new CustomEvent('bpc-cart-updated'));
  }

  function persistCart(newCart: UnifiedCartItem[]) {
    SafeStorage.setItem(CART_STORAGE_KEY, newCart, { expirationDays: 7 });
    notifyCartUpdate();
  }

  function addToCart(item: UnifiedCartItem) {
    const newCart = [...cart, item];
    setCart(newCart);
    persistCart(newCart);
  }

  function updateCartItem(index: number, updates: Partial<UnifiedCartItem>) {
    const newCart = [...cart];
    newCart[index] = { ...newCart[index], ...updates } as UnifiedCartItem;
    setCart(newCart);
    persistCart(newCart);
  }

  function removeFromCart(index: number) {
    const newCart = cart.filter((_, i) => i !== index);
    setCart(newCart);
    persistCart(newCart);
  }

  function clearCart() {
    setCart([]);
    SafeStorage.removeItem(CART_STORAGE_KEY);
    notifyCartUpdate();
  }

  const checkAllCartAvailability = useCallback(
    async (eventStartDate: string, eventEndDate: string): Promise<UnifiedCartItem[]> => {
      if (!eventStartDate || !eventEndDate || cart.length === 0) {
        return cart;
      }

      const inflatableEntries: { item: InflatableCartItem; cartIndex: number }[] = [];
      cart.forEach((item, cartIndex) => {
        if (isInflatableCartItem(item)) {
          inflatableEntries.push({ item, cartIndex });
        }
      });

      const eventEssentialsItems = cart.filter(
        (item) =>
          isEventEssentialProductCartItem(item) ||
          isEventEssentialBundleCartItem(item)
      ) as (EventEssentialProductCartItem | EventEssentialBundleCartItem)[];

      const hasInflatables = inflatableEntries.length > 0;
      const hasEventEssentials = eventEssentialsItems.length > 0;

      if (!hasInflatables && !hasEventEssentials) {
        return cart;
      }

      const inflatableRequests = inflatableEntries.map(({ item }) => ({
        unitId: item.unit_id,
        eventStartDate,
        eventEndDate,
      }));

      const productAllocation = expandCartToProductQuantities(eventEssentialsItems);

      const [inflatableResults, productResults] = await Promise.all([
        hasInflatables
          ? checkMultipleUnitsAvailability(inflatableRequests)
          : Promise.resolve([]),
        hasEventEssentials
          ? checkProductAvailability(productAllocation, eventStartDate, eventEndDate, null)
              .then((res) => res.data ?? [])
              .catch(() => [])
          : Promise.resolve([]),
      ]);

      const mergedCart = [...cart];

      inflatableEntries.forEach((entry, resultIndex) => {
        mergedCart[entry.cartIndex] = {
          ...entry.item,
          isAvailable: inflatableResults[resultIndex]?.isAvailable ?? true,
        };
      });

      mergedCart.forEach((item, index) => {
        if (isEventEssentialProductCartItem(item)) {
          mergedCart[index] = {
            ...item,
            isAvailable: mapProductAvailabilityToItem(item, productResults),
          };
        } else if (isEventEssentialBundleCartItem(item)) {
          mergedCart[index] = {
            ...item,
            isAvailable: mapBundleAvailabilityToItem(item, productResults),
          };
        }
      });

      setCart(mergedCart);
      persistCart(mergedCart);
      return mergedCart;
    },
    [cart]
  );

  return {
    cart,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    checkAllCartAvailability,
  };
}
