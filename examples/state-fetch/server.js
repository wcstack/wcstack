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
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const newUser = { id: users.length + 1, ...body };
    users.push(newUser);
    return jsonResponse(res, newUser, 201);
  }

  // Static files
  if (path === "/" || path === "/index.html") {
    return serveFile(res, join(__dirname, "index.html"));
  }

  res.writeHead(404);
  res.end("Not Found");
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Demo server running at http://localhost:${PORT}`);
});
