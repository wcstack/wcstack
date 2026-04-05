import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "./ws.js";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(exampleRoot, "..", "..");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resolvePath(pathname) {
  const safePath = pathname === "/"
    ? "/examples/state-websocket/index.html"
    : pathname;
  const absolute = resolve(repoRoot, `.${safePath}`);
  if (!absolute.startsWith(repoRoot)) {
    return null;
  }
  return absolute;
}

const indexPath = ["examples", "state-websocket", "index.html"].join(sep);

async function serveFile(res, path, port) {
  const filePath = resolvePath(path);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    let content = await readFile(filePath, "utf8");
    const ext = extname(filePath);

    if (ext === ".html" && filePath.endsWith(indexPath)) {
      content = content
        .replaceAll("__WS_URL__", htmlEscape(`ws://localhost:${port}/ws`));
    }

    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "text/plain; charset=utf-8" });
    res.end(content);
  } catch {
    try {
      const binary = await readFile(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(binary);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
}

// --- HTTP + WebSocket サーバー ---

const port = Number(process.env.PORT || 3300);

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  await serveFile(res, url.pathname, port);
});

// WebSocket サーバー（組み込み echo + broadcast）
const wss = new WebSocketServer(httpServer, "/ws");

// 接続中クライアント数を定期通知
setInterval(() => {
  const payload = JSON.stringify({
    type: "stats",
    clients: wss.clientCount,
    uptime: Math.floor(process.uptime()),
  });
  wss.broadcast(payload);
}, 3000);

// メッセージハンドラ
wss.onMessage((ws, data) => {
  try {
    const parsed = JSON.parse(data);

    if (parsed.type === "echo") {
      // エコー: 送信者にのみ返す
      ws.send(JSON.stringify({
        type: "echo",
        content: parsed.content,
        timestamp: Date.now(),
      }));
    } else if (parsed.type === "broadcast") {
      // ブロードキャスト: 全クライアントに配信
      wss.broadcast(JSON.stringify({
        type: "broadcast",
        content: parsed.content,
        from: parsed.from || "anonymous",
        timestamp: Date.now(),
      }));
    } else {
      // 不明なタイプはエコーとして返す
      ws.send(JSON.stringify({
        type: "echo",
        content: data,
        timestamp: Date.now(),
      }));
    }
  } catch {
    // JSON でない場合はそのままエコー
    ws.send(JSON.stringify({
      type: "echo",
      content: data,
      timestamp: Date.now(),
    }));
  }
});

httpServer.listen(port, () => {
  console.log(`WebSocket demo running at http://localhost:${port}`);
  console.log(`WebSocket endpoint: ws://localhost:${port}/ws`);
});
