import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { createDemoServer, jsonResponse, delay } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// Opt-in: WCS_LOCAL=1 swaps the esm.run one-liners for the locally built
// bundles and serves /packages/<pkg>/dist from the repo (same switch as
// examples/router-spa/server.js).
const LOCAL = process.env.WCS_LOCAL === "1";
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS || 300000);

function rewriteCdn(html) {
  return html.replace(
    /https:\/\/esm\.run\/@wcstack\/([\w-]+)(?:@[^/"'\s]+)?(\/auto)?(?=["'\s])/g,
    (_m, pkg, auto) =>
      auto ? `/packages/${pkg}/dist/auto.min.js` : `/packages/${pkg}/dist/index.esm.js`,
  );
}

// --- Mock data -------------------------------------------------------------
const members = {
  alice: { password: "alice123", name: "Alice Johnson", email: "alice@example.com" },
  bob: { password: "bob123", name: "Bob Smith", email: "bob@example.com" },
};

const orders = [
  {
    id: 1, owner: "alice", date: "2026-08-02", status: "Delivered",
    items: [
      { name: "Ceramic mug", qty: 2, price: 1200 },
      { name: "Pour-over kettle", qty: 1, price: 6800 },
    ],
  },
  {
    id: 2, owner: "alice", date: "2026-09-14", status: "Shipped",
    items: [
      { name: "Coffee beans (500 g)", qty: 3, price: 2400 },
    ],
  },
  {
    id: 3, owner: "alice", date: "2026-10-09", status: "Processing",
    items: [
      { name: "Hand grinder", qty: 1, price: 9800 },
      { name: "Paper filters (100)", qty: 2, price: 450 },
      { name: "Cleaning brush", qty: 1, price: 600 },
    ],
  },
];

const totalOf = (order) => order.items.reduce((sum, i) => sum + i.qty * i.price, 0);
const summary = (order) => ({ id: order.id, date: order.date, total: totalOf(order), status: order.status });

// token -> { username, expiresAt }
const sessions = new Map();

function currentUser(req) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(\S+)$/);
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s) return null;
  if (Date.now() >= s.expiresAt) {
    sessions.delete(m[1]);
    return null;
  }
  return { token: m[1], username: s.username };
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw); // a malformed body is turned into 400 by the shared server
}

const notLoggedIn = (res) => jsonResponse(res, { error: "Not logged in" }, 401);

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    const { pathname } = url;

    // --- Local bundles (WCS_LOCAL=1) ---------------------------------------
    if (req.method === "GET" && LOCAL && pathname.startsWith("/packages/")) {
      const file = resolve(REPO_ROOT, "." + pathname);
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

    // --- API -----------------------------------------------------------------
    if (req.method === "POST" && pathname === "/api/login") {
      const { username, password } = await readJson(req);
      await delay(200);
      const member = typeof username === "string" ? members[username] : undefined;
      if (!member || member.password !== password) {
        jsonResponse(res, { error: "Wrong username or password" }, 401);
        return true;
      }
      const token = randomBytes(16).toString("hex");
      sessions.set(token, { username, expiresAt: Date.now() + TOKEN_TTL_MS });
      jsonResponse(res, { token, user: { name: member.name, email: member.email } });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      const user = currentUser(req);
      if (user) sessions.delete(user.token);
      res.writeHead(204);
      res.end();
      return true;
    }

    if (req.method === "POST" && pathname === "/api/test/expire-all") {
      const n = sessions.size;
      sessions.clear();
      jsonResponse(res, { expired: n });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/me") {
      const user = currentUser(req);
      await delay(150);
      if (!user) return notLoggedIn(res), true;
      const { name, email } = members[user.username];
      jsonResponse(res, { name, email });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/orders") {
      const user = currentUser(req);
      await delay(200);
      if (!user) return notLoggedIn(res), true;
      jsonResponse(res, orders.filter((o) => o.owner === user.username).map(summary));
      return true;
    }

    const detail = pathname.match(/^\/api\/orders\/(\d+)$/);
    if (req.method === "GET" && detail) {
      const user = currentUser(req);
      await delay(200);
      if (!user) return notLoggedIn(res), true;
      const order = orders.find((o) => o.id === Number(detail[1]) && o.owner === user.username);
      if (!order) {
        jsonResponse(res, { error: "Order not found" }, 404);
        return true;
      }
      jsonResponse(res, { ...summary(order), items: order.items });
      return true;
    }

    if (pathname.startsWith("/api/")) {
      jsonResponse(res, { error: "Not found" }, 404);
      return true;
    }

    // --- SPA fallback: every other GET that is not a file serves index.html ---
    if (req.method === "GET" && extname(pathname) === "") {
      const html = await readFile(join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(LOCAL ? rewriteCdn(html) : html);
      return true;
    }

    return false;
  },
  notes: [
    "Members: alice / alice123 (3 orders), bob / bob123 (0 orders)",
    `Tokens expire after ${TOKEN_TTL_MS} ms (TOKEN_TTL_MS); POST /api/test/expire-all expires them now`,
  ],
});
