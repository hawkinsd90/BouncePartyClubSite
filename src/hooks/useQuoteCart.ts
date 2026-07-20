import { useState, useEffect, useCallback, useRef } from 'react';
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
  mergeProductIntoCart,
} from '../lib/unifiedCart';
import type {
  UnifiedCartItem,
  InflatableCartItem,
  EventEssentialProductCartItem,
  EventEssentialBundleCartItem,
} from '../types';

export interface CartAvailabilityResult {
  cart: UnifiedCartItem[];
  eventEssentialsCheckFailed: boolean;
}

const CART_STORAGE_KEY = 'bpc_cart';

export function useQuoteCart() {
  const [cart, setCart] = useState<UnifiedCartItem[]>([]);
  const cartRef = useRef<UnifiedCartItem[]>([]);

  useEffect(() => {
    loadCart();
  }, []);

  async function loadCart() {
    const savedCart = SafeStorage.getItem<unknown>(CART_STORAGE_KEY, {
      expirationDays: 7,
    });
    if (!savedCart) {
      cartRef.current = [];
      setCart([]);
      return;
    }

    const normalized = normalizeCartItems(savedCart);

    if (normalized.length === 0) {
      const hadEntries = Array.isArray(savedCart) && (savedCart as unknown[]).length > 0;
      if (hadEntries) {
        SafeStorage.removeItem(CART_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent('bpc-cart-updated'));
      }
      cartRef.current = [];
      setCart([]);
      return;
    }

    const rawArrayLen = Array.isArray(savedCart) ? (savedCart as unknown[]).length : -1;
    if (normalized.length !== rawArrayLen) {
      SafeStorage.setItem(CART_STORAGE_KEY, normalized, { expirationDays: 7 });
      window.dispatchEvent(new CustomEvent('bpc-cart-updated'));
    }

    const needsHydration = normalized.filter(
      (item): item is InflatableCartItem =>
        isInflatableCartItem(item) &&
        item.is_combo === true &&
        (item.price_dry_cents == null || item.price_water_cents == null)
    );

    if (needsHydration.length === 0) {
      cartRef.current = normalized;
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

      cartRef.current = hydrated;
      setCart(hydrated);
      SafeStorage.setItem(CART_STORAGE_KEY, hydrated, { expirationDays: 7 });
    } catch {
      cartRef.current = normalized;
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
    let newCart: UnifiedCartItem[];
    if (isEventEssentialProductCartItem(item)) {
      newCart = mergeProductIntoCart(cartRef.current, item);
    } else {
      newCart = [...cartRef.current, item];
    }
    cartRef.current = newCart;
    setCart(newCart);
    persistCart(newCart);
  }

  function updateCartItem(index: number, updates: Partial<UnifiedCartItem>) {
    const newCart = [...cartRef.current];
    newCart[index] = { ...newCart[index], ...updates } as UnifiedCartItem;
    cartRef.current = newCart;
    setCart(newCart);
    persistCart(newCart);
  }

  function removeFromCart(index: number) {
    const newCart = cartRef.current.filter((_, i) => i !== index);
    cartRef.current = newCart;
    setCart(newCart);
    persistCart(newCart);
  }

  function applyEventEssentialsRepricedCart(
    expectedCart: UnifiedCartItem[],
    repricedCart: UnifiedCartItem[],
  ): boolean {
    if (cartRef.current !== expectedCart) {
      // A newer cart is present (e.g. user toggled dry/water or added/removed
      // an item after the repricer read the source cart). Reject the stale
      // repriced result; the newer cart will be repriced on the next render.
      return false;
    }
    cartRef.current = repricedCart;
    setCart(repricedCart);
    persistCart(repricedCart);
    return true;
  }

  function clearCart() {
    cartRef.current = [];
    setCart([]);
    SafeStorage.removeItem(CART_STORAGE_KEY);
    notifyCartUpdate();
  }

  const checkAllCartAvailability = useCallback(
    async (eventStartDate: string, eventEndDate: string): Promise<CartAvailabilityResult> => {
      if (!eventStartDate || !eventEndDate || cartRef.current.length === 0) {
        return { cart: cartRef.current, eventEssentialsCheckFailed: false };
      }

      const inflatableEntries: { item: InflatableCartItem; cartIndex: number }[] = [];
      cartRef.current.forEach((item, cartIndex) => {
        if (isInflatableCartItem(item)) {
          inflatableEntries.push({ item, cartIndex });
        }
      });

      const eventEssentialsItems = cartRef.current.filter(
        (item) =>
          isEventEssentialProductCartItem(item) ||
          isEventEssentialBundleCartItem(item)
      ) as (EventEssentialProductCartItem | EventEssentialBundleCartItem)[];

      const hasInflatables = inflatableEntries.length > 0;
      const hasEventEssentials = eventEssentialsItems.length > 0;

      if (!hasInflatables && !hasEventEssentials) {
        return { cart: cartRef.current, eventEssentialsCheckFailed: false };
      }

      const inflatableRequests = inflatableEntries.map(({ item }) => ({
        unitId: item.unit_id,
        eventStartDate,
        eventEndDate,
      }));

      const productAllocation = expandCartToProductQuantities(eventEssentialsItems);

      let eventEssentialsCheckFailed = false;

      const [inflatableResults, productResults] = await Promise.all([
        hasInflatables
          ? checkMultipleUnitsAvailability(inflatableRequests)
          : Promise.resolve([]),
        hasEventEssentials
          ? checkProductAvailability(productAllocation, eventStartDate, eventEndDate, null)
              .then((res) => {
                if (res.error) {
                  eventEssentialsCheckFailed = true;
                  return [];
                }
                return res.data ?? [];
              })
              .catch(() => {
                eventEssentialsCheckFailed = true;
                return [];
              })
          : Promise.resolve([]),
      ]);

      const mergedCart = [...cartRef.current];

      inflatableEntries.forEach((entry, resultIndex) => {
        mergedCart[entry.cartIndex] = {
          ...entry.item,
          isAvailable: inflatableResults[resultIndex]?.isAvailable ?? true,
        };
      });

      if (!eventEssentialsCheckFailed) {
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
      }

      cartRef.current = mergedCart;
      setCart(mergedCart);
      persistCart(mergedCart);
      return { cart: mergedCart, eventEssentialsCheckFailed };
    },
    []
  );

  return {
    cart,
    addToCart,
    updateCartItem,
    removeFromCart,
    applyEventEssentialsRepricedCart,
    clearCart,
    checkAllCartAvailability,
  };
}
