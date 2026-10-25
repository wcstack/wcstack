import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { WcsIntersect } from "../src/components/Intersect.js";
import { IntersectionCore } from "../src/core/IntersectionCore.js";
import {
  installIntersectionObserver,
  removeIntersectionObserver,
  IntersectionObserverController,
} from "./mocks.js";

/** observe の判断はマイクロタスク（timing-and-firing-contract §23）: それを流す */
const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));

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
    it("target 省略 + 子あり → 最初の子を監視し display:contents", async () => {
      const el = makeEl({}, "<img>");
      document.body.appendChild(el);
      await flush();
      const img = el.firstElementChild;
      expect(el.style.display).toBe("contents");
      expect(ctrl.last.observed).toContain(img);
    });

    it("target 省略 + 子なし → 自分を監視し display:block", async () => {
      const el = makeEl();
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it('target="self" → 自分を監視し display:block', async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("block");
      expect(ctrl.last.observed).toContain(el);
    });

    it("target=セレクタ → 参照先を監視し display:none", async () => {
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("none");
      expect(ctrl.last.observed).toContain(hero);
    });

    it("target=セレクタが未マッチ → 監視せず（observer 未生成）display:none", async () => {
      const el = makeEl({ target: "#missing" });
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("target=不正セレクタ → throw せず未解決扱いで no-op（never-throw）", async () => {
      // querySelector が SyntaxError を投げる不正セレクタでも connectedCallback まで
      // 例外が伝播せず、未マッチと同じ「観測しない」経路に落ちる。
      const el = makeEl({ target: ":::" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      await flush();
      expect(el.style.display).toBe("none");
      expect(ctrl.instances).toHaveLength(0);
    });

    it("root=不正セレクタ → throw せず root を null（ビューポート）に落とす", async () => {
      // root の不正セレクタも observe() から例外を漏らさず、root=null へフォールバック。
      const el = makeEl({ target: "self", root: "[data-*" });
      expect(() => document.body.appendChild(el)).not.toThrow();
      await flush();
      expect(ctrl.last.options.root).toBeNull();
    });
  });

  describe("root / rootMargin / threshold", () => {
    it("root セレクタを解決して init.root に渡す", async () => {
      const scope = document.createElement("div");
      scope.id = "scope";
      document.body.appendChild(scope);
      const el = makeEl({ target: "self", root: "#scope" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.options.root).toBe(scope);
    });

    it("root 未指定なら init.root は null", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.options.root).toBeNull();
    });

    it("root-margin 属性を渡す（既定 0px）", async () => {
      const el = makeEl({ target: "self", "root-margin": "10px 0px" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.last.options.rootMargin).toBe("10px 0px");

      const el2 = makeEl({ target: "self" });
      document.body.appendChild(el2);
      await flush();
      expect(ctrl.last.options.rootMargin).toBe("0px");
    });

    it("threshold をパースする（単一 / 複数 / 空 / 不正 / 範囲外 / 空スロット）", async () => {
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
        await flush();
        expect(ctrl.last.options.threshold).toEqual(expected);
        el.remove();
      }
    });
  });

  describe("派生プロパティと change", () => {
    it("交差で intersecting/ratio/visible/entry が反映される", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ isIntersecting: true, intersectionRatio: 0.5 });
      expect(el.intersecting).toBe(true);
      expect(el.ratio).toBe(0.5);
      expect(el.visible).toBe(true);
      expect(el.entry?.isIntersecting).toBe(true);
      expect(el.observing).toBe(true);
    });
  });

  describe("once", () => {
    it("初回交差で自動 disconnect する", async () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ isIntersecting: true });
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("非交差では disconnect しない", async () => {
      const el = makeEl({ target: "self", once: "" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ isIntersecting: false });
      expect(el.observing).toBe(true);
    });

    it("once 無しなら交差しても監視継続", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ isIntersecting: true });
      expect(el.observing).toBe(true);
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
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      hero.remove(); // セレクタが解決不能になっても
      el.unobserve(); // Core の追跡状態に委譲して停止できる
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("対象が解決不能になった後の observe() は stale observer を片付け observing を false にする", async () => {
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      hero.remove();
      el.observe(); // 再解決で null → stale observer を disconnect
      expect(el.observing).toBe(false);
      expect(ctrl.last.disconnected).toBe(true);
    });

    it("reobserve コマンドは同一対象でも observer を作り直す（冪等回避で再武装）", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      el.reobserve();
      expect(ctrl.instances).toHaveLength(2);
      expect(ctrl.instances[0].disconnected).toBe(true);
      expect(el.observing).toBe(true);
    });

    it("reobserve コマンドは対象が解決不能なら stale observer を片付け observing を false にする", async () => {
      const hero = document.createElement("section");
      hero.id = "hero";
      document.body.appendChild(hero);
      const el = makeEl({ target: "#hero" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      hero.remove();
      el.reobserve(); // 再解決で null → stale observer を disconnect
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

    it("reset コマンドで visible ラッチを解除", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      ctrl.emit({ isIntersecting: true });
      expect(el.visible).toBe(true);
      el.reset();
      expect(el.visible).toBe(false);
    });
  });

  describe("trigger", () => {
    it("false→true で再 observe し trigger-changed を発火、即 false に戻る", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      await flush();
      const onTrigger = vi.fn();
      el.addEventListener("wcs-intersect:trigger-changed", onTrigger);
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
      // trigger-changed(detail:false) は「トリガを消費した」momentary な確認応答であり、
      // 観測の成否ではない。対象が解決できなくても auto-reset と完了通知は常に行い、
      // 実際の成否は observing が false のまま で表現される（現状動作の固定）。
      const el = makeEl({ target: "#missing", manual: "" });
      document.body.appendChild(el);
      await flush();
      const onTrigger = vi.fn();
      el.addEventListener("wcs-intersect:trigger-changed", onTrigger);
      el.trigger = true;
      expect(onTrigger).toHaveBeenCalledOnce();
      expect(el.trigger).toBe(false);
      expect(el.observing).toBe(false); // 未解決なので観測は始まっていない
    });
  });

  describe("ネスト利用", () => {
    it("子孫 <wcs-intersect> の change(bubbles) を親が拾っても親の once 解除を起こさない", async () => {
      // change は bubbles:true。親が once のとき、子の交差イベントが親リスナへ伝播しても
      // event.target !== this のガードで親の observer を切らないことを確認。
      const parent = makeEl({ target: "self", once: "" });
      document.body.appendChild(parent);
      await flush();
      const child = makeEl({ target: "self" });
      parent.appendChild(child);
      await flush();
      expect(parent.observing).toBe(true);

      // 子の observer（最後に生成されたインスタンス）で交差を発火 → 親まで bubble。
      ctrl.emit({ isIntersecting: true });
      // 子の交差では親の once は発動せず、親は監視継続。
      expect(parent.observing).toBe(true);
    });
  });

  describe("attributeChangedCallback", () => {
    it("接続中に target を変更すると再 observe する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      el.innerHTML = "<img>";
      el.setAttribute("target", ""); // 省略相当 → 子を監視
      await flush();
      // 空文字 set は removeAttribute ではないので target="" 扱い → 子へ
      expect(ctrl.instances.length).toBeGreaterThanOrEqual(2);
      expect(el.style.display).toBe("contents");
    });

    it("同値変更は無視する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.setAttribute("root-margin", "0px");
      await flush();
      el.setAttribute("root-margin", "0px");
      await flush();
      // 値が変わらないので oldValue===newValue で早期 return（再生成しない）
      expect(ctrl.instances).toHaveLength(1);
    });

    it("未接続なら attributeChangedCallback は監視を起こさない", async () => {
      const el = makeEl({ target: "self" });
      el.setAttribute("root-margin", "10px");
      await flush();
      expect(ctrl.instances).toHaveLength(0);
    });

    it("manual なら属性変更で再 observe しない", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      await flush();
      el.setAttribute("root-margin", "10px");
      await flush();
      expect(ctrl.instances).toHaveLength(0);
    });

    it("once は observedAttributes に含まれない（再 observe を起こさない）", async () => {
      expect(WcsIntersect.observedAttributes).not.toContain("once");
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.setAttribute("once", "");
      await flush();
      // once トグルでは attributeChangedCallback が走らず observer を作り直さない
      expect(ctrl.instances).toHaveLength(1);
    });

    it("once は fire 時に評価されるので接続後に付与しても有効", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      el.once = true; // 接続後に付与
      ctrl.emit({ isIntersecting: true });
      expect(el.observing).toBe(false); // once として機能して disconnect
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
    function observingLog(el: WcsIntersect): boolean[] {
      const log: boolean[] = [];
      el.addEventListener("wcs-intersect:observing-changed", (e) => log.push((e as CustomEvent).detail));
      return log;
    }

    it("入れ直しの間に target が書かれると、前の target は監視せず、新しい target だけを監視する", async () => {
      const a = document.createElement("section");
      a.id = "ticket-14";
      const b = document.createElement("section");
      b.id = "ticket-11";
      document.body.append(a, b);
      const el = makeEl({ target: "#ticket-14" });
      document.body.appendChild(el);
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(ctrl.last.observed).toEqual([a]);
      const log = observingLog(el);

      // state のマイクロタスクは、router が中身を入れ直す前に積まれている
      queueMicrotask(() => { el.target = "#ticket-11"; });
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
      el.rootMargin = "10px";
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
      el.rootMargin = "10px";
      el.threshold = "0.5";
      await flush();
      expect(ctrl.instances).toHaveLength(1);
      expect(ctrl.last.options.rootMargin).toBe("10px");
      expect(ctrl.last.options.threshold).toBe(0.5);
    });
  });

  describe("Shell wcBindable / 静的契約", () => {
    it("hasConnectedCallbackPromise は true（SSR 対応）", () => {
      expect(WcsIntersect.hasConnectedCallbackPromise).toBe(true);
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
      expect(names).toEqual(["observe", "reobserve", "unobserve", "disconnect", "reset"]);
    });
  });

  describe("SSR / connectedCallbackPromise", () => {
    it("接続前は解決済みの promise を返す", async () => {
      const el = makeEl({ target: "self" });
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("connectedCallback で Core の ready（即時解決）を connectedCallbackPromise に設定する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("manual でも connectedCallbackPromise は即時解決する（observe は遅延しても readiness は同期）", async () => {
      const el = makeEl({ target: "self", manual: "" });
      document.body.appendChild(el);
      expect(el.observing).toBe(false);
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });

    it("disconnectedCallback で Core を dispose し、切断後に届いた交差コールバックを無視する", async () => {
      const el = makeEl({ target: "self" });
      document.body.appendChild(el);
      await flush();
      expect(el.observing).toBe(true);
      // 切断前の observer を保持してから remove → dispose で世代を無効化。
      const stale = ctrl.last;
      el.remove();
      expect(el.observing).toBe(false);
      // 切断後に古い observer が遅れて交差を配信しても状態を変えない（_gen ガード）。
      stale.emit([
        { isIntersecting: true, intersectionRatio: 1, time: 0, target: el } as unknown as IntersectionObserverEntry,
      ]);
      expect(el.visible).toBe(false);
      expect(el.intersecting).toBe(false);
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

    it("undefined はマークアップに書かれた属性へ戻し、null は属性を外す（P1 / P2）", () => {
      const host = document.createElement("div");
      host.innerHTML =
        '<wcs-intersect target="self" root="#r" root-margin="10px" threshold="0.5" once manual></wcs-intersect>';
      const el = host.firstElementChild as WcsIntersect;
      el.target = "#a";
      el.root = "#b";
      el.rootMargin = "20px";
      el.threshold = "1";
      el.once = false;
      el.manual = false;
      el.target = undefined;
      el.root = undefined;
      el.rootMargin = undefined;
      el.threshold = undefined;
      el.once = undefined;
      el.manual = undefined;
      expect(el.target).toBe("self");
      expect(el.root).toBe("#r");
      expect(el.rootMargin).toBe("10px");
      expect(el.threshold).toBe("0.5");
      expect(el.once).toBe(true);
      expect(el.manual).toBe(true);
      el.target = null;
      el.root = null;
      el.rootMargin = null;
      el.threshold = null;
      el.once = null;
      el.manual = null;
      for (const name of ["target", "root", "root-margin", "threshold", "once", "manual"]) {
        expect(el.hasAttribute(name)).toBe(false);
      }
      expect(el.rootMargin).toBe("0px");
    });

    it("接続中の target に undefined を書くと文字列 \"undefined\" ではなくマークアップの値へ戻して再 observe する", async () => {
      const host = document.createElement("div");
      host.innerHTML = '<wcs-intersect target="self"></wcs-intersect>';
      document.body.appendChild(host);
      await flush();
      const el = host.firstElementChild as WcsIntersect;
      expect(el.observing).toBe(true);
      el.target = "#missing";
      await flush();
      expect(el.observing).toBe(false);
      el.target = undefined;
      await flush();
      expect(el.getAttribute("target")).toBe("self");
      expect(el.observing).toBe(true);
      expect(el.style.display).toBe("block");
    });
  });
});
