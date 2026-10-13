/**
 * Demo server for the shared task board (state + sse + fetch + storage + network).
 *
 * In-memory cards, a JSON API for changes, and one Server-Sent Events stream
 * that pushes every change to every open board:
 *
 *   GET    /api/cards              → { cards, seq }   (seq = id of the latest event)
 *   GET    /api/events             → SSE. Each change is an event named "card",
 *                                    `id: <seq>`, data { type: "added" | "updated" | "deleted", card }.
 *                                    A client reconnecting with Last-Event-ID gets every
 *                                    later event replayed first; an id more than 100 events
 *                                    old gets one "resync" event instead.
 *   POST   /api/cards              { title, column, by }            → 201 card
 *   PATCH  /api/cards/:id          { title?, column?, version, by } → 200 card | 404 | 409 { error, card }
 *   DELETE /api/cards/:id?by=      → 204 | 404
 *   POST   /api/test/fail-next     → the next change request answers 500 { error: "Server error" }
 *   POST   /api/test/drop-streams  → closes every event stream (as a server restart would)
 *   POST   /api/test/reset         → back to the six starting cards and an empty event log
 *                                    (closes every stream; used by e2e/tests/state-collab-board.spec.ts)
 */
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createDemoServer, jsonResponse } from "../shared/server.js";

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

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const COLUMNS = ["todo", "doing", "done"];
const REPLAY_LIMIT = 100;          // a Last-Event-ID older than this gets "resync"
const KEEP_EVENTS = 500;           // how many events the log keeps

let nextId = 1;
const cards = [];
function seed(title, column, by) {
  const order = cards.filter((c) => c.column === column).length + 1;
  cards.push({ id: nextId++, title, column, order, version: 1, updatedBy: by });
}
function seedAll() {
  cards.length = 0;
  nextId = 1;
  seed("Write the release notes", "todo", "Ana");
  seed("Fix the login redirect", "todo", "Ben");
  seed("Review the board design", "doing", "Chie");
  seed("Migrate the build to esbuild", "doing", "Ana");
  seed("Set up the staging server", "done", "Ben");
  seed("Draft the onboarding guide", "done", "Chie");
}
seedAll();

let seq = 0;                       // id of the latest event
const events = [];                 // { id, type, card }
const streams = new Set();         // open SSE responses
let failNext = false;

function publish(type, card) {
  seq += 1;
  const event = { id: seq, type, card: { ...card } };
  events.push(event);
  if (events.length > KEEP_EVENTS) events.shift();
  for (const res of streams) writeEvent(res, event);
}

function writeEvent(res, event) {
  res.write(`event: card\nid: ${event.id}\ndata: ${JSON.stringify({ type: event.type, card: event.card })}\n\n`);
}

function nextOrder(column) {
  return cards.filter((c) => c.column === column).reduce((max, c) => Math.max(max, c.order), 0) + 1;
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function takeFailure(res) {
  if (!failNext) return false;
  failNext = false;
  jsonResponse(res, { error: "Server error" }, 500);
  return true;
}

// ---------------------------------------------------------------------------
// Event stream
// ---------------------------------------------------------------------------

function handleEvents(req, res, url) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
  });
  res.write("retry: 1000\n\n");    // reconnect after ~1 s

  const header = req.headers["last-event-id"];
  if (header !== undefined && header !== "") {
    const lastId = Number(header);
    const oldest = events.length ? events[0].id : seq + 1;
    if (!Number.isInteger(lastId) || lastId > seq || seq - lastId > REPLAY_LIMIT || lastId < oldest - 1) {
      res.write(`event: resync\nid: ${seq}\ndata: ${JSON.stringify({ seq })}\n\n`);
    } else {
      for (const event of events) if (event.id > lastId) writeEvent(res, event);
    }
  }

  streams.add(res);
  const ping = setInterval(() => {
    if (res.destroyed || res.writableEnded) return clearInterval(ping);
    res.write(": ping\n\n");
  }, 15000);
  req.on("close", () => {
    clearInterval(ping);
    streams.delete(res);
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    const { pathname } = url;

    if (LOCAL && req.method === "GET" && pathname.startsWith("/packages/")) {
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

    if (pathname === "/api/cards" && req.method === "GET") {
      jsonResponse(res, { cards, seq });
      return true;
    }

    if (pathname === "/api/events" && req.method === "GET") {
      handleEvents(req, res, url);
      return true;          // the stream stays open: res is ours to keep
    }

    if (pathname === "/api/cards" && req.method === "POST") {
      const body = await readJson(req);
      if (takeFailure(res)) return true;
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) return jsonResponse(res, { error: "A card needs a title." }, 400), true;
      if (!COLUMNS.includes(body.column)) return jsonResponse(res, { error: "Unknown column." }, 400), true;
      const card = {
        id: nextId++, title, column: body.column, order: nextOrder(body.column),
        version: 1, updatedBy: String(body.by || "someone"),
      };
      cards.push(card);
      publish("added", card);
      jsonResponse(res, card, 201);
      return true;
    }

    const match = pathname.match(/^\/api\/cards\/(\d+)$/);
    if (match && req.method === "PATCH") {
      const body = await readJson(req);
      if (takeFailure(res)) return true;
      const card = cards.find((c) => c.id === Number(match[1]));
      if (!card) return jsonResponse(res, { error: "This card no longer exists." }, 404), true;
      if (body.version !== card.version) {
        return jsonResponse(res, { error: `${card.updatedBy} changed this card first.`, card }, 409), true;
      }
      if (body.title !== undefined) {
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) return jsonResponse(res, { error: "A card needs a title." }, 400), true;
        card.title = title;
      }
      if (body.column !== undefined && body.column !== card.column) {
        if (!COLUMNS.includes(body.column)) return jsonResponse(res, { error: "Unknown column." }, 400), true;
        card.order = nextOrder(body.column);
        card.column = body.column;
      }
      card.version += 1;
      card.updatedBy = String(body.by || "someone");
      publish("updated", card);
      jsonResponse(res, card);
      return true;
    }

    if (match && req.method === "DELETE") {
      if (takeFailure(res)) return true;
      const index = cards.findIndex((c) => c.id === Number(match[1]));
      if (index < 0) return jsonResponse(res, { error: "This card no longer exists." }, 404), true;
      const [card] = cards.splice(index, 1);
      card.updatedBy = url.searchParams.get("by") || "someone";
      publish("deleted", card);
      res.writeHead(204);
      res.end();
      return true;
    }

    if (pathname === "/api/test/reset" && req.method === "POST") {
      for (const stream of streams) stream.end();
      streams.clear();
      seedAll();
      seq = 0;
      events.length = 0;
      failNext = false;
      jsonResponse(res, { ok: true });
      return true;
    }

    if (pathname === "/api/test/fail-next" && req.method === "POST") {
      failNext = true;
      jsonResponse(res, { ok: true });
      return true;
    }

    if (pathname === "/api/test/drop-streams" && req.method === "POST") {
      const count = streams.size;
      for (const stream of streams) stream.end();
      streams.clear();
      jsonResponse(res, { dropped: count });
      return true;
    }

    // Everything else that is not a file: the board page.
    if (req.method === "GET" && !pathname.startsWith("/api/") && extname(pathname) === "") {
      const html = await readFile(join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(LOCAL ? rewriteCdn(html) : html);
      return true;
    }

    return false;
  },
  notes: [
    "Open the board in two browsers (or a normal and a private window).",
    "Test hooks: POST /api/test/fail-next, /api/test/drop-streams, /api/test/reset",
  ],
});
