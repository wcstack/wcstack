import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getOrCreateEventToken } from "../src/event/eventTokenRegistry";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

/**
 * PoC（特性化）: `for` 内から発火した event-token の **async** `$on` ハンドラで、
 * await を跨いだときにループコンテキスト依存の解決がどうなるか。
 *
 * 背景: docs/state-event-lane-design.md の決定ゲート G1。lane / retry を `$on` に
 * 宣言できるようにするには、ハンドラが Promise を返せる必要がある（G1-B）。しかし
 * `proxy/methods/setLoopContext.ts` の `_setLoopContext` は
 *
 *     try { handler.pushAddress(loopContext); try { return callback() }
 *           finally { handler.popAddress() } }
 *     finally { handler.clearLoopContext() }
 *
 * という **同期** の push/pop であり、`callback()` が Promise を返した時点で
 * finally が走る。つまりループコンテキストは await の手前で失われる。
 *
 * 本ファイルは「そうなっているはず」を実測に置き換え、失敗モード（loud か silent か）
 * と回避策（$resolve への明示指定）の成否を固定する。
 *
 * 追記: 最後のケースが実証した「reject が unhandled になる」性質は
 * `event/captureHandlerRejection.ts` で塞いだため、現在は console.error への報告に
 * 変わっている（同ケースはその回帰テストを兼ねる）。
 */

const ROW_TAG = "poc-async-row";

function defineRowTag(): void {
  if (customElements.get(ROW_TAG)) return;
  class C extends HTMLElement {
    static wcBindable: IWcBindable = {
      protocol: "wc-bindable",
      version: 1,
      properties: [{ name: "picked", event: "row-picked" }],
    };
  }
  customElements.define(ROW_TAG, C);
}

interface Harness {
  readonly rows: NodeListOf<Element>;
  readonly stateEl: State;
  readonly teardown: () => void;
}

/**
 * `for: items` の各行に eventToken を配線し、`$on.rowPicked` に渡されたハンドラを
 * 繋いだ state を立ち上げる。`eventTokenHandler` はハンドラの戻り値を捨てる
 * （async ハンドラの Promise は浮く）ため、完了は呼び出し側が別途待つ。
 */
