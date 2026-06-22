import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { Debounce } from "../src/components/Debounce";

beforeAll(() => {
  if (!customElements.get("wcs-debounce")) {
    customElements.define("wcs-debounce", Debounce);
  }
});

function create(attrs: Record<string, string> = {}): Debounce {
  const el = document.createElement("wcs-debounce") as Debounce;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("<wcs-debounce> 属性アクセサ", () => {
  it("wait は既定 250、数値属性をパース、不正値はフォールバック", () => {
    expect(create().wait).toBe(250);
    expect(create({ wait: "100" }).wait).toBe(100);
    expect(create({ wait: "0" }).wait).toBe(0);
    expect(create({ wait: "100px" }).wait).toBe(250);
    expect(create({ wait: "-5" }).wait).toBe(250);
    expect(create({ wait: "   " }).wait).toBe(250);
  });

  it("wait セッターは属性へ反映する", () => {
    const el = create();
    el.wait = 300;
    expect(el.getAttribute("wait")).toBe("300");
    expect(el.wait).toBe(300);
  });

  it("leading は属性の有無、セッターで反映", () => {
    expect(create().leading).toBe(false);
    expect(create({ leading: "" }).leading).toBe(true);
    const el = create();
    el.leading = true;
    expect(el.hasAttribute("leading")).toBe(true);
    el.leading = false;
    expect(el.hasAttribute("leading")).toBe(false);
  });

  it("trailing は既定 true、no-trailing で false、セッターで反映", () => {
    expect(create().trailing).toBe(true);
    expect(create({ "no-trailing": "" }).trailing).toBe(false);
    const el = create();
    el.trailing = false;
    expect(el.hasAttribute("no-trailing")).toBe(true);
    el.trailing = true;
    expect(el.hasAttribute("no-trailing")).toBe(false);
  });

  it("maxWait は既定 undefined、数値属性をパース、不正値はフォールバック", () => {
    expect(create().maxWait).toBeUndefined();
    expect(create({ "max-wait": "500" }).maxWait).toBe(500);
    expect(create({ "max-wait": "bad" }).maxWait).toBeUndefined();
    const el = create();
    el.maxWait = 400;
    expect(el.getAttribute("max-wait")).toBe("400");
  });
});

describe("<wcs-debounce> 振る舞い", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("source 書き込みを wait でデバウンスし value に反映する", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    el.source = "a";
    el.source = "b";
    expect(el.source).toBe("b");
    vi.advanceTimersByTime(100);

    expect(settled).toEqual(["b"]);
    expect(el.value).toBe("b");
    el.remove();
  });

  it("trigger コマンドはパルスを coalesce して fired を発火する", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const fired: any[][] = [];
    el.addEventListener("wcs-debounce:fired", (e) => fired.push((e as CustomEvent).detail.args));

    el.trigger(1);
    el.trigger(2);
    vi.advanceTimersByTime(100);

    expect(fired).toEqual([[2]]);
    expect(el.fired).toEqual([2]);
    el.remove();
  });

  it("fired / pending getter は Core に委譲する", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    el.source = "a";
    expect(el.pending).toBe(true);
    vi.advanceTimersByTime(100);
    expect(el.pending).toBe(false);
    el.remove();
  });

  it("cancel は保留中の発火を捨てる", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    el.source = "a";
    el.cancel();
    vi.advanceTimersByTime(100);
    expect(settled).toEqual([]);
    el.remove();
  });

  it("flush は即発火する", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    el.source = "a";
    el.flush();
    expect(settled).toEqual(["a"]);
    el.remove();
  });

  it("leading 属性で先頭即発火になる", () => {
    const el = create({ wait: "100", leading: "" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));

    el.source = "a";
    expect(settled).toEqual(["a"]);
    el.remove();
  });

  it("connectedCallback で display:none、disconnectedCallback で保留がクリアされる", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    expect(el.style.display).toBe("none");

    const settled: any[] = [];
    el.addEventListener("wcs-debounce:settled", (e) => settled.push((e as CustomEvent).detail.value));
    el.source = "a";
    el.remove(); // disconnectedCallback → dispose
    vi.advanceTimersByTime(100);
    expect(settled).toEqual([]);
  });

  it("SSR: connectedCallbackPromise が解決し hasConnectedCallbackPromise=true", async () => {
    vi.useRealTimers(); // Promise の解決を await するため実タイマーに戻す
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    expect((el.constructor as typeof Debounce).hasConnectedCallbackPromise).toBe(true);
    el.remove();
  });
});
