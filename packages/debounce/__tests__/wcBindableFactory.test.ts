import { describe, it, expect } from "vitest";
import { makeDebounceProperties } from "../src/wcBindableFactory";

describe("makeDebounceProperties", () => {
  it("prefix からイベント名を生成する", () => {
    const props = makeDebounceProperties("wcs-throttle");
    expect(props.map((p) => p.name)).toEqual(["value", "fired", "pending"]);
    expect(props[0].event).toBe("wcs-throttle:settled");
    expect(props[1].event).toBe("wcs-throttle:fired");
    expect(props[2].event).toBe("wcs-throttle:pending-changed");
  });

  it("value / fired の getter が detail を取り出す", () => {
    const props = makeDebounceProperties("wcs-debounce");
    expect(props[0].getter!(new CustomEvent("x", { detail: { value: 42 } }))).toBe(42);
    expect(props[1].getter!(new CustomEvent("x", { detail: { args: [1, 2] } }))).toEqual([1, 2]);
  });

  it("pending には getter がない", () => {
    const props = makeDebounceProperties("wcs-debounce");
    expect(props[2].getter).toBeUndefined();
  });
});
