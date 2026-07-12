/**
 * Demo server for the SSE dashboard example (sse + state($streams) + network).
 *
 * One thing beyond static file serving, through the shared server's raw
 * (req, res) api hook:
 *
 *   GET /api/metrics?host=a|b
 *   A Server-Sent Events stream: a named "metric" event every ~600ms with a
 *   host-specific CPU/RPS profile (so switching hosts is visible on the
 *   charts), plus an occasional named "deploy" event. Streaming is exactly
 *   what the api hook permits: write the event-stream headers, keep
 *   writing, return true — and never call res.end().
 *
 * All wcstack packages (state / sse / network) load from the CDN — $streams
 * ships since v1.19.0, so no local build mount is needed.
 */
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const METRIC_INTERVAL_MS = 600;
const DEPLOY_EVERY = 12; // one "deploy" event per N "metric" events

// Host profiles — deliberately far apart so a host switch is unmistakable.
const HOSTS = {
  a: { cpuBase: 32, cpuSwing: 16, rpsBase: 120, major: 3 },
  b: { cpuBase: 68, cpuSwing: 14, rpsBase: 480, major: 7 },
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

createDemoServer({
  port: Number(process.env.PORT || 3000),
  root: __dirname,
  api: async (req, res, url) => {
    if (url.pathname === "/api/metrics" && req.method === "GET") {
      handleMetrics(req, res, url);
      return true; // handled — the stream stays open, so res is ours to keep
    }
    return false;
  },
  notes: [
    "SSE stream: /api/metrics?host=a|b (metric every 600ms + an occasional deploy)",
  ],
});
