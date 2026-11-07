/**
 * transform.ts — `.html` を TypeScript 7.1 の content mapper の出力にする。
 *
 * 仮想コードの定義は Language Server と `wcs-tsc` と同じ `createWcsLanguagePlugin`
 * （Language Server モード: `<wcs-state>` のブロックごとに、プリアンブル + `@wcstack/state` の
 * import を空白にしたユーザーコード + `defineState(…)` のラップ + `this` を読む getter の `: any`）。
 * mapper はその枠を付け直すだけ（docs/typescript-content-mapper.md §4.2）:
 *
 * - 正規の出力: 空の `.mts`。ページのマークアップが TypeScript として読まれることはない。
 * - ブロックごとに supplemental の出力 1 つ（`.mts`）。別のファイルなので、同じ名前を宣言する
 *   2 つのブロックはぶつからない。`.mts` はいつもモジュールとして読まれる — `.ts` だと
 *   import / export の無いブロックのプリアンブルがページをまたいで衝突し、`module: nodenext` で
 *   `"type": "module"` の無いプロジェクトでは CommonJS として読まれる（TS1295）。
 * - プリアンブルの仮想範囲に ignore の directive（Volar がプリアンブルの診断を捨てていたのと同じ。
 *   `lib` に DOM が無いときの `HTMLElement` など）。
 * - `urlImports: "any"` なら、`https://` / `http://` の module specifier の仮想範囲に ignore の
 *   directive（TS2307 を出さず、束縛は `any`）。ambient の `declare module "https://*"` は
 *   `moduleDetection: force` で augmentation になって壊れるので使わない。
 *
 * 範囲の対応は、プラグインの mapping（生成側と HTML 側のテキストが一致する）をそのまま
 * `Verbatim` の範囲にする。一致しない mapping があれば一致する区間に分ける（安全網。
 * TypeScript は一致しない `Verbatim` を拒み、ページ全体を空として読む）。
 */

import type { CodeMapping } from '@volar/language-core';
import { createWcsLanguagePlugin } from '../language/plugin.js';
import { WCS_PREAMBLE_LENGTH } from '../language/preamble.js';
import type { MapperOptions } from './options.js';
import type { DiagnosticDirective, Mapping, MappedOutput, PositionEncoding, TransformResult } from './protocol.js';

/** 出力の拡張子。 */
export const VIRTUAL_EXTENSION = '.mts';

export interface TransformOptions extends MapperOptions {
  readonly encoding: PositionEncoding;
  /** テスト用: mapping を分けなければならなかったら投げる。 */
  readonly strictMappings?: boolean;
}

const plugins = new Map<string, ReturnType<typeof createWcsLanguagePlugin>>();

function pluginFor(stateTagName: string): ReturnType<typeof createWcsLanguagePlugin> {
  let plugin = plugins.get(stateTagName);
  if (plugin === undefined) {
    plugin = createWcsLanguagePlugin(stateTagName);
    plugins.set(stateTagName, plugin);
  }
  return plugin;
}

/** UTF-16 の範囲 `[virtualStart, virtualEnd, originalStart, originalEnd)`。 */
type Segment = readonly [number, number, number, number];

export function transformHtml(fileName: string, content: string, options: TransformOptions): TransformResult {
  const snapshot = { getText: (start: number, end: number) => content.slice(start, end), getLength: () => content.length, getChangeRange: () => undefined };
  const root = pluginFor(options.stateTagName).createVirtualCode?.(fileName, 'html', snapshot, {} as never);
  const supplemental: MappedOutput[] = [];
  for (const code of root?.embeddedCodes ?? []) {
    const text = code.snapshot.getText(0, code.snapshot.getLength());
    const segments = exactSegments(code.mappings, text, content, options.strictMappings === true);
    supplemental.push(output(text, content, segments, ignoredRanges(text, segments, options), options.encoding));
  }
  return { text: '', extension: VIRTUAL_EXTENSION, mappings: [], ...(supplemental.length > 0 ? { supplemental } : {}) };
}

