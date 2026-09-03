/**
 * core/sidecar/discover.ts
 *
 * application manifest(`wcstack.manifest.json`)の発見規則
 * (docs/wcstack-manifest-schema.md §5-1・docs/app-testing-and-typescript-impl-plan.md D8)。
 *
 * HTML ファイルのディレクトリから上へ `wcstack.manifest.json` を探し、**最も近い 1 つ**
 * を採る。親と子の両方にあっても合成しない(§5「暗黙 merge 禁止」)。読めなければ無い
 * ものとする。壊れた manifest が最近傍ならそれが結果 — さらに上は見ない(その診断は
 * manifest 自身の source に載る)。
 *
 * 入力は `<wcs-state src>` と同じ `fileReader` だけ。CLI(core/cli/runValidation.ts)と
 * IDE(service/wcsCompletionPlugin.ts → core/validateDocument.ts)が **この 1 関数** を
 * 同じ reader で呼ぶことが IDE / CLI パリティの完了条件 — 片方だけが manifest を読むと、
 * 同じ validator core を通しても「IDE は warning、CI は error」という食い違いになる。
 *
 * pure(DOM / vscode / node fs 非依存)。
 */

import type { FileReader } from "../../service/statePathResolver.js";
import { LoadedManifest, loadManifest } from "./loader.js";
import type { JsonSchemaNode } from "./types.js";

export const APPLICATION_MANIFEST_FILENAME = "wcstack.manifest.json";

/**
 * 上方向に辿る階層の上限。reader は HTML ディレクトリ基準の相対パスしか受けないので
 * ファイルシステムのルートを知れない。ルートに達した後の `../` は同じ場所を指すだけ
 * (読み取りは reader 側でメモ化)なので、上限は「無限に登らない」ための保険。
 */
const MAX_ASCEND = 16;

export interface DiscoveredApplicationManifest {
  /** HTML ディレクトリ基準の相対パス(`wcstack.manifest.json` / `../wcstack.manifest.json` ...)。 */
  readonly relativePath: string;
  readonly text: string;
  readonly loaded: LoadedManifest;
  /** 単一ツリーの stateSchema（v2）。kind が application でなければ undefined。 */
  readonly schema: JsonSchemaNode | undefined;
}

/**
 * 最近傍の `wcstack.manifest.json` を 1 つ返す。無ければ undefined。
 */
export function discoverApplicationManifest(fileReader: FileReader): DiscoveredApplicationManifest | undefined {
  for (let up = 0; up <= MAX_ASCEND; up++) {
    const relativePath = `${"../".repeat(up)}${APPLICATION_MANIFEST_FILENAME}`;
    const text = fileReader(relativePath);
    if (text === undefined) continue;
    const loaded = loadManifest({ text, source: relativePath });
    return { relativePath, text, loaded, schema: applicationSchemaOf(loaded) };
  }
  return undefined;
}

/**
 * 読み込み済み manifest から `wcstack.application.stateSchema`（v2: 単一ツリー）を
 * 取り出す。application 以外・壊れた manifest・オブジェクトでない schema は undefined。
 */
export function applicationSchemaOf(loaded: LoadedManifest): JsonSchemaNode | undefined {
  const manifest = loaded.manifest;
  if (manifest === null || manifest.kind !== "application") return undefined;
  const application = manifest.manifestExtensions?.["wcstack.application"];
  const schema = application?.stateSchema;
  if (schema !== null && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as JsonSchemaNode;
  }
  return undefined;
}

/**
 * HTML の source(CLI 引数のパス)と発見した相対パスから、診断に載せる manifest の
 * source 表示名を作る。pure に留めるため node:path は使わない(`..` の畳み込みだけ)。
 */
export function joinRelativeSource(htmlSource: string, relativePath: string): string {
  const sepIndex = Math.max(htmlSource.lastIndexOf("/"), htmlSource.lastIndexOf("\\"));
  const dirSegments = sepIndex === -1 ? [] : htmlSource.slice(0, sepIndex).split(/[\\/]/);
  for (const segment of relativePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (dirSegments.length > 0 && dirSegments[dirSegments.length - 1] !== "..") dirSegments.pop();
      else dirSegments.push("..");
      continue;
    }
    dirSegments.push(segment);
  }
  return dirSegments.join("/");
}
