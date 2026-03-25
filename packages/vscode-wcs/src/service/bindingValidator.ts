/**
 * bindingValidator.ts
 *
 * HTML 内の data-wcs バインディング式を検証し、診断情報を生成する。
 *
 * 検証項目:
 * - パスが状態定義に存在するか
 * - フィルタ名が組み込みフィルタに存在するか
 */

import { BUILTIN_FILTERS, type FilterInfo } from './completionData.js';
import { analyzeStatePaths, type PathCandidate } from './stateAnalyzer.js';
import { parseWcsScriptBlocks } from '../language/htmlParse.js';

/** フィルタ名 → FilterInfo のマップ */
const filterMap = new Map<string, FilterInfo>(BUILTIN_FILTERS.map(f => [f.name, f]));

/** 診断情報 */
export interface BindingDiagnostic {
  /** HTML 内のオフセット（開始） */
  start: number;
  /** HTML 内のオフセット（終了） */
  end: number;
  /** メッセージ */
  message: string;
  /** 重大度: 'error' | 'warning' | 'info' */
  severity: 'error' | 'warning' | 'info';
}

/**
 * HTML 内の全バインド属性を検証して診断情報を返す。
 *
 * @param html - HTML 全文
 * @param attrName - バインド属性名（例: "data-wcs"）
 */
export function validateBindings(html: string, attrName: string): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];

  // 状態パスを収集
  const blocks = parseWcsScriptBlocks(html);
  const statePaths = blocks.flatMap(block => analyzeStatePaths(block.content));
  const pathSet = new Set(statePaths.map(p => p.path));

  // バインド属性を全て検出
  const attrs = findAllBindAttributes(html, attrName);

  const filterNameSet = new Set(BUILTIN_FILTERS.map(f => f.name));

  for (const attr of attrs) {
    const bindings = splitBindingExpressions(attr.value);
    let pos = 0;

    for (const binding of bindings) {
      const bindingStart = attr.valueStart + pos;

      // パスとフィルタを抽出
      const parsed = parseBindingExpression(binding);

      // パス検証
      if (parsed.path && statePaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        // ショートハンドパス (.name) やリテラルはスキップ
        if (pathTrimmed && !pathTrimmed.startsWith('.') && !isLiteral(pathTrimmed)) {
          if (!isValidPath(pathTrimmed, pathSet)) {
            const pathOffset = binding.indexOf(parsed.path);
            const pathStart = bindingStart + pathOffset;
            diagnostics.push({
              start: pathStart,
              end: pathStart + parsed.path.trim().length,
              message: `パス "${pathTrimmed}" は状態定義に存在しません`,
              severity: 'warning',
            });
          }
        }
      }

      // フィルタ検証
      if (parsed.property.startsWith('on') && parsed.filters.length > 0) {
        // イベントハンドラにフィルタは使用不可
        for (const filter of parsed.filters) {
          diagnostics.push({
            start: bindingStart + filter.offset,
            end: bindingStart + filter.offset + filter.name.length,
            message: `イベントハンドラ "${parsed.property}" にフィルタは使用できません`,
            severity: 'warning',
          });
        }
      } else {
        for (const filter of parsed.filters) {
          const info = filterMap.get(filter.name);
          if (!info) {
            diagnostics.push({
              start: bindingStart + filter.offset,
              end: bindingStart + filter.offset + filter.name.length,
              message: `フィルタ "${filter.name}" は組み込みフィルタに存在しません`,
              severity: 'warning',
            });
            continue;
          }

          // 引数の個数チェック
          const argCount = filter.args.length;
          if (argCount < info.minArgs) {
            diagnostics.push({
              start: bindingStart + filter.offset,
              end: bindingStart + filter.offset + filter.name.length,
              message: `フィルタ "${filter.name}" には最低 ${info.minArgs} 個の引数が必要です（${argCount} 個指定）`,
              severity: 'error',
            });
          } else if (argCount > info.maxArgs) {
            diagnostics.push({
              start: bindingStart + filter.offset,
              end: bindingStart + filter.offset + filter.name.length,
              message: `フィルタ "${filter.name}" の引数は最大 ${info.maxArgs} 個です（${argCount} 個指定）`,
              severity: 'error',
            });
          }

          // 引数の型チェック
          if (info.argTypes && argCount > 0) {
            for (let i = 0; i < Math.min(argCount, info.argTypes.length); i++) {
              const expectedArgType = info.argTypes[i];
              if (expectedArgType === 'any') continue;
              const actualArgType = inferArgType(filter.args[i]);
              if (actualArgType !== expectedArgType) {
                diagnostics.push({
                  start: bindingStart + filter.argsOffset,
                  end: bindingStart + filter.argsOffset + filter.name.length,
                  message: `フィルタ "${filter.name}" の第${i + 1}引数は ${expectedArgType} 型が必要です（"${filter.args[i]}" は ${actualArgType} 型）`,
                  severity: 'warning',
                });
              }
            }
          }
        }

        // フィルタ間の入力型チェック
        if (parsed.path && statePaths.length > 0) {
          const pathTrimmed = parsed.path.trim();
          if (pathTrimmed && !pathTrimmed.startsWith('.') && !isLiteral(pathTrimmed)) {
            const chainDiags = validateFilterChainTypes(
              pathTrimmed, parsed.filters, statePaths, bindingStart,
            );
            diagnostics.push(...chainDiags);
          }
        }
      }

      // プロパティに応じた型チェック
      if (parsed.path && statePaths.length > 0) {
        const pathTrimmed = parsed.path.trim();
        if (pathTrimmed && !pathTrimmed.startsWith('.') && !isLiteral(pathTrimmed)) {
          const resultType = resolveResultType(pathTrimmed, parsed.filters, statePaths);
          if (resultType !== null) {
            const typeReq = getExpectedType(parsed.property);
            if (typeReq && resultType !== typeReq.expected) {
              const pathOffset = binding.indexOf(parsed.path);
              const pathStart = bindingStart + pathOffset;
              diagnostics.push({
                start: pathStart,
                end: pathStart + pathTrimmed.length,
                message: `"${typeReq.label}" には${typeReq.expectedLabel}が必要です（現在の型: ${resultType}）`,
                severity: typeReq.severity,
              });
            }
          }
        }
      }

      pos += binding.length + 1; // +1 for ';'
    }
  }

  return diagnostics;
}

