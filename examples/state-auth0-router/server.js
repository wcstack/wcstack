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
  const popup = process.env.AUTH0_POPUP !== "false";
  return {
    ready: Boolean(process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID),
    domain: process.env.AUTH0_DOMAIN || "(set AUTH0_DOMAIN)",
    clientId: process.env.AUTH0_CLIENT_ID || "(set AUTH0_CLIENT_ID)",
    audience: process.env.AUTH0_AUDIENCE || "not set",
    scope: process.env.AUTH0_SCOPE || "openid profile email",
    popup,
    returnTo: process.env.AUTH0_RETURN_TO || `http://localhost:${port}/`,
  };
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildAuthElement(config) {
  if (!config.ready) {
    return "";
  }

  const audienceAttribute = config.audience !== "not set"
    ? ` audience="${htmlEscape(config.audience)}"`
    : "";
  const popupAttribute = config.popup ? " popup" : "";

  return `<wcs-auth id="auth" domain="${htmlEscape(config.domain)}" client-id="${htmlEscape(config.clientId)}" scope="${htmlEscape(config.scope)}"${audienceAttribute}${popupAttribute} data-wcs="authenticated: authenticated; user: user; token: token; loading: loading; error: error; trigger: loginRequested"></wcs-auth>`;
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

function injectConfig(content, port) {
  const config = buildConfig(port);
  return content
    .replace("__DEMO_CONFIG__", JSON.stringify(config).replaceAll("<", "\\u003c"))
    .replace("__AUTH_ELEMENT__", buildAuthElement(config))
    .replaceAll("__RETURN_TO__", htmlEscape(config.returnTo));
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
      // SPA フォールバック: ファイルが見つからない場合は index.html を返す
      try {
        const fallback = resolve(exampleRoot, "index.html");
        let content = await readFile(fallback, "utf8");
        content = injectConfig(content, port);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end("Not Found");
      }
    }
  }
}

const port = Number(process.env.PORT || 3100);

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  await serveFile(res, url.pathname, port);
}).listen(port, () => {
  console.log(`Auth0 + Router demo running at http://localhost:${port}`);
});