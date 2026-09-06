import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { bootstrapState } from "../src/bootstrapState";
import { isOrchestratedSsr } from "../src/config";
import { getBindingsReady } from "../src/stateElementByName";
import {
  buildSsrDocument,
  registerSsrSnapshotBuilder,
  _unregisterSsrSnapshotBuilder,
} from "../src/buildSsrDocument";
import { getSsrSnapshotBuilder, SSR_SNAPSHOT_BUILDER_KEY } from "../src/protocol/ssrSnapshot";

// ssr-snapshot プロトコル（docs/ssr-router-design.md §5）:
// <wcs-ssr> 生成をサーバー主導の最終パスへ回す orchestrated モード。
// connectedCallback 内の inline 生成が持つ「後から挿入された内容の構造
// テンプレートを取り逃がす」レースの構造的解消。

beforeAll(() => {
  bootstrapState();
});

describe("isOrchestratedSsr()", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-wcs-server");
  });

  it("data-wcs-server が無ければ false", () => {
    expect(isOrchestratedSsr()).toBe(false);
  });

  it('data-wcs-server=""（旧 server）は false', () => {
    document.documentElement.setAttribute("data-wcs-server", "");
    expect(isOrchestratedSsr()).toBe(false);
  });

  it('data-wcs-server="orchestrated" は true', () => {
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
    expect(isOrchestratedSsr()).toBe(true);
  });

  it("documentElement が無い場合は false（inSsr と同じ防衛）", () => {
    const spy = vi.spyOn(document, "documentElement", "get").mockReturnValue(null as unknown as HTMLElement);
    expect(isOrchestratedSsr()).toBe(false);
    spy.mockRestore();
  });
});

describe("registerSsrSnapshotBuilder()", () => {
  it("bootstrapState が builder をグローバル symbol へ登録している", () => {
    const builder = getSsrSnapshotBuilder();
    expect(builder).not.toBeNull();
    expect(builder!.protocol).toBe("wcs-ssr-snapshot");
    expect(builder!.version).toBeGreaterThanOrEqual(1);
    expect(typeof builder!.build).toBe("function");
  });

  it("先客が居る場合は譲る（binder と同じ規範）", () => {
    const globals = globalThis as Record<symbol, unknown>;
    const original = globals[SSR_SNAPSHOT_BUILDER_KEY];
    _unregisterSsrSnapshotBuilder();
    try {
      const senior = { protocol: "wcs-ssr-snapshot", version: 1, build: () => {} };
      globals[SSR_SNAPSHOT_BUILDER_KEY] = senior;
      registerSsrSnapshotBuilder();
      expect(globals[SSR_SNAPSHOT_BUILDER_KEY]).toBe(senior);
    } finally {
      globals[SSR_SNAPSHOT_BUILDER_KEY] = original;
    }
  });

  it("_unregisterSsrSnapshotBuilder は自分の登録だけを外す", () => {
    const globals = globalThis as Record<symbol, unknown>;
    const original = globals[SSR_SNAPSHOT_BUILDER_KEY];
    try {
      _unregisterSsrSnapshotBuilder();
      expect(getSsrSnapshotBuilder()).toBeNull();
      // 他者の登録は外さない
      const other = { protocol: "wcs-ssr-snapshot", version: 1, build: () => {} };
      globals[SSR_SNAPSHOT_BUILDER_KEY] = other;
      _unregisterSsrSnapshotBuilder();
      expect(globals[SSR_SNAPSHOT_BUILDER_KEY]).toBe(other);
    } finally {
      globals[SSR_SNAPSHOT_BUILDER_KEY] = original;
    }
  });
});

