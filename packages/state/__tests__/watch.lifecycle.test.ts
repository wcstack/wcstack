/**
 * watch.lifecycle.test.ts
 *
 * `$watch` の State ライフサイクル接続（実装計画 A-7）。
 *
 * 受け入れ ID:
 * - P6:  宣言 → connect → 書き込み → 発火
 * - P16: `$watch` 未宣言時、watchPaths が null のまま（旧値キャプチャ経路に入らない）かつ
 *        発火対象集合にも載らない（drain の収集ループごと素通りする）
 * - S9:  `_state` 再 set で旧宣言のハンドラが発火しない
 * - S10: 切断後は発火しない／再接続で復活する
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IState } from "../src/types";
import { getActiveWatchStateElements, getWatchEntries } from "../src/watch/watchRegistry";
import { flushAsync, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("watch-lc-host");

describe("$watch State ライフサイクル統合", () => {
  it("P6: connect で発火対象に載り、$connectedCallback 後の書き込みで発火すること", async () => {
    const handler = vi.fn();
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $watch: { count: handler },
    } as unknown as IState);

    expect(getActiveWatchStateElements().has(stateEl)).toBe(true);
    expect(stateEl.watchPaths).not.toBeNull();
    expect(stateEl.watchPaths!.has("count")).toBe(true);

    stateEl.createState("writable", (state) => { state.count = 1; });
    await flushAsync();

    expect(handler).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("$connectedCallback 内の書き込みでは発火しないこと（初期化は購読対象外）", async () => {
    const handler = vi.fn();
    const { host } = await connectHost("", {
      count: 0,
      $connectedCallback(this: any) { this.count = 42; },
      $watch: { count: handler },
    } as unknown as IState);
    await flushAsync();

    expect(handler).not.toHaveBeenCalled();
    host.remove();
  });

  it("P16: $watch 未宣言なら watchPaths が null で、発火対象集合にも載らないこと（ゼロコスト契約）", async () => {
    const { host, stateEl } = await connectHost("", { count: 0 } as unknown as IState);
    // setByAddress 側のゼロコスト: 旧値キャプチャは watchPaths の null 判定 1 個で抜ける
    expect(stateEl.watchPaths).toBeNull();
    expect(getWatchEntries(stateEl).size).toBe(0);
    // drain 側のゼロコスト: active 集合に載せてしまうと fireWatchOnUpdateBatch の
    // early return が効かず、宣言ゼロでもバッチのアドレス数ぶん収集ループが回る
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);

    stateEl.createState("writable", (state) => { state.count = 1; });
    await flushAsync();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    host.remove();
  });

  it("P16 補: 宣言が空オブジェクトでも発火対象集合に載らないこと", async () => {
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $watch: {},
    } as unknown as IState);

    expect(stateEl.watchPaths).toBeNull();
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    host.remove();
  });

  it("S9: `_state` 再 set で旧宣言のハンドラが発火しなくなること", async () => {
    const oldHandler = vi.fn();
    const newHandler = vi.fn();
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $watch: { count: oldHandler },
    } as unknown as IState);

    stateEl.setInitialState({
      count: 0,
      $watch: { count: newHandler },
    } as unknown as IState);
    await flushAsync();

    stateEl.createState("writable", (state) => { state.count = 1; });
    await flushAsync();

    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it("S9 補: 再 set で $watch 宣言が消えたら watchPaths が null に戻ること", async () => {
    const handler = vi.fn();
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $watch: { count: handler },
    } as unknown as IState);

    stateEl.setInitialState({ count: 0 } as unknown as IState);
    await flushAsync();

    expect(stateEl.watchPaths).toBeNull();
    // 宣言が消えたら発火対象集合からも外れる（ゼロコスト契約へ戻る）
    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    stateEl.createState("writable", (state) => { state.count = 1; });
    await flushAsync();
    expect(handler).not.toHaveBeenCalled();
    host.remove();
  });

  it("S10: 切断後は発火せず、registry は保持されること（再接続で復活できる）", async () => {
    const handler = vi.fn();
    const { host, stateEl } = await connectHost("", {
      count: 0,
      $watch: { count: handler },
    } as unknown as IState);

    host.remove();
    await flushAsync();

    expect(getActiveWatchStateElements().has(stateEl)).toBe(false);
    // registry は残る（切断は「発火しなくなる」だけ）
    expect(getWatchEntries(stateEl).has("count")).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it("S10 補: 再接続で発火が復活すること", async () => {
    const handler = vi.fn();
    const { host, shadowRoot, stateEl } = await connectHost("", {
      count: 0,
      $watch: { count: handler },
    } as unknown as IState);

    host.remove();
    await flushAsync();
    document.body.appendChild(host);
    await stateEl.connectedCallbackPromise;
    await flushAsync();

    expect(getActiveWatchStateElements().has(stateEl)).toBe(true);
    stateEl.createState("writable", (state) => { state.count = 3; });
    await flushAsync();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(shadowRoot.querySelector("wcs-state")).toBe(stateEl);
    host.remove();
  });

  it("enable-ssr のクライアント側では発火対象に載ること（inSsr() ではないため）", async () => {
    const handler = vi.fn();
    const host = document.createElement("watch-lc-ssr-host");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `<wcs-state enable-ssr></wcs-state>`;
    document.body.appendChild(host);
    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    stateEl.setInitialState({ count: 0, $watch: { count: handler } } as unknown as IState);
    await stateEl.connectedCallbackPromise;

    // enable-ssr のクライアント側は inSsr() ではないので watch は有効
    expect(getActiveWatchStateElements().has(stateEl)).toBe(true);
    host.remove();
  });
});
