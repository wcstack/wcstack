import { useState, useRef, useEffect, useCallback } from "react";
import { useWcBindable } from "@wc-bindable/react";
import type { WcsWsValues, WcsWebSocket } from "@wcstack/websocket";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

interface WsMessage {
  type: string;
  content?: string;
  from?: string;
  clients?: number;
  uptime?: number;
  timestamp?: number;
}

interface LogEntry {
  type: string;
  time: string;
  text: string;
}

export function App() {
  const [wsRef, ws] = useWcBindable<WcsWebSocket, WcsWsValues<WsMessage | null>>({
    message: null,
    connected: false,
    loading: false,
    error: null,
    readyState: 0,
    trigger: false,
    send: null,
  });

  const elRef = useRef<WcsWebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<{ clients: number; uptime: number } | null>(null);
  const [messageLog, setMessageLog] = useState<LogEntry[]>([]);
  const [echoInput, setEchoInput] = useState("");
  const [broadcastInput, setBroadcastInput] = useState("");
  const [nickname] = useState("react-" + Math.random().toString(36).slice(2, 6));

  const ref = useCallback((node: WcsWebSocket | null) => {
    elRef.current = node;
    wsRef(node);
  }, [wsRef]);

  useEffect(() => {
    const msg = ws.message;
    if (!msg) return;

    if (msg.type === "stats") {
      setStats(msg as { clients: number; uptime: number });
      return;
    }

    const time = msg.timestamp
      ? new Date(msg.timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    const entry: LogEntry = { type: msg.type || "unknown", time, text: "" };
    if (msg.type === "echo") {
      entry.text = msg.content ?? "";
    } else if (msg.type === "broadcast") {
      entry.text = `[${msg.from}] ${msg.content}`;
    } else if (msg.type === "connected") {
      entry.text = `WebSocket connected (${msg.clients} clients)`;
    } else {
      entry.text = JSON.stringify(msg);
    }

    setMessageLog((prev) => [...prev, entry]);
  }, [ws.message]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageLog]);

  const sendEcho = useCallback(() => {
    const text = echoInput.trim();
    if (!text || !ws.connected || !elRef.current) return;
    elRef.current.send = JSON.stringify({ type: "echo", content: text });
    setEchoInput("");
  }, [echoInput, ws.connected]);

  const sendBroadcast = useCallback(() => {
    const text = broadcastInput.trim();
    if (!text || !ws.connected || !elRef.current) return;
    elRef.current.send = JSON.stringify({ type: "broadcast", content: text, from: nickname });
    setBroadcastInput("");
  }, [broadcastInput, ws.connected, nickname]);

  const connectionLabel = ws.loading ? "Connecting…" : ws.connected ? "Connected" : "Disconnected";

  return (
    <>
      <wcs-ws
        ref={ref}
        url={WS_URL}
        auto-reconnect=""
        reconnect-interval="3000"
        max-reconnects="10"
      />

      <main>
        <section className="hero">
          <span className="eyebrow">Framework Interop Demo</span>
          <h1>wcstack WebSocket<br />from React</h1>
          <p className="lead">
            A React 19 app uses the <code>&lt;wcs-ws&gt;</code> Web Component for real-time
            communication. The power of framework-agnostic web standards.
          </p>
          <div className="tech-badges">
            <span className="tech-badge react">React 19</span>
            <span className="tech-badge wc">&lt;wcs-ws&gt; Web Component</span>
            <span className="tech-badge bind">@wc-bindable/react</span>
          </div>
        </section>

        <div className="status-bar">
          <div className="status">
            <span className={`dot${ws.connected ? " live" : ""}`} />
            <span>{connectionLabel}</span>
          </div>
          <div className="stat-badge">
            Clients: <strong>{stats?.clients ?? "—"}</strong>
          </div>
          <div className="stat-badge">
            Uptime: <strong>{stats ? stats.uptime + "s" : "—"}</strong>
          </div>
        </div>

        {ws.error && (
          <div className="callout error" style={{ marginBottom: 14 }}>
            <strong>Connection Error</strong><br />
            {(ws.error as { message?: string }).message || String(ws.error)}
          </div>
        )}

        <div className="grid">
          <div className="panel">
            <h2>Echo</h2>
            <p className="lead">Send a message and the server echoes it back.</p>
            <div className="input-row">
              <input
                type="text"
                placeholder="Echo message…"
                value={echoInput}
                onChange={(e) => setEchoInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendEcho()}
              />
              <button
                className="btn-echo"
                disabled={!ws.connected || !echoInput.trim()}
                onClick={sendEcho}
              >Send</button>
            </div>
          </div>

          <div className="panel">
            <h2>Broadcast</h2>
            <p className="lead">Deliver a message to all connected clients.</p>
            <div className="input-row">
              <input
                type="text"
                placeholder="Broadcast message…"
                value={broadcastInput}
                onChange={(e) => setBroadcastInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendBroadcast()}
              />
              <button
                className="btn-broadcast"
                disabled={!ws.connected || !broadcastInput.trim()}
                onClick={sendBroadcast}
              >Send</button>
            </div>
            <div className="input-row">
              <input
                type="text"
                placeholder="Nickname"
                value={nickname}
                readOnly
                style={{ maxWidth: 180 }}
              />
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>Message Log</h2>
            <button
              style={{ background: "rgba(0,0,0,0.06)", color: "var(--muted)", fontSize: "0.8rem", padding: "6px 12px" }}
              onClick={() => setMessageLog([])}
            >Clear</button>
          </div>

          <div className="log">
            {messageLog.length === 0 ? (
              <div className="log-empty">Messages will appear here after connecting.</div>
            ) : (
              messageLog.map((entry, i) => (
                <div key={i} className={`log-entry log-${entry.type}`}>
                  <span className="log-time">{entry.time}</span>{" "}
                  {entry.type === "echo" ? "Echo: " : ""}{entry.text}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        <div className="callout" style={{ marginTop: 18, fontSize: "0.88rem" }}>
          <strong>How it works:</strong> The <code>useWcBindable()</code> hook from
          <code>@wc-bindable/react</code> automatically syncs all properties of
          <code>&lt;wcs-ws&gt;</code> (message, connected, loading, error) into React state.
          No manual <code>addEventListener</code> needed.
        </div>
      </main>
    </>
  );
}
