// Does a replayed, auto-removed animation still render? Does persist() keep it? (docs/animation-tag-design.md §3, P8b)
// usage (from the repository root, after `npm ci` and `npx playwright install` in e2e/):
//   node docs/spikes/waapi-animation/probe-removed.mjs [e2e dir] [chromium|firefox|webkit]
//
// a: opacity 1 → 0.2 and b: opacity 1 → 0.6, both fill:forwards on the same element. Once both have
// finished, the browser removes a (b replaces it). b is then cancelled, so a is the only animation
// left, and a is replayed and held at 25 %: opacity 0.8 if a's effect applies, 1 if it does not.
import { createRequire } from "node:module";
import path from "node:path";

const e2eDir = process.argv[2] ?? path.resolve(import.meta.dirname, "../../../e2e");
const only = process.argv[3];
const require = createRequire(path.join(e2eDir, "package.json"));
const { chromium, firefox, webkit } = require("@playwright/test");

const HTML = `<!doctype html><html><body><div id="card" style="width:50px;height:50px;background:red">x</div></body></html>`;

async function run(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const card = document.getElementById("card");
    const mk = (to, persist) => {
      const a = new Animation(new KeyframeEffect(card, [{ opacity: 1 }, { opacity: to }], { duration: 400, fill: "forwards" }));
      if (persist) a.persist();
      return a;
    };
    const out = {};
    for (const persist of [false, true]) {
      const a = mk(0.2, persist);
      const b = mk(0.6, false);
      a.play(); a.finish();
      b.play(); b.finish();
      await sleep(60);
      const aReplaceStateAfterB = a.replaceState;
      b.cancel();
      a.currentTime = 0; a.play(); a.pause(); a.currentTime = 100;
      await sleep(30);
      out[persist ? "withPersist" : "noPersist"] = {
        aReplaceStateAfterB,
        aPlayState: a.playState,
        aReplaceState: a.replaceState,
        computedOpacity: getComputedStyle(card).opacity,
        applied: getComputedStyle(card).opacity === "0.8",
      };
      a.cancel();
    }
    return out;
  });
}

for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  if (only && only !== name) continue;
  let browser;
  try { browser = await type.launch(); } catch (e) { console.log(`=== ${name} LAUNCH FAILED`, e.message.split("\n")[0]); continue; }
  try {
    const page = await browser.newPage();
    await page.setContent(HTML);
    const r = await run(page);
    console.log(`=== ${name} ${browser.version()}`);
    for (const [k, v] of Object.entries(r)) console.log(k.padEnd(12), JSON.stringify(v));
  } finally {
    await browser.close();
  }
}
