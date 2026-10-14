import { useNavigate } from 'react-router-dom';
import type { Order } from '../types/orders';
import { SafeStorage } from '../lib/safeStorage';
import { eventAddressLine2 } from '../lib/booking/eventAddress';
import { notifyError, notifyWarning, showConfirm } from '../lib/toasts';

export function useOrderDuplication() {
  const navigate = useNavigate();

  // Works from the order the dashboard already loaded through get_my_orders (the customer cannot read the tables directly).
  async function duplicateOrder(order: Order) {
    try {
      const orderData = order as unknown as any;
      const itemsData = ((order.order_items ?? []) as unknown) as any[];

      if (itemsData.length === 0) {
        console.warn('[Duplicate Order] No items found in order');
        notifyWarning('This order has no items to duplicate.');
        return;
      }

      const validItems: any[] = [];
      const unavailableItems: string[] = [];

      itemsData.forEach((item: any) => {
        if (item.units && item.units.active !== false) {
          validItems.push(item);
        } else {
          const unitName = item.units?.name || 'Unknown Item';
          unavailableItems.push(unitName);
          console.warn('[Duplicate Order] Unavailable item:', unitName, 'active:', item.units?.active);
        }
      });

      if (unavailableItems.length > 0 && validItems.length === 0) {
        notifyError(
          'Unable to duplicate this order.\n\n' +
          'The following items are no longer available:\n' +
          unavailableItems.map(name => `• ${name}`).join('\n') +
          '\n\nPlease browse our catalog to see current rental options.'
        );
        return;
      } else if (unavailableItems.length > 0) {
        const proceed = await showConfirm(
          'Some items from this order are no longer available:\n\n' +
          unavailableItems.map(name => `• ${name}`).join('\n') +
          '\n\nThe remaining items will be added to your cart. Continue?'
        );
        if (!proceed) return;
      }

      const cartItems = validItems.map(item => {
        const isCombo = (item.units?.types || []).includes('Combo') || (item.units?.types || []).includes('Water Slide') || item.units?.is_combo === true;
        return {
          unit_id: item.unit_id,
          unit_name: item.units.name,
          wet_or_dry: item.wet_or_dry as 'dry' | 'water',
          unit_price_cents: item.unit_price_cents,
          price_dry_cents: item.units?.price_dry_cents ?? item.unit_price_cents,
          price_water_cents: item.units?.price_water_cents || item.units?.price_dry_cents || item.unit_price_cents,
          qty: item.qty,
          is_combo: isCombo,
        };
      });

      SafeStorage.setItem('bpc_cart', cartItems, { expirationDays: 7 });
      window.dispatchEvent(new CustomEvent('bpc-cart-updated'));

      const prefillData = {
        address: orderData.addresses ? {
          street: orderData.addresses.line1,
          city: orderData.addresses.city,
          state: orderData.addresses.state,
          zip: orderData.addresses.zip,
          lat: orderData.addresses.lat,
          lng: orderData.addresses.lng,
          formatted_address: `${orderData.addresses.line1}, ${orderData.addresses.city}, ${orderData.addresses.state} ${orderData.addresses.zip}`,
        } : null,
        location_type: orderData.location_type,
        pickup_preference: orderData.pickup_preference || 'next_day',
        can_stake: orderData.can_use_stakes,
        has_generator: orderData.generator_qty > 0,
        has_pets: orderData.has_pets,
        special_details: orderData.special_details || '',
        address_line2: eventAddressLine2(orderData),
        event_date: '',
        event_end_date: '',
        start_window: orderData.start_window || '09:00',
        end_window: orderData.end_window || '17:00',
      };

      SafeStorage.setItem('bpc_quote_prefill', prefillData, { expirationDays: 7 });
      SafeStorage.setItem('bpc_duplicate_order', 'true', { expirationDays: 7 });

      if (orderData.customers) {
        const contactData = {
          first_name: orderData.customers.first_name || '',
          last_name: orderData.customers.last_name || '',
          email: orderData.customers.email || '',
          phone: orderData.customers.phone || '',
          business_name: orderData.customers.business_name || '',
        };
        SafeStorage.setItem('bpc_contact_data', contactData, { expirationDays: 7 });
        // console.log('[Duplicate Order] Contact data saved:', contactData);
      }

      // console.log('[Duplicate Order] Cart, prefill data, and contact info saved, navigating to quote page');

      navigate('/quote');
    } catch (error) {
      console.error('[Duplicate Order] Unexpected error:', error);
      notifyError('Failed to duplicate order');
    }
  }

  return { duplicateOrder };
}
