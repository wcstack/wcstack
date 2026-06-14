import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// The signals package is unpublished, so serve its locally-built ESM bundle.
// Run `npm run build` in packages/signals first.
const distDir = join(__dirname, "../../packages/signals/dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const people = [
  { id: 1, name: "Ada Lovelace", role: "admin" },
  { id: 2, name: "Linus Torvalds", role: "editor" },
  { id: 3, name: "Grace Hopper", role: "admin" },
  { id: 4, name: "Alan Turing", role: "viewer" },
  { id: 5, name: "Margaret Hamilton", role: "editor" },
  { id: 6, name: "Dennis Ritchie", role: "editor" },
  { id: 7, name: "Barbara Liskov", role: "admin" },
  { id: 8, name: "Tim Berners-Lee", role: "viewer" },
  { id: 9, name: "Katherine Johnson", role: "viewer" },
  { id: 10, name: "Donald Knuth", role: "editor" },
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    if (path === "/api/people" && req.method === "GET") {
      await new Promise((r) => setTimeout(r, 300)); // simulate latency
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const filtered = q
        ? people.filter((p) => p.name.toLowerCase().includes(q))
        : people;
      return jsonResponse(res, filtered);
    }

    // Locally-built signals bundle (and its sourcemap).
    if (path === "/signals/dom.esm.js") {
      return serveFile(res, join(distDir, "dom.esm.js"));
    }
    if (path === "/signals/dom.esm.js.map") {
      return serveFile(res, join(distDir, "dom.esm.js.map"));
    }

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
  console.log("   (build packages/signals first: cd packages/signals && npm run build)");
});
