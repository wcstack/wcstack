import { createContext, use, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { api, isAbortError } from '../lib/api.js';
import { useEventSource } from '../hooks/useEventSource.js';

/**
 * App-wide report store: the status summary behind the header badge. It is kept current by
 * its own Server-Sent Events subscription (open for the whole session) and by the app's own
 * changes, which adjust the counts optimistically.
 */
const ReportsStoreContext = createContext(null);

function summaryReducer(state, action) {
  switch (action.type) {
    case 'loaded':
      return { ...state, summary: action.summary };
    case 'statusChanged': {
      if (!state.summary || action.from === action.to) return state;
      const summary = { ...state.summary };
      summary[action.from] = Math.max(0, summary[action.from] - action.count);
      summary[action.to] += action.count;
      return { ...state, summary };
    }
    default:
      return state;
  }
}

export function ReportsStoreProvider({ children }) {
  const [state, dispatch] = useReducer(summaryReducer, { summary: null });
  const inFlight = useRef(null);

  const refreshSummary = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    api.summary({ signal: controller.signal }).then(
      (summary) => dispatch({ type: 'loaded', summary }),
      (error) => {
        if (!isAbortError(error)) console.info('summary refresh failed', error.status);
      },
    );
  }, []);

  useEffect(() => {
    refreshSummary();
    return () => inFlight.current?.abort();
  }, [refreshSummary]);

  useEventSource('/api/events', 'report', refreshSummary);

  const statusChanged = useCallback((from, to, count = 1) => dispatch({ type: 'statusChanged', from, to, count }), []);

  const value = useMemo(
    () => ({ summary: state.summary, refreshSummary, statusChanged }),
    [state.summary, refreshSummary, statusChanged],
  );
  return <ReportsStoreContext value={value}>{children}</ReportsStoreContext>;
}

export function useReportsStore() {
  return use(ReportsStoreContext);
}
