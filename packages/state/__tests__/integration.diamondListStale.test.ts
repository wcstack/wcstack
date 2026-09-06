/**
 * integration.diamondListStale.test.ts — ダイヤモンド依存を持つ computed リストの
 * 更新契約。
 *
 * `for:` の対象が computed getter で、その値が「共通の源を持つ兄弟 getter 2 本」
 * （ダイヤモンド）経由で決まり、かつリスト内側の getter がその両腕を読むとき、
 * 外側 for が 1 更新ぶん遅れて描画される欠陥の回帰テスト。
 *
 * 機構: walkDependency は list → list.* を展開するためにウォーク途中でリスト実体を
 * 読む（walkDependency.ts の静的子展開）。ダイヤモンドでは DFS が片腕を先に降り、
 * もう一方の腕がまだ clean（＝古い値）のまま list / 中間 getter のキャッシュが
 * 再確定される。その後もう一方の腕が中間 getter を dirty にし直しても、list は既に
 * visited なので callback が再度走らず clean のまま残り、apply 段階で古い配列が使われる。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`diamond-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateElement: getStateElement(shadowRoot)! };
}

// 内側 for を持つグリッド。happy-dom は table 内の <template> を foster-parent して
// しまうため、テーブルではなく div で同じ構造を組む（実ブラウザ側は e2e で担保）。
const GRID = `<div><template data-wcs="for: weeks">` +
  `<div class="week"><template data-wcs="for: weeks.*.days">` +
  `<span class="day">{{ .text }}</span></template></div>` +
  `</template></div>`;

const weekCount = (sr: ShadowRoot) => sr.querySelectorAll(".week").length;
const grid = (sr: ShadowRoot) => Array.from(sr.querySelectorAll(".week")).map(w =>
  Array.from(w.querySelectorAll(".day")).map(d => d.textContent!.trim() || "."));

/** 2026 年の各月の週数: 8月=6, 7月=5, 6月=5, 5月=6, 2月=4, 3月=5 */
const MONTHS = [7, 6, 5, 2, 3] as const;
const WEEKS = [6, 5, 5, 6, 4, 5];

function expectedGrid(year: number, month: number): string[][] {
  const offset = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  const rows = Math.ceil((offset + lastDate) / 7);
  return Array.from({ length: rows }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = w * 7 + d - offset + 1;
      return date >= 1 && date <= lastDate ? String(date) : ".";
    }));
}

/** 中間値を兄弟 getter 2 本に分ける（ダイヤモンド）カレンダー */
function diamondCalendar(): any {
  return {
    year: 2026,
    month: 8,
    get offset(this: any) { return new Date(this.year, this.month - 1, 1).getDay(); },
    get lastDate(this: any) { return new Date(this.year, this.month, 0).getDate(); },
    get weekCount(this: any) { return Math.ceil((this.offset + this.lastDate) / 7); },
    get weeks(this: any) { return Array.from({ length: this.weekCount }, (_, w) => w); },
    get "weeks.*.days"(this: any) { return Array.from({ length: 7 }, (_, d) => d); },
    // 両腕（offset と lastDate）を読むセル getter
    get "weeks.*.days.*.text"(this: any) {
      const date = this.$1 * 7 + this.$2 - this.offset + 1;
      return (date >= 1 && date <= this.lastDate) ? String(date) : "";
    },
  };
}

/** 中間値を 1 本の record に畳んだ（単一チェーン）カレンダー */
function chainCalendar(): any {
  return {
    year: 2026,
    month: 8,
    get geometry(this: any) {
      const offset = new Date(this.year, this.month - 1, 1).getDay();
      const lastDate = new Date(this.year, this.month, 0).getDate();
      return { offset, lastDate, weekCount: Math.ceil((offset + lastDate) / 7) };
    },
    get weeks(this: any) { return Array.from({ length: this.geometry.weekCount }, (_, w) => w); },
    get "weeks.*.days"(this: any) { return Array.from({ length: 7 }, (_, d) => d); },
    get "weeks.*.days.*.text"(this: any) {
      const { offset, lastDate } = this.geometry;
      const date = this.$1 * 7 + this.$2 - offset + 1;
      return (date >= 1 && date <= lastDate) ? String(date) : "";
    },
  };
}

