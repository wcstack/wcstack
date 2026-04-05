/**
 * ws パッケージのラッパー。server.js に合わせた API を提供する。
 */
import { WebSocketServer as WsServer } from "ws";

export class WebSocketServer {
  /** @type {WsServer} */
  _wss;
  /** @type {Set<import("ws").WebSocket>} */
  _clients = new Set();
  /** @type {((ws: WebSocketClient, data: string) => void) | null} */
  _onMessageHandler = null;

  /**
   * @param {import("node:http").Server} httpServer
   * @param {string} path
   */
  constructor(httpServer, path) {
    this._wss = new WsServer({ server: httpServer, path });

    this._wss.on("connection", (ws) => {
      const client = new WebSocketClient(ws);
      this._clients.add(client);

      ws.on("message", (data) => {
        if (this._onMessageHandler) {
          this._onMessageHandler(client, data.toString());
        }
      });

      ws.on("close", () => {
        this._clients.delete(client);
      });

      ws.on("error", () => {
        this._clients.delete(client);
      });
    });
  }

  get clientCount() {
    return this._clients.size;
  }

  /** @param {(ws: WebSocketClient, data: string) => void} handler */
  onMessage(handler) {
    this._onMessageHandler = handler;
  }

  /** @param {string} data */
  broadcast(data) {
    for (const client of this._clients) {
      client.send(data);
    }
  }
}

export class WebSocketClient {
  /** @param {import("ws").WebSocket} ws */
  constructor(ws) {
    this._ws = ws;
  }

  /** @param {string} data */
  send(data) {
    if (this._ws.readyState === this._ws.OPEN) {
      this._ws.send(data);
    }
  }
}
