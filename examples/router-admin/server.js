import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

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

// DELAY_MS slows every API response down, to see the loading states.
const DELAY_MS = Math.max(0, Number(process.env.DELAY_MS || 0));

// ---------------------------------------------------------------------------
// The catalog: 35 products at start.
// ---------------------------------------------------------------------------
const NAMES = [
  "Ceramic Mug", "Glass Teapot", "Walnut Tray", "Linen Napkin", "Cotton Apron",
  "Steel Kettle", "Bamboo Whisk", "Tea Canister", "Coffee Grinder", "Pour-over Dripper",
  "Paper Filter", "Milk Pitcher", "Espresso Cup", "Latte Bowl", "Sugar Pot",
  "Honey Dipper", "Oak Coaster", "Cast Iron Pot", "Matcha Bowl", "Tea Strainer",
  "Cold Brew Bottle", "Thermos Flask", "Cake Stand", "Butter Knife", "Bread Board",
  "Spice Jar", "Salt Cellar", "Pepper Mill", "Olive Dish", "Rice Bowl",
  "Chopstick Rest", "Soup Ladle", "Tasting Spoon", "Dish Towel", "Pantry Basket",
];

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse("2026-10-13T09:00:00Z");

// Deterministic: the same 35 products on every start (and after POST /api/reset).
function seed() {
  return NAMES.map((name, i) => ({
    id: i + 1,
    sku: "SKU-" + String(i + 1).padStart(3, "0"),
    name,
    price: 400 + ((i * 7919) % 46) * 100,     // 400 .. 4,900 yen
    stock: (i * 37) % 60,                      // 0 .. 59
    updatedAt: new Date(BASE - (i * 3 + (i % 5)) * DAY - i * 3600 * 1000).toISOString(),
  }));
}
let products = seed();
let nextId = products.length + 1;

const SORTS = new Set(["name", "price", "stock", "updatedAt"]);

function compare(sort) {
  return (a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (typeof x === "string") return x.localeCompare(y, "en", { sensitivity: "base" }) || a.id - b.id;
    return (x - y) || a.id - b.id;
  };
}

// Validation shared by POST and PUT. Returns { errors } or { value }.
function validate(body, selfId) {
  const errors = {};
  const src = body && typeof body === "object" ? body : {};
  const name = typeof src.name === "string" ? src.name.trim() : "";
  const sku = typeof src.sku === "string" ? src.sku.trim() : "";
  if (!name) errors.name = "required";
  if (!sku) errors.sku = "required";
  else if (products.some((p) => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== selfId)) errors.sku = "taken";
  if (!(Number.isInteger(src.price) && src.price > 0)) errors.price = "positiveInteger";
  if (!(Number.isInteger(src.stock) && src.stock >= 0)) errors.stock = "nonNegativeInteger";
  if (Object.keys(errors).length) return { errors };
  return { value: { sku, name, price: src.price, stock: src.stock } };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  return JSON.parse(text);   // a malformed body throws -> shared server answers 400
}

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    if (LOCAL && req.method === "GET" && url.pathname.startsWith("/packages/")) {
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

    if (url.pathname.startsWith("/api/")) {
      // POST /api/reset — puts the starting catalog back (the e2e spec calls it
      // before each test, so tests do not see each other's writes).
      if (url.pathname === "/api/reset" && req.method === "POST") {
        products = seed();
        nextId = products.length + 1;
        res.writeHead(204);
        res.end();
        return true;
      }

      if (DELAY_MS) await delay(DELAY_MS);

      // GET /api/stats
      if (url.pathname === "/api/stats" && req.method === "GET") {
        const recent = products.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id).slice(0, 5);
        jsonResponse(res, {
          count: products.length,
          totalStock: products.reduce((sum, p) => sum + p.stock, 0),
          recent,
        });
        return true;
      }

      // GET /api/products, POST /api/products
      if (url.pathname === "/api/products") {
        if (req.method === "GET") {
          const sp = url.searchParams;
          const size = Math.min(100, Math.max(1, parseInt(sp.get("size") || "10", 10) || 10));
          const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
          const sort = SORTS.has(sp.get("sort")) ? sp.get("sort") : "name";
          const dir = sp.get("dir") === "desc" ? "desc" : "asc";
          const q = (sp.get("q") || "").trim().toLowerCase();
          let rows = q
            ? products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
            : products.slice();
          rows.sort(compare(sort));
          if (dir === "desc") rows.reverse();
          const total = rows.length;
          const items = rows.slice((page - 1) * size, page * size);
          jsonResponse(res, { items, total, page, size });
          return true;
        }
        if (req.method === "POST") {
          const result = validate(await readJson(req), null);
          if (result.errors) {
            jsonResponse(res, { errors: result.errors }, 422);
            return true;
          }
          const product = { id: nextId++, ...result.value, updatedAt: new Date().toISOString() };
          products = products.concat(product);
          jsonResponse(res, product, 201);
          return true;
        }
        jsonResponse(res, { error: "Method not allowed" }, 405);
        return true;
      }

      // /api/products/:id
      const m = url.pathname.match(/^\/api\/products\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        const index = products.findIndex((p) => p.id === id);
        if (req.method === "GET") {
          if (index < 0) jsonResponse(res, { error: "Product not found" }, 404);
          else jsonResponse(res, products[index]);
          return true;
        }
        if (req.method === "PUT") {
          if (index < 0) {
            jsonResponse(res, { error: "Product not found" }, 404);
            return true;
          }
          const result = validate(await readJson(req), id);
          if (result.errors) {
            jsonResponse(res, { errors: result.errors }, 422);
            return true;
          }
          const product = { ...products[index], ...result.value, updatedAt: new Date().toISOString() };
          products = products.with(index, product);
          jsonResponse(res, product);
          return true;
        }
        if (req.method === "DELETE") {
          if (index < 0) {
            jsonResponse(res, { error: "Product not found" }, 404);
            return true;
          }
          products = products.toSpliced(index, 1);
          res.writeHead(204);
          res.end();
          return true;
        }
        jsonResponse(res, { error: "Method not allowed" }, 405);
        return true;
      }

      jsonResponse(res, { error: "Not found" }, 404);
      return true;
    }

    // SPA fallback: every non-API, extensionless GET serves index.html; the
    // head script settles the language and the router resolves the rest.
    if (req.method === "GET" && extname(url.pathname) === "") {
      const html = await readFile(join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(LOCAL ? rewriteCdn(html) : html);
      return true;
    }

    return false;
  },
  notes: [
    "Open / (redirects to /en/). Deep links work: /ja/products?page=3&sort=price&dir=desc",
    "POST /api/reset puts the starting catalog back.",
    `DELAY_MS=${DELAY_MS} (every API response is delayed by this many ms)`,
  ],
});
