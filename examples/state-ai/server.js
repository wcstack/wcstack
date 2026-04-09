import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exampleRoot = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function buildConfig(port) {
  return {
    ready: Boolean(process.env.AI_BASE_URL),
    provider: process.env.AI_PROVIDER || "openai",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    baseUrl: process.env.AI_BASE_URL || "(set AI_BASE_URL)",
    apiKey: process.env.AI_API_KEY || "",
    system: process.env.AI_SYSTEM || "あなたは親切なAIアシスタントです。簡潔で分かりやすい日本語で回答してください。",
  };
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildAiElement(config) {
  if (!config.ready) {
    return "";
  }

  const apiKeyAttr = config.apiKey
    ? ` api-key="${htmlEscape(config.apiKey)}"`
    : "";

  return `<wcs-ai id="ai" provider="${htmlEscape(config.provider)}" model="${htmlEscape(config.model)}" base-url="${htmlEscape(config.baseUrl)}"${apiKeyAttr} data-wcs="prompt: userInput; trigger: sendRequested; content: assistantText; messages: chatHistory; loading: isLoading; streaming: isStreaming; error: error; usage: usage"></wcs-ai>`;
}

function resolvePath(pathname) {
  const safePath = pathname === "/"
    ? "index.html"
    : pathname.replace(/^\//, "");
  const absolute = resolve(exampleRoot, safePath);
  if (!absolute.startsWith(exampleRoot)) {
    return null;
  }
  return absolute;
}

function injectConfig(content, _port) {
  const config = buildConfig(_port);
  return content
    .replace("__DEMO_CONFIG__", JSON.stringify(config).replaceAll("<", "\\u003c"))
    .replace("__AI_ELEMENT__", buildAiElement(config));
}

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

    if (ext === ".html" && filePath.endsWith("index.html")) {
      content = injectConfig(content, port);
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

const port = Number(process.env.PORT || 3200);

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  await serveFile(res, url.pathname, port);
}).listen(port, () => {
  console.log(`AI demo running at http://localhost:${port}`);
});
