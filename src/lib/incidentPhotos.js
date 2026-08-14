// Reading an incident's photos back is deliberately forgiving, because the same incident can reach
// a screen in four different shapes:
//
//   - a fresh Supabase row, where `photo_urls` is a jsonb array;
//   - the same row over PostgREST on a client that stringified the jsonb, so it arrives as text;
//   - an optimistic offline copy the guard is looking at right now, which still holds locally
//     captured data: URLs in `_pendingPhotos` because nothing has been uploaded yet;
//   - a row written before the photo columns existed, which has neither.
//
// Every caller wants the same thing — an ordered list of things it can put in an <img src>. One
// reader, so the list view, the detail view and the PDF cannot disagree about what an incident has.

function coerceList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [trimmed];
  }
  return [];
}

function isDisplayable(url) {
  return typeof url === 'string' && (/^https?:\/\//i.test(url) || url.startsWith('data:image/'));
}

export function incidentPhotoUrls(incident) {
  if (!incident) return [];
  const stored = coerceList(incident.photo_urls);
  const pending = (incident._pendingPhotos || []).map((photo) => photo?.dataUrl);
  const urls = [...stored, ...pending, incident.picture_url].filter(isDisplayable);
  return Array.from(new Set(urls));
}

export function incidentPhotoCount(incident) {
  return incidentPhotoUrls(incident).length;
}

export function pendingPhotoCount(incident) {
  if (!incident) return 0;
  if (Array.isArray(incident._pendingPhotos)) return incident._pendingPhotos.length;
  return Number(incident._pendingPhotoCount) || 0;
}

// The offline queue and this screen's display cache are BOTH localStorage. A queued incident's
// photos are megabytes of base64, and writing them to both puts the same bytes in the same quota
// twice — with saveQueue()'s only failure handling being a console.error, a quota exception there
// silently discards the whole outbox. The bytes therefore live in exactly one place, the queue,
// which is the copy that actually needs them; the cache keeps a count so the card can still say
// the photos exist and are on their way.
export function stripPendingPhotos(incident) {
  if (!incident?._pendingPhotos) return incident;
  const { _pendingPhotos, ...rest } = incident;
  return { ...rest, _pendingPhotoCount: _pendingPhotos.length };
}

export function stripPendingPhotosFromList(incidents) {
  return (incidents || []).map(stripPendingPhotos);
}
