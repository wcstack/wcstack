import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WcsSse } from "../src/components/Sse";
import { SseCore } from "../src/core/SseCore";

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
    it("url の get/set", () => {
      const el = createEl();
      expect(el.url).toBe("");
      el.url = "/feed";
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
  });

  describe("wcBindable", () => {
    it("Shell は trigger プロパティを追加する", () => {
      const names = WcsSse.wcBindable.properties.map(p => p.name);
      expect(names).toContain("trigger");
    });

    it("inputs に url/withCredentials/events/raw/manual/trigger を持つ", () => {
      const names = WcsSse.wcBindable.inputs?.map(i => i.name);
      expect(names).toEqual(["url", "withCredentials", "events", "raw", "manual", "trigger"]);
    });

    it("commands は Core の commands を単一情報源として継承する", () => {
      expect(WcsSse.wcBindable.commands).toBe(SseCore.wcBindable.commands);
      expect(WcsSse.wcBindable.commands?.map(c => c.name)).toEqual(["connect", "close"]);
    });
  });

  describe("ライフサイクル", () => {
    it("connectedCallback で display:none・url があれば自動接続", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      expect(el.style.display).toBe("none");
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.last.url).toBe("/feed");
    });

    it("manual 指定時は自動接続しない", () => {
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("url が無ければ自動接続しない", () => {
      const el = createEl();
      document.body.appendChild(el);
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("disconnectedCallback で接続をクローズする", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      const es = MockEventSource.last;
      el.remove();
      expect(es.close).toHaveBeenCalled();
    });

    it("SSR: connectedCallbackPromise が解決し hasConnectedCallbackPromise=true", async () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
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
    it("接続中に url を変更すると再接続する", () => {
      const el = createEl({ url: "/a" });
      document.body.appendChild(el);
      expect(MockEventSource.last.url).toBe("/a");
      el.setAttribute("url", "/b");
      expect(MockEventSource.last.url).toBe("/b");
    });

    it("manual 指定時は url 変更で再接続しない", () => {
      const el = createEl({ url: "/a", manual: "" });
      document.body.appendChild(el);
      el.setAttribute("url", "/b");
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("未接続(DOM外)では url 設定で接続しない", () => {
      const el = createEl();
      el.setAttribute("url", "/feed");
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("url を空文字/除去に変更しても既存接続は生き残る（意図的：broadcast の name と同型）", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      const es = MockEventSource.last;
      expect(es.close).not.toHaveBeenCalled();

      el.setAttribute("url", "");
      expect(es.close).not.toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(1);

      el.removeAttribute("url");
      expect(es.close).not.toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(1);
    });
  });

  describe("コマンド", () => {
    it("trigger=true で接続する", () => {
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
      expect(MockEventSource.instances).toHaveLength(0);
      el.trigger = true;
      expect(MockEventSource.instances).toHaveLength(1);
      expect(el.trigger).toBe(false);
    });

    it("trigger=false は何もしない", () => {
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
      el.trigger = false;
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("close() で接続を閉じる", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      const es = MockEventSource.last;
      el.close();
      expect(es.close).toHaveBeenCalled();
    });

    it("url 未設定で connect() しても例外を投げず何もしない", () => {
      const el = createEl({ manual: "" });
      document.body.appendChild(el);
      expect(() => el.connect()).not.toThrow();
      expect(MockEventSource.instances).toHaveLength(0);
    });

    it("url 未設定で trigger=true でも例外を投げない", () => {
      const el = createEl({ manual: "" });
      document.body.appendChild(el);
      expect(() => { el.trigger = true; }).not.toThrow();
      expect(MockEventSource.instances).toHaveLength(0);
      expect(el.trigger).toBe(false);
    });
  });

  describe("upgrade 経路", () => {
    it("タグ定義前に配置された要素を upgrade しても接続は 1 本に収まる", () => {
      // autoloader の主経路：マークアップ存在後にタグ定義 → 仕様により
      // attributeChangedCallback と connectedCallback が両方発火し connect() が複数回呼ばれる。
      // 別タグ名（subclass）にしているのは CustomElementRegistry が「1コンストラクタ＝1タグ名」
      // を強制するため（WcsSse は冒頭で wcs-sse に登録済みで再登録は throw）。connect() は
      // WcsSse 由来でオーバーライドしていないので挙動は本物の Shell と同一。
      const connectSpy = vi.spyOn(WcsSse.prototype, "connect");
      class WcsSseUpgrade extends WcsSse {}
      document.body.innerHTML = '<wcs-sse-up url="/feed"></wcs-sse-up>';
      customElements.define("wcs-sse-up", WcsSseUpgrade);
      // upgrade 時に connect() が複数回呼ばれても（環境依存だが必ず1回以上）…
      expect(connectSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      // …Core の冪等ガードにより EventSource は 1 本に収束する。
      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.last.url).toBe("/feed");
      connectSpy.mockRestore();
    });
  });

  describe("接続オプション", () => {
    it("with-credentials 属性を EventSource に渡す", () => {
      const el = createEl({ url: "/feed", "with-credentials": "" });
      document.body.appendChild(el);
      expect(MockEventSource.last.withCredentials).toBe(true);
    });

    it("events 属性をパースして名前付きイベントを購読する", () => {
      const el = createEl({ url: "/feed", events: "price, trade" });
      document.body.appendChild(el);
      MockEventSource.last.simulateNamedEvent("price", "10");
      expect(el.message).toEqual({ event: "price", data: 10, lastEventId: "" });
    });

    it("raw 属性で JSON パースを無効化する", () => {
      const el = createEl({ url: "/feed", raw: "" });
      document.body.appendChild(el);
      MockEventSource.last.simulateMessage('{"a":1}');
      expect(el.message?.data).toBe('{"a":1}');
    });

    it("lastEventId を持たない素の Event でも lastEventId は空文字にフォールバックする", () => {
      const el = createEl({ url: "/feed", events: "ping", raw: "" });
      document.body.appendChild(el);
      MockEventSource.last.simulateBareNamedEvent("ping");
      expect(el.message?.event).toBe("ping");
      expect(el.message?.lastEventId).toBe("");
    });
  });

  describe("委譲ゲッター", () => {
    it("message/connected/loading/error/readyState を Core から委譲する", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      expect(el.connected).toBe(false);
      expect(el.loading).toBe(true);
      expect(el.error).toBeNull();
      expect(el.readyState).toBe(MockEventSource.CONNECTING);
      MockEventSource.last.simulateOpen();
      expect(el.connected).toBe(true);
      MockEventSource.last.simulateMessage("hi");
      expect(el.message?.data).toBe("hi");
    });
  });

  describe("エラー処理", () => {
    it("再接続中(CONNECTING)のエラーは loading を維持し error を公開する", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
      const es = MockEventSource.last;
      es.simulateOpen();
      expect(el.connected).toBe(true);

      es.simulateError(MockEventSource.CONNECTING);
      expect(el.connected).toBe(false);
      expect(el.loading).toBe(true);
      expect(el.readyState).toBe(MockEventSource.CONNECTING);
      expect(el.error).toBeInstanceOf(Event);
    });

    it("恒久エラー(CLOSED)で loading=false・readyState=CLOSED にし死んだ接続を破棄する", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
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

    it("トランジェントエラー後にネイティブ再接続が成功すると error がクリアされる", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
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

    it("close() 後に再 connect() すると error がリセットされる", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
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
    it("error リスナから同期 close() を呼んでもクラッシュせず状態が固着しない", () => {
      const el = createEl({ url: "/feed" });
      document.body.appendChild(el);
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

    it("CLOSED 発火元の error リスナから同期 connect()（別url）を呼んでも新接続 esB を破壊しない", () => {
      // 所有権ガードが真に守る破壊経路を検証する。発火元 esA を CLOSED で error 発火
      // させると先読み state=CLOSED になる。ガードが無ければ _onError 残部が
      // 新接続 esB に対し _setReadyState(CLOSED)（esB の CONNECTING を上書き）と
      // this._es=null（esB を破棄）を実行して esB を壊す。CONNECTING 発火元では
      // state が esB の現状態と同値で same-value ガードに吸収され、この破壊が
      // 顕在化しないためガードの効果を検出できない。
      const el = createEl({ url: "/a" });
      document.body.appendChild(el);
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

    it("_doConnect: loading-changed リスナから同期 connect()（別url＋即open）を呼んでも esB の状態を巻き戻さない", () => {
      // _setLoading(true) の同期 dispatch を起点とする再入。外側 _doConnect が後続の
      // _setReadyState(esA.readyState=CONNECTING) を出すと、再入が確立させた esB(OPEN)
      // の状態を CONNECTING へ巻き戻してしまう。所有権ガードでこれを防ぐ。
      // 再入内で esB を即 open させ esA(CONNECTING) と readyState を差異化することで、
      // ガードを外すと巻き戻りが顕在化＝テストが失敗する構成にしている。
      const el = createEl({ url: "/a", manual: "" });
      document.body.appendChild(el);

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

    it("_doConnect: error(detail=null) リスナから同期 connect()（別url＋即open）を呼んでも状態を巻き戻さない", () => {
      // 恒久エラー(CLOSED)後の再 connect では _doConnect 内の _setError(null) が
      // wcs-sse:error(detail=null) を dispatch する（README 記載のプロパティ変更通知）。
      // その同期 dispatch を起点とする再入で、外側 _doConnect 後続の
      // _setReadyState(es.readyState) が再入接続の状態を巻き戻さないこと（line 208 の
      // 所有権ガード）を検証する。再入接続を即 open し、外側の再 connect 接続(CONNECTING)
      // と readyState を差異化することで、ガードを外すと巻き戻りが顕在化する。
      const el = createEl({ url: "/feed", manual: "" });
      document.body.appendChild(el);
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

    it("_doConnect: loading-changed 再入で再入側が同期 error を立てると外側の _setError(null) が誤クリアしない（line 206 ガード固有）", () => {
      // line 206 ガード（_setLoading(true) 直後）の固有効果を分離検出する。
      // _setLoading(true) の dispatch で別 url へ再入接続し、再入側 esB が *生成直後に
      // 同期で error を立てて* el.error を非 null 確定させる。外側 _doConnect に制御が
      // 戻ったとき、206 ガードが無ければ後続の _setError(null)(207行) が esB の error を
      // 誤クリアして巻き戻す。206 ガードが有ればその前に return するため error が保持される。
      // ※後段 208 ガードでは捕捉が _setError(null) の *後* になり誤クリアを防げないため、
      //   この経路は 206 ガード固有（208 単独では救えない）。
      const el = createEl({ url: "/a", manual: "" });
      document.body.appendChild(el);

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
