/**
 * emit-builtin-tags.mjs — 組み込み wcs-* タグ契約カタログを生成する。
 *
 * 各 I/O パッケージの `dist/auto.min.js` を最小 DOM シム下で import し、
 * customElements.define をフックしてタグ名 → Shell クラスを捕捉、
 * `static wcBindable`（properties / inputs / commands）と observedAttributes を
 * 機械抽出して `src/service/generated/builtinTags.generated.ts` に書き出す。
 *
 * 単一正本は各パッケージの `static wcBindable`。手書きリストを持たないため、
 * パッケージ側の契約変更はこのスクリプトの再実行だけでカタログに反映される。
 *
 * 実行: node scripts/emit-builtin-tags.mjs（各パッケージの dist がビルド済みであること）
 */
import { readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

// --- 最小 DOM シム（import 時のクラス定義評価にだけ耐えればよい） ---
class FakeNode {}
class FakeElement extends FakeNode {
  static get observedAttributes() { return []; }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  getAttribute() { return null; }
  setAttribute() {}
  hasAttribute() { return false; }
  removeAttribute() {}
  toggleAttribute() {}
  appendChild() {}
  attachShadow() { return { appendChild() {}, innerHTML: "" }; }
}
globalThis.HTMLElement = FakeElement;
globalThis.Node = FakeNode;
globalThis.Element = FakeElement;
const captured = new Map();
globalThis.customElements = {
  define(name, ctor) { captured.set(name, ctor); },
  get(name) { return captured.get(name); },
  whenDefined() { return Promise.resolve(); },
};
globalThis.document = {
  createElement: () => new FakeElement(),
  addEventListener() {}, removeEventListener() {},
  querySelector: () => null, querySelectorAll: () => [],
  body: new FakeElement(), head: new FakeElement(),
  hidden: false, readyState: "loading", currentScript: null,
};
globalThis.window = globalThis;
globalThis.CSSStyleSheet = class { replaceSync() {} };

const here = path.dirname(fileURLToPath(import.meta.url));
const packagesRoot = path.resolve(here, "../..");
// I/O ノードでないパッケージ（state / router / signals はタグ契約の対象外）。
const SKIP = new Set([
  "state", "router", "signals", "autoloader", "devtools", "server",
  "poc-visual-editor", "vscode-wcs",
]);

/** @type {Record<string, {package: string, inputs: Record<string, string | null>, properties: string[], commands: string[]}>} */
const tags = {};
const failed = [];

for (const dir of readdirSync(packagesRoot).sort()) {
  if (SKIP.has(dir)) continue;
  const entry = path.join(packagesRoot, dir, "dist", "auto.min.js");
  if (!existsSync(entry)) continue;
  captured.clear();
  try {
    await import(pathToFileURL(entry).href);
  } catch (e) {
    failed.push(`${dir}: ${String(e).slice(0, 120)}`);
    continue;
  }
  for (const [tagName, ctor] of captured) {
    const wb = ctor.wcBindable;
    if (!wb) {
      // ヘルパータグ（wcs-fetch-header 等）は契約なしの既知タグとして登録する。
      tags[tagName] = { package: dir, inputs: {}, properties: [], commands: [] };
      continue;
    }
    const inputs = {};
    for (const i of wb.inputs ?? []) inputs[i.name] = i.attribute ?? null;
    tags[tagName] = {
      package: dir,
      inputs,
      properties: (wb.properties ?? []).map((p) => p.name),
      commands: (wb.commands ?? []).map((c) => c.name),
    };
  }
}

if (failed.length > 0) {
  console.error("[emit-builtin-tags] FAILED packages:\n  " + failed.join("\n  "));
  process.exit(1);
}

const tagCount = Object.keys(tags).length;
const banner = `/**
 * builtinTags.generated.ts — 自動生成。手で編集しない。
 *
 * 生成: scripts/emit-builtin-tags.mjs（各 I/O パッケージの \`static wcBindable\` が単一正本）。
 * 再生成: npm run emit:builtin-tags
 */

/** 組み込み wcs-* タグ 1 つ分の wc-bindable 契約。 */
export interface BuiltinTagContract {
  /** 由来パッケージ（packages/<name>）。 */
  readonly package: string;
  /** input 名 → ミラー属性名（属性ミラーなしは null）。 */
  readonly inputs: Readonly<Record<string, string | null>>;
  /** observable property（出力）名。 */
  readonly properties: readonly string[];
  /** command 名。 */
  readonly commands: readonly string[];
}

export const BUILTIN_TAGS: Readonly<Record<string, BuiltinTagContract>> = `;

const outPath = path.join(here, "..", "src", "service", "generated", "builtinTags.generated.ts");
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, banner + JSON.stringify(tags, null, 2) + " as const;\n");
console.log(`[emit-builtin-tags] wrote ${tagCount} tags -> ${path.relative(process.cwd(), outPath)}`);
