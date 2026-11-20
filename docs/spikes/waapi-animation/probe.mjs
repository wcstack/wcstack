// Web Animations API probe for the <wcs-animation> study (docs/animation-tag-design.md §3).
// usage (from the repository root, after `npm ci` and `npx playwright install` in e2e/):
//   node docs/spikes/waapi-animation/probe.mjs [e2e dir] [chromium|firefox|webkit]
import { createRequire } from "node:module";
import path from "node:path";

const e2eDir = process.argv[2] ?? path.resolve(import.meta.dirname, "../../../e2e");
const only = process.argv[3];
const require = createRequire(path.join(e2eDir, "package.json"));
const { chromium, firefox, webkit } = require("@playwright/test");

const HTML = `<!doctype html><html><body><div id="card" style="width:50px;height:50px;background:red">x</div><div id="b">y</div></body></html>`;

async function probes(page) {
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const card = document.getElementById("card");
    const out = {};
    const mk = (frames, timing, el = card) => new Animation(new KeyframeEffect(el, frames, timing));

    // P1: event handler properties on Animation.prototype
    out.P1_onProps = Object.getOwnPropertyNames(Animation.prototype).filter((n) => n.startsWith("on"));

    // P2: playState / pending right after play(); any event on play() / pause()?
    {
      const a = mk([{ opacity: 1 }, { opacity: 0.5 }], { duration: 300 });
      const seen = [];
      for (const t of ["finish", "cancel", "remove", "playstatechange"]) a.addEventListener(t, () => seen.push(t));
      out.P2_idleBefore = a.playState;
      a.play();
      out.P2_afterPlay = { playState: a.playState, pending: a.pending };
      await a.ready;
      out.P2_afterReady = { playState: a.playState, pending: a.pending };
      a.pause();
      out.P2_afterPause = { playState: a.playState, pending: a.pending };
      await sleep(30);
      out.P2_eventsAfterPlayPause = [...seen];
      a.cancel();
      await sleep(30);
      out.P2_eventsAfterCancel = [...seen];
    }

    // P3: play() after reverse() has finished: currentTime near 120 and falling = plays backward
    {
      const a = mk([{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
      a.play();
      await a.finished;
      a.reverse();
      await a.finished;
      const rateAfterReverse = a.playbackRate;
      a.play();
      await sleep(20);
      out.P3_playAfterReverse = { rateAfterReverse, playbackRate: a.playbackRate, currentTime: Math.round(a.currentTime) };
      a.cancel();
    }

    // P4: reverse() on an idle infinite animation; P5: finish() on an infinite one
    {
      const a = mk([{ opacity: 1 }, { opacity: 0 }], { duration: 100, iterations: Infinity });
      try { a.reverse(); out.P4_reverseInfiniteIdle = "no throw, playState=" + a.playState; } catch (e) { out.P4_reverseInfiniteIdle = e.name; }
      a.cancel();
      const b = mk([{ opacity: 1 }, { opacity: 0 }], { duration: 100, iterations: Infinity });
      b.play();
      try { b.finish(); out.P5_finishInfinite = "no throw"; } catch (e) { out.P5_finishInfinite = e.name; }
      b.cancel();
    }

    // P6: fill:forwards against a later inline style write (the style.* binding seam)
    {
      const a = mk([{ opacity: 1 }, { opacity: 0.2 }], { duration: 50, fill: "forwards" });
      a.play();
      await a.finished;
      card.style.opacity = "1";
      out.P6_inlineAfterFill = { inline: card.style.opacity, computed: getComputedStyle(card).opacity, playState: a.playState };
      a.cancel();
      card.style.opacity = "";
    }

    // P7: updateTiming() on a finished (forwards) animation
    {
      const a = mk([{ opacity: 1 }, { opacity: 0.5 }], { duration: 50, fill: "forwards" });
      const seen = [];
      for (const t of ["finish", "cancel", "remove"]) a.addEventListener(t, () => seen.push(t));
      a.play();
      await a.finished;
      await sleep(10);
      const before = a.playState;
      seen.length = 0;
      a.effect.updateTiming({ duration: 500 });
      out.P7_updateTimingOnFinished = { before, after: a.playState, events: [...seen] };
      a.cancel();
    }

    // P8: auto-removal of a replaced filling animation, then play() it again
    {
      const a = mk([{ transform: "scale(1)" }, { transform: "scale(1.2)" }], { duration: 40, fill: "forwards" });
      const b = mk([{ transform: "scale(1)" }, { transform: "scale(1.5)" }], { duration: 40, fill: "forwards" });
      const seen = [];
      a.addEventListener("remove", () => seen.push("a:remove"));
      a.play();
      await a.finished;
      b.play();
      await b.finished;
      await sleep(50);
      out.P8_autoRemove = { events: [...seen], aPlayState: a.playState, aReplaceState: a.replaceState };
      a.play();
      await sleep(10);
      out.P8_afterReplay = { aPlayState: a.playState, aReplaceState: a.replaceState };
      a.cancel(); b.cancel();
    }

    // P9: target removed from the document while running
    {
      const el = document.getElementById("b");
      const a = mk([{ opacity: 1 }, { opacity: 0 }], { duration: 80 }, el);
      let fin = false;
      a.addEventListener("finish", () => { fin = true; });
      a.play();
      el.remove();
      await sleep(10);
      const mid = a.playState;
      await sleep(150);
      out.P9_detachedTarget = { playStateWhileDetached: mid, finishFired: fin, finalPlayState: a.playState };
      document.body.append(el);
    }

    // P10: keyframes given as a Proxy (a reactive store's array)
    {
      const prox = new Proxy([{ opacity: 1 }, { opacity: 0 }], {});
      try { out.P10_proxyKeyframes = mk(prox, { duration: 10 }).effect.getKeyframes().length; } catch (e) { out.P10_proxyKeyframes = e.name; }
    }

    // P11: no timeline argument -> document.timeline
    out.P11_defaultTimelineIsDocument = new Animation(new KeyframeEffect(card, [{ opacity: 1 }], { duration: 10 })).timeline === document.timeline;

    // P12: pause() on an idle animation
    {
      const a = mk([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      a.pause();
      await a.ready;
      out.P12_pauseIdle = { playState: a.playState, currentTime: a.currentTime, computedOpacity: getComputedStyle(card).opacity };
      a.cancel();
    }

    // P13: cancel() on an idle animation
    {
      const a = mk([{ opacity: 1 }], { duration: 10 });
      let c = 0;
      a.addEventListener("cancel", () => c++);
      a.cancel();
      await sleep(20);
      out.P13_cancelIdleEvents = c;
    }

    // P14: play() on a running animation
    {
      const a = mk([{ opacity: 1 }, { opacity: 0 }], { duration: 400 });
      a.play();
      await sleep(120);
      const t1 = a.currentTime;
      a.play();
      out.P14_playWhileRunning = { before: Math.round(t1), after: Math.round(a.currentTime) };
      a.cancel();
    }

    // P15: invalid keyframes / timing
    try { new KeyframeEffect(card, [{ offset: 0.8, opacity: 1 }, { offset: 0.2, opacity: 0 }], { duration: 10 }); out.P15_badOffsets = "no throw"; } catch (e) { out.P15_badOffsets = e.name; }
    try { new KeyframeEffect(card, [{ opacity: 1 }], { duration: -1 }); out.P15_negativeDuration = "no throw"; } catch (e) { out.P15_negativeDuration = e.name; }

    // P16: finish(): playState at once, the event later
    {
      const a = mk([{ opacity: 1 }, { opacity: 0 }], { duration: 60 });
      let stateAtEvent = null;
      a.addEventListener("finish", () => { stateAtEvent = a.playState; });
      a.play();
      a.finish();
      out.P16_finishSync = { playStateRightAfterFinish: a.playState, eventFiredSynchronously: stateAtEvent !== null };
      await sleep(30);
      out.P16_finishEventLater = { stateAtEvent };
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
    const r = await probes(page);
    console.log(`=== ${name} ${browser.version()}`);
    for (const [k, v] of Object.entries(r)) console.log(k.padEnd(30), JSON.stringify(v));
  } finally {
    await browser.close();
  }
}
