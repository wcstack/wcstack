import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WcsSse } from "../src/components/Sse";
import { SseCore } from "../src/core/SseCore";

/** 接続の判断はマイクロタスク（timing-and-firing-contract §23）: それを流す */
const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));

// EventSource モック
class MockEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MockEventSource.CONNECTING;
  url: string;
  withCredentials: boolean;

  static instances: MockEventSource[] = [];

  constructor(url: string, opts?: EventSourceInit) {
    super();
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  close = vi.fn().mockImplementation(function (this: MockEventSource) {
    this.readyState = MockEventSource.CLOSED;
  });

  simulateOpen(): void {
    this.readyState = MockEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  simulateMessage(data: any, lastEventId = ""): void {
    this.dispatchEvent(new MessageEvent("message", { data, lastEventId }));
  }

  simulateNamedEvent(type: string, data: any): void {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }

  simulateError(readyState = MockEventSource.CONNECTING): void {
    this.readyState = readyState;
    this.dispatchEvent(new Event("error"));
  }

  // `as EventListener` キャストが許す「lastEventId を持たない素の Event」を named 型で
  // 発火するケース。実 SSE では起きないが型保証を握り潰している箇所の防御を検証する。
  simulateBareNamedEvent(type: string): void {
    this.dispatchEvent(new Event(type));
  }

  static resetInstances(): void {
    MockEventSource.instances = [];
  }

  static get last(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

// テスト用にコンポーネントを登録
if (!customElements.get("wcs-sse")) {
  customElements.define("wcs-sse", WcsSse);
}

function createEl(attrs: Record<string, string> = {}): WcsSse {
  const el = document.createElement("wcs-sse") as WcsSse;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

describe("WcsSse", () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    (globalThis as any).EventSource = MockEventSource;
    MockEventSource.resetInstances();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
  });

  describe("属性アクセサ", () => {
    it("url の get/set", async () => {
      const el = createEl();
      expect(el.url).toBe("");
      el.url = "/feed";
      await flush();
      expect(el.getAttribute("url")).toBe("/feed");
      expect(el.url).toBe("/feed");
    });

    it("withCredentials の get/set", () => {
      const el = createEl();
      expect(el.withCredentials).toBe(false);
      el.withCredentials = true;
      expect(el.hasAttribute("with-credentials")).toBe(true);
      el.withCredentials = false;
      expect(el.hasAttribute("with-credentials")).toBe(false);
    });

    it("events の get/set", () => {
      const el = createEl();
      expect(el.events).toBe("");
      el.events = "price,trade";
      expect(el.getAttribute("events")).toBe("price,trade");
      expect(el.events).toBe("price,trade");
    });

    it("raw の get/set", () => {
      const el = createEl();
      expect(el.raw).toBe(false);
      el.raw = true;
      expect(el.hasAttribute("raw")).toBe(true);
      el.raw = false;
      expect(el.hasAttribute("raw")).toBe(false);
    });

    it("manual の get/set", () => {
      const el = createEl();
      expect(el.manual).toBe(false);
      el.manual = true;
      expect(el.hasAttribute("manual")).toBe(true);
      el.manual = false;
      expect(el.hasAttribute("manual")).toBe(false);
    });

    it("autoReconnect の get/set（null / undefined も）", () => {
      const host = document.createElement("div");
      host.innerHTML = "<wcs-sse auto-reconnect></wcs-sse>";
      const authored = host.firstElementChild as WcsSse;
      expect(authored.autoReconnect).toBe(true);
      authored.autoReconnect = false;
      expect(authored.hasAttribute("auto-reconnect")).toBe(false);
      authored.autoReconnect = undefined;
      expect(authored.autoReconnect).toBe(true);
      authored.autoReconnect = null;
      expect(authored.autoReconnect).toBe(false);

      const el = createEl();
      expect(el.autoReconnect).toBe(false);
      el.autoReconnect = true;
      expect(el.getAttribute("auto-reconnect")).toBe("");
    });

    it("reconnectInterval は既定 3000、数でない値も 3000（<wcs-ws> と同じ解釈）", () => {
      const el = createEl();
      expect(el.reconnectInterval).toBe(3000);
      el.reconnectInterval = 5000;
      expect(el.getAttribute("reconnect-interval")).toBe("5000");
      expect(el.reconnectInterval).toBe(5000);
      el.setAttribute("reconnect-interval", "soon");
      expect(el.reconnectInterval).toBe(3000);
      el.setAttribute("reconnect-interval", "");
      expect(el.reconnectInterval).toBe(3000);
      el.reconnectInterval = null;
      expect(el.hasAttribute("reconnect-interval")).toBe(false);
      expect(el.reconnectInterval).toBe(3000);
    });

    it("maxReconnects は既定 Infinity、数でない値も Infinity（<wcs-ws> と同じ解釈）", () => {
      const el = createEl();
      expect(el.maxReconnects).toBe(Infinity);
      el.maxReconnects = 10;
      expect(el.getAttribute("max-reconnects")).toBe("10");
      expect(el.maxReconnects).toBe(10);
      el.setAttribute("max-reconnects", "many");
      expect(el.maxReconnects).toBe(Infinity);
      el.maxReconnects = 0;
      expect(el.maxReconnects).toBe(0);
      el.maxReconnects = undefined;
      expect(el.hasAttribute("max-reconnects")).toBe(false);
      expect(el.maxReconnects).toBe(Infinity);
    });

    it("undefined はマークアップに書かれた属性へ戻し、null は属性を外す（P1 / P2）", async () => {
      const host = document.createElement("div");
      host.innerHTML = '<wcs-sse url="/authored" events="a,b" with-credentials raw manual></wcs-sse>';
      const el = host.firstElementChild as WcsSse;
      el.url = "/bound";
      await flush();
      el.events = "c";
      el.withCredentials = false;
      el.raw = false;
      el.manual = false;
      el.url = undefined;
      await flush();
      el.events = undefined;
      el.withCredentials = undefined;
      el.raw = undefined;
      el.manual = undefined;
      expect(el.url).toBe("/authored");
      expect(el.events).toBe("a,b");
      expect(el.withCredentials).toBe(true);
      expect(el.raw).toBe(true);
      expect(el.manual).toBe(true);
      el.url = null;
      await flush();
      el.events = null;
      el.withCredentials = null;
      el.raw = null;
      el.manual = null;
      expect(el.hasAttribute("url")).toBe(false);
      expect(el.hasAttribute("events")).toBe(false);
      expect(el.withCredentials).toBe(false);
      expect(el.raw).toBe(false);
      expect(el.manual).toBe(false);
    });

    it("接続中の url に undefined / null を書いても /undefined・/null へ接続しない", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      el.url = "/other";
      await flush();
      expect(MockEventSource.last.url).toBe("/other");
      // undefined はマークアップの url へ戻す（= その url へ張り直す）
      el.url = undefined;
      await flush();
      expect(MockEventSource.last.url).toBe("/feed");
      // null は属性を外すだけ（url の除去は既存接続を切らない）
      el.url = null;
      await flush();
      expect(MockEventSource.instances.map(es => es.url)).toEqual(["/feed", "/other", "/feed"]);
      expect(MockEventSource.last.close).not.toHaveBeenCalled();
    });
  });

  describe("wcBindable", () => {
    it("Shell は trigger プロパティを追加する", () => {
      const names = WcsSse.wcBindable.properties.map(p => p.name);
      expect(names).toContain("trigger");
    });

    it("inputs に url/withCredentials/events/raw/autoReconnect/reconnectInterval/maxReconnects/staleAfter/manual/trigger を持つ", () => {
      const names = WcsSse.wcBindable.inputs?.map(i => i.name);
      expect(names).toEqual([
        "url", "withCredentials", "events", "raw",
        "autoReconnect", "reconnectInterval", "maxReconnects", "staleAfter", "manual", "trigger",
      ]);
    });

    it("auto-reconnect 系の入力は <wcs-ws> と同じ名前・同じ属性を宣言する", () => {
      const inputs = WcsSse.wcBindable.inputs ?? [];
      expect(inputs.filter(i => ["autoReconnect", "reconnectInterval", "maxReconnects"].includes(i.name))).toEqual([
        { name: "autoReconnect", attribute: "auto-reconnect" },
        { name: "reconnectInterval", attribute: "reconnect-interval" },
        { name: "maxReconnects", attribute: "max-reconnects" },
      ]);
    });

    it("commands は Core の commands を単一情報源として継承する", () => {
      expect(WcsSse.wcBindable.commands).toBe(SseCore.wcBindable.commands);
      expect(WcsSse.wcBindable.commands?.map(c => c.name)).toEqual(["connect", "close"]);
    });
  });

  describe("ライフサイクル", () => {
    it("connectedCallback で display:none・url があれば自動接続", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      expect(el.style.display).toBe("none");
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.last.url).toBe("/feed");
    });

    it("manual 指定時は自動接続しない", async () => {
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("url が無ければ自動接続しない", async () => {
      const el = createEl();
      document.body.appendChild(el);
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("disconnectedCallback で接続をクローズする", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;
      el.remove();
      expect(es.close).toHaveBeenCalled();
    });

    it("SSR: connectedCallbackPromise が解決し hasConnectedCallbackPromise=true", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
      expect((el.constructor as typeof WcsSse).hasConnectedCallbackPromise).toBe(true);
      el.remove();
    });

    it("DOM 未挿入では connectedCallbackPromise は初期の解決済み Promise", async () => {
      const el = createEl({ url: "/feed" });
      await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    });
  });

  describe("attributeChangedCallback", () => {
    it("接続中に url を変更すると再接続する", async () => {
      const el = createEl({ url: "/a" });
      document.body.appendChild(el);
      await flush();
      expect(MockEventSource.last.url).toBe("/a");
      el.setAttribute("url", "/b");
      await flush();
      expect(MockEventSource.last.url).toBe("/b");
    });

    it("manual 指定時は url 変更で再接続しない", async () => {
      const el = createEl({ url: "/a", manual: "" });
      document.body.appendChild(el);
      await flush();
      el.setAttribute("url", "/b");
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("未接続(DOM外)では url 設定で接続しない", async () => {
      const el = createEl();
      el.setAttribute("url", "/feed");
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("url を空文字/除去に変更しても既存接続は生き残る（意図的：broadcast の name と同型）", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;
      expect(es.close).not.toHaveBeenCalled();

      el.setAttribute("url", "");
      await flush();
      expect(es.close).not.toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(1);

      el.removeAttribute("url");
      await flush();
      expect(es.close).not.toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(1);
    });
  });

  describe("コマンド", () => {
    it("trigger=true で接続する", async () => {
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
      el.trigger = true;
      expect(MockEventSource.instances).toHaveLength(1);
      expect(el.trigger).toBe(false);
    });

    it("trigger=false は何もしない", async () => {
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
      await flush();
      el.trigger = false;
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("close() で接続を閉じる", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;
      el.close();
      expect(es.close).toHaveBeenCalled();
    });

    it("url 未設定で connect() しても例外を投げず何もしない", async () => {
      const el = createEl({ manual: "" });
      document.body.appendChild(el);
      await flush();
      expect(() => el.connect()).not.toThrow();
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("url 未設定で trigger=true でも例外を投げない", async () => {
      const el = createEl({ manual: "" });
      document.body.appendChild(el);
      await flush();
      expect(() => { el.trigger = true; }).not.toThrow();
      expect(MockEventSource.instances).toHaveLength(0);
      expect(el.trigger).toBe(false);
    });
  });

  // router は遷移で同じノードを入れ直し、state は新しい params からの url をマイクロタスクで書く
  // （timing-and-firing-contract §23、docs/seam-apps.md の shift-desk）
  describe("接続の判断はマイクロタスクで、そのときの入力で", () => {
    it("入れ直しの間に url が書かれると、前の url へはつながず、新しい url へ 1 本だけつなぐ", async () => {
      const el = createEl({ url: "/feed?room=14" });
      document.body.appendChild(el);
      await flush();
      expect(MockEventSource.instances.map((es) => es.url)).toEqual(["/feed?room=14"]);

      queueMicrotask(() => { el.url = "/feed?room=11"; });
      el.remove();
      document.body.appendChild(el);
      await flush();
      await flush();
      expect(MockEventSource.instances.map((es) => es.url)).toEqual(["/feed?room=14", "/feed?room=11"]);
      el.remove();
    });

    it("判断の前に外した要素はつながない", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      el.remove();
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("付けたのと同じタスクで close() すると、つながない", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      el.close();
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
      el.remove();
    });

    it("付けたのと同じタスクで connect() すると、その 1 本だけ（判断を引き取る）", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      el.connect();
      await flush();
      expect(MockEventSource.instances).toHaveLength(1);
      el.remove();
    });

    it("同じタスクで url の後に manual が書かれると、つながない", async () => {
      const el = createEl();
      document.body.appendChild(el);
      el.url = "/feed";
      el.manual = true;
      await flush();
      expect(MockEventSource.instances).toHaveLength(0);
      el.remove();
    });
  });

  // ブラウザが諦めたストリーム（HTTP のエラー）を開き直す opt-in。<wcs-ws> と同じ名前・同じ意味
  describe("auto-reconnect", () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
    afterEach(() => { vi.useRealTimers(); });

    it("恒久エラー(CLOSED)のストリームを reconnect-interval ms 後に開き直す（接続のオプションも同じ）", async () => {
      const el = createEl({ url: "/feed", events: "price", "auto-reconnect": "", "reconnect-interval": "1000" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(el.readyState).toBe(MockEventSource.CLOSED);
      expect(el.errorInfo?.recoverable).toBe(false);
      vi.advanceTimersByTime(999);
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances.map((es) => es.url)).toEqual(["/feed", "/feed"]);
      expect(el.loading).toBe(true);
      expect(el.error).toBeNull();
      MockEventSource.last.simulateOpen();
      MockEventSource.last.simulateNamedEvent("price", "10");
      expect(el.connected).toBe(true);
      expect(el.message).toEqual({ event: "price", data: 10, lastEventId: "" });
      el.remove();
    });

    it("属性が無ければ（既定）諦めたストリームは開き直さない", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(MockEventSource.instances).toHaveLength(1);
      el.remove();
    });

    it("試行のときの要素の url で開く（manual の要素は url の変化ではつながない）", async () => {
      const el = createEl({ url: "/feed?token=old", manual: "", "auto-reconnect": "", "reconnect-interval": "1000" });
      document.body.appendChild(el);
      await flush();
      el.connect();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      // state の getter が新しいトークンで url を作り直した
      el.url = "/feed?token=new";
      await flush();
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(MockEventSource.instances.map((es) => es.url)).toEqual(["/feed?token=old", "/feed?token=new"]);
      el.remove();
    });

    it("試行のときに url が無ければ何もしない", async () => {
      const el = createEl({ url: "/feed", manual: "", "auto-reconnect": "", "reconnect-interval": "1000" });
      document.body.appendChild(el);
      await flush();
      el.connect();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      el.url = null;
      vi.advanceTimersByTime(1000);
      expect(MockEventSource.instances).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(el.readyState).toBe(MockEventSource.CLOSED);
      el.remove();
    });

    it("待つ間に url が変わると（manual でない要素）その場で新しい url を開き、待っていた開き直しは外す", async () => {
      const el = createEl({ url: "/feed?token=old", "auto-reconnect": "", "reconnect-interval": "1000" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      el.url = "/feed?token=new";
      await flush();
      expect(MockEventSource.instances.map((es) => es.url)).toEqual(["/feed?token=old", "/feed?token=new"]);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(2);
      el.remove();
    });

    it("max-reconnects 回で止まり、最後の error が残る", async () => {
      const el = createEl({ url: "/feed", "auto-reconnect": "", "reconnect-interval": "100", "max-reconnects": "1" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      vi.advanceTimersByTime(100);
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      const last = el.error;
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(el.error).toBe(last);
      expect(el.errorInfo?.recoverable).toBe(false);
      el.remove();
    });

    it("close() は待っている開き直しを止める", async () => {
      const el = createEl({ url: "/feed", "auto-reconnect": "", "reconnect-interval": "100" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      el.close();
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(1);
      el.remove();
    });

    it("要素を外すと待っている開き直しは止まり、入れ直すと 1 本だけつなぐ", async () => {
      const el = createEl({ url: "/feed", "auto-reconnect": "", "reconnect-interval": "100" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      const changes: string[] = [];
      for (const type of ["wcs-sse:connected-changed", "wcs-sse:loading-changed", "wcs-sse:readystate-changed"]) {
        el.addEventListener(type, () => changes.push(type));
      }
      el.remove();
      // 待つ間の状態は外しても変わらない — 知らせることも無い（timing-and-firing-contract §22）
      expect(changes).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(1);
      document.body.appendChild(el);
      await flush();
      expect(MockEventSource.instances).toHaveLength(2);
      el.remove();
    });
  });

  describe("upgrade 経路", () => {
    it("タグ定義前に配置された要素を upgrade しても接続は 1 本に収まる", async () => {
      // autoloader の主経路：マークアップ存在後にタグ定義 → 仕様により
      // attributeChangedCallback と connectedCallback が両方発火し connect() が複数回呼ばれる。
      // 別タグ名（subclass）にしているのは CustomElementRegistry が「1コンストラクタ＝1タグ名」
      // を強制するため（WcsSse は冒頭で wcs-sse に登録済みで再登録は throw）。connect() は
      // WcsSse 由来でオーバーライドしていないので挙動は本物の Shell と同一。
      const connectSpy = vi.spyOn(WcsSse.prototype, "connect");
      class WcsSseUpgrade extends WcsSse {}
      document.body.innerHTML = '<wcs-sse-up url="/feed"></wcs-sse-up>';
      customElements.define("wcs-sse-up", WcsSseUpgrade);
      await flush();
      // upgrade の attributeChangedCallback と connectedCallback は 1 つのマイクロタスクにまとまり（§23）…
      expect(connectSpy.mock.calls.length).toBe(1);
      // …EventSource は 1 本。
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.last.url).toBe("/feed");
      connectSpy.mockRestore();
    });
  });

  describe("接続オプション", () => {
    it("with-credentials 属性を EventSource に渡す", async () => {
      const el = createEl({ url: "/feed", "with-credentials": "" });
      document.body.appendChild(el);
      await flush();
      expect(MockEventSource.last.withCredentials).toBe(true);
    });

    it("events 属性をパースして名前付きイベントを購読する", async () => {
      const el = createEl({ url: "/feed", events: "price, trade" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateNamedEvent("price", "10");
      expect(el.message).toEqual({ event: "price", data: 10, lastEventId: "" });
    });

    it("stale-after 属性（staleAfter）を接続のオプションとして Core に渡す", async () => {
      const spy = vi.spyOn(SseCore.prototype, "connect");
      const el = createEl({ url: "/feed", "stale-after": "45000" });
      expect(el.staleAfter).toBe(45000);
      document.body.appendChild(el);
      await flush();
      expect(spy).toHaveBeenCalledWith("/feed", expect.objectContaining({ staleAfter: 45000 }));
      spy.mockRestore();
      el.remove();
    });

    it("staleAfter は数でない・0 以下の値で 0（見張らない）になり、プロパティは属性へ写る", () => {
      const el = createEl();
      expect(el.staleAfter).toBe(0);
      el.setAttribute("stale-after", "soon");
      expect(el.staleAfter).toBe(0);
      el.setAttribute("stale-after", "-1");
      expect(el.staleAfter).toBe(0);
      el.staleAfter = 60000;
      expect(el.getAttribute("stale-after")).toBe("60000");
      el.staleAfter = null;
      expect(el.hasAttribute("stale-after")).toBe(false);
    });

    it("auto-reconnect / reconnect-interval / max-reconnects を接続のオプションとして Core に渡す", async () => {
      const spy = vi.spyOn(SseCore.prototype, "connect");
      const el = createEl({ url: "/feed", "auto-reconnect": "", "reconnect-interval": "5000", "max-reconnects": "10" });
      document.body.appendChild(el);
      await flush();
      expect(spy).toHaveBeenCalledWith("/feed", expect.objectContaining({
        autoReconnect: true, reconnectInterval: 5000, maxReconnects: 10,
      }));
      // 開き直しの url は試行のときの要素の url
      const options = spy.mock.calls[0][1]!;
      el.setAttribute("url", "/next");
      expect(options.reconnectUrl!()).toBe("/next");
      spy.mockRestore();
      el.remove();
    });

    it("属性が無ければ（既定）auto-reconnect は false で渡す", async () => {
      const spy = vi.spyOn(SseCore.prototype, "connect");
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      expect(spy).toHaveBeenCalledWith("/feed", expect.objectContaining({
        autoReconnect: false, reconnectInterval: 3000, maxReconnects: Infinity,
      }));
      spy.mockRestore();
      el.remove();
    });

    it("raw 属性で JSON パースを無効化する", async () => {
      const el = createEl({ url: "/feed", raw: "" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateMessage('{"a":1}');
      expect(el.message?.data).toBe('{"a":1}');
    });

    it("lastEventId を持たない素の Event でも lastEventId は空文字にフォールバックする", async () => {
      const el = createEl({ url: "/feed", events: "ping", raw: "" });
      document.body.appendChild(el);
      await flush();
      MockEventSource.last.simulateBareNamedEvent("ping");
      expect(el.message?.event).toBe("ping");
      expect(el.message?.lastEventId).toBe("");
    });
  });

  describe("委譲ゲッター", () => {
    it("message/connected/loading/error/readyState を Core から委譲する", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      expect(el.connected).toBe(false);
      expect(el.loading).toBe(true);
      expect(el.error).toBeNull();
      expect(el.readyState).toBe(MockEventSource.CONNECTING);
      MockEventSource.last.simulateOpen();
      expect(el.connected).toBe(true);
      MockEventSource.last.simulateMessage("hi");
      expect(el.message?.data).toBe("hi");
    });

    it("errorInfo が Shell ゲッター経由で Core から読み取れる", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      expect(el.errorInfo).toBeNull();
      // 恒久切断(CLOSED)で connection-error / execute / recoverable=false が入る。
      MockEventSource.last.simulateError(MockEventSource.CLOSED);
      expect(el.errorInfo).toEqual({
        code: "connection-error", phase: "execute", recoverable: false, message: "SSE connection error",
      });
    });
  });

  describe("wcBindable errorInfo", () => {
    it("Shell は errorInfo プロパティを（Core 継承で）宣言する", () => {
      const names = WcsSse.wcBindable.properties.map((p) => p.name);
      expect(names).toContain("errorInfo");
    });
  });

  describe("エラー処理", () => {
    it("再接続中(CONNECTING)のエラーは loading を維持し error を公開する", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;
      es.simulateOpen();
      expect(el.connected).toBe(true);

      es.simulateError(MockEventSource.CONNECTING);
      expect(el.connected).toBe(false);
      expect(el.loading).toBe(true);
      expect(el.readyState).toBe(MockEventSource.CONNECTING);
      expect(el.error).toBeInstanceOf(Event);
    });

    it("恒久エラー(CLOSED)で loading=false・readyState=CLOSED にし死んだ接続を破棄する", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;

      es.simulateError(MockEventSource.CLOSED);
      expect(el.connected).toBe(false);
      expect(el.loading).toBe(false);
      expect(el.readyState).toBe(MockEventSource.CLOSED);

      // 死んだ接続が破棄されているため、同一 url で再接続できる（冪等ガードに引っ掛からない）。
      el.connect();
      expect(MockEventSource.instances).toHaveLength(2);
      expect(MockEventSource.last).not.toBe(es);
    });

    it("トランジェントエラー後にネイティブ再接続が成功すると error がクリアされる", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;
      es.simulateOpen();

      // トランジェントエラー（CONNECTING）→ error が立つ
      es.simulateError(MockEventSource.CONNECTING);
      expect(el.error).toBeInstanceOf(Event);

      // ネイティブ再接続成功（同一インスタンスが open を再発火）→ error が null に戻る
      es.simulateOpen();
      expect(el.connected).toBe(true);
      expect(el.loading).toBe(false);
      expect(el.error).toBeNull();
    });

    it("close() 後に再 connect() すると error がリセットされる", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;
      es.simulateOpen();
      es.simulateError(MockEventSource.CONNECTING);
      expect(el.error).toBeInstanceOf(Event);

      el.close();
      // close() 自体は error をクリアしない（最後の失敗情報を保持）
      expect(el.error).toBeInstanceOf(Event);

      // 再 connect() で _doConnect の _setError(null) により error がリセットされる
      el.connect();
      expect(el.error).toBeNull();
    });
  });

  describe("再入(reentrancy)", () => {
    it("error リスナから同期 close() を呼んでもクラッシュせず状態が固着しない", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      await flush();
      const es = MockEventSource.last;
      es.simulateOpen();

      // wcs-sse:error の同期 dispatch 中に close() を呼ぶ再入。
      const onError = vi.fn(() => el.close());
      el.addEventListener("wcs-sse:error", onError);

      // 旧実装ではここで _es=null 後の readyState 参照が TypeError でクラッシュした。
      expect(() => es.simulateError(MockEventSource.CONNECTING)).not.toThrow();
      expect(onError).toHaveBeenCalledTimes(1);

      // 再入した close() が確定させた状態（CLOSED/未接続/loading=false）が保たれ、
      // _onError 残部による巻き戻しが起きていないこと。
      expect(el.readyState).toBe(MockEventSource.CLOSED);
      expect(el.connected).toBe(false);
      expect(el.loading).toBe(false);
      expect(es.close).toHaveBeenCalled();
    });

    it("CLOSED 発火元の error リスナから同期 connect()（別url）を呼んでも新接続 esB を破壊しない", async () => {
      // 所有権ガードが真に守る破壊経路を検証する。発火元 esA を CLOSED で error 発火
      // させると先読み state=CLOSED になる。ガードが無ければ _onError 残部が
      // 新接続 esB に対し _setReadyState(CLOSED)（esB の CONNECTING を上書き）と
      // this._es=null（esB を破棄）を実行して esB を壊す。CONNECTING 発火元では
      // state が esB の現状態と同値で same-value ガードに吸収され、この破壊が
      // 顕在化しないためガードの効果を検出できない。
      const el = createEl({ url: "/a" });
      document.body.appendChild(el);
      await flush();
      const esA = MockEventSource.last;
      esA.simulateOpen();

      // error dispatch 中に別 url へ再接続。新しい _es(esB) が CONNECTING で立つ。
      const onError = vi.fn(() => {
        el.setAttribute("url", "/b");
        el.connect();
        el.removeEventListener("wcs-sse:error", onError);
      });
      el.addEventListener("wcs-sse:error", onError);

      expect(() => esA.simulateError(MockEventSource.CLOSED)).not.toThrow();

      const esB = MockEventSource.last;
      expect(esB).not.toBe(esA);
      expect(esB.url).toBe("/b");

      // 所有権ガードにより、CLOSED 発火元の _onError 残部は esB を一切壊さない：
      // - esB は close されず生存（this._es=null による破棄が走らない）
      // - readyState が CLOSED に巻き戻されず CONNECTING のまま
      // - connected=false / loading=true の接続中状態が維持される
      expect(esB.close).not.toHaveBeenCalled();
      expect(el.readyState).toBe(MockEventSource.CONNECTING);
      expect(el.connected).toBe(false);
      expect(el.loading).toBe(true);

      // その後 esB の open で正常に OPEN へ遷移できる（接続が生きている証左）。
      esB.simulateOpen();
      expect(el.connected).toBe(true);
      expect(el.readyState).toBe(MockEventSource.OPEN);
    });

    it("_doConnect: loading-changed リスナから同期 connect()（別url＋即open）を呼んでも esB の状態を巻き戻さない", async () => {
      // _setLoading(true) の同期 dispatch を起点とする再入。外側 _doConnect が後続の
      // _setReadyState(esA.readyState=CONNECTING) を出すと、再入が確立させた esB(OPEN)
      // の状態を CONNECTING へ巻き戻してしまう。所有権ガードでこれを防ぐ。
      // 再入内で esB を即 open させ esA(CONNECTING) と readyState を差異化することで、
      // ガードを外すと巻き戻りが顕在化＝テストが失敗する構成にしている。
      const el = createEl({ url: "/a", manual: "" });
      document.body.appendChild(el);
      await flush();

      let reentered = false;
      const onLoading = vi.fn(() => {
        if (!reentered && el.loading) {
          reentered = true;
          el.setAttribute("url", "/b");
          el.connect();
          // 再入接続 esB を同期で OPEN にする（esA は CONNECTING のまま）。
          const esBInner = MockEventSource.instances.find(i => i.url === "/b")!;
          esBInner.simulateOpen();
        }
      });
      el.addEventListener("wcs-sse:loading-changed", onLoading);

      expect(() => el.connect()).not.toThrow();

      const esA = MockEventSource.instances.find(i => i.url === "/a")!;
      const esB = MockEventSource.instances.find(i => i.url === "/b")!;
      expect(esA).toBeDefined();
      expect(esB).toBeDefined();

      // 外側 _doConnect が生成した esA はリークしない（再入 connect の _closeInternal が close）。
      expect(esA.close).toHaveBeenCalled();
      // 再入が立てた esB は現役接続として生存（破棄されない）。
      expect(esB.close).not.toHaveBeenCalled();

      // 所有権ガードにより esB の OPEN 状態が維持され、esA の CONNECTING に巻き戻らない。
      expect(el.connected).toBe(true);
      expect(el.readyState).toBe(MockEventSource.OPEN);

      // 現役接続 esB からメッセージが届く（_url/_es 整合の確認）。
      esB.simulateMessage("from-b");
      expect(el.message?.data).toBe("from-b");
    });

    it("_doConnect: error(detail=null) リスナから同期 connect()（別url＋即open）を呼んでも状態を巻き戻さない", async () => {
      // 恒久エラー(CLOSED)後の再 connect では _doConnect 内の _setError(null) が
      // wcs-sse:error(detail=null) を dispatch する（README 記載のプロパティ変更通知）。
      // その同期 dispatch を起点とする再入で、外側 _doConnect 後続の
      // _setReadyState(es.readyState) が再入接続の状態を巻き戻さないこと（line 208 の
      // 所有権ガード）を検証する。再入接続を即 open し、外側の再 connect 接続(CONNECTING)
      // と readyState を差異化することで、ガードを外すと巻き戻りが顕在化する。
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
      await flush();
      el.connect();
      const esFeed = MockEventSource.last;

      // 恒久エラーで _error を非 null にする（次の connect の _setError(null) を発火源にする）。
      esFeed.simulateError(MockEventSource.CLOSED);
      expect(el.error).toBeInstanceOf(Event);

      // 再 connect の _doConnect 内で _setError(null) が発火 → そのリスナが別 url へ再入接続し即 open。
      let reentered = false;
      const onError = vi.fn(() => {
        if (!reentered && el.error === null) {
          reentered = true;
          el.setAttribute("url", "/c");
          el.connect();
          const esCInner = MockEventSource.instances.find(i => i.url === "/c")!;
          esCInner.simulateOpen();
        }
      });
      el.addEventListener("wcs-sse:error", onError);

      // /feed への再 connect 接続(esReconnect, CONNECTING)を外側が生成し、その _setError(null)
      // 再入で /c(esC) が立って即 OPEN になる。
      expect(() => el.connect()).not.toThrow();

      const esReconnect = MockEventSource.instances.filter(i => i.url === "/feed")[1];
      const esC = MockEventSource.instances.find(i => i.url === "/c")!;
      expect(esReconnect).toBeDefined();
      expect(esC).toBeDefined();

      // 外側 _doConnect が生成した esReconnect はリークしない（再入 connect の _closeInternal が close）。
      expect(esReconnect.close).toHaveBeenCalled();
      // 再入が立てた esC は現役接続として生存。
      expect(esC.close).not.toHaveBeenCalled();

      // 所有権ガードにより esC の OPEN 状態が維持され、esReconnect の CONNECTING に巻き戻らない。
      expect(el.connected).toBe(true);
      expect(el.readyState).toBe(MockEventSource.OPEN);
      esC.simulateMessage("from-c");
      expect(el.message?.data).toBe("from-c");
    });

    it("_doConnect: loading-changed 再入で再入側が同期 error を立てると外側の _setError(null) が誤クリアしない（line 206 ガード固有）", async () => {
      // line 206 ガード（_setLoading(true) 直後）の固有効果を分離検出する。
      // _setLoading(true) の dispatch で別 url へ再入接続し、再入側 esB が *生成直後に
      // 同期で error を立てて* el.error を非 null 確定させる。外側 _doConnect に制御が
      // 戻ったとき、206 ガードが無ければ後続の _setError(null)(207行) が esB の error を
      // 誤クリアして巻き戻す。206 ガードが有ればその前に return するため error が保持される。
      // ※後段 208 ガードでは捕捉が _setError(null) の *後* になり誤クリアを防げないため、
      //   この経路は 206 ガード固有（208 単独では救えない）。
      const el = createEl({ url: "/a", manual: "" });
      document.body.appendChild(el);
      await flush();

      let reentered = false;
      let esBError: Event | null = null;
      const onLoading = vi.fn(() => {
        if (!reentered && el.loading) {
          reentered = true;
          el.setAttribute("url", "/b");
          el.connect();
          // 再入接続 esB が生成直後に同期 error を立てる（CONNECTING のまま、error 非 null）。
          const esBInner = MockEventSource.instances.find(i => i.url === "/b")!;
          esBInner.simulateError(MockEventSource.CONNECTING);
          esBError = el.error;
        }
      });
      el.addEventListener("wcs-sse:loading-changed", onLoading);

      expect(() => el.connect()).not.toThrow();

      const esB = MockEventSource.instances.find(i => i.url === "/b")!;
      expect(esB).toBeDefined();

      // 再入側 esB が立てた error が確定していたこと（前提）。
      expect(esBError).toBeInstanceOf(Event);
      // 206 ガードにより、外側 _doConnect の _setError(null) が esB の error を巻き戻さない。
      expect(el.error).toBe(esBError);
      expect(el.error).toBeInstanceOf(Event);
    });
  });
});
