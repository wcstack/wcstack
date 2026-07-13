/**
 * Demo server for the devtools playground (devtools + state + timer).
 *
 * Unlike the other demos this serves the REPO ROOT, because the page loads
 * the locally built dist of @wcstack/devtools (and the instrumented
 * @wcstack/state) — neither is on the CDN until the next release. After the
 * release the <script> tags can switch to https://esm.run/@wcstack/<pkg>/auto
 * and this server can shrink to the usual __dirname static host.
 *
 * Run: node examples/state-devtools-playground/server.js  → http://localhost:3000/
 */
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../shared/server.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

createDemoServer({
  port: 3000,
  root: repoRoot,
  defaultFile: "examples/state-devtools-playground/index.html",
  notes: [
    "Open http://localhost:3000/ and press Alt+Shift+D (or click the WCS badge).",
    "Local dist builds are served from /packages/*/dist — run each package's `npm run build` first.",
  ],
});
