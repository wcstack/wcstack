import { useEffect, useState } from 'react';

/** The current time, refreshed every `interval` ms so relative times keep ticking. */
export function useNow(interval = 10000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
