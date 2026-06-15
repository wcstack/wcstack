import { describe, it, expect, vi, afterEach } from "vitest";
// Import the REAL FetchCore from the sibling package. This is the point of the
// PoC: FetchCore is an unmodified wc-bindable node, and the adapter must consume
// it as-is. If this passes, "any existing async-IO node plugs in via one adapter"
// (docs/signals-state-design.md §3) is demonstrated, not just asserted.
import { FetchCore } from "../../fetch/src/core/FetchCore.js";
import { bindNode, nodeSource } from "../src/bindNode.js";
import { resource } from "../src/resource.js";
import { signal, effect, flushSync } from "../src/reactive.js";
import { h, render, SignalsElement } from "../src/dom.js";

type FakeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

function jsonResponse(data: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("integration: 実 FetchCore × bindNode", () => {
  it("成功レスポンスが signal に流れ、effect で DOM 更新まで通る", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ name: "Ada" })));

    const core = new FetchCore();
    const bound = bindNode(core, FetchCore.wcBindable);
    const el = document.createElement("div");

    effect(() => {
      const v = bound.signals.value.get() as { name?: string } | null;
      el.textContent = v?.name ?? "";
    });
    flushSync();
    expect(el.textContent).toBe("");

    const p = core.fetch("/api/user");
    // loading は fetch() 呼び出し時点で同期的に true 通知される
    expect(bound.signals.loading.peek()).toBe(true);

    await p;
    flushSync();

    expect(bound.signals.value.peek()).toEqual({ name: "Ada" });
    expect(bound.signals.status.peek()).toBe(200);
    expect(bound.signals.loading.peek()).toBe(false);
    expect(bound.signals.error.peek()).toBeNull();
    expect(el.textContent).toBe("Ada"); // DOM まで到達
  });

  it("HTTP エラーが error/status signal に反映される", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ msg: "nope" }, 404)));

    const core = new FetchCore();
    const bound = bindNode(core, FetchCore.wcBindable);

    await core.fetch("/api/missing");
    flushSync();

    expect(bound.signals.error.peek()).toMatchObject({ status: 404 });
    expect(bound.signals.status.peek()).toBe(404);
    expect(bound.signals.value.peek()).toBeNull();
    expect(bound.signals.loading.peek()).toBe(false);
  });

  it("resource で FetchCore を包み、args 変化で前リクエストを abort して張り直す", async () => {
    const pending: Array<{ resolve: (v: FakeResponse) => void; signal: AbortSignal }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise<FakeResponse>((resolve, reject) => {
          const sig = init.signal as AbortSignal;
          pending.push({ resolve, signal: sig });
          sig.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    const core = new FetchCore();
    const id = signal(1);
    const r = resource(
      (a: number, sig: AbortSignal) => {
        // resource の cancel を FetchCore.abort() に橋渡し
        sig.addEventListener("abort", () => core.abort());
        return core.fetch(`/api/${a}`);
      },
      { args: () => id.get() },
    );

    expect(pending.length).toBe(1); // 初回リクエスト発行
    expect(r.loading.peek()).toBe(true);

    id.set(2); // 依存変化 → 再起動
    flushSync();

    expect(pending[0].signal.aborted).toBe(true); // 旧リクエストが abort された
    expect(pending.length).toBe(2); // 新リクエストが発行された

    pending[1].resolve(jsonResponse({ id: 2 }));
    await flushAsync();

    expect(r.value.peek()).toEqual({ id: 2 });
    expect(r.loading.peek()).toBe(false);

    r.dispose();
  });

  it("nodeSource で cancel ブリッジを一般化（command 経由・PoC の sig→core.abort() を置換）", async () => {
    const pending: Array<{ resolve: (v: FakeResponse) => void; signal: AbortSignal }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise<FakeResponse>((resolve, reject) => {
          const sig = init.signal as AbortSignal;
          pending.push({ resolve, signal: sig });
          sig.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    const core = new FetchCore();
    const bound = bindNode(core); // descriptor from constructor.wcBindable
    const id = signal(1);
    // No hand-wired bridge: nodeSource routes the resource AbortSignal through the
    // node's declared `abort` command (which cancels FetchCore's AbortController).
    const r = resource(
      nodeSource(bound, (b, a: number) => b.command("fetch", `/api/${a}`) as Promise<unknown>),
      { args: () => id.get() },
    );

    expect(pending.length).toBe(1);

    id.set(2); // 依存変化 → 再起動。nodeSource の橋渡しで前リクエストが abort される
    flushSync();

    expect(pending[0].signal.aborted).toBe(true); // 実ノードの AbortSignal が aborted
    expect(pending.length).toBe(2);

    pending[1].resolve(jsonResponse({ id: 2 }));
    await flushAsync();
    r.dispose();
  });

  it("FetchCore の signal を h で DOM 構築する（loading 切替＋リスト描画）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(["Ada", "Linus", "Grace"])));

    const core = new FetchCore();
    const bound = bindNode(core, FetchCore.wcBindable);

    // signal/resource/bindNode の出力を h でそのまま DOM に組む
    const view = h(
      "div",
      null,
      () => (bound.signals.loading.get() ? h("p", { class: "spinner" }, "loading...") : null),
      h(
        "ul",
        null,
        () => ((bound.signals.value.get() as string[] | null) ?? []).map((name) => h("li", null, name)),
      ),
    ) as HTMLElement;

    const host = document.createElement("div");
    render(view, host);
    flushSync();
    expect(host.querySelectorAll("li").length).toBe(0);

    const p = core.fetch("/api/people");
    flushSync();
    expect(host.querySelector(".spinner")?.textContent).toBe("loading..."); // loading 中

    await p;
    flushSync();
    expect(host.querySelector(".spinner")).toBeNull(); // loading 解除
    expect([...host.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Ada",
      "Linus",
      "Grace",
    ]);
  });

  it("フルスタック: SignalsElement が connect で resource を起動し、disconnect で fetch を abort する", async () => {
    const pending: Array<{ resolve: (v: FakeResponse) => void; signal: AbortSignal }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise<FakeResponse>((resolve, reject) => {
          const sig = init.signal as AbortSignal;
          pending.push({ resolve, signal: sig });
          sig.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    class PeopleElement extends SignalsElement {
      core = new FetchCore();
      protected render(): Node {
        // resource は render（createRoot 配下）で生成 → 要素が所有する
        const r = resource((_a: void, sig: AbortSignal) => {
          sig.addEventListener("abort", () => this.core.abort());
          return this.core.fetch("/api/people");
        });
        return h(
          "ul",
          null,
          () => (r.loading.get() ? h("li", { class: "loading" }, "...") : null),
          () => ((r.value.get() as string[] | null) ?? []).map((n) => h("li", null, n)),
        );
      }
    }
    customElements.define("wcs-people-test", PeopleElement);

    const el = document.createElement("wcs-people-test") as PeopleElement;
    document.body.appendChild(el); // connect → resource 起動 → fetch in-flight
    flushSync();
    expect(pending.length).toBe(1);
    expect(el.querySelector(".loading")?.textContent).toBe("..."); // loading 表示

    el.remove(); // disconnect → root dispose → resource abort → core.abort → fetch abort
    expect(pending[0].signal.aborted).toBe(true);
    expect(el.children.length).toBe(0); // mountPoint クリア

    // abort 済みリクエストの後始末（unhandled rejection を出さない）
    await flushAsync();
  });
});
