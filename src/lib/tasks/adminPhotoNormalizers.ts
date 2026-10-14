// Pure admin photo normalization, extracted verbatim from useAdminPhotos.
//
// Six source-specific mappings (task delivery, task damage, lot, order, unit, carousel) into the one AdminPhoto
// model, the final newest-first sort, and the per-source counts. The hook keeps the queries, state, effects and
// the storage binding. The two non-pure dependencies are injected: `resolveMediaUrl(bucket, path)` (the Supabase
// storage lookup) and `nowIso()` (the "now" fallback used when a source row has no timestamp).
//
// Preserved quirks (do not "fix" here): delivery/damage ids use the LAST 16 characters of the URL, so two photos
// in one task status that end the same way share an id; missing timestamps fall back to the current time.

import type { AdminPhoto, PhotoCounts } from '../../hooks/useAdminPhotos';

export interface TaskStatusRow {
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

export interface LotPictureRow {
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

export interface AddressLotPictureRow {
  id: string;
  address_id: string;
  file_path: string;
}

export interface OrderPictureRow {
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

export interface UnitMediaRow {
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

export interface CarouselRow {
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

export interface AdminPhotoSourceRows {
  taskRows: TaskStatusRow[];
  lotRows: LotPictureRow[];
  orderPicRows: OrderPictureRow[];
  unitRows: UnitMediaRow[];
  carouselRows: CarouselRow[];
  savedLotRows: AddressLotPictureRow[];
}

export interface AdminPhotoNormalizerDeps {
  // Viewing URL for an object in a private photo bucket (the hook binds this to a short-lived signed URL).
  resolveMediaUrl: (bucket: string, path: string) => string;
  // Delivery / damage evidence is private too. The server resolves each stored reference of a task (it reads the references
  // from the database) to a signed URL plus the bucket and path it came from; null means the reference is not trusted
  // (external URL, another bucket, another order) and the photo is left out of the library.
  resolveEvidence: (taskStatusId: string, kind: 'delivery' | 'damage', ref: string, index: number) => { url: string | null; bucket: string | null; path: string | null } | null;
  // Current time as an ISO string; called only where the old code used `new Date().toISOString()`.
  nowIso: () => string;
}

// Extracts the storage path from a full Supabase public URL.
// Input:  https://xxx.supabase.co/storage/v1/object/public/public-assets/abc-drop-off-123.jpg
// Output: abc-drop-off-123.jpg
export function extractPathFromPublicUrl(fullUrl: string, bucket: string): string | null {
  const marker = `/public/${bucket}/`;
  const idx = fullUrl.indexOf(marker);
  if (idx < 0) return null;
  return fullUrl.slice(idx + marker.length);
}

export function buildCustomerName(
  customers: { first_name: string; last_name: string } | null
): string | undefined {
  if (!customers) return undefined;
  return `${customers.first_name} ${customers.last_name}`.trim() || undefined;
}

export function normalizeAdminPhotos(rows: AdminPhotoSourceRows, deps: AdminPhotoNormalizerDeps): AdminPhoto[] {
  const { resolveMediaUrl, resolveEvidence, nowIso } = deps;
  const normalized: AdminPhoto[] = [];

  // Build a lookup: "address_id|file_path" -> address_lot_picture id
  // Used to mark lot photos that have already been saved to their address.
  const savedLotMap = new Map<string, string>();
  for (const row of rows.savedLotRows) {
    savedLotMap.set(`${row.address_id}|${row.file_path}`, row.id);
  }

  // --- Delivery + Damage from task_status ---
  for (const row of rows.taskRows) {
    const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const customerName = buildCustomerName(orderData?.customers ?? null);
    const addressLine1 = orderData?.addresses
      ? (Array.isArray(orderData.addresses) ? orderData.addresses[0]?.line1 : orderData.addresses.line1)
      : undefined;
    const eventDate = orderData?.event_date ?? undefined;

    // delivery_images
    for (const [index, url] of (row.delivery_images || []).entries()) {
      if (!url || typeof url !== 'string') continue;
      const evidence = resolveEvidence(row.id, 'delivery', url, index);
      if (!evidence || !evidence.bucket) continue;
      const filePath = evidence.path;
      const fileName = filePath ? filePath.split('/').pop() ?? 'delivery-photo.jpg' : 'delivery-photo.jpg';
      normalized.push({
        id: `delivery-${row.id}-${url.slice(-16)}`,
        source: 'delivery',
        public_url: evidence.url ?? '',
        file_path: filePath,
        bucket: evidence.bucket,
        file_name: fileName,
        created_at: row.created_at ?? nowIso(),
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
    for (const [index, url] of (row.damage_images || []).entries()) {
      if (!url || typeof url !== 'string') continue;
      const evidence = resolveEvidence(row.id, 'damage', url, index);
      if (!evidence || !evidence.bucket) continue;
      const filePath = evidence.path;
      const fileName = filePath ? filePath.split('/').pop() ?? 'damage-photo.jpg' : 'damage-photo.jpg';
      normalized.push({
        id: `damage-${row.id}-${url.slice(-16)}`,
        source: 'damage',
        public_url: evidence.url ?? '',
        file_path: filePath,
        bucket: evidence.bucket,
        file_name: fileName,
        created_at: row.created_at ?? nowIso(),
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
  for (const row of rows.lotRows) {
    const publicUrl = resolveMediaUrl('lot-pictures', row.file_path);
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
      public_url: publicUrl,
      file_path: row.file_path,
      bucket: 'lot-pictures',
      file_name: row.file_name,
      created_at: row.created_at ?? row.uploaded_at ?? nowIso(),
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
  for (const row of rows.orderPicRows) {
    const publicUrl = resolveMediaUrl('order-pictures', row.file_path);
    const orderData = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    const addr = orderData?.addresses
      ? (Array.isArray(orderData.addresses) ? orderData.addresses[0] : orderData.addresses)
      : null;
    normalized.push({
      id: row.id,
      source: 'order',
      public_url: publicUrl,
      file_path: row.file_path,
      bucket: 'order-pictures',
      file_name: row.file_name,
      created_at: row.created_at ?? row.uploaded_at ?? nowIso(),
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
  for (const row of rows.unitRows) {
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
      created_at: row.created_at ?? nowIso(),
      unit_id: row.unit_id ?? undefined,
      unit_name: unitData?.name ?? undefined,
      is_protected_evidence: false,
      is_marketing_restricted: false,
    });
  }

  // --- Carousel ---
  for (const row of rows.carouselRows) {
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
      created_at: row.created_at ?? nowIso(),
      is_protected_evidence: false,
      is_marketing_restricted: false,
    });
  }

  // Sort all photos newest first by default
  normalized.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return normalized;
}

export function countPhotosBySource(photos: AdminPhoto[]): PhotoCounts {
  return {
    total: photos.length,
    lot: photos.filter(p => p.source === 'lot').length,
    order: photos.filter(p => p.source === 'order').length,
    delivery: photos.filter(p => p.source === 'delivery').length,
    damage: photos.filter(p => p.source === 'damage').length,
    unit: photos.filter(p => p.source === 'unit').length,
    carousel: photos.filter(p => p.source === 'carousel').length,
  };
}