// ============================================================
// Internal helpers
// ============================================================

interface BindAttrLocation {
  value: string;
  valueStart: number;
}

interface ParsedFilter {
  name: string;
  offset: number;
  args: string[];
  argsOffset: number;  // '(' の位置（引数全体のオフセット）
}

interface ParsedBinding {
  property: string;
  path: string | null;
  filters: ParsedFilter[];
}

/**
 * HTML から全てのバインド属性を検出する。
 */
function findAllBindAttributes(html: string, attrName: string): BindAttrLocation[] {
  const attrs: BindAttrLocation[] = [];
  const escaped = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*=\\s*(["'])`, 'gi');

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const quote = match[1];
    const valueStart = match.index + match[0].length;
    const valueEnd = html.indexOf(quote, valueStart);
    if (valueEnd === -1) continue;

    attrs.push({
      value: html.slice(valueStart, valueEnd),
      valueStart,
    });
  }

  return attrs;
}

/**
 * バインディング式を `;` で分割する。
 */
function splitBindingExpressions(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const ch of value) {
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === ';' && parenDepth === 0) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

/**
 * 単一のバインディング式を解析する。
 */
function parseBindingExpression(expr: string): ParsedBinding {
  const colonIndex = expr.indexOf(':');

  if (colonIndex === -1) {
    // else ディレクティブなど（パスなし）
    return { property: expr.trim(), path: null, filters: [] };
  }

  const property = expr.slice(0, colonIndex).trim();
  const afterColon = expr.slice(colonIndex + 1);

  // フィルタを分離（括弧内の `|` はスキップ）
  const segments = splitByPipe(afterColon);
  const pathSegment = segments[0] || '';
  const filterSegments = segments.slice(1);

  // @state 部分を除去
  const atIndex = pathSegment.indexOf('@');
  const path = atIndex !== -1 ? pathSegment.slice(0, atIndex) : pathSegment;

  // フィルタ名・引数・オフセットを抽出
  const filters: ParsedFilter[] = [];
  let filterSearchStart = colonIndex + 1 + pathSegment.length + 1; // +1 for first '|'

  for (const seg of filterSegments) {
    const trimmed = seg.trim();
    const filterMatch = trimmed.match(/^(\w+)(?:\(([^)]*)\))?/);
    if (filterMatch) {
      const nameOffset = expr.indexOf(trimmed, filterSearchStart);
      const args = filterMatch[2] !== undefined
        ? filterMatch[2].split(',').map(a => a.trim()).filter(a => a !== '')
        : [];
      filters.push({
        name: filterMatch[1],
        offset: nameOffset >= 0 ? nameOffset : filterSearchStart,
        args,
        argsOffset: nameOffset >= 0 ? nameOffset + filterMatch[1].length : filterSearchStart,
      });
    }
    filterSearchStart += seg.length + 1; // +1 for '|'
  }

  return { property, path: path.trim() || null, filters };
}

