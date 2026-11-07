/**
 * options.ts — tsconfig の `contentMappers` の項目の `options`。
 *
 *   { "package": "@wcstack/typescript", "extensions": [".html"],
 *     "options": { "stateTagName": "wcs-state", "urlImports": "any" } }
 *
 * - `stateTagName`（既定 `wcs-state`）: state を書く要素の名前。拡張の `wcstack.stateTagName` と同じ。
 * - `urlImports`（既定 `any`）: `any` は `https://` / `http://` の module import の解決の誤り
 *   （TS2307）を出さず、その束縛を `any` にする。`error` はそのまま報告させる。`wcs-tsc --url-imports` と同じ。
 *
 * 誤りは `openProject` の `optionDiagnostics` で報告し、その項目は既定値で続ける。
 */

import type { OptionDiagnostic } from './protocol.js';

export interface MapperOptions {
  readonly stateTagName: string;
  readonly urlImports: 'any' | 'error';
}

export const DEFAULT_MAPPER_OPTIONS: MapperOptions = { stateTagName: 'wcs-state', urlImports: 'any' };

/** 知らないオプション。 */
export const CODE_UNKNOWN_OPTION = 1001;
/** オプションの値の誤り。 */
export const CODE_INVALID_OPTION = 1002;

/** カスタム要素の名前（ASCII の小文字・ハイフンを含む）。 */
const CUSTOM_ELEMENT_NAME = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

export function parseMapperOptions(raw: unknown): { options: MapperOptions; diagnostics: OptionDiagnostic[] } {
  const diagnostics: OptionDiagnostic[] = [];
  if (raw === undefined || raw === null) return { options: DEFAULT_MAPPER_OPTIONS, diagnostics };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    diagnostics.push({ path: [], code: CODE_INVALID_OPTION, messageText: 'The options of @wcstack/typescript must be an object.' });
    return { options: DEFAULT_MAPPER_OPTIONS, diagnostics };
  }
  let { stateTagName, urlImports } = DEFAULT_MAPPER_OPTIONS;
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'stateTagName') {
      if (typeof value === 'string' && CUSTOM_ELEMENT_NAME.test(value)) stateTagName = value;
      else diagnostics.push({ path: [key], code: CODE_INVALID_OPTION, messageText: `stateTagName must be a custom element name such as "wcs-state" (lowercase, with a hyphen); got ${JSON.stringify(value)}.` });
    } else if (key === 'urlImports') {
      if (value === 'any' || value === 'error') urlImports = value;
      else diagnostics.push({ path: [key], code: CODE_INVALID_OPTION, messageText: `urlImports must be "any" or "error"; got ${JSON.stringify(value)}.` });
    } else {
      diagnostics.push({ path: [key], code: CODE_UNKNOWN_OPTION, messageText: `Unknown option '${key}' for @wcstack/typescript. Known options: stateTagName, urlImports.` });
    }
  }
  return { options: { stateTagName, urlImports }, diagnostics };
}
