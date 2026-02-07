import { parseStatePart } from "./parseStatePart.js";
import { ParseBindTextResult } from "./types.js";

export function parseBindTextForEmbeddedNode(bindText: string): ParseBindTextResult {
  const stateResult = parseStatePart(bindText);
  return {
    propName: 'textContent',
    propSegments: ['textContent'],
    propModifiers: [],
    inFilters: [],
    ...stateResult,
    bindingType: 'text',
  }
}