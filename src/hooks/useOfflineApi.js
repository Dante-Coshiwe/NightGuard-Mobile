import { useOfflineQueue } from "./useOfflineQueue";
import api from "../services/api";

export function useOfflineApi() {
  const { isOnline, addToQueue } = useOfflineQueue();

  const post = async (url, data) => {
    if (isOnline) {
      return api.post(url, data).then(res => res.data);
    } else {
      addToQueue("post", url, data);
      return { ...data, id: `offline_${Date.now()}`, _offline: true };
    }
  };

  const patch = async (url, data) => {
    if (isOnline) {
      return api.patch(url, data).then(res => res.data);
    } else {
      addToQueue("patch", url, data);
      return { ...data, _offline: true };
    }
  };

  return { post, patch, isOnline };
}
