/**
 * integration.dependencyOrderFuzz.test.ts — 無効化順序のランダム差分テスト。
 *
 * ランダムな依存 DAG（スカラー getter 群）と、その値で長さが決まるリスト 2 本、
 * 行 getter を組み、ランダムな更新を繰り返す。毎回 DOM を素の JS で計算した
 * 期待値と突き合わせるので、「どこかの getter が古い値のまま残った」という
 * 症状は形を問わずここで落ちる。
 *
 * このテストが捕まえる欠陥（walkDependency のトポロジカル順訪問が無いと再発する）:
 * 合流点を持つグラフで、片方の腕しか dirty 化していない段階でリスト実体を読むと、
 * 中間 getter が古い入力で確定し、visited により再訪問もされない。導入前の実装では
 * 300 seed 中 263 が不一致になっていた。
 *
 * 1 seed あたりの検出率が高い（導入前は 88%）ので既定は 50 seed に抑えてある。
 * 追い込むときは DIFF_SEEDS で増やす。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";

beforeAll(() => { bootstrapState(); });

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`fuzz-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  return { host, shadowRoot, stateElement: getStateElementByName(shadowRoot, "default")! };
}

// 独立した 2 本のリスト。rows は素の行値、weeks は入れ子（行 x 列）。
const MARKUP =
  `<div><template data-wcs="for: rows"><b class="rv">{{ .v }}</b></template></div>` +
  `<div><template data-wcs="for: weeks">` +
  `<div class="week"><template data-wcs="for: weeks.*.days">` +
  `<span class="day">{{ .text }}</span></template></div>` +
  `</template></div>`;

const grid = (sr: ShadowRoot) => Array.from(sr.querySelectorAll(".week")).map(w =>
  Array.from(w.querySelectorAll(".day")).map(d => d.textContent));
const rowValues = (sr: ShadowRoot) => Array.from(sr.querySelectorAll(".rv")).map(e => e.textContent);
const snapshot = (sr: ShadowRoot) => JSON.stringify([grid(sr), rowValues(sr)]);

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NODE_COUNT = 10;

type Plan = {
  /** g[i] の親。-1 は基点スカラー n、それ以外は g のインデックス */
  parents: number[][];
  lenNodes: [number, number];
  textNodes: [number, number];
  rowNode: number;
};

function makePlan(rnd: () => number): Plan {
  const parents: number[][] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    const count = 1 + Math.floor(rnd() * 3);
    const pool = [-1, ...Array.from({ length: i }, (_, k) => k)];
    const picked = new Set<number>();
    for (let c = 0; c < count; c++) {
      picked.add(pool[Math.floor(rnd() * pool.length)]);
    }
    parents.push([...picked]);
  }
  const pick = () => Math.floor(rnd() * NODE_COUNT);
  return { parents, lenNodes: [pick(), pick()], textNodes: [pick(), pick()], rowNode: pick() };
}

/** 素の JS による参照計算（実装を一切使わない） */
function evaluate(plan: Plan, n: number) {
  const g: number[] = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    let sum = 0;
    for (const p of plan.parents[i]) sum += p === -1 ? n : g[p];
    g[i] = (sum + i) % 97;
  }
  return {
    g,
    len: ((g[plan.lenNodes[0]] + g[plan.lenNodes[1]]) % 5) + 1,
    a: g[plan.textNodes[0]],
    b: g[plan.textNodes[1]],
    rowCount: (g[plan.rowNode] % 4) + 1,
  };
}

function expectedSnapshot(plan: Plan, n: number): string {
  const { g, len, a, b, rowCount } = evaluate(plan, n);
  const cells = Array.from({ length: len }, (_, w) => [0, 1].map(d => `${a}/${b}:${w}-${d}`));
  const rows = Array.from({ length: rowCount }, (_, i) => String((i + 1) * (g[plan.rowNode] % 3)));
  return JSON.stringify([cells, rows]);
}

function buildState(plan: Plan): any {
  const state: any = { n: 0 };
  for (let i = 0; i < NODE_COUNT; i++) {
    const ps = plan.parents[i];
    const index = i;
    Object.defineProperty(state, `g${i}`, {
      get(this: any) {
        let sum = 0;
        for (const p of ps) sum += p === -1 ? this.n : this[`g${p}`];
        return (sum + index) % 97;
      },
      enumerable: true, configurable: true,
    });
  }
  const [l0, l1] = plan.lenNodes;
  const [t0, t1] = plan.textNodes;
  const rn = plan.rowNode;
  Object.defineProperty(state, "rows", {
    get(this: any) { return Array.from({ length: (this[`g${rn}`] % 4) + 1 }, (_, i) => i); },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(state, "rows.*.v", {
    get(this: any) { return (this["rows.*"] + 1) * (this[`g${rn}`] % 3); },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(state, "len", {
    get(this: any) { return ((this[`g${l0}`] + this[`g${l1}`]) % 5) + 1; },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(state, "weeks", {
    get(this: any) { return Array.from({ length: this.len }, (_, w) => w); },
    enumerable: true, configurable: true,
  });
  Object.defineProperty(state, "weeks.*.days", {
    get() { return [0, 1]; }, enumerable: true, configurable: true,
  });
  Object.defineProperty(state, "weeks.*.days.*.text", {
    get(this: any) { return `${this[`g${t0}`]}/${this[`g${t1}`]}:${this.$1}-${this.$2}`; },
    enumerable: true, configurable: true,
  });
  return state;
}

describe("依存グラフのランダム差分テスト", () => {
  const SEEDS = Number(process.env.DIFF_SEEDS ?? 50);

  it(`${SEEDS} 個のランダムグラフ x 12 更新で常に期待値と一致すること`, async () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rnd = mulberry32(seed);
      const plan = makePlan(rnd);
      const { host, shadowRoot, stateElement } = await mount(buildState(plan), MARKUP);

      if (snapshot(shadowRoot) !== expectedSnapshot(plan, 0)) {
        failures.push(`seed=${seed} 初期描画`);
        host.remove();
        continue;
      }
      for (let step = 0; step < 12; step++) {
        const n = Math.floor(rnd() * 40);
        stateElement.createState("writable", (s: any) => { s.n = n; });
        await flush();
        const got = snapshot(shadowRoot);
        const want = expectedSnapshot(plan, n);
        if (got !== want) {
          failures.push(`seed=${seed} step=${step} n=${n}\n  want=${want}\n  got =${got}`);
          break;
        }
      }
      host.remove();
    }
    if (failures.length > 0) {
      console.log(`--- 不一致 ${failures.length}/${SEEDS} seeds ---`);
      for (const f of failures.slice(0, 5)) console.log(f);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
