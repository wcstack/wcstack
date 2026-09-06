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
import { parseWcsScriptBlocks, type WcsScriptBlock } from './htmlParse.js';
import { WCS_PREAMBLE, WCS_PREAMBLE_LENGTH } from './preamble.js';

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
 * 末尾）を HTML のオフセットへ結ぶ。置き換えた `export default ` と挿入した記号は
 * 対応する HTML が無いので mapping を持たない。
 */
/** @internal テスト用にエクスポート */
export function buildCombinedScript(blocks: WcsScriptBlock[]): { code: string; mappings: CodeMapping[] } {
  let code = WCS_PREAMBLE;
  const mappings: CodeMapping[] = [];
  const map = (sourceOffset: number, generatedOffset: number, length: number): void => {
    if (length <= 0) return;
    mappings.push({ sourceOffsets: [sourceOffset], generatedOffsets: [generatedOffset], lengths: [length], data: fullFeatures });
  };

  // 1. import の巻き上げ
  const bodies = blocks.map((block) => {
    const stripped = stripWcsImport(block.content);
    const userCode = stripped.replace(IMPORT_STATEMENT_RE, (match: string, offset: number) => {
      map(block.contentStart + offset, code.length, match.length);
      code += match + '\n';
      return ' '.repeat(match.length);
    });
    return { block, userCode };
  });

  // 2. ブロックごとのスコープ
  bodies.forEach(({ block, userCode }, index) => {
    code += '{\n';
    const decl = `const __wcs_state_${index} = `;
    const exportMatch = /export\s+default\s+/.exec(userCode);
    if (exportMatch === null) {
      map(block.contentStart, code.length, userCode.length);
      code += userCode;
    } else {
      const before = userCode.slice(0, exportMatch.index);
      const afterExport = userCode.slice(exportMatch.index + exportMatch[0].length);
      const afterExportSource = block.contentStart + exportMatch.index + exportMatch[0].length;
      map(block.contentStart, code.length, before.length);
      code += before + decl;
      if (/\bdefineState\s*\(/.test(userCode)) {
        map(afterExportSource, code.length, afterExport.length);
        code += afterExport;
      } else {
        const trailingMatch = afterExport.match(/(\s*;?\s*)$/);
        const trailing = trailingMatch ? trailingMatch[0] : '';
        const objectPart = afterExport.slice(0, afterExport.length - trailing.length);
        code += 'defineState(';
        map(afterExportSource, code.length, objectPart.length);
        code += objectPart + ')';
        map(afterExportSource + objectPart.length, code.length, trailing.length);
        code += trailing;
      }
    }
    code += `\nvoid __wcs_state_${index};\n}\n`;
  });

  return { code, mappings };
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
  const userCode = stripWcsImport(block.content);
  const { code: wrappedCode, mappings } = wrapWithDefineState(userCode, block);

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
 * ラップ時もソースマッピングを正確に維持する。
 */
/** @internal テスト用にエクスポート */
export function wrapWithDefineState(
  userCode: string,
  block: WcsScriptBlock,
): { code: string; mappings: CodeMapping[] } {
  const alreadyWrapped = /\bdefineState\s*\(/.test(userCode);

  if (alreadyWrapped) {
    // defineState() 使用済み — プリアンブル + ユーザーコードをそのまま
    const code = WCS_PREAMBLE + userCode;
    return {
      code,
      mappings: [{
        sourceOffsets: [block.contentStart],
        generatedOffsets: [WCS_PREAMBLE_LENGTH],
        lengths: [block.content.length],
        data: fullFeatures,
      }],
    };
  }

  // `export default { ... }` を `export default defineState({ ... })` に変換
  //
  // 仮想コード構造:
  //   [PREAMBLE][before "export default "]["export default defineState("][object...][")"][after]
  //
  // マッピング: ユーザーコード全体を1つのマッピングで対応付ける。
  // "defineState(" と ")" は挿入されるが、ユーザーのカーソル位置には影響しない。
  const exportDefaultRe = /export\s+default\s+/;
  const match = exportDefaultRe.exec(userCode);

  if (!match) {
    // export default がない場合はそのまま
    const code = WCS_PREAMBLE + userCode;
    return {
      code,
      mappings: [{
        sourceOffsets: [block.contentStart],
        generatedOffsets: [WCS_PREAMBLE_LENGTH],
        lengths: [block.content.length],
        data: fullFeatures,
      }],
    };
  }

  const exportEnd = match.index + match[0].length;
  const before = userCode.slice(0, exportEnd);      // "export default "
  const after = userCode.slice(exportEnd);            // "{ ... };\n"

  // 末尾のセミコロン + 改行を分離して ")" をセミコロンの前に挿入
  const trailingMatch = after.match(/(\s*;?\s*)$/);
  const objectPart = trailingMatch
    ? after.slice(0, after.length - trailingMatch[0].length)
    : after;
  const trailing = trailingMatch ? trailingMatch[0] : '';

  const wrapPrefix = 'defineState(';
  const wrapSuffix = ')';

  const code = WCS_PREAMBLE + before + wrapPrefix + objectPart + wrapSuffix + trailing;

  // マッピング: 3つのセグメントに分割
  //   1. "export default " 部分（before）
  //   2. オブジェクト部分（objectPart） — defineState( の後ろ
  //   3. 末尾部分（trailing）
  const preambleLen = WCS_PREAMBLE_LENGTH;
  const mappings: CodeMapping[] = [{
    sourceOffsets: [
      block.contentStart,                             // before の HTML 開始位置
      block.contentStart + exportEnd,                 // objectPart の HTML 開始位置
      block.contentStart + exportEnd + objectPart.length,  // trailing の HTML 開始位置
    ],
    generatedOffsets: [
      preambleLen,                                    // before の仮想コード開始位置
      preambleLen + before.length + wrapPrefix.length, // objectPart の仮想コード開始位置
      preambleLen + before.length + wrapPrefix.length + objectPart.length + wrapSuffix.length, // trailing
    ],
    lengths: [
      before.length,
      objectPart.length,
      trailing.length,
    ],
    data: fullFeatures,
  }];

  return { code, mappings };
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
  // 改行だけでなく**文字数も**保つ（改行以外を空白に置換）。仮想コードの mapping は
  // ユーザーコードのオフセットをそのまま HTML へ結ぶので、ここで短くすると import 以降の
  // 診断位置が削った分だけ手前にずれる。
  return code.replace(
    /import\s*\{[^}]*\}\s*from\s*['"](?:@wcstack\/state|https?:\/\/[^'"]*\/@wcstack\/state(?:@[^'"/]*)?(?:\/[^'"]*)?)['"];?[ \t]*/g,
    (match) => match.replace(/[^\n]/g, ' ')
  );
}

/** HTML ルートの VirtualCode 型 */
type WcsHtmlVirtualCode = VirtualCode;
