import { describe, it, expect, vi } from "vitest";
import { typeScriptSupport, unsupportedTscMessage, unsupportedTypeScript, unsupportedTypeScriptMessage } from "../src/typescriptSupport";

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
      "@wcstack/typescript reads state files with the JavaScript compiler API of TypeScript 5 or 6, and the project has TypeScript 7.0.2, which has none: npm i -D typescript@6",
    );
  });
});

describe("typeScriptSupport — wcs-tsc の振り分け", () => {
  it("5・6 は API、7.0 は断り、7.1 以降（プレリリース込み）は content mapper", () => {
    expect(typeScriptSupport("5.0.4")).toBe("api");
    expect(typeScriptSupport("6.0.3")).toBe("api");
    expect(typeScriptSupport("7.0.2")).toBe("unsupported");
    expect(typeScriptSupport("7.0.1-rc")).toBe("unsupported");
    expect(typeScriptSupport("7.1.0-beta")).toBe("content-mapper");
    expect(typeScriptSupport("7.1.0-dev.20261023.1")).toBe("content-mapper");
    expect(typeScriptSupport("7.2.0")).toBe("content-mapper");
    expect(typeScriptSupport("8.0.0")).toBe("content-mapper");
    // 読めない版は API として進め、その先で typescript が無いと言う
    expect(typeScriptSupport(undefined)).toBe("api");
    expect(typeScriptSupport("next")).toBe("api");
  });

  it("7.0 の断りは 7.1 と 6 を名指しする", () => {
    expect(unsupportedTscMessage("7.0.2")).toBe(
      "the project has TypeScript 7.0.2, which has neither a JavaScript compiler API nor content mappers; wcs-tsc needs TypeScript 5 or 6, or 7.1 and later: npm i -D typescript@^7.1 (or typescript@6)",
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
