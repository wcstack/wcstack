/**
 * wcs.html-data.json のドリフト検査。
 *
 * 正本チェーン: 各パッケージの static wcBindable / observedAttributes
 *   → builtinTags.generated.ts(emit-builtin-tags.mjs)
 *   → wcs.html-data.json(同スクリプトが buildHtmlCustomData で射影)
 *
 * このテストは「tracked な JSON が tracked なカタログの射影と一致する」ことを CI で
 * 強制する — カタログだけ再生成して JSON のコミットを忘れる、または射影ロジックだけ
 * 変えて JSON を再生成し忘れる、のどちらも検出する(filterMeta の golden テストと同型)。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_TAGS } from "../src/service/generated/builtinTags.generated.js";
import { buildHtmlCustomData } from "../scripts/html-custom-data.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("wcs.html-data.json — カタログ射影のドリフト検査", () => {
  const committed = JSON.parse(readFileSync(resolve(here, "..", "wcs.html-data.json"), "utf8"));
  const derived = buildHtmlCustomData(BUILTIN_TAGS);

  it("コミット済み JSON が builtinTags カタログの射影と一致すること", () => {
    expect(committed).toEqual(derived);
  });

  it("全 wcs-* タグが custom data に載っていること", () => {
    const names = new Set(committed.tags.map((t: { name: string }) => t.name));
    for (const tagName of Object.keys(BUILTIN_TAGS)) {
      expect(names.has(tagName), `${tagName} が custom data に無い`).toBe(true);
    }
    expect(committed.tags).toHaveLength(Object.keys(BUILTIN_TAGS).length);
  });

  it("属性面が observedAttributes と input ミラーの合併であること（fetch = observed のみ / broadcast = ミラー）", () => {
    const fetch = committed.tags.find((t: { name: string }) => t.name === "wcs-fetch")!;
    expect(fetch.attributes.map((a: { name: string }) => a.name)).toContain("url");
    const broadcast = committed.tags.find((t: { name: string }) => t.name === "wcs-broadcast")!;
    expect(broadcast.attributes.map((a: { name: string }) => a.name)).toEqual(
      expect.arrayContaining(["name", "manual"]),
    );
  });

  it("data-wcs が globalAttributes として宣言されていること", () => {
    const dataWcs = committed.globalAttributes.find((a: { name: string }) => a.name === "data-wcs");
    expect(dataWcs).toBeDefined();
  });

  it("説明が markdown で契約面（properties / commands）を開示していること", () => {
    const fetch = committed.tags.find((t: { name: string }) => t.name === "wcs-fetch")!;
    expect(fetch.description.kind).toBe("markdown");
    expect(fetch.description.value).toContain("`value`");
    expect(fetch.description.value).toContain("`command.fetch`");
    expect(fetch.references[0].url).toContain("/packages/fetch#readme");
  });
});
