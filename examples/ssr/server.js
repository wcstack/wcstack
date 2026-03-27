import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "../../packages/server/dist/index.esm.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "../..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Mock data
const users = [
  { name: "田中太郎", role: "admin" },
  { name: "佐藤花子", role: "editor" },
  { name: "鈴木一郎", role: "viewer" },
  { name: "高橋美咲", role: "editor" },
  { name: "渡辺健太", role: "viewer" },
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

// --- SSR cache ---
let cachedHtml = null;

// --- Page rendering ---

function wrapPage(ssrBody) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>wcstack SSR Demo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; color: #1a1a2e; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.1rem; margin: 0.75rem 0; color: #16213e; }
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.5rem 0; }
    button { padding: 0.375rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; font-size: 0.875rem; margin-right: 0.5rem; }
    button:hover { background: #f0f0f0; }
    .user-list { list-style: none; margin-top: 0.75rem; }
    .user-item { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0.75rem; border-bottom: 1px solid #f0f0f0; }
    .user-item:last-child { border-bottom: none; }
    .user-name { font-weight: 500; }
    .role-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 12px; background: #e8eaf6; color: #3949ab; }
    .info-box { padding: 0.75rem; border-radius: 6px; margin-top: 0.5rem; background: #e8f5e9; color: #2e7d32; }
    .info-box.hidden { background: #fce4ec; color: #c62828; }
    .ssr-info { margin-bottom: 1.5rem; padding: 0.75rem; background: #fff3e0; border-radius: 6px; font-size: 0.875rem; color: #e65100; }
  </style>
</head>
<body>

<h1>wcstack SSR Demo</h1>
<div class="ssr-info">
  This page was server-side rendered. View source to see the SSR output with <code>&lt;wcs-ssr&gt;</code> tags.
</div>

${ssrBody}

<script type="module" src="/packages/state/dist/auto.js"></script>
</body>
</html>`;
}

async function loadTemplate() {
  return readFile(join(__dirname, "template.html"), "utf-8");
}

const PORT = 3001;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // API
  if (path === "/api/users") {
    return jsonResponse(res, users);
  }

  // SSR page (cached)
  if (path === "/" || path === "/index.html") {
    try {
      if (!cachedHtml) {
        const template = await loadTemplate();
        console.time("SSR render");
        cachedHtml = await renderToString(template, { baseUrl: `http://localhost:${PORT}` });
        console.timeEnd("SSR render");
        console.log("SSR render complete (%d bytes)", cachedHtml.length);
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(wrapPage(cachedHtml));
    } catch (e) {
      console.error("SSR error:", e);
      res.writeHead(500);
      res.end("SSR Error: " + e.message);
    }
    return;
  }

  // SSR page (no cache, for benchmarking)
  if (path === "/nocache") {
    try {
      const template = await loadTemplate();
      console.time("SSR render");
      const html = await renderToString(template, { baseUrl: `http://localhost:${PORT}` });
      console.timeEnd("SSR render");
      console.log("SSR render complete (%d bytes)", html.length);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(wrapPage(html));
    } catch (e) {
      console.error("SSR error:", e);
      res.writeHead(500);
      res.end("SSR Error: " + e.message);
    }
    return;
  }

  // Static files (packages)
  if (path.startsWith("/packages/")) {
    return serveFile(res, join(ROOT, path));
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`SSR Demo: http://localhost:${PORT}`);
  console.log(`No cache:  http://localhost:${PORT}/nocache`);
});
