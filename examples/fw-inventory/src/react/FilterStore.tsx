import { useCallback, useEffect, useRef, useState } from "react";
import type { WcsStorageValues } from "@wcstack/storage";
import { useIoEvent, useIoNode } from "./useIoNode";
import type { Sort } from "./types";

export interface Filters { q: string; page: number; sort: Sort }
const KEY = "inv-filters";
type StorageEl = HTMLElement & { value: Filters | null };

// The list's filters, kept in <wcs-storage> (the storage README's "Saving from React").
// - `storage-key`, not `key`: React keeps `key` for itself and never hands it to the element.
// - The element loads the stored value when it connects, and its ref runs after that: read it once
//   there, and save only after it was read, or the first render writes the empty filters over it.
// - No `value={{ … }}` prop: a new object each render saves, announces `value`, and renders again.
// - Another tab's save arrives as `wcs-storage:value-changed`. It is taken off the element's event,
//   skipping the events this tab's own saves dispatch: through the adapter's `value`, an own save
//   comes back a render late and undoes the typing in between ("bol" and "bolt" saved and applied
//   in turn, forever — found landing this app).
export function useFilterStore(filters: Filters, apply: (f: Filters) => void) {
  const [bindRef, stored, elRef] = useIoNode<StorageEl, WcsStorageValues<Filters | null>>({ value: null, loading: false, error: null });
  const [restored, setRestored] = useState(false);
  const saving = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const ref = useCallback((node: StorageEl | null) => {
    bindRef(node);
    if (node === null) return;
    if (node.value && typeof node.value === "object") applyRef.current(node.value);
    setRestored(true);
  }, [bindRef]);

  useIoEvent<Filters | null>(elRef, "wcs-storage:value-changed", (v) => {
    if (!saving.current && v && typeof v === "object") applyRef.current(v);
  });

  // Save when a field changed: the dependencies are the fields, not an object.
  useEffect(() => {
    const el = elRef.current;
    if (!restored || !el) return;
    saving.current = true;
    try {
      el.value = { q: filters.q, page: filters.page, sort: filters.sort };
    } finally {
      saving.current = false;
    }
  }, [restored, filters.q, filters.page, filters.sort, elRef]);

  const node = <wcs-storage ref={ref} storage-key={KEY} data-testid="store"></wcs-storage>;
  return { node, restored, error: stored.error };
}
