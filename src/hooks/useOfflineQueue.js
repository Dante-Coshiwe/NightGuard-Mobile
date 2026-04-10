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

  const addToQueue = useCallback((method, url, data) => {
    const queue = getQueue();
    queue.push({ id: Date.now(), method, url, data, timestamp: new Date().toISOString() });
    saveQueue(queue);
  }, []);

  const syncQueue = useCallback(async () => {
    const queue = getQueue();
    if (queue.length === 0) return;
    setSyncing(true);
    const failed = [];
    for (const item of queue) {
      try {
        await api[item.method](item.url, item.data);
      } catch (err) {
        if (err.response?.status !== 400 && err.response?.status !== 422) {
          failed.push(item);
        }
      }
    }
    saveQueue(failed);
    setSyncing(false);
    // Clear local caches so fresh data loads from server
    localStorage.removeItem('cached_pedestrians');
    localStorage.removeItem('cached_vehicles');
    localStorage.removeItem('cached_ob_entries');
    // Trigger a page reload to refresh all data
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
