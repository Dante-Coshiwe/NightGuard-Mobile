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

export async function normaliseSelectedPhoto(file) {
  if (!file) return null;
  const dataUrl = await fileToDataUrl(file);
  return {
    dataUrl,
    blob: file,
    extension: getFileExtension(file.name || file.type),
    mimeType: file.type || 'image/jpeg',
  };
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
