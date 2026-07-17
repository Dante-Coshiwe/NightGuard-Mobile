import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { getCachedSiteSettings } from '../lib/deviceStore';
import {
  NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT,
  NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT,
  confirmAppOnline,
  dispatchConnectivityRecheck,
  isAppOnline,
} from '../lib/connectivity';
import { recordDeviceSyncLog, refreshOperationalCachesFromDatabase } from '../services/schemaData';
import { uploadPendingPhoto } from '../lib/photoCapture';
import { getCachedIncidents, setCachedIncidents, getCachedObEntries, setCachedObEntries } from '../lib/reportCache';
import {
  getCachedPedestrians,
  getCachedGuards,
  getCachedVehicles,
  getNfcScans,
  saveCachedPedestrians,
  saveCachedVehicles,
  saveCachedGuards,
  saveCachedSiteSettings,
  saveLastSyncAt,
  saveNfcScans,
  getCachedPatrols,
  saveCachedPatrols,
  isGeneralGuardId,
} from '../lib/deviceStore';

const QUEUE_KEY = 'nightguard_offline_queue';
const OfflineQueueContext = createContext(null);
let syncInFlight = null;
let lastOnlineSyncTriggerAt = 0;
const ONLINE_SYNC_DEBOUNCE_MS = 4000;

function canTriggerOnlineSync() {
  const now = Date.now();
  if (now - lastOnlineSyncTriggerAt < ONLINE_SYNC_DEBOUNCE_MS) {
    return false;
  }
  lastOnlineSyncTriggerAt = now;
  return true;
}

function getQueue() {
  try {
    const queued = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    console.log(`[OfflineQueue] getQueue(): ${queued.length} items pending`);
    return queued;
  } catch (err) {
    console.error(`[OfflineQueue] getQueue() ERROR:`, err.message);
    return [];
  }
}

function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    console.log(`[OfflineQueue] saveQueue(): saved ${queue.length} items`, queue);
    window.dispatchEvent(new Event('nightguard_queue_updated'));
  } catch (err) {
    console.error(`[OfflineQueue] saveQueue() ERROR:`, err.message);
  }
}

function shouldDropFailedItem(err) {
  const status = err?.response?.status;
  return [400, 404, 409, 410, 422].includes(status);
}

function normaliseQueueUrl(item) {
  if (item.method === 'post' && item.url === '/users/guards') {
    return '/shifts/guards/add';
  }
  return item.url;
}

function extractGuardPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload?.guard || payload?.user || payload;
}

function remapPayloadReferences(payload, createdIdMap) {
  if (!payload || typeof payload !== 'object') return payload;

  const mapped = { ...payload };
  ['guard_id', 'local_guard_id', 'shift_id', 'patrol_id', 'checkpoint_id'].forEach((key) => {
    if (mapped[key] && createdIdMap.has(mapped[key])) {
      mapped[key] = createdIdMap.get(mapped[key]);
    }
  });
  return mapped;
}

function replaceCachedEntity(cacheKey, clientTempId, nextEntity) {
  console.log(`[OfflineQueue] replaceCachedEntity(): key="${cacheKey}", tempId="${clientTempId}", updating with:`, nextEntity);
  const cached = cacheKey === 'cached_pedestrians' ? getCachedPedestrians() : getCachedVehicles();
  const updated = cached.map((entry) => (
    entry.id === clientTempId ? { ...entry, ...nextEntity, _offline: false, _pendingExit: false } : entry
  ));
  if (cacheKey === 'cached_pedestrians') {
    saveCachedPedestrians(updated);
    console.log(`[OfflineQueue] replaceCachedEntity(): Updated ${cacheKey} cache with synced data`);
    return;
  }
  saveCachedVehicles(updated);
  console.log(`[OfflineQueue] replaceCachedEntity(): Updated ${cacheKey} cache with synced data`);
}

