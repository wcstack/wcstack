import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Serves the repository root so example pages load the locally built bundles
// (packages/*/dist) instead of the published CDN packages. Zero dependencies.
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Rewrite CDN references in HTML to the local dist bundles, so the tests verify
// the current working tree rather than whatever esm.run last published. Covers
// both <script src="https://esm.run/..."> and import-map entries (the regex runs
// over the whole HTML text, inline import maps included). An optional @version
// pin is dropped; deeper subpaths than /auto are left untouched.
function rewriteCdn(html) {
  return html.replace(
    /https:\/\/esm\.run\/@wcstack\/([\w-]+)(?:@[^/"'\s]+)?(\/auto)?(?=["'\s])/g,
    (_m, pkg, auto) =>
      auto ? `/packages/${pkg}/dist/auto.min.js` : `/packages/${pkg}/dist/index.esm.min.js`,
  );
}

// ---------------------------------------------------------------------------
// API mocks. The example pages fetch root-relative /api/* URLs, and each
// example's own server.js hardcodes port 3000 (they cannot run side by side),
// so this server answers those routes itself. Response shapes mirror the
// corresponding examples/*/server.js; fixtures are minimal, with no artificial
// latency.
// ---------------------------------------------------------------------------

// examples/state-search — matched by name or category, empty query returns all.
const products = [
  { id: 1, name: "Mechanical Keyboard", category: "peripherals", price: 12800 },
  { id: 2, name: "Wireless Mouse", category: "peripherals", price: 5400 },
  { id: 3, name: '27" 4K Monitor', category: "displays", price: 48000 },
  { id: 4, name: "Noise-Cancelling Headphones", category: "audio", price: 32000 },
  { id: 5, name: "Portable SSD 1TB", category: "storage", price: 13800 },
];

// examples/state-fetch — list / detail / create.
const users = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "admin" },
  { id: 2, name: "Bob Smith", email: "bob@example.com", role: "editor" },
  { id: 3, name: "Charlie Davis", email: "charlie@example.com", role: "viewer" },
  { id: 4, name: "Diana Miller", email: "diana@example.com", role: "editor" },
  { id: 5, name: "Ethan Wilson", email: "ethan@example.com", role: "viewer" },
];
let nextUserId = users.length + 1;
const ROLES = ["viewer", "editor", "admin"];

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, url) {
  const path = url.pathname;

  if (path === "/api/search" && req.method === "GET") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const hits = q
      ? products.filter(
          (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
        )
      : products;
    return json(res, hits);
  }

  if (path === "/api/users" && req.method === "GET") {
    const role = url.searchParams.get("role");
    return json(res, role ? users.filter((u) => u.role === role) : users);
  }

  if (/^\/api\/users\/\d+$/.test(path) && req.method === "GET") {
    const id = Number(path.split("/").pop());
    const user = users.find((u) => u.id === id);
    if (user) return json(res, user);
    return json(res, { error: "User not found" }, 404);
  }

  if (path === "/api/users" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return json(res, { error: "Name is required" }, 400);
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const role = ROLES.includes(body.role) ? body.role : "viewer";
    const newUser = { id: nextUserId++, name, email, role };
    users.push(newUser);
    return json(res, newUser, 201);
  }

  return false;
}

async function serveStatic(res, url) {
  // Path traversal guard: the resolved path must stay inside the repo root.
  let filePath = resolve(join(ROOT, decodeURIComponent(url.pathname)));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    res.writeHead(404);
    return res.end("Not Found");
  }

  if (stats.isDirectory()) {
    // Redirect to the trailing-slash form so relative URLs in the page resolve.
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { Location: url.pathname + "/" + url.search });
      return res.end();
    }
    filePath = join(filePath, "index.html");
  }

  const ext = extname(filePath);
  let content;
  try {
    content = await readFile(filePath);
  } catch {
    res.writeHead(404);
    return res.end("Not Found");
  }
  if (ext === ".html") {
    content = rewriteCdn(content.toString("utf-8"));
  }
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(content);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // No favicon in the examples; 204 keeps a 404 out of the console-error assert.
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }

    if ((await handleApi(req, res, url)) !== false) return;

    return await serveStatic(res, url);
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
  }
});

server.listen(PORT, () => {
  console.log(`e2e static server running at http://127.0.0.1:${PORT} (root: ${ROOT})`);
});
