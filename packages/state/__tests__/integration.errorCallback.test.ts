/**
 * `$errorCallback(error, info)` の統合テスト — 実際の `<wcs-state>` と `data-wcs` で、
 * バインディング適用の失敗（bound path の getter が throw）がページ内へ届くことを固定する。
 *
 * 規範:
 * - 宣言があれば console.error の代わりに (error, info) で呼ばれる。値と DOM は巻き戻さない
 * - this は writable な state proxy — ここで自分の state にエラーを書けば、通常のバインドで描ける
 * - 宣言が無ければ従来どおり console.error（挙動不変）
 * - callback 自身の throw は隔離され、drain は壊れない
 */
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { State } from "../src/components/State";
import { getStateElement } from "../src/stateElementByName";
import type { IBindingErrorInfo } from "../src/types";

beforeAll(() => {
  bootstrapState();
});

let seq = 0;
const flush = () => new Promise((r) => setTimeout(r));

async function mount(initial: any, innerHTML: string) {
  const host = document.createElement(`err-cb-host-${seq++}`);
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

describe("$errorCallback (integration)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bound path の getter が throw すると、console.error の代わりに (error, info) で呼ばれ、this から state に書けること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: Array<{ error: unknown; info: IBindingErrorInfo }> = [];
    const { host, shadowRoot, stateElement } = await mount(
      {
        n: 0,
        lastError: "",
        get label() {
          if (this.n > 0) throw new Error("boom");
          return "ok";
        },
        $errorCallback(error: unknown, info: IBindingErrorInfo) {
          received.push({ error, info });
          this.lastError = `${info.bindingType}:${info.path} → ${(error as Error).message}`;
        },
      },
      `<span id="label" data-wcs="textContent: label"></span>` +
      `<span id="err" data-wcs="textContent: lastError"></span>`,
    );
    const label = shadowRoot.getElementById("label")!;
    const err = shadowRoot.getElementById("err")!;
    expect(label.textContent).toBe("ok");
    expect(received).toHaveLength(0);

    stateElement.createState("writable", (state) => { state.n = 1; });
    await flush();

    expect(received).toHaveLength(1);
    expect((received[0].error as Error).message).toBe("boom");
    expect(received[0].info.path).toBe("label");
    expect(received[0].info.bindingType).toBe("prop");
    expect(received[0].info.node).toBeInstanceOf(Node);
    // 値と DOM は巻き戻さない — 失敗したバインドは前の表示のまま
    expect(label.textContent).toBe("ok");
    // this は writable proxy: callback からの書き込みが通常のバインドで描かれる
    await flush();
    expect(err.textContent).toBe("prop:label → boom");
    // 作者が報告を引き取ったので console.error は出ない
    expect(errorSpy).not.toHaveBeenCalled();
    host.remove();
  });

  it("$errorCallback が無い state は従来どおり console.error に報告すること", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host, stateElement } = await mount(
      {
        n: 0,
        get label() {
          if (this.n > 0) throw new Error("boom");
          return "ok";
        },
      },
      `<span data-wcs="textContent: label"></span>`,
    );

    stateElement.createState("writable", (state) => { state.n = 1; });
    await flush();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('binding "prop: label" failed to apply');
    host.remove();
  });

  it("$errorCallback 自身が throw しても隔離され、後続の更新は届くこと", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const { host, shadowRoot, stateElement } = await mount(
      {
        n: 0,
        other: "a",
        get label() {
          if (this.n > 0) throw new Error("boom");
          return "ok";
        },
        $errorCallback() {
          calls++;
          throw new Error("handler broke");
        },
      },
      `<span data-wcs="textContent: label"></span><span id="other" data-wcs="textContent: other"></span>`,
    );

    stateElement.createState("writable", (state) => { state.n = 1; });
    await flush();

    expect(calls).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("$errorCallback threw");

    stateElement.createState("writable", (state) => { state.other = "b"; });
    await flush();
    expect(shadowRoot.getElementById("other")!.textContent).toBe("b");
    host.remove();
  });
});
