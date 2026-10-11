import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { Throttle } from "../src/components/Throttle";

beforeAll(() => {
  if (!customElements.get("wcs-throttle")) {
    customElements.define("wcs-throttle", Throttle);
  }
});

function create(attrs: Record<string, string> = {}): Throttle {
  const el = document.createElement("wcs-throttle") as Throttle;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("<wcs-throttle>", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("wcs-throttle:* の名前空間で dispatch する", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-throttle:settled", (e) => settled.push((e as CustomEvent).detail.value));

    el.source = "a";          // leading 既定 true → 即発火
    expect(settled).toEqual(["a"]);
    el.remove();
  });

  it("leading が既定で有効 (no-leading で無効化)", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-throttle:settled", (e) => settled.push((e as CustomEvent).detail.value));

    el.source = "a";
    expect(settled).toEqual(["a"]); // leading 即発火

    const el2 = create({ wait: "100", "no-leading": "" });
    document.body.appendChild(el2);
    const settled2: any[] = [];
    el2.addEventListener("wcs-throttle:settled", (e) => settled2.push((e as CustomEvent).detail.value));
    el2.source = "b";
    expect(settled2).toEqual([]); // no-leading なので先頭発火しない
    vi.advanceTimersByTime(100);
    expect(settled2).toEqual(["b"]);
    el.remove();
    el2.remove();
  });

  it("leading プロパティは no-leading 属性を読み書きする（binder の書き込みが効く）", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-throttle:settled", (e) => settled.push((e as CustomEvent).detail.value));
    expect(el.leading).toBe(true);

    el.leading = false;
    expect(el.hasAttribute("no-leading")).toBe(true);
    expect(el.hasAttribute("leading")).toBe(false);
    expect(el.leading).toBe(false);
    el.source = "a";
    expect(settled).toEqual([]); // 先頭発火しない
    vi.advanceTimersByTime(100);
    expect(settled).toEqual(["a"]);

    el.leading = true;
    expect(el.hasAttribute("no-leading")).toBe(false);
    expect(el.leading).toBe(true);
    el.remove();
  });

  it("leading の undefined はマークアップの状態へ戻し、null は既定（on）に戻す", () => {
    const host = document.createElement("div");
    host.innerHTML = '<wcs-throttle no-leading></wcs-throttle>';
    const el = host.firstElementChild as Throttle;
    el.leading = true;
    expect(el.leading).toBe(true);
    el.leading = undefined;
    expect(el.leading).toBe(false);
    el.leading = null;
    expect(el.hasAttribute("no-leading")).toBe(false);
    expect(el.leading).toBe(true);
  });

  it("maxWait は既定で wait に固定され連続入力中も一定間隔で発火する", () => {
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    const settled: any[] = [];
    el.addEventListener("wcs-throttle:settled", (e) => settled.push((e as CustomEvent).detail.value));

    el.source = "start"; // leading
    for (let t = 20; t <= 200; t += 20) {
      vi.advanceTimersByTime(20);
      el.source = t;
    }
    expect(settled[0]).toBe("start");
    expect(settled.length).toBeGreaterThanOrEqual(3);
    el.remove();
  });

  it("max-wait 属性は既定の wait 固定を上書きする", () => {
    const el = create({ wait: "100", "max-wait": "300" });
    expect(el.maxWait).toBe(300);
    el.remove();
  });

  it("SSR: Debounce から connectedCallbackPromise / hasConnectedCallbackPromise を継承する", async () => {
    vi.useRealTimers();
    const el = create({ wait: "100" });
    document.body.appendChild(el);
    await expect(el.connectedCallbackPromise).resolves.toBeUndefined();
    expect((el.constructor as typeof Throttle).hasConnectedCallbackPromise).toBe(true);
    el.remove();
  });
});
