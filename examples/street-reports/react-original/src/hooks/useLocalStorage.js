import { useCallback, useEffect, useState } from 'react';

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * State mirrored to localStorage as JSON. Changes made in other tabs arrive through the
 * `storage` event, so every tab follows the latest value.
 */
export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => read(key, initialValue));

  useEffect(() => {
    function onStorage(event) {
      if (event.storageArea === window.localStorage && event.key === key) {
        setValue(event.newValue === null ? initialValue : read(key, initialValue));
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, initialValue]);

  const update = useCallback(
    (next) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        try {
          if (resolved === undefined) window.localStorage.removeItem(key);
          else window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // Storage full or unavailable: keep the in-memory value.
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
