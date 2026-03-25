/**
 * stateTypeValidator.ts
 *
 * <wcs-state> スクリプト内の JSDoc @type アノテーションと
 * プロパティ初期値の整合性を検証する。
 */

import { parseWcsScriptBlocks } from '../language/htmlParse.js';

/** 診断情報 */
export interface StateTypeDiagnostic {
  start: number;
  end: number;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * HTML 内の全 <wcs-state> スクリプトで JSDoc 型と初期値の整合性を検証する。
 */
export function validateStateTypes(html: string): StateTypeDiagnostic[] {
  const blocks = parseWcsScriptBlocks(html);
  const diagnostics: StateTypeDiagnostic[] = [];

  for (const block of blocks) {
    const props = findJsDocTypedProperties(block.content);
    for (const prop of props) {
      if (!isValueCompatible(prop.declaredTypes, prop.valueType)) {
        const absStart = block.contentStart + prop.valueOffset;
        const absEnd = absStart + prop.valueLength;
        diagnostics.push({
          start: absStart,
          end: absEnd,
          message: `型 "${prop.valueType}" は @type {${prop.rawType}} と互換性がありません`,
          severity: 'warning',
        });
      }
    }
  }

  return diagnostics;
}

// ============================================================
// Internal
// ============================================================

interface JsDocTypedProperty {
  name: string;
  rawType: string;
  declaredTypes: string[];
  valueType: string;
  valueOffset: number;
  valueLength: number;
}

/**
 * スクリプト内容から JSDoc @type 付きプロパティを検出する。
 */
function findJsDocTypedProperties(script: string): JsDocTypedProperty[] {
  const results: JsDocTypedProperty[] = [];

  // JSDoc コメント直後のプロパティ定義を検出
  const regex = /\/\*\*\s*@type\s*\{([^}]+)\}\s*\*\/\s*(?:"([^"]+)"|'([^']+)'|(\w+))\s*:\s*/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(script)) !== null) {
    const rawType = match[1].trim();
    const name = match[2] ?? match[3] ?? match[4];
    const valueStart = match.index + match[0].length;

    // 値部分を抽出
    const valueText = extractValue(script, valueStart);
    const valueType = inferValueType(valueText);

    if (valueType) {
      const declaredTypes = rawType.split('|').map(t => normalizeType(t.trim()));

      results.push({
        name,
        rawType,
        declaredTypes,
        valueType,
        valueOffset: valueStart,
        valueLength: valueText.length,
      });
    }
  }

  return results;
}

/**
 * 値のリテラルテキストを抽出する（カンマまたは改行まで）。
 */
function extractValue(script: string, start: number): string {
  let depth = 0;
  let inString: string | null = null;
  let i = start;

  while (i < script.length) {
    const ch = script[i];
    if (inString) {
      if (ch === inString && script[i - 1] !== '\\') inString = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
    } else if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) break;
      depth--;
    } else if ((ch === ',' || ch === '\n') && depth === 0) {
      break;
    }
    i++;
  }

  return script.slice(start, i).trim();
}

/**
 * 値のリテラルから型を推定する。
 */
function inferValueType(value: string): string | null {
  const v = value.replace(/,\s*$/, '').trim();
  if (v === 'null') return 'null';
  if (v === 'undefined') return 'null';
  if (v === 'true' || v === 'false') return 'boolean';
  if (/^-?\d+\.\d/.test(v)) return 'number';
  if (/^-?\d/.test(v)) return 'number';
  if (/^["'`]/.test(v)) return 'string';
  if (v.startsWith('[')) return 'array';
  if (v.startsWith('{')) return 'object';
  return null; // 変数参照等は検証しない
}

/**
 * JSDoc 型名を正規化する。
 */
function normalizeType(type: string): string {
  const lower = type.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return 'null';
  if (lower === 'string') return 'string';
  if (lower === 'number') return 'number';
  if (lower === 'boolean') return 'boolean';
  if (lower.endsWith('[]') || lower.startsWith('array')) return 'array';
  if (lower === 'object') return 'object';
  return type; // カスタム型はそのまま
}

/**
 * 値の型が宣言された型と互換性があるかを判定する。
 */
function isValueCompatible(declaredTypes: string[], valueType: string): boolean {
  return declaredTypes.includes(valueType);
}