describe("ダイヤモンド依存を持つ computed リスト", () => {
  it("兄弟 getter 2 本経由でも、月移動のたびに行数と各セルが追随すること", async () => {
    const { host, shadowRoot, stateElement } = await mount(diamondCalendar(), GRID);
    expect(weekCount(shadowRoot), "2026-08").toBe(6);
    expect(grid(shadowRoot)).toEqual(expectedGrid(2026, 8));

    for (let i = 0; i < MONTHS.length; i++) {
      const month = MONTHS[i];
      stateElement.createState("writable", (s: any) => { s.month = month; });
      await flush();
      expect(weekCount(shadowRoot), `2026-${month} の週数`).toBe(WEEKS[i + 1]);
      expect(grid(shadowRoot), `2026-${month} のセル`).toEqual(expectedGrid(2026, month));
    }
    host.remove();
  });

  it("中間 getter を 1 本にまとめた単一チェーンでも同じ結果になること", async () => {
    const { host, shadowRoot, stateElement } = await mount(chainCalendar(), GRID);
    expect(weekCount(shadowRoot), "2026-08").toBe(6);
    expect(grid(shadowRoot)).toEqual(expectedGrid(2026, 8));

    for (let i = 0; i < MONTHS.length; i++) {
      const month = MONTHS[i];
      stateElement.createState("writable", (s: any) => { s.month = month; });
      await flush();
      expect(weekCount(shadowRoot), `2026-${month} の週数`).toBe(WEEKS[i + 1]);
      expect(grid(shadowRoot), `2026-${month} のセル`).toEqual(expectedGrid(2026, month));
    }
    host.remove();
  });

  it("並べ替え（長さ不変・順序変化）でも各行のセル値が古いまま残らないこと", async () => {
    // 行数が変わらないケース。修正前は行数ではなくセル値が古いまま残った
    // （bias が新しいのに rows.* の値が旧リスト由来のまま）。
    const { host, shadowRoot, stateElement } = await mount({
      seed: 0,
      // ダイヤモンド: seed -> order / bias -> weeks
      get order(this: any) { return this.seed === 0 ? [10, 20, 30] : [30, 10, 20]; },
      get bias(this: any) { return this.seed * 100; },
      get weeks(this: any) { return this.order.map((v: number) => v + this.bias); },
      get "weeks.*.days"(this: any) { return [0, 1]; },
      // 両腕（order 由来の行値と bias）を読むセル getter
      get "weeks.*.days.*.text"(this: any) { return `${this["weeks.*"]}/${this.bias}#${this.$2}`; },
    }, GRID);

    expect(grid(shadowRoot)).toEqual([
      ["10/0#0", "10/0#1"], ["20/0#0", "20/0#1"], ["30/0#0", "30/0#1"],
    ]);

    stateElement.createState("writable", (s: any) => { s.seed = 1; });
    await flush();
    expect(grid(shadowRoot)).toEqual([
      ["130/100#0", "130/100#1"], ["110/100#0", "110/100#1"], ["120/100#0", "120/100#1"],
    ]);
    host.remove();
  });

  it("縮小と拡大を繰り返しても既存行のセルが古いまま残らないこと", async () => {
    const { host, shadowRoot, stateElement } = await mount({
      n: 3,
      get lenArm(this: any) { return this.n; },
      get valueArm(this: any) { return this.n * 10; },
      get weeks(this: any) { return Array.from({ length: this.lenArm }, (_, i) => i); },
      get "weeks.*.days"(this: any) { return [0, 1]; },
      get "weeks.*.days.*.text"(this: any) {
        return `${this.lenArm}:${this.valueArm}:${this.$1}-${this.$2}`;
      },
    }, GRID);

    for (const n of [5, 2, 6, 0, 1, 4]) {
      stateElement.createState("writable", (s: any) => { s.n = n; });
      await flush();
      expect(grid(shadowRoot), `n=${n}`).toEqual(
        Array.from({ length: n }, (_, i) => [0, 1].map(d => `${n}:${n * 10}:${i}-${d}`)));
    }
    host.remove();
  });

  it("1 バッチ内で複数 set しても（年跨ぎの year/month 同時更新）整合すること", async () => {
    const { host, shadowRoot, stateElement } = await mount({
      year: 2026,
      month: 1,
      get offset(this: any) { return new Date(this.year, this.month - 1, 1).getDay(); },
      get lastDate(this: any) { return new Date(this.year, this.month, 0).getDate(); },
      get weeks(this: any) {
        return Array.from({ length: Math.ceil((this.offset + this.lastDate) / 7) }, (_, w) => w);
      },
      get "weeks.*.days"(this: any) { return [0, 1]; },
      get "weeks.*.days.*.text"(this: any) { return `${this.offset}/${this.lastDate}`; },
      prevMonth(this: any) {
        if (this.month === 1) { this.year -= 1; this.month = 12; } else { this.month -= 1; }
      },
    }, GRID);

    // 2026-01 -> 2025-12: year と month を同一バッチで 2 回 set する。
    // ウォーク 1 回目（year）の時点で month はまだ旧値という中間状態を通る。
    stateElement.createState("writable", (s: any) => { s.prevMonth(); });
    await flush();

    const offset = new Date(2025, 11, 1).getDay();
    const lastDate = new Date(2025, 12, 0).getDate();
    const rows = Math.ceil((offset + lastDate) / 7);
    expect(grid(shadowRoot)).toEqual(
      Array.from({ length: rows }, () => [`${offset}/${lastDate}`, `${offset}/${lastDate}`]));
    host.remove();
  });

  it("リスト getter の再評価回数が行数に比例して増えないこと", async () => {
    // 揮発読みによりウォーク中の確定を抑止した結果、リスト getter は
    // ウォーク・展開・apply で数回評価される。行数に比例しないことを固定する。
    let weeksEvals = 0;
    const { host, shadowRoot, stateElement } = await mount({
      n: 20,
      get lenArm(this: any) { return this.n; },
      get valueArm(this: any) { return this.n * 10; },
      get weeks(this: any) {
        weeksEvals++;
        return Array.from({ length: this.lenArm }, (_, i) => i);
      },
      get "weeks.*.days"(this: any) { return [0, 1]; },
      get "weeks.*.days.*.text"(this: any) { return `${this.valueArm}:${this.$1}-${this.$2}`; },
    }, GRID);
    weeksEvals = 0;

    stateElement.createState("writable", (s: any) => { s.n = 21; });
    await flush();

    expect(weekCount(shadowRoot)).toBe(21);
    expect(weeksEvals).toBeLessThanOrEqual(4);
    host.remove();
  });

  it("リスト長を決める中間 getter が、ウォーク途中で古い腕を読んで確定しないこと", async () => {
    // weekCount の評価結果を記録し、片腕だけ更新された中間状態の値が
    // 最終的に残っていないことを直接観測する。
    const evaluated: number[] = [];
    const state = diamondCalendar();
    const original = Object.getOwnPropertyDescriptor(state, "weekCount")!.get!;
    Object.defineProperty(state, "weekCount", {
      get(this: any) {
        const value = original.call(this);
        evaluated.push(value);
        return value;
      },
      enumerable: true,
      configurable: true,
    });

    const { host, shadowRoot, stateElement } = await mount(state, GRID);
    evaluated.length = 0;

    // 6 月(5 週)を経由してから 5 月(6 週)へ。2026-05 は offset=5 / lastDate=31 で
    // 6 週だが、片腕だけ新しい中間状態(offset=5 / lastDate=30 → 5 週)が確定して
    // しまう回帰を捕まえる。8 月→5 月の直行はどちらも 6 週で差が出ない。
    for (const month of [6, 5]) {
      stateElement.createState("writable", (s: any) => { s.month = month; });
      await flush();
    }

    expect(weekCount(shadowRoot)).toBe(6);
    expect(evaluated.at(-1), "最後に確定した weekCount").toBe(6);
    host.remove();
  });
});
