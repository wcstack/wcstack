// ssr-news — a server-rendered news site on @wcstack/server + the wcstack client (a seam app:
// docs/seam-apps.md). The server renders every page with renderToString() (state + router + fetch);
// the client hydrates it and navigates without reloads.
//
// Run: npm install && node server.js        (http://localhost:3000, PORT=… to change)
//      node server.js --prod                (the production form: jsDelivr files with integrity=, a CSP)
//
// Switches (environment):
//   WCS_LOCAL=1    render with the repository's builds (packages/*/dist) and serve them to the client,
//                  instead of the npm install and the CDN — what the e2e spec runs
//   DELAY=<ms>     delay every API answer (also ?delay=<ms> per request)
//   CACHE_TTL=<ms> cache the rendered HTML per URL (default 5000; 0 = off)
//   CLIENT=<ver>   load this @wcstack/* version on the client instead of the one the page was rendered with
//   SRI=1 / CSP=1  pinned jsDelivr files with integrity= / a Content-Security-Policy with a nonce (--prod: both)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const LOCAL = process.env.WCS_LOCAL === "1";
if (process.argv.includes("--prod")) { process.env.SRI ??= "1"; process.env.CSP ??= "1"; }
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://localhost:${PORT}`;
const ENV_DELAY = Number(process.env.DELAY || 0);
const CACHE_TTL = process.env.CACHE_TTL === undefined ? 5000 : Number(process.env.CACHE_TTL);

// The packages the server renders with: the npm install, or (WCS_LOCAL=1) the repository's builds.
// Classes that extend HTMLElement load inside the bootstraps, after the server installed the DOM.
const local = (pkg) => pathToFileURL(join(REPO_ROOT, "packages", pkg, "dist", "index.esm.js")).href;
const load = (pkg) => import(LOCAL ? local(pkg) : `@wcstack/${pkg}`);
const { renderToString } = await load("server");

// ---------------------------------------------------------------- data (memory)
const articles = [
  { id: 1, title: "City opens a new library", summary: "The central library reopens after two years of work.",
    body: "The central library reopened on Monday with a reading garden on the roof and a hall for local history.",
    publishedAt: "2026-10-12T09:00:00.000Z" },
  { id: 2, title: "Rail strike called off", summary: "Unions and the operator reach a late-night deal.",
    body: "The strike planned for Friday was called off after talks that went on until 3 a.m.",
    publishedAt: "2026-10-13T07:30:00.000Z" },
  { id: 3, title: "Harvest festival this weekend", summary: "Markets, music and a parade through the old town.",
    body: "Stalls open at 10 on Saturday; the parade leaves the station square at 2 p.m. on Sunday.",
    publishedAt: "2026-10-14T12:15:00.000Z" },
  { id: 4, title: "School meals go local", summary: "Every school kitchen will buy from farms within 50 km.",
    body: "The council expects the change to cost less than the current contract within three years.",
    publishedAt: "2026-10-15T16:45:00.000Z" },
  { id: 5, title: "Storm warning for the coast", summary: "Gusts of up to 110 km/h expected on Thursday night.",
    body: "Residents near the harbour are asked to secure loose objects and avoid the sea front.",
    publishedAt: "2026-10-16T18:00:00.000Z" },
];
let nextCommentId = 100;
const comments = new Map(articles.map((a) => [a.id, []]));
// Article 1 carries comments that would be markup if the page put them in its HTML: they are state,
// rendered with textContent, and stay text.
comments.set(1, [
  { id: 1, author: "mallory", text: "{{ apiKey }}", postedAt: "2026-10-12T10:00:00.000Z" },
  { id: 2, author: "trudy", text: "<b>bold</b>", postedAt: "2026-10-12T10:05:00.000Z" },
  { id: 3, author: "eve", text: "<button data-wcs=\"onclick: wipe\">x</button>", postedAt: "2026-10-12T10:10:00.000Z" },
  { id: 4, author: "alice", text: "Great news, I will visit on Saturday.", postedAt: "2026-10-12T11:00:00.000Z" },
]);

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
const log = (...a) => { if (!process.env.QUIET) console.log(new Date().toISOString().slice(11, 23), ...a); };
const dropCached = (id) => { for (const k of cache.keys()) if (k.split("?")[0] === `/articles/${id}`) cache.delete(k); };

