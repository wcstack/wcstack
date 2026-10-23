import { useState } from "react";
import type { WcsSseValues } from "@wcstack/sse";
import { useIoEvent, useIoNode } from "./useIoNode";

export interface StockEvent { id: number; stock: number }
interface SseMessage { event: string; data: StockEvent; lastEventId: string }

// <wcs-sse> on the stock stream. Each message updates one product's stock. The messages are taken
// off the element's event: five of them in one chunk reached a useEffect on `sse.message` as one.
export function useLiveStock() {
  const [sseRef, sse, sseEl] = useIoNode<HTMLElement, WcsSseValues<StockEvent>>({
    message: null, connected: false, loading: false, error: null, readyState: 0,
  });
  const [live, setLive] = useState<Record<number, number>>({});
  const [lastId, setLastId] = useState<number | null>(null);

  useIoEvent<SseMessage | null>(sseEl, "wcs-sse:message", (m) => {
    if (!m || m.event !== "stock") return;
    setLive((prev) => ({ ...prev, [m.data.id]: m.data.stock }));
    setLastId(m.data.id);
  });

  const status = sse.connected ? "live" : sse.loading ? "reconnecting…" : sse.readyState === 2 ? "closed" : "offline";
  const node = <wcs-sse ref={sseRef} url="/api/stock/stream" events="stock" data-testid="sse"></wcs-sse>;
  return { node, live, lastId, status };
}

export function ConnectionBadge({ status }: { status: string }) {
  return <span data-testid="sse-status" className={"badge " + (status === "live" ? "on" : "off")}>stock: {status}</span>;
}
