import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

// Mirrors useNFC: a reusable primitive for reading the device location.
// Uses @capacitor/geolocation, which handles the Android runtime permission prompt on
// native and falls back to the browser Geolocation API on web (admin panel).

const POSITION_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };

function normalizePosition(position) {
  const coords = position?.coords || {};
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    timestamp: position?.timestamp || Date.now(),
  };
}

export function useGeolocation() {
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState('');
  const [lastPosition, setLastPosition] = useState(null);
  const watchIdRef = useRef(null);

  const isSupported = Capacitor?.isNativePlatform?.()
    ? true
    : typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const ensurePermission = useCallback(async () => {
    try {
      const status = await Geolocation.checkPermissions();
      if (status.location === 'granted' || status.coarseLocation === 'granted') return true;
      const requested = await Geolocation.requestPermissions();
      return requested.location === 'granted' || requested.coarseLocation === 'granted';
    } catch {
      // checkPermissions/requestPermissions are not implemented on web — the actual
      // getCurrentPosition/watchPosition call will trigger the browser prompt instead.
      return true;
    }
  }, []);

  const getCurrentPosition = useCallback(async () => {
    setError('');
    const allowed = await ensurePermission();
    if (!allowed) {
      const message = 'Location permission denied. Enable location to use GPS patrols.';
      setError(message);
      throw new Error(message);
    }
    try {
      const position = await Geolocation.getCurrentPosition(POSITION_OPTIONS);
      const fix = normalizePosition(position);
      setLastPosition(fix);
      return fix;
    } catch (err) {
      const message = err?.message || 'Unable to read GPS location.';
      setError(message);
      throw new Error(message);
    }
  }, [ensurePermission]);

  const stopWatch = useCallback(async () => {
    setWatching(false);
    const id = watchIdRef.current;
    watchIdRef.current = null;
    if (id != null) {
      try {
        await Geolocation.clearWatch({ id });
      } catch {
        /* ignore clear errors */
      }
    }
  }, []);

  const startWatch = useCallback(async (onFix) => {
    setError('');
    const allowed = await ensurePermission();
    if (!allowed) {
      setError('Location permission denied. Enable location to use GPS patrols.');
      return;
    }

    // Replace any existing watch.
    if (watchIdRef.current != null) {
      try {
        await Geolocation.clearWatch({ id: watchIdRef.current });
      } catch {
        /* ignore */
      }
      watchIdRef.current = null;
    }

    setWatching(true);
    try {
      const id = await Geolocation.watchPosition(POSITION_OPTIONS, (position, err) => {
        if (err) {
          setError(err?.message || 'GPS tracking error.');
          return;
        }
        if (!position) return;
        const fix = normalizePosition(position);
        setLastPosition(fix);
        if (onFix) onFix(fix);
      });
      watchIdRef.current = id;
    } catch (err) {
      setWatching(false);
      setError(err?.message || 'Unable to start GPS tracking.');
    }
  }, [ensurePermission]);

  // Clean up the watch if the consuming component unmounts.
  useEffect(() => {
    return () => {
      const id = watchIdRef.current;
      watchIdRef.current = null;
      if (id != null) {
        Geolocation.clearWatch({ id }).catch(() => null);
      }
    };
  }, []);

  return { isSupported, watching, error, lastPosition, startWatch, stopWatch, getCurrentPosition };
}