// ---------------------------------------------------------------- API
async function api(req, res, url) {
  const delay = Number(url.searchParams.get("delay") || ENV_DELAY);
  if (delay) await sleep(delay);
  const from = /HappyDOM/i.test(req.headers["user-agent"] ?? "") ? "server" : "browser";
  log(`API ${req.method} ${url.pathname}${url.search} (from the ${from})`);
  let m;
  if (req.method === "GET" && url.pathname === "/api/articles") {
    return json(res, 200, articles.map(({ id, title, summary, publishedAt }) => ({ id, title, summary, publishedAt })));
  }
  if (req.method === "GET" && (m = url.pathname.match(/^\/api\/articles\/(\d+)$/))) {
    const a = articles.find((x) => x.id === Number(m[1]));
    if (!a) return json(res, 404, { error: "not found" });
    const { id, title, body, publishedAt } = a;
    return json(res, 200, { id, title, body, publishedAt });
  }
  if ((m = url.pathname.match(/^\/api\/articles\/(\d+)\/comments$/))) {
    const id = Number(m[1]);
    if (!comments.has(id)) return json(res, 404, { error: "not found" });
    if (req.method === "GET") return json(res, 200, comments.get(id));
    if (req.method === "POST") {
      let body = null;
      try { body = JSON.parse((await readBody(req)) || "{}"); } catch { body = null; }
      if (url.searchParams.get("fail") === "1") return json(res, 500, { error: "internal error" });
      if (!body || typeof body.text !== "string" || body.text.trim() === "") {
        return json(res, 422, { errors: { text: "required" } });
      }
      const c = { id: nextCommentId++, author: String(body.author || "anonymous").slice(0, 40), text: body.text.slice(0, 2000),
        postedAt: new Date().toISOString() };
      comments.set(id, [...comments.get(id), c]);
      // A cached page carries the old comments in its snapshot, and the client trusts a snapshot
      // (it does not fetch again): drop that article's cached pages.
      dropCached(id);
      return json(res, 201, c);
    }
  }
  return json(res, 404, { error: "not found" });
}

// ---------------------------------------------------------------- client scripts
// The client loads the @wcstack/* version the page was rendered with, read from <wcs-ssr version>: a
// client of another minor discards the snapshot, and an older one can fail on newer markup.
// @wcstack/server depends on the @wcstack/state of its own version (4.3), so the version is the
// server's. SRI digests come from that GitHub Release's sri.json, never from the CDN; without them the
// page does not go out (fail closed).
const sriByVersion = new Map();
async function sriFor(version, pkg) {
  if (!sriByVersion.has(version)) {
    const res = await fetch(`https://github.com/wcstack/wcstack/releases/download/v${version}/sri.json`).catch(() => null);
    sriByVersion.set(version, res?.ok ? await res.json() : null);
  }
  return sriByVersion.get(version)?.packages?.["@wcstack/" + pkg]?.integrity ?? null;
}
const CLIENT_PACKAGES = ["fetch", "storage", "router", "state"];   // state last
async function clientScripts(ssrBody, nonce) {
  const nonceAttr = nonce ? ` nonce="${nonce}"` : "";
  if (LOCAL) return CLIENT_PACKAGES.map((pkg) => `<script type="module"${nonceAttr} src="/packages/${pkg}/dist/auto.min.js"></script>`).join("\n  ");
  const rendered = ssrBody.match(/<wcs-ssr\b[^>]*\sversion="([^"]+)"/)?.[1];
  const version = process.env.CLIENT || rendered;
  if (!version) throw new Error("the output has no <wcs-ssr version>: no client version to pin");
  const tags = await Promise.all(CLIENT_PACKAGES.map(async (pkg) => {
    if (process.env.SRI === "1") {
      const integrity = await sriFor(version, pkg);
      if (!integrity) throw new Error(`no SRI digest for @wcstack/${pkg}@${version} (the v${version} release's sri.json)`);
      return `<script type="module"${nonceAttr} src="https://cdn.jsdelivr.net/npm/@wcstack/${pkg}@${version}/dist/auto.min.js" integrity="${integrity}"></script>`;
    }
    return `<script type="module"${nonceAttr} src="https://esm.run/@wcstack/${pkg}@${version}/auto"></script>`;
  }));
  return tags.join("\n  ");
}

