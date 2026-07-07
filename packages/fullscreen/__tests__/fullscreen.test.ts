import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { WcsFullscreen } from "../src/components/Fullscreen.js";
import { FullscreenCore } from "../src/core/FullscreenCore.js";
import {
  stubRequestFullscreen,
  stubRequestFullscreenOnElementPrototype,
  stubExitFullscreen,
  removeRequestFullscreen,
  setFullscreenElement,
  clearFullscreenElement,
  resetFullscreenEnvironment,
} from "./mocks";

// Custom elements can only be registered once per tag name; define it up front
// and reuse across tests (mirrors intersection/network's bootstrap pattern).
beforeAll(() => {
  if (!customElements.get("wcs-fullscreen")) {
    customElements.define("wcs-fullscreen", WcsFullscreen);
  }
});

function makeEl(attrs: Record<string, string> = {}, innerHTML = ""): WcsFullscreen {
  const el = document.createElement("wcs-fullscreen") as WcsFullscreen;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (innerHTML) el.innerHTML = innerHTML;
  return el;
}

describe("<wcs-fullscreen>", () => {
  afterEach(() => {
    resetFullscreenEnvironment();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("target 解決と display", () => {
    it("target 省略 + 子あり → 最初の子要素が対象、display:contents", async () => {
      const el = makeEl({}, "<img>");
      document.body.appendChild(el);
      const child = el.firstElementChild!;
      stubRequestFullscreen(child);

      expect(el.style.display).toBe("contents");
      await el.requestFullscreen();
      expect(el.active).toBe(true);
    });

    it("target 省略 + 子なし → 自分自身が対象、display:block、コマンドで fullscreen 化できる", async () => {
      // 対象が Shell 自身になるモード。API は実ブラウザと同じく Element.prototype
      // に置き、Shell の requestFullscreen() コマンド経路を実際に通す
      // （インスタンスへのスタブ直付けはコマンドメソッドをシャドウしてしまい、
      // コマンド経路を検証できない）。
      const restore = stubRequestFullscreenOnElementPrototype();
      try {
        const el = makeEl();
        document.body.appendChild(el);

        expect(el.style.display).toBe("block");
        await el.requestFullscreen();
        expect(el.error).toBeNull();
        expect(el.active).toBe(true);
      } finally {
        restore();
      }
    });

    it('target="self" → 自分自身が対象、display:block、コマンドで fullscreen 化できる（無限再帰しない）', async () => {
      // 回帰テスト: Shell 自身が requestFullscreen() コマンドメソッドを持つため、
      // Core が素の el.requestFullscreen 参照で API を解決すると Shell のコマンド
      // を拾って無限再帰（スタックオーバーフロー）していた。Core は Element.prototype
      // を直接参照してサブクラスのシャドウを回避しなければならない。
      const restore = stubRequestFullscreenOnElementPrototype();
      try {
        const el = makeEl({ target: "self" });
        document.body.appendChild(el);

        expect(el.style.display).toBe("block");
        await el.requestFullscreen();
        expect(el.error).toBeNull();
        expect(el.active).toBe(true);
      } finally {
        restore();
      }
    });

    it("target=セレクタ → 参照先要素が対象、display:none", async () => {
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      stubRequestFullscreen(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);

      expect(el.style.display).toBe("none");
      await el.requestFullscreen();
      expect(el.active).toBe(true);
    });

    it("target=セレクタが未マッチ → 対象なし、display:none、requestFullscreen は「未解決」の error（「未対応」とは別メッセージ）", async () => {
      const el = makeEl({ target: "#missing" });
      document.body.appendChild(el);

      expect(el.style.display).toBe("none");
      await el.requestFullscreen();
      expect(el.error).toEqual({ message: "Fullscreen target could not be resolved." });
    });

    it("target=不正セレクタ → throw せず未解決扱い（never-throw）", () => {
      const el = makeEl({ target: ":::" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      expect(el.style.display).toBe("none");
    });
  });

  describe("requestFullscreen()/exitFullscreen() コマンド", () => {
    // Note: target="self" 経路（対象 = Shell 自身）は上の「target 解決と display」
    // で Element.prototype スタブを使って検証済み。ここでは target=セレクタで
    // 「Shell とは別の要素」を対象に、インスタンス単位のスタブで挙動の
    // バリエーション（reject/レガシー/unsupported）を検証する。
    it("成功時に active が true になる", async () => {
      const hero = document.createElement("div");
      hero.id = "hero";
      document.body.appendChild(hero);
      stubRequestFullscreen(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);

      await el.requestFullscreen();

      expect(el.active).toBe(true);
      expect(el.error).toBeNull();
    });

    it("gesture 外呼び出し想定の TypeError で never-throw・error に格納", async () => {
      // WHATWG 仕様の transient-activation チェックは TypeError で reject する
      // (NotAllowedError ではない)。
      const hero = document.createElement("div");
      hero.id = "hero";
      document.body.appendChild(hero);
      const gestureError = new TypeError(
        "Failed to execute 'requestFullscreen' on 'Element': API can only be initiated by a user gesture.",
      );
      stubRequestFullscreen(hero, { rejectWith: gestureError });
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);

      await expect(el.requestFullscreen()).resolves.toBeUndefined();
      expect(el.error).toBe(gestureError);
    });

    it("レガシー webkitRequestFullscreen のみでも解決できる", async () => {
      const hero = document.createElement("div");
      hero.id = "hero";
      document.body.appendChild(hero);
      stubRequestFullscreen(hero, { legacy: true });
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);

      await el.requestFullscreen();

      expect(el.active).toBe(true);
    });

    it("unsupported 環境で requestFullscreen() が error へ落ちる", async () => {
      const hero = document.createElement("div");
      hero.id = "hero";
      document.body.appendChild(hero);
      removeRequestFullscreen(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);

      await el.requestFullscreen();

      expect(el.error).toEqual({ message: "Fullscreen API is not supported." });
    });

    it("何もfullscreenでない状態での exitFullscreen() が silent no-op", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      clearFullscreenElement();

      await expect(el.exitFullscreen()).resolves.toBeUndefined();

      expect(el.error).toBeNull();
    });

    it("exitFullscreen() 成功時に active が false になる", async () => {
      const hero = document.createElement("div");
      hero.id = "hero";
      document.body.appendChild(hero);
      stubRequestFullscreen(hero);
      stubExitFullscreen();
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      await el.requestFullscreen();
      expect(el.active).toBe(true);

      await el.exitFullscreen();

      expect(el.active).toBe(false);
    });
  });

  describe("複数インスタンス同時存在（§2.1 MUST）", () => {
    it("#a と #b をそれぞれ target にした2インスタンスのうち、#a がfullscreen化されたら前者のみ active:true", async () => {
      const a = document.createElement("div");
      a.id = "a";
      const b = document.createElement("div");
      b.id = "b";
      document.body.appendChild(a);
      document.body.appendChild(b);
      stubRequestFullscreen(a);

      const elA = makeEl({ target: "#a" });
      const elB = makeEl({ target: "#b" });
      document.body.appendChild(elA);
      document.body.appendChild(elB);

      await elA.requestFullscreen();

      expect(elA.active).toBe(true);
      expect(elB.active).toBe(false);
    });
  });

  describe("属性変更", () => {
    it("target 属性変更で再解決される", async () => {
      const a = document.createElement("div");
      a.id = "a";
      const b = document.createElement("div");
      b.id = "b";
      document.body.appendChild(a);
      document.body.appendChild(b);
      stubRequestFullscreen(a);
      stubRequestFullscreen(b);

      const el = makeEl({ target: "#a" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");

      el.target = "#b";
      await el.requestFullscreen();

      expect(el.active).toBe(true);
    });

    it("同値の属性変更では再解決処理が走らない（早期return）", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      const spy = vi.spyOn(el.style, "display", "set");

      el.attributeChangedCallback("target", "self", "self");

      expect(spy).not.toHaveBeenCalled();
    });

    it("未接続状態での属性変更は無視される", () => {
      const el = makeEl({ target: "self" });
      // document に接続していない
      expect(() => el.attributeChangedCallback("target", "self", "other")).not.toThrow();
    });
  });

  describe("target アトリビュートアクセサ", () => {
    it("get/set が属性を反映する", () => {
      const el = makeEl();
      expect(el.target).toBe("");
      el.target = "#foo";
      expect(el.getAttribute("target")).toBe("#foo");
      expect(el.target).toBe("#foo");
    });
  });

  describe("wcBindable 継承", () => {
    it("properties/commands を Core から継承し、inputs に target を持つ", () => {
      expect(WcsFullscreen.wcBindable.properties).toEqual(FullscreenCore.wcBindable.properties);
      expect(WcsFullscreen.wcBindable.commands).toEqual(FullscreenCore.wcBindable.commands);
      expect(WcsFullscreen.wcBindable.inputs).toEqual([{ name: "target", attribute: "target" }]);
    });
  });

  describe("SSR / connectedCallbackPromise", () => {
    it("static hasConnectedCallbackPromise が true", () => {
      expect(WcsFullscreen.hasConnectedCallbackPromise).toBe(true);
    });

    it("connectedCallbackPromise が settle する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });
  });

  describe("ライフサイクル", () => {
    it("disconnectedCallback で dispose される（再接続後に fullscreenchange が反映される）", async () => {
      const hero = document.createElement("div");
      hero.id = "hero";
      document.body.appendChild(hero);
      stubRequestFullscreen(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      await el.requestFullscreen();
      expect(el.active).toBe(true);

      document.body.removeChild(el);
      // dispose 済みなので document への fullscreenchange リスナーは外れている。
      clearFullscreenElement();
      document.dispatchEvent(new Event("fullscreenchange"));
      // active はリスナー解除後の値のまま変化しない（内部 _resolvedTarget と比較する
      // 経路自体が動いていないことの確認）。
      expect(el.active).toBe(true);
    });
  });
});
