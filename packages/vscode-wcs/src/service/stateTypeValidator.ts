/**
 * stateTypeValidator.ts
 *
 * <wcs-state> スクリプト内の JSDoc @type アノテーションと
 * プロパティ初期値の整合性を検証する。
 */

import { parseLoadedScriptBlocks } from '../language/htmlParse.js';
import { getMessages } from '../core/messages.js';
import { maskCommentsAndStrings } from './stateAnalyzer.js';
import {
  collectJsDocTypedefs,
  findJsDocComments,
  flattenJsDocType,
  parseJsDocType,
  readJsDocTagType,
  type JsDocType,
  type JsDocTypedefs,
} from './jsdocType.js';

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
export function validateStateTypes(html: string, stateTagName: string = 'wcs-state', locale?: string): StateTypeDiagnostic[] {
  const msgs = getMessages(locale);
  const blocks = parseLoadedScriptBlocks(html, stateTagName);
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
          message: msgs.typeAnnotationIncompatible(prop.valueType, prop.rawType),
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

/** 直後のプロパティ定義（JSDoc コメントの直後の `name:` / `"name":`）。 */
const PROPERTY_AFTER_COMMENT = /^\s*(?:"([^"]+)"|'([^']+)'|(\w+))\s*:\s*/;

/**
 * スクリプト内容から JSDoc @type 付きプロパティを検出する。
 * 型表現は jsdocType の読み方（入れ子の `{…}`・`@typedef` の名前）に揃える。
 */
function findJsDocTypedProperties(script: string): JsDocTypedProperty[] {
  const results: JsDocTypedProperty[] = [];
  const scan = maskCommentsAndStrings(script);
  const typedefs = script.includes('@typedef') ? collectJsDocTypedefs(script, scan) : new Map<string, JsDocType>();

  for (const comment of findJsDocComments(script, scan)) {
    const typeText = readJsDocTagType(comment.text, 'type');
    if (typeText === null) continue;
    const match = PROPERTY_AFTER_COMMENT.exec(script.slice(comment.end));
    if (!match) continue;
    const rawType = typeText.replace(/\s+/g, ' ');
    const name = match[1] ?? match[2] ?? match[3];
    const valueStart = comment.end + match[0].length;

    // 値部分を抽出
    const valueText = extractValue(script, valueStart);
    const valueType = inferValueType(valueText);

    if (valueType) {
      const declaredTypes = declaredTypesOf(rawType, typedefs);
      if (declaredTypes === null) continue;

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

/** 何でも受ける型（検証しない）。 */
const ANY_TYPES = new Set(['any', 'unknown', '*']);

/**
 * 宣言された型の構成員を、値の型と比べられる語（`string` / `array` / `object` …）にする。
 * `@typedef` の名前は解決する。何でも受ける構成員（`any` / `unknown` / `*`・関数型などの
 * 読めない型）があれば検証できないので null。読めない表現は従来どおり `|` で割る。
 */
function declaredTypesOf(rawType: string, typedefs: JsDocTypedefs): string[] | null {
  if (rawType.split('|').some((t) => ANY_TYPES.has(t.trim().toLowerCase()))) return null;
  const parsed = parseJsDocType(rawType);
  if (parsed === null) return rawType.split('|').map(t => normalizeType(t.trim()));
  const out: string[] = [];
  for (const member of flattenJsDocType(parsed, typedefs)) {
    if (member.kind === 'unknown') return null;
    if (member.kind === 'array') out.push('array');
    else if (member.kind === 'object') out.push('object');
    else if (member.kind === 'name') out.push(normalizeType(member.name));
  }
  return out;
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
