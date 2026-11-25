import { useEffect, useEffectEvent } from 'react';

/**
 * Subscribes to a Server-Sent Events stream while the calling component is mounted.
 * The stream is also closed when the page is being unloaded (so the browser does not report
 * an interrupted connection) and reopened if the page comes back from the back/forward cache.
 */
export function useEventSource(url, eventName, onMessage) {
  const handle = useEffectEvent((event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    onMessage(data);
  });

  useEffect(() => {
    if (!url) return undefined;
    let source = null;
    const listener = (event) => handle(event);

    function open() {
      source = new EventSource(url);
      source.addEventListener(eventName, listener);
    }
    function close() {
      if (!source) return;
      source.removeEventListener(eventName, listener);
      source.close();
      source = null;
    }
    function onPageShow(event) {
      if (event.persisted && !source) open();
    }

    open();
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', close);
      window.removeEventListener('pageshow', onPageShow);
      close();
    };
  }, [url, eventName]);
}
