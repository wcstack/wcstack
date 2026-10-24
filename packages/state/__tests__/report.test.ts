/**
 * report(): an error the engine caught or found reaches the page's error handlers through the
 * platform's reportError() (docs/seam-apps.md, prod-booking); without it (happy-dom, Node) it is
 * console.error with the arguments as before.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { report } from "../src/parser/raiseError";

describe("report", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reportError が無ければ、従来どおりの引数で console.error に出す", () => {
    vi.stubGlobal("reportError", undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new TypeError("boom");
    const node = document.createElement("p");
    report(e);
    report(e, "[@wcstack/state] where", node);
    expect(error.mock.calls).toEqual([[e], ["[@wcstack/state] where", e, node]]);
  });

  it("reportError があれば、値をそのまま渡す", () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new TypeError("boom");
    report(e);
    report("[@wcstack/state] a loop was cut");
    expect(reported.mock.calls).toEqual([[e], ["[@wcstack/state] a loop was cut"]]);
    expect(error).not.toHaveBeenCalled();
  });

  it("場所の文面があれば、両方を言う Error で包み、元の値を cause に持たせる", () => {
    const reported = vi.fn();
    vi.stubGlobal("reportError", reported);
    const e = new TypeError("boom");
    report(e, '[@wcstack/state] binding "textContent: n" failed to apply.', document.createElement("p"));
    const wrapped = reported.mock.calls[0][0] as Error;
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('[@wcstack/state] binding "textContent: n" failed to apply. TypeError: boom');
    expect(wrapped.cause).toBe(e);
  });
});
