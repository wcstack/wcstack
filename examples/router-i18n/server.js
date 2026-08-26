import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createDemoServer } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Opt-in: WCS_LOCAL=1 swaps the esm.run one-liners for the locally built
// bundles and serves /packages/<pkg>/dist from the repo, the same trick
// e2e/serve.mjs uses. The demo is CDN-first by default (that is the documented
// way to run these examples); this switch exists so a change in the working
// tree can be verified before it is published.
const LOCAL = process.env.WCS_LOCAL === "1";

function rewriteCdn(html) {
  return html.replace(
    /https:\/\/esm\.run\/@wcstack\/([\w-]+)(?:@[^/"'\s]+)?(\/auto)?(?=["'\s])/g,
    (_m, pkg, auto) =>
      auto ? `/packages/${pkg}/dist/auto.min.js` : `/packages/${pkg}/dist/index.esm.js`,
  );
}

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    if (req.method !== "GET") return false;

    if (LOCAL && url.pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + url.pathname);
      if (!file.startsWith(REPO_ROOT)) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
      return true;
    }

    // SPA fallback. Every locale-prefixed path (/ja/orders, /en/about) and the
    // bare "/" must serve the same index.html; the head snippet decides the
    // locale and the router resolves the rest client-side.
    //
    // Note what this server does NOT do: it never inspects Accept-Language and
    // never redirects. Locale negotiation is a client concern here because the
    // demo is a static page (docs/i18n-design.md §8). An SSR deployment moves
    // that decision to the server and writes <html lang> itself (§9-3).
    if (!url.pathname.startsWith("/api/") && extname(url.pathname) === "") {
      const html = await readFile(join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(LOCAL ? rewriteCdn(html) : html);
      return true;
    }

    return false;
  },
  notes: [
    "Open / and you are redirected to /en or /ja depending on your browser.",
    "Deep links work: /ja/orders, /en/about. An unknown locale (/xx/orders) is repaired.",
  ],
});