// ---------------------------------------------------------------- page
const STYLE = `
  :root { --fs: 1rem; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #1d2330; font-size: var(--fs); }
  header.site { background: #1d2330; color: #fff; padding: .75rem 1rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  header.site a { color: #fff; }
  header.site .prefs { margin-left: auto; font-size: .875rem; }
  main { max-width: 52rem; margin: 0 auto; padding: 1rem; }
  ul.articles { list-style: none; padding: 0; }
  ul.articles li { border-bottom: 1px solid #ddd; padding: .75rem 0; }
  ul.articles li.read h2::after { content: " ✓ read"; font-size: .8rem; color: #2e7d32; }
  ul.articles h2 { font-size: 1.15em; margin: 0 0 .25rem; }
  .meta { color: #667; font-size: .85em; }
  .layout { display: grid; grid-template-columns: 1fr 14rem; gap: 1.5rem; }
  .layout aside { border-left: 1px solid #ddd; padding-left: 1rem; font-size: .9em; }
  .comments li { margin: .5rem 0; }
  .comments .pending { opacity: .5; }
  .field-error { color: #b00020; font-size: .85em; }
  .form-error { color: #b00020; }
  .not-found { padding: 2rem 0; }
  @media (max-width: 40rem) { .layout { grid-template-columns: 1fr; } .layout aside { border: 0; padding: 0; } }
`;

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The <title> and description a crawler gets: the output is the body only, so the server writes them
// itself (the route's <wcs-head> applies them on the client). It duplicates the state's pageTitle.
function headFor(url) {
  const site = "SSR News", desc = "Local news, server-rendered.";
  const m = url.pathname.match(/^\/articles\/(\d+)\/?$/);
  if (m) {
    const a = articles.find((x) => x.id === Number(m[1]));
    return a ? { title: `${a.title} — ${site}`, description: a.body.slice(0, 150) } : { title: `Article not found — ${site}`, description: desc };
  }
  if (url.pathname === "/") return { title: site, description: desc };
  return { title: `Not found — ${site}`, description: desc };
}

async function wrapPage(ssrBody, nonce, head) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="/">
  <title>${escHtml(head.title)}</title>
  <meta name="description" content="${escHtml(head.description)}">
  <style${nonce ? ` nonce="${nonce}"` : ""}>${STYLE}</style>
  ${await clientScripts(ssrBody, nonce)}
