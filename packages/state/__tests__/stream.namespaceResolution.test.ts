/**
 * stream.namespaceResolution.test.ts
 *
 * `$streamStatus` / `$streamError` の解決経路の統合テスト（B-2）。
 * 実 `<wcs-state>` 要素を happy-dom で connect する流儀は helpers/streamTestUtils.ts の
 * connectHost（makeConnectHost）を共用。
 *
 * 検証する解決経路（docs/state-streams-design.md §4-2）:
 * - JS 直接アクセス: get トラップの namespace case（state.$streamStatus.tokens）
 * - dotted 直接アクセス: get トラップのフォールスルー → getByAddress の namespace 分岐
 *   （this["$streamStatus.tokens"]、getter 内の依存追跡付き読み取りの正規形）
 * - binding パス解決: applyChange の読みが getByAddress の namespace 分岐に到達
 * - 書き込み防御（S11）: setByAddress の親走査が namespace proxy に到達して raiseError
 * - $streamError 側の同型・未宣言名は undefined（binding は書き込みスキップ = 空表示）
 * - 葉より深い読み: primitive / null の葉を跨ぐ dotted パスは undefined 解決で throw しない
 *   （§4-1 の寛容規約 — Reflect.get の non-object TypeError を updater の drain に漏らさない）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import type { IState } from "../src/types";
import type { IStateProxy } from "../src/proxy/types";
import { makeManualAsyncGenerator, makeManualFailableSource } from "./helpers/fakeStreamSources";
import { flushAsync, makeConnectHost } from "./helpers/streamTestUtils";

beforeAll(() => {
  bootstrapState();
});

const connectHost = makeConnectHost("stream-ns-host");

/** tokens ストリーム 1 本だけ持つ最小 state 宣言 */
function makeTokensState(): { raw: IState } {
  const m = makeManualAsyncGenerator<string>();
  const raw: IState = {
    $streams: {
      tokens: {
        source: () => m.iterable,
        fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
        initial: "",
      },
    },
  };
  return { raw };
}

