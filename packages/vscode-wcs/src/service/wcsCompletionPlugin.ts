/**
 * wcsCompletionPlugin.ts
 *
 * data-wcs 属性内の補完を提供する Volar LanguageServicePlugin。
 * HTML ファイルの data-wcs 属性値にカーソルがある場合に、
 * プロパティ名、フィルタ名、イベント修飾子の補完候補を返す。
 */

import type { LanguageServicePlugin, LanguageServicePluginInstance, LanguageServiceContext } from '@volar/language-service';
import {
  BUILTIN_FILTERS,
  COMMON_PROPERTIES,
  PROPERTY_PREFIXES,
  STRUCTURAL_DIRECTIVES,
  COMMON_EVENTS,
  EVENT_MODIFIERS,
} from './completionData.js';
import { getBindingContext } from './bindingContext.js';
import { analyzeStatePaths } from './stateAnalyzer.js';
import { parseWcsScriptBlocks } from '../language/htmlParse.js';
import { validateBindings } from './bindingValidator.js';
import { validateStateTypes } from './stateTypeValidator.js';

/** data-wcs 属性の補完を提供する LanguageServicePlugin */
export function createWcsCompletionPlugin(): LanguageServicePlugin {
  return {
    name: 'wcs-completion',
    capabilities: {
      completionProvider: {
        triggerCharacters: [':', '|', ';', '.', '#', ' '],
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
    create(context): LanguageServicePluginInstance {
      let bindAttrName = DEFAULT_BIND_ATTR;

      // 設定から bindAttributeName を取得（変更時も追従）
      context.env.getConfiguration?.<string>('wcstack.bindAttributeName').then(v => {
        if (v) bindAttrName = v;
      });
      context.env.onDidChangeConfiguration?.(() => {
        context.env.getConfiguration?.<string>('wcstack.bindAttributeName').then(v => {
          if (v) bindAttrName = v;
        });
      });

      return {
        provideCompletionItems(document, position) {
          if (document.languageId !== 'html') return;

          const text = document.getText();
          const offset = document.offsetAt(position);

          // 属性値内にカーソルがあるか判定
          const attrInfo = findBindAttribute(text, offset, bindAttrName);
          if (!attrInfo) return;

          const cursorInAttr = offset - attrInfo.valueStart;
          const context = getBindingContext(attrInfo.value, cursorInAttr);

          switch (context.kind) {
            case 'property':
              return {
                isIncomplete: false,
                items: [
                  ...COMMON_PROPERTIES.map(p => ({
                    label: p.name,
                    kind: 10 as const, // Property
                    detail: p.description,
                    insertText: p.insertColon ? `${p.name}: ` : p.name,
                    sortText: `0_${p.name}`,
                  })),
                  ...PROPERTY_PREFIXES.map(p => ({
                    label: p.name,
                    kind: 10 as const,
                    detail: p.description,
                    insertText: p.name,
                    sortText: `1_${p.name}`,
                  })),
                  ...STRUCTURAL_DIRECTIVES.map(p => ({
                    label: p.name,
                    kind: 14 as const, // Keyword
                    detail: p.description,
                    insertText: p.insertColon ? `${p.name}: ` : p.name,
                    sortText: `2_${p.name}`,
                  })),
                  ...COMMON_EVENTS.map(p => ({
                    label: p.name,
                    kind: 23 as const, // Event
                    detail: p.description,
                    insertText: p.insertColon ? `${p.name}: ` : p.name,
                    sortText: `3_${p.name}`,
                  })),
                ],
              };

            case 'modifier': {
              // '#' 以降のテキストを置換する範囲を計算
              const hashOffset = text.lastIndexOf('#', offset - 1);
              if (hashOffset === -1) return undefined;
              const replaceStart = document.positionAt(hashOffset + 1);
              return {
                isIncomplete: false,
                items: EVENT_MODIFIERS.map(m => ({
                  label: m.name,
                  kind: 20 as const, // EnumMember
                  detail: m.description,
                  filterText: m.name,
                  textEdit: {
                    range: { start: replaceStart, end: position },
                    newText: m.name,
                  },
                })),
              };
            }

            case 'filter':
              // イベントハンドラにフィルタは不要
              if (context.propName.startsWith('on')) return undefined;
              return {
                isIncomplete: false,
                items: BUILTIN_FILTERS.map(f => ({
                  label: f.name,
                  kind: 3 as const, // Function
                  detail: f.description,
                  insertText: f.hasArgs ? `${f.name}($1)` : f.name,
                  insertTextFormat: f.hasArgs ? 2 : 1, // Snippet : PlainText
                  sortText: f.name,
                })),
              };

            case 'path': {
              // <wcs-state> のスクリプトから状態構造を解析してパス候補を生成
              // メソッドは補完候補には出さない（検証用のみ）
              const pathCandidates = getStatePathsFromHtml(text).filter(p => p.kind !== 'method');
              if (pathCandidates.length === 0) return undefined;

              return {
                isIncomplete: false,
                items: pathCandidates.map(p => ({
                  label: p.path,
                  kind: p.kind === 'computed' ? 10 as const   // Property
                      : p.kind === 'list'     ? 18 as const   // Folder
                      :                          6 as const,   // Variable
                  detail: [
                    p.typeHint ? `(${p.typeHint})` : '',
                    p.kind === 'computed' ? 'computed' : '',
                    p.kind === 'list' ? 'list' : '',
                  ].filter(Boolean).join(' ') || undefined,
                  sortText: p.path,
                })),
              };
            }

            default:
              return undefined;
          }
        },

        provideDiagnostics(document) {
          if (document.languageId !== 'html') return;

          const text = document.getText();
          const bindingDiags = validateBindings(text, bindAttrName);
          const stateTypeDiags = validateStateTypes(text);

          return [...bindingDiags, ...stateTypeDiags].map(d => ({
            range: {
              start: document.positionAt(d.start),
              end: document.positionAt(d.end),
            },
            message: d.message,
            severity: d.severity === 'error' ? 1 : d.severity === 'warning' ? 2 : 3,
            source: 'wcstack',
          }));
        },
      };
    },
  };
}

// ============================================================
// HTML 解析ヘルパー
// ============================================================

const DEFAULT_BIND_ATTR = 'data-wcs';

interface BindAttrInfo {
  /** 属性値のテキスト（引用符の中身） */
  value: string;
  /** 属性値の開始オフセット（引用符の直後） */
  valueStart: number;
}

/**
 * 指定オフセットがバインド属性値の内部にあるかを判定し、
 * 属性値の情報を返す。
 *
 * @param attrName - 属性名（例: "data-wcs", "data-bind"）
 */
function findBindAttribute(html: string, offset: number, attrName: string): BindAttrInfo | null {
  const searchStart = Math.max(0, offset - 2000);
  const searchRegion = html.slice(searchStart, offset + 500);
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*=\\s*(["'])`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(searchRegion)) !== null) {
    const quote = match[1];
    const valueStart = searchStart + match.index + match[0].length;
    const valueEnd = html.indexOf(quote, valueStart);
    if (valueEnd === -1) continue;

    if (offset >= valueStart && offset <= valueEnd) {
      return {
        value: html.slice(valueStart, valueEnd),
        valueStart,
      };
    }
  }

  return null;
}

/**
 * HTML 全体から <wcs-state> のスクリプトを解析し、パス候補を収集する。
 * 複数の <wcs-state> がある場合は全てのパスをマージする。
 */
function getStatePathsFromHtml(html: string) {
  const blocks = parseWcsScriptBlocks(html);
  const allPaths = blocks.flatMap(block => analyzeStatePaths(block.content));
  return allPaths;
}
