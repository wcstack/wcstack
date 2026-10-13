import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { createDemoServer } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Opt-in: WCS_LOCAL=1 swaps the esm.run URLs for the locally built bundles and
// serves /packages/<pkg>/dist from the repo, the same trick e2e/serve.mjs uses.
// The demo is CDN-first by default (that is the documented way to run these
// examples); this switch exists so a change in the working tree can be verified
// before it is published.
const LOCAL = process.env.WCS_LOCAL === "1";

// This page loads everything through its import map — `@wcstack/signals/dom`
// as well as the `/auto` entries — so the rewrite covers any subpath: it
// resolves `https://esm.run/@wcstack/<pkg>[/<subpath>]` through the package's
// own `exports` map (`./dom` → dist/dom.esm.js, `./auto` → dist/auto.min.js),
// the file a bundler or the CDN would pick. A subpath the map does not name,
// or a package that is not in this repository, is left on the CDN.
const exportsCache = new Map();

function localEntry(pkg, subpath) {
  if (!exportsCache.has(pkg)) {
    let map = null;
    try {
      map = JSON.parse(readFileSync(join(REPO_ROOT, "packages", pkg, "package.json"), "utf8")).exports ?? null;
    } catch {
      // not a package of this repository
    }
    exportsCache.set(pkg, map);
  }
  const target = exportsCache.get(pkg)?.["." + subpath];
  const file = typeof target === "string" ? target : target?.import ?? target?.default;
  return typeof file === "string" ? `/packages/${pkg}/${file.replace(/^\.\//, "")}` : null;
}

function rewriteCdn(html) {
  return html.replace(
    /https:\/\/esm\.run\/@wcstack\/([\w-]+)(?:@[^/"'\s]+)?((?:\/[\w-]+)*)(?=["'\s])/g,
    (match, pkg, subpath) => localEntry(pkg, subpath) ?? match,
  );
}

const PACKAGE_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// FAIL_CATALOG=1: the first request for products.json answers 500, so the
// page's "Try again" can be tried. Every later request gets the real file.
let failCatalog = process.env.FAIL_CATALOG === "1";

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    if (req.method !== "GET") return false;

    // --- Local bundles (WCS_LOCAL=1): /packages/<pkg>/dist/… from the repo.
    // The signals entries import their shared core chunk by a relative path,
    // so the whole dist directory has to be reachable, not just the entries.
    if (LOCAL && url.pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + decodeURIComponent(url.pathname));
      if (!file.startsWith(REPO_ROOT + sep)) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, {
          "Content-Type": PACKAGE_TYPES[extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    if (url.pathname === "/products.json" && failCatalog) {
      failCatalog = false;
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "FAIL_CATALOG: the first request fails on purpose" }));
      return true;
    }

    // SPA fallback: the router uses real URL paths (/products/3), so a page
    // reload or deep link must serve index.html for any extension-less path
    // and let <wcs-router> resolve it client-side. Files (shop.css,
    // products.json, product-card.js, …) fall through to the static server.
    if (extname(url.pathname) === "") {
      const html = await readFile(join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(LOCAL ? rewriteCdn(html) : html);
      return true;
    }

    return false;
  },
  notes: [
    "Deep links work too: /products/3, /products/99, /nope",
    ...(process.env.FAIL_CATALOG === "1" ? ["FAIL_CATALOG=1: the first products.json request answers 500"] : []),
    ...(LOCAL ? ["WCS_LOCAL=1: esm.run URLs rewritten to the local packages/*/dist"] : []),
  ],
});
