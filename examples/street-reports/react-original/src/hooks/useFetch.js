import { useCallback, useEffect, useState } from 'react';
import { isAbortError, request } from '../lib/api.js';

/**
 * GETs `url` (skips when null) with an AbortController per request. A response is only
 * applied if it belongs to the latest url/attempt, so a slow old response can never
 * overwrite a newer one. The previous data stays available while the next request runs.
 */
export function useFetch(url) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ key: null, data: undefined, error: null });
  const key = url ? `${attempt}:${url}` : null;

  useEffect(() => {
    if (!url) return undefined;
    const requestKey = `${attempt}:${url}`;
    const controller = new AbortController();
    request(url, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, data, error: null });
      },
      (error) => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setResult((prev) => ({ key: requestKey, data: prev.data, error }));
        }
      },
    );
    return () => controller.abort();
  }, [url, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const mutate = useCallback((update) => setResult((prev) => ({ ...prev, data: update(prev.data) })), []);

  const loading = key !== null && result.key !== key;
  return { data: result.data, error: loading ? null : result.error, loading, reload, mutate };
}