describe("$streamStatus / $streamError の解決経路統合", () => {
  it("JS 直接アクセス: state.$streamStatus.tokens が status を返すこと（readonly / writable 両 proxy）", async () => {
    const { raw } = makeTokensState();
    const { host, stateEl } = await connectHost("", raw);

    stateEl.createState("readonly", (s: IStateProxy) => {
      expect((s.$streamStatus as Record<string, unknown>).tokens).toBe("active");
      expect((s.$streamError as Record<string, unknown>).tokens).toBeNull();
    });
    stateEl.createState("writable", (s: IStateProxy) => {
      expect((s.$streamStatus as Record<string, unknown>).tokens).toBe("active");
      expect((s.$streamError as Record<string, unknown>).tokens).toBeNull();
    });

    host.remove();
  });

  it("dotted 直接アクセス: proxy 上の this[\"$streamStatus.tokens\"] が値を返すこと（getter 内・直接読みの両方）", async () => {
    // 注意: makeTokensState の extra 経由で getter を渡すと object spread が getter を
    // 即時評価して data プロパティ化してしまうため、getter 持ちの state は inline で宣言する
    const m = makeManualAsyncGenerator<string>();
    const raw: IState = {
      $streams: {
        tokens: {
          source: () => m.iterable,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
      },
      // getter 内の dotted 読み（依存追跡付き読み取りの正規形、設計書 §4-3）
      get isStreaming() {
        return (this as Record<string, unknown>)["$streamStatus.tokens"] === "active";
      },
    };
    const { host, stateEl } = await connectHost("", raw);

    stateEl.createState("readonly", (s: IStateProxy) => {
      // 直接の dotted 読み（get トラップのフォールスルー → getByAddress の namespace 分岐）
      expect(s["$streamStatus.tokens"]).toBe("active");
      expect(s["$streamError.tokens"]).toBeNull();
      // getter 経由の dotted 読み
      expect(s.isStreaming).toBe(true);
    });

    host.remove();
  });

  it("binding: <p data-wcs=\"textContent: $streamStatus.tokens\"> が初期表示されること", async () => {
    const { raw } = makeTokensState();
    const { host, shadowRoot } = await connectHost(
      `<p id="st" data-wcs="textContent: $streamStatus.tokens"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    expect(shadowRoot.querySelector("#st")!.textContent).toBe("active");

    host.remove();
  });

  it("書き込み防御（S11）: 直接代入 state[\"$streamStatus.tokens\"] = \"x\" が raiseError すること", async () => {
    const { raw } = makeTokensState();
    const { host, stateEl } = await connectHost("", raw);

    // setByAddress の親走査が "$streamStatus" を解決 → 子への Reflect.set が
    // namespace proxy の set トラップに到達して raiseError
    expect(() => {
      stateEl.createState("writable", (s: IStateProxy) => {
        s["$streamStatus.tokens"] = "x";
      });
    }).toThrow(/\$streamStatus namespace is read-only/);

    expect(() => {
      stateEl.createState("writable", (s: IStateProxy) => {
        s["$streamError.tokens"] = "x";
      });
    }).toThrow(/\$streamError namespace is read-only/);

    host.remove();
  });

  it("§4-2 既知の許容: 現在値と同値の primitive / null の dotted 代入は sameValueGuard が先に評価されるため raiseError せず黙って no-op になること（特性化）", async () => {
    const { raw } = makeTokensState();
    const { host, stateEl } = await connectHost("", raw);

    // 現在値は status="active" / error=null（起動直後）。setByAddress の
    // sameValueGuard（既定 ON）は親走査（namespace proxy への Reflect.set →
    // raiseError）より先に評価されるため、現在値と同値の代入は書き込み防御に
    // 到達せず黙って no-op になる（設計正本 §4-2 の既知の許容 — registry/DOM の
    // 破壊は起きず、誤用診断が遅延するのみ。防御は値が変わる書き込みで発火する。
    // ガードの対象は primitive / null のみ — 同値でもオブジェクト値は素通りして
    // raiseError する（次の特性化を参照）。
    // 将来この許容を潰す場合はこの特性化と §4-2 を同時に更新すること）。
    expect(() => {
      stateEl.createState("writable", (s: IStateProxy) => {
        s["$streamStatus.tokens"] = "active";
        s["$streamError.tokens"] = null;
      });
    }).not.toThrow();

    // no-op であること: registry の正本は変化せず読み取り値も不変
    stateEl.createState("readonly", (s: IStateProxy) => {
      expect(s["$streamStatus.tokens"]).toBe("active");
      expect(s["$streamError.tokens"]).toBeNull();
    });

    host.remove();
  });

  it("§4-2 既知の許容の限定: 同値でもオブジェクト値（同一 Error インスタンス）の代入は sameValueGuard 対象外のため raiseError すること（特性化）", async () => {
    // sameValueGuard は primitive / null のみ対象（setByAddress のガード条件
    // `value === null || typeof value !== "object"`）。$streamError の現在値が
    // Error オブジェクトのとき、同一インスタンスの再代入はガードを素通りして
    // 親走査 → namespace proxy の書き込み防御に到達する（既知の許容は
    // 「同値かつ primitive / null」に限る — 設計正本 §4-2）。
    const m = makeManualFailableSource<string>();
    const failure = new Error("boom");
    const raw: IState = {
      $streams: {
        tokens: {
          source: () => m.iterable,
          fold: (acc: unknown, chunk: unknown) => `${acc}${chunk}`,
          initial: "",
        },
      },
    };
    const { host, stateEl } = await connectHost("", raw);

    m.fail(failure);
    await flushAsync();

    // 前提: 現在値が Error インスタンスである
    stateEl.createState("readonly", (s: IStateProxy) => {
      expect(s["$streamError.tokens"]).toBe(failure);
    });

    expect(() => {
      stateEl.createState("writable", (s: IStateProxy) => {
        s["$streamError.tokens"] = failure; // 現在値と同一インスタンスでも throw
      });
    }).toThrow(/\$streamError namespace is read-only/);

    host.remove();
  });

  it("書き込み防御（S11）: state.$streamStatus.tokens = \"x\"（namespace proxy 経由）も raiseError すること", async () => {
    const { raw } = makeTokensState();
    const { host, stateEl } = await connectHost("", raw);

    expect(() => {
      stateEl.createState("writable", (s: IStateProxy) => {
        (s.$streamStatus as Record<string, unknown>).tokens = "x";
      });
    }).toThrow(/\$streamStatus namespace is read-only/);

    expect(() => {
      stateEl.createState("writable", (s: IStateProxy) => {
        (s.$streamError as Record<string, unknown>).tokens = "x";
      });
    }).toThrow(/\$streamError namespace is read-only/);

    host.remove();
  });

  it("$streamError 側の同型確認: error 発生後に binding / JS 両経路で読めること", async () => {
    const failure = new Error("stream failed");
    let failRun: (() => void) | null = null;
    const raw: IState = {
      $streams: {
        broken: {
          source: () => ({
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise<IteratorResult<string>>((_resolve, reject) => {
                    failRun = () => reject(failure);
                  }),
              };
            },
          }),
        },
      },
    };
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="err" data-wcs="textContent: $streamError.broken"></p>` +
        `<p id="st" data-wcs="textContent: $streamStatus.broken"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    // error 前: $streamError は null（textContent への null 書き込みは空文字化）
    stateEl.createState("readonly", (s: IStateProxy) => {
      expect(s["$streamError.broken"]).toBeNull();
      expect(s["$streamStatus.broken"]).toBe("active");
    });

    failRun!();
    await flushAsync();

    stateEl.createState("readonly", (s: IStateProxy) => {
      expect(s["$streamError.broken"]).toBe(failure);
      expect(s["$streamStatus.broken"]).toBe("error");
    });
    // binding にも反映される（$postUpdate → updater 経由、B-3 の end-to-end は別テストで完結）
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("error");
    expect(shadowRoot.querySelector("#err")!.textContent).toBe(String(failure));

    host.remove();
  });

  it("未宣言名: $streamStatus.unknown は undefined を返し、binding は空表示のままであること", async () => {
    const { raw } = makeTokensState();
    const { host, shadowRoot, stateEl } = await connectHost(
      `<p id="unknown" data-wcs="textContent: $streamStatus.unknown">initial</p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    stateEl.createState("readonly", (s: IStateProxy) => {
      expect(s["$streamStatus.unknown"]).toBeUndefined();
      expect(s["$streamError.unknown"]).toBeUndefined();
      expect((s.$streamStatus as Record<string, unknown>).unknown).toBeUndefined();
    });
    // undefined は「状態が値を持たない＝無意見」でプロパティ書き込みがスキップされる
    // （applyChangeToProperty の undefined スキップ規約）ため、要素側の既定値が残る
    expect(shadowRoot.querySelector("#unknown")!.textContent).toBe("initial");

    host.remove();
  });

  it("葉より深い読み: primitive / null の葉を跨ぐ dotted パスが undefined 解決で throw しないこと（§4-1 寛容規約）", async () => {
    const { raw } = makeTokensState();
    const { host, stateEl } = await connectHost("", raw);

    stateEl.createState("readonly", (s: IStateProxy) => {
      // status は常に primitive 文字列 → その先の読みは undefined（Reflect.get の TypeError にしない）
      expect(s["$streamStatus.tokens.length"]).toBeUndefined();
      // error が null のときの深い読みも undefined
      expect(s["$streamError.tokens.message"]).toBeUndefined();
    });

    host.remove();
  });

  it("葉より深い読み E2E: error が primitive throw でも $streamError.<name>.message の binding が drain を壊さないこと（後続 binding 適用と $updatedCallback が生存）", async () => {
    let failRun: (() => void) | null = null;
    const updatedLog: string[][] = [];
    const raw: IState = {
      $streams: {
        broken: {
          source: () => ({
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise<IteratorResult<string>>((_resolve, reject) => {
                    // Error オブジェクトでなく primitive を throw する producer
                    failRun = () => reject("primitive-error-string");
                  }),
              };
            },
          }),
        },
      },
      $updatedCallback(paths: string[]) {
        updatedLog.push(paths);
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="msg" data-wcs="textContent: $streamError.broken.message">initial</p>` +
        `<p id="st" data-wcs="textContent: $streamStatus.broken"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();
    updatedLog.length = 0;

    failRun!();
    await flushAsync();

    // primitive の葉を跨ぐ読みは undefined 解決 → プロパティ書き込みスキップで既定表示が残る
    expect(shadowRoot.querySelector("#msg")!.textContent).toBe("initial");
    // 同一 drain の後続 binding 適用と $updatedCallback は巻き添えにならない
    // （paths は binding を持つアドレス単位: $streamError.broken の通知は
    //   walkDependency 経由で binding を持つ子パス .message として列挙される）
    expect(shadowRoot.querySelector("#st")!.textContent).toBe("error");
    expect(updatedLog.length).toBe(1);
    expect([...updatedLog[0]].sort()).toEqual([
      "$streamError.broken.message",
      "$streamStatus.broken",
    ]);

    host.remove();
  });

  it("葉より深い読み E2E: error が Error オブジェクトなら $streamError.<name>.message の binding に message が表示されること", async () => {
    const failure = new Error("stream failed");
    let failRun: (() => void) | null = null;
    const raw: IState = {
      $streams: {
        broken: {
          source: () => ({
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise<IteratorResult<string>>((_resolve, reject) => {
                    failRun = () => reject(failure);
                  }),
              };
            },
          }),
        },
      },
    };
    const { host, shadowRoot } = await connectHost(
      `<p id="msg" data-wcs="textContent: $streamError.broken.message"></p>`,
      raw,
    );
    await State.getBindingsReady(shadowRoot);
    await flushAsync();

    failRun!();
    await flushAsync();

    // Error は object なので葉より深い読みが成立する（message が表示される）
    expect(shadowRoot.querySelector("#msg")!.textContent).toBe("stream failed");

    host.remove();
  });

  it("未知の $ プロパティは従来どおり undefined を返すこと（フォールスルーの範囲確認）", async () => {
    const { raw } = makeTokensState();
    const { host, stateEl } = await connectHost("", raw);

    stateEl.createState("readonly", (s: IStateProxy) => {
      // stream プレフィックスに一致しない未知 $ プロパティは undefined のまま
      // （getResolvedAddress へフォールスルーさせない既存挙動の保存）
      expect(s.$unknownNamespace).toBeUndefined();
      expect(s["$unknown.dotted"]).toBeUndefined();
    });

    host.remove();
  });
});
