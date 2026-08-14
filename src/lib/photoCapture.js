import { supabase } from './supabase';

export const ENTRY_PHOTOS_BUCKET = 'entry-pictures';

function getFileExtension(formatOrName = 'jpeg') {
  const value = String(formatOrName || 'jpeg').toLowerCase();
  if (value.includes('.')) return value.split('.').pop() || 'jpg';
  if (value === 'jpeg') return 'jpg';
  return value.replace(/[^a-z0-9]/g, '') || 'jpg';
}

export function dataUrlToBlob(dataUrl) {
  const [meta, base64] = String(dataUrl || '').split(',');
  const mimeType = meta?.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

// A photo straight off a phone camera is 3–5 MB. That is slow to upload over a gate's signal and,
// worse, it has to survive the offline queue as a base64 data URL (~1.37x the bytes) inside the same
// storage the shift session and outbox live in — a couple of full-size incident photos is enough to
// blow the quota and take the queue down with it. Everything is downscaled on capture instead.
const MAX_PHOTO_EDGE_PX = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

// EXIF orientation is the trap here: the raw file carries a rotation flag that browsers honour when
// they render it, but drawing to a canvas bakes in the *unrotated* pixels and every portrait photo
// comes out sideways. createImageBitmap with imageOrientation 'from-image' applies the flag for us.
async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // Older WebViews reject the options bag rather than ignoring it.
      try {
        return await createImageBitmap(blob);
      } catch {
        /* fall through to the <img> path */
      }
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Best-effort: any failure returns the original file untouched. A photo that cannot be shrunk is
// still a photo, and losing it to a canvas quirk on one handset would be the worse outcome.
export async function compressPhoto(file) {
  try {
    const source = await decodeImage(file);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) throw new Error('Image has no dimensions');

    const scale = Math.min(1, MAX_PHOTO_EDGE_PX / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2d context');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === 'function') source.close();

    const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
    if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('Canvas export failed');
    const blob = dataUrlToBlob(dataUrl);
    // A tiny already-optimised image can come out *larger* after a re-encode. Keep the smaller one.
    if (scale === 1 && file.size && blob.size >= file.size) throw new Error('Re-encode not smaller');
    return { dataUrl, blob, extension: 'jpg', mimeType: 'image/jpeg' };
  } catch (err) {
    console.warn('[photoCapture] Compression skipped, using original file:', err?.message);
    return {
      dataUrl: await fileToDataUrl(file),
      blob: file,
      extension: getFileExtension(file.name || file.type),
      mimeType: file.type || 'image/jpeg',
    };
  }
}

export async function normaliseSelectedPhoto(file) {
  if (!file) return null;
  return compressPhoto(file);
}

// Camera/gallery pickers with `multiple` hand back a FileList. Compressed in sequence rather than
// in parallel: several full-size decodes at once is what makes a mid-range handset drop the tab.
export async function normaliseSelectedPhotos(fileList) {
  const files = Array.from(fileList || []);
  const photos = [];
  for (const file of files) {
    if (!file) continue;
    photos.push(await compressPhoto(file));
  }
  return photos;
}

// Build a JSON-serialisable photo descriptor that can be stored in the offline queue
// (a raw Blob/File cannot survive JSON.stringify — it serialises to `{}` and the image is lost).
export function buildPendingPhoto(photo) {
  if (!photo?.dataUrl) return null;
  return {
    dataUrl: photo.dataUrl,
    extension: photo.extension || 'jpg',
    mimeType: photo.mimeType || 'image/jpeg',
  };
}

// Upload a pending photo (captured while offline) once connectivity returns. Rehydrates the
// Blob from the stored data URL and reuses the normal entry-photo upload path.
export async function uploadPendingPhoto({ pendingPhoto, type, tempId, siteId }) {
  if (!pendingPhoto?.dataUrl) return null;
  const blob = dataUrlToBlob(pendingPhoto.dataUrl);
  return uploadEntryPhoto({
    photo: {
      blob,
      extension: pendingPhoto.extension || 'jpg',
      mimeType: pendingPhoto.mimeType || blob.type || 'image/jpeg',
    },
    type,
    tempId,
    siteId,
  });
}

export function buildPendingPhotos(photos) {
  return (photos || []).map(buildPendingPhoto).filter(Boolean);
}

// An incident carries several photos, so the tempId alone is not a unique object key — the index
// makes each one its own path. Serial rather than Promise.all so an incident with eight photos does
// not open eight concurrent uploads on a gate's connection.
export async function uploadPendingPhotos({ pendingPhotos, type, tempId, siteId }) {
  const urls = [];
  const list = (pendingPhotos || []).filter((p) => p?.dataUrl);
  for (let i = 0; i < list.length; i += 1) {
    const url = await uploadPendingPhoto({
      pendingPhoto: list[i],
      type,
      tempId: `${tempId}-${i + 1}`,
      siteId,
    });
    if (url) urls.push(url);
  }
  return urls;
}

export async function uploadEntryPhotos({ photos, type, tempId, siteId }) {
  const urls = [];
  const list = (photos || []).filter((p) => p?.blob);
  for (let i = 0; i < list.length; i += 1) {
    const url = await uploadEntryPhoto({
      photo: list[i],
      type,
      tempId: `${tempId}-${i + 1}`,
      siteId,
    });
    if (url) urls.push(url);
  }
  return urls;
}

export async function uploadEntryPhoto({ photo, type, tempId, siteId }) {
  if (!photo?.blob) return null;

  const extension = photo.extension || 'jpg';
  const safeType = String(type || 'entry').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  const safeSite = String(siteId || 'unknown-site').replace(/[^a-z0-9-]/gi, '').toLowerCase();
  const filePath = `${safeSite}/${safeType}/${tempId}.${extension}`;

  const { error } = await supabase.storage
    .from(ENTRY_PHOTOS_BUCKET)
    .upload(filePath, photo.blob, {
      cacheControl: '31536000',
      contentType: photo.mimeType || photo.blob.type || 'image/jpeg',
      upsert: true,
    });

  if (error) {
    throw new Error(error.message || 'Photo upload failed');
  }

  const { data } = supabase.storage.from(ENTRY_PHOTOS_BUCKET).getPublicUrl(filePath);
  return data?.publicUrl || null;
}
