// A plain static file server for the production build: serves a folder, answers every
// extensionless non-API GET with index.html (the SPA fallback the router needs), and passes
// /api/* to the API server. `STATIC_PORT` (default 3000), `API_PORT` (default 3001), `STATIC_DIR` (default dist,
// relative to this example).
import { createServer, request } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const port = Number(process.env.STATIC_PORT ?? 3000);
const apiPort = Number(process.env.API_PORT ?? 3001);
const root = resolve(import.meta.dirname, "..", process.env.STATIC_DIR ?? "dist");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const up = request({ host: "127.0.0.1", port: apiPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
    res.on("close", () => up.destroy());
    return;
  }
  let file = join(root, normalize(decodeURIComponent(url.pathname)).replace(/^[\/]+/, ""));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, "index.html");
  } catch {
    if (extname(url.pathname) === "") file = join(root, "index.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
});
server.listen(port, "127.0.0.1", () => console.log(`static ${root} on http://127.0.0.1:${port}/ (pid ${process.pid})`));
