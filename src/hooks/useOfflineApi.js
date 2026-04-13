import { useOfflineQueue } from "./useOfflineQueue";
import api from "../services/api";

export function useOfflineApi() {
  const { isOnline, addToQueue } = useOfflineQueue();

  const post = async (url, data) => {
    // Always check navigator.onLine first (most reliable)
    if (!navigator.onLine) {
      addToQueue("post", url, data);
      return { ...data, id: `offline_${Date.now()}`, _offline: true };
    }

    try {
      // Attempt online request with a short timeout to avoid hanging
      const response = await api.post(url, data, { timeout: 5000 });
      return response.data;
    } catch (err) {
      // If network error or timeout, queue it
      if (!err.response || err.code === 'ECONNABORTED' || err.message.includes('Network Error')) {
        addToQueue("post", url, data);
        return { ...data, id: `offline_${Date.now()}`, _offline: true };
      }
      // Otherwise it's a server error (4xx/5xx) – rethrow
      throw err;
    }
  };

  const patch = async (url, data) => {
    if (!navigator.onLine) {
      addToQueue("patch", url, data);
      return { ...data, _offline: true };
    }

    try {
      const response = await api.patch(url, data, { timeout: 5000 });
      return response.data;
    } catch (err) {
      if (!err.response || err.code === 'ECONNABORTED' || err.message.includes('Network Error')) {
        addToQueue("patch", url, data);
        return { ...data, _offline: true };
      }
      throw err;
    }
  };

  return { post, patch, isOnline };
}