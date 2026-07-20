import { describe, it, expect, beforeAll } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";

beforeAll(() => {
  bootstrapState();
});

let counter = 0;
function uniqueTag(prefix: string): string {
  return `${prefix}-${++counter}`;
}

async function flushUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * 初期 authority は初期同期のみを支配する（docs/architecture-hardening/09 §3.6）の
 * 統合検証。storage 型シナリオ = 要素が bind 前に永続値をロード済みで、
 * `#init=element` が (1) 初期は要素値を state へ pull し、(2) 以降は通常の
 * two-way（state→element の保存方向が生きる）ことを実 state で固定する。
 * 旧実装は resolvedAuthority を定常ゲートにも使い、(2) を恒久ブロックしていた
 * （= `<wcs-storage>` の保存が死ぬため #init= で clobber を解決できなかった）。
 */
describe("initial authority governs initial sync only (integration)", () => {
  it("two-way member + #init=element: 初期 pull 後も state→element が流れること", async () => {
    const tag = uniqueTag("x-fake-store");
    // define を innerHTML より先に行い happy-dom の upgrade ノード差し替えを回避
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "value", event: `${tag}:value-changed` }],
        inputs: [{ name: "value" }],
      };
      _value: unknown = "persisted";
      get value(): unknown { return this._value; }
      set value(v: unknown) {
        this._value = v;
        this.dispatchEvent(new CustomEvent(`${tag}:value-changed`, { detail: v }));
      }
    });

    const host = document.createElement(uniqueTag("x-init-auth-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="store" data-wcs="value#init=element: saved"></${tag}>
      <input id="editor" data-wcs="value: saved">
      <span id="mirror" data-wcs="textContent: saved"></span>
      <wcs-state json='{"saved": null}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flushUpdates();

    const store = shadowRoot.querySelector("#store") as any;
    const editor = shadowRoot.querySelector("#editor") as HTMLInputElement;
    const mirror = shadowRoot.querySelector("#mirror") as HTMLElement;

    // (1) 初期同期: state 初期値 (null) は要素へ書かれず、要素の永続値が state へ pull される
    expect(store.value).toBe("persisted");
    expect(mirror.textContent).toBe("persisted");

    // (2) 定常: state の変更が要素へ届く（保存方向）。旧実装ではここが恒久ブロック
    editor.value = "next";
    editor.dispatchEvent(new Event("input"));
    await flushUpdates();
    expect(store.value).toBe("next");
    expect(mirror.textContent).toBe("next");

    // (3) 定常: 要素→state も通常どおり（two-way の対称性）
    store.value = "changed-by-element";
    await flushUpdates();
    expect(mirror.textContent).toBe("changed-by-element");

    host.remove();
  });

  it("output-only member は定常でも state→element が届かないこと（契約の維持）", async () => {
    const tag = uniqueTag("x-fake-monitor");
    customElements.define(tag, class extends HTMLElement {
      static wcBindable = {
        protocol: "wc-bindable",
        version: 1,
        properties: [{ name: "count", event: `${tag}:count-changed` }],
      };
      count: unknown = 7;
    });

    const host = document.createElement(uniqueTag("x-init-auth-host"));
    const shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <${tag} id="monitor" data-wcs="count: n"></${tag}>
      <input id="editor" data-wcs="value: n">
      <span id="mirror" data-wcs="textContent: n"></span>
      <wcs-state json='{"n": 0}'></wcs-state>
    `;
    document.body.appendChild(host);

    const stateEl = shadowRoot.querySelector("wcs-state") as State;
    await stateEl.connectedCallbackPromise;
    await State.getBindingsReady(shadowRoot);
    await flushUpdates();

    const monitor = shadowRoot.querySelector("#monitor") as any;
    const editor = shadowRoot.querySelector("#editor") as HTMLInputElement;
    const mirror = shadowRoot.querySelector("#mirror") as HTMLElement;

    // 初期: element authority で要素の現在値が state へ pull される
    expect(mirror.textContent).toBe("7");

    // 定常: state を変えても output-only member へは書かれない
    editor.value = "5";
    editor.dispatchEvent(new Event("input"));
    await flushUpdates();
    expect(mirror.textContent).toBe("5");
    expect(monitor.count).toBe(7);

    host.remove();
  });
});
