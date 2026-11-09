// Lint the pages as the browser gets them (docs/islands.md, "Checking such a site"): the templates alone cannot be
// path-checked — a fragment has no state (the lint says so: wcs/state-absent), and the CMS's partials are invisible to it. This starts the server on spare ports, saves the
// rendered pages (with the booking fragment put into its page, and the widget's markup with its state), and runs
// @wcstack/lint over them with --root=public so every <wcs-state src="/js/…"> is read.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".lint-rendered");
const HALL_PORT = 5633;
const INN_PORT = 5634;
const base = `http://localhost:${HALL_PORT}`;
const extra = process.argv.slice(2);   // e.g. --strict

const server = spawn(process.execPath, [path.join(ROOT, "server.js")], {
  env: { ...process.env, HALL_PORT: String(HALL_PORT), INN_PORT: String(INN_PORT) }, stdio: "ignore",
});
try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + "/api/seats")).ok) break; } catch { /* not yet */ }
    if (i > 50) throw new Error("server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const get = async (u, headers = {}) => (await fetch(base + u, { headers })).text();
  const pages = {
    "home.html": "/",
    "events.html": "/events",
    "events-filtered.html": "/events?cat=%E9%9F%B3%E6%A5%BD&available=1&sort=title&from=2026-01-01",
    "my.html": "/my",
    "notfound.html": "/nope",
  };
  for (const [file, u] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, file), await get(u));
  // an event's page with its booking fragment where htmx puts it
  for (const id of [1, 17]) {
    const page = await get(`/events/${id}`);
    const fragment = await get(`/events/${id}/booking`, { "HX-Request": "true" });
    const marker = /(<div id="booking-slot"[^>]*>)[\s\S]*?(<\/div>)/;
    fs.writeFileSync(path.join(OUT, `event-${id}.html`), page.replace(marker, `$1${fragment}$2`));
  }
  // the widget's shadow root content: its state module named by a path from / (the lint reads it under --root)
  // (it is another state, so it gets its own directory)
  fs.mkdirSync(path.join(OUT, "widget"));
  const widget = (await get("/widget/markup?event=1")).replaceAll(base, "").replaceAll("widget-state.js?event=1", "widget-state.js");
  fs.writeFileSync(path.join(OUT, "widget", "widget.html"), widget);

  // (the seat and star maps are Record<string, …> in the states' JSDoc: since 4.20 the lint leaves the paths below
  // them open, as a stateSchema does)

  const files = [...fs.readdirSync(OUT).filter((f) => f.endsWith(".html")).map((f) => path.join(".lint-rendered", f)), path.join(".lint-rendered", "widget", "widget.html")];
  const lint = spawnSync(process.execPath, [path.join(ROOT, "node_modules/@wcstack/lint/dist/cli.cjs"), "--root=public", "--lang=en", ...extra, ...files],
    { cwd: ROOT, stdio: "inherit" });
  process.exitCode = lint.status ?? 1;
} finally {
  server.kill();
}
