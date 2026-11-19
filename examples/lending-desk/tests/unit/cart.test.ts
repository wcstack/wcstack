import { describe, expect, it } from "vitest";
import { cartTotals, lineKey, mergeLine, sanitizeCart, toRequestLines, type CartLine } from "../../src/lib/cart.ts";

const base = { itemId: 3, name: "テント", centerId: 1, deposit: 3000, max: 4, from: "2026-12-05", to: "2026-12-06", quantity: 1 };

describe("the cart", () => {
  it("adds a line, and the same item for the same period adds to that line", () => {
    let cart: CartLine[] = [];
    cart = mergeLine(cart, base);
    cart = mergeLine(cart, { ...base, quantity: 2 });
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ key: lineKey(3, "2026-12-05", "2026-12-06"), quantity: 3 });
  });
  it("another period is another line; a merge is capped at what is free", () => {
    let cart = mergeLine([], base);
    cart = mergeLine(cart, { ...base, from: "2026-12-07", to: "2026-12-07" });
    expect(cart).toHaveLength(2);
    cart = mergeLine(cart, { ...base, quantity: 9 });
    expect(cart[0]?.quantity).toBe(4);
  });
  it("never mutates the cart it was given", () => {
    const cart = mergeLine([], base);
    const next = mergeLine(cart, base);
    expect(cart[0]?.quantity).toBe(1);
    expect(next).not.toBe(cart);
  });
  it("totals: lines, items, the deposit", () => {
    const cart = mergeLine(mergeLine([], { ...base, quantity: 2 }), { ...base, itemId: 4, deposit: 500, quantity: 3 });
    expect(cartTotals(cart)).toEqual({ lines: 2, items: 5, deposit: 7500 });
    expect(cartTotals([])).toEqual({ lines: 0, items: 0, deposit: 0 });
  });
  it("what is sent", () => {
    expect(toRequestLines(mergeLine([], base))).toEqual([{ itemId: 3, from: "2026-12-05", to: "2026-12-06", quantity: 1 }]);
  });
  it("a stored cart keeps only well-formed lines", () => {
    expect(sanitizeCart(null)).toBeNull();
    expect(sanitizeCart([{ itemId: 1, from: "2026-12-05", to: "2026-12-05", quantity: 2 }, { itemId: "x" }, null])).toHaveLength(1);
  });
});
