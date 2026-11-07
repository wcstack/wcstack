/**
 * plugin.ts
 *
 * Volar LanguagePlugin の実装。
 * HTML ファイルを解析し、<wcs-state> 内の <script type="module"> を
 * TypeScript の仮想コードとして抽出する。
 */

import type {
  LanguagePlugin,
  VirtualCode,
  IScriptSnapshot,
  CodeMapping,
  CodeInformation,
} from '@volar/language-core';
import type { TypeScriptExtraServiceScript } from '@volar/typescript';
import { URI } from 'vscode-uri';
import { GETTER_RETURN_ANNOTATION, getterAnnotationOffsets } from './getterAnnotations.js';
import { parseWcsScriptBlocks, type WcsScriptBlock } from './htmlParse.js';
import { WCS_PREAMBLE } from './preamble.js';

/** 全 Language Feature を有効にする CodeInformation */
const fullFeatures: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: true,
};

/**
 * スクリプト識別子からパスを取り出す。Language Server は `URI`（`uri.path`）で、
 * `@volar/typescript` の `runTsc`（`wcs-tsc`）はファイルパス文字列で呼ぶ。両者で
 * 同じプラグインを使うことが IDE / CLI パリティの前提（docs/typescript.md §4）。
 */
function pathOfScriptId(id: URI | string): string {
  return typeof id === 'string' ? id : id.path;
}

export interface WcsLanguagePluginOptions {
  /**
   * - `language-server`（既定）: 各 `<wcs-state>` ブロックを別々の TS サービススクリプト
   *   （`getExtraServiceScripts`）として提供する。VS Code / Language Server 用。
   * - `tsc`: `@volar/typescript` の `runTsc`（`wcs-tsc`）用。proxyCreateProgram は
   *   `getExtraServiceScripts` を提供せず **1 ファイル 1 サービススクリプト**しか扱えない
   *   ので、全ブロックを 1 本の TS に合成して `getServiceScript` で返す
   *   （docs/typescript.md §4）。診断の range は合成コードの mapping で HTML へ戻る。
   */
  readonly mode?: 'language-server' | 'tsc';
}

/**
 * HTML 内の <wcs-state><script type="module"> を TypeScript 仮想コードとして提供する
 * Volar LanguagePlugin。識別子は `URI`（Language Server）と `string`（runTsc）の両方。
 */
export function createWcsLanguagePlugin(
  stateTagName: string = 'wcs-state',
  options: WcsLanguagePluginOptions = {},
): LanguagePlugin<URI | string> {
  const tscMode = options.mode === 'tsc';
  const build = (html: string): WcsHtmlVirtualCode | undefined => {
    const blocks = parseWcsScriptBlocks(html, stateTagName);
    // tsc モードは <wcs-state> のブロックが無いページにも**空の**仮想コードを返す。
    // undefined を返すと `.html` が登録済み拡張子として素の TS ソースに読まれ、
    // マークアップ全体が構文エラーになる（Language Server は undefined でよい —
    // そこでは HTML は HTML のまま）。
    if (blocks.length === 0) return tscMode ? createWcsHtmlVirtualCodeForTsc([], html) : undefined;
    return tscMode ? createWcsHtmlVirtualCodeForTsc(blocks, html) : createWcsHtmlVirtualCode(blocks, html);
  };
  return {
    getLanguageId(id) {
      const path = pathOfScriptId(id);
      if (path.endsWith('.html') || path.endsWith('.htm')) {
        return 'html';
      }
      return undefined;
    },

    createVirtualCode(_id, languageId, snapshot, _ctx) {
      if (languageId !== 'html') return undefined;
      return build(snapshot.getText(0, snapshot.getLength()));
    },

    updateVirtualCode(_id, _virtualCode, newSnapshot, _ctx) {
      return build(newSnapshot.getText(0, newSnapshot.getLength()));
    },

    typescript: tscMode
      ? {
          extraFileExtensions: [
            { extension: 'html', isMixedContent: true, scriptKind: 7 /* ts.ScriptKind.Deferred */ },
          ],
          // tsc: 合成スクリプト 1 本をこのファイルのサービススクリプトにする。
          // getExtraServiceScripts は**定義しない** — proxyCreateProgram は存在するだけで
          // 「not available in this use case」を出力する。
          getServiceScript(root) {
            const combined = root.embeddedCodes?.find((code) => code.id === COMBINED_SCRIPT_ID);
            if (combined === undefined) return undefined;
            return { code: combined, extension: '.ts', scriptKind: 3 /* ts.ScriptKind.TS */ };
          },
        }
      : {
          extraFileExtensions: [
            { extension: 'html', isMixedContent: true, scriptKind: 7 /* ts.ScriptKind.Deferred */ },
          ],

          getServiceScript(_root) {
            // Language Server: ルート（HTML自体）には TS サービスを提供しない。
            // 埋め込みスクリプトは getExtraServiceScripts で提供する。
            return undefined;
          },

          getExtraServiceScripts(fileName, root) {
            const scripts: TypeScriptExtraServiceScript[] = [];
            for (const embedded of root.embeddedCodes ?? []) {
              if (embedded.id.startsWith('wcs-script-')) {
                scripts.push({
                  fileName: fileName + '.__' + embedded.id + '.ts',
                  code: embedded,
                  extension: '.ts',
                  scriptKind: 3, // ts.ScriptKind.TS
                });
              }
            }
            return scripts;
          },
        },
  };
}

