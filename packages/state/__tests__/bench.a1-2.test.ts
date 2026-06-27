/**
 * bench.a1-2.test.ts — A1-2 computed 同値短絡の節約量計測 + 正当性プローブ。
 *
 * 目的:
 *  (1) 深い getter チェーン（n→tens→label→caption・中間が安定）で、computed 短絡が
 *      下流再計算をどれだけ省くか（=同値ガードと合算した coarse proxy の上限）を計測。
 *  (2) 線形チェーン・ダイヤモンドで最終 DOM 値が正しいか（eager 短絡のグリッチ実害）を検証。
 * 実行: npx vitest run __tests__/bench.a1-2.test.ts
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

let seq = 0;

async function mountChain() {
  const host = document.createElement(`a12-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <div data-wcs="textContent: caption"></div>
    <wcs-state></wcs-state>
  `;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState({
    n: 0,
    get tens(this: any) {
      return Math.floor(this.n / 10);
    },
    get label(this: any) {
      return "T" + this.tens;
    },
    get caption(this: any) {
      return "[" + this.label + "]";
    },
  });
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  const captionNode = shadowRoot.querySelector("div")!;
  return { host, shadowRoot, stateElement, captionNode };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const flush = () => new Promise((r) => setTimeout(r));

const M = 20000;

// n を 1 ずつ増やす。tens/label/caption は 10 回に 1 回しか変わらない＝短絡が 9/10 枝刈り。
async function measureChain(
  guard: boolean,
  sc: boolean,
  repeats = 7,
): Promise<{ ms: number; prunes: number; proceeds: number }> {
  const { host, stateElement } = await mountChain();
  setConfig({ sameValueGuard: guard });
  benchFlags.computedShortCircuit = sc;
  let k = 0;
  // warm
  for (let w = 0; w < 4; w++) {
    stateElement.createState("writable", (s: any) => {
      for (let i = 0; i < M; i++) s.n = k++;
    });
    await flush();
  }
  resetBenchCounters();
  const samples: number[] = [];
  for (let r = 0; r < repeats; r++) {
    const t0 = performance.now();
    stateElement.createState("writable", (s: any) => {
      for (let i = 0; i < M; i++) s.n = k++;
    });
    samples.push(performance.now() - t0);
    await flush();
  }
  setConfig({ sameValueGuard: false });
  benchFlags.computedShortCircuit = false;
  host.remove();
  return { ms: median(samples), prunes: benchCounters.shortCircuitPrunes, proceeds: benchCounters.shortCircuitProceeds };
}

describe("A1-2 computed 同値短絡: 節約量 + 正当性", () => {
  it("深いチェーンで4構成を計測（短絡が下流再計算をどれだけ省くか）", async () => {
    const off = await measureChain(false, false);
    const guard = await measureChain(true, false);
    const sc = await measureChain(false, true);
    const both = await measureChain(true, true);
    const rows = [
      "config".padEnd(28) + "ms".padStart(9) + "Δ vs off".padStart(10) + "prunes".padStart(10) + "proceeds".padStart(10),
      "off (baseline)".padEnd(28) + off.ms.toFixed(3).padStart(9) + "—".padStart(10) + "0".padStart(10) + "0".padStart(10),
      ...[
        ["sameValueGuard only", guard],
        ["computedShortCircuit only", sc],
        ["both", both],
      ].map(([name, r]: any) => {
        const d = ((r.ms - off.ms) / off.ms) * 100;
        return (
          (name as string).padEnd(28) +
          r.ms.toFixed(3).padStart(9) +
          ((d >= 0 ? "+" : "") + d.toFixed(1)).padStart(10) +
          String(r.prunes).padStart(10) +
          String(r.proceeds).padStart(10)
        );
      }),
    ];
    // eslint-disable-next-line no-console
    console.log("\n===== A1-2 deep-chain (n→tens→label→caption, n+=1 ×" + M + ") =====\n" + rows.join("\n") + "\n");
    expect(off.ms).toBeGreaterThan(0);
  }, 120000);

  it("正当性: 線形チェーンの最終DOM値が短絡ONでも正しい", async () => {
    const { host, stateElement, captionNode } = await mountChain();
    benchFlags.computedShortCircuit = true;
    for (let n = 0; n <= 35; n++) {
      stateElement.createState("writable", (s: any) => { s.n = n; });
    }
    await flush();
    benchFlags.computedShortCircuit = false;
    // n=35 → tens=3 → label="T3" → caption="[T3]"
    expect(captionNode.textContent).toBe("[T3]");
    host.remove();
  });

  it("正当性: ダイヤモンド依存(r=p+q, p=x, q=2x)の最終DOM値が短絡ONでも正しい", async () => {
    const host = document.createElement(`a12-diamond-${seq++}`);
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<div data-wcs="textContent: r"></div><wcs-state></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({
      x: 1,
      get p(this: any) { return this.x; },
      get q(this: any) { return this.x * 2; },
      get r(this: any) { return this.p + this.q; }, // = 3x
    });
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    const stateElement = getStateElementByName(shadowRoot, "default")!;
    const rNode = shadowRoot.querySelector("div")!;
    benchFlags.computedShortCircuit = true;
    for (const x of [2, 3, 7, 10, 4]) {
      stateElement.createState("writable", (s: any) => { s.x = x; });
      await flush();
    }
    benchFlags.computedShortCircuit = false;
    // x=4 → r=12
    expect(rNode.textContent).toBe("12");
    host.remove();
  });
});
