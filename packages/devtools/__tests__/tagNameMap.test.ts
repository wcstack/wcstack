/**
 * The HTMLElementTagNameMap augmentation in src/exports.ts must name the tag that
 * bootstrapDevtools registers (docs/typescript.md §3). The catalog-based drift test
 * in vscode-wcs does not scan this package, so the comparison lives here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("HTMLElementTagNameMap の宣言と登録タグ名の一致", () => {
  it("bootstrapDevtools が登録する wcs-devtools が宣言され、余分な宣言もない", () => {
    const src = (file: string) => readFileSync(resolve(__dirname, "..", "src", file), "utf8");
    const registered = /const TAG_NAME = "(wcs-[a-z0-9-]+)"/.exec(src("bootstrapDevtools.ts"));
    expect(registered).not.toBeNull();
    const block = /interface HTMLElementTagNameMap \{([\s\S]*?)\n\s*\}/.exec(src("exports.ts"));
    expect(block).not.toBeNull();
    const declared = [...block![1].matchAll(/"(wcs-[a-z0-9-]+)"\s*:/g)].map((m) => m[1]);
    expect(declared).toEqual([registered![1]]);
  });
});
