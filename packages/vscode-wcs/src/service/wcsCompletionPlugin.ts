/**
 * wcsCompletionPlugin.ts
 *
 * data-wcs 属性内の補完を提供する Volar LanguageServicePlugin。
 * HTML ファイルの data-wcs 属性値にカーソルがある場合に、
 * プロパティ名、フィルタ名、イベント修飾子の補完候補を返す。
 */

import type { LanguageServicePlugin, LanguageServicePluginInstance } from '@volar/language-service';
import {
  BUILTIN_FILTERS,
  COMMON_PROPERTIES,
  PROPERTY_PREFIXES,
  SPECIAL_BINDINGS,
  STRUCTURAL_DIRECTIVES,
  COMMON_EVENTS,
  EVENT_MODIFIERS,
} from './completionData.js';
import { getBindingContext } from './bindingContext.js';
import { getStatePathsFromHtml } from './statePathResolver.js';
import { validateDocument } from '../core/validateDocument.js';
import { severityToLsp } from '../core/diagnostics.js';
import {
  findMustacheAtOffset,
  findCommentBindingAtOffset,
} from './templateSyntax.js';
import { isInsideForTemplate, getInnermostForPath } from './forContext.js';

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
      let stateTagName = 'wcs-state';
      // 診断メッセージ言語。既定は VS Code の表示言語（LSP initialize の locale）。
      // wcstack.messageLanguage 設定（"ja" / "en"）が指定されていればそちらを優先。
      let messageLocale: string | undefined = context.env.locale;

      // 設定から値を取得（変更時も追従）
      const readConfig = () => {
        context.env.getConfiguration?.<string>('wcstack.bindAttributeName').then(v => {
          if (v) bindAttrName = v;
        });
        context.env.getConfiguration?.<string>('wcstack.stateTagName').then(v => {
          if (v) stateTagName = v;
        });
        context.env.getConfiguration?.<string>('wcstack.messageLanguage').then(v => {
          if (v === 'ja' || v === 'en') messageLocale = v;
          else messageLocale = context.env.locale;
        });
      };
      readConfig();
      context.env.onDidChangeConfiguration?.(readConfig);

      return {
        provideCompletionItems(document, position) {
          if (document.languageId !== 'html') return;

          const text = document.getText();
          const offset = document.offsetAt(position);

          // Mustache {{ }} 内のカーソルチェック
          const mustache = findMustacheAtOffset(text, offset);
          if (mustache) {
            return buildPathAndFilterCompletions(text, offset, mustache.expression, mustache.exprStart, stateTagName, null);
          }

          // コメントバインディング <!--@@:expr--> 内のカーソルチェック
          const comment = findCommentBindingAtOffset(text, offset);
          if (comment) {
            return buildPathAndFilterCompletions(text, offset, comment.expression, comment.exprStart, stateTagName, null);
          }

          // 属性値内にカーソルがあるか判定
          const attrInfo = findBindAttribute(text, offset, bindAttrName);
          if (!attrInfo) return;

          const cursorInAttr = offset - attrInfo.valueStart;
          const context = getBindingContext(attrInfo.value, cursorInAttr);
          const insideFor = isInsideForTemplate(text, offset, bindAttrName);

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
                  ...SPECIAL_BINDINGS.map(p => ({
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
              const allPaths = getStatePathsFromHtml(text, stateTagName);
              const targetStateName = context.targetState || 'default';
              const isEvent = context.propName.startsWith('on');
              const isForValue = context.propName === 'for';
              const isCommandProp = context.propName.startsWith('command.');
              const isEventTokenProp = context.propName.startsWith('eventToken.');

              let pathCandidates = allPaths.filter(p => p.stateName === targetStateName);

              if (isCommandProp) {
                // command.<method>: の右辺は $command.<name> のみ
                pathCandidates = pathCandidates.filter(p => p.kind === 'command');
              } else if (isEventTokenProp) {
                // eventToken.<prop>: の右辺は $eventTokens 宣言名のみ
                pathCandidates = pathCandidates.filter(p => p.kind === 'eventToken');
              } else if (isEvent) {
                // イベントハンドラ: メソッドと $command.<name> を表示
                pathCandidates = pathCandidates.filter(p => p.kind === 'method' || p.kind === 'command');
              } else if (isForValue) {
                // for: の値: 配列型のみ表示
                pathCandidates = pathCandidates.filter(p => p.typeHint === 'array');
              } else {
                // データバインディング: メソッド・トークン系を除外
                pathCandidates = pathCandidates.filter(
                  p => p.kind !== 'method' && p.kind !== 'command' && p.kind !== 'eventToken',
                );
                if (!insideFor) {
                  // for 外: パターンパス（* 含む）を除外
                  pathCandidates = pathCandidates.filter(p => !p.path.includes('*'));
                }
              }

              // for 内のショートハンド候補を生成
              const shorthandItems: any[] = [];
              if (insideFor && !isEvent && !isForValue) {
                const forPath = getInnermostForPath(text, offset, bindAttrName);
                if (forPath) {
                  const expandedPrefix = forPath.startsWith('.')
                    ? null
                    : `${forPath}.*.`;

                  if (expandedPrefix) {
                    // partial が "." で始まる場合、"." の位置から置換する textEdit を生成
                    const partial = context.partial;
                    const dotOffset = partial.startsWith('.')
                      ? offset - partial.length
                      : offset;
                    const replaceStart = document.positionAt(dotOffset);

                    const shorthandCandidates = allPaths
                      .filter(p => p.stateName === targetStateName)
                      .filter(p => p.kind !== 'method' && p.kind !== 'list')
                      .filter(p => p.path.startsWith(expandedPrefix));

                    for (const p of shorthandCandidates) {
                      const shortPath = '.' + p.path.slice(expandedPrefix.length);
                      shorthandItems.push({
                        label: shortPath,
                        kind: p.kind === 'computed' ? 10 as const : 6 as const,
                        detail: [
                          `→ ${p.path}`,
                          p.typeHint ? `(${p.typeHint})` : '',
                          p.kind === 'computed' ? 'computed' : '',
                        ].filter(Boolean).join(' '),
                        sortText: `0_${shortPath}`,
                        filterText: shortPath,
                        textEdit: {
                          range: { start: replaceStart, end: position },
                          newText: shortPath,
                        },
                      });
                    }
                  }
                }
              }

              const items: any[] = pathCandidates.map(p => ({
                label: p.path,
                kind: (p.kind === 'method'     ? 2
                    : p.kind === 'computed'   ? 10
                    : p.kind === 'list'       ? 18
                    : p.kind === 'command'    ? 3
                    : p.kind === 'eventToken' ? 23
                    :                            6) as 2 | 3 | 6 | 10 | 18 | 23,
                detail: [
                  p.typeHint ? `(${p.typeHint})` : '',
                  p.kind === 'computed' ? 'computed' : '',
                  p.kind === 'list' ? 'list' : '',
                  p.kind === 'method' ? 'method' : '',
                  p.kind === 'command' ? 'command token' : '',
                  p.kind === 'eventToken' ? 'event token' : '',
                ].filter(Boolean).join(' ') || undefined,
                sortText: `1_${p.path}`,
              }));

              const allItems = [...shorthandItems, ...items];
              if (allItems.length === 0) return undefined;

              return {
                isIncomplete: false,
                items: allItems,
              };
            }

            case 'stateName': {
              // 定義済み state 名の補完
              const allPaths = getStatePathsFromHtml(text, stateTagName);
              const stateNames = [...new Set(allPaths.map(p => p.stateName))];
              if (stateNames.length === 0) return undefined;

              return {
                isIncomplete: false,
                items: stateNames.map(name => ({
                  label: name,
                  kind: 9 as const, // Module
                  detail: 'state name',
                })),
              };
            }

            default:
              return undefined;
          }
        },

        provideDiagnostics(document) {
          if (document.languageId !== 'html') return;

          // CI CLI と同じ validator core を呼ぶ(§7.1)。両者は同一 {code, range, severity}
          // を生成する。LSP Diagnostic の code 欄に stable code を転送する。
          const text = document.getText();
          return validateDocument(text, { bindAttribute: bindAttrName, stateTagName, locale: messageLocale }).map(d => ({
            range: {
              start: document.positionAt(d.start),
              end: document.positionAt(d.end),
            },
            code: d.code,
            message: d.message,
            severity: severityToLsp(d.severity),
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
 * Mustache / コメント構文用のパス・フィルタ補完を生成する。
 * 式内のカーソル位置に応じて適切な補完候補を返す。
 */
function buildPathAndFilterCompletions(
  html: string,
  offset: number,
  expression: string,
  exprStart: number,
  stateTagName: string,
  targetState: string | null,
) {
  const cursorInExpr = offset - exprStart;
  const textBeforeCursor = expression.slice(0, cursorInExpr);

  // `|` の後ならフィルタ補完
  const lastPipeIndex = textBeforeCursor.lastIndexOf('|');
  if (lastPipeIndex !== -1) {
    const filterPart = textBeforeCursor.slice(lastPipeIndex + 1).trimStart();
    if (filterPart.includes('(') && !filterPart.includes(')')) {
      return undefined; // フィルタ引数内
    }
    return {
      isIncomplete: false,
      items: BUILTIN_FILTERS.map(f => ({
        label: f.name,
        kind: 3 as const,
        detail: f.description,
        insertText: f.hasArgs ? `${f.name}($1)` : f.name,
        insertTextFormat: f.hasArgs ? 2 as const : 1 as const,
        sortText: f.name,
      })),
    };
  }

  // `@` の後なら state 名補完
  const atIndex = textBeforeCursor.indexOf('@');
  if (atIndex !== -1) {
    const allPaths = getStatePathsFromHtml(html, stateTagName);
    const stateNames = [...new Set(allPaths.map(p => p.stateName))];
    return {
      isIncomplete: false,
      items: stateNames.map(name => ({
        label: name,
        kind: 9 as const,
        detail: 'state name',
      })),
    };
  }

  // パス補完（テキストバインディングなのでメソッド・トークン系は除外）
  const allPaths = getStatePathsFromHtml(html, stateTagName);
  const targetStateName = targetState || 'default';
  const pathCandidates = allPaths
    .filter(p => p.kind !== 'method' && p.kind !== 'command' && p.kind !== 'eventToken')
    .filter(p => p.stateName === targetStateName);
  if (pathCandidates.length === 0) return undefined;

  return {
    isIncomplete: false,
    items: pathCandidates.map(p => ({
      label: p.path,
      kind: p.kind === 'computed' ? 10 as const
          : p.kind === 'list'     ? 18 as const
          :                          6 as const,
      detail: [
        p.typeHint ? `(${p.typeHint})` : '',
        p.kind === 'computed' ? 'computed' : '',
        p.kind === 'list' ? 'list' : '',
      ].filter(Boolean).join(' ') || undefined,
      sortText: p.path,
    })),
  };
}
