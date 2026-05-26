import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type PhotoSource = 'lot' | 'order' | 'delivery' | 'damage' | 'unit' | 'carousel';

export interface AdminPhoto {
  id: string;
  source: PhotoSource;
  public_url: string;
  file_path: string | null;
  bucket: string | null;
  file_name: string;
  created_at: string;
  order_id?: string;
  order_event_date?: string;
  customer_name?: string;
  address_id?: string;
  address_line1?: string;
  unit_id?: string;
  unit_name?: string;
  task_status_id?: string;
  notes?: string;
  is_protected_evidence: boolean;
  is_marketing_restricted: boolean;
  // Phase 2: lot photo address-save state
  is_saved_to_address?: boolean;
  address_lot_picture_id?: string;
}

export interface PhotoCounts {
  total: number;
  lot: number;
  order: number;
  delivery: number;
  damage: number;
  unit: number;
  carousel: number;
}

interface TaskStatusRow {
  id: string;
  order_id: string;
  task_type: string;
  delivery_images: string[] | null;
  damage_images: string[] | null;
  created_at: string;
  orders: {
    event_date: string | null;
    customers: { first_name: string; last_name: string } | null;
    addresses: { id: string; line1: string } | null;
  } | null;
}

interface LotPictureRow {
  id: string;
  order_id: string;
  file_path: string;
  file_name: string;
  notes: string | null;
  created_at: string | null;
  uploaded_at: string | null;
  address_id: string | null;
  orders: {
    event_date: string | null;
    customers: { first_name: string; last_name: string } | null;
    addresses: { id: string; line1: string } | null;
  } | null;
}

interface AddressLotPictureRow {
  id: string;
  address_id: string;
  file_path: string;
}

interface OrderPictureRow {
  id: string;
  order_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  notes: string | null;
  uploaded_at: string;
  created_at: string;
  orders: {
    event_date: string | null;
    customers: { first_name: string; last_name: string } | null;
    addresses: { id: string; line1: string } | null;
  } | null;
}

interface UnitMediaRow {
  id: string;
  unit_id: string | null;
  url: string;
  alt: string;
  sort: number | null;
  mode: string | null;
  is_featured: boolean | null;
  created_at: string | null;
  units: { name: string } | null;
}

