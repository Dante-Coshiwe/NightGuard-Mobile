import { useState, useEffect, useCallback } from "react";
import api from "../services/api";

const QUEUE_KEY = "nightguard_offline_queue";

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const getQueue = () => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
    catch { return []; }
  };

  const saveQueue = (queue) => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    setQueueCount(queue.length);
  };

  const addToQueue = useCallback((method, url, data, clientTempId = null) => {
    const queue = getQueue();
    queue.push({
      id: Date.now(),
      method,
      url,
      data,
      timestamp: new Date().toISOString(),
      clientTempId, // e.g., 'temp_1234567890'
    });
    saveQueue(queue);
  }, []);

  const syncQueue = useCallback(async () => {
    const queue = getQueue();
    if (queue.length === 0) return;
    setSyncing(true);
    const failed = [];

    for (const item of queue) {
      try {
        const response = await api[item.method](item.url, item.data);

        // If this was a POST that created a new entity with a real ID, update the cache
        if (item.method === 'post' && response?.data?.id && item.clientTempId) {
          const cacheKey = item.url.includes('pedestrians') ? 'cached_pedestrians' : 'cached_vehicles';
          const cached = JSON.parse(localStorage.getItem(cacheKey) || '[]');
          const updatedCache = cached.map(entry =>
            entry.id === item.clientTempId ? { ...entry, id: response.data.id, _offline: false } : entry
          );
          localStorage.setItem(cacheKey, JSON.stringify(updatedCache));
        }
      } catch (err) {
        if (err.response?.status !== 400 && err.response?.status !== 422) {
          failed.push(item);
        }
      }
    }

    saveQueue(failed);
    setSyncing(false);

    // Instead of clearing caches, just trigger a refresh event
    window.dispatchEvent(new Event('nightguard_sync_complete'));
  }, []);

  useEffect(() => {
    setQueueCount(getQueue().length);
    const handleOnline = () => { setIsOnline(true); syncQueue(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncQueue]);

  return { isOnline, queueCount, syncing, addToQueue, syncQueue };
}
