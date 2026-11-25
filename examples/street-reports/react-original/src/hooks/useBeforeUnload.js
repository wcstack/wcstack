import { useEffect } from 'react';

/** Asks the browser to confirm closing/reloading the tab while `active` is true. */
export function useBeforeUnloadGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
