/**
 * getterAnnotations.ts
 *
 * state の getter に仮想コードで戻り値の型注釈 `: any` を足す位置を求める。
 *
 * `defineState<T>(def: T & ThisType<_WcsThis<T>>)` は、T をオブジェクトリテラルから推論する。
 * 注釈の無い getter の型はその本体から推論され、本体が `this` を読むと推論が T に戻ってくる
 * （循環）。TypeScript はその getter の型を `any` にし、本体の `this` も `any` のまま
 * キャッシュする — `get first() { return this.items[0].nmae; }` の typo は報告されず、
 * strict では `this.items.filter((i) => …)` の `i` が暗黙の any（TS7006）になる。
 * メソッドは本体の検査が T の確定後に回るので起きない（TypeScript 5.9 / 7.1 で同じ）。
 *
 * 戻り値を注釈すると循環が切れ、本体は確定した `this` で検査される。getter の型は
 * どのみち `any` だったので、失うものは無い。注釈は `this` を読む getter にだけ付ける —
 * 読まない getter（`get now() { return Date.now(); }`）は今どおり推論された型を持つ。
 *
 * 対象は state オブジェクト（`export default { … }` / `export default defineState({ … })`）の
 * 直下の getter だけ。パースできないコード（構文エラー、TypeScript の構文）では何も足さない。
 */

import { parse, type AnyNode } from 'acorn';

/** getter の `)` の直後に足す型注釈。 */
export const GETTER_RETURN_ANNOTATION = ': any';

/**
 * `code` の中で `GETTER_RETURN_ANNOTATION` を挿入するオフセット（昇順）。
 * 各オフセットは `this` を読む getter の引数リストを閉じる `)` の直後。
 */
export function getterAnnotationOffsets(code: string): number[] {
  let program: AnyNode;
  try {
    program = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return [];
  }
  const state = stateObject(program);
  if (state === null) return [];
  const offsets: number[] = [];
  for (const property of state.properties) {
    if (property.type !== 'Property' || property.kind !== 'get') continue;
    const fn = property.value;
    if (fn.type !== 'FunctionExpression' || !readsThis(fn.body)) continue;
    const offset = closingParenEnd(code, fn.body.start);
    if (offset !== null) offsets.push(offset);
  }
  return offsets;
}

/** `export default { … }` か `export default defineState({ … })` のオブジェクト。 */
function stateObject(program: AnyNode): (AnyNode & { type: 'ObjectExpression' }) | null {
  if (program.type !== 'Program') return null;
  for (const statement of program.body) {
    if (statement.type !== 'ExportDefaultDeclaration') continue;
    const declaration = statement.declaration;
    if (declaration.type === 'ObjectExpression') return declaration;
    if (
      declaration.type === 'CallExpression'
      && declaration.callee.type === 'Identifier'
      && declaration.callee.name === 'defineState'
      && declaration.arguments[0]?.type === 'ObjectExpression'
    ) {
      return declaration.arguments[0];
    }
    return null;
  }
  return null;
}

/** 本体が（入れ子の function / class ではなく）getter 自身の `this` を読むか。アロー関数は `this` を継ぐ。 */
function readsThis(node: AnyNode): boolean {
  if (node.type === 'ThisExpression') return true;
  if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration'
    || node.type === 'ClassExpression' || node.type === 'ClassDeclaration') {
    return false;
  }
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (isNode(child) && readsThis(child)) return true;
    }
  }
  return false;
}

function isNode(value: unknown): value is AnyNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** 本体の `{` から空白を遡った位置が `)` なら、その直後のオフセット。コメントなどが挟まれば null。 */
function closingParenEnd(code: string, bodyStart: number): number | null {
  let i = bodyStart - 1;
  while (i >= 0 && /\s/.test(code[i])) i--;
  return code[i] === ')' ? i + 1 : null;
}