</head>
<body>
${ssrBody}
</body>
</html>`;
}

// ---------------------------------------------------------------- render + cache
const cache = new Map();   // url -> { body, status, head, at }
async function render(url) {
  const template = await readFile(join(__dirname, "template.html"), "utf8");
  const t0 = Date.now();
  const body = await renderToString(template, {
    url: ORIGIN + url.pathname + url.search,
    bootstraps: [
      async () => (await load("state")).bootstrapState(),
      async () => (await load("router")).bootstrapRouter(),
      // the article's and the comments' requests (their url comes from state): the server waits for
      // them (4.3), so the page goes out with the article in it
      async () => (await load("fetch")).bootstrapFetch(),
    ],
    // <wcs-state src="./state.js">: Node's loader reads no http: URL — the file next to the template
    resolveModule: (u) => (u.origin === ORIGIN && u.pathname === "/state.js" ? join(__dirname, "state.js") : null),
    timeoutMs: 10000,
  });
  log(`render ${url.pathname}${url.search} ${Date.now() - t0}ms ${body.length}B`);
  // The HTTP status: the not-found content carries data-http-status="404". The router's own <template>
  // (and <wcs-ssr>'s templates) hold that markup too, so look only at what the outlet rendered.
  const outlet = body.match(/<wcs-outlet\b[^>]*>([\s\S]*?)<\/wcs-outlet>/)?.[1] ?? "";
  const status = /data-http-status="404"/.test(outlet) ? 404 : 200;
  return { body, status, head: headFor(url) };
}

// WCS_LOCAL=1 only: the client bundles (/packages/<pkg>/dist/…) from the repository.
async function serveLocalPackage(res, path) {
  const file = resolve(REPO_ROOT, "." + decodeURIComponent(path));
  // Path traversal guard: the resolved path must stay inside packages/.
  if (!file.startsWith(join(REPO_ROOT, "packages") + sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const body = await readFile(file).catch(() => null);
  if (!body) { res.writeHead(404); return res.end("Not Found"); }
  res.writeHead(200, { "Content-Type": file.endsWith(".map") ? "application/json" : "text/javascript; charset=utf-8" });
  res.end(body);
}

// ---------------------------------------------------------------- http
const server = createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (LOCAL && url.pathname.startsWith("/packages/")) return await serveLocalPackage(res, url.pathname);
    if (url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
    // The comment form without JavaScript (or before hydration): urlencoded → 303 back to the article.
    let pm;
    if (req.method === "POST" && (pm = url.pathname.match(/^\/articles\/(\d+)\/comments$/))) {
      const form = new URLSearchParams(await readBody(req));
      const id = Number(pm[1]);
      const text = form.get("text") ?? "";
      log(`FORM POST ${url.pathname}`);
      if (comments.has(id) && text.trim() !== "") {
        comments.set(id, [...comments.get(id), { id: nextCommentId++, author: (form.get("author") || "anonymous").slice(0, 40),
          text: text.slice(0, 2000), postedAt: new Date().toISOString() }]);
        dropCached(id);
      }
      res.writeHead(303, { Location: `/articles/${id}` });
      return res.end();
    }
    if (req.method !== "GET") { res.writeHead(405); return res.end(); }
    if (url.pathname === "/state.js") {
      // <wcs-state src="./state.js"> in the browser (resolved against <base href="/">)
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(await readFile(join(__dirname, "state.js")));
    }
    const key = url.pathname + url.search;
    let entry = cache.get(key);
    const fresh = entry && CACHE_TTL > 0 && Date.now() - entry.at < CACHE_TTL;
    if (!fresh) {
      entry = { ...(await render(url)), at: Date.now() };
      if (CACHE_TTL > 0) cache.set(key, entry);
    }
    const nonce = process.env.CSP === "1" ? randomBytes(16).toString("base64") : null;
    const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Render-Cache": fresh ? "hit" : "miss" };
    if (nonce) {
      const cdn = process.env.SRI === "1" ? "https://cdn.jsdelivr.net" : "https://esm.run https://cdn.jsdelivr.net";
      // script-src without 'unsafe-inline': the state is a file (src=), the client scripts carry the
      // nonce. style-src-attr: <wcs-fetch> still writes style="display: none;" on the server when
      // fetch renders there (docs/seam-apps.md, ssr-news — <wcs-link> and <wcs-head> no longer do).
      headers["Content-Security-Policy"] =
        `default-src 'self'; script-src 'self' 'nonce-${nonce}' ${cdn}; ` +
        `style-src 'self' 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; ` +
        `base-uri 'self'; object-src 'none'; form-action 'self'`;
    }
    const page = await wrapPage(entry.body, nonce, entry.head);
    res.writeHead(entry.status, headers);
    res.end(page);
  } catch (e) {
    console.error("render failed:", e);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Render failed: " + (e?.message ?? e));
  }
});

server.listen(PORT, () => console.log(`ssr-news: ${ORIGIN}${LOCAL ? " (WCS_LOCAL: repository builds)" : ""}`));
