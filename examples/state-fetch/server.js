import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Mock data
const users = [
  { id: 1, name: "Alice Johnson", email: "alice@example.com", role: "admin" },
  { id: 2, name: "Bob Smith", email: "bob@example.com", role: "editor" },
  { id: 3, name: "Charlie Davis", email: "charlie@example.com", role: "viewer" },
  { id: 4, name: "Diana Miller", email: "diana@example.com", role: "editor" },
  { id: 5, name: "Ethan Wilson", email: "ethan@example.com", role: "viewer" },
];

// Monotonic id source. `users.length + 1` would collide once a delete lands
// (length shrinks while ids don't), so allocate from a counter that only ever
// increases — correct now and forward-compatible with a future DELETE route.
let nextId = users.length + 1;

const ROLES = ["viewer", "editor", "admin"];

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

const server = createServer(async (req, res) => {
  // Wrap the whole async handler: a malformed raw request can make `new URL(...)`
  // throw, and a malformed POST body makes `JSON.parse(...)` throw. An unhandled
  // rejection inside an async http handler can take the process down, so fail the
  // single request with 400 instead.
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // API routes
    if (path === "/api/users" && req.method === "GET") {
      // Simulate network latency
      await new Promise((r) => setTimeout(r, 500));
      const role = url.searchParams.get("role");
      const filtered = role ? users.filter((u) => u.role === role) : users;
      return jsonResponse(res, filtered);
    }

    if (path.match(/^\/api\/users\/\d+$/) && req.method === "GET") {
      await new Promise((r) => setTimeout(r, 300));
      const id = parseInt(path.split("/").pop());
      const user = users.find((u) => u.id === id);
      if (user) return jsonResponse(res, user);
      return jsonResponse(res, { error: "User not found" }, 404);
    }

    if (path === "/api/users" && req.method === "POST") {
      await new Promise((r) => setTimeout(r, 400));
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      // JSON.parse can throw on a malformed body; the handler-wide try/catch turns
      // that into a 400 rather than an unhandled rejection that crashes the process.
      const body = JSON.parse(Buffer.concat(chunks).toString());

      // Pick fields explicitly instead of `{ id, ...body }`. Spreading the client
      // body lets it set its own `id` (overriding the server's), which produces
      // duplicate ids — and the detail lookup (find-by-id, first-match-wins) would
      // then return the wrong user. Explicit assignment also keeps mass-assignment
      // out of the example. The server owns the id; clients cannot supply one.
      const name = typeof body.name === "string" ? body.name.trim() : "";
      // Validate so the error path is actually reachable: an empty name is rejected
      // with 400, which both blocks blank-row users and lets the UI demonstrate that
      // form input is preserved when a submit fails.
      if (!name) {
        return jsonResponse(res, { error: "Name is required" }, 400);
      }
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const role = ROLES.includes(body.role) ? body.role : "viewer";
      const newUser = { id: nextId++, name, email, role };
      users.push(newUser);
      return jsonResponse(res, newUser, 201);
    }

    // Static files
    if (path === "/" || path === "/index.html") {
      return serveFile(res, join(__dirname, "index.html"));
    }

    res.writeHead(404);
    res.end("Not Found");
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Demo server running at http://localhost:${PORT}`);
});
