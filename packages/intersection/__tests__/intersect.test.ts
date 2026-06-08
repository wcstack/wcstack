import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { WcsIntersect } from "../src/components/Intersect.js";
import { IntersectionCore } from "../src/core/IntersectionCore.js";
import {
  installIntersectionObserver,
  removeIntersectionObserver,
  IntersectionObserverController,
} from "./mocks.js";

// Custom elements can only be registered once per tag name; define it up front
// and reuse across tests (the same constraint the sse/geo bootstrap tests hit).
beforeAll(() => {
  if (!customElements.get("wcs-intersect")) {
    customElements.define("wcs-intersect", WcsIntersect);
  }
});

function makeEl(attrs: Record<string, string> = {}, innerHTML = ""): WcsIntersect {
  const el = document.createElement("wcs-intersect") as WcsIntersect;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (innerHTML) el.innerHTML = innerHTML;
  return el;
}

describe("<wcs-intersect>", () => {
  let ctrl: IntersectionObserverController;

  beforeEach(() => {
    ctrl = installIntersectionObserver();
  });

  afterEach(() => {
    removeIntersectionObserver();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("観測対象の解決と display", () => {
    it("target 省略 + 子あり → 最初の子を監視し display:contents", () => {
      const el = makeEl({}, "<img>");
      document.body.appendChild(el);
      const img = el.firstElementChild;
      expect(el.style.display).toBe("contents");
      expect(ctrl.last.observed).toContain(img);
    });

    it("target 省略 + 子なし → 自分を監視し display:block", () => {
      const el = makeEl();
      document.body.appendChild(el);
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it('target="self" → 自分を監視し display:block', () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it("target=セレクタ → 参照先を監視し display:none", () => {
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      expect(ctrl.last.observed).toContain(hero);
    });

    it("target=セレクタが未マッチ → 監視せず（observer 未生成）display:none", () => {
      const el = makeEl({ target: "#missing" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("target=不正セレクタ → throw せず未解決扱いで no-op（never-throw）", () => {
      // querySelector が SyntaxError を投げる不正セレクタでも connectedCallback まで
      // 例外が伝播せず、未マッチと同じ「観測しない」経路に落ちる。
      const el = makeEl({ target: ":::" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("root=不正セレクタ → throw せず root を null（ビューポート）に落とす", () => {
      // root の不正セレクタも observe() から例外を漏らさず、root=null へフォールバック。
      const el = makeEl({ target: "self", root: "[data-*" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      expect(ctrl.last.options.root).toBeNull();
    });
  });

  describe("root / rootMargin / threshold", () => {
    it("root セレクタを解決して init.root に渡す", () => {
      const scope = document.createElement("div");
      scope.id = "scope";
      document.body.appendChild(scope);
      const el = makeEl({ target: "self", root: "#scope" });
      document.body.appendChild(el);
      expect(ctrl.last.options.root).toBe(scope);
    });

    it("root 未指定なら init.root は null", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(ctrl.last.options.root).toBeNull();
    });

    it("root-margin 属性を渡す（既定 0px）", () => {
      const el = makeEl({ target: "self", "root-margin": "10px 0px" });
      document.body.appendChild(el);
      expect(ctrl.last.options.rootMargin).toBe("10px 0px");

      const el2 = makeEl({ target: "self" });
      document.body.appendChild(el2);
      expect(ctrl.last.options.rootMargin).toBe("0px");
    });

    it("threshold をパースする（単一 / 複数 / 空 / 不正 / 範囲外 / 空スロット）", () => {
      const cases: Array<[string, number | number[]]> = [
        ["0.5", 0.5],
        ["0,0.5,1", [0, 0.5, 1]],
        ["", 0],
        ["abc", 0],
        ["0.5px", 0],
        ["2", 0],
        // 空スロットは drop（Number("")===0 を有効値として混入させない）
        ["0,,1", [0, 1]],
        ["1,", 1],
        [",0.5", 0.5],
      ];
      for (const [attr, expected] of cases) {
        const el = makeEl(attr === "" ? { target: "self" } : { target: "self", threshold: attr });
        document.body.appendChild(el);
        expect(ctrl.last.options.threshold).toEqual(expected);
        el.remove();
      }
    });
  });

  describe("派生プロパティと change", () => {
    it("交差で intersecting/ratio/visible/entry が反映される", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      ctrl.emit({ isIntersecting: true, intersectionRatio: 0.5 });
      expect(el.intersecting).toBe(true);
      expect(el.ratio).toBe(0.5);
      expect(el.visible).toBe(true);
      expect(el.entry?.isIntersecting).toBe(true);
      expect(el.observing).toBe(true);
    });
  });

  describe("once", () => {
    it("初回交差で自動 disconnect する", () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      ctrl.emit({ isIntersecting: true });
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("非交差では disconnect しない", () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      ctrl.emit({ isIntersecting: false });
      expect(el.observing).toBe(true);
    });

    it("once 無しなら交差しても監視継続", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      ctrl.emit({ isIntersecting: true });
      expect(el.observing).toBe(true);
    });
  });

  describe("manual / lifecycle", () => {
    it("manual なら connect 時に自動監視しない", () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      expect(ctrl.instances).toHaveLength(0);
      expect(el.observing).toBe(false);
    });

    it("manual でも observe() コマンドで監視を開始できる", () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      el.observe();
      expect(el.observing).toBe(true);
    });

    it("disconnectedCallback で監視を停止する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.remove();
      expect(ctrl.last.disconnected).toBe(true);
      expect(el.observing).toBe(false);
    });
  });

  describe("commands", () => {
    it("unobserve コマンドで解除（対象あり）", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.unobserve();
      expect(el.observing).toBe(false);
    });

    it("unobserve コマンドは対象が DOM から消えても監視を停止できる", () => {
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      hero.remove(); // セレクタが解決不能になっても
      el.unobserve(); // Core の追跡状態に委譲して停止できる
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("対象が解決不能になった後の observe() は stale observer を片付け observing を false にする", () => {
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      hero.remove();
      el.observe(); // 再解決で null → stale observer を disconnect
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("disconnect コマンドで停止", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.disconnect();
      expect(el.observing).toBe(false);
    });

    it("reset コマンドで visible ラッチを解除", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      ctrl.emit({ isIntersecting: true });
      expect(el.visible).toBe(true);
      el.reset();
      expect(el.visible).toBe(false);
    });
  });

  describe("trigger", () => {
    it("false→true で再 observe し trigger-changed を発火、即 false に戻る", () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      const onTrigger = vi.fn();
      el.addEventListener("wcs-intersect:trigger-changed", onTrigger);
      el.trigger = true;
      expect(el.observing).toBe(true);
      expect(el.trigger).toBe(false);
      expect(onTrigger).toHaveBeenCalledOnce();
    });

    it("false 代入は no-op", () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      el.trigger = false;
      expect(ctrl.instances).toHaveLength(0);
    });

    it("対象未解決でも trigger-changed は発火する（momentary な確認応答、成否は observing で判定）", () => {
      // trigger-changed(detail:false) は「トリガを消費した」momentary な確認応答であり、
      // 観測の成否ではない。対象が解決できなくても auto-reset と完了通知は常に行い、
      // 実際の成否は observing が false のまま で表現される（現状動作の固定）。
      const el = makeEl({ target: "#missing", manual: "" });
      document.body.appendChild(el);
      const onTrigger = vi.fn();
      el.addEventListener("wcs-intersect:trigger-changed", onTrigger);
      el.trigger = true;
      expect(onTrigger).toHaveBeenCalledOnce();
      expect(el.trigger).toBe(false);
      expect(el.observing).toBe(false); // 未解決なので観測は始まっていない
    });
  });

  describe("ネスト利用", () => {
    it("子孫 <wcs-intersect> の change(bubbles) を親が拾っても親の once 解除を起こさない", () => {
      // change は bubbles:true。親が once のとき、子の交差イベントが親リスナへ伝播しても
      // event.target !== this のガードで親の observer を切らないことを確認。
      const parent = makeEl({ target: "self", once: "" });
      document.body.appendChild(parent);
      const child = makeEl({ target: "self" });
      parent.appendChild(child);
      expect(parent.observing).toBe(true);

      // 子の observer（最後に生成されたインスタンス）で交差を発火 → 親まで bubble。
      ctrl.emit({ isIntersecting: true });
      // 子の交差では親の once は発動せず、親は監視継続。
      expect(parent.observing).toBe(true);
    });
  });

  describe("attributeChangedCallback", () => {
    it("接続中に target を変更すると再 observe する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(ctrl.instances).toHaveLength(1);
      el.innerHTML = "<img>";
      el.setAttribute("target", ""); // 省略相当 → 子を監視
      // 空文字 set は removeAttribute ではないので target="" 扱い → 子へ
      expect(ctrl.instances.length).toBeGreaterThanOrEqual(2);
      expect(el.style.display).toBe("contents");
    });

    it("同値変更は無視する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.setAttribute("root-margin", "0px");
      el.setAttribute("root-margin", "0px");
      // 値が変わらないので oldValue===newValue で早期 return（再生成しない）
      expect(ctrl.instances).toHaveLength(1);
    });

    it("未接続なら attributeChangedCallback は監視を起こさない", () => {
      const el = makeEl({ target: "self" });
      el.setAttribute("root-margin", "10px");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("manual なら属性変更で再 observe しない", () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      el.setAttribute("root-margin", "10px");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("once は observedAttributes に含まれない（再 observe を起こさない）", () => {
      expect(WcsIntersect.observedAttributes).not.toContain("once");
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.setAttribute("once", "");
      // once トグルでは attributeChangedCallback が走らず observer を作り直さない
      expect(ctrl.instances).toHaveLength(1);
    });

    it("once は fire 時に評価されるので接続後に付与しても有効", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.once = true; // 接続後に付与
      ctrl.emit({ isIntersecting: true });
      expect(el.observing).toBe(false); // once として機能して disconnect
    });

    it("manual は接続後トグルしても進行中の監視を止めない（connect 時ポリシー）", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      el.manual = true; // observedAttributes 外 → 何も起きない
      expect(el.observing).toBe(true);
    });
  });

  describe("Shell wcBindable / 静的契約", () => {
    it("hasConnectedCallbackPromise は false（同期接続のため）", () => {
      expect(WcsIntersect.hasConnectedCallbackPromise).toBe(false);
    });

    it("properties は Core を継承し trigger を追加する", () => {
      const names = WcsIntersect.wcBindable.properties.map((p) => p.name);
      // Core 由来のプロパティを全て含む。
      for (const p of IntersectionCore.wcBindable.properties) {
        expect(names).toContain(p.name);
      }
      // Shell 固有の trigger を追加し、専用イベントを持つ。
      const trigger = WcsIntersect.wcBindable.properties.find((p) => p.name === "trigger");
      expect(trigger).toBeDefined();
      expect(trigger!.event).toBe("wcs-intersect:trigger-changed");
    });

    it("inputs は宣言的属性ヒントと momentary な trigger を含む", () => {
      const inputs = WcsIntersect.wcBindable.inputs!;
      const byName = Object.fromEntries(inputs.map((i) => [i.name, i]));
      expect(byName.target.attribute).toBe("target");
      expect(byName.root.attribute).toBe("root");
      expect(byName.rootMargin.attribute).toBe("root-margin");
      expect(byName.threshold.attribute).toBe("threshold");
      expect(byName.once.attribute).toBe("once");
      expect(byName.manual.attribute).toBe("manual");
      // trigger は momentary command-property なので mirrored attribute を持たない。
      expect(byName.trigger).toBeDefined();
      expect(byName.trigger.attribute).toBeUndefined();
    });

    it("commands は Core の commands をそのまま継承する（同一参照で追従漏れ防止）", () => {
      expect(WcsIntersect.wcBindable.commands).toBe(IntersectionCore.wcBindable.commands);
      const names = WcsIntersect.wcBindable.commands.map((c) => c.name);
      expect(names).toEqual(["observe", "unobserve", "disconnect", "reset"]);
    });
  });

  describe("属性アクセサ", () => {
    it("target / root / threshold の get/set が属性に反映される", () => {
      const el = makeEl();
      el.target = "#a";
      el.root = "#b";
      el.threshold = "0.5";
      expect(el.getAttribute("target")).toBe("#a");
      expect(el.getAttribute("root")).toBe("#b");
      expect(el.getAttribute("threshold")).toBe("0.5");
      expect(el.target).toBe("#a");
      expect(el.threshold).toBe("0.5");
    });

    it("rootMargin の get は既定 0px、set で反映", () => {
      const el = makeEl();
      expect(el.rootMargin).toBe("0px");
      el.rootMargin = "20px";
      expect(el.getAttribute("root-margin")).toBe("20px");
      expect(el.rootMargin).toBe("20px");
    });

    it("once / manual boolean アクセサ（true で属性付与、false で除去）", () => {
      const el = makeEl();
      el.once = true;
      el.manual = true;
      expect(el.hasAttribute("once")).toBe(true);
      expect(el.hasAttribute("manual")).toBe(true);
      el.once = false;
      el.manual = false;
      expect(el.hasAttribute("once")).toBe(false);
      expect(el.hasAttribute("manual")).toBe(false);
    });
  });
});
