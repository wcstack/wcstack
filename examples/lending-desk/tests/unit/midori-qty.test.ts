// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { clampQty, MIDORI_QTY_CHANGE, MidoriQty } from "../../src/components/midori-qty.ts";

function make(attrs: string): { el: MidoriQty; input: HTMLInputElement; dec: HTMLButtonElement; inc: HTMLButtonElement; changes: number[] } {
  document.body.innerHTML = `<midori-qty ${attrs}></midori-qty>`;
  const el = document.querySelector("midori-qty")!;
  const root = el.shadowRoot!;
  const [dec, inc] = [...root.querySelectorAll("button")] as [HTMLButtonElement, HTMLButtonElement];
  const changes: number[] = [];
  el.addEventListener(MIDORI_QTY_CHANGE, (e) => changes.push(e.detail));
  return { el, input: root.querySelector("input")!, dec, inc, changes };
}

describe("clampQty", () => {
  it("clamps to the range and snaps to the step grid that starts at min", () => {
    expect(clampQty(9, 1, 5, 1)).toBe(5);
    expect(clampQty(-3, 1, 5, 1)).toBe(1);
    expect(clampQty(4, 0, 10, 3)).toBe(3);
    expect(clampQty(10, 0, 10, 3)).toBe(9);
    expect(clampQty(Number.NaN, 2, 5, 1)).toBe(2);
  });
});

describe("<midori-qty>", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("reads its attributes and sets the field's aria-*", () => {
    const { el, input } = make(`min="1" max="5" value="2" label="数量"`);
    expect(el.value).toBe(2);
    expect(input.getAttribute("role")).toBe("spinbutton");
    expect(input.getAttribute("aria-valuenow")).toBe("2");
    expect(input.getAttribute("aria-valuemin")).toBe("1");
    expect(input.getAttribute("aria-valuemax")).toBe("5");
    expect(input.getAttribute("aria-label")).toBe("数量");
  });

  it("− and + step, stop at the ends, and tell each change", () => {
    const { el, dec, inc, changes } = make(`min="1" max="3" value="2"`);
    inc.click();
    expect(el.value).toBe(3);
    expect(inc.disabled).toBe(true);
    inc.click();
    dec.click(); dec.click();
    expect(el.value).toBe(1);
    expect(dec.disabled).toBe(true);
    expect(changes).toEqual([3, 2, 1]);
  });

  it("the arrow keys, Home and End", () => {
    const { el, input, changes } = make(`min="1" max="10" value="5"`);
    const key = (k: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    key("ArrowUp");
    key("ArrowDown"); key("ArrowDown");
    key("End");
    key("Home");
    expect(changes).toEqual([6, 5, 4, 10, 1]);
    expect(el.value).toBe(1);
  });

  it("typed digits are kept as digits (full-width too) and clamped on blur", () => {
    const { el, input, changes } = make(`min="1" max="5" value="2"`);
    input.value = "x9";
    input.dispatchEvent(new Event("input"));
    expect(input.value).toBe("9");
    input.dispatchEvent(new Event("blur"));
    expect(el.value).toBe(5);
    expect(input.value).toBe("5");
    input.value = "３";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("blur"));
    expect(changes).toEqual([5, 3]);
  });

  it("a value set by a program clamps and does not dispatch (it is not the user's change)", () => {
    const { el, changes } = make(`min="1" max="5" value="2"`);
    el.value = 99;
    expect(el.value).toBe(5);
    el.max = 3;
    expect(el.value).toBe(3);
    expect(changes).toEqual([]);
  });

  it("declares a wc-bindable surface whose names are members of the class", () => {
    const decl = MidoriQty.wcBindable;
    expect(decl.properties[0]).toEqual({ name: "value", event: MIDORI_QTY_CHANGE });
    for (const i of decl.inputs) expect(i.name in MidoriQty.prototype).toBe(true);
  });
});
