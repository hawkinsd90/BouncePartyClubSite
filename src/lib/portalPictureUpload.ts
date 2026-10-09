// Customer photo uploads (event-location pictures and order pictures).
//
// The photo buckets are private and have no browser upload policy. A customer uploads only through an authorization the
// server issues for the exact order:
//   1. request_picture_upload  - the server checks access to THIS order, picks the bucket (from the kind) and a random object
//                                path, and returns a signed upload token for that one object.
//   2. uploadToSignedUrl       - the browser sends the file to exactly that object with that token.
//   3. the caller registers the uploaded objects with the existing register action.
// If any step fails, discard_unregistered_pictures asks the server to remove what was uploaded; the browser never deletes.

import { supabase } from './supabase';
import { portalAction } from './customerPortalApi';

export type PortalPictureKind = 'lot_picture' | 'order_picture';

export interface UploadedPortalPicture {
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

interface UploadAuthorization {
  bucket: string;
  uploads: Array<{ name: string; path: string; token: string }>;
}

export async function uploadPortalPictures(
  orderId: string,
  portalToken: string | null | undefined,
  kind: PortalPictureKind,
  files: File[],
): Promise<UploadedPortalPicture[]> {
  const authorization = await portalAction<UploadAuthorization & { success: boolean }>(orderId, portalToken, 'request_picture_upload', {
    kind,
    files: files.map((f) => ({ name: f.name, size: f.size, mimeType: f.type })),
  });

  const uploaded: UploadedPortalPicture[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const grant = authorization.uploads[i];
      const { error } = await supabase.storage
        .from(authorization.bucket)
        .uploadToSignedUrl(grant.path, grant.token, file, { contentType: file.type });
      if (error) throw new Error('Storage upload failed');
      uploaded.push({ path: grant.path, name: file.name, size: file.size, mimeType: file.type });
    }
  } catch (error) {
    await discardPortalPictures(orderId, portalToken, kind, authorization.uploads.map((u) => u.path));
    throw error;
  }
  return uploaded;
}

// Best effort: the objects are private either way, so a failed cleanup never hides the original error.
export async function discardPortalPictures(
  orderId: string,
  portalToken: string | null | undefined,
  kind: PortalPictureKind,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  try {
    await portalAction(orderId, portalToken, 'discard_unregistered_pictures', { kind, paths });
  } catch {
    /* the objects stay private */
  }
}
