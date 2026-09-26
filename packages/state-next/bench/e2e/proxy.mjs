// Serves e2e/serve.mjs on PORT+1 and proxies PORT to it. With STATE=next, state-next stands in
// for @wcstack/state on both sides: the browser's /packages/state/dist/auto.min.js is answered
// with state-next's, and the server-rendered pages (/ssr-router/*, e2e/serve.mjs's
// handleSsrRouter) are rendered here with @wcstack/server and a state-next bootstrap.
import { createServer, request } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT || 4400);
const UPSTREAM = PORT + 1;
const e2e = process.env.E2E_DIR;
const next = process.env.STATE === "next";
const ROOT = resolve(e2e, "..");
const child = spawn(process.execPath, ["serve.mjs"], { cwd: e2e, env: { ...process.env, PORT: String(UPSTREAM) }, stdio: "inherit", windowsHide: true });
process.on("exit", () => child.kill());
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(0));

const dist = (pkg, file = "index.esm.js") => pathToFileURL(join(ROOT, "packages", pkg, "dist", file)).href;
const FEATURES = ["formats", "diagnostics", "temporal", "list-keys", "scopes", "recursion", "ssr"];
let core = null;
let ssr = null;
async function ssrDeps() {
  ssr ??= {
    renderToString: (await import(dist("server"))).renderToString,
    template: await readFile(join(e2e, "fixtures", "ssr-router-body.html"), "utf-8"),
    bootstraps: [
      // loaded once (the split build: core + every add-on), defined on every render's registry
      async () => {
        if (core === null) {
          core = await import(dist("state-next", "split/core.js"));
          core.installFeatures(await Promise.all(FEATURES.map(async (f) => (await import(dist("state-next", `split/features/${f}.js`))).default)));
        }
        core.bootstrapState();
      },
      async () => (await import(dist("router"))).bootstrapRouter(),
    ],
  };
  return ssr;
}

async function renderSsrRouter(url, res) {
  const { renderToString, template, bootstraps } = await ssrDeps();
  const body = await renderToString(template, { url: `http://127.0.0.1:${PORT}${url.pathname}${url.search}`, baseHref: "/ssr-router/", bootstraps });
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>fixture: SSR router</title>
  <base href="/ssr-router/">
  <script type="module" src="/packages/state/dist/auto.min.js"></script>
  <script type="module" src="/packages/router/dist/auto.min.js"></script>
</head>
<body>${body}</body>
</html>`);
}

createServer((req, res) => {
  let path = req.url;
  const url = new URL(path, `http://127.0.0.1:${PORT}`);
  if (next && url.pathname.startsWith("/ssr-router/")) {
    renderSsrRouter(url, res).catch((e) => { console.error(e); res.writeHead(500); res.end(String(e)); });
    return;
  }
  if (next && path.startsWith("/packages/state/dist/auto.min.js")) path = "/packages/state-next/dist/auto.min.js";
  const up = request({ host: "127.0.0.1", port: UPSTREAM, path, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  // the browser closing a stream (EventSource.close()) must close the upstream one too, or the
  // server keeps counting it (state-sse-dashboard checks the open connections)
  res.on("close", () => up.destroy());
  req.pipe(up);
}).listen(PORT, "127.0.0.1");
