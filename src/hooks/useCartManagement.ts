import { useState } from 'react';

interface CartItem {
  id: string;
  unit_id: string;
  unit_name: string;
  mode: 'dry' | 'water';
  wet_or_dry: 'dry' | 'water';
  price_cents: number;
  adjusted_price_cents: number;
  qty: number;
}

export function useCartManagement() {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  function addItemToCart(unit: any, mode: 'dry' | 'water') {
    const price = mode === 'water' && unit.price_water_cents ? unit.price_water_cents : unit.price_dry_cents;

    setCartItems([
      ...cartItems,
      {
        id: crypto.randomUUID(),
        unit_id: unit.id,
        unit_name: unit.name,
        mode,
        wet_or_dry: mode,
        price_cents: price,
        adjusted_price_cents: price,
        qty: 1,
      },
    ]);
  }

  function removeItemFromCart(index: number) {
    setCartItems(cartItems.filter((_, i) => i !== index));
  }

  function updateItemQuantity(index: number, qty: number) {
    setCartItems(
      cartItems.map((item, i) =>
        i === index ? { ...item, qty: Math.max(1, qty) } : item
      )
    );
  }

  function updateItemPrice(index: number, priceCents: number) {
    setCartItems(
      cartItems.map((item, i) =>
        i === index ? { ...item, adjusted_price_cents: priceCents } : item
      )
    );
  }

  function clearCart() {
    setCartItems([]);
  }

  return {
    cartItems,
    addItemToCart,
    removeItemFromCart,
    updateItemQuantity,
    updateItemPrice,
    clearCart,
  };
}
