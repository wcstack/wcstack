/**
 * Shared demo server for WebSocket examples.
 * Each demo calls createDemoServer() with its own config.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { WebSocketServer } from "./ws.js";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/**
 * @param {object} options
 * @param {number} options.port
 * @param {string} options.staticRoot - Absolute path to serve files from
 * @param {string} [options.defaultFile="index.html"] - File to serve for "/"
 * @param {boolean} [options.spaFallback=false] - Serve defaultFile for unknown paths
 * @param {string} [options.wsPath="/ws"] - WebSocket endpoint path
 */
export function createDemoServer({ port, staticRoot, defaultFile = "index.html", spaFallback = false, wsPath = "/ws" }) {
  async function serveFile(res, pathname) {
    const filePath = resolve(staticRoot, pathname === "/" ? defaultFile : "." + pathname);
    if (!filePath.startsWith(staticRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(content);
    } catch {
      if (spaFallback) {
        try {
          const index = await readFile(resolve(staticRoot, defaultFile));
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(index);
        } catch {
          res.writeHead(404);
          res.end("Not Found");
        }
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    }
  }

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    await serveFile(res, url.pathname);
  });

  const wss = new WebSocketServer(httpServer, wsPath);

  setInterval(() => {
    wss.broadcast(JSON.stringify({
      type: "stats",
      clients: wss.clientCount,
      uptime: Math.floor(process.uptime()),
    }));
  }, 3000);

  wss.onMessage((ws, data) => {
    try {
      const parsed = JSON.parse(data);

      if (parsed.type === "echo") {
        ws.send(JSON.stringify({
          type: "echo",
          content: parsed.content,
          timestamp: Date.now(),
        }));
      } else if (parsed.type === "broadcast") {
        wss.broadcast(JSON.stringify({
          type: "broadcast",
          content: parsed.content,
          from: parsed.from || "anonymous",
          timestamp: Date.now(),
        }));
      } else {
        ws.send(JSON.stringify({
          type: "echo",
          content: data,
          timestamp: Date.now(),
        }));
      }
    } catch {
      ws.send(JSON.stringify({
        type: "echo",
        content: data,
        timestamp: Date.now(),
      }));
    }
  });

  httpServer.listen(port, () => {
    console.log(`Demo running at http://localhost:${port}`);
    console.log(`WebSocket endpoint: ws://localhost:${port}${wsPath}`);
  });
}
