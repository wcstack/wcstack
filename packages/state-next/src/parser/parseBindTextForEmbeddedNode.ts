import { parseStatePart } from "./parseStatePart";
import { ParsedBinding } from "./types";

/**
 * テキストバインディング（mustache `{{ expr }}`）の式を解析する。3.x のコメント束縛
 * `<!--@@: expr-->` は 4.0 のランタイムでは束ねない（暫定の判断。検出は lint／vscode-wcs の後続作業）。
 * 式全体が `path[|filters]` — `;` は**分割しない**（属性経路との規定差）。
 * Port of `@wcstack/state` `src/bindTextParser/parseBindTextForEmbeddedNode.ts`.
 */
export function parseBindTextForEmbeddedNode(bindText: string): ParsedBinding {
  const stateResult = parseStatePart(bindText);
  return {
    propName: 'textContent',
    propSegments: ['textContent'],
    propModifiers: [],
    inFilters: [],
    ...stateResult,
    bindingType: 'text',
  };
}