async function mount(
  handler: (state: any, event: Event, ...indexes: number[]) => unknown,
): Promise<Harness> {
  defineRowTag();
  const host = document.createElement("poc-async-host");
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <template data-wcs="for: items">
      <${ROW_TAG} data-wcs="eventToken.picked: rowPicked"></${ROW_TAG}>
    </template>
    <wcs-state></wcs-state>
  `;
  document.body.appendChild(host);

  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState({
    items: [{ id: "a", flag: false }, { id: "b", flag: false }],
    $eventTokens: ["rowPicked"],
    $on: { rowPicked: handler },
  });
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);

  return {
    rows: shadowRoot.querySelectorAll(ROW_TAG),
    stateEl,
    teardown: () => host.remove(),
  };
}

/** 行 index の要素を発火し、ハンドラが settle するまで待って結果を返す。 */
async function fire(h: Harness, index: number, settled: Promise<unknown>): Promise<unknown> {
  h.rows[index].dispatchEvent(new CustomEvent("row-picked", { detail: index }));
  return await settled;
}

/** ハンドラの完了を外から待つための deferred。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("PoC: async $on ハンドラとループコンテキスト（G1）", () => {
  it("[基準] 同期ハンドラは $1 と wildcard パスを解決できる", async () => {
    const d = deferred<Record<string, unknown>>();
    const h = await mount((state, _event, ...indexes) => {
      d.resolve({
        index1: state.$1,
        wildcardId: state["items.*.id"],
        indexes,
      });
    });

    const got = await fire(h, 1, d.promise);
    expect(got).toEqual({ index1: 1, wildcardId: "b", indexes: [1] });

    h.teardown();
  });

  it("[基準] async ハンドラでも await の *手前* なら解決できる（同期プレフィックスは生きている）", async () => {
    const d = deferred<Record<string, unknown>>();
    const h = await mount(async (state) => {
      const before = { index1: state.$1, wildcardId: state["items.*.id"] };
      await Promise.resolve();
      d.resolve(before);
    });

    const got = await fire(h, 1, d.promise);
    expect(got).toEqual({ index1: 1, wildcardId: "b" });

    h.teardown();
  });

  it("★ await を跨ぐと $1 は raiseError になる（silent ではなく loud に落ちる）", async () => {
    const d = deferred<string>();
    const h = await mount(async (state) => {
      await Promise.resolve();
      try {
        void state.$1;
        d.resolve("NO THROW");
      } catch (e) {
        d.resolve((e as Error).message);
      }
    });

    const message = await fire(h, 1, d.promise);
    // 失敗モードが loud であることが重要: 黙って別の行を指すより遥かにマシ。
    expect(message).toContain("No active state reference");

    h.teardown();
  });

  it("★ await を跨ぐと wildcard パスの読みも raiseError になる", async () => {
    const d = deferred<string>();
    const h = await mount(async (state) => {
      await Promise.resolve();
      try {
        void state["items.*.id"];
        d.resolve("NO THROW");
      } catch (e) {
        d.resolve((e as Error).message);
      }
    });

    const message = await fire(h, 1, d.promise);
    expect(message).not.toBe("NO THROW");

    h.teardown();
  });

  it("★ await を跨ぐと wildcard パスへの書き込みも raiseError になる", async () => {
    const d = deferred<string>();
    const h = await mount(async (state) => {
      await Promise.resolve();
      try {
        state["items.*.flag"] = true;
        d.resolve("NO THROW");
      } catch (e) {
        d.resolve((e as Error).message);
      }
    });

    const message = await fire(h, 1, d.promise);
    expect(message).not.toBe("NO THROW");

    h.teardown();
  });

  it("[回避策 ii] await 後でも $resolve + listIndexes なら読み書きできる", async () => {
    const d = deferred<Record<string, unknown>>();
    const h = await mount(async (state, _event, ...indexes) => {
      await Promise.resolve();
      // 引数で受け取った listIndexes は普通の数値配列なので await を跨いで生き残る。
      state.$resolve("items.*.flag", indexes, true);
      d.resolve({
        id: state.$resolve("items.*.id", indexes),
        flag: state.$resolve("items.*.flag", indexes),
      });
    });

    const got = await fire(h, 1, d.promise);
    expect(got).toEqual({ id: "b", flag: true });

    h.teardown();
  });

  it("[回避策 ii] 絶対パスの読み書きは await を跨いでも影響を受けない", async () => {
    const d = deferred<unknown>();
    const h = await mount(async (state) => {
      await Promise.resolve();
      state.items = state.items.concat([{ id: "c", flag: false }]);
      d.resolve(state.items.length);
    });

    const got = await fire(h, 0, d.promise);
    expect(got).toBe(3);

    h.teardown();
  });

  it("★ 2 行から同時に発火した async ハンドラは互いの listIndexes を汚さない", async () => {
    const seen: Array<{ indexes: number[]; id: unknown }> = [];
    const done = deferred<void>();
    const h = await mount(async (state, _event, ...indexes) => {
      // 片方だけ長く待たせて、await の重なりを作る。
      await new Promise((r) => setTimeout(r, indexes[0] === 0 ? 20 : 0));
      seen.push({ indexes, id: state.$resolve("items.*.id", indexes) });
      if (seen.length === 2) done.resolve();
    });

    h.rows[0].dispatchEvent(new CustomEvent("row-picked", { detail: 0 }));
    h.rows[1].dispatchEvent(new CustomEvent("row-picked", { detail: 1 }));
    await done.promise;

    // 行 1（待ち 0ms）が先に完了し、行 0（待ち 20ms）が後。取り違えが起きていないこと。
    expect(seen).toEqual([
      { indexes: [1], id: "b" },
      { indexes: [0], id: "a" },
    ]);

    h.teardown();
  });

  it("★ 発火経路は async ハンドラを await しないが、reject は捕捉して報告される", async () => {
    // 性質 (1): dispatch 経路はハンドラの完了を待たない（これは仕様であり変えない）。
    // 性質 (2): ハンドラの Promise は Token.emit の戻り値配列にしか現れない。
    //   → かつては呼び出し側がそれを捨てており reject が unhandled になっていた。
    //     現在は captureHandlerRejection がここを掴んで console.error に落とす。
    const gate = deferred<void>();
    let settled = false;
    const h = await mount(async () => {
      await gate.promise;
      settled = true;
      throw new Error("poc: handler rejected");
    });

    const token = getOrCreateEventToken(h.stateEl, "rowPicked");
    const originalEmit = token.emit.bind(token);
    let emitted: unknown[] = [];
    (token as unknown as { emit: (...a: unknown[]) => unknown[] }).emit = (...args) => {
      emitted = originalEmit(...args);
      return emitted;
    };

    const errors: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };

    try {
      h.rows[0].dispatchEvent(new CustomEvent("row-picked", { detail: 0 }));
      await new Promise((r) => setTimeout(r, 10));

      // (1) dispatch も、その後のタスク境界も、ハンドラの完了を待っていない。
      expect(settled).toBe(false);
      // (2) ハンドラの戻り Promise は emit の戻り値配列に現れる。
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toBeInstanceOf(Promise);

      gate.resolve();
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(true);

      // reject は unhandled にならず、どのハンドラで落ちたかが分かる形で報告される。
      expect(errors).toHaveLength(1);
      expect(String(errors[0][0])).toContain('$on."rowPicked" of state "default"');
      expect((errors[0][1] as Error).message).toBe("poc: handler rejected");
    } finally {
      console.error = originalConsoleError;
      h.teardown();
    }
  });
});