/** tsc モードの合成スクリプトの embedded code id。 */
export const COMBINED_SCRIPT_ID = 'wcs-combined';

function createWcsHtmlVirtualCodeForTsc(blocks: WcsScriptBlock[], html: string): WcsHtmlVirtualCode {
  // ブロック無し = 空のスクリプト（プリアンブルすら要らない）。tsc には「型エラーの無い空の
  // モジュール」として見え、マークアップは一切読まれない。
  const { code, mappings } = blocks.length === 0 ? { code: '', mappings: [] as CodeMapping[] } : buildCombinedScript(blocks);
  const combined: VirtualCode = {
    id: COMBINED_SCRIPT_ID,
    languageId: 'typescript',
    snapshot: {
      getText(start, end) { return code.slice(start, end); },
      getLength() { return code.length; },
      getChangeRange() { return undefined; },
    },
    mappings,
  };
  return {
    id: 'root',
    languageId: 'html',
    snapshot: {
      getText(start, end) { return html.slice(start, end); },
      getLength() { return html.length; },
      getChangeRange() { return undefined; },
    },
    mappings: [{
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [html.length],
      data: htmlFeatures,
    }],
    embeddedCodes: [combined],
  };
}

/** `import ... from "x";` / `import "x";`（複数行可）。巻き上げ対象。 */
const IMPORT_STATEMENT_RE = /import\s+(?:[\s\S]*?\sfrom\s*)?['"][^'"]+['"]\s*;?/g;

/**
 * tsc モード: 全 `<wcs-state>` ブロックを 1 本の TS モジュールに合成する。
 *
 *   [WCS_PREAMBLE]（1 回）
 *   [各ブロックから巻き上げた import 文]（top-level にしか書けないため）
 *   { const __wcs_state_0 = defineState({ ... }); void __wcs_state_0; }
 *   { const __wcs_state_1 = ...; }
 *
 * ブロックをブロックスコープに包むので、複数の state が同名の const / function を
 * 持っても衝突しない。`export default` は 1 モジュールに 1 つしか置けないので
 * `const __wcs_state_N =` に置き換える（プリアンブルの defineState でラップ）。
 * 巻き上げた import の元位置は同じ長さの空白にして、ブロック内のオフセットを保つ。
 * mapping はユーザーコードの各断片（import・export default より前・オブジェクト・
 * 末尾）を HTML のオフセットへ結ぶ。置き換えた `export default ` と挿入した記号
 * （getter の `: any` も）は対応する HTML が無いので mapping を持たない。空白にした
 * import（`@wcstack/state` の import と巻き上げた元位置）も結ばない。
 */
