/**
 * Shared demo server for the pagination examples.
 *
 * Every demo (React / Vue / state / signals / Vanilla) hits the SAME paginated
 * endpoint produced here, so the comparison is apples-to-apples: identical data,
 * identical latency, identical contract — only the front-end differs.
 *
 *   GET /api/items?page=<1-based>&limit=<n>
 *     -> { items: [...], page, limit, total, totalPages }   (+ ~400ms latency)
 *
 * Two ways to run it:
 *
 *   1. As a hub (recommended for the buildless trio):
 *        node packages/fetch/examples/pagination/shared/server.js
 *      Serves the gallery + state/signals/vanilla demos + /api/items on :3400.
 *
 *   2. As a factory imported by a per-example server.js (React / Vue), which
 *      serves that example's built `dist/` while reusing the same /api/items.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MEMBERS, paginate } from "./data.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const API_DELAY_MS = 400;
const DEFAULT_LIMIT = 12;

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

/**
 * @param {object} options
 * @param {number} options.port
 * @param {string} options.staticRoot               Absolute dir to serve files from
 * @param {string} [options.defaultFile="index.html"]  File served for "/"
 * @param {boolean} [options.spaFallback=false]      Serve defaultFile for unknown paths
 * @param {{prefix: string, dir: string}[]} [options.mounts]  Extra flat static mounts
 *        (used to serve the locally-built @wcstack/signals dist under /signals/)
 */
export function createPaginationServer({
  port,
  staticRoot,
  defaultFile = "index.html",
  spaFallback = false,
  mounts = [],
}) {
  const root = resolve(staticRoot);

  async function serveFile(res, absPath, fallbackToIndex = false) {
    try {
      const content = await readFile(absPath);
      const ext = extname(absPath);
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        // Demo-local: serve every static file with "no-cache" so the browser
        // revalidates and always picks up the latest edit. This matters most for
        // the signals bundles (index.esm.js / dom.esm.js), whose names carry no
        // content hash, so a rebuild keeps the same URL.
        "Cache-Control": "no-cache",
      });
      res.end(content);
    } catch {
      if (fallbackToIndex) {
        try {
          const index = await readFile(resolve(root, defaultFile));
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(index);
          return;
        } catch { /* fall through to 404 */ }
      }
      res.writeHead(404);
      res.end("Not Found");
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const path = url.pathname;

      // --- Shared paginated API (the "common server" all five demos hit) ---
      if (path === "/api/items") {
        const rawPage = Number.parseInt(url.searchParams.get("page") || "1", 10);
        const rawLimit = Number.parseInt(url.searchParams.get("limit") || String(DEFAULT_LIMIT), 10);
        const page = Number.isFinite(rawPage) ? rawPage : 1;
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : DEFAULT_LIMIT;
        await new Promise((r) => setTimeout(r, API_DELAY_MS)); // simulate network latency
        return sendJson(res, paginate(MEMBERS, page, limit));
      }

      // --- Extra static mounts (e.g. the locally-built @wcstack/signals dist) ---
      for (const m of mounts) {
        if (path.startsWith(m.prefix)) {
          const name = path.slice(m.prefix.length);
          if (name && !name.includes("/") && !name.includes("..")) {
            return serveFile(res, join(m.dir, name));
          }
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
      }

      // --- Static files ---
      let rel;
      if (path === "/") rel = defaultFile;
      else if (path.endsWith("/")) rel = "." + path + "index.html";
      else rel = "." + path;

      const filePath = resolve(root, rel);
      // Root-escape guard. url.pathname is already normalized (`..` segments are
      // resolved away by the URL parser), so this is belt-and-braces — but match on
      // the directory boundary `root + sep` (and root itself) rather than a bare
      // prefix, so a sibling dir like `<root>-other` can never slip through.
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      return serveFile(res, filePath, spaFallback);
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
    }
  });

  server.listen(port, () => {
    console.log(`Pagination demo running at http://localhost:${port}`);
  });
  return server;
}

// Direct run = the shared "hub": gallery + buildless demos + /api/items on one port.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // The pagination set root: packages/fetch/examples/pagination
  const setRoot = resolve(here, "..");
  // The locally-built signals bundles live in the signals package's dist.
  const signalsDist = resolve(here, "../../../../signals/dist");
  createPaginationServer({
    port: Number(process.env.PORT || 3400),
    staticRoot: setRoot,
    defaultFile: "index.html",
    // Serve the signals bundles so the signals demo can import both entries
    // (`@wcstack/signals` + `/dom`) and share one reactive core chunk.
    // NB: prefix is /signals-dist/ (NOT /signals/) so it doesn't shadow the static
    // route to the signals/ example directory.
    mounts: [{ prefix: "/signals-dist/", dir: signalsDist }],
  });
}
