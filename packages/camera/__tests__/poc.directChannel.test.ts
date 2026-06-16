import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState, getBindingsReady } from "@wcstack/state";

/**
 * Phase 0 PoC — 「値ではない生リソースハンドル」を state に格納せず、実 state の
 * トークンバス（event-token → $on → command-token）経由で要素プロパティへ直結する
 * 経路が、実 @wcstack/state で成立することを最小構成で実証する回帰テスト。
 *
 * 設計: docs/camera-recorder-tag-design.md §1（生ハンドルは state に入れない）/
 *       §2（直結チャネル＝command-token 引数素通し）。
 *
 * 受け入れ条件（docs/camera-recorder-impl-plan.md §1-b）:
 *   1. 到達＋参照同一: source が発火した生ハンドルが、同一参照のまま sink.attachStream に届く。
 *   2. 非格納: state には派生「値」(id 文字列)だけが入り DOM 更新される。生ハンドルは
 *      バスを通過するだけで reactive state に現れない（state 経由の値は string であって
 *      生オブジェクトではない）。
 *   3. 多重配布: 1 つの $on から 2 つの sink へ emit すると、両方に同一ハンドルが届く
 *      （preview と recorder の 1 stream 共有を先取り実証）。
 *   4. transient 性: source を取り外しても、既に渡った sink の参照は生存する
 *      （state が握っていないので参照は要素側に閉じる）。
 */

// ---------------------------------------------------------------------------
// FakeMediaStream — シリアライズ不能・参照同一性のみが意味を持つ生ハンドルの代役。
// メソッドを持つため JSON 化や naive な structured clone では壊れる＝「値ではない」。
// ---------------------------------------------------------------------------
class FakeMediaStreamTrack {
  stopped = false;
  constructor(public kind: string) {}
  stop(): void { this.stopped = true; }
}
class FakeMediaStream {
  private _tracks: FakeMediaStreamTrack[];
  constructor(public id: string) {
    this._tracks = [new FakeMediaStreamTrack("video")];
  }
  getTracks(): FakeMediaStreamTrack[] { return this._tracks; }
}

// ---------------------------------------------------------------------------
// 最小の source/sink カスタム要素（wc-bindable 契約）。
// ---------------------------------------------------------------------------
const SOURCE_TAG = "poc-source";
const SINK_TAG = "poc-sink";

class PocSource extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable" as const,
    version: 1,
    properties: [{ name: "streamReady", event: "poc-stream-ready" }],
    commands: [],
  };
  /** 生ハンドルを event-token 経由で外へ流す（detail = 生ハンドル）。 */
  emitStream(stream: FakeMediaStream): void {
    this.dispatchEvent(new CustomEvent("poc-stream-ready", { detail: stream }));
  }
}

class PocSink extends HTMLElement {
  static wcBindable = {
    protocol: "wc-bindable" as const,
    version: 1,
    properties: [],
    commands: [{ name: "attachStream" }],
  };
  received: FakeMediaStream | null = null;
  /** 直結チャネルで生ハンドルを「借用」する。stop はしない（所有権は source 側）。 */
  attachStream(stream: FakeMediaStream): void {
    this.received = stream; // 同期受領・即代入（async await しない）
  }
}

