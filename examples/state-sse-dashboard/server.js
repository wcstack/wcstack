/**
 * Demo server for the SSE dashboard example (sse + state($streams) + network).
 *
 * Two things beyond static file serving, both through the shared server's raw
 * (req, res) api hook:
 *
 *   1. GET /api/metrics?host=a|b
 *      A Server-Sent Events stream: a named "metric" event every ~600ms with a
 *      host-specific CPU/RPS profile (so switching hosts is visible on the
 *      charts), plus an occasional named "deploy" event. Streaming is exactly
 *      what the api hook permits: write the event-stream headers, keep
 *      writing, return true — and never call res.end().
 *
 *   2. /state-dist/*
 *      The LOCAL packages/state/dist build. $streams is not released yet, so
 *      the page imports the local state bundle instead of the CDN (run
 *      `npm run build` in packages/state first). sse / network still load
 *      from the CDN as usual.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const stateDistRoot = resolve(__dirname, "..", "..", "packages", "state", "dist");

const METRIC_INTERVAL_MS = 600;
const DEPLOY_EVERY = 12; // one "deploy" event per N "metric" events

// Host profiles — deliberately far apart so a host switch is unmistakable.
const HOSTS = {
  a: { cpuBase: 32, cpuSwing: 16, rpsBase: 120, major: 3 },
  b: { cpuBase: 68, cpuSwing: 14, rpsBase: 480, major: 7 },
};

const DIST_MIME = {
  ".js": "application/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};

function handleMetrics(req, res, url) {
  const host = url.searchParams.get("host") === "b" ? "b" : "a";
  const profile = HOSTS[host];

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
  });
  res.write("retry: 3000\n\n"); // native EventSource reconnection hint

  let n = 0;
  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      clearInterval(timer);
      return;
    }
    n++;
    const cpu = Math.max(2, Math.min(98,
      profile.cpuBase + profile.cpuSwing * Math.sin(n / 5) + (Math.random() - 0.5) * 14));
    const rps = Math.max(0, Math.round(profile.rpsBase * (0.85 + Math.random() * 0.3)));
    res.write(`event: metric\ndata: ${JSON.stringify({ host, cpu: Number(cpu.toFixed(1)), rps })}\n\n`);
    if (n % DEPLOY_EVERY === 0) {
      res.write(`event: deploy\ndata: ${JSON.stringify({ host, version: `v${profile.major}.${Math.floor(n / DEPLOY_EVERY)}.0` })}\n\n`);
    }
  }, METRIC_INTERVAL_MS);

  // EventSource closed (page gone, host switched, stream restarted): stop producing.
  req.on("close", () => clearInterval(timer));
}

async function serveStateDist(res, relPath) {
  const filePath = resolve(stateDistRoot, relPath);
  // Path traversal guard: the resolved path must stay inside the dist root.
  if (filePath !== stateDistRoot && !filePath.startsWith(stateDistRoot + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": DIST_MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

if (!existsSync(resolve(stateDistRoot, "auto.js"))) {
  console.warn(
    "[sse-dashboard] packages/state/dist not found — run `npm run build` in packages/state first\n" +
    "                ($streams is unreleased; this demo imports the local state build, not the CDN).",
  );
}

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    if (url.pathname === "/api/metrics" && req.method === "GET") {
      handleMetrics(req, res, url);
      return true; // handled — the stream stays open, so res is ours to keep
    }
    if (url.pathname.startsWith("/state-dist/")) {
      await serveStateDist(res, "." + url.pathname.slice("/state-dist".length));
      return true;
    }
    return false;
  },
  notes: [
    "SSE stream: /api/metrics?host=a|b (metric every 600ms + an occasional deploy)",
    "/state-dist/ serves the local packages/state/dist build (unreleased $streams)",
  ],
});
