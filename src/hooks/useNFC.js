import { useState, useCallback } from 'react';

export function useNFC() {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [lastTag, setLastTag] = useState(null);

  const isSupported = typeof window !== 'undefined' && 'NDEFReader' in window;

  const startScan = useCallback(async (onScan) => {
    if (!isSupported) {
      setError('NFC is not supported on this device or browser. Use Chrome on Android.');
      return;
    }

    setError('');
    setScanning(true);

    try {
      const reader = new window.NDEFReader();
      await reader.scan();

      reader.onreading = (event) => {
        const tagUid = event.serialNumber;
        setLastTag(tagUid);
        if (onScan) onScan(tagUid);
      };

      reader.onerror = (event) => {
        setError('NFC scan error: ' + event.message);
        setScanning(false);
      };
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('NFC permission denied. Please allow NFC access.');
      } else {
        setError('NFC error: ' + err.message);
      }
      setScanning(false);
    }
  }, [isSupported]);

  const stopScan = useCallback(() => {
    setScanning(false);
  }, []);

  return { isSupported, scanning, error, lastTag, startScan, stopScan };
}