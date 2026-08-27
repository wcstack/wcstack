/**
 * integration.getAllContext.test.ts
 *
 * `$getAll` の `indexes` 省略時セマンティクスを実プロキシ（モックなし）で固定する。
 *
 * 仕様: 省略時の既定はループ文脈の添字 `[$1..$n]`。正確には「path と文脈が共有する
 * ワイルドカード連鎖の分だけ文脈の添字を接頭辞として敷く」（整合最長接頭辞）。
 *
 * | ケース | 挙動 |
 * |---|---|
 * | 文脈が path の接頭辞（典型の集計 getter） | 文脈の行系列に絞られる |
 * | 文脈が path より深い | 共有分に切り詰め（残りは全展開） |
 * | 共有ゼロなのに文脈が添字を持つ | **throw**（異なる文脈の添字は流用しない） |
 * | 文脈なし（トップレベル） | 全展開（`[]` と同じ） |
 * | `[]` 明示 | 常に全展開（従来どおり） |
 *
 * この分岐は修正前は死にコードだった: getContextListIndex へワイルドカードの
 * **親パス**（'items'）を渡していたが、indexByWildcardPath のキーはワイルドカード
 * パス自身（'items.*'）なのでルックアップが必ずミスし、省略は常に全展開だった。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElementByName } from "../src/stateElementByName";
import type { IState } from "../src/types";

beforeAll(() => { bootstrapState(); });

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

async function mount(state: IState, markup: string) {
  const host = document.createElement(`getall-context-host-${++seq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(state as Record<string, any>);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  await flush();
  return { host, shadowRoot, stateElement: getStateElementByName(shadowRoot, "default")! };
}

function read(stateElement: any, fn: (s: any) => unknown): unknown {
  let out: unknown;
  stateElement.createState("readonly", (s: any) => { out = fn(s); });
  return out;
}

const NESTED_MARKUP = `<ul><template data-wcs="for: regions"><li><template data-wcs="for: .prefs"><span data-wcs="textContent: .v"></span></template></li></template></ul>`;

function makeState(): IState {
  return {
    title: "T",
    users: [{ name: "u0" }, { name: "u1" }],
    regions: [
      { name: "east", prefs: [{ v: 1 }, { v: 2 }] },
      { name: "west", prefs: [{ v: 10 }, { v: 20 }] },
    ],
    // 文脈 [$1] が path の接頭辞 — 現在 region に絞られる
    get "regions.*.sum"(this: any) {
      return this.$getAll("regions.*.prefs.*.v").reduce((a: number, b: number) => a + b, 0);
    },
    // `[]` 明示 — 常に全展開
    get "regions.*.sumAll"(this: any) {
      return this.$getAll("regions.*.prefs.*.v", []).reduce((a: number, b: number) => a + b, 0);
    },
    // 文脈 [$1, $2] は path より深い — 共有する 'regions.*' の 1 段に切り詰め
    get "regions.*.prefs.*.regionName"(this: any) {
      return this.$getAll("regions.*.name").join(",");
    },
    // ワイルドカード無しの path — 文脈があってもエラーにならず 1 要素
    get "regions.*.prefs.*.titleEcho"(this: any) {
      return this.$getAll("title").join(",");
    },
    // 共有ゼロ — users.* は regions.* の文脈と無関係なので throw
    get "regions.*.foreign"(this: any) {
      return this.$getAll("users.*.name");
    },
    // 文脈なし（トップレベル getter）— 全展開
    get total(this: any) {
      return this.$getAll("regions.*.prefs.*.v").reduce((a: number, b: number) => a + b, 0);
    },
  } as unknown as IState;
}

describe("$getAll indexes 省略時のループ文脈解決", () => {
  it("文脈が path の接頭辞なら現在の行系列に絞られること（[$1..$n] 相当）", async () => {
    const { host, stateElement } = await mount(makeState(), NESTED_MARKUP);
    expect(read(stateElement, (s) => s.$resolve("regions.*.sum", [0]))).toBe(3);
    expect(read(stateElement, (s) => s.$resolve("regions.*.sum", [1]))).toBe(30);
    host.remove();
  });

  it("`[]` 明示は従来どおり全展開のままであること", async () => {
    const { host, stateElement } = await mount(makeState(), NESTED_MARKUP);
    expect(read(stateElement, (s) => s.$resolve("regions.*.sumAll", [0]))).toBe(33);
    expect(read(stateElement, (s) => s.$resolve("regions.*.sumAll", [1]))).toBe(33);
    host.remove();
  });

  it("文脈が path より深い場合は共有分に切り詰められること", async () => {
    const { host, stateElement } = await mount(makeState(), NESTED_MARKUP);
    // 文脈 [1, 0]（west の 1 行目）→ 'regions.*.name' には [1] だけが敷かれる
    expect(read(stateElement, (s) => s.$resolve("regions.*.prefs.*.regionName", [1, 0]))).toBe("west");
    expect(read(stateElement, (s) => s.$resolve("regions.*.prefs.*.regionName", [0, 1]))).toBe("east");
    host.remove();
  });

  it("ワイルドカード無しの path は文脈があってもエラーにならないこと", async () => {
    const { host, stateElement } = await mount(makeState(), NESTED_MARKUP);
    expect(read(stateElement, (s) => s.$resolve("regions.*.prefs.*.titleEcho", [1, 1]))).toBe("T");
    host.remove();
  });

  it("共有ゼロなのに文脈が添字を持つ場合は throw すること（異なる文脈の混入防止）", async () => {
    const { host, stateElement } = await mount(makeState(), NESTED_MARKUP);
    expect(() => read(stateElement, (s) => s.$resolve("regions.*.foreign", [0])))
      .toThrow(/\$getAll\("users\.\*\.name"\) was called without indexes inside the loop context of "regions\.\*\.foreign"/);
    host.remove();
  });

  it("文脈なし（トップレベル）の省略は全展開のままであること", async () => {
    const { host, stateElement } = await mount(makeState(), NESTED_MARKUP);
    expect(read(stateElement, (s) => s.total)).toBe(33);
    // createState 直下（アドレススタック空）でも同様
    expect(read(stateElement, (s) => s.$getAll("regions.*.prefs.*.v"))).toEqual([1, 2, 10, 20]);
    host.remove();
  });
});
