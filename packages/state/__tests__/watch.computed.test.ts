/**
 * watch.computed.test.ts
 *
 * computed（getter）の `$watch`（実装計画 Phase C）。
 *
 * computed は lazy で、書き込みは cache entry に dirty を立てるだけ、getter の依存
 * （dynamicDependency）は評価時にしか張られない。したがって `$watch` に getter パスを
 * 宣言したら、そのパスは **eager になる**（接続時に 1 回評価して依存を張り、以後は
 * drain 終端で強制評価する）。設計書 §5 の決定をここで固定する。
 *
 * 受け入れ ID:
 * - P10: watch した getter が依存書き込みで発火する
 * - P11: getter の prev がバッチ跨ぎで保持される
 * - P12: 画面に出していない getter でも発火する（eager 化の確認）
 * - S12: getter 内の throw が例外隔離に乗る
 */
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import type { IState } from "../src/types";

beforeAll(() => {
  bootstrapState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r));
let seq = 0;

async function mount(initial: IState, markup = "") {
  const host = document.createElement(`watch-computed-host-${++seq}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `${markup}<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  return { host, shadowRoot, stateElement };
}

describe("$watch と computed（getter）", () => {
  it("P10/P12: 画面に出していない getter でも、依存の書き込みで発火すること（eager 化）", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      count: 1,
      get double(this: any) { return this.count * 2; },
      $watch: {
        double(cur: unknown, prev: unknown) { calls.push([cur, prev]); },
      },
    } as unknown as IState);

    stateElement.createState("writable", (state) => { state.count = 5; });
    await flush();

    expect(calls).toEqual([[10, 2]]);
    host.remove();
  });

  it("P11: getter の prev がバッチ跨ぎで保持されること", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      count: 1,
      get double(this: any) { return this.count * 2; },
      $watch: {
        double(cur: unknown, prev: unknown) { calls.push([cur, prev]); },
      },
    } as unknown as IState);

    stateElement.createState("writable", (state) => { state.count = 2; });
    await flush();
    stateElement.createState("writable", (state) => { state.count = 3; });
    await flush();

    expect(calls).toEqual([[4, 2], [6, 4]]);
    host.remove();
  });

  it("依存が変わっても getter の値が変わらなければ、cur === prev で発火すること", async () => {
    // watch は独自の発火条件を持たない（§4-2）。getter の値が同じでも、依存が
    // 変わってバッチに載れば発火する。差分を見たいならユーザーが比較する。
    const calls: Array<[unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      count: 1,
      get parity(this: any) { return this.count % 2; },
      $watch: {
        parity(cur: unknown, prev: unknown) { calls.push([cur, prev]); },
      },
    } as unknown as IState);

    stateElement.createState("writable", (state) => { state.count = 3; });
    await flush();

    expect(calls).toEqual([[1, 1]]);
    host.remove();
  });

  it("S12: getter 内の throw が例外隔離に乗り、他の watch を巻き添えにしないこと（報告は評価エラーとして出る）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const later = vi.fn();
    const { host, stateElement } = await mount({
      count: 1,
      other: 0,
      get boom(this: any): number {
        if (this.count > 1) throw new Error("boom");
        return this.count;
      },
      $watch: {
        boom() { /* 到達しない（cur の評価で throw する） */ },
        other: later,
      },
    } as unknown as IState);

    stateElement.createState("writable", (state) => {
      state.count = 2;
      state.other = 1;
    });
    await flush();

    expect(later).toHaveBeenCalledTimes(1);
    // throw 元が cur の評価（getter）なので、ハンドラ本体の throw とは文言を分けている
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('$watch evaluation of "boom" threw'),
      expect.any(Error),
    );
    host.remove();
  });

  it("ワイルドカードを含む getter は eager 化されないこと（バインドが無ければ発火しない）", async () => {
    // 初回評価には行ごとの indexes が要り、全行評価は宣言しただけでリスト全体を
    // 舐めることになるので対象外にしている（設計書 §5-3）。
    const calls: unknown[] = [];
    const { host, stateElement } = await mount({
      items: [{ price: 100 }, { price: 200 }],
      get "items.*.tax"(this: any) { return this["items.*.price"] * 0.1; },
      $watch: {
        "items.*.tax"(cur: unknown) { calls.push(cur); },
      },
    } as unknown as IState);

    // 初回評価が走っていない ＝ 台帳が 1 件も作られない
    const { __private__ } = await import("../src/watch/computedSnapshots");
    expect(__private__.snapshotsByStateElement.has(stateElement)).toBe(false);

    // 依存を書き換えても発火しない。行が特定できないヒット（listIndex が null）は
    // 収集段階で落とすので、例外隔離に落ちて console.error が出ることも無い。
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    stateElement.createState("writable", (state) => {
      state.items = [{ price: 300 }, { price: 200 }];
    });
    await flush();

    expect(calls).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    host.remove();
  });

  it("ワイルドカード getter も DOM にバインドされていれば発火すること（prev は常に undefined）", async () => {
    const calls: Array<[number, unknown, unknown]> = [];
    const { host, stateElement } = await mount({
      items: [{ price: 100 }, { price: 200 }],
      get "items.*.tax"(this: any) { return this["items.*.price"] * 0.1; },
      $watch: {
        "items.*.tax"(cur: unknown, prev: unknown, index: number) { calls.push([index, cur, prev]); },
      },
    } as unknown as IState,
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.tax"></li></template></ul>`);

    stateElement.createState("writable", (state) => {
      state.$resolve("items.*.price", [0], 300);
    });
    await flush();

    // eager 化の対象外（§5-3）と対称に、前回評価値の台帳にも載せない ＝ prev は undefined
    expect(calls).toEqual([[0, 30, undefined]]);
    host.remove();
  });

  it("ワイルドカード getter の発火では前回評価値の台帳が増えないこと（行ごとのアドレス蓄積を防ぐ）", async () => {
    // 台帳のキーは絶対アドレス（listIndex を強参照）で、prune 経路は `_state` 再 set だけ。
    // 行が入れ替わるたびに積むと、行を捨てても listIndex が解放されず単調増加する。
    const { host, stateElement } = await mount({
      items: [{ price: 100 }, { price: 200 }],
      get "items.*.tax"(this: any) { return this["items.*.price"] * 0.1; },
      $watch: {
        "items.*.tax"() { /* noop */ },
      },
    } as unknown as IState,
      `<ul><template data-wcs="for: items"><li data-wcs="textContent: items.*.tax"></li></template></ul>`);

    const { __private__ } = await import("../src/watch/computedSnapshots");
    const sizes: number[] = [];
    for (let round = 0; round < 5; round++) {
      stateElement.createState("writable", (state) => {
        state.items = [{ price: 100 + round }, { price: 200 + round }];
      });
      await flush();
      sizes.push(__private__.snapshotsByStateElement.get(stateElement)?.size ?? 0);
    }

    expect(sizes).toEqual([0, 0, 0, 0, 0]);
    host.remove();
  });

  it("`_state` 再 set で、新しく watch した getter の prev が新 state の初回評価値になること", async () => {
    const calls: Array<[unknown, unknown]> = [];
    const handler = (cur: unknown, prev: unknown) => { calls.push([cur, prev]); };
    const { host, stateElement } = await mount({
      count: 1,
      get double(this: any) { return this.count * 2; },
      $watch: { double: handler },
    } as unknown as IState);

    stateElement.createState("writable", (state) => { state.count = 5; });
    await flush();
    expect(calls).toEqual([[10, 2]]);

    // 再 set: 別の getter を watch する宣言に差し替える
    (stateElement as unknown as State).setInitialState({
      count: 100,
      get triple(this: any) { return this.count * 3; },
      $watch: { triple: handler },
    } as unknown as IState);
    await flush();

    stateElement.createState("writable", (state) => { state.count = 101; });
    await flush();

    // prev は新 state の初回評価値（100*3）。旧宣言の値は混ざらない
    expect(calls[1]).toEqual([303, 300]);
    host.remove();
  });

  it("再 set で前回評価値の台帳自体が破棄されること（旧宣言のパスが残らない）", async () => {
    const { host, stateElement } = await mount({
      count: 1,
      get double(this: any) { return this.count * 2; },
      $watch: { double() { /* noop */ } },
    } as unknown as IState);
    const { __private__ } = await import("../src/watch/computedSnapshots");
    expect(__private__.snapshotsByStateElement.get(stateElement)!.size).toBe(1);

    (stateElement as unknown as State).setInitialState({ count: 1 } as unknown as IState);
    await flush();

    expect(__private__.snapshotsByStateElement.has(stateElement)).toBe(false);
    host.remove();
  });

  it("初回評価で getter が throw しても接続が壊れないこと（報告して先へ進む）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => { /* silence */ });
    const other = vi.fn();
    const { host, stateElement } = await mount({
      count: 1,
      get boom(): number { throw new Error("boom at prime"); },
      $watch: {
        boom() { /* noop */ },
        count: other,
      },
    } as unknown as IState);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('$watch initial evaluation of "boom" threw'),
      expect.any(Error),
    );
    // 接続は完了しており、他の watch は通常どおり動く
    stateElement.createState("writable", (state) => { state.count = 2; });
    await flush();
    expect(other).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("バインドされている getter でも二重発火しないこと", async () => {
    const calls: unknown[] = [];
    const { host, stateElement } = await mount({
      count: 1,
      get double(this: any) { return this.count * 2; },
      $watch: {
        double(cur: unknown) { calls.push(cur); },
      },
    } as unknown as IState, `<p data-wcs="textContent: double"></p>`);

    stateElement.createState("writable", (state) => { state.count = 4; });
    await flush();

    expect(calls).toEqual([8]);
    host.remove();
  });
});
