import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

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

// Static-only server. This demo has NO backend: the todo list lives in
// localStorage (<wcs-storage>) and cross-tab signals ride BroadcastChannel
// (<wcs-broadcast>) — both are pure browser APIs. The server only needs to hand
// out index.html over http:// so ES modules and a shared storage origin work
// (file:// would break both). Open http://localhost:3000 in two tabs.
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveFile(res, join(__dirname, "index.html"));
    }
    res.writeHead(404);
    res.end("Not Found");
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Demo server running at http://localhost:${PORT}`);
  console.log("   Open it in TWO tabs to see cross-tab sync.");
});