/** @internal テスト用にエクスポート */
export function buildCombinedScript(blocks: WcsScriptBlock[]): { code: string; mappings: CodeMapping[] } {
  const out = new VirtualCodeBuilder(WCS_PREAMBLE);

  // 1. import の巻き上げ
  const bodies = blocks.map((block) => {
    const { code: stripped, blanks } = stripWcsImportRanges(block.content);
    const gaps: BlankRange[] = [...blanks];
    const userCode = stripped.replace(IMPORT_STATEMENT_RE, (match: string, offset: number) => {
      out.user(stripped, offset, offset + match.length, block.contentStart);
      out.text('\n');
      gaps.push([offset, offset + match.length]);
      return ' '.repeat(match.length);
    });
    gaps.sort((a, b) => a[0] - b[0]);
    return { block, userCode, gaps };
  });

  // 2. ブロックごとのスコープ
  bodies.forEach(({ block, userCode, gaps }, index) => {
    const annotations = getterAnnotationOffsets(userCode);
    const user = (from: number, to: number): void => out.user(userCode, from, to, block.contentStart, annotations, gaps);
    out.text('{\n');
    const exportMatch = /export\s+default\s+/.exec(userCode);
    if (exportMatch === null) {
      user(0, userCode.length);
    } else {
      const exportEnd = exportMatch.index + exportMatch[0].length;
      user(0, exportMatch.index);
      out.text(`const __wcs_state_${index} = `);
      if (/\bdefineState\s*\(/.test(userCode)) {
        user(exportEnd, userCode.length);
      } else {
        const objectEnd = userCode.length - trailingLength(userCode.slice(exportEnd));
        out.text('defineState(');
        user(exportEnd, objectEnd);
        out.text(')');
        user(objectEnd, userCode.length);
      }
    }
    out.text(`\nvoid __wcs_state_${index};\n}\n`);
  });

  return { code: out.code, mappings: out.mappings };
}

/**
 * 仮想コードの組み立て: 挿入する記号（mapping 無し）と、HTML へ戻るユーザーコードの断片。
 * ユーザーコードの断片は、getter の注釈（getterAnnotations.ts）を挟む位置で分けて結ぶ。
 * どの mapping も、生成側と HTML 側のテキストが一致する。
 */
class VirtualCodeBuilder {
  code: string;
  readonly mappings: CodeMapping[] = [];

  constructor(prefix: string) {
    this.code = prefix;
  }

  /** HTML に対応の無い記号。 */
  text(text: string): void {
    this.code += text;
  }

  /**
   * `userCode.slice(from, to)` を足し、`sourceStart + from` から HTML へ結ぶ。
   * `annotations` のうち範囲内のオフセットの前に `GETTER_RETURN_ANNOTATION` を挟む。
   * `gaps`（空白にした区間）はテキストだけ足し、結ばない。
   */
  user(
    userCode: string,
    from: number,
    to: number,
    sourceStart: number,
    annotations: readonly number[] = [],
    gaps: readonly BlankRange[] = [],
  ): void {
    let at = from;
    for (const offset of annotations) {
      if (offset < from || offset >= to) continue;
      this.piece(userCode, at, offset, sourceStart, gaps);
      this.code += GETTER_RETURN_ANNOTATION;
      at = offset;
    }
    this.piece(userCode, at, to, sourceStart, gaps);
  }

  private piece(userCode: string, from: number, to: number, sourceStart: number, gaps: readonly BlankRange[]): void {
    let at = from;
    for (const [gapStart, gapEnd] of gaps) {
      if (gapEnd <= at || gapStart >= to) continue;
      this.mapped(userCode, at, Math.max(at, gapStart), sourceStart);
      const end = Math.min(to, gapEnd);
      this.code += userCode.slice(Math.max(at, gapStart), end);
      at = end;
    }
    this.mapped(userCode, at, to, sourceStart);
  }

  private mapped(userCode: string, from: number, to: number, sourceStart: number): void {
    if (to <= from) return;
    this.mappings.push({ sourceOffsets: [sourceStart + from], generatedOffsets: [this.code.length], lengths: [to - from], data: fullFeatures });
    this.code += userCode.slice(from, to);
  }
}

/** `export default` の後ろの、オブジェクトに続く末尾（空白・`;`）の長さ。`)` はその前に挿入する。 */
function trailingLength(afterExport: string): number {
  return /(\s*;?\s*)$/.exec(afterExport)?.[0].length ?? 0;
}

/**
 * HTML ファイル全体を表す VirtualCode を生成する。
 * embeddedCodes に各スクリプトブロックの VirtualCode を持つ。
 */
/** HTML ルート用の CodeInformation（補完 + 診断を有効化） */
const htmlFeatures: CodeInformation = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: false,
  format: false,
};

function createWcsHtmlVirtualCode(blocks: WcsScriptBlock[], html: string): WcsHtmlVirtualCode {
  const embeddedCodes: VirtualCode[] = blocks.map((block, index) =>
    createScriptVirtualCode(block, index)
  );

  return {
    id: 'root',
    languageId: 'html',
    snapshot: {
      getText(start, end) { return html.slice(start, end); },
      getLength() { return html.length; },
      getChangeRange() { return undefined; },
    },
    mappings: [{
      sourceOffsets: [0],
      generatedOffsets: [0],
      lengths: [html.length],
      data: htmlFeatures,
    }],
    embeddedCodes,
  };
}

/**
 * 単一の <script type="module"> ブロックに対する VirtualCode を生成する。
 *
 * 仮想コードの構造:
 *   [WCS_PREAMBLE (型定義・defineState)] + [ユーザーのスクリプト内容]
 *
 * ソースマッピングはユーザーコード部分のみに適用。
 * プリアンブル部分は HTML ソースへのマッピングを持たない（診断は表示されない）。
 */
