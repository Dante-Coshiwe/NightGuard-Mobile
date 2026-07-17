import { useCallback } from 'react';

export function useScrollIntoView(delay = 100) {
  // NightGuard fix: keep focused guard-entry fields visible without touching keyboard inset logic.
  return useCallback((event) => {
    const el = event.currentTarget;
    setTimeout(() => {
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, delay);
  }, [delay]);
}