/**
 * `|` で分割する（括弧内の `|` はスキップ）。
 */
function splitByPipe(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let parenDepth = 0;

  for (const ch of value) {
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '|' && parenDepth === 0) {
      result.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  result.push(current);
  return result;
}

/**
 * パスが状態パスセットに存在するか、またはワイルドカード展開で妥当かを判定する。
 */
function isValidPath(path: string, pathSet: Set<string>): boolean {
  if (pathSet.has(path)) return true;

  // "users.*.name" のような完全一致でなくても、
  // 親パス "users" が存在すれば部分的に妥当とみなす
  const segments = path.split('.');
  let current = '';
  for (const seg of segments) {
    current = current ? `${current}.${seg}` : seg;
    if (pathSet.has(current)) return true;
  }

  return false;
}

interface TypeRequirement {
  label: string;
  expected: string;
  expectedLabel: string;
  severity: 'error' | 'warning';
}

/**
 * プロパティ名から期待される型を返す。型制約がない場合は null。
 */
function getExpectedType(property: string): TypeRequirement | null {
  const prop = property.replace(/#.*$/, ''); // 修飾子を除去

  if (prop === 'for') {
    return { label: 'for', expected: 'array', expectedLabel: '配列型のパス', severity: 'error' };
  }
  if (prop === 'if' || prop === 'elseif') {
    return { label: prop, expected: 'boolean', expectedLabel: 'ブーリアン型', severity: 'warning' };
  }
  if (prop.startsWith('class.')) {
    return { label: prop, expected: 'boolean', expectedLabel: 'ブーリアン型', severity: 'warning' };
  }
  if (prop.startsWith('attr.')) {
    return { label: prop, expected: 'string', expectedLabel: '文字列型', severity: 'warning' };
  }
  if (prop.startsWith('style.')) {
    return { label: prop, expected: 'string', expectedLabel: '文字列型', severity: 'warning' };
  }
  return null;
}

/**
 * フィルタチェーン内の各フィルタの入力型と前のフィルタの出力型の整合性を検証する。
 */
function validateFilterChainTypes(
  path: string,
  filters: { name: string; offset: number }[],
  statePaths: PathCandidate[],
  bindingStart: number,
): BindingDiagnostic[] {
  const diagnostics: BindingDiagnostic[] = [];

  // 初期型を取得
  const pathInfo = statePaths.find(p => p.path === path);
  if (!pathInfo?.typeHint) return diagnostics;

  let currentType = pathInfo.typeHint;

  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) break; // 不明なフィルタ → チェーン中断

    // 入力型チェック
    if (info.acceptTypes !== 'any') {
      // union 型の場合、いずれかの部分型がマッチすれば OK
      const currentTypes = currentType.split('|');
      const hasMatch = currentTypes.some(t => (info.acceptTypes as string[]).includes(t));
      if (!hasMatch) {
        diagnostics.push({
          start: bindingStart + filter.offset,
          end: bindingStart + filter.offset + filter.name.length,
          message: `フィルタ "${filter.name}" は ${(info.acceptTypes as string[]).join('|')} 型の入力が必要です（現在の型: ${currentType}）`,
          severity: 'warning',
        });
      }
    }

    // 出力型を更新
    if (info.resultType !== 'passthrough') {
      currentType = info.resultType;
    }
  }

  return diagnostics;
}

/**
 * パスの型をフィルタチェーンを通して解決する。
 * 型が不明な場合は null を返す（検証をスキップ）。
 */
function resolveResultType(
  path: string,
  filters: { name: string; offset: number }[],
  statePaths: PathCandidate[],
): string | null {
  // パスの初期型を取得
  const pathInfo = statePaths.find(p => p.path === path);
  if (!pathInfo?.typeHint) return null;

  let currentType = pathInfo.typeHint;

  // フィルタチェーンを通して型を更新
  for (const filter of filters) {
    const info = filterMap.get(filter.name);
    if (!info) return null; // 不明なフィルタ → 型追跡を中止
    if (info.resultType === 'passthrough') continue;
    currentType = info.resultType;
  }

  return currentType;
}

/**
 * フィルタ引数の型を推定する。
 * state 側ではすべての引数が文字列として扱われるため、
 * 引用符なしでも数値以外はすべて string とみなす。
 */
function inferArgType(arg: string): string {
  const v = arg.trim();
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  return 'string';
}

/**
 * リテラル値かどうかを判定（数値、文字列リテラル等）。
 */
function isLiteral(value: string): boolean {
  return /^-?\d/.test(value) || /^["'`]/.test(value) || value === 'true' || value === 'false' || value === 'null';
}
