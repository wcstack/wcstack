import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { WcsResize } from "../src/components/Resize.js";
import { ResizeCore } from "../src/core/ResizeCore.js";
import {
  installResizeObserver,
  removeResizeObserver,
  size,
  ResizeObserverController,
} from "./mocks.js";

/** observe の判断はマイクロタスク（timing-and-firing-contract §23）: それを流す */
const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));

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
    it("target 省略 + 子あり → 最初の子を監視し display:contents", async () => {
      const el = makeEl({}, "<div></div>");
      document.body.appendChild(el);
      await flush();
      const child = el.firstElementChild;
      expect(el.style.display).toBe("contents");
      expect(ctrl.last.observed).toContain(child);
    });

    it("target 省略 + 子なし → 自分を監視し display:block", async () => {
      const el = makeEl();
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it('target="self" → 自分を監視し display:block（コンテナ幅プローブ）', async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it("target=セレクタ → 参照先を監視し display:none", async () => {
      const panel = document.createElement("section");
      panel.id = "panel";
      document.body.appendChild(panel);
      const el = makeEl({ target: "#panel" });
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("none");
      expect(ctrl.last.observed).toContain(panel);
    });

    it("target=セレクタが未マッチ → 監視せず（observer 未生成）display:none", async () => {
      const el = makeEl({ target: "#missing" });
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("target=不正セレクタ → throw せず未解決扱いで no-op（never-throw）", async () => {
      const el = makeEl({ target: ":::" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      await flush();
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });
  });

  describe("box / round", () => {
    it("box 属性を observe オプションに渡す", async () => {
      const el = makeEl({ target: "self", box: "border-box" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.observedBoxes[0]).toBe("border-box");
    });

    it("box 未指定なら content-box", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.observedBoxes[0]).toBe("content-box");
    });

    it("不正な box 値はパース段階で content-box にフォールバック", async () => {
      const el = makeEl({ target: "self", box: "bogus-box" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.observedBoxes[0]).toBe("content-box");
    });

    it("device-pixel-content-box も有効な box として渡す", async () => {
      const el = makeEl({ target: "self", box: "device-pixel-content-box" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.observedBoxes[0]).toBe("device-pixel-content-box");
    });

    it("round 属性で width/height を丸める", async () => {
      const el = makeEl({ target: "self", round: "" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ contentBoxSize: size(199.7, 99.4) });
      expect(el.width).toBe(200);
      expect(el.height).toBe(99);
    });

    it("round 無しなら raw 値", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ contentBoxSize: size(199.7, 99.4) });
      expect(el.width).toBe(199.7);
      expect(el.height).toBe(99.4);
    });

    it("接続後に round をトグルすると再 observe し新しい丸めで再計測する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      el.setAttribute("round", "");
      await flush();
      // round は observedAttributes に含まれる → observer を作り直す
      expect(ctrl.instances).toHaveLength(2);
      ctrl.emit({ contentBoxSize: size(150.6, 80.2) });
      expect(el.width).toBe(151);
    });
  });

  describe("派生プロパティと change", () => {
    it("リサイズで width/height/entry が反映される", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ contentBoxSize: size(320, 200), contentRect: { width: 320, height: 200 } });
      expect(el.width).toBe(320);
      expect(el.height).toBe(200);
      expect(el.entry?.target).toBe(el);
      expect(el.observing).toBe(true);
    });
  });

  describe("once（measure-once）", () => {
    it("初回計測で自動 disconnect する（RO は observe 時に必ず1回発火）", async () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ contentBoxSize: size(100, 50) });
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("once 無しなら計測後も監視継続", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ contentBoxSize: size(100, 50) });
      expect(el.observing).toBe(true);
    });

    it("once は fire 時に評価されるので接続後に付与しても有効", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.once = true; // 接続後に付与
      ctrl.emit({ contentBoxSize: size(100, 50) });
      expect(el.observing).toBe(false);
    });

    it("once は observedAttributes に含まれない（再 observe を起こさない）", async () => {
      expect(WcsResize.observedAttributes).not.toContain("once");
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.setAttribute("once", "");
      await flush();
      expect(ctrl.instances).toHaveLength(1);
    });
  });

  describe("manual / lifecycle", () => {
    it("manual なら connect 時に自動監視しない", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(0);
      expect(el.observing).toBe(false);
    });

    it("manual でも observe() コマンドで監視を開始できる", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      await flush();
      el.observe();
      expect(el.observing).toBe(true);
    });

    it("disconnectedCallback で監視を停止する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.remove();
      expect(ctrl.last.disconnected).toBe(true);
      expect(el.observing).toBe(false);
    });

    it("remove 後の再 appendChild で監視が再開する（observing が true に戻る）", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      el.remove();
      expect(el.observing).toBe(false);
      // 再接続：connectedCallback が再度 observe() を（マイクロタスクで）走らせ、Core が観測を組み直す。
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      expect(ctrl.last.observed).toContain(el);
    });

    it("再接続後の once は一度だけ disconnect する（_onChange の二重登録なし）", async () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      await flush();
      el.remove();
      // 再接続。connectedCallback は同一参照の addEventListener なのでリスナーは
      // 重複登録されない。RO は observe 時に必ず1回発火するため、once は1回の
      // 計測で disconnect する。リスナーが二重なら detail への副作用は無いが、
      // ここでは once が再接続後も「一度きり」で正しく機能することを固定する。
      document.body.appendChild(el);
      await flush();
      ctrl.emit();
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("manual は接続後トグルしても進行中の監視を止めない（connect 時ポリシー）", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      el.manual = true; // observedAttributes 外 → 何も起きない
      await flush();
      expect(el.observing).toBe(true);
    });
  });

  // router は遷移で同じノードを入れ直し、state は新しい params からの入力をマイクロタスクで書く
  // （timing-and-firing-contract §23、docs/seam-apps.md の shift-desk）
  describe("observe の判断はマイクロタスクで、そのときの入力で", () => {
    function observingLog(el: WcsResize): boolean[] {
      const log: boolean[] = [];
      el.addEventListener("wcs-resize:observing-changed", (e) => log.push((e as CustomEvent).detail));
      return log;
    }

    it("入れ直しの間に target が書かれると、前の target は監視せず、新しい target だけを監視する", async () => {
      const a = document.createElement("section");
      a.id = "panel-14";
      const b = document.createElement("section");
      b.id = "panel-11";
      document.body.append(a, b);
      const el = makeEl({ target: "#panel-14" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(ctrl.last.observed).toEqual([a]);
      const log = observingLog(el);

      // state のマイクロタスクは、router が中身を入れ直す前に積まれている
      queueMicrotask(() => { el.target = "#panel-11"; });
      el.remove();
      document.body.appendChild(el);
      await flush();
      await flush();
      // 入れ直しの後に作った observer は 1 つで、新しい target だけを見る
      expect(ctrl.instances).toHaveLength(2);
      expect(ctrl.last.observed).toEqual([b]);
      expect(log).toEqual([false, true]);
    });

    it("入れ直しの間に manual が書かれると、前の入力で監視を始めない", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      const log = observingLog(el);

      queueMicrotask(() => { el.manual = true; });
      el.remove();
      document.body.appendChild(el);
      await flush();
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(el.observing).toBe(false);
      expect(log).toEqual([false]);
    });

    it("判断の前に外した要素は監視しない", async () => {
      const el = makeEl({ target: "self" });
      const log = observingLog(el);
      document.body.appendChild(el);
      el.remove();
      await flush();
      expect(ctrl.instances).toHaveLength(0);
      expect(el.observing).toBe(false);
      expect(log).toEqual([]);
    });

    it("同じタスクで接続の後に manual が書かれると、監視しない", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.manual = true;
      await flush();
      expect(ctrl.instances).toHaveLength(0);
      expect(el.observing).toBe(false);
    });

    it.each(["unobserve", "disconnect"] as const)(
      "同じタスクで接続の後に %s() を呼ぶと、予約中の observe を取り消して何も監視しない",
      async (command) => {
        const el = makeEl({ target: "self" });
        const log = observingLog(el);
        document.body.appendChild(el);
        el[command]();
        await flush();
        expect(ctrl.instances).toHaveLength(0);
        expect(el.observing).toBe(false);
        expect(log).toEqual([]);
      },
    );

    it("接続中の属性の変化の後に同じタスクで disconnect() を呼ぶと、作り直さず停止したまま", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      el.box = "border-box";
      el.disconnect();
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(el.observing).toBe(false);
    });

    it("disconnect() で取り消した後に同じタスクで入れ直すと、その予約で 1 回だけ監視する", async () => {
      const el = makeEl({ target: "self" });
      const log = observingLog(el);
      document.body.appendChild(el);
      el.disconnect();
      el.remove();
      document.body.appendChild(el);
      await flush();
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(log).toEqual([true]);
    });

    it("同じタスクで接続の後に observe() を呼んでも、予約の observe は no-op で observer は 1 つ", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.observe();
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(el.observing).toBe(true);
    });

    it("同じタスクの接続と属性の変化はまとまり、observer は最後の入力で 1 つだけ作る", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      el.box = "border-box";
      el.round = true;
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(ctrl.last.observedBoxes).toEqual(["border-box"]);
      ctrl.emit({ borderBoxSize: size(150.6, 80.2) });
      expect(el.width).toBe(151);
    });
  });

  describe("commands", () => {
    it("unobserve コマンドで解除（対象あり）", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.unobserve();
      expect(el.observing).toBe(false);
    });

    it("unobserve コマンドは対象が DOM から消えても監視を停止できる", async () => {
      const panel = document.createElement("section");
      panel.id = "panel";
      document.body.appendChild(panel);
      const el = makeEl({ target: "#panel" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      panel.remove();
      el.unobserve();
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("対象が解決不能になった後の observe() は stale observer を片付け observing を false にする", async () => {
      const panel = document.createElement("section");
      panel.id = "panel";
      document.body.appendChild(panel);
      const el = makeEl({ target: "#panel" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      panel.remove();
      el.observe(); // 再解決で null → stale observer を disconnect
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("disconnect コマンドで停止", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.disconnect();
      expect(el.observing).toBe(false);
    });
  });

  describe("trigger", () => {
    it("false→true で再 observe し trigger-changed を発火、即 false に戻る", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      await flush();
      const onTrigger = vi.fn();
      el.addEventListener("wcs-resize:trigger-changed", onTrigger);
      el.trigger = true;
      expect(el.observing).toBe(true);
      expect(el.trigger).toBe(false);
      expect(onTrigger).toHaveBeenCalledOnce();
    });

    it("false 代入は no-op", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      await flush();
      el.trigger = false;
      expect(ctrl.instances).toHaveLength(0);
    });

    it("対象未解決でも trigger-changed は発火する（momentary な確認応答、成否は observing で判定）", async () => {
      const el = makeEl({ target: "#missing", manual: "" });
      document.body.appendChild(el);
      await flush();
      const onTrigger = vi.fn();
      el.addEventListener("wcs-resize:trigger-changed", onTrigger);
      el.trigger = true;
      expect(onTrigger).toHaveBeenCalledOnce();
      expect(el.trigger).toBe(false);
      expect(el.observing).toBe(false);
    });
  });

  describe("ネスト利用", () => {
    it("子孫 <wcs-resize> の change(bubbles) を親が拾っても親の once 解除を起こさない", async () => {
      const parent = makeEl({ target: "self", once: "" });
      document.body.appendChild(parent);
      await flush();
      const child = makeEl({ target: "self" });
      parent.appendChild(child);
      await flush();
      expect(parent.observing).toBe(true);

      // 子の observer（最後に生成されたインスタンス）で計測を発火 → 親まで bubble。
      ctrl.emit({ contentBoxSize: size(10, 10) });
      // 子の計測では親の once は発動せず、親は監視継続。
      expect(parent.observing).toBe(true);
    });
  });

  describe("attributeChangedCallback", () => {
    it("接続中に target を変更すると再 observe する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      el.innerHTML = "<div></div>";
      el.setAttribute("target", ""); // 省略相当 → 子を監視
      await flush();
      expect(ctrl.instances.length).toBeGreaterThanOrEqual(2);
      expect(el.style.display).toBe("contents");
    });

    it("接続中に box を変更すると再 observe する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      el.setAttribute("box", "border-box");
      await flush();
      expect(ctrl.instances).toHaveLength(2);
      expect(ctrl.last.observedBoxes[0]).toBe("border-box");
    });

    it("同値変更は無視する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.setAttribute("box", "content-box");
      await flush();
      el.setAttribute("box", "content-box");
      await flush();
      expect(ctrl.instances).toHaveLength(1);
    });

    it("未接続なら attributeChangedCallback は監視を起こさない", async () => {
      const el = makeEl({ target: "self" });
      el.setAttribute("box", "border-box");
      await flush();
      expect(ctrl.instances).toHaveLength(0);
    });

    it("manual なら属性変更で再 observe しない", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      await flush();
      el.setAttribute("box", "border-box");
      await flush();
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

    it("disconnectedCallback で Core を dispose し監視を停止する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
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

    it("undefined はマークアップに書かれた属性へ戻し、null は属性を外す（P1 / P2）", () => {
      const host = document.createElement("div");
      host.innerHTML = '<wcs-resize target="#authored" box="border-box" round once manual></wcs-resize>';
      const el = host.firstElementChild as WcsResize;
      el.target = "self";
      el.box = "content-box";
      el.round = false;
      el.once = false;
      el.manual = false;
      el.target = undefined;
      el.box = undefined;
      el.round = undefined;
      el.once = undefined;
      el.manual = undefined;
      expect(el.target).toBe("#authored");
      expect(el.box).toBe("border-box");
      expect(el.round).toBe(true);
      expect(el.once).toBe(true);
      expect(el.manual).toBe(true);
      el.target = null;
      el.box = null;
      el.round = null;
      el.once = null;
      el.manual = null;
      expect(el.hasAttribute("target")).toBe(false);
      expect(el.hasAttribute("box")).toBe(false);
      expect(el.round).toBe(false);
      expect(el.once).toBe(false);
      expect(el.manual).toBe(false);
    });

    it("接続中の target に null を書くと既定（最初の子）を監視し、undefined はマークアップの target へ戻す", async () => {
      const panel = document.createElement("section");
      panel.id = "panel";
      document.body.appendChild(panel);
      const el = makeEl({ target: "#panel" }, "<div></div>");
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.observed).toContain(panel);
      el.target = null;
      await flush();
      expect(el.style.display).toBe("contents");
      expect(ctrl.last.observed).toEqual([el.firstElementChild]);
      el.target = undefined;
      await flush();
      expect(el.style.display).toBe("none");
      expect(ctrl.last.observed).toEqual([panel]);
    });
  });
});
