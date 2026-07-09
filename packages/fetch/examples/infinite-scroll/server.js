import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Mock catalog generated up front. 87 items with a page size of 20 means the
// last page is partial (87 = 20*4 + 7). That partial page is what signals the
// end of the feed: a response shorter than `limit` means "no more pages".
const CATEGORIES = ["peripherals", "displays", "audio", "storage", "accessories"];
const ADJ = ["Wireless", "Mechanical", "Portable", "Compact", "Ultra", "Pro", "Mini", "Smart", "Hybrid", "Premium"];
const NOUN = ["Keyboard", "Mouse", "Monitor", "Headphones", "SSD", "Hub", "Webcam", "Speaker", "Microphone", "Stand"];
const TOTAL = 87;
const catalog = Array.from({ length: TOTAL }, (_, i) => ({
  id: i + 1,
  name: `${ADJ[i % ADJ.length]} ${NOUN[(i * 7) % NOUN.length]} #${i + 1}`,
  category: CATEGORIES[i % CATEGORIES.length],
  price: 1000 + ((i * 137) % 90) * 100,
}));

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

const server = createServer(async (req, res) => {
  // Wrap the whole async handler: a malformed raw request can make `new URL(...)`
  // throw, and an unhandled rejection inside an async http handler can take the
  // process down. Fail the single request with 400 instead.
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // Paginated catalog. Returns a plain array (never a {items,hasMore} envelope):
    // the client treats "array shorter than limit" as the end-of-feed signal, so
    // the response shape stays identical to the users-crud demo.
    if (path === "/api/items" && req.method === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 20));
      const start = (page - 1) * limit;
      const slice = catalog.slice(start, start + limit);
      console.log(`[items] page=${page} limit=${limit} -> ${slice.length} items`);
      // Small randomized delay (300–600ms) so the bottom spinner is actually visible on a fast network.
      await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 300)));
      return jsonResponse(res, slice);
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

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Demo server running at http://localhost:${PORT}`);
});
