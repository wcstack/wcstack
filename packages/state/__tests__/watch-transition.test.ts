import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { bootstrapState, getBindingsReady, installFeatures, temporal } from "../src/index";

// $watch and an arbiter that holds a structural pass for its transition (transition-runner protocol)
const flush = () => new Promise((r) => setTimeout(r, 0));
const RUNNER_KEY = Symbol.for("wcstack.transition-runner");
let seq = 0;

beforeAll(() => {
  installFeatures([temporal]);
  bootstrapState();
});

afterEach(() => {
  delete (globalThis as any)[RUNNER_KEY];
});

async function host(html: string, state: Record<string, any>) {
  const h = document.createElement(`watch-transition-test-${seq++}`);
  const root = h.attachShadow({ mode: "open" });
  root.innerHTML = html;
  const el = root.querySelector("wcs-state") as any;
  el.setInitialState(state);
  document.body.appendChild(h);
  await el.connectedCallbackPromise;
  await getBindingsReady(root);
  return { h, root, el };
}

/** A fake arbiter that holds every mutation until runDeferred(). */
function installRunner(_opts: { defer: true }) {
  const deferred: (() => void)[] = [];
  let runs = 0;
  (globalThis as any)[RUNNER_KEY] = {
    protocol: "wcs-transition-runner", version: 1, naming: "manual", namingLimit: 100,
    accepts: (source: string) => source === "state",
    run(mutate: () => void) { runs++; deferred.push(mutate); return Promise.resolve(); },
  };
  return { runDeferred: () => { for (const m of deferred.splice(0)) m(); }, runs: () => runs };
}

describe("$watch はアービターが遅らせた反映の後に走る（docs/seam-apps.md、city-library）", () => {
  it("構造の変わる更新では、$watch は反映を待つ — 走るときには束縛も分岐も反映されている", async () => {
    const { runDeferred } = installRunner({ defer: true });
    const seen: string[] = [];
    const { root, el } = await host(`<wcs-state></wcs-state><template data-wcs="if: on"><p>on</p></template><input data-wcs="value: name">`, {
      on: false, name: "a",
      $watch: { name(cur: string) { seen.push(`${cur}:${(root.querySelector("input") as HTMLInputElement).value}:${root.querySelector("p") ? "p" : "-"}`); } },
    });
    await el.createStateAsync("writable", async (s: any) => { s.on = true; s.name = "b"; });
    await flush();
    expect(seen).toEqual([]);
    runDeferred();
    await flush();
    expect(seen).toEqual(["b:b:p"]);
  });

  it("値だけの更新はその場で反映され、$watch もその場で走る", async () => {
    installRunner({ defer: true });
    const seen: string[] = [];
    const { root, el } = await host(`<wcs-state></wcs-state><input data-wcs="value: name">`, {
      name: "a",
      $watch: { name(cur: string) { seen.push(`${cur}:${(root.querySelector("input") as HTMLInputElement).value}`); } },
    });
    await el.createStateAsync("writable", async (s: any) => { s.name = "b"; });
    await flush();
    expect(seen).toEqual(["b:b"]);
  });

  it("保留の間に値だけのドレインがあっても、$watch は最後の保留が反映されるまで待つ", async () => {
    const { runDeferred } = installRunner({ defer: true });
    const seen: string[] = [];
    const { root, el } = await host(`<wcs-state></wcs-state><template data-wcs="if: on"><p>on</p></template><input data-wcs="value: name">`, {
      on: false, name: "a", count: 0,
      $watch: {
        name(cur: string) { seen.push(`name ${cur}:${root.querySelector("p") ? "p" : "-"}`); },
        count(cur: number) { seen.push(`count ${cur}`); },
      },
    });
    await el.createStateAsync("writable", async (s: any) => { s.on = true; s.name = "b"; });
    await flush();
    await el.createStateAsync("writable", async (s: any) => { s.count = 1; });
    await flush();
    expect(seen).toEqual([]);
    runDeferred();
    await flush();
    expect(seen).toEqual(["name b:p", "count 1"]);
  });

  it("$watch が反映の後に書いた構造の変化は、同じ反映の中で当てる — 読み込み中が消えて前の行が残るフレームを作らない（router-admin）", async () => {
    const { runDeferred, runs } = installRunner({ defer: true });
    const { root, el } = await host(`<wcs-state></wcs-state><template data-wcs="if: loading"><p class="loading">…</p></template><ul><template data-wcs="for: rows"><li data-wcs="textContent: .name"></li></template></ul>`, {
      loading: true, list: null, rows: [{ name: "old" }],
      $watch: { list(this: any, cur: any) { if (cur) this.rows = cur.items; } },
    });
    const before = runs();
    await el.createStateAsync("writable", async (s: any) => { s.loading = false; s.list = { items: [{ name: "x" }, { name: "y" }] }; });
    await flush();
    expect(root.querySelector(".loading")).not.toBeNull();
    runDeferred();
    // 同期的に、同じ反映の中で — 読み込み中が消えたときには行も新しい
    expect(root.querySelector(".loading")).toBeNull();
    expect([...root.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["x", "y"]);
    await flush();
    expect(runs() - before).toBe(1);
  });

  it("反映の中で当てる $watch の書き込みが自分を書き続けても、連鎖の上限で止まる", async () => {
    const { runDeferred } = installRunner({ defer: true });
    let fired = 0;
    const { el } = await host(`<wcs-state></wcs-state><template data-wcs="if: on"><p>on</p></template><ul><template data-wcs="for: rows"><li data-wcs="textContent: .n"></li></template></ul>`, {
      on: false, rows: [],
      $watch: { rows(this: any, cur: any[]) { fired++; this.rows = [...cur, { n: cur.length }]; } },
    });
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener("error", onError);
    const warn = console.error;
    console.error = () => {};
    try {
      await el.createStateAsync("writable", async (s: any) => { s.on = true; s.rows = [{ n: 0 }]; });
      await flush();
      runDeferred();
      for (let i = 0; i < 5; i++) { runDeferred(); await flush(); }
    } finally {
      window.removeEventListener("error", onError);
      console.error = warn;
    }
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(1000);
  });
});