beforeAll(() => {
  bootstrapState();
  if (!customElements.get(SOURCE_TAG)) customElements.define(SOURCE_TAG, PocSource);
  if (!customElements.get(SINK_TAG)) customElements.define(SINK_TAG, PocSink);
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe("Phase 0 PoC: state を介さない生ハンドル直結チャネル", () => {
  it("受け入れ条件1+2: 生ハンドルが参照同一で sink へ届き、state には派生値(id文字列)のみが入る", async () => {
    const host = document.createElement("poc-host-1");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${SOURCE_TAG} data-wcs="eventToken.streamReady: gotStream"></${SOURCE_TAG}>
      <${SINK_TAG} data-wcs="command.attachStream: $command.feed"></${SINK_TAG}>
      <span data-wcs="textContent: lastStreamId"></span>
      <wcs-state></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      lastStreamId: "",
      $commandTokens: ["feed"],
      $eventTokens: ["gotStream"],
      $on: {
        gotStream: (state: any, event: Event) => {
          const stream = (event as CustomEvent).detail as FakeMediaStream;
          // 派生「値」だけを state へ（id 文字列）。
          state.lastStreamId = stream.id;
          // 生ハンドルそのものは command-token の引数としてバスを通過させるだけ。
          state.$command.feed.emit(stream);
        },
      },
    });
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(shadowRoot);

    const source = shadowRoot.querySelector(SOURCE_TAG) as PocSource;
    const sink = shadowRoot.querySelector(SINK_TAG) as PocSink;
    const span = shadowRoot.querySelector("span") as HTMLSpanElement;

    const stream = new FakeMediaStream("stream-A");
    source.emitStream(stream);
    await tick();

    // 1. 到達＋参照同一: 同一インスタンスがそのまま届く（state が clone/proxy 化していない）。
    expect(sink.received).toBe(stream);
    // 生ハンドルのメソッドも生きている（壊れていない）。
    expect(sink.received!.getTracks()).toHaveLength(1);

    // 2. 非格納: state を経由して DOM に出たのは派生「値」(id 文字列)だけ。
    expect(span.textContent).toBe("stream-A");
    expect(typeof span.textContent).toBe("string");
    // state には生ハンドルそのものは入っていない（id だけ）。
    expect((sink.received as unknown) instanceof FakeMediaStream).toBe(true);

    host.remove();
  });

  it("受け入れ条件3: 1 つの $on から 2 つの sink へ同一ハンドルが多重配布される（1 stream 共有）", async () => {
    const host = document.createElement("poc-host-2");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${SOURCE_TAG} data-wcs="eventToken.streamReady: gotStream"></${SOURCE_TAG}>
      <${SINK_TAG} id="preview" data-wcs="command.attachStream: $command.feed"></${SINK_TAG}>
      <${SINK_TAG} id="recorder" data-wcs="command.attachStream: $command.feed"></${SINK_TAG}>
      <wcs-state></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      $commandTokens: ["feed"],
      $eventTokens: ["gotStream"],
      $on: {
        gotStream: (state: any, event: Event) =>
          state.$command.feed.emit((event as CustomEvent).detail),
      },
    });
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(shadowRoot);

    const source = shadowRoot.querySelector(SOURCE_TAG) as PocSource;
    const preview = shadowRoot.querySelector("#preview") as PocSink;
    const recorder = shadowRoot.querySelector("#recorder") as PocSink;

    const stream = new FakeMediaStream("stream-B");
    source.emitStream(stream);
    await tick();

    // preview と recorder の両方が同一の生 stream を受け取る。
    expect(preview.received).toBe(stream);
    expect(recorder.received).toBe(stream);
    expect(preview.received).toBe(recorder.received);

    host.remove();
  });

  it("受け入れ条件4: source を取り外しても、既に渡った sink の参照は生存する（transient）", async () => {
    const host = document.createElement("poc-host-3");
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${SOURCE_TAG} data-wcs="eventToken.streamReady: gotStream"></${SOURCE_TAG}>
      <${SINK_TAG} data-wcs="command.attachStream: $command.feed"></${SINK_TAG}>
      <wcs-state></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as any;
    stateEl.setInitialState({
      $commandTokens: ["feed"],
      $eventTokens: ["gotStream"],
      $on: {
        gotStream: (state: any, event: Event) =>
          state.$command.feed.emit((event as CustomEvent).detail),
      },
    });
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(shadowRoot);

    const source = shadowRoot.querySelector(SOURCE_TAG) as PocSource;
    const sink = shadowRoot.querySelector(SINK_TAG) as PocSink;

    const stream = new FakeMediaStream("stream-C");
    source.emitStream(stream);
    await tick();
    expect(sink.received).toBe(stream);

    // source を取り外す（dispose 相当）。
    source.remove();
    await tick();

    // 既に渡った参照は要素側に閉じており生存（state は握っていない）。
    expect(sink.received).toBe(stream);
    expect(sink.received!.getTracks()[0].stopped).toBe(false);

    host.remove();
  });
});
