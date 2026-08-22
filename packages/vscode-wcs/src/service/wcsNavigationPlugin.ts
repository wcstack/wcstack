/**
 * wcsNavigationPlugin.ts
 *
 * hover / go-to-definition / find-references / inlay hint を提供する
 * Volar LanguageServicePlugin（static-wiring-dx-design.md §5-2 / §5-3）。
 *
 * 判断は全て core/navigation/wiringLens（referenceIndex へのクエリ）に置き、
 * このプラグインはドキュメントオフセット ⇔ LSP Position の変換だけを行う薄い
 * アダプタに保つ（validateDocument と wcsCompletionPlugin の分担と同型）。
 */

import type { LanguageServicePlugin, LanguageServicePluginInstance } from '@volar/language-service';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  getDefinitionAt,
  getHoverAt,
  getInlayHints,
  getReferencesAt,
  type IWiringLensOptions,
} from '../core/navigation/wiringLens.js';
import type { ITokenRange } from '../core/parser/positionalParser.js';

const DEFAULT_BIND_ATTR = 'data-wcs';

export function createWcsNavigationPlugin(): LanguageServicePlugin {
  return {
    name: 'wcs-navigation',
    capabilities: {
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      inlayHintProvider: {},
    },
    create(context): LanguageServicePluginInstance {
      let bindAttrName = DEFAULT_BIND_ATTR;
      let stateTagName = 'wcs-state';
      // hover 本文の言語。既定は VS Code の表示言語、wcstack.messageLanguage が優先
      // （wcsCompletionPlugin の診断メッセージと同じ決定則）。
      let messageLocale: string = context.env.locale ?? 'en';

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

      const optionsOf = (): IWiringLensOptions => ({
        bindAttribute: bindAttrName,
        stateTagName,
        locale: messageLocale,
      });

      const toLspRange = (document: TextDocument, range: ITokenRange) => ({
        start: document.positionAt(range.start),
        end: document.positionAt(range.end),
      });

      return {
        provideHover(document, position) {
          if (document.languageId !== 'html') return;
          const hover = getHoverAt(document.getText(), document.offsetAt(position), optionsOf());
          if (hover === null) return;
          return {
            contents: { kind: 'markdown' as const, value: hover.markdown },
            range: toLspRange(document, hover.range),
          };
        },

        provideDefinition(document, position) {
          if (document.languageId !== 'html') return;
          const definition = getDefinitionAt(document.getText(), document.offsetAt(position), optionsOf());
          if (definition === null) return;
          const targetRange = toLspRange(document, definition.targetRange);
          return [
            {
              targetUri: document.uri,
              targetRange,
              targetSelectionRange: targetRange,
              originSelectionRange: toLspRange(document, definition.originRange),
            },
          ];
        },

        provideReferences(document, position, referenceContext) {
          if (document.languageId !== 'html') return;
          const references = getReferencesAt(
            document.getText(),
            document.offsetAt(position),
            referenceContext.includeDeclaration,
            optionsOf(),
          );
          if (references === null) return;
          return references.map((reference) => ({
            uri: document.uri,
            range: toLspRange(document, reference.range),
          }));
        },

        provideInlayHints(document, range) {
          if (document.languageId !== 'html') return;
          const hints = getInlayHints(
            document.getText(),
            document.offsetAt(range.start),
            document.offsetAt(range.end),
            optionsOf(),
          );
          return hints.map((hint) => ({
            position: document.positionAt(hint.offset),
            label: hint.label,
            // 1 = InlayHintKind.Type（型情報系の淡色表示）
            kind: 1 as const,
            paddingLeft: true,
          }));
        },
      };
    },
  };
}
