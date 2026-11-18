/**
 * townArchive.test.ts — 継ぎ目アプリ town-archive（docs/seam-apps.ja.md）で見つかった不具合の修正:
 * <wcs-infinite-scroll> が読み込まない 3 つの場合と、<wcs-fetch> の fetch(url, init)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Fetch } from "../src/components/Fetch";
import { InfiniteScroll } from "../src/components/InfiniteScroll";
import { registerComponents } from "../src/registerComponents";

registerComponents();

function response(body: unknown, status = 200): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The animation frames asked for and not run yet (requestAnimationFrame is stubbed: a test runs them itself). */
let frameQueue: FrameRequestCallback[] = [];
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) {
    const due = frameQueue;
    frameQueue = [];
    for (const cb of due) cb(0);
    await flush();
  }
};

describe("InfiniteScroll: 番兵が画面に残る・url が後から届く（town-archive）", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let observers: MockIntersectionObserver[];
  /** 応答待ちの要求（resolve で応答を返す）。 */
  let pending: { url: string; resolve: (r: Response) => void }[];

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number>;
    observedElement: Element | null = null;
    observe = vi.fn((element: Element) => { this.observedElement = element; });
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

    constructor(private readonly callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
      // ブラウザと同じく、単位の無い長さは受け付けない（0 も）
      if (!/^\s*-?\d*\.?\d+(px|%)(\s+-?\d*\.?\d+(px|%)){0,3}\s*$/.test(options.rootMargin ?? "0px")) {
        throw new SyntaxError("rootMargin must be specified in pixels or percent.");
      }
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? "0px";
      const threshold = options.threshold ?? 0;
      this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
      observers.push(this);
    }

    report(isIntersecting: boolean): void {
      this.callback([{ isIntersecting, target: this.observedElement } as IntersectionObserverEntry], this);
    }
  }

  beforeEach(() => {
    observers = [];
    pending = [];
    frameQueue = [];
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frameQueue.push(cb));
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: any, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        pending.push({ url: String(input), resolve });
        // 中断されたら、ブラウザの fetch と同じく AbortError で終わる
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  /** <wcs-fetch manual id="pf"> と、その後ろの番兵。top は番兵の位置（行が増えると動く）。 */
  function mount(url: string | null, attrs: Record<string, string> = {}) {
    const fetchEl = document.createElement("wcs-fetch") as Fetch;
    fetchEl.id = "pf";
    fetchEl.setAttribute("manual", "");
    if (url !== null) fetchEl.setAttribute("url", url);
    document.body.appendChild(fetchEl);
    const sentinel = document.createElement("wcs-infinite-scroll") as InfiniteScroll;
    sentinel.setAttribute("target", "pf");
    for (const [k, v] of Object.entries(attrs)) sentinel.setAttribute(k, v);
    const place = { top: 100 };
    sentinel.getBoundingClientRect = () => ({ top: place.top }) as DOMRect;
    document.body.appendChild(sentinel);
    return { fetchEl, sentinel, place };
  }
  const urls = () => fetchSpy.mock.calls.map((c) => String(c[0]));
  /**
   * いちばん古い応答待ちの要求に応答を返し、ページが落ち着くまで待つ。react はページの反応（行を足す・url を進める）:
   * state と同じく、応答のイベントの直後のマイクロタスクで動く。
   */
  async function answer(body: unknown = { ok: true }, status = 200, react: () => void = () => {}) {
    document.addEventListener("wcs-fetch:response", () => queueMicrotask(react), { once: true });
    pending.shift()!.resolve(response(body, status));
    await flush();
    await flush();
    await frames(4);
  }

  it("番兵が先に報告し、url が後から書かれる: 警告せずに待ち、書かれたら 1 回読み込む", async () => {
    const { fetchEl } = mount(null);
    observers[0].report(true);
    await flush();
    expect(urls()).toEqual([]);
    expect(warn).not.toHaveBeenCalled(); // [wcs/command-not-ready] を出さない
    fetchEl.url = "/api/items?offset=0";
    await flush();
    expect(urls()).toEqual(["/api/items?offset=0"]);
    await answer();
    expect(urls()).toHaveLength(1);
  });

  it("ページが番兵を押し出さない（行が増えて url が進む）: 応答の後に続きを読み込む。番兵が外へ出たら読み込まない", async () => {
    const { fetchEl, place } = mount("/api/items?offset=0");
    observers[0].report(true);
    expect(urls()).toEqual(["/api/items?offset=0"]);
    // 背の高い窓: 行が増えても番兵は画面の中
    await answer({}, 200, () => { place.top += 400; fetchEl.url = "/api/items?offset=60"; });
    expect(urls()).toEqual(["/api/items?offset=0", "/api/items?offset=60"]);
    // 次のページは番兵を押し出す
    await answer({}, 200, () => { place.top += 2400; fetchEl.url = "/api/items?offset=120"; observers[0].report(false); });
    expect(urls()).toHaveLength(2);
  });

  // 利用者がスクロールしている間は、番兵が外へ出たという報告が 1 フレーム遅れて届く（Chromium・Firefox）:
  // 要求が終わって待つフレームの後でも、報告はまだブラウザの中にある（docs/seam-apps.ja.md、town-archive の取り込み）。
  const undelivered = (isIntersecting: boolean) =>
    observers[0].takeRecords.mockReturnValueOnce([{ isIntersecting } as IntersectionObserverEntry]);

  it("番兵が外へ出た報告がまだ届いていない（利用者がスクロール中）: 届いていない報告を取り込んでから見るので、続きを読み込まない", async () => {
    const { fetchEl, place } = mount("/api/items?offset=0");
    observers[0].report(true);
    // ページは番兵を押し出したが、その報告は届いていない
    undelivered(false);
    await answer({}, 200, () => { place.top += 2400; fetchEl.url = "/api/items?offset=60"; });
    expect(urls()).toEqual(["/api/items?offset=0"]);
    // 利用者がそこまでスクロールすれば読み込む
    observers[0].report(true);
    expect(urls()).toEqual(["/api/items?offset=0", "/api/items?offset=60"]);
  });

  it("届いていない報告が「画面に入った」なら、番兵が画面に入ったのと同じ: 失敗した url ももう一度取りに行く", async () => {
    mount("/api/items?offset=120");
    observers[0].report(true);
    observers[0].report(false); // 読み込み中に利用者が離れた
    undelivered(true); // 戻ってきた報告は、まだ届いていない
    await answer({ error: "x" }, 500);
    expect(urls()).toEqual(["/api/items?offset=120", "/api/items?offset=120"]);
  });

  it("静止中に url が変わった後の見直しでも、届いていない報告を取り込む: 番兵が外へ出ていれば読み込まない", async () => {
    const { fetchEl } = mount("/api/items?f=a");
    observers[0].report(true);
    await answer(); // 0 件の結果: 番兵は動かない
    fetchEl.url = "/api/items?f=b";
    await flush();
    undelivered(false);
    await frames(4);
    expect(urls()).toEqual(["/api/items?f=a"]);
  });

  it("要求が終わって待つ間に disabled になる: 監視が無いので報告は取り込まず、読み込まない", async () => {
    const { fetchEl, sentinel, place } = mount("/api/items?offset=0");
    observers[0].report(true);
    document.addEventListener("wcs-fetch:response", () => queueMicrotask(() => { place.top += 400; fetchEl.url = "/api/items?offset=60"; }), { once: true });
    pending.shift()!.resolve(response({}));
    await flush();
    await flush();
    sentinel.setAttribute("disabled", "");
    await frames(4);
    expect(urls()).toEqual(["/api/items?offset=0"]);
    expect(observers[0].takeRecords).not.toHaveBeenCalled();
  });

  it("応答が行を増やさなければ、url が進んでも読み込まない（終わりを見ないページが回り続けない）", async () => {
    const { fetchEl } = mount("/api/items?offset=120");
    observers[0].report(true);
    await answer([], 200, () => { fetchEl.url = "/api/items?offset=180"; });
    await frames(4);
    expect(urls()).toEqual(["/api/items?offset=120"]);
    // 利用者が番兵を出入りさせれば、今の url を読み込む
    observers[0].report(false);
    observers[0].report(true);
    expect(urls()).toEqual(["/api/items?offset=120", "/api/items?offset=180"]);
  });

  it("失敗した要求は繰り返さない: エラーの表示で番兵が動いても同じ url は出さず、番兵が出入りすれば出す", async () => {
    const { place } = mount("/api/items?offset=120");
    observers[0].report(true);
    await answer({ error: "x" }, 500, () => { place.top += 40; });
    expect(urls()).toEqual(["/api/items?offset=120"]);
    observers[0].report(false);
    observers[0].report(true);
    expect(urls()).toEqual(["/api/items?offset=120", "/api/items?offset=120"]);
  });

  it("読み込み中に url が変わる（絞り込み）: 終わったら、行が増えていなくても新しい url を読み込む", async () => {
    const { fetchEl } = mount("/api/items?f=&offset=60");
    observers[0].report(true);
    fetchEl.url = "/api/items?f=abc&offset=0";
    await flush();
    expect(urls()).toHaveLength(1); // 読み込み中は出さない
    await answer();
    expect(urls()).toEqual(["/api/items?f=&offset=60", "/api/items?f=abc&offset=0"]);
  });

  it("ページが要求を中断して url を書き換える（絞り込み）: 応答が無かった要求の後は、行が増えていなくても新しい url を読み込む", async () => {
    const { fetchEl } = mount("/api/items?f=a&offset=0");
    observers[0].report(true);
    expect(urls()).toEqual(["/api/items?f=a&offset=0"]);
    // 空の一覧のまま: 中断し、同じ更新で url が変わる（中断で loading は false になっている）
    fetchEl.abort();
    queueMicrotask(() => { fetchEl.url = "/api/items?f=b&offset=0"; });
    await flush();
    await frames(4);
    expect(urls()).toEqual(["/api/items?f=a&offset=0", "/api/items?f=b&offset=0"]);
    // 中断しただけで url が同じなら、出し直さない
    fetchEl.abort();
    await flush();
    await frames(4);
    expect(urls()).toHaveLength(2);
  });

  it("静止中に url が変わる: 番兵が画面にあれば 2 フレーム後に読み込み、画面の外なら読み込まない", async () => {
    const { fetchEl } = mount("/api/items?f=a");
    observers[0].report(true);
    await answer(); // 0 件の結果: 番兵は動かない
    fetchEl.url = "/api/items?f=b";
    await flush();
    await frames(1);
    expect(urls()).toHaveLength(1);
    await frames(1);
    expect(urls()).toEqual(["/api/items?f=a", "/api/items?f=b"]);
    await answer();
    // 画面の外
    observers[0].report(false);
    fetchEl.url = "/api/items?f=c";
    await frames(4);
    expect(urls()).toHaveLength(2);
    // 2 フレーム待つ間に外へ出た場合も読み込まない
    observers[0].report(true); // 出入りで f=c を読み込む
    await answer();
    fetchEl.url = "/api/items?f=d";
    await flush();
    observers[0].report(false);
    await frames(4);
    expect(urls()).toEqual(["/api/items?f=a", "/api/items?f=b", "/api/items?f=c"]);
  });

  it("ページ自身が始めた要求（trigger）の後も同じ: 行が増えて url が進めば続きを読み込み、落ち着く前に次の要求が始まれば前の判定はしない", async () => {
    const { fetchEl, place } = mount("/api/items?offset=0");
    observers[0].report(true);
    await answer({}, 200, () => { observers[0].report(false); });
    // ページの「もう一度」: 番兵は画面の中に戻っている
    observers[0].report(true); // （url は同じでも、出入りなら出す）
    await answer({}, 200, () => { place.top += 300; fetchEl.url = "/api/items?offset=60"; });
    expect(urls()).toEqual(["/api/items?offset=0", "/api/items?offset=0", "/api/items?offset=60"]);
    // 応答の直後にページが自分で次を始める: 前の応答の判定は捨てる
    await answer({}, 200, () => { place.top += 300; fetchEl.url = "/api/items?offset=120"; fetchEl.trigger = true; });
    expect(urls()).toEqual(["/api/items?offset=0", "/api/items?offset=0", "/api/items?offset=60", "/api/items?offset=120"]);
  });

  it("once: 1 回読み込んだら、行が増えて url が進んでも読み込まない", async () => {
    const { fetchEl, place } = mount("/api/items?offset=0", { once: "" });
    observers[0].report(true);
    await answer({}, 200, () => { place.top += 300; fetchEl.url = "/api/items?offset=60"; });
    expect(urls()).toEqual(["/api/items?offset=0"]);
  });

  it("切断したら url を追わない。target が無くなったら追うのをやめて警告する", async () => {
    const { fetchEl, sentinel } = mount(null);
    observers[0].report(true);
    sentinel.remove();
    fetchEl.url = "/api/items?offset=0";
    await frames(3);
    expect(urls()).toEqual([]);
    fetchEl.remove();

    const second = mount("/api/items?offset=0");
    observers.at(-1)!.report(true);
    await answer();
    second.fetchEl.id = "gone";
    observers.at(-1)!.report(false);
    observers.at(-1)!.report(true);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining('[wcs/infinite-scroll-target] <wcs-infinite-scroll target="pf">')]);
    second.fetchEl.url = "/api/items?offset=60";
    await frames(3);
    expect(urls()).toEqual(["/api/items?offset=0"]);
  });

  it("disabled にすると番兵は画面の外の扱いになり、url が変わっても読み込まない", async () => {
    const { fetchEl, sentinel } = mount("/api/items?offset=0");
    observers[0].report(true);
    await answer();
    sentinel.disabled = true;
    fetchEl.url = "/api/items?offset=60";
    await frames(4);
    expect(urls()).toEqual(["/api/items?offset=0"]);
  });

  it("root は id でもセレクタでも受ける。スクロールする要素なら黙り、root 付きの番兵の位置は root のスクロール量から測る", async () => {
    const box = document.createElement("div");
    box.className = "list-box";
    box.style.overflowY = "auto";
    document.body.appendChild(box);
    const { fetchEl, place } = mount("/api/items?offset=0", { root: ".list-box" });
    expect(observers.at(-1)!.root).toBe(box);
    expect(warn).not.toHaveBeenCalled();
    observers.at(-1)!.report(true);
    // 行は増えていないが、root をスクロールした分だけ番兵は上へ動いて見える: 位置は同じと数える
    await answer({}, 200, () => { box.scrollTop = 50; place.top -= 50; fetchEl.url = "/api/items?offset=60"; });
    expect(urls()).toEqual(["/api/items?offset=0"]);
  });

  it("root が見つからなければ値ごとに 1 回警告して viewport。スクロールしない要素（overflow: visible）にも 1 回警告する", () => {
    const main = document.createElement("main");
    main.style.overflowX = "visible";
    main.style.overflowY = "visible";
    document.body.appendChild(main);
    const { sentinel } = mount("/api/items", { root: "nope" });
    expect(observers.at(-1)!.root).toBeNull();
    sentinel.setAttribute("threshold", "0.5"); // 張り直しても同じ値では言い直さない
    sentinel.setAttribute("root", "[[["); // セレクタとしても読めない
    sentinel.setAttribute("root", "main");
    sentinel.setAttribute("threshold", "0.6");
    expect(observers.at(-1)!.root).toBe(main);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      '[@wcstack/fetch] [wcs/infinite-scroll-root] <wcs-infinite-scroll root="nope">: no element has that id, and none matches it as a selector, so the viewport is the scroll root.',
      '[@wcstack/fetch] [wcs/infinite-scroll-root] <wcs-infinite-scroll root="[[[">: no element has that id, and none matches it as a selector, so the viewport is the scroll root.',
      '[@wcstack/fetch] [wcs/infinite-scroll-root] <wcs-infinite-scroll root="main"> is <main>, which does not scroll (overflow: visible): everything inside it counts as on screen, so page after page is loaded. Name the element that scrolls, or leave root out for the viewport.',
    ]);
  });

  it("単位の無い root-margin: 例外を外へ出さず、値ごとに 1 回警告して何も監視しない。直せば監視する", () => {
    const { sentinel } = mount("/api/items", { "root-margin": "200" });
    expect(observers).toHaveLength(0);
    sentinel.setAttribute("threshold", "0.5");
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      '[@wcstack/fetch] [wcs/root-margin-unit] <wcs-infinite-scroll root-margin="200"> is not a margin the browser takes (rootMargin must be specified in pixels or percent.): write each length with px or %, as "240px 0px". Nothing is observed, so no page is loaded.',
    ]);
    sentinel.setAttribute("root-margin", "200px 0px");
    expect(observers).toHaveLength(1);
    expect(observers[0].rootMargin).toBe("200px 0px");
  });

  it("threshold は 0..1 に収めて渡す（範囲の外はブラウザが例外にする）", () => {
    mount("/api/items", { threshold: "2" });
    expect(observers.at(-1)!.thresholds).toEqual([1]);
    mount("/api/items", { threshold: "-1" });
    expect(observers.at(-1)!.thresholds).toEqual([0]);
  });
});

