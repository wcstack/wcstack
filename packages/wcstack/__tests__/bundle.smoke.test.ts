import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// happy-dom 環境では import.meta.url が http:// になるため、dist はファイル
// システムパス（vitest の cwd = パッケージルート）から解決する。
const DIST_BUNDLE = resolve("dist/auto.min.js");

// SPA コアプロファイルの全タグ（docs/distribution-robustness-impl-plan.md D2）。
// wcs-guard-handler は router の bootstrap では define されないため含めない。
const EXPECTED_TAGS = [
  "wcs-state", "wcs-ssr",
  "wcs-router", "wcs-route", "wcs-outlet", "wcs-layout", "wcs-layout-outlet", "wcs-link", "wcs-head",
  "wcs-fetch", "wcs-fetch-header", "wcs-fetch-body", "wcs-infinite-scroll",
  "wcs-storage",
  "wcs-autoloader",
];

describe("wcstack バンドル", () => {
  it("src/auto.ts の import で全メンバータグが定義される（タグ検閲 = subpath typo の唯一のゲート）", async () => {
    await import("../src/auto");
    for (const tag of EXPECTED_TAGS) {
      expect(customElements.get(tag), tag).toBeDefined();
    }
  });

  it("ビルド済み dist/auto.min.js を第二モジュールインスタンスとして併載しても throw せず先勝ちが保たれる", async () => {
    // 同一 specifier の再 import は ESM キャッシュ返却で再評価されず、何も検証しない。
    // ここでは src/auto.ts（1 本目）とビルド済み dist（2 本目 = 別モジュール実体）を
    // 同一 realm で両方評価し、「バンドル + 個別 auto の併載」と同じ状況を作る。
    // 全 define が customElements.get でガードされ、protocol インストールが
    // Symbol.for 先勝ちであることの実行実証（plan §1.5 / B3）。
    const before = customElements.get("wcs-state");
    expect(before).toBeDefined();
    await import(pathToFileURL(DIST_BUNDLE).href);
    expect(customElements.get("wcs-state")).toBe(before);
    for (const tag of EXPECTED_TAGS) {
      expect(customElements.get(tag), tag).toBeDefined();
    }
  });

  it("dist/auto.min.js は静的 import ゼロ（SRI 全カバーの前提, docs/sri.md §4/§6）", () => {
    const bundle = readFileSync(DIST_BUNDLE, "utf8");
    // 第 1 節 = side-effect / named / namespace 形、第 2 節 = default import 形
    // （external 取りこぼし時に rollup が出す `import X from"…"`）。動的 `import(` と
    // `import.meta` は空白を挟まないためどちらの節にも一致しない。
    const staticImports = /(?:^|[;\n])import\s*[{*"']|(?:^|[;\n])import\s+[A-Za-z_$]/g;
    expect([...bundle.matchAll(staticImports)].length).toBe(0);
  });
});
