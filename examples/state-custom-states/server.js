import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "../shared/websocket/ws.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Mock warehouse data for the Section 1 (<wcs-fetch>) demo.
const widgets = [
  { id: 1, name: "Torque Wrench", stock: 42 },
  { id: 2, name: "Ball Bearing 6203", stock: 318 },
  { id: 3, name: "Hex Bolt M8x40", stock: 1200 },
  { id: 4, name: "Gasket Set", stock: 76 },
  { id: 5, name: "Hydraulic Hose 2m", stock: 19 },
];

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function serveFile(res, filePath) {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = createServer(async (req, res) => {
  // Wrap the whole async handler: a malformed raw request can make `new URL(...)`
  // throw. An unhandled rejection inside an async http handler can take the
  // process down, so fail the single request with 400 instead.
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Mock API for the :state(loading) / :state(error) showcase (Section 1).
    // `mode` picks which of the three demo buttons drove this request; `attempt`
    // is a cache-busting counter so re-clicking the same button always changes
    // the url (wcs-fetch only refetches when the url actually changes).
    if (path === "/api/widgets" && req.method === "GET") {
      const mode = url.searchParams.get("mode") || "fast";

      if (mode === "slow") {
        await delay(2500);
        return jsonResponse(res, widgets);
      }
      if (mode === "fail") {
        await delay(700);
        return jsonResponse(res, { error: "Warehouse service unavailable (simulated failure)." }, 500);
      }
      // "fast" (default): still a short delay so the spinner is actually visible.
      await delay(400);
      return jsonResponse(res, widgets);
    }

    // Static files
    if (path === "/" || path === "/index.html") {
      return serveFile(res, join(__dirname, "index.html"));
    }

    res.writeHead(404);
    res.end("Not Found");
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
  }
});

// Minimal WebSocket endpoint for the :state(connected) showcase (Section 2).
// No message protocol is needed here — the demo only cares about connect /
// disconnect / reconnect, so nothing beyond accepting the connection is wired
// up. Reuses the shared `ws` dependency already installed under
// examples/shared/websocket/ (see examples/state-websocket for the same
// pattern) instead of adding a new dependency to this example.
new WebSocketServer(server, "/ws");

const PORT = Number(process.env.PORT || 3303);
server.listen(PORT, () => {
  console.log(`🚀 :state() showcase running at http://localhost:${PORT}`);
});