describe("Fetch: fetch(url, init) — コマンドトークンが運ぶ url（town-archive）", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(response({ ok: true })));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
  });

  function mount(html: string): Fetch {
    document.body.innerHTML = html;
    return document.querySelector("wcs-fetch") as Fetch;
  }
  const lastInit = () => fetchSpy.mock.calls.at(-1)![1] as RequestInit;
  const header = (name: string) => new Headers(lastInit().headers).get(name);

  it("url を渡すとその url を取りに行く。要素の url 属性は変わらない（url の無い要素でも動く）", async () => {
    const el = mount(`<wcs-fetch manual></wcs-fetch>`);
    const value = await el.fetch("/api/users");
    expect(fetchSpy).toHaveBeenCalledWith("/api/users", expect.any(Object));
    expect(value).toEqual({ ok: true });
    expect(el.getAttribute("url")).toBeNull();
    const other = mount(`<wcs-fetch manual url="/api/own"></wcs-fetch>`);
    await other.fetch("/api/given");
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe("/api/given");
    expect(other.url).toBe("/api/own");
  });

  it("init の method・headers・body はその要求だけに効き、要素の body は次の要求まで残る", async () => {
    const el = mount(`<wcs-fetch manual url="/api/own" method="PUT"><wcs-fetch-header name="X-A" value="element"></wcs-fetch-header><wcs-fetch-header name="X-B" value="kept"></wcs-fetch-header></wcs-fetch>`);
    el.body = { own: true };
    await el.fetch("/api/given", { method: "post", headers: { "X-A": "command" }, body: { given: 1 } });
    expect(lastInit().method).toBe("POST");
    expect(header("X-A")).toBe("command");
    expect(header("X-B")).toBe("kept");
    expect(lastInit().body).toBe(JSON.stringify({ given: 1 }));
    // 要素自身の要求: method・ヘッダは要素のもの、body は残っていたもの
    await el.fetch();
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe("/api/own");
    expect(lastInit().method).toBe("PUT");
    expect(header("X-A")).toBe("element");
    expect(lastInit().body).toBe(JSON.stringify({ own: true }));
  });

  it("init がオブジェクトでない・headers がオブジェクトでない・method が空なら、要素のものを使う", async () => {
    const el = mount(`<wcs-fetch manual method="DELETE"></wcs-fetch>`);
    await el.fetch("/api/a", null);
    expect(lastInit().method).toBe("DELETE");
    await el.fetch("/api/b", "POST");
    expect(lastInit().method).toBe("DELETE");
    await el.fetch("/api/c", { method: "", headers: "X-A: 1" });
    expect(lastInit().method).toBe("DELETE");
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe("/api/c");
  });

  it("文字列でない第 1 引数（on…: $command.x が先頭に渡すイベント）と空文字は無視し、init も無視する（警告しない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = mount(`<wcs-fetch manual url="/api/own"></wcs-fetch>`);
    await el.fetch(new Event("click"), { method: "POST" });
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe("/api/own");
    expect(lastInit().method).toBe("GET");
    await el.fetch("", { method: "POST" });
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe("/api/own");
    expect(lastInit().method).toBe("GET");
    await el.fetch(null, { method: "POST" });
    await el.fetch(undefined, { method: "POST" });
    expect(lastInit().method).toBe("GET");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("URL オブジェクトは url として受け取る（String(url)）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = mount(`<wcs-fetch manual url="/api/own"></wcs-fetch>`);
    await el.fetch(new URL("http://localhost/api/from-url?page=2"), { method: "post" });
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe("http://localhost/api/from-url?page=2");
    expect(lastInit().method).toBe("POST");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("渡した url は自動 fetch の同値ガードに記録される: 同じ更新で後から同じ url が属性に届いても取り直さない", async () => {
    const el = mount(`<wcs-fetch></wcs-fetch>`);
    await el.connectedCallbackPromise;
    await el.fetch("/api/page?offset=60");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    el.url = "/api/page?offset=60"; // コマンドの後に束縛が書く
    await flush();
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    el.url = "/api/page?offset=120";
    await flush();
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("Fetch: url の位置に url でない値（wcs/fetch-url-argument、lending-desk）", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(response({ ok: true })));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    fetchSpy.mockRestore();
    warn.mockRestore();
  });

  function mount(html: string): Fetch {
    document.body.innerHTML = html;
    return document.querySelector("wcs-fetch") as Fetch;
  }
  const messages = () => warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes("[wcs/fetch-url-argument]"));

  it("数（行の id）を渡すと、何を渡したかと fetch() が受け取るものを警告し、要素の url を取りに行く（init も無視）", async () => {
    const el = mount(`<wcs-fetch manual url="/api/own"></wcs-fetch>`);
    await el.fetch(5, { method: "DELETE" });
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toBe("/api/own");
    expect((fetchSpy.mock.calls.at(-1)![1] as RequestInit).method).toBe("GET");
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain("[@wcstack/fetch] [wcs/fetch-url-argument] fetch() was given 5 (a number) in the url's place");
    expect(messages()[0]).toContain("which takes a url (a string or a URL)");
    expect(messages()[0]).toContain("fetched its own url instead.");
    expect(warn.mock.calls[0][1]).toBe(el);
  });

  it("要素に url が無ければ、何も取りに行かなかったことも言う", async () => {
    const el = mount(`<wcs-fetch manual></wcs-fetch>`);
    await el.fetch(5);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(messages()[0]).toContain("fetched its own url instead — it has none, so nothing.");
  });

  it("要素ごと・種類ごとに 1 回: 同じ種類はもう言わず、別の種類は言う。別の要素は自分の 1 回を持つ", async () => {
    const el = mount(`<wcs-fetch manual url="/api/own"></wcs-fetch><wcs-fetch manual url="/api/other"></wcs-fetch>`);
    const other = document.querySelectorAll("wcs-fetch")[1] as Fetch;
    await el.fetch(1);
    await el.fetch(2);
    expect(messages()).toHaveLength(1);
    await el.fetch({ id: 1 });
    await el.fetch({ id: 2 });
    expect(messages()).toHaveLength(2);
    await other.fetch(3);
    expect(messages()).toHaveLength(3);
  });

  it("値の種類ごとの言い方: 真偽値・bigint・オブジェクト・Map・配列・関数・シンボル", async () => {
    const el = mount(`<wcs-fetch manual url="/api/own"></wcs-fetch>`);
    await el.fetch(true);
    await el.fetch(10n);
    await el.fetch({ id: 1 });
    expect(messages()).toHaveLength(3);
    const el2 = mount(`<wcs-fetch manual url="/api/own"></wcs-fetch>`);
    await el2.fetch(new Map());
    await el2.fetch([1, 2]);
    await el2.fetch(() => "/api/x");
    await el2.fetch(Symbol("x"));
    const all = messages();
    expect(all[0]).toContain("fetch() was given true (a boolean)");
    expect(all[1]).toContain("fetch() was given 10 (a bigint)");
    expect(all[2]).toContain("fetch() was given an object");
    expect(all[3]).toContain("fetch() was given a Map object");
    expect(all[4]).toContain("fetch() was given an array");
    expect(all[5]).toContain("fetch() was given a function");
    expect(all[6]).toContain("fetch() was given a symbol");
    expect(fetchSpy).toHaveBeenCalledTimes(7);
    for (const call of fetchSpy.mock.calls) expect(String(call[0])).toBe("/api/own");
  });
});
