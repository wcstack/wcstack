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
import { lastIndexOfOutsideQuotes } from '../core/parser/quoteAware.js';
import { getBindingContext } from './bindingContext.js';
import { getStatePathsFromHtml, type FileReader } from './statePathResolver.js';
import { validateDocument } from '../core/validateDocument.js';
import { createFileReaderForUri } from '../fileReader.js';
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
      // 診断メッセージ言語。既定は VS Code の表示言語（LSP initialize の locale）、
      // 取得できなければ en にフォールバック（CLI の決定則と同じ）。
      // wcstack.messageLanguage 設定（"ja" / "en"）が指定されていればそちらを優先。
      let messageLocale: string = context.env.locale ?? 'en';

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
          else messageLocale = context.env.locale ?? 'en';
        });
      };
      readConfig();
      context.env.onDidChangeConfiguration?.(readConfig);

      return {
        provideCompletionItems(document, position) {
          if (document.languageId !== 'html') return;

          const text = document.getText();
          const offset = document.offsetAt(position);
          // 外部 state（`<wcs-state src=...>`）のパスも補完候補に含める。診断だけ
          // 読んで補完が読まないと「警告は出るが候補は出ない」になるため両方に渡す。
          const fileReader = createFileReaderForUri(document.uri);

          // Mustache {{ }} 内のカーソルチェック
          const mustache = findMustacheAtOffset(text, offset);
          if (mustache) {
            return buildPathAndFilterCompletions(text, offset, mustache.expression, mustache.exprStart, stateTagName, fileReader);
          }

          // コメントバインディング <!--@@:expr--> 内のカーソルチェック
          const comment = findCommentBindingAtOffset(text, offset);
          if (comment) {
            return buildPathAndFilterCompletions(text, offset, comment.expression, comment.exprStart, stateTagName, fileReader);
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
              // 置換するのは**いま入力中の修飾子 1 個**だけ。修飾子リストは `#` のあと
              // カンマ区切り（`value#ro,wo`）なので、開始は「最後の `#` **または** `,` の次」。
              // `#` だけを見ていると 2 個目を補完したときに `#ro,w` ごと置換されて
              // `value#wo` になり、先に書いた `ro` が消える。
              // 探索は**その属性値の中**に限り、区切りは引用符の外だけ
              // （`value|defaults('#')` の引数から置換範囲を取ると、補完を選んだ瞬間に
              // その引数を壊すテキスト編集になる）。
              const beforeCursor = attrInfo.value.slice(0, cursorInAttr);
              const hashInValue = lastIndexOfOutsideQuotes(beforeCursor, '#');
              if (hashInValue === -1) return undefined;
              const commaInValue = lastIndexOfOutsideQuotes(beforeCursor, ',');
              const tokenStart = Math.max(hashInValue, commaInValue);
              const replaceStart = document.positionAt(attrInfo.valueStart + tokenStart + 1);
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
              const allPaths = getStatePathsFromHtml(text, stateTagName, fileReader);
              const isEvent = context.propName.startsWith('on');
              const isForValue = context.propName === 'for';
              const isCommandProp = context.propName.startsWith('command.');
              const isEventTokenProp = context.propName.startsWith('eventToken.');

              let pathCandidates = allPaths.slice();

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
                  p => p.kind !== 'method' && p.kind !== 'command' && p.kind !== 'eventToken'
                    // `**` はオーサリング層だけの記号（data-wcs には書けない）
                    && p.kind !== 'recursive' && p.kind !== 'recursionAnchor',
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
                      .filter(p => p.kind !== 'method' && p.kind !== 'list' && p.kind !== 'recursive' && p.kind !== 'recursionAnchor')
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

            default:
              return undefined;
          }
        },

        provideDiagnostics(document) {
          if (document.languageId !== 'html') return;

          // CI CLI と同じ validator core を呼ぶ(§7.1)。両者は同一 {code, range, severity}
          // を生成する。LSP Diagnostic の code 欄に stable code を転送する。
          const text = document.getText();
          // 外部 state（`<wcs-state src=...>`）も CLI と同じ reader で読む。
          // 渡さないと候補ゼロ → パス検証が丸ごと沈黙し、「IDE は無警告なのに
          // wcs-validate は落ちる」というパリティ破れになる（§7.1 の完了条件）。
          // file: 以外（untitled / 仮想 FS）は undefined ＝ 従来どおり沈黙。
          const fileReader = createFileReaderForUri(document.uri);
          const options = fileReader === undefined
            ? { bindAttribute: bindAttrName, stateTagName, locale: messageLocale }
            : { bindAttribute: bindAttrName, stateTagName, locale: messageLocale, fileReader };
          return validateDocument(text, options).map(d => ({
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
  fileReader?: FileReader,
) {
  const cursorInExpr = offset - exprStart;
  const textBeforeCursor = expression.slice(0, cursorInExpr);

  // `|` の後ならフィルタ補完。区切りは引用符の外だけ（bindingContext と同じ理由 —
  // 引数の中の `|` を区切りに数えると、その後ろをフィルタ名の入力中として補完してしまう）
  const lastPipeIndex = lastIndexOfOutsideQuotes(textBeforeCursor, '|');
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

  // `@` は v2 の parse error（名前次元は撤去）— 補完は出さない
  if (textBeforeCursor.indexOf('@') !== -1) return undefined;

  // パス補完（テキストバインディングなのでメソッド・トークン系は除外）
  const allPaths = getStatePathsFromHtml(html, stateTagName, fileReader);
  const pathCandidates = allPaths
    .filter(p => p.kind !== 'method' && p.kind !== 'command' && p.kind !== 'eventToken')
    .filter(p => p.kind !== 'recursive' && p.kind !== 'recursionAnchor');
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
