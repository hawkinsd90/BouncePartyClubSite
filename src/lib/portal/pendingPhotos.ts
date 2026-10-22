// WP-24 (B16): the photos a customer has picked but not yet uploaded.
//
// The picker used to keep two parallel lists - the files, and their previews read asynchronously with FileReader. The previews finish in
// whatever order the browser likes, so the Nth preview was not always the Nth file: removing a thumbnail could remove a different photo from the
// upload. Each pick is now ONE record (file + its own preview URL), removed by id, and the preview URL is released when it is dropped.

export interface PendingPhoto {
  id: string;
  file: File;
  url: string;
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export interface PhotoAddResult {
  items: PendingPhoto[];
  tooLarge: string[];
  notImages: string[];
}

interface FileLike { name: string; size: number; type: string }

export function addPendingPhotos(
  current: PendingPhoto[],
  files: Array<File & FileLike>,
  deps: { createUrl: (file: File) => string; newId: () => string },
): PhotoAddResult {
  const items = [...current];
  const tooLarge: string[] = [];
  const notImages: string[] = [];
  for (const file of files) {
    if (!/^image\//.test(file.type)) {
      notImages.push(file.name);
      continue;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      tooLarge.push(file.name);
      continue;
    }
    items.push({ id: deps.newId(), file, url: deps.createUrl(file) });
  }
  return { items, tooLarge, notImages };
}

// Removes ONE photo by id and releases only its preview URL.
export function removePendingPhoto(current: PendingPhoto[], id: string, revokeUrl: (url: string) => void): PendingPhoto[] {
  const target = current.find((p) => p.id === id);
  if (target) revokeUrl(target.url);
  return current.filter((p) => p.id !== id);
}

export function releaseAll(current: PendingPhoto[], revokeUrl: (url: string) => void) {
  for (const p of current) revokeUrl(p.url);
}