interface CarouselRow {
  id: string;
  image_url: string;
  title: string | null;
  description: string | null;
  media_type: string;
  storage_path: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

// Extracts the storage path from a full Supabase public URL.
// Input:  https://xxx.supabase.co/storage/v1/object/public/public-assets/abc-drop-off-123.jpg
// Output: abc-drop-off-123.jpg
function extractPathFromPublicUrl(fullUrl: string, bucket: string): string | null {
  const marker = `/public/${bucket}/`;
  const idx = fullUrl.indexOf(marker);
  if (idx < 0) return null;
  return fullUrl.slice(idx + marker.length);
}

function buildCustomerName(
  customers: { first_name: string; last_name: string } | null
): string | undefined {
  if (!customers) return undefined;
  return `${customers.first_name} ${customers.last_name}`.trim() || undefined;
}

export function useAdminPhotos() {
  const [photos, setPhotos] = useState<AdminPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // All source queries run in parallel — each is independent.
      const [taskRes, lotRes, orderPicRes, unitRes, carouselRes, savedLotRes] = await Promise.all([
        // 1. task_status: delivery_images + damage_images JSONB arrays
        supabase
          .from('task_status')
          .select(`
            id,
            order_id,
            task_type,
            delivery_images,
            damage_images,
            created_at,
            orders (
              event_date,
              customers ( first_name, last_name ),
              addresses ( id, line1 )
            )
          `)
          .or('delivery_images.neq.[],damage_images.neq.[]')
          .order('created_at', { ascending: false }),

        // 2. order_lot_pictures table rows
        supabase
          .from('order_lot_pictures')
          .select(`
            id,
            order_id,
            file_path,
            file_name,
            notes,
            created_at,
            uploaded_at,
            address_id,
            orders (
              event_date,
              customers ( first_name, last_name ),
              addresses ( id, line1 )
            )
          `)
          .order('created_at', { ascending: false }),

        // 3. order_pictures table rows
        supabase
          .from('order_pictures')
          .select(`
            id,
            order_id,
            file_path,
            file_name,
            file_size,
            mime_type,
            notes,
            uploaded_at,
            created_at,
            orders (
              event_date,
              customers ( first_name, last_name ),
              addresses ( id, line1 )
            )
          `)
          .order('created_at', { ascending: false }),

        // 4. unit_media table rows
        supabase
          .from('unit_media')
          .select(`
            id,
            unit_id,
            url,
            alt,
            sort,
            mode,
            is_featured,
            created_at,
            units ( name )
          `)
          .order('created_at', { ascending: false }),

        // 5. hero_carousel_images table rows (all, not just active)
        supabase
          .from('hero_carousel_images')
          .select(`
            id,
            image_url,
            title,
            description,
            media_type,
            storage_path,
            display_order,
            is_active,
            created_at,
            updated_at
          `)
          .order('created_at', { ascending: false }),

        // 6. address_lot_pictures — used to mark lot photos as already saved
        supabase
          .from('address_lot_pictures')
          .select('id, address_id, file_path'),
      ]);

      const normalized: AdminPhoto[] = [];

      // Build a lookup: "address_id|file_path" -> address_lot_picture id
      // Used to mark lot photos that have already been saved to their address.
      const savedLotMap = new Map<string, string>();
      for (const row of (savedLotRes.data || []) as unknown as AddressLotPictureRow[]) {
        savedLotMap.set(`${row.address_id}|${row.file_path}`, row.id);
      }

      // --- Delivery + Damage from task_status ---
      for (const row of (taskRes.data || []) as unknown as TaskStatusRow[]) {
        const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
        const customerName = buildCustomerName(orderData?.customers ?? null);
        const addressLine1 = orderData?.addresses
          ? (Array.isArray(orderData.addresses) ? orderData.addresses[0]?.line1 : orderData.addresses.line1)
          : undefined;
        const eventDate = orderData?.event_date ?? undefined;

        // delivery_images
        for (const url of (row.delivery_images || [])) {
          if (!url || typeof url !== 'string') continue;
          const filePath = extractPathFromPublicUrl(url, 'public-assets');
          const fileName = filePath ? filePath.split('/').pop() ?? 'delivery-photo.jpg' : 'delivery-photo.jpg';
          normalized.push({
            id: `delivery-${row.id}-${url.slice(-16)}`,
            source: 'delivery',
            public_url: url,
            file_path: filePath,
            bucket: 'public-assets',
            file_name: fileName,
            created_at: row.created_at ?? new Date().toISOString(),
            order_id: row.order_id,
            order_event_date: eventDate,
            customer_name: customerName,
            address_line1: addressLine1,
            task_status_id: row.id,
            is_protected_evidence: true,
            // Delivery photos are eligible for promotion with stronger confirmation — not blocked at data layer.
            is_marketing_restricted: false,
          });
        }

        // damage_images
        for (const url of (row.damage_images || [])) {
          if (!url || typeof url !== 'string') continue;
          const filePath = extractPathFromPublicUrl(url, 'public-assets');
          const fileName = filePath ? filePath.split('/').pop() ?? 'damage-photo.jpg' : 'damage-photo.jpg';
          normalized.push({
            id: `damage-${row.id}-${url.slice(-16)}`,
            source: 'damage',
            public_url: url,
            file_path: filePath,
            bucket: 'public-assets',
            file_name: fileName,
            created_at: row.created_at ?? new Date().toISOString(),
            order_id: row.order_id,
            order_event_date: eventDate,
            customer_name: customerName,
            address_line1: addressLine1,
            task_status_id: row.id,
            is_protected_evidence: true,
            is_marketing_restricted: true,
          });
        }
      }

      // --- Lot pictures ---
      for (const row of (lotRes.data || []) as unknown as LotPictureRow[]) {
        const { data: urlData } = supabase.storage
          .from('lot-pictures')
          .getPublicUrl(row.file_path);
        const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
        const addr = orderData?.addresses
          ? (Array.isArray(orderData.addresses) ? orderData.addresses[0] : orderData.addresses)
          : null;
        // Prefer the address_id stamped on the lot picture row itself (set after first save);
        // fall back to the joined address from the order.
        const resolvedAddressId = row.address_id ?? addr?.id ?? undefined;
        const savedKey = resolvedAddressId ? `${resolvedAddressId}|${row.file_path}` : null;
        const addressLotPictureId = savedKey ? savedLotMap.get(savedKey) : undefined;
        normalized.push({
          id: row.id,
          source: 'lot',
          public_url: urlData.publicUrl,
          file_path: row.file_path,
          bucket: 'lot-pictures',
          file_name: row.file_name,
          created_at: row.created_at ?? row.uploaded_at ?? new Date().toISOString(),
          order_id: row.order_id,
          order_event_date: orderData?.event_date ?? undefined,
          customer_name: buildCustomerName(orderData?.customers ?? null),
          address_id: resolvedAddressId,
          address_line1: addr?.line1,
          notes: row.notes ?? undefined,
          is_protected_evidence: false,
          is_marketing_restricted: false,
          is_saved_to_address: addressLotPictureId !== undefined,
          address_lot_picture_id: addressLotPictureId,
        });
      }

      // --- Order pictures ---
      for (const row of (orderPicRes.data || []) as unknown as OrderPictureRow[]) {
        const { data: urlData } = supabase.storage
          .from('order-pictures')
          .getPublicUrl(row.file_path);
        const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
        const addr = orderData?.addresses
          ? (Array.isArray(orderData.addresses) ? orderData.addresses[0] : orderData.addresses)
          : null;
        normalized.push({
          id: row.id,
          source: 'order',
          public_url: urlData.publicUrl,
          file_path: row.file_path,
          bucket: 'order-pictures',
          file_name: row.file_name,
          created_at: row.created_at ?? row.uploaded_at ?? new Date().toISOString(),
          order_id: row.order_id,
          order_event_date: orderData?.event_date ?? undefined,
          customer_name: buildCustomerName(orderData?.customers ?? null),
          address_id: addr?.id,
          address_line1: addr?.line1,
          notes: row.notes ?? undefined,
          is_protected_evidence: false,
          is_marketing_restricted: false,
        });
      }

      // --- Unit media ---
      for (const row of (unitRes.data || []) as unknown as UnitMediaRow[]) {
        const unitData = Array.isArray(row.units) ? row.units[0] : row.units;
        const url = row.url;
        const fileName = url.split('/').pop() ?? 'unit-image.jpg';
        normalized.push({
          id: row.id,
          source: 'unit',
          public_url: url,
          file_path: null,
          bucket: 'unit-images',
          file_name: row.alt || fileName,
          created_at: row.created_at ?? new Date().toISOString(),
          unit_id: row.unit_id ?? undefined,
          unit_name: unitData?.name ?? undefined,
          is_protected_evidence: false,
          is_marketing_restricted: false,
        });
      }

      // --- Carousel ---
      for (const row of (carouselRes.data || []) as unknown as CarouselRow[]) {
        // Skip video entries — this is a photo library
        if (row.media_type === 'video') continue;
        const url = row.image_url;
        const fileName = row.storage_path
          ? row.storage_path.split('/').pop() ?? 'carousel-image.jpg'
          : url.split('/').pop() ?? 'carousel-image.jpg';
        normalized.push({
          id: row.id,
          source: 'carousel',
          public_url: url,
          file_path: row.storage_path ?? null,
          bucket: row.storage_path ? 'carousel-media' : null,
          file_name: row.title ?? fileName,
          created_at: row.created_at ?? new Date().toISOString(),
          is_protected_evidence: false,
          is_marketing_restricted: false,
        });
      }

      // Sort all photos newest first by default
      normalized.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setPhotos(normalized);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load photos';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts: PhotoCounts = {
    total: photos.length,
    lot: photos.filter(p => p.source === 'lot').length,
    order: photos.filter(p => p.source === 'order').length,
    delivery: photos.filter(p => p.source === 'delivery').length,
    damage: photos.filter(p => p.source === 'damage').length,
    unit: photos.filter(p => p.source === 'unit').length,
    carousel: photos.filter(p => p.source === 'carousel').length,
  };

  return { photos, loading, error, refetch: load, counts };
}
