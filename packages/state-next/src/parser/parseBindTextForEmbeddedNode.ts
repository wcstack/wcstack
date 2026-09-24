import { parseStatePart } from "./parseStatePart";
import { ParsedBinding } from "./types";

/**
 * テキストバインディング（mustache / コメント `<!--@@: expr-->`）の式を解析する。
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