function createScriptVirtualCode(block: WcsScriptBlock, index: number): VirtualCode {
  const { code: userCode, blanks } = stripWcsImportRanges(block.content);
  const { code: wrappedCode, mappings } = wrapWithDefineState(userCode, block, blanks);

  return {
    id: `wcs-script-${index}`,
    languageId: 'typescript',
    snapshot: {
      getText(start, end) { return wrappedCode.slice(start, end); },
      getLength() { return wrappedCode.length; },
      getChangeRange() { return undefined; },
    },
    mappings,
  };
}

/**
 * `export default { ... }` を `export default defineState({ ... })` に自動ラップする。
 *
 * ユーザーが既に defineState() を使用している場合はそのまま。
 * `this` を読む getter には戻り値の注釈 `: any` を挟む（getterAnnotations.ts）。
 * ラップ時も注釈を挟んでもソースマッピングを正確に維持する。
 * `gaps`（空白にした import）は HTML へ結ばない。
 */
/** @internal テスト用にエクスポート */
export function wrapWithDefineState(
  userCode: string,
  block: WcsScriptBlock,
  gaps: readonly BlankRange[] = [],
): { code: string; mappings: CodeMapping[] } {
  const out = new VirtualCodeBuilder(WCS_PREAMBLE);
  const annotations = getterAnnotationOffsets(userCode);
  const user = (from: number, to: number): void => out.user(userCode, from, to, block.contentStart, annotations, gaps);

  // defineState() 使用済み、または export default が無い — プリアンブル + ユーザーコードをそのまま
  const match = /\bdefineState\s*\(/.test(userCode) ? null : /export\s+default\s+/.exec(userCode);
  if (match === null) {
    user(0, userCode.length);
    return { code: out.code, mappings: out.mappings };
  }

  // `export default { ... }` を `export default defineState({ ... })` に変換
  //
  // 仮想コード構造:
  //   [PREAMBLE]["export default "]["defineState("][object...][")"][末尾の ; と改行]
  //
  // "defineState(" と ")" は挿入されるが、ユーザーのカーソル位置には影響しない。
  const exportEnd = match.index + match[0].length;
  const objectEnd = userCode.length - trailingLength(userCode.slice(exportEnd));
  user(0, exportEnd);
  out.text('defineState(');
  user(exportEnd, objectEnd);
  out.text(')');
  user(objectEnd, userCode.length);
  return { code: out.code, mappings: out.mappings };
}

/**
 * @wcstack/state の import 文を空行に置換する（同じ行数を維持）。
 * プリアンブルが defineState を提供するため、import は不要。
 * 行数を維持することでソースマッピングのオフセットを保持する。
 *
 * bare 指定（`@wcstack/state`）に加え、CDN の URL 指定
 * （`https://esm.run/@wcstack/state`、`https://cdn.jsdelivr.net/npm/@wcstack/state@1.32.0/+esm`
 * 等 — `@wcstack/state` の後ろに `@version` / `/path` / `?query` が続く形）も剥がす。
 * buildless なページは URL でしか import できず、剥がさないと tsc / IDE で TS2307
 * （モジュールが見つからない）になる。
 */
/** @internal テスト用にエクスポート */
export function stripWcsImport(code: string): string {
  return stripWcsImportRanges(code).code;
}

/** 空白にした区間 `[start, end)`。ユーザーコードのオフセット。 */
export type BlankRange = readonly [start: number, end: number];

/**
 * `stripWcsImport` と同じ置換をし、空白にした区間も返す。空白にした区間はもう元の
 * テキストと一致しないので、仮想コードはそこを HTML へ結ばない（隙間にする）—
 * content mapper の `Verbatim` の範囲は元のテキストとの一致を求める
 * （docs/typescript-content-mapper.md §4.2）。
 */
export function stripWcsImportRanges(code: string): { code: string; blanks: BlankRange[] } {
  // 改行だけでなく**文字数も**保つ（改行以外を空白に置換）。仮想コードの mapping は
  // ユーザーコードのオフセットをそのまま HTML へ結ぶので、ここで短くすると import 以降の
  // 診断位置が削った分だけ手前にずれる。
  const blanks: BlankRange[] = [];
  const stripped = code.replace(
    /import\s*\{[^}]*\}\s*from\s*['"](?:@wcstack\/state|https?:\/\/[^'"]*\/@wcstack\/state(?:@[^'"/]*)?(?:\/[^'"]*)?)['"];?[ \t]*/g,
    (match: string, offset: number) => {
      blanks.push([offset, offset + match.length]);
      return match.replace(/[^\n]/g, ' ');
    }
  );
  return { code: stripped, blanks };
}

/** HTML ルートの VirtualCode 型 */
type WcsHtmlVirtualCode = VirtualCode;
