import { useCallback, useEffect, useRef, type RefObject } from "react";
import { useWcBindable } from "@wc-bindable/react";

// The adapter returns a callback ref and the values. Commands (fetch(), abort(), post()) and object
// inputs need the element too, so keep it in a ref that also calls the adapter's
// (docs/framework-adapter-integration.md §2).
export function useIoNode<E extends HTMLElement, V extends object>(initial: Partial<V>) {
  const elRef = useRef<E | null>(null);
  const [bindRef, values] = useWcBindable<E, V>(initial);
  const ref = useCallback(
    (node: E | null) => {
      elRef.current = node;
      bindRef(node as E);
    },
    [bindRef],
  );
  return [ref, values, elRef] as const;
}

// An output declared `semantics: "event"` (`message`) is an occurrence, not a state: through the
// adapter's values, a burst reaches React as one update and an equal value as none. Listen to the
// element's event instead (docs/framework-adapter-integration.md §5).
export function useIoEvent<T>(elRef: RefObject<HTMLElement | null>, type: string, handler: (detail: T) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const on = (e: Event) => latest.current((e as CustomEvent<T>).detail);
    el.addEventListener(type, on);
    return () => el.removeEventListener(type, on);
  }, [elRef, type]);
}
