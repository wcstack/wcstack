/**
 * bench.gate0.test.ts — Gate 0 council experiment.
 *
 * 評議会 性能審の仮説1「同値ガード(same-value guard)の単独効果を coarse のまま測れ。
 * fine-grained と差が出なければ cell 化投資は不要」を、実マウントで実測する。
 *
 * 計測対象: setByAddress の同期コスト（walkDependency + enqueue）。
 * 同値ガードは primitive のみ・Object.is 比較・参照型は素通し（_bench.ts のフラグで toggle）。
 * 実行: npx vitest run __tests__/bench.gate0.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import { benchFlags, benchCounters, resetBenchCounters } from "../src/_bench";
import { setConfig } from "../src/config";

beforeAll(() => {
  bootstrapState();
  benchFlags.profile = true; // 計測用にカウンタ更新を有効化
});

const ROWS = 300;

let hostSeq = 0;

async function mount() {
  const host = document.createElement(`bench-host-${hostSeq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <div data-wcs="textContent: count"></div>
    <div data-wcs="textContent: doubled"></div>
    <ul>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .label"></li>
        <span data-wcs="textContent: .tax"></span>
      </template>
    </ul>
    <wcs-state></wcs-state>
  `;
  document.body.appendChild(host);
  const items: { id: number; label: string; price: number }[] = [];
  for (let i = 0; i < ROWS; i++) items.push({ id: i, label: "row" + i, price: 100 });
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState({
    count: 0,
    get doubled(this: any) {
      return this.count * 2;
    },
    items,
    get "items.*.tax"(this: any) {
      return this["items.*.price"] * 0.1;
    },
  });
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const flush = () => new Promise((r) => setTimeout(r));

/**
 * 1プロファイルを OFF/ON 交互に計測する（JIT 順序バイアス除去）。
 * off/on で別マウントを使い、各 repeat で OFF→ON を交互実行。先に両モードを
 * グローバルウォームアップしてから本計測。
 */
async function measure(
  workload: (state: any, r: number) => void,
  repeats = 7,
): Promise<{ offMs: number; onMs: number; skips: number; proceeds: number }> {
  const off = await mount();
  const on = await mount();
  // global warm-up: 両モードを十分回して JIT を温める（計測対象外）
  for (let w = 0; w < 4; w++) {
    setConfig({ sameValueGuard: false });
    off.stateElement.createState("writable", (s: any) => workload(s, -1));
    await flush();
    setConfig({ sameValueGuard: true });
    on.stateElement.createState("writable", (s: any) => workload(s, -1));
    await flush();
  }
  resetBenchCounters();
  const offSamples: number[] = [];
  const onSamples: number[] = [];
  for (let r = 0; r < repeats; r++) {
    setConfig({ sameValueGuard: false });
    let t0 = performance.now();
    off.stateElement.createState("writable", (s: any) => workload(s, r));
    offSamples.push(performance.now() - t0);
    await flush();

    setConfig({ sameValueGuard: true });
    t0 = performance.now();
    on.stateElement.createState("writable", (s: any) => workload(s, r));
    onSamples.push(performance.now() - t0);
    await flush();
  }
  setConfig({ sameValueGuard: false });
  off.host.remove();
  on.host.remove();
  return {
    offMs: median(offSamples),
    onMs: median(onSamples),
    skips: benchCounters.guardSkips,
    proceeds: benchCounters.guardProceeds,
  };
}

const M = 20000; // 高頻度スカラ更新回数
const EVERY10 = Math.floor(ROWS / 10); // list 更新対象数

const profiles: { name: string; workload: (s: any, r: number) => void }[] = [
  {
    name: "P1a scalar same-value (count=7 ×M)",
    workload: (s) => {
      for (let i = 0; i < M; i++) s.count = 7;
    },
  },
  {
    name: "P1b scalar changing  (count=i ×M)",
    workload: (s, r) => {
      for (let i = 0; i < M; i++) s.count = i + r * M;
    },
  },
  {
    name: "P2 list changing     (price=100+r every10th)",
    workload: (s, r) => {
      for (let i = 0; i < ROWS; i += 10) s["items." + i + ".price"] = 100 + r + 1;
    },
  },
  {
    name: "P3 list same-value   (price=100 every10th)",
    workload: (s) => {
      for (let i = 0; i < ROWS; i += 10) s["items." + i + ".price"] = 100;
    },
  },
];

describe("Gate0: same-value guard 実測", () => {
  it("OFF/ON を実マウントで比較し結果を出力する", async () => {
    const rows: string[] = [];
    rows.push(
      "profile".padEnd(46) +
        "OFF(ms)".padStart(10) +
        "ON(ms)".padStart(10) +
        "Δ%".padStart(8) +
        "skips".padStart(9) +
        "proceeds".padStart(10),
    );
    for (const p of profiles) {
      const res = await measure(p.workload);
      const delta = ((res.onMs - res.offMs) / res.offMs) * 100;
      rows.push(
        p.name.padEnd(46) +
          res.offMs.toFixed(3).padStart(10) +
          res.onMs.toFixed(3).padStart(10) +
          (delta >= 0 ? "+" : "") +
          delta.toFixed(1).padStart(7) +
          String(res.skips).padStart(9) +
          String(res.proceeds).padStart(10),
      );
    }
    // eslint-disable-next-line no-console
    console.log("\n===== Gate0 same-value guard bench (ROWS=" + ROWS + ", M=" + M + ") =====\n" + rows.join("\n") + "\n");
    expect(EVERY10).toBeGreaterThan(0);
  }, 120000);
});
