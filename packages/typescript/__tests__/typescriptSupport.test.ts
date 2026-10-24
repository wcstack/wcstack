import { describe, it, expect, vi } from "vitest";
import { unsupportedTypeScript, unsupportedTypeScriptMessage } from "../src/typescriptSupport";

// TypeScript 7 の `typescript` が公開するのは `{ version, versionMajorMinor }` だけ（コンパイラ API も enum も無い）。
vi.mock("typescript", () => ({ default: { version: "7.0.2", versionMajorMinor: "7.0" } }));

describe("unsupportedTypeScript", () => {
  it("7 以上の版だけを返す", () => {
    expect(unsupportedTypeScript("5.0.4")).toBeUndefined();
    expect(unsupportedTypeScript("5.9.3")).toBeUndefined();
    expect(unsupportedTypeScript("6.0.3")).toBeUndefined();
    expect(unsupportedTypeScript("7.0.2")).toBe("7.0.2");
    expect(unsupportedTypeScript("7.1.0-beta")).toBe("7.1.0-beta");
    expect(unsupportedTypeScript(undefined)).toBeUndefined();
    expect(unsupportedTypeScript("not a version")).toBeUndefined();
  });

  it("文言は版と入れ直す版を名指しする", () => {
    expect(unsupportedTypeScriptMessage("7.0.2")).toBe(
      "@wcstack/typescript runs on TypeScript 5 or 6, and the project has TypeScript 7.0.2, which has no JavaScript compiler API: npm i -D typescript@6",
    );
  });
});

describe("TypeScript 7 の下で", () => {
  it("モジュールは読み込め、wcs-schema は版を名指しして 2 で止まる", async () => {
    const { main } = await import("../src/cli/wcsSchema");
    const { DEFAULT_COMPILER_OPTIONS } = await import("../src/program");
    expect(DEFAULT_COMPILER_OPTIONS.target).toBeUndefined();
    let stderr = "";
    const code = main(["emit", "state.ts", "--out=-"], { stdout: () => {}, stderr: (t) => { stderr += t; }, cwd: () => process.cwd() });
    expect(code).toBe(2);
    expect(stderr).toBe(`${unsupportedTypeScriptMessage("7.0.2")}\n`);
  });

  it("ライブラリの loadStateFile も同じ文言で投げる", async () => {
    const { loadStateFile } = await import("../src/program");
    expect(() => loadStateFile("state.ts")).toThrow(unsupportedTypeScriptMessage("7.0.2"));
  });
});
