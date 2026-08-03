/**
 * integration.diamondDiscriminator.test.ts — 無効化順序の判別テスト。
 *
 * 「ダイヤモンドの腕の長さが不揃い」なケースを集める。BFS レベル単位でしか
 * 順序を整えない実装は、短い腕から到達した合流点を長い腕がまだ dirty 化する前に
 * 評価してしまうため、ここで落ちる。パス単位のトポロジカル順は落ちない。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`disc-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateElement: getStateElementByName(shadowRoot, "default")! };
}

const GRID = `<div><template data-wcs="for: weeks">` +
  `<div class="week"><template data-wcs="for: weeks.*.days">` +
  `<span class="day">{{ .text }}</span></template></div>` +
  `</template></div>`;
const weekCount = (sr: ShadowRoot) => sr.querySelectorAll(".week").length;
const grid = (sr: ShadowRoot) => Array.from(sr.querySelectorAll(".week")).map(w =>
  Array.from(w.querySelectorAll(".day")).map(d => d.textContent));

describe("腕の長さが不揃いなダイヤモンド", () => {
  it("短腕 1 ホップ / 長腕 4 ホップの合流点でリスト長が正しく決まること", async () => {
    // n ─────────────────────────────► shortArm ─┐
    //  └─ h1 ─► h2 ─► h3 ─► longArm ─────────────┴─► len ─► weeks
    // 短腕経由で len に到達した時点では h1..longArm はまだ dirty 化されていない。
    const { host, shadowRoot, stateElement } = await mount({
      n: 2,
      get shortArm(this: any) { return this.n; },
      get h1(this: any) { return this.n + 1; },
      get h2(this: any) { return this.h1 + 1; },
      get h3(this: any) { return this.h2 + 1; },
      get longArm(this: any) { return this.h3 + 1; },
      // 合流点。短腕だけ新しい中間状態では値がずれる
      get len(this: any) { return this.shortArm + this.longArm; },
      get weeks(this: any) { return Array.from({ length: this.len }, (_, w) => w); },
      get "weeks.*.days"(this: any) { return [0, 1]; },
      get "weeks.*.days.*.text"(this: any) { return `${this.len}:${this.$1}-${this.$2}`; },
    }, GRID);

    // n=2 → shortArm=2, longArm=2+4=6, len=8
    expect(weekCount(shadowRoot)).toBe(8);

    for (const n of [5, 3, 7, 1]) {
      stateElement.createState("writable", (s: any) => { s.n = n; });
      await flush();
      const len = n + (n + 4);
      expect(weekCount(shadowRoot), `n=${n} の行数`).toBe(len);
      expect(grid(shadowRoot), `n=${n} のセル`).toEqual(
        Array.from({ length: len }, (_, i) => [0, 1].map(d => `${len}:${i}-${d}`)));
    }
    host.remove();
  });

  it("行の getter が不揃いダイヤモンドの両腕を読んでも古い値が残らないこと", async () => {
    const { host, shadowRoot, stateElement } = await mount({
      n: 2,
      get shortArm(this: any) { return this.n; },
      get h1(this: any) { return this.n * 2; },
      get h2(this: any) { return this.h1 * 2; },
      get longArm(this: any) { return this.h2 * 2; },
      get len(this: any) { return this.shortArm; },
      get weeks(this: any) { return Array.from({ length: this.len }, (_, w) => w); },
      get "weeks.*.days"(this: any) { return [0, 1]; },
      // 短腕と長腕の両方を読む行 getter
      get "weeks.*.days.*.text"(this: any) {
        return `${this.shortArm}/${this.longArm}:${this.$1}-${this.$2}`;
      },
    }, GRID);

    for (const n of [4, 2, 5, 1, 3]) {
      stateElement.createState("writable", (s: any) => { s.n = n; });
      await flush();
      expect(grid(shadowRoot), `n=${n}`).toEqual(
        Array.from({ length: n }, (_, i) => [0, 1].map(d => `${n}/${n * 8}:${i}-${d}`)));
    }
    host.remove();
  });

  it("展開をまたぐダイヤモンド（行の値が合流点に戻る集約）でも整合すること", async () => {
    // n ─► rows ─► rows.* ─► rows.*.v ─(集約)─► total ─┐
    //  └───────────────────────────────────────────────┴─► weeks
    // 長腕がリスト展開を経由する = 合流点が「展開の向こう側」にある。
    const { host, shadowRoot, stateElement } = await mount({
      n: 2,
      rowsSource: [1, 2],
      get rows(this: any) { return this.rowsSource.map((v: number) => v * this.n); },
      get "rows.*.v"(this: any) { return this["rows.*"]; },
      get total(this: any) { return this.$getAll("rows.*.v", []).reduce((a: number, b: number) => a + b, 0); },
      get len(this: any) { return this.n + this.total; },
      get weeks(this: any) { return Array.from({ length: this.len }, (_, w) => w); },
      get "weeks.*.days"(this: any) { return [0]; },
      get "weeks.*.days.*.text"(this: any) { return `${this.len}:${this.$1}`; },
    }, `<div><template data-wcs="for: rows"><i class="r">{{ .v }}</i></template></div>` + GRID);

    // n=2 → rows=[2,4], total=6, len=8
    expect(weekCount(shadowRoot)).toBe(8);

    for (const n of [3, 1, 4]) {
      stateElement.createState("writable", (s: any) => { s.n = n; });
      await flush();
      const len = n + (1 * n + 2 * n);
      expect(weekCount(shadowRoot), `n=${n} の行数`).toBe(len);
      expect(grid(shadowRoot), `n=${n} のセル`).toEqual(
        Array.from({ length: len }, (_, i) => [`${len}:${i}`]));
    }
    host.remove();
  });
});
