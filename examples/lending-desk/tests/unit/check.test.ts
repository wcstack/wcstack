import { describe, expect, it } from "vitest";
import { checkItemsResponse, checkReservation, parseValidationErrors, tryCheck } from "../../src/lib/check.ts";
import { mapSubmitErrors } from "../../src/lib/submit-errors.ts";

const item = { id: 1, name: "机", category: "机・椅子", centerId: 1, stock: 3, deposit: 0, note: null };

describe("checking what the server sends", () => {
  it("accepts the API type", () => {
    expect(checkItemsResponse({ items: [item], total: 1, page: 1 }).items).toHaveLength(1);
  });
  it("names the first field that is not what the type says (a renamed field, a null)", () => {
    expect(tryCheck(checkItemsResponse, { items: [{ ...item, name: undefined, title: "机" }], total: 1, page: 1 }).problem).toContain("$.items[0].name");
    expect(tryCheck(checkItemsResponse, { items: [{ ...item, stock: null }], total: 1, page: 1 }).problem).toContain("$.items[0].stock");
    expect(tryCheck(checkItemsResponse, null)).toEqual({ ok: null, problem: "" });
  });
  it("reservations", () => {
    expect(() => checkReservation({ id: 1 })).toThrow();
  });
});

describe("a 422 stays at its line", () => {
  it("maps lines.N to the key of the line that was sent at N", () => {
    const errors = parseValidationErrors(JSON.stringify({ errors: { "lines.2.quantity": "この期間の空きは1です", purpose: "利用目的を入力してください" } }));
    const p = mapSubmitErrors(errors, ["a", "b", "c"]);
    expect(p.byLine).toEqual({ c: "数量: この期間の空きは1です" });
    expect(p.purpose).toBe("利用目的を入力してください");
  });
  it("is not JSON → nothing", () => {
    expect(parseValidationErrors("<html>")).toEqual({});
  });
});
