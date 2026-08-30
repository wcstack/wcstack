import { describe, it, expect } from "vitest";
import { settle, fire, installDom } from "../src/exports";
import { GLOBALS_KEYS } from "@wcstack/server";

describe("settle", () => {
  it("マイクロタスク 2 段とマクロタスク 1 段の後に解決する", async () => {
    const order: string[] = [];
    queueMicrotask(() => order.push("micro"));
    setTimeout(() => order.push("macro"), 0);
    await settle();
    expect(order).toEqual(["micro", "macro"]);
  });
});

describe("fire", () => {
  it("既定で bubbles: detail があれば CustomEvent、無ければ Event", () => {
    const parent = document.createElement("div");
    const child = document.createElement("button");
    parent.appendChild(child);
    const seen: Event[] = [];
    parent.addEventListener("click", (e) => seen.push(e));
    parent.addEventListener("ping", (e) => seen.push(e));

    expect(fire(child, "click")).toBe(true);
    expect(fire(child, "ping", { detail: { n: 1 } })).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeInstanceOf(Event);
    expect(seen[0].bubbles).toBe(true);
    expect(seen[1]).toBeInstanceOf(CustomEvent);
    expect((seen[1] as CustomEvent).detail).toEqual({ n: 1 });
  });

  it("init で bubbles を切れ、preventDefault は false を返す", () => {
    const parent = document.createElement("div");
    const child = document.createElement("button");
    parent.appendChild(child);
    let bubbled = 0;
    parent.addEventListener("click", () => bubbled++);
    child.addEventListener("click", (e) => e.preventDefault());
    expect(fire(child, "click", { bubbles: false, cancelable: true })).toBe(false);
    expect(bubbled).toBe(0);
  });
});

describe("installDom（素の Node 向け）", () => {
  it("渡した window のグローバルを差し替え、restore で戻して close する", async () => {
    const before = globalThis.document;
    let closed = false;
    const fake: Record<string, unknown> = { happyDOM: { close: async () => { closed = true; } } };
    for (const key of GLOBALS_KEYS) fake[key] = { fake: key };
    const restore = await installDom({ window: fake });
    expect((globalThis as any).document).toEqual({ fake: "document" });
    expect(URL.createObjectURL).toBeUndefined();
    await restore();
    expect(globalThis.document).toBe(before);
    expect(closed).toBe(true);
  });

  it("window を渡さなければ happy-dom を読み込んで Window を作る（url を反映）", async () => {
    const before = globalThis.document;
    const restore = await installDom({ url: "http://example.test/page" });
    expect(globalThis.document).not.toBe(before);
    expect(String((globalThis as any).location.href)).toBe("http://example.test/page");
    await restore();
    expect(globalThis.document).toBe(before);
  });
});
