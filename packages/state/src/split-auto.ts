/**
 * `dist/split/auto.js` — the split build as one `<script type="module">` (no import map): the core,
 * and the add-ons the page names, loaded from this same build.
 *
 *   <script type="module" src=".../dist/split/auto.js"></script>
 *   <wcs-state features="scopes diagnostics">…</wcs-state>
 *
 * - `features` on the document's root `<wcs-state>` (no `mount`, no `bind-component`), read once
 *   before `<wcs-state>` is defined: what must be there before any `<wcs-state>` starts (scopes),
 *   and the page's choice of development aids (diagnostics, devtools).
 * - A state's `$features`: loaded through `hooks.load` before its engine is made (element.ts).
 *
 * A bundler cannot follow a URL built at run time: a bundle imports `@wcstack/state/core` and
 * calls `installFeatures`. No entry may import this one (docs/state-engine-rewrite/config-impl-plan.ja.md).
 */
import { bootstrapState } from "./element";
import { hooks, installFeatures } from "./hooks";
import { config } from "./config";
import { loader } from "./load";

const load = loader(import.meta.url);
hooks.load = (names) => load(names).then(installFeatures);

// an async module script may run while the document is still being parsed
if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
const root = document.querySelector(`${config.tagNames.state}:not([mount]):not([bind-component])`);
installFeatures(await load(root?.getAttribute("features")?.split(/\s+/).filter(Boolean) ?? []));
bootstrapState();
