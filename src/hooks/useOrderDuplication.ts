import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { notifyError, notifyWarning, showConfirm } from '../lib/notifications';

export function useOrderDuplication() {
  const navigate = useNavigate();

  async function duplicateOrder(orderId: string) {
    try {
      console.log('[Duplicate Order] Starting duplication for order:', orderId);

      const { data: orderDataRaw, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          addresses (*),
          customers (
            first_name,
            last_name,
            email,
            phone,
            business_name
          )
        `)
        .eq('id', orderId)
        .single();

      if (orderError || !orderDataRaw) {
        console.error('[Duplicate Order] Failed to load order:', orderError);
        notifyError('Failed to load order details');
        return;
      }

      const orderData = orderDataRaw as any;

      console.log('[Duplicate Order] Order loaded, fetching items...');

      const { data: itemsDataRaw, error: itemsError } = await supabase
        .from('order_items')
        .select(`
          *,
          units (
            id,
            name,
            active
          )
        `)
        .eq('order_id', orderId);

      if (itemsError || !itemsDataRaw) {
        console.error('[Duplicate Order] Failed to load items:', itemsError);
        notifyError('Failed to load order items');
        return;
      }

      const itemsData = itemsDataRaw as any[];

      console.log('[Duplicate Order] Loaded items:', itemsData.length);

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
          console.log('[Duplicate Order] Valid item:', item.units.name);
        } else {
          const unitName = item.units?.name || 'Unknown Item';
          unavailableItems.push(unitName);
          console.warn('[Duplicate Order] Unavailable item:', unitName, 'active:', item.units?.active);
        }
      });

      console.log('[Duplicate Order] Validation complete - Valid:', validItems.length, 'Unavailable:', unavailableItems.length);

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

      const cartItems = validItems.map(item => ({
        unit_id: item.unit_id,
        unit_name: item.units.name,
        wet_or_dry: item.wet_or_dry as 'dry' | 'water',
        unit_price_cents: item.unit_price_cents,
        qty: item.qty,
        is_combo: false,
      }));

      localStorage.setItem('bpc_cart', JSON.stringify(cartItems));

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
        can_stake: orderData.can_stake,
        has_generator: orderData.generator_qty > 0,
        has_pets: orderData.has_pets,
        special_details: orderData.special_details || '',
        address_line2: orderData.addresses?.line2 || '',
        event_date: '',
        event_end_date: '',
        start_window: orderData.start_window || '09:00',
        end_window: orderData.end_window || '17:00',
      };

      localStorage.setItem('bpc_quote_prefill', JSON.stringify(prefillData));
      localStorage.setItem('bpc_duplicate_order', 'true');

      if (orderData.customers) {
        const contactData = {
          first_name: orderData.customers.first_name || '',
          last_name: orderData.customers.last_name || '',
          email: orderData.customers.email || '',
          phone: orderData.customers.phone || '',
          business_name: orderData.customers.business_name || '',
        };
        localStorage.setItem('bpc_contact_data', JSON.stringify(contactData));
        console.log('[Duplicate Order] Contact data saved:', contactData);
      }

      console.log('[Duplicate Order] Cart, prefill data, and contact info saved, navigating to quote page');

      navigate('/quote');
    } catch (error) {
      console.error('[Duplicate Order] Unexpected error:', error);
      notifyError('Failed to duplicate order');
    }
  }

  return { duplicateOrder };
}