function updateCachedNfcScan(clientTempId, responseData) {
  console.log(`[OfflineQueue] updateCachedNfcScan(): tempId="${clientTempId}", responseData:`, responseData);
  const scans = getNfcScans().map((scan) => (
    String(scan.id) === String(clientTempId)
      ? {
          ...scan,
          ...responseData,
          id: responseData?.scan?.id || responseData?.id || scan.id,
          offline: false,
          _offline: false,
        }
      : scan
  ));
  saveNfcScans(scans);
  console.log(`[OfflineQueue] updateCachedNfcScan(): Updated NFC scans cache`);
}

async function applySuccessfulSync(item, response) {
  const responseData = response?.data;
  if (!responseData) {
    console.log(`[OfflineQueue] applySuccessfulSync(): No response data to apply`);
    return;
  }

  const resolvedUrl = normaliseQueueUrl(item);
  const guardPayload = extractGuardPayload(responseData);

  // Update pedestrians with synced IDs
  if (item.method === 'post' && (responseData.id || guardPayload?.id) && item.clientTempId) {
    if (item.url.includes('pedestrians')) {
      console.log(`[OfflineQueue] applySuccessfulSync(): Updating pedestrian cache with serverId=${responseData.id}`);
      replaceCachedEntity('cached_pedestrians', item.clientTempId, { id: responseData.id });
    }
    // Update vehicles with synced IDs
    if (item.url.includes('vehicles')) {
      console.log(`[OfflineQueue] applySuccessfulSync(): Updating vehicle cache with serverId=${responseData.id}`);
      replaceCachedEntity('cached_vehicles', item.clientTempId, { id: responseData.id });
    }
    // Update guards with synced data
    if (resolvedUrl.includes('/users/guards') || resolvedUrl.includes('/shifts/guards/add')) {
      console.log(`[OfflineQueue] applySuccessfulSync(): Updating guard cache with guardId=${guardPayload?.id}`);
      if (guardPayload && typeof guardPayload === 'object') {
        const guards = getCachedGuards().map((guard) => (
          String(guard.id) === String(item.clientTempId)
            ? { ...guard, ...guardPayload, id: guardPayload?.id || guard.id, _offline: false }
            : guard
        ));
        saveCachedGuards(guards);
      } else {
        console.warn('[OfflineQueue] applySuccessfulSync(): guardPayload invalid, skipping guard update');
      }
    }
  }

  // Update NFC scans
  if (item.url.includes('/nfc/scan') && item.clientTempId) {
    console.log(`[OfflineQueue] applySuccessfulSync(): Updating NFC scan with response id=${responseData?.id}`);
    updateCachedNfcScan(item.clientTempId, responseData);
  }

  if (item.url === '/patrols/start' && item.clientTempId && responseData?.id) {
    const updated = getCachedPatrols().map((patrol) => (
      String(patrol.id) === String(item.clientTempId)
        ? { ...patrol, ...responseData, id: responseData.id, _offline: false }
        : patrol
    ));
    saveCachedPatrols(updated);
  }

  // Update pedestrian exit
  if (item.url.includes('/pedestrians/') && item.url.endsWith('/exit')) {
    const pedestrianId = item.url.split('/pedestrians/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Marking pedestrian ${pedestrianId} as exited`);
    replaceCachedEntity('cached_pedestrians', pedestrianId, {
      hasLeft: true,
      exitTime: responseData.exit_time || new Date().toISOString(),
    });
  }

  // Update vehicle exit
  if (item.url.includes('/vehicles/') && item.url.endsWith('/exit')) {
    const vehicleId = item.url.split('/vehicles/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Marking vehicle ${vehicleId} as exited`);
    replaceCachedEntity('cached_vehicles', vehicleId, {
      hasLeft: true,
      exitedAt: responseData.exited_at || new Date().toISOString(),
    });
  }

  // Update guard PIN
  if (item.url.includes('/users/guards/') && item.url.includes('/pin')) {
    const guardId = item.url.split('/users/guards/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Updated guard ${guardId} PIN`);
    const guards = getCachedGuards().map((guard) => (
      String(guard.id) === String(guardId)
        ? { ...guard, pin: item.data.pin, guard_pin: item.data.pin, _offline: false }
        : guard
    ));
    saveCachedGuards(guards);
  }

  // Update guard toggle
  if (item.url.includes('/users/guards/') && item.url.includes('/toggle')) {
    const guardId = item.url.split('/users/guards/')[1]?.split('/')[0];
    console.log(`[OfflineQueue] applySuccessfulSync(): Toggled guard ${guardId} active status`);
    const guards = getCachedGuards().map((guard) => (
      String(guard.id) === String(guardId)
        ? { ...guard, is_active: item.data.is_active, _offline: false }
        : guard
    ));
    saveCachedGuards(guards);
  }

  // Update site settings
  if (item.url === '/sites/mine' || item.url.endsWith('/sites/mine')) {
    console.log(`[OfflineQueue] applySuccessfulSync(): Updated site settings`);
    saveCachedSiteSettings({
      ...getCachedSiteSettings(),
      ...item.data,
      ...responseData,
      _offline: false,
    });
  }

  // Update cached incidents so the UI can reflect queued reports immediately.
  if (item.url === '/incidents/report' && item.clientTempId && responseData?.id) {
    try {
      const cached = await getCachedIncidents();
      const updated = cached.map((inc) => (
        String(inc.id) === String(item.clientTempId)
          ? { ...inc, ...responseData, id: responseData.id, _offline: false }
          : inc
      ));
      const replaced = updated.some((inc) => String(inc.id) === String(responseData.id));
      const finalised = replaced ? updated : [{ ...responseData, _offline: false }, ...updated];
      await setCachedIncidents(finalised);
      console.log('[OfflineQueue] applySuccessfulSync(): Updated cached_incidents');
    } catch (err) {
      console.warn('[OfflineQueue] applySuccessfulSync(): Failed to update cached_incidents:', err?.message || err);
    }
  }

  // Update cached OB entries so the UI can reflect queued entries immediately.
  if (item.url === '/obentries/create' && item.clientTempId && responseData?.id) {
    try {
      const cached = await getCachedObEntries();
      const updated = cached.map((entry) => (
        String(entry.id) === String(item.clientTempId)
          ? { ...entry, ...responseData, id: responseData.id, _offline: false }
          : entry
      ));
      const replaced = updated.some((entry) => String(entry.id) === String(responseData.id));
      const finalised = replaced ? updated : [{ ...responseData, _offline: false }, ...updated];
      await setCachedObEntries(finalised);
      console.log('[OfflineQueue] applySuccessfulSync(): Updated cached_ob_entries');
    } catch (err) {
      console.warn('[OfflineQueue] applySuccessfulSync(): Failed to update cached_ob_entries:', err?.message || err);
    }
  }
}

function makeQueueKey(method, url, data, clientTempId) {
  return clientTempId || `${method}:${url}:${JSON.stringify(data || {})}`;
}

export function enqueueOfflineItem(method, url, data, clientTempId = null) {
  const isGuardMutation = String(url || '').includes('/users/guards') || String(url || '').includes('/shifts/guards');
  const guardPayload = extractGuardPayload(data);
  if (isGuardMutation && (guardPayload?._is_general_guard || isGeneralGuardId(guardPayload?.id || clientTempId))) {
    console.log('[OfflineQueue] General Guard is local-only; skipping sync queue item');
    return getQueue();
  }

  const queue = getQueue();
  const itemKey = makeQueueKey(method, url, data, clientTempId);
  const exists = queue.some((item) => makeQueueKey(item.method, item.url, item.data, item.clientTempId) === itemKey);

  if (exists) {
    console.log(`[OfflineQueue] enqueueOfflineItem(): DUPLICATE SKIPPED - ${method} ${url}`);
    return queue;
  }

  const next = [
    ...queue,
    {
      id: Date.now(),
      method,
      url,
      data,
      timestamp: new Date().toISOString(),
      clientTempId,
    },
  ];
  console.log(`[OfflineQueue] enqueueOfflineItem(): QUEUED - ${method} ${url}, clientId="${clientTempId}"`, data);
  saveQueue(next);
  return next;
}

export async function syncOfflineQueueNow() {
  if (syncInFlight) {
    console.log(`[OfflineQueue] syncOfflineQueueNow(): SYNC ALREADY IN FLIGHT - SKIPPED`);
    return syncInFlight;
  }

  if (!isAppOnline()) {
    console.log(`[OfflineQueue] syncOfflineQueueNow(): OFFLINE - NO SYNC`);
    return { syncedCount: 0, failedCount: getQueue().length };
  }

  syncInFlight = (async () => {
    const queue = getQueue();
    const startedAt = new Date().toISOString();
    console.log(`[OfflineQueue] SYNC STARTED - ${queue.length} items to sync at ${startedAt}`);
    
    if (queue.length === 0) {
      console.log(`[OfflineQueue] SYNC COMPLETED - Queue empty`);
      return { syncedCount: 0, failedCount: 0 };
    }

    const failed = [];
    let syncedCount = 0;
    const createdIdMap = new Map();

    for (const item of queue) {
      try {
        const guardPayload = extractGuardPayload(item.data);
        if ((item.url.includes('/users/guards') || item.url.includes('/shifts/guards')) &&
          (guardPayload?._is_general_guard || isGeneralGuardId(guardPayload?.id || item.clientTempId))) {
          console.log('[OfflineQueue] SYNC SKIP - General Guard is local-only');
          continue;
        }
        console.log(`[OfflineQueue] SYNC ITEM - ${item.method.toUpperCase()} ${item.url}`, item.data);
        let resolvedUrl = normaliseQueueUrl(item);

        if (item.url.includes('/pedestrians/') && item.url.endsWith('/exit')) {
          const pedId = item.url.split('/pedestrians/')[1]?.split('/')[0];
          if (createdIdMap.has(pedId)) {
            resolvedUrl = `/pedestrians/${createdIdMap.get(pedId)}/exit`;
            console.log(`[OfflineQueue] SYNC ITEM - remapped pedestrian exit URL: ${resolvedUrl}`);
          }
        }

        if (item.url.includes('/vehicles/') && item.url.endsWith('/exit')) {
          const vehicleId = item.url.split('/vehicles/')[1]?.split('/')[0];
          if (createdIdMap.has(vehicleId)) {
            resolvedUrl = `/vehicles/${createdIdMap.get(vehicleId)}/exit`;
            console.log(`[OfflineQueue] SYNC ITEM - remapped vehicle exit URL: ${resolvedUrl}`);
          }
        }

        let remappedData = remapPayloadReferences(item.data, createdIdMap);

        // Upload any photo captured while offline, then post the entry with the resulting URL.
        // If the upload fails it throws, keeping the item queued so the picture is never lost.
        if (remappedData && remappedData._pendingPhoto) {
          const photoType = item.url.includes('/vehicles') ? 'vehicles' : 'pedestrians';
          const uploadedUrl = await uploadPendingPhoto({
            pendingPhoto: remappedData._pendingPhoto,
            type: photoType,
            tempId: item.clientTempId || String(item.id),
            siteId: remappedData.site_id,
          });
          const { _pendingPhoto, ...rest } = remappedData;
          remappedData = { ...rest, picture_url: uploadedUrl || rest.picture_url || null };
          console.log(`[OfflineQueue] SYNC - Uploaded queued ${photoType} photo -> ${uploadedUrl ? 'ok' : 'no url'}`);
        }

        const response = await api[item.method](resolvedUrl, remappedData);
        confirmAppOnline('offline-queue-sync-success');
        const responseEntityId = response?.data?.id || extractGuardPayload(response?.data)?.id;
        
        console.log(`[OfflineQueue] SYNC SUCCESS - ${item.method.toUpperCase()} ${resolvedUrl}, responseId=${responseEntityId}`, response?.data);
        
        if (item.method === 'post' && item.clientTempId && responseEntityId) {
          createdIdMap.set(item.clientTempId, responseEntityId);
          console.log(`[OfflineQueue] SYNC - Mapped tempId "${item.clientTempId}" -> "${responseEntityId}"`);
        }
        await applySuccessfulSync(item, response);
        syncedCount += 1;
      } catch (err) {
        console.error(`[OfflineQueue] SYNC ERROR - ${item.method.toUpperCase()} ${item.url}:`, err.message, err?.response?.status);
        if (!shouldDropFailedItem(err)) {
          failed.push(item);
          console.log(`[OfflineQueue] SYNC - Item kept in queue to retry later`);
        } else {
          console.log(`[OfflineQueue] SYNC - Item dropped (unrecoverable error ${err?.response?.status})`);
        }
      }
    }

    saveQueue(failed);
    console.log(`[OfflineQueue] SYNC - Queue updated: ${syncedCount} synced, ${failed.length} failed/pending`);

    if (syncedCount > 0) {
      await refreshOperationalCachesFromDatabase(getCachedSiteSettings()).catch(() => null);
      saveLastSyncAt();
      await recordDeviceSyncLog({
        syncType: 'offline_queue',
        syncStatus: failed.length ? 'partial' : 'completed',
        recordsSynced: syncedCount,
        startedAt,
        completedAt: new Date().toISOString(),
        errorMessage: failed.length ? `${failed.length} items still pending` : '',
      }, getCachedSiteSettings()).catch(() => null);
      window.dispatchEvent(new Event('nightguard_sync_complete'));
      console.log(`[OfflineQueue] SYNC COMPLETED - final status: ${failed.length ? 'PARTIAL' : 'FULL'}`);
    }

    return { syncedCount, failedCount: failed.length };
  })();

  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

function useOfflineQueueController() {
  const [isOnline, setIsOnline] = useState(isAppOnline());
  const [queueCount, setQueueCount] = useState(getQueue().length);
  const [syncing, setSyncing] = useState(false);

  const addToQueue = useCallback((method, url, data, clientTempId = null) => {
    const next = enqueueOfflineItem(method, url, data, clientTempId);
    setQueueCount(next.length);
  }, []);

  const syncQueue = useCallback(async () => {
    if (!isAppOnline()) return;
    setSyncing(true);
    try {
      const result = await syncOfflineQueueNow();
      setQueueCount(getQueue().length);
      return result;
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const updateCount = () => setQueueCount(getQueue().length);
    const handleOnline = async () => {
      const online = isAppOnline();
      setIsOnline(online);
      if (!online) return;
      if (!canTriggerOnlineSync()) return;
      await syncQueue();
    };
    const handleOffline = async () => {
      const online = await dispatchConnectivityRecheck('queue-offline-event');
      setIsOnline(online);
      if (!online) {
        setSyncing(false);
      }
    };
    const handleConnectivityChange = (event) => {
      const online = Boolean(event?.detail?.online);
      setIsOnline(online);
      if (!online) {
        setSyncing(false);
      }
    };

    updateCount();
    if (isAppOnline() && getQueue().length > 0 && canTriggerOnlineSync()) {
      syncQueue();
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('nightguard_queue_updated', updateCount);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT, handleConnectivityChange);
    window.addEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('nightguard_queue_updated', updateCount);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_CHANGE_EVENT, handleConnectivityChange);
      window.removeEventListener(NIGHTGUARD_CONNECTIVITY_RECHECK_EVENT, handleOnline);
    };
  }, [syncQueue]);

  return useMemo(() => ({
    isOnline,
    queueCount,
    syncing,
    addToQueue,
    syncQueue,
  }), [isOnline, queueCount, syncing, addToQueue, syncQueue]);
}

export function OfflineQueueProvider({ children }) {
  const value = useOfflineQueueController();
  return createElement(OfflineQueueContext.Provider, { value }, children);
}

export function useOfflineQueue() {
  const context = useContext(OfflineQueueContext);
  if (!context) {
    throw new Error('useOfflineQueue must be used within OfflineQueueProvider');
  }
  return context;
}
