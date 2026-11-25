import { useEffect, useState } from 'react';

/** True only once `flag` has been true for `delay` ms (avoids flashing spinners). */
export function useDelayedFlag(flag, delay) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!flag) return undefined;
    const timer = setTimeout(() => setShown(true), delay);
    return () => {
      clearTimeout(timer);
      setShown(false);
    };
  }, [flag, delay]);
  return flag && shown;
}
