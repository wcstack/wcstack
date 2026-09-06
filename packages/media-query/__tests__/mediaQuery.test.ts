import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bootstrapMediaQuery } from "../src/bootstrapMediaQuery";
import { setConfig } from "../src/config";
import { WcsMediaQuery } from "../src/components/MediaQuery";
import { installMatchMedia, removeMatchMedia, restoreMatchMedia } from "./mocks";

const DARK = "(prefers-color-scheme: dark)";
const REDUCE = "(prefers-reduced-motion: reduce)";

function createMediaQuery(query?: string): WcsMediaQuery {
  const el = document.createElement("wcs-media-query") as WcsMediaQuery;
  if (query !== undefined) el.setAttribute("query", query);
  return el;
}

describe("MediaQuery (Shell)", () => {
  beforeEach(() => {
    setConfig({ tagNames: { mediaQuery: "wcs-media-query" } });
    bootstrapMediaQuery();
    removeMatchMedia();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    restoreMatchMedia();
  });

  it("接続時に display:none になり、query 属性のリストの値を反映する", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery(DARK);
    document.body.appendChild(el);

    expect(el.style.display).toBe("none");
    expect(mm.queries).toEqual([DARK]);
    expect(el.query).toBe(DARK);
    expect(el.matched).toBe(true);
    expect(el.media).toBe(DARK);
    expect(el.supported).toBe(true);
  });

  it("接続前の getter は既定値を返す", () => {
    const el = createMediaQuery();
    expect(el.query).toBe("");
    expect(el.matched).toBe(false);
    expect(el.media).toBe("");
    expect(el.supported).toBe(false);
  });

  it("query プロパティは属性へ反映する（setter → attribute）", () => {
    const el = createMediaQuery();
    el.query = REDUCE;
    expect(el.getAttribute("query")).toBe(REDUCE);
    expect(el.query).toBe(REDUCE);
  });

  it("hasConnectedCallbackPromise が true で connectedCallbackPromise が即 settle する（SSR）", async () => {
    installMatchMedia({ matches: true });
    expect(WcsMediaQuery.hasConnectedCallbackPromise).toBe(true);
    const el = createMediaQuery(DARK);
    document.body.appendChild(el);

    await el.connectedCallbackPromise;
    expect(el.matched).toBe(true);
  });

  it("非対応環境（matchMedia 不在 = SSR）では supported=false / matched=false のまま", async () => {
    removeMatchMedia();
    const el = createMediaQuery(DARK);
    document.body.appendChild(el);
    await el.connectedCallbackPromise;
    expect(el.supported).toBe(false);
    expect(el.matched).toBe(false);
  });

  it("query 属性なしで接続すると supported=true だが matched=false（何も監視しない）", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery();
    document.body.appendChild(el);
    expect(mm.queries).toEqual([]);
    expect(el.supported).toBe(true);
    expect(el.matched).toBe(false);
  });

  it("live change が要素の値に伝わる", () => {
    const mm = installMatchMedia({ matches: false });
    const el = createMediaQuery(DARK);
    const seen: any[] = [];
    el.addEventListener("wcs-media-query:change", (e) => seen.push((e as CustomEvent).detail));
    document.body.appendChild(el); // 接続時に初回 snapshot（supported: false→true）が1回 dispatch される

    expect(seen).toHaveLength(1);
    mm.last.setMatches(true);
    expect(el.matched).toBe(true);
    expect(seen).toHaveLength(2);
  });

  it("wcs-media-query:change は bubbles:true で祖先要素へ伝播する（guidelines §3.3 MUST）", () => {
    installMatchMedia({ matches: true });
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const seen: any[] = [];
    wrapper.addEventListener("wcs-media-query:change", (e) => seen.push((e as CustomEvent).detail));

    wrapper.appendChild(createMediaQuery(DARK));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ matched: true, media: DARK, supported: true });
  });

  it("接続中の query 属性変更で旧リストを解除し新リストを購読する", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery(DARK);
    document.body.appendChild(el);
    const first = mm.last;

    mm.next({ matches: false });
    el.setAttribute("query", REDUCE);

    expect(mm.queries).toEqual([DARK, REDUCE]);
    expect(first.listeners.size).toBe(0);
    expect(el.media).toBe(REDUCE);
    expect(el.matched).toBe(false);

    first.setMatches(false); // 旧リストの change は無視される
    mm.last.setMatches(true);
    expect(el.matched).toBe(true);
  });

  it("接続中の query 属性除去で監視を止め matched が false に落ちる", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery(DARK);
    document.body.appendChild(el);
    expect(el.matched).toBe(true);

    el.removeAttribute("query");

    expect(mm.last.listeners.size).toBe(0);
    expect(el.matched).toBe(false);
    expect(el.media).toBe("");
    expect(el.supported).toBe(true);
  });

  it("接続前の query 属性変更は購読を起こさない（connectedCallback で読む）", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery();
    el.setAttribute("query", DARK);
    expect(mm.queries).toEqual([]);

    document.body.appendChild(el);
    expect(mm.queries).toEqual([DARK]);
  });

  it("query 以外の属性変更は何もしない", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery(DARK);
    document.body.appendChild(el);

    el.attributeChangedCallback("other", null, "x");

    expect(mm.queries).toEqual([DARK]);
  });

  it("切断で change 購読を解除し、再接続で同じ query を再購読する", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery(DARK);
    document.body.appendChild(el);
    const first = mm.last;

    el.remove();
    expect(first.listeners.size).toBe(0);
    first.setMatches(false);
    expect(el.matched).toBe(true); // 切断後は追従しない

    mm.next({ matches: false });
    document.body.appendChild(el); // reconnect
    expect(mm.queries).toEqual([DARK, DARK]);
    expect(el.matched).toBe(false);

    mm.last.setMatches(true);
    expect(el.matched).toBe(true);
  });

  it("upgrade 前に代入された query プロパティは接続時に setter を通る（property upgrade）", () => {
    const mm = installMatchMedia({ matches: true });
    const el = createMediaQuery();
    // upgrade 前の framework 代入を再現（accessor を own データプロパティが隠している状態）
    Object.defineProperty(el, "query", { value: DARK, writable: true, configurable: true, enumerable: true });
    document.body.appendChild(el);

    expect(Object.prototype.hasOwnProperty.call(el, "query")).toBe(false);
    expect(el.getAttribute("query")).toBe(DARK);
    expect(mm.queries).toEqual([DARK]);
    expect(el.matched).toBe(true);
  });

  it("inputs は query のみ、commands は空", () => {
    expect(WcsMediaQuery.wcBindable.inputs).toEqual([{ name: "query", attribute: "query" }]);
    expect(WcsMediaQuery.wcBindable.commands).toEqual([]);
    expect(WcsMediaQuery.observedAttributes).toEqual(["query"]);
  });

  it("wcBindable: Shell は Core の 3 プロパティをそのまま継承する", () => {
    const props = WcsMediaQuery.wcBindable.properties.map((p) => p.name);
    expect(props).toEqual(["matched", "media", "supported"]);
  });
});
