/**
 * Shared static-file + JSON API core for the root examples.
 *
 * Each demo's server.js stays thin: it declares only its own API routes and
 * delegates static serving, path-traversal guarding and error handling here.
 * When copying a single example out of this repo, copy examples/shared/
 * alongside it (each demo's README says the same).
 *
 * The websocket-chat demo keeps its own self-contained server under
 * examples/websocket-chat/shared/ (it needs the `ws` dependency and upgrade
 * handling), so that scenario stays portable as a single directory.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

export function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {object} options
 * @param {number} options.port
 * @param {string} options.root - Absolute path to serve static files from
 * @param {string} [options.defaultFile="index.html"] - File served for "/"
 * @param {(req: import("node:http").IncomingMessage,
 *          res: import("node:http").ServerResponse,
 *          url: URL) => boolean | Promise<boolean>} [options.api]
 *   Called first for every request; return true when the route was handled.
 * @param {string[]} [options.notes] - Extra lines printed under the startup banner
 * @returns {import("node:http").Server} - So callers can attach e.g. a WebSocket upgrade
 */
export function createDemoServer({ port, root, defaultFile = "index.html", api, notes = [] }) {
  // Normalize away a trailing separator (fileURLToPath(new URL(".", …)) keeps
  // one) so the traversal guard's `root + sep` prefix check matches.
  root = resolve(root);

  async function serveFile(res, pathname) {
    const filePath = resolve(root, pathname === "/" ? defaultFile : "." + pathname);
    // Path traversal guard: the resolved path must stay inside root.
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    try {
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream" });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }

  const server = createServer(async (req, res) => {
    // Wrap the whole async handler: a malformed raw request can make `new URL(...)`
    // throw, and a malformed POST body can make JSON.parse throw inside an api
    // handler. An unhandled rejection inside an async http handler can take the
    // process down, so fail the single request with 400 instead.
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (api && (await api(req, res, url))) return;
      return await serveFile(res, decodeURIComponent(url.pathname));
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
    }
  });

  server.listen(port, () => {
    console.log(`🚀 Demo server running at http://localhost:${port}`);
    for (const line of notes) console.log(`   ${line}`);
  });
  return server;
}
