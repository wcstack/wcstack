/**
 * audit.sameValueGuard.test.ts — A1-1 同値ガードのプロファイル + 互換監査。
 *
 * (1) プロファイル: 実 example 相当のワークロードで「同値書き込み比率」を計測。
 *     損益分岐 ≈16〜20%（Gate0）を実ワークロードが超えるかを見る。
 * (2) 互換監査: 同値時に $updatedCallback が「ガードON で発火しない／OFF で発火する」
 *     という契約変化を特性化テストとして固定する（data-fetch e2e の唯一の依存箇所）。
 * 実行: npx vitest run __tests__/audit.sameValueGuard.test.ts
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
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML = `<wcs-state></wcs-state>`) {
  const host = document.createElement(`audit-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML.includes("wcs-state") ? innerHTML : innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElementByName(shadowRoot, "default")!;
  return { host, shadowRoot, stateElement };
}

function ratio(skips: number, proceeds: number): string {
  const total = skips + proceeds;
  return total === 0 ? "—" : ((skips / total) * 100).toFixed(1) + "%";
}

describe("A1-1 同値ガード: プロファイル", () => {
  it("実 example 相当ワークロードの同値書き込み比率を計測", async () => {
    const rows: string[] = ["workload".padEnd(40) + "skips".padStart(8) + "proceeds".padStart(10) + "same-value%".padStart(13)];

    // W1: Todo bulk ops（50件・done boolean）。markAll → 再markAll（全同値）→ 個別toggle → markAll。
    {
      const items = Array.from({ length: 50 }, (_, i) => ({ id: i, done: false }));
      const { host, stateElement } = await mount(
        { items },
        `<ul><template data-wcs="for: items"><li data-wcs="textContent: .done"></li></template></ul><wcs-state></wcs-state>`,
      );
      setConfig({ sameValueGuard: true });
      resetBenchCounters();
      const set = (fn: (s: any) => void) => stateElement.createState("writable", fn);
      set((s) => { for (let i = 0; i < 50; i++) s["items." + i + ".done"] = true; });   // 50 changed
      set((s) => { for (let i = 0; i < 50; i++) s["items." + i + ".done"] = true; });   // 50 same
      set((s) => { for (let i = 0; i < 50; i += 5) s["items." + i + ".done"] = false; }); // 10 changed
      set((s) => { for (let i = 0; i < 50; i++) s["items." + i + ".done"] = true; });   // 10 changed + 40 same
      setConfig({ sameValueGuard: false });
      host.remove();
      rows.push("W1 Todo bulk (markAll/toggle)".padEnd(40) + String(benchCounters.guardSkips).padStart(8) + String(benchCounters.guardProceeds).padStart(10) + ratio(benchCounters.guardSkips, benchCounters.guardProceeds).padStart(13));
    }

    // W2: 冪等 re-set（fetch 応答マージ / フォームリセット）。record の全フィールドを現在値で20回再代入。
    {
      const { host, stateElement } = await mount({ name: "Ada", age: 36, city: "London", active: true, score: 100 });
      setConfig({ sameValueGuard: true });
      resetBenchCounters();
      const set = (fn: (s: any) => void) => stateElement.createState("writable", fn);
      for (let r = 0; r < 20; r++) {
        set((s) => { s.name = "Ada"; s.age = 36; s.city = "London"; s.active = true; s.score = 100; }); // all same
      }
      set((s) => { s.age = 37; s.score = 110; }); // 2 changed
      setConfig({ sameValueGuard: false });
      host.remove();
      rows.push("W2 冪等 re-set (fetch merge)".padEnd(40) + String(benchCounters.guardSkips).padStart(8) + String(benchCounters.guardProceeds).padStart(10) + ratio(benchCounters.guardSkips, benchCounters.guardProceeds).padStart(13));
    }

    // W3: 変更主体（カウンタ増加・クエリ変更）。同値ほぼ無し。
    {
      const { host, stateElement } = await mount({ count: 0, query: "" });
      setConfig({ sameValueGuard: true });
      resetBenchCounters();
      const set = (fn: (s: any) => void) => stateElement.createState("writable", fn);
      for (let i = 0; i < 50; i++) set((s) => { s.count = i + 1; });
      for (const q of "searching for something".split("")) set((s) => { s.query = (s.query || "") + q; });
      setConfig({ sameValueGuard: false });
      host.remove();
      rows.push("W3 変更主体 (counter/typing)".padEnd(40) + String(benchCounters.guardSkips).padStart(8) + String(benchCounters.guardProceeds).padStart(10) + ratio(benchCounters.guardSkips, benchCounters.guardProceeds).padStart(13));
    }

    // eslint-disable-next-line no-console
    console.log("\n===== A1-1 same-value 比率（損益分岐 ≈16〜20%）=====\n" + rows.join("\n") + "\n");
    expect(rows.length).toBe(4);
  }, 60000);
});

describe("A1-1 同値ガード: 互換監査（契約変化の特性化）", () => {
  it("同値 set: ガードOFF では $updatedCallback が発火し、ON では発火しない", async () => {
    const calls: string[][] = [];
    const initial = {
      branch: "main",
      $updatedCallback(paths: string[]) { calls.push(paths); },
    };

    const innerHTML = `<div data-wcs="textContent: branch"></div><wcs-state></wcs-state>`;
    // OFF: 同値 set でも $updatedCallback が発火（現行挙動）
    {
      const { host, stateElement } = await mount({ ...initial }, innerHTML);
      setConfig({ sameValueGuard: false });
      calls.length = 0;
      stateElement.createState("writable", (s: any) => { s.branch = "main"; }); // 同値
      await flush();
      expect(calls.length).toBeGreaterThan(0); // 現行: 同値でも発火
      host.remove();
    }

    // ON: 同値 set では $updatedCallback が発火しない（ガードの契約変化）
    {
      const { host, stateElement } = await mount({ ...initial }, innerHTML);
      setConfig({ sameValueGuard: true });
      calls.length = 0;
      stateElement.createState("writable", (s: any) => { s.branch = "main"; }); // 同値
      await flush();
      expect(calls.length).toBe(0); // ガードON: 同値は no-op
      // 値変更時は ON でも発火する（回帰なし）
      stateElement.createState("writable", (s: any) => { s.branch = "dev"; });
      await flush();
      expect(calls.length).toBeGreaterThan(0);
      setConfig({ sameValueGuard: false });
      host.remove();
    }
  });
});