/** プリアンブルと（`urlImports: "any"` なら）URL の module specifier を覆う ignore の範囲（UTF-16）。 */
function ignoredRanges(text: string, segments: readonly Segment[], options: MapperOptions): Segment[] {
  const anchor = segments[0]?.[2] ?? 0;
  const ranges: Segment[] = [[0, WCS_PREAMBLE_LENGTH, anchor, anchor]];
  if (options.urlImports === 'any') {
    for (const [start, end] of urlSpecifiers(text, WCS_PREAMBLE_LENGTH)) {
      const segment = segments.find(([vs, ve]) => vs <= start && end <= ve);
      if (segment !== undefined) ranges.push([start, end, segment[2] + start - segment[0], segment[2] + end - segment[0]]);
    }
  }
  return ranges;
}

/**
 * `from "https://…"`・`import "https://…"`・`import("https://…")` の文字列リテラルの範囲
 * （引用符を含む）。`fetch("https://…")` のような、module specifier でない URL は拾わない。
 */
export function urlSpecifiers(text: string, from = 0): Array<readonly [number, number]> {
  // `from` の後ろに括弧は来ない（`import` だけが `import("…")` の形を取る）
  const pattern = /(?<![\w$.])(?:from\s*|import\s*(?:\(\s*)?)((["'])https?:\/\/[^"'\r\n]*\2)/g;
  pattern.lastIndex = from;
  const found: Array<readonly [number, number]> = [];
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const end = match.index + match[0].length;
    found.push([end - match[1].length, end]);
  }
  return found;
}

/**
 * プラグインの mapping を、両側のテキストが一致する範囲にする。一致しない部分は対応なし
 * （合成されたテキスト）にし、サロゲートペアの途中では分けない。
 */
/** @internal テスト用にエクスポート */
export function exactSegments(mappings: readonly CodeMapping[], text: string, content: string, strict: boolean): Segment[] {
  const segments: Segment[] = [];
  for (const mapping of mappings) {
    for (let i = 0; i < mapping.sourceOffsets.length; i++) {
      const vs = mapping.generatedOffsets[i];
      const os = mapping.sourceOffsets[i];
      const length = mapping.lengths[i];
      if (length <= 0) continue;
      if (text.slice(vs, vs + length) === content.slice(os, os + length) && vs + length <= text.length && os + length <= content.length) {
        segments.push([vs, vs + length, os, os + length]);
        continue;
      }
      if (strict) throw new Error(`mapping at virtual ${vs} does not match the original at ${os}`);
      let run = -1;
      for (let at = 0; at <= length; ) {
        const width = at < length && isHighSurrogate(text.charCodeAt(vs + at)) ? 2 : 1;
        const same = at < length && text.slice(vs + at, vs + at + width) === content.slice(os + at, os + at + width);
        if (same && run < 0) run = at;
        if (!same && run >= 0) {
          segments.push([vs + run, vs + at, os + run, os + at]);
          run = -1;
        }
        at += width;
      }
    }
  }
  return segments.sort((a, b) => a[0] - b[0]);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function output(text: string, content: string, segments: readonly Segment[], ignored: readonly Segment[], encoding: PositionEncoding): MappedOutput {
  const virtual = encoding === 'utf-8' ? utf8Offsets(text) : identity;
  const original = encoding === 'utf-8' ? utf8Offsets(content) : identity;
  const mappings: Mapping[] = segments.map(([vs, ve, os, oe]) => [virtual(vs), virtual(ve) - virtual(vs), original(os), original(oe) - original(os), 0]);
  const directives: DiagnosticDirective[] = ignored.map(([vs, ve, os, oe]) => [original(os), original(oe) - original(os), virtual(vs), virtual(ve), 0]);
  return { text, extension: VIRTUAL_EXTENSION, mappings, diagnosticDirectives: { unusedExpectDirectiveDiagnostics: [], directives } };
}

const identity = (offset: number): number => offset;

/** UTF-16 のオフセット → UTF-8 のバイトのオフセット。 */
export function utf8Offsets(text: string): (offset: number) => number {
  const table = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    table[i] = bytes;
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (isHighSurrogate(code) && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      table[++i] = bytes;
    } else bytes += 3;
  }
  table[text.length] = bytes;
  return (offset) => table[offset];
}
