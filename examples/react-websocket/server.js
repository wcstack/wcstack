import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "./ws.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(__dirname, "dist");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveFile(res, pathname) {
  // SPA fallback: non-file paths → index.html
  const filePath = resolve(distDir, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!filePath.startsWith(distDir)) {
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
    // SPA fallback
    try {
      const index = await readFile(resolve(distDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end("Not Found — run `npm run build` first");
    }
  }
}

// --- HTTP + WebSocket server ---

const port = Number(process.env.PORT || 3301);

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  await serveFile(res, url.pathname);
});

const wss = new WebSocketServer(httpServer, "/ws");

setInterval(() => {
  const payload = JSON.stringify({
    type: "stats",
    clients: wss.clientCount,
    uptime: Math.floor(process.uptime()),
  });
  wss.broadcast(payload);
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
  console.log(`React + WebSocket demo running at http://localhost:${port}`);
  console.log(`WebSocket endpoint: ws://localhost:${port}/ws`);
});