describe("orchestrated モードの inline 生成スキップと最終パス", () => {
  beforeEach(() => {
    document.documentElement.setAttribute("data-wcs-server", "orchestrated");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-wcs-server");
    document.body.innerHTML = "";
  });

  it("orchestrated では connectedCallback が <wcs-ssr> を生成しない", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"count":42}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    expect(document.querySelector("wcs-ssr")).toBeNull();
  });

  it("buildSsrDocument が最終パスとして <wcs-ssr> を生成する", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"count":42}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    buildSsrDocument(document);

    const ssrEl = document.querySelector("wcs-ssr");
    expect(ssrEl).not.toBeNull();
    expect(ssrEl!.nextElementSibling?.tagName.toLowerCase()).toBe("wcs-state");
    const data = JSON.parse(
      ssrEl!.querySelector('script[type="application/json"]')!.textContent!
    );
    expect(data.count).toBe(42);
  });

  it("最終パスは構造テンプレート（for）を wcs-ssr に格納する", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"items":[{"name":"Alice"}]}'></wcs-state>
      <template data-wcs="for: items">
        <li data-wcs="textContent: .name"></li>
      </template>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    buildSsrDocument(document);

    const ssrEl = document.querySelector("wcs-ssr");
    expect(ssrEl).not.toBeNull();
    expect(ssrEl!.querySelector("template[id]")).not.toBeNull();
  });

  it("生成済みの state はスキップする（冪等性）", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"x":1}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    buildSsrDocument(document);
    buildSsrDocument(document);

    expect(document.querySelectorAll("wcs-ssr").length).toBe(1);
  });

  it("enable-ssr の無い state には生成しない", async () => {
    document.body.innerHTML = `
      <wcs-state json='{"x":1}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    buildSsrDocument(document);

    expect(document.querySelector("wcs-ssr")).toBeNull();
  });

  it("ボリューム（mount= + enable-ssr）は最終パスの対象外 — <wcs-ssr> はルートの 1 本だけ（D14）", async () => {
    // 旧挙動: ボリュームにも空の <wcs-ssr> が生成され、先頭一致の Ssr.find が
    // ルートより前の空スナップショットを掴んでハイドレーションが無言で CSR 退化していた
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      document.body.innerHTML = `
        <wcs-state enable-ssr mount="cfg" json='{"value":1}'></wcs-state>
        <wcs-state enable-ssr json='{"count":7}'></wcs-state>
      `;
      const elements = Array.from(document.querySelectorAll("wcs-state")) as any[];
      const volumeEl = elements[0];
      const rootEl = elements[1];
      await rootEl.connectedCallbackPromise;
      await volumeEl.connectedCallbackPromise;
      await getBindingsReady(document);
      await new Promise((r) => setTimeout(r));

      buildSsrDocument(document);

      const ssrEls = document.querySelectorAll("wcs-ssr");
      expect(ssrEls.length).toBe(1);
      // ルート直前の 1 本（Ssr.find がルートのデータに到達できる位置）
      expect(ssrEls[0].nextElementSibling).toBe(rootEl);
      const data = JSON.parse(
        ssrEls[0].querySelector('script[type="application/json"]')!.textContent!
      );
      expect(data.count).toBe(7);
    } finally {
      warn.mockRestore();
    }
  });

  it("直前に先客の <wcs-ssr> が居れば生成しない（v2: 名前次元は無い — 直前の存在だけを見る）", async () => {
    document.body.innerHTML = `
      <wcs-ssr></wcs-ssr>
      <wcs-state enable-ssr json='{"items":[]}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    buildSsrDocument(document);

    expect(document.querySelectorAll("wcs-ssr").length).toBe(1);
  });
});

describe("非 orchestrated（旧 server 相当）の後方互換", () => {
  beforeEach(() => {
    document.documentElement.setAttribute("data-wcs-server", "");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-wcs-server");
    document.body.innerHTML = "";
  });

  it("値が空なら inline 生成が従来どおり働く", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"count":1}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    expect(document.querySelector("wcs-ssr")).not.toBeNull();
  });

  it("inline 生成済みの document に最終パスを重ねても二重生成しない", async () => {
    document.body.innerHTML = `
      <wcs-state enable-ssr json='{"count":1}'></wcs-state>
    `;
    const stateEl = document.querySelector("wcs-state") as any;
    await stateEl.connectedCallbackPromise;
    await getBindingsReady(document);

    buildSsrDocument(document);

    expect(document.querySelectorAll("wcs-ssr").length).toBe(1);
  });
});
