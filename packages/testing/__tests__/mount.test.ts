import { describe, it, expect, afterEach } from "vitest";
import { mount, settle, fire } from "../src/exports";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("mount — README レシピを 1 呼び出しに", () => {
  it("json state: 初期描画 → write → settle → 再描画 → unmount", async () => {
    const app = await mount(`
      <wcs-state json='{"count": 1, "items": ["apple", "banana"]}'></wcs-state>
      <p id="count" data-wcs="textContent: count"></p>
      <ul id="items"><template data-wcs="for: items"><li data-wcs="textContent: items.*"></li></template></ul>
    `);
    expect(app.root).toBe(document);
    expect(app.container).toBe(document.body);
    expect(app.root.querySelector("#count")!.textContent).toBe("1");
    expect(app.root.querySelectorAll("#items li").length).toBe(2);

    await app.state().write((s) => {
      s.count = 42;
      s.items = [...s.items, "cherry"];
    });
    await settle();
    expect(app.root.querySelector("#count")!.textContent).toBe("42");
    expect(app.root.querySelectorAll("#items li").length).toBe(3);
    expect(app.state().read((s) => s.count)).toBe(42);

    app.unmount();
    expect(document.body.innerHTML).toBe("");
  });

  it("インライン <script type=\"module\"> の state（メソッド付き）を読み込み、fire でハンドラが走る", async () => {
    const app = await mount(`
      <wcs-state>
        <script type="module">
          export default { count: 5, up() { this.count++; } };
        </script>
      </wcs-state>
      <p id="count" data-wcs="textContent: count"></p>
      <button id="up" data-wcs="onclick: up">+1</button>
    `);
    expect(app.root.querySelector("#count")!.textContent).toBe("5");
    expect(fire(app.root.querySelector("#up")!, "click")).toBe(true);
    await settle();
    expect(app.root.querySelector("#count")!.textContent).toBe("6");
  });

  it("state(): 引数は v2 で撤去（1 root 1 ツリー）— name 指定は移行ヒント付きで throw", async () => {
    const app = await mount(`
      <wcs-state json='{"a": 1}'></wcs-state>
      <p id="a" data-wcs="textContent: a"></p>
    `);
    expect(app.state().read((s) => s.a)).toBe(1);
    expect(() => (app.state as (name?: string) => unknown)("other")).toThrow(/removed in v2/);
    expect(() => (app.state as (name?: string) => unknown)("other")).toThrow(/mount=/);
    app.unmount();
    const empty = await mount("<p></p>");
    expect(() => empty.state()).toThrow(/no <wcs-state>/);
  });

  it("state(): mount= のボリュームが混在してもルートツリーの <wcs-state> を返す（v2 の選別）", async () => {
    // ボリュームを文書順でルートより前に置く — 選別が「最初の <wcs-state>」だと
    // ボリュームを掴んでしまう形
    const app = await mount(`
      <wcs-state mount="cfg" json='{"flag": true}'></wcs-state>
      <wcs-state json='{"count": 7}'></wcs-state>
      <p id="count" data-wcs="textContent: count"></p>
      <p id="flag" data-wcs="textContent: cfg.flag"></p>
    `);
    const handle = app.state();
    expect(handle.element.hasAttribute("mount")).toBe(false);
    // ルートの読み書きと、接ぎ木されたボリュームのパス読みが同じハンドルで通る
    expect(handle.read((s) => s.count)).toBe(7);
    expect(handle.read((s) => (s as Record<string, unknown>)["cfg.flag"])).toBe(true);
    app.unmount();
  });

  it("root: 'shadow' は host の ShadowRoot に流し込み、バインドはその root に閉じる", async () => {
    const app = await mount(`
      <wcs-state json='{"msg": "in shadow"}'></wcs-state>
      <p id="msg" data-wcs="textContent: msg"></p>
    `, { root: "shadow" });
    expect(app.root).not.toBe(document);
    expect(app.container.getAttribute("data-wcs-testing-host")).toBe("");
    expect(document.body.contains(app.container)).toBe(true);
    expect(app.root.querySelector("#msg")!.textContent).toBe("in shadow");
    expect(document.querySelector("#msg")).toBeNull();
    app.unmount();
    expect(document.body.contains(app.container)).toBe(false);
  });

  it("bootstrap: 追加の登録関数（同期 / 非同期ローダー）を走らせ、readiness プロトコルの要素を待つ", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const calls: string[] = [];
    const bootstrapSlow = () => {
      calls.push("slow");
      if (customElements.get("t-slow") !== undefined) return;
      class Slow extends HTMLElement {
        static hasConnectedCallbackPromise = true;
        get connectedCallbackPromise(): Promise<void> { return ready; }
      }
      customElements.define("t-slow", Slow);
    };
    const bootstrapAsync = async () => { calls.push("async"); };

    let mounted = false;
    const mounting = mount(`<t-slow></t-slow><wcs-state json='{"x": 1}'></wcs-state><i data-wcs="textContent: x"></i>`, {
      bootstrap: [async () => (await import("@wcstack/state")).bootstrapState(), bootstrapSlow, bootstrapAsync],
    }).then((app) => { mounted = true; return app; });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["slow", "async"]);
    expect(mounted).toBe(false);
    resolveReady();
    const app = await mounting;
    expect(app.root.querySelector("i")!.textContent).toBe("1");
  });

  it("数値 0 の textContent / innerText がブラウザ同様 \"0\" になる（happy-dom の setter シム）", async () => {
    const app = await mount(`
      <wcs-state json='{"n": 1}'></wcs-state>
      <p id="t" data-wcs="textContent: n"></p>
      <p id="i" data-wcs="innerText: n"></p>
    `);
    await app.state().write((s) => { s.n = 0; });
    await settle();
    expect(app.root.querySelector("#t")!.textContent).toBe("0");
    expect((app.root.querySelector("#i") as HTMLElement).innerText).toBe("0");
    // 素の代入も同じ規則（null は空、それ以外は String）
    const p = document.createElement("p");
    (p as any).textContent = 0;
    expect(p.textContent).toBe("0");
    (p as any).textContent = null;
    expect(p.textContent).toBe("");
    // 二重適用しない（同じプロトタイプは 1 回だけ包む）
    const before = Object.getOwnPropertyDescriptor(Element.prototype, "textContent")!.set;
    await mount("<p></p>");
    expect(Object.getOwnPropertyDescriptor(Element.prototype, "textContent")!.set).toBe(before);
  });

  it("stateTagName: bootstrapState で改名した state タグを引ける", async () => {
    const { bootstrapState } = await import("@wcstack/state");
    const app = await mount(`<wcs-state json='{"n": 7}'></wcs-state><b data-wcs="textContent: n"></b>`, {
      bootstrap: [bootstrapState],
      stateTagName: "wcs-state",
    });
    expect(app.state().read((s) => s.n)).toBe(7);
  });
});
