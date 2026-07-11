/**
 * Demo server for the $streams example (fetch body streaming).
 *
 * Self-contained, modeled on the repo-root examples/shared/server.js. The other
 * examples under packages/state/examples are plain static pages pulling the
 * released package from the CDN, but this demo needs two things a static host
 * cannot provide:
 *
 *   1. GET /api/story?prompt=...&seed=...
 *      A chunked text route that emits a fake "LLM style" story a few words at
 *      a time (~60ms apart), stops producing as soon as the client aborts
 *      (cooperative cancellation made observable), and — when the prompt
 *      contains "error" — destroys the connection mid-stream so the
 *      $streamError path (error keeps the folded text) can be seen.
 *
 *   2. /state-dist/*
 *      The LOCAL packages/state/dist build. $streams is not released yet, so
 *      the page must import the local bundle instead of the CDN
 *      (run `npm run build` in packages/state first).
 *
 * Everything else under packages/state/examples is served statically, so the
 * gallery at "/" keeps working from this server too.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const examplesRoot = resolve(here, "..");            // packages/state/examples
const distRoot = resolve(here, "..", "..", "dist");  // packages/state/dist
const PORT = Number(process.env.PORT || 3000);

const CHUNK_INTERVAL_MS = 60;       // one word per tick — slow enough to watch
const ERROR_DROP_AFTER_TOKENS = 12; // "error" prompts get cut off after this many

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

// --- fake LLM story ---------------------------------------------------------

const OPENINGS = [
  "Once upon a time,",
  "Deep inside the event loop,",
  "Long after the last deploy,",
  "At the far edge of the network,",
];
const TURNS = [
  "Nobody believed it at first, yet every chunk that arrived made the story a little longer.",
  "The packets came slowly, one word at a time, exactly as the demo intended.",
  "Each fragment was folded onto the last, and the page never once re-fetched the whole.",
  "The reader kept reading, the fold kept folding, and the text kept growing on screen.",
];
const ENDINGS = [
  "And when the final chunk landed, the status quietly turned to done.",
  "So the stream ended — not with an error, but with a tidy little done.",
  "The connection closed, the story stayed, and everyone shipped on time.",
];

/** Deterministic story for (prompt, seed), split into word tokens (spaces kept). */
function buildStoryTokens(prompt, seed) {
  const subject = prompt.trim() === "" ? "an unnamed hero" : `"${prompt.trim()}"`;
  const pick = (arr, n) => arr[((n % arr.length) + arr.length) % arr.length];
  const text =
    `${pick(OPENINGS, seed)} there was a story about ${subject}. ` +
    `${pick(TURNS, seed + 1)} ${pick(TURNS, seed + 2)} ` +
    `${pick(ENDINGS, seed + 3)}\n`;
  return text.match(/\S+\s*/g) ?? [];
}

// --- chunked streaming route -------------------------------------------------

function handleStory(res, url) {
  const prompt = url.searchParams.get("prompt") ?? "";
  const seed = Number.parseInt(url.searchParams.get("seed") ?? "0", 10) || 0;
  const dropMidStream = /error/i.test(prompt);
  const tokens = buildStoryTokens(prompt, seed);

  // No Content-Length -> Node uses chunked transfer encoding automatically.
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  let index = 0;
  const timer = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      clearInterval(timer);
      return;
    }
    if (dropMidStream && index >= ERROR_DROP_AFTER_TOKENS) {
      clearInterval(timer);
      res.destroy(); // hard-drop mid-stream: the client's read() rejects -> $streamError
      return;
    }
    if (index >= tokens.length) {
      clearInterval(timer);
      res.end(); // normal termination -> $streamStatus turns "done"
      return;
    }
    res.write(tokens[index++]);
  }, CHUNK_INTERVAL_MS);

  // Client abort (switchMap restart, page close): stop producing immediately.
  // This is the server-side half of the cooperative-cancellation contract —
  // fetch(url, { signal }) on the page tears the connection down, and we stop.
  res.on("close", () => clearInterval(timer));
}

// --- static serving ----------------------------------------------------------

async function serveFrom(root, res, relPath) {
  const filePath = resolve(root, relPath);
  // Path traversal guard: the resolved path must stay inside root.
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache", // always revalidate while tweaking the demo
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

// --- server -------------------------------------------------------------------

if (!existsSync(resolve(distRoot, "auto.js"))) {
  console.warn(
    "[streams demo] packages/state/dist not found — run `npm run build` in packages/state first\n" +
    "               ($streams is unreleased; this demo imports the local build, not the CDN).",
  );
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/story" && req.method === "GET") {
      return handleStory(res, url);
    }

    // Local unreleased build, mounted off to the side so example paths stay clean.
    if (path.startsWith("/state-dist/")) {
      return await serveFrom(distRoot, res, "." + path.slice("/state-dist".length));
    }

    let rel;
    if (path === "/") rel = "index.html";
    else if (path.endsWith("/")) rel = "." + path + "index.html";
    else rel = "." + path;
    return await serveFrom(examplesRoot, res, rel);
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
  }
});

server.listen(PORT, () => {
  console.log(`🚀 $streams demo running at http://localhost:${PORT}/streams/`);
  console.log(`   gallery: http://localhost:${PORT}/`);
  console.log(`   /state-dist/ serves the local packages/state/dist build (unreleased $streams)`);
});
