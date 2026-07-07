import { describe, it, expect } from "vitest";
import { raiseError } from "../src/raiseError";

describe("raiseError", () => {
  it("パッケージ名を接頭辞に付与したエラーをthrowすること", () => {
    expect(() => {
      raiseError("test error");
    }).toThrow("[@wcstack/screen-orientation] test error");
  });

  it("任意のメッセージを含むエラーをthrowすること", () => {
    expect(() => {
      raiseError("custom message");
    }).toThrow("[@wcstack/screen-orientation] custom message");
  });
});
