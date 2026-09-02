/**
 * occurrence（wc-bindable `semantics: "event"`）の element → state 書き込み統合テスト。
 *
 * same-value guard（config.sameValueGuard・既定 ON）は primitive が Object.is 同値なら
 * set / 依存伝播 / DOM 適用 / $updatedCallback をまるごとスキップする。current value には
 * 正しい最適化だが、occurrence に適用すると「もう一度起きた」が消える。
 * producer が `semantics: "event"` を宣言した property だけガードを迂回することを固定する。
 *
 * 併せて、宣言の無い property（未指定 = 現行動作維持）はガードが効いたままであること、
 * 迂回が当該 write 1 回に閉じていること（内側の同値 set まで素通ししない）も固定する。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import type { IWcBindable } from "../src/event/types";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

const OCCURRENCE_TAG = "occ-write-source";
const PLAIN_TAG = "occ-write-plain";

function defineElements(): void {
  if (!customElements.get(OCCURRENCE_TAG)) {
    class C extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [
          { name: "message", event: "occ:message", semantics: "event" },
        ],
      };
      message: string | null = null;
    }
    customElements.define(OCCURRENCE_TAG, C);
  }
  if (!customElements.get(PLAIN_TAG)) {
    class C extends HTMLElement {
      static wcBindable: IWcBindable = {
        protocol: "wc-bindable",
        version: 1,
        // semantics 未宣言 = 未指定。読み手は従来どおり振る舞う。
        properties: [{ name: "message", event: "plain:message" }],
      };
      message: string | null = null;
    }
    customElements.define(PLAIN_TAG, C);
  }
}

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`occ-host-${seq++}`);
  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = innerHTML + `<wcs-state></wcs-state>`;
  document.body.appendChild(host);
  const stateEl = shadowRoot.querySelector("wcs-state") as State;
  stateEl.setInitialState(initial);
  await stateEl.connectedCallbackPromise;
  await State.getBindingsReady(shadowRoot);
  const stateElement = getStateElement(shadowRoot)!;
  return { host, shadowRoot, stateElement };
}

describe("occurrence 書き込み (integration)", () => {
  beforeAll(() => {
    defineElements();
  });

  it('semantics: "event" は同一 primitive payload の再発火でも state 更新が届くこと', async () => {
    const calls: string[][] = [];
    const { host, shadowRoot } = await mount(
      {
        received: "",
        $updatedCallback(paths: string[]) { calls.push(paths); },
      },
      `<${OCCURRENCE_TAG} data-wcs="message: received"></${OCCURRENCE_TAG}>`,
    );
    const source = shadowRoot.querySelector(OCCURRENCE_TAG) as HTMLElement;
    calls.length = 0;

    source.dispatchEvent(new CustomEvent("occ:message", { detail: "ping" }));
    await flush();
    source.dispatchEvent(new CustomEvent("occ:message", { detail: "ping" }));
    await flush();

    expect(calls.length).toBe(2);
    expect(calls.every((paths) => paths.includes("received"))).toBe(true);
    host.remove();
  });

  it("ネストパス（setByAddress の fast path）でも同値の再発火が届くこと", async () => {
    const calls: string[][] = [];
    const { host, shadowRoot } = await mount(
      {
        inbox: { received: "" },
        $updatedCallback(paths: string[]) { calls.push(paths); },
      },
      `<${OCCURRENCE_TAG} data-wcs="message: inbox.received"></${OCCURRENCE_TAG}>`,
    );
    const source = shadowRoot.querySelector(OCCURRENCE_TAG) as HTMLElement;
    calls.length = 0;

    source.dispatchEvent(new CustomEvent("occ:message", { detail: "ping" }));
    await flush();
    source.dispatchEvent(new CustomEvent("occ:message", { detail: "ping" }));
    await flush();

    expect(calls.length).toBe(2);
    expect(calls.every((paths) => paths.includes("inbox.received"))).toBe(true);
    host.remove();
  });

  it("semantics 未宣言なら同値ガードが効いたままであること（未指定 = 現行動作維持）", async () => {
    const calls: string[][] = [];
    const { host, shadowRoot } = await mount(
      {
        received: "",
        $updatedCallback(paths: string[]) { calls.push(paths); },
      },
      `<${PLAIN_TAG} data-wcs="message: received"></${PLAIN_TAG}>`,
    );
    const source = shadowRoot.querySelector(PLAIN_TAG) as HTMLElement;
    calls.length = 0;

    source.dispatchEvent(new CustomEvent("plain:message", { detail: "ping" }));
    await flush();
    source.dispatchEvent(new CustomEvent("plain:message", { detail: "ping" }));
    await flush();

    expect(calls.length).toBe(1);
    host.remove();
  });

  it("異なる値なら両者とも従来どおり届くこと", async () => {
    const calls: string[][] = [];
    const { host, shadowRoot } = await mount(
      {
        received: "",
        $updatedCallback(paths: string[]) { calls.push(paths); },
      },
      `<${PLAIN_TAG} data-wcs="message: received"></${PLAIN_TAG}>`,
    );
    const source = shadowRoot.querySelector(PLAIN_TAG) as HTMLElement;
    calls.length = 0;

    source.dispatchEvent(new CustomEvent("plain:message", { detail: "a" }));
    await flush();
    source.dispatchEvent(new CustomEvent("plain:message", { detail: "b" }));
    await flush();

    expect(calls.length).toBe(2);
    host.remove();
  });

  it("迂回は当該 write 1 回に閉じ、$updatedCallback 内の同値 set には波及しないこと", async () => {
    const calls: string[][] = [];
    const { host, shadowRoot, stateElement } = await mount(
      {
        received: "",
        other: "fixed",
        $updatedCallback(this: any, paths: string[]) {
          calls.push(paths);
          // occurrence write の内側。トークンは既に消費済みなので、ここでの
          // 同値 set は従来どおりガードされる（= 次の flush を誘発しない）。
          this.other = "fixed";
        },
      },
      `<${OCCURRENCE_TAG} data-wcs="message: received"></${OCCURRENCE_TAG}>`,
    );
    const source = shadowRoot.querySelector(OCCURRENCE_TAG) as HTMLElement;
    calls.length = 0;

    source.dispatchEvent(new CustomEvent("occ:message", { detail: "ping" }));
    await flush();
    await flush();

    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("received");
    expect(calls[0]).not.toContain("other");

    // 通常の API 経由の同値 set もガードされたまま
    calls.length = 0;
    stateElement.createState("writable", (s: any) => { s.received = "ping"; });
    await flush();
    expect(calls.length).toBe(0);

    host.remove();
  });
});
