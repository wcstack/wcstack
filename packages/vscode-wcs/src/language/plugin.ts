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
 * HTML 内の <wcs-state><script type="module"> を TypeScript 仮想コードとして提供する
 * Volar LanguagePlugin。
 */
export function createWcsLanguagePlugin(): LanguagePlugin<URI> {
  return {
    getLanguageId(uri) {
      const path = uri.path;
      if (path.endsWith('.html') || path.endsWith('.htm')) {
        return 'html';
      }
      return undefined;
    },

    createVirtualCode(uri, languageId, snapshot, _ctx) {
      if (languageId !== 'html') return undefined;
      const html = snapshot.getText(0, snapshot.getLength());
      const blocks = parseWcsScriptBlocks(html);
      if (blocks.length === 0) return undefined;
      return createWcsHtmlVirtualCode(blocks, html);
    },

    updateVirtualCode(uri, virtualCode, newSnapshot, _ctx) {
      const html = newSnapshot.getText(0, newSnapshot.getLength());
      const blocks = parseWcsScriptBlocks(html);
      if (blocks.length === 0) return undefined;
      return createWcsHtmlVirtualCode(blocks, html);
    },

    typescript: {
      extraFileExtensions: [
        { extension: 'html', isMixedContent: true, scriptKind: 7 /* ts.ScriptKind.Deferred */ },
      ],

      getServiceScript(_root) {
        // ルート（HTML自体）には TS サービスを提供しない。
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
 */
/** @internal テスト用にエクスポート */
export function stripWcsImport(code: string): string {
  return code.replace(
    /import\s*\{[^}]*\}\s*from\s*['"]@wcstack\/state['"];\s*/g,
    (match) => '\n'.repeat((match.match(/\n/g) || []).length)
  );
}

/** HTML ルートの VirtualCode 型 */
type WcsHtmlVirtualCode = VirtualCode;
