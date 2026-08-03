import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getCachedSiteSettings, getLocationName } from './deviceStore';

function sanitizeFileName(value) {
  return String(value || 'report')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read PDF data'));
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

// Save/share any generated file.
//
// An `<a download>` click is a browser download, and an Android WebView has no download manager —
// the click resolves and nothing whatsoever happens, so an export button looked like it worked and
// produced no file. On native we write into the app's cache directory and hand the URI to the
// system share sheet, which is the only path that actually reaches the user on a device.
export async function exportBlobFile(blob, fileName, options = {}) {
  const {
    shareTitle = 'NightGuard Export',
    shareText = 'NightGuard generated file.',
    mimeType = 'application/octet-stream',
  } = options;

  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(blob);
    const path = `reports/${sanitizeFileName(fileName)}`;
    const result = await Filesystem.writeFile({
      path, data: base64, directory: Directory.Cache, recursive: true,
    });
    await Share.share({ title: shareTitle, text: shareText, url: result.uri, dialogTitle: shareTitle });
    return result;
  }

  const file = new File([blob], sanitizeFileName(fileName), { type: mimeType });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: shareTitle, text: shareText, files: [file] });
    return { shared: true };
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { downloaded: true };
}

export function getSiteDisplayName() {
  const site = getCachedSiteSettings();
  return site.site_name || site.location_name || getLocationName() || 'UNKNOWN SITE';
}

export function buildDatedReportFileName(prefix, extension = 'pdf') {
  const date = new Date().toISOString().split('T')[0];
  return `${sanitizeFileName(prefix)}-${date}.${extension}`;
}

export async function exportPdfDocument(doc, fileName, options = {}) {
  const {
    shareTitle = 'NightGuard Report',
    shareText = 'NightGuard generated report.',
    preferShare = false,
  } = options;

  const pdfBlob = doc.output('blob');

  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(pdfBlob);
    const path = `reports/${sanitizeFileName(fileName)}`;
    const result = await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });

    if (preferShare || Capacitor.getPlatform() === 'android') {
      await Share.share({
        title: shareTitle,
        text: shareText,
        url: result.uri,
        dialogTitle: shareTitle,
      });
    }

    return result;
  }

  const pdfFile = new File([pdfBlob], sanitizeFileName(fileName), { type: 'application/pdf' });
  if (preferShare && navigator.share && navigator.canShare?.({ files: [pdfFile] })) {
    await navigator.share({
      title: shareTitle,
      text: shareText,
      files: [pdfFile],
    });
    return { shared: true };
  }

  const url = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { downloaded: true };
}
