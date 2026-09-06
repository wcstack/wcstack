/**
 * The HTMLElementTagNameMap augmentation in src/exports.ts must list every default
 * tag name in config.tagNames (docs/typescript.md §3). The catalog-based drift test
 * in vscode-wcs does not scan this package (it has no I/O node in dist/auto.min.js),
 * so the comparison against `config.tagNames` lives here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig } from "../src/config";

describe("HTMLElementTagNameMap の宣言と config.tagNames の一致", () => {
  it("既定タグ名（wcs-state / wcs-ssr）が全て宣言され、余分な宣言もない", () => {
    const text = readFileSync(resolve(__dirname, "..", "src", "exports.ts"), "utf8");
    const block = /interface HTMLElementTagNameMap \{([\s\S]*?)\n\s*\}/.exec(text);
    expect(block).not.toBeNull();
    const declared = [...block![1].matchAll(/"(wcs-[a-z0-9-]+)"\s*:/g)].map((m) => m[1]).sort();
    const expected = Object.values(getConfig().tagNames).sort();
    expect(declared).toEqual(expected);
  });
});
