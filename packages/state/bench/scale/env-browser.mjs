/**
 * The environment of run.mjs inside a Chromium page, over the built bundle (dist/index.esm.js, or
 * the one browser.mjs routes in its place). The bundle's internal names are shortened, so nothing
 * is counted here: time, DOM changes and the heap (launched with --expose-gc and
 * --enable-precise-memory-info).
 */
import { bootstrapState, getBindingsReady } from "../../dist/index.esm.js";

bootstrapState();

const microtask = () => new Promise((r) => queueMicrotask(r));
const tick = () => new Promise((r) => setTimeout(r, 0));
let seq = 0;

function summarize(records) {
  let added = 0;
  let removed = 0;
  let attributes = 0;
  let text = 0;
  for (const r of records) {
    added += r.addedNodes.length;
    removed += r.removedNodes.length;
    if (r.type === "attributes") attributes++;
    if (r.type === "characterData") text++;
  }
  return { added, removed, attributes, text };
}

async function settleTag(root, tag) {
  for (const el of Array.from(root.querySelectorAll(tag))) {
    const sr = el.shadowRoot;
    if (sr === null) continue;
    const st = sr.querySelector("wcs-state");
    if (st) await st.connectedCallbackPromise;
    await getBindingsReady(sr);
    await tick();
    await settleTag(sr, tag);
  }
}

export const env = {
  name: "chromium",
  async page(built) {
    const host = document.createElement(`scale-page-${seq++}`);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `${built.before ?? ""}<wcs-state></wcs-state>${built.html}`;
    const el = root.querySelector("wcs-state:not([mount])");
    el.setInitialState(built.state);
    const t0 = performance.now();
    document.body.appendChild(host);
    await el.connectedCallbackPromise;
    await getBindingsReady(root);
    if (built.ready) await settleTag(root, built.ready);
    const mountMs = performance.now() - t0;
    // the records a delivery (a microtask after the drain) hands over before timed() reads them; only
    // while timing — an untimed write's records would hold the nodes it removed
    const seen = [];
    let recording = false;
    const observer = new MutationObserver((rs) => { if (recording) seen.push(...rs); });
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    return {
      root, el, built, mountMs,
      async write(fn) {
        el.createState("writable", fn);
        await microtask();
      },
      async timed(fn) {
        observer.takeRecords();
        seen.length = 0;
        recording = true;
        const t = performance.now();
        el.createState("writable", fn);
        await microtask();
        const ms = performance.now() - t;
        recording = false;
        const dom = summarize([...seen, ...observer.takeRecords()]);
        seen.length = 0;
        return { ms, dom };
      },
      stats: () => null,
      dispose() {
        observer.disconnect();
        host.remove();
      },
    };
  },
  async gc() {
    for (let i = 0; i < 3; i++) {
      globalThis.gc?.();
      await tick();
    }
  },
  heap() {
    return globalThis.gc && performance.memory ? performance.memory.usedJSHeapSize : null;
  },
  captureErrors() {
    const msgs = [];
    const orig = console.error;
    console.error = (...a) => { msgs.push(a.map(String).join(" ")); };
    return { stop: () => { console.error = orig; return msgs; } };
  },
};
