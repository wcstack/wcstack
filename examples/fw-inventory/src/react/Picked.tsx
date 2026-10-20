import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useIoEvent, useIoNode } from "./useIoNode";

// The "picked" list, shared with the Vue panel over <wcs-broadcast name="inv-picked">.
// Wire format (both apps): { type: "picked", items: PickedItem[], from } | { type: "hello", from }
export interface PickedItem { id: number; sku: string; name: string; qty: number }
type Message = { type: "picked"; items: PickedItem[]; from: string } | { type: "hello"; from: string };
type BcEl = HTMLElement & { post(v: unknown): void };
interface Ctx { items: PickedItem[]; pick(p: { id: number; sku: string; name: string }): void; clear(): void; error: any }
const PickedContext = createContext<Ctx>({ items: [], pick() {}, clear() {}, error: null });
export const usePicked = () => useContext(PickedContext);

export function PickedProvider({ children }: { children: ReactNode }) {
  const [ref, bc, el] = useIoNode<BcEl, { message: Message | null; error: any }>({ message: null, error: null });
  const [items, setItemsState] = useState<PickedItem[]>([]);
  // the current list outside render, so posting is not a side effect of a state updater
  const itemsRef = useRef<PickedItem[]>([]);
  const setItems = (next: PickedItem[]) => { itemsRef.current = next; setItemsState(next); };

  const send = useCallback((next: PickedItem[]) => {
    el.current?.post({ type: "picked", items: next, from: "react" });
  }, [el]);

  // Each message off the element's event: a "hello" and a list arriving together are two messages.
  useIoEvent<Message | null>(el, "wcs-broadcast:message", (m) => {
    if (!m || typeof m !== "object") return;
    if (m.type === "picked" && Array.isArray(m.items)) setItems(m.items);
    if (m.type === "hello") send(itemsRef.current);
  });

  // Ask the other tabs for their list when this app starts.
  useEffect(() => { el.current?.post({ type: "hello", from: "react" }); }, [el]);

  const pick = useCallback((p: { id: number; sku: string; name: string }) => {
    const cur = itemsRef.current;
    const i = cur.findIndex((x) => x.id === p.id);
    const next = i >= 0 ? cur.map((x) => (x.id === p.id ? { ...x, qty: x.qty + 1 } : x)) : [...cur, { id: p.id, sku: p.sku, name: p.name, qty: 1 }];
    setItems(next);
    send(next);
  }, [send]);
  const clear = useCallback(() => { setItems([]); send([]); }, [send]);

  return (
    <PickedContext.Provider value={{ items, pick, clear, error: bc.error }}>
      <wcs-broadcast ref={ref} name="inv-picked" data-testid="bc"></wcs-broadcast>
      {children}
    </PickedContext.Provider>
  );
}

export function PickedPanel() {
  const { items, clear, error } = usePicked();
  return (
    <aside data-testid="picked">
      <strong>Picked ({items.reduce((n, x) => n + x.qty, 0)})</strong>{" "}
      {items.length > 0 && <button data-testid="picked-clear" onClick={clear}>Clear</button>}
      {error && <span className="error" data-testid="picked-error"> {error.name}: {error.message}</span>}
      <ul data-testid="picked-list">{items.map((x) => <li key={x.id} data-sku={x.sku}>{x.sku} {x.name} × {x.qty}</li>)}</ul>
    </aside>
  );
}
