import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { WcsResize } from "../src/components/Resize.js";
import { ResizeCore } from "../src/core/ResizeCore.js";
import {
  installResizeObserver,
  removeResizeObserver,
  size,
  ResizeObserverController,
} from "./mocks.js";

// Custom elements can only be registered once per tag name; define it up front and
// reuse across tests (the same constraint the intersection/sse bootstrap tests hit).
beforeAll(() => {
  if (!customElements.get("wcs-resize")) {
    customElements.define("wcs-resize", WcsResize);
  }
});

function makeEl(attrs: Record<string, string> = {}, innerHTML = ""): WcsResize {
  const el = document.createElement("wcs-resize") as WcsResize;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  if (innerHTML) el.innerHTML = innerHTML;
  return el;
}

describe("<wcs-resize>", () => {
  let ctrl: ResizeObserverController;

  beforeEach(() => {
    ctrl = installResizeObserver();
  });

  afterEach(() => {
    removeResizeObserver();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("観測対象の解決と display", () => {
    it("target 省略 + 子あり → 最初の子を監視し display:contents", () => {
      const el = makeEl({}, "<div></div>");
      document.body.appendChild(el);
      const child = el.firstElementChild;
      expect(el.style.display).toBe("contents");
      expect(ctrl.last.observed).toContain(child);
    });

    it("target 省略 + 子なし → 自分を監視し display:block", () => {
      const el = makeEl();
      document.body.appendChild(el);
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it('target="self" → 自分を監視し display:block（コンテナ幅プローブ）', () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it("target=セレクタ → 参照先を監視し display:none", () => {
      const panel = document.createElement("section");
      panel.id = "panel";
      document.body.appendChild(panel);
      const el = makeEl({ target: "#panel" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      expect(ctrl.last.observed).toContain(panel);
    });

    it("target=セレクタが未マッチ → 監視せず（observer 未生成）display:none", () => {
      const el = makeEl({ target: "#missing" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("target=不正セレクタ → throw せず未解決扱いで no-op（never-throw）", () => {
      const el = makeEl({ target: ":::" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });
  });

  describe("box / round", () => {
    it("box 属性を observe オプションに渡す", () => {
      const el = makeEl({ target: "self", box: "border-box" });
      document.body.appendChild(el);
      expect(ctrl.last.observedBoxes[0]).toBe("border-box");
    });

    it("box 未指定なら content-box", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(ctrl.last.observedBoxes[0]).toBe("content-box");
    });

    it("不正な box 値はパース段階で content-box にフォールバック", () => {
      const el = makeEl({ target: "self", box: "bogus-box" });
      document.body.appendChild(el);
      expect(ctrl.last.observedBoxes[0]).toBe("content-box");
    });

    it("device-pixel-content-box も有効な box として渡す", () => {
      const el = makeEl({ target: "self", box: "device-pixel-content-box" });
      document.body.appendChild(el);
      expect(ctrl.last.observedBoxes[0]).toBe("device-pixel-content-box");
    });

    it("round 属性で width/height を丸める", () => {
      const el = makeEl({ target: "self", round: "" });
      document.body.appendChild(el);
      ctrl.emit({ contentBoxSize: size(199.7, 99.4) });
      expect(el.width).toBe(200);
      expect(el.height).toBe(99);
    });

    it("round 無しなら raw 値", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      ctrl.emit({ contentBoxSize: size(199.7, 99.4) });
      expect(el.width).toBe(199.7);
      expect(el.height).toBe(99.4);
    });

    it("接続後に round をトグルすると再 observe し新しい丸めで再計測する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(ctrl.instances).toHaveLength(1);
      el.setAttribute("round", "");
      // round は observedAttributes に含まれる → observer を作り直す
      expect(ctrl.instances).toHaveLength(2);
      ctrl.emit({ contentBoxSize: size(150.6, 80.2) });
      expect(el.width).toBe(151);
    });
  });

  describe("派生プロパティと change", () => {
    it("リサイズで width/height/entry が反映される", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      ctrl.emit({ contentBoxSize: size(320, 200), contentRect: { width: 320, height: 200 } });
      expect(el.width).toBe(320);
      expect(el.height).toBe(200);
      expect(el.entry?.target).toBe(el);
      expect(el.observing).toBe(true);
    });
  });

  describe("once（measure-once）", () => {
    it("初回計測で自動 disconnect する（RO は observe 時に必ず1回発火）", () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      ctrl.emit({ contentBoxSize: size(100, 50) });
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("once 無しなら計測後も監視継続", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      ctrl.emit({ contentBoxSize: size(100, 50) });
      expect(el.observing).toBe(true);
    });

    it("once は fire 時に評価されるので接続後に付与しても有効", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.once = true; // 接続後に付与
      ctrl.emit({ contentBoxSize: size(100, 50) });
      expect(el.observing).toBe(false);
    });

    it("once は observedAttributes に含まれない（再 observe を起こさない）", () => {
      expect(WcsResize.observedAttributes).not.toContain("once");
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.setAttribute("once", "");
      expect(ctrl.instances).toHaveLength(1);
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

    it("remove 後の再 appendChild で監視が再開する（observing が true に戻る）", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      el.remove();
      expect(el.observing).toBe(false);
      // 再接続：connectedCallback が再度 observe() を走らせ、Core が観測を組み直す。
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      expect(ctrl.last.observed).toContain(el);
    });

    it("再接続後の once は一度だけ disconnect する（_onChange の二重登録なし）", () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      el.remove();
      // 再接続。connectedCallback は同一参照の addEventListener なのでリスナーは
      // 重複登録されない。RO は observe 時に必ず1回発火するため、once は1回の
      // 計測で disconnect する。リスナーが二重なら detail への副作用は無いが、
      // ここでは once が再接続後も「一度きり」で正しく機能することを固定する。
      document.body.appendChild(el);
      ctrl.emit();
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("manual は接続後トグルしても進行中の監視を止めない（connect 時ポリシー）", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      el.manual = true; // observedAttributes 外 → 何も起きない
      expect(el.observing).toBe(true);
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
      const panel = document.createElement("section");
      panel.id = "panel";
      document.body.appendChild(panel);
      const el = makeEl({ target: "#panel" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      panel.remove();
      el.unobserve();
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("対象が解決不能になった後の observe() は stale observer を片付け observing を false にする", () => {
      const panel = document.createElement("section");
      panel.id = "panel";
      document.body.appendChild(panel);
      const el = makeEl({ target: "#panel" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      panel.remove();
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
  });

  describe("trigger", () => {
    it("false→true で再 observe し trigger-changed を発火、即 false に戻る", () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      const onTrigger = vi.fn();
      el.addEventListener("wcs-resize:trigger-changed", onTrigger);
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
      const el = makeEl({ target: "#missing", manual: "" });
      document.body.appendChild(el);
      const onTrigger = vi.fn();
      el.addEventListener("wcs-resize:trigger-changed", onTrigger);
      el.trigger = true;
      expect(onTrigger).toHaveBeenCalledOnce();
      expect(el.trigger).toBe(false);
      expect(el.observing).toBe(false);
    });
  });

  describe("ネスト利用", () => {
    it("子孫 <wcs-resize> の change(bubbles) を親が拾っても親の once 解除を起こさない", () => {
      const parent = makeEl({ target: "self", once: "" });
      document.body.appendChild(parent);
      const child = makeEl({ target: "self" });
      parent.appendChild(child);
      expect(parent.observing).toBe(true);

      // 子の observer（最後に生成されたインスタンス）で計測を発火 → 親まで bubble。
      ctrl.emit({ contentBoxSize: size(10, 10) });
      // 子の計測では親の once は発動せず、親は監視継続。
      expect(parent.observing).toBe(true);
    });
  });

  describe("attributeChangedCallback", () => {
    it("接続中に target を変更すると再 observe する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(ctrl.instances).toHaveLength(1);
      el.innerHTML = "<div></div>";
      el.setAttribute("target", ""); // 省略相当 → 子を監視
      expect(ctrl.instances.length).toBeGreaterThanOrEqual(2);
      expect(el.style.display).toBe("contents");
    });

    it("接続中に box を変更すると再 observe する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(ctrl.instances).toHaveLength(1);
      el.setAttribute("box", "border-box");
      expect(ctrl.instances).toHaveLength(2);
      expect(ctrl.last.observedBoxes[0]).toBe("border-box");
    });

    it("同値変更は無視する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.setAttribute("box", "content-box");
      el.setAttribute("box", "content-box");
      expect(ctrl.instances).toHaveLength(1);
    });

    it("未接続なら attributeChangedCallback は監視を起こさない", () => {
      const el = makeEl({ target: "self" });
      el.setAttribute("box", "border-box");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("manual なら属性変更で再 observe しない", () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      el.setAttribute("box", "border-box");
      expect(ctrl.instances).toHaveLength(0);
    });
  });

  describe("Shell wcBindable / 静的契約", () => {
    it("hasConnectedCallbackPromise は true（SSR 対応）", () => {
      expect(WcsResize.hasConnectedCallbackPromise).toBe(true);
    });

    it("SSR: connectedCallbackPromise が解決する（同期準備のため即解決）", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("disconnectedCallback で Core を dispose し監視を停止する", () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      expect(el.observing).toBe(true);
      el.remove();
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("properties は Core を継承し trigger を追加する", () => {
      const names = WcsResize.wcBindable.properties.map((p) => p.name);
      for (const p of ResizeCore.wcBindable.properties) {
        expect(names).toContain(p.name);
      }
      const trigger = WcsResize.wcBindable.properties.find((p) => p.name === "trigger");
      expect(trigger).toBeDefined();
      expect(trigger!.event).toBe("wcs-resize:trigger-changed");
    });

    it("inputs は宣言的属性ヒントと momentary な trigger を含む", () => {
      const inputs = WcsResize.wcBindable.inputs!;
      const byName = Object.fromEntries(inputs.map((i) => [i.name, i]));
      expect(byName.target.attribute).toBe("target");
      expect(byName.box.attribute).toBe("box");
      expect(byName.round.attribute).toBe("round");
      expect(byName.once.attribute).toBe("once");
      expect(byName.manual.attribute).toBe("manual");
      // trigger は momentary command-property なので mirrored attribute を持たない。
      expect(byName.trigger).toBeDefined();
      expect(byName.trigger.attribute).toBeUndefined();
    });

    it("commands は Core の commands をそのまま継承する（同一参照で追従漏れ防止）", () => {
      expect(WcsResize.wcBindable.commands).toBe(ResizeCore.wcBindable.commands);
      const names = WcsResize.wcBindable.commands!.map((c) => c.name);
      expect(names).toEqual(["observe", "unobserve", "disconnect"]);
    });
  });

  describe("属性アクセサ", () => {
    it("target / box の get/set が属性に反映される", () => {
      const el = makeEl();
      el.target = "#a";
      el.box = "border-box";
      expect(el.getAttribute("target")).toBe("#a");
      expect(el.getAttribute("box")).toBe("border-box");
      expect(el.target).toBe("#a");
      expect(el.box).toBe("border-box");
    });

    it("round / once / manual boolean アクセサ（true で属性付与、false で除去）", () => {
      const el = makeEl();
      el.round = true;
      el.once = true;
      el.manual = true;
      expect(el.hasAttribute("round")).toBe(true);
      expect(el.hasAttribute("once")).toBe(true);
      expect(el.hasAttribute("manual")).toBe(true);
      el.round = false;
      el.once = false;
      el.manual = false;
      expect(el.hasAttribute("round")).toBe(false);
      expect(el.hasAttribute("once")).toBe(false);
      expect(el.hasAttribute("manual")).toBe(false);
    });
  });
});
