import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { fetchTaskEvidenceViews } from '../lib/taskEvidenceApi';
import { normalizeAdminPhotos, countPhotosBySource } from '../lib/adminPhotoNormalizers';
import type {
  TaskStatusRow, LotPictureRow, AddressLotPictureRow, OrderPictureRow, UnitMediaRow, CarouselRow,
} from '../lib/adminPhotoNormalizers';

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

      // lot-pictures and order-pictures are private buckets: the signed-in admin asks Storage for short-lived signed URLs.
      const signedUrls = new Map<string, string>();
      const signPaths = async (bucket: string, rows: Array<{ file_path: string }> | null) => {
        const paths = Array.from(new Set((rows || []).map((r) => r.file_path).filter(Boolean)));
        if (paths.length === 0) return;
        const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
        for (const entry of data || []) {
          if (entry.path && entry.signedUrl) signedUrls.set(`${bucket}/${entry.path}`, entry.signedUrl);
        }
      };
      await Promise.all([
        signPaths('lot-pictures', lotRes.data as Array<{ file_path: string }> | null),
        signPaths('order-pictures', orderPicRes.data as Array<{ file_path: string }> | null),
      ]);

      // Delivery / damage evidence is private too: the task-evidence function reads each task's references and returns
      // signed viewing URLs (and drops references it does not trust).
      const evidenceViews = await fetchTaskEvidenceViews(((taskRes.data || []) as Array<{ id: string }>).map((t) => t.id));

      const normalized = normalizeAdminPhotos(
        {
          taskRows: (taskRes.data || []) as unknown as TaskStatusRow[],
          lotRows: (lotRes.data || []) as unknown as LotPictureRow[],
          orderPicRows: (orderPicRes.data || []) as unknown as OrderPictureRow[],
          unitRows: (unitRes.data || []) as unknown as UnitMediaRow[],
          carouselRows: (carouselRes.data || []) as unknown as CarouselRow[],
          savedLotRows: (savedLotRes.data || []) as unknown as AddressLotPictureRow[],
        },
        {
          resolveMediaUrl: (bucket, path) => signedUrls.get(`${bucket}/${path}`) ?? '',
          resolveEvidence: (taskStatusId, kind, _ref, index) => {
            const view = evidenceViews[taskStatusId]?.[kind]?.[index];
            return view && view.bucket ? { url: view.url, bucket: view.bucket, path: view.path } : null;
          },
          nowIso: () => new Date().toISOString(),
        },
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

  const counts: PhotoCounts = countPhotosBySource(photos);

  return { photos, loading, error, refetch: load, counts };
}
