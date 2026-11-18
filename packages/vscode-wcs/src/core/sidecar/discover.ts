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
import { createTemplateTester, parseWcsStateElements } from "../../language/htmlParse.js";
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
  /**
   * The state file the stateSchema was generated from (`wcstack.application.stateSource`, which `wcs-schema emit`
   * writes relative to the manifest), relative to the HTML file's directory. undefined when the manifest names none.
   */
  readonly stateSource: string | undefined;
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
    const stateSource = applicationStateSourceOf(loaded);
    return {
      relativePath, text, loaded, schema: applicationSchemaOf(loaded),
      stateSource: stateSource === undefined ? undefined : stateSourceFromPage("_", relativePath, stateSource),
    };
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
 * `wcstack.application.stateSource` (since 4.26): the state file the stateSchema describes, relative to the manifest's
 * directory, as `wcs-schema emit` writes it. undefined when absent, empty or not a string (a hand-written manifest,
 * one written before 4.26).
 */
export function applicationStateSourceOf(loaded: LoadedManifest): string | undefined {
  const manifest = loaded.manifest;
  if (manifest === null || manifest.kind !== "application") return undefined;
  const stateSource: unknown = manifest.manifestExtensions?.["wcstack.application"]?.stateSource;
  return typeof stateSource === "string" && stateSource.trim() !== "" ? stateSource.trim() : undefined;
}

/** A path's segments, `.` dropped and `..` folded where it can be; whether it is absolute (`/…`, `C:/…`). */
function segmentsOf(path: string): { readonly absolute: boolean; readonly segments: string[] } {
  const norm = path.replace(/\\/g, "/");
  const absolute = norm.startsWith("/") || /^[A-Za-z]:\//.test(norm);
  const segments: string[] = [];
  for (const segment of norm.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
    else segments.push(/^[A-Za-z]:$/.test(segment) ? segment.toUpperCase() : segment);
  }
  return { absolute, segments };
}

/**
 * The manifest's `stateSource` as a path relative to a page's directory: `pageSource` and `manifestSource` name the
 * page and the manifest in one frame (both relative to the same directory, or both absolute). undefined when they are
 * not in one frame (one absolute, one relative): which file is meant cannot be told then, and the schema is applied as
 * before.
 */
export function stateSourceFromPage(pageSource: string, manifestSource: string, stateSource: string): string | undefined {
  const page = segmentsOf(pageSource);
  const manifest = segmentsOf(manifestSource);
  if (page.absolute !== manifest.absolute) return undefined;
  const target = segmentsOf([...manifest.segments.slice(0, -1), stateSource].join("/")).segments;
  const dir = page.segments.slice(0, -1);
  let common = 0;
  while (common < dir.length && common < target.length && dir[common] === target[common] && dir[common] !== "..") common++;
  return [...dir.slice(common).map(() => ".."), ...target.slice(common)].join("/");
}

/** The same file for the scoping: a path's `.ts` / `.mts` counts as its `.js` / `.mjs` (what a build emits). */
function sameStateFile(a: string, b: string): boolean {
  const canonical = (p: string): string => p.replace(/\.ts$/, ".js").replace(/\.mts$/, ".mjs");
  return canonical(a) === canonical(b);
}

/**
 * Whether a stateSchema generated from `stateSource` (relative to the page's directory — DiscoveredApplicationManifest)
 * is the contract of this page: one of its root `<wcs-state>` elements (no `mount`, no `bind-component`, outside every
 * `<template>`) loads that file with `src` — resolved relative to the page, `.js` and `.ts` (`.mjs` and `.mts`) of the
 * same path being the same file. A page whose state is inline, `json=`, or another file is not described by that
 * schema: applied to it, its own correct paths were `wcs/path-nonexistent` errors (the lending-desk seam app's counter
 * page, beside the app's manifest). A `src` from `/` is read relative to the page's directory (a Vite page's root); two
 * paths that do not compare equal are still one file when the reader gives the same text for both (a page in a directory
 * below the manifest's, a `src` from `/` under `--root`). A URL never matches.
 */
export function schemaAppliesToPage(
  html: string,
  stateTagName: string,
  stateSource: string,
  fileReader?: FileReader,
): boolean {
  const roots = parseWcsStateElements(html, stateTagName)
    .filter((e) => e.mountPath === null && !e.bindComponent && e.srcAttr !== undefined);
  if (roots.length === 0) return false;
  const insideTemplate = createTemplateTester(html);
  const target = segmentsOf(stateSource).segments.join("/");
  for (const root of roots) {
    if (insideTemplate(root.tagStart)) continue;
    const src = (root.srcAttr as string).trim().replace(/[?#].*$/, "");
    if (src === "" || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) continue;
    if (sameStateFile(segmentsOf(src).segments.join("/"), target)) return true;
    // the same file under two names the paths alone cannot tell apart — a page below the manifest (`../pages/state.ts`
    // from it is `./state.ts` from the page), a `src` from `/` under `--root`: what the reader gives for both
    if (fileReader !== undefined && sameContent(src, stateSource, fileReader)) return true;
  }
  return false;
}

/** Whether the reader gives the same text for `a` and `b` (each also as its `.ts` / `.js` twin). */
function sameContent(a: string, b: string, fileReader: FileReader): boolean {
  const twins = (p: string): string[] => [p, p.replace(/\.(m?)js$/, ".$1ts"), p.replace(/\.(m?)ts$/, ".$1js")];
  const texts = new Set(twins(a).map((p) => fileReader(p)).filter((t): t is string => t !== undefined && t !== ""));
  return texts.size > 0 && twins(b).some((p) => texts.has(fileReader(p) ?? "\u0000"));
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
